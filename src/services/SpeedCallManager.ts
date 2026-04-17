/**
 * SpeedCallManager – manages the 60-second WebRTC speed-dating call lifecycle.
 *
 * Responsibilities (issue #25 §2):
 *  - Hold the authoritative call clock (hard-stop at 60 seconds).
 *  - Emit `tick` events once per second so the UI can drive the countdown
 *    ring on both sides.
 *  - Emit a `warning` event at the 10-second remaining mark.
 *  - At 0 seconds, auto-disconnect with a `call-ended(reason='timer-expired')`.
 *  - Monitor connection quality via ICE-connection-state updates.  If the
 *     WebRTC connection drops, both users are refunded a **re-match token**
 *     that lets them skip their cooldown / keep their place in queue.
 *  - Forward raw WebRTC signaling (offer / answer / ICE) between the two
 *     peers in the pair.
 *
 * The SpeedCallManager is deliberately transport-agnostic – callers wire
 * the `signal` event to a Fastify WebSocket `send` and call `deliverSignal`
 * with messages received from the peer.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { NowFn } from './SpeedDatingQueue';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard-stop length of a speed-dating call (ms). */
export const CALL_DURATION_MS = 60_000;

/** Milliseconds before end at which a warning fires (issue spec: 10s). */
export const WARNING_MS_BEFORE_END = 10_000;

/** Grace period (ms) in which we attempt ICE reconnect before giving up. */
export const RECONNECT_GRACE_MS = 8_000;

/** Token lifetime (ms) – 5 minutes to honor a re-match claim. */
export const REMATCH_TOKEN_TTL_MS = 5 * 60 * 1000;

/** How often the UI-facing countdown tick fires (ms). */
export const TICK_INTERVAL_MS = 1_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type CallPhase = 'setup' | 'connecting' | 'connected' | 'warning' | 'ending' | 'ended';

export type CallEndReason =
  | 'timer-expired'
  | 'user-hangup'
  | 'connection-lost'
  | 'reconnect-failed'
  | 'server-shutdown'
  | 'error';

/** Signaling message payload travelling between peers. */
export interface SpeedCallSignalMessage {
  callId: string;
  type: 'offer' | 'answer' | 'ice-candidate' | 'renegotiate';
  fromUserId: string;
  toUserId: string;
  payload: unknown;
}

/** ICE connection state sampled from `RTCPeerConnection`. */
export type IceConnectionState =
  | 'new'
  | 'checking'
  | 'connected'
  | 'completed'
  | 'failed'
  | 'disconnected'
  | 'closed';

/** Per-call quality sample. */
export interface QualitySample {
  userId: string;
  iceState: IceConnectionState;
  rttMs?: number;
  packetLossPct?: number;
  sampledAt: number;
}

/** Re-match token granted after a connection drop. */
export interface RematchToken {
  token: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
  reason: CallEndReason;
}

/** A fully-constructed call. */
export interface SpeedCallState {
  callId: string;
  proposalId: string;
  userA: string;
  userB: string;
  startedAt: number;
  endsAt: number;
  phase: CallPhase;
  warned: boolean;
  quality: {
    a: QualitySample | null;
    b: QualitySample | null;
  };
  /** Milliseconds of "disconnected" ICE state in the current gap, if any. */
  currentGapStartedAt: number | null;
}

/** Arguments to `startCall`. */
export interface StartCallArgs {
  proposalId: string;
  userA: string;
  userB: string;
}

/** Hook invoked when the call ends – lets callers persist outcomes. */
export type CallEndListener = (args: {
  call: SpeedCallState;
  reason: CallEndReason;
  rematchTokens: RematchToken[];
}) => void;

// ─── Configuration ────────────────────────────────────────────────────────────

export interface SpeedCallManagerConfig {
  callDurationMs?: number;
  warningMsBeforeEnd?: number;
  reconnectGraceMs?: number;
  rematchTokenTtlMs?: number;
  tickIntervalMs?: number;
  nowFn?: NowFn;
}

// ─── SpeedCallManager ─────────────────────────────────────────────────────────

export class SpeedCallManager extends EventEmitter {
  private readonly callDurationMs: number;
  private readonly warningMsBeforeEnd: number;
  private readonly reconnectGraceMs: number;
  private readonly rematchTokenTtlMs: number;
  private readonly tickIntervalMs: number;
  private readonly nowFn: NowFn;

  /** Active calls keyed by callId. */
  private readonly calls = new Map<string, SpeedCallState>();
  /** userId → callId for constant-time lookup. */
  private readonly userCallIndex = new Map<string, string>();
  /** callId → interval handle. */
  private readonly tickHandles = new Map<string, ReturnType<typeof setInterval>>();
  /** callId → hard-stop timeout handle. */
  private readonly hardStopHandles = new Map<string, ReturnType<typeof setTimeout>>();
  /** callId → reconnect grace timeout handle. */
  private readonly reconnectHandles = new Map<string, ReturnType<typeof setTimeout>>();
  /** Issued re-match tokens, indexed by token string. */
  private readonly rematchTokens = new Map<string, RematchToken>();

  constructor(config: SpeedCallManagerConfig = {}) {
    super();
    this.callDurationMs = config.callDurationMs ?? CALL_DURATION_MS;
    this.warningMsBeforeEnd = config.warningMsBeforeEnd ?? WARNING_MS_BEFORE_END;
    this.reconnectGraceMs = config.reconnectGraceMs ?? RECONNECT_GRACE_MS;
    this.rematchTokenTtlMs = config.rematchTokenTtlMs ?? REMATCH_TOKEN_TTL_MS;
    this.tickIntervalMs = config.tickIntervalMs ?? TICK_INTERVAL_MS;
    this.nowFn = config.nowFn ?? (() => Date.now());
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Begin a new 60-second call.  Both users must be free of any other call. */
  startCall(args: StartCallArgs): SpeedCallState {
    if (args.userA === args.userB) {
      throw new Error('userA and userB cannot be the same user');
    }
    if (this.userCallIndex.has(args.userA)) {
      throw new Error(`user ${args.userA} is already in a call`);
    }
    if (this.userCallIndex.has(args.userB)) {
      throw new Error(`user ${args.userB} is already in a call`);
    }

    const callId = randomUUID();
    const now = this.nowFn();
    const state: SpeedCallState = {
      callId,
      proposalId: args.proposalId,
      userA: args.userA,
      userB: args.userB,
      startedAt: now,
      endsAt: now + this.callDurationMs,
      phase: 'connecting',
      warned: false,
      quality: { a: null, b: null },
      currentGapStartedAt: null
    };
    this.calls.set(callId, state);
    this.userCallIndex.set(args.userA, callId);
    this.userCallIndex.set(args.userB, callId);

    // Kick off tick driver.
    const tick = setInterval(() => this.onTick(callId), this.tickIntervalMs);
    if (typeof tick === 'object' && tick && 'unref' in tick) (tick as { unref: () => void }).unref();
    this.tickHandles.set(callId, tick);

    const hardStop = setTimeout(() => this.endCall(callId, 'timer-expired'), this.callDurationMs);
    if (typeof hardStop === 'object' && hardStop && 'unref' in hardStop) {
      (hardStop as { unref: () => void }).unref();
    }
    this.hardStopHandles.set(callId, hardStop);

    this.emit('call-started', state);
    return state;
  }

  /**
   * Peer relay for WebRTC signaling.  Returns `true` when the message was
   * forwarded, `false` if the call/pair is not recognised.  The UI is
   * expected to subscribe to the `signal` event and ship the payload over
   * its WebSocket to the target user.
   */
  deliverSignal(msg: SpeedCallSignalMessage): boolean {
    const call = this.calls.get(msg.callId);
    if (!call) return false;
    if (msg.fromUserId === msg.toUserId) return false;

    const participants = [call.userA, call.userB];
    if (!participants.includes(msg.fromUserId)) return false;
    if (!participants.includes(msg.toUserId)) return false;

    // First time we see an offer/answer, mark the call as "connected".
    if (call.phase === 'connecting' && (msg.type === 'offer' || msg.type === 'answer')) {
      call.phase = 'connected';
      this.emit('call-connected', call);
    }
    this.emit('signal', msg);
    return true;
  }

  /** Update per-peer quality statistics.  Handles drop/recover transitions. */
  reportQuality(sample: QualitySample): void {
    const callId = this.userCallIndex.get(sample.userId);
    if (!callId) return;
    const call = this.calls.get(callId);
    if (!call) return;

    const which: 'a' | 'b' = sample.userId === call.userA ? 'a' : 'b';
    call.quality[which] = sample;

    const badStates: IceConnectionState[] = ['disconnected', 'failed'];
    const isBad = badStates.includes(sample.iceState);

    if (isBad && call.currentGapStartedAt == null) {
      call.currentGapStartedAt = sample.sampledAt;
      this.emit('quality-degraded', { call, sample });
      // Give the connection `reconnectGraceMs` to recover.
      const handle = setTimeout(() => this.endCall(callId, 'reconnect-failed'), this.reconnectGraceMs);
      if (typeof handle === 'object' && handle && 'unref' in handle) {
        (handle as { unref: () => void }).unref();
      }
      this.reconnectHandles.set(callId, handle);
    } else if (!isBad && call.currentGapStartedAt != null) {
      // Recovered – cancel the pending disconnect.
      const handle = this.reconnectHandles.get(callId);
      if (handle) clearTimeout(handle);
      this.reconnectHandles.delete(callId);
      call.currentGapStartedAt = null;
      this.emit('quality-recovered', { call, sample });
    }
  }

  /** Explicit user hang-up.  Ends the call immediately. */
  hangup(userId: string): boolean {
    const callId = this.userCallIndex.get(userId);
    if (!callId) return false;
    this.endCall(callId, 'user-hangup');
    return true;
  }

  /** Force the call to end with an arbitrary reason. */
  endCall(callId: string, reason: CallEndReason): boolean {
    const call = this.calls.get(callId);
    if (!call || call.phase === 'ended') return false;

    call.phase = 'ended';
    this.cleanupTimers(callId);

    this.userCallIndex.delete(call.userA);
    this.userCallIndex.delete(call.userB);
    this.calls.delete(callId);

    const rematchTokens: RematchToken[] = [];
    if (reason === 'connection-lost' || reason === 'reconnect-failed') {
      rematchTokens.push(this.issueRematchToken(call.userA, reason));
      rematchTokens.push(this.issueRematchToken(call.userB, reason));
    }

    this.emit('call-ended', { call, reason, rematchTokens });
    return true;
  }

  /** Redeem a re-match token – single-use, expires after TTL. */
  consumeRematchToken(token: string, userId: string): boolean {
    const record = this.rematchTokens.get(token);
    if (!record) return false;
    if (record.userId !== userId) return false;
    if (record.expiresAt < this.nowFn()) {
      this.rematchTokens.delete(token);
      return false;
    }
    this.rematchTokens.delete(token);
    this.emit('rematch-token-consumed', record);
    return true;
  }

  /** Active call state (or null if no such call). */
  getCall(callId: string): SpeedCallState | null {
    return this.calls.get(callId) ?? null;
  }

  /** callId for the given user, or null if they are not in a call. */
  getCallForUser(userId: string): string | null {
    return this.userCallIndex.get(userId) ?? null;
  }

  /** Count of active calls on this instance. */
  activeCallCount(): number {
    return this.calls.size;
  }

  /** Iterate over active calls (read-only). */
  listActiveCalls(): Readonly<SpeedCallState>[] {
    return [...this.calls.values()];
  }

  /** Shutdown helper – ends every call gracefully. */
  shutdown(): void {
    for (const callId of [...this.calls.keys()]) {
      this.endCall(callId, 'server-shutdown');
    }
    this.rematchTokens.clear();
    this.emit('shutdown', {});
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private onTick(callId: string): void {
    const call = this.calls.get(callId);
    if (!call || call.phase === 'ended') return;

    const now = this.nowFn();
    const remaining = Math.max(0, call.endsAt - now);

    if (!call.warned && remaining <= this.warningMsBeforeEnd) {
      call.warned = true;
      call.phase = 'warning';
      this.emit('warning', { call, remaining });
    }

    this.emit('tick', { call, remaining });

    if (remaining <= 0) {
      this.endCall(callId, 'timer-expired');
    }
  }

  private cleanupTimers(callId: string): void {
    const tick = this.tickHandles.get(callId);
    if (tick) clearInterval(tick);
    this.tickHandles.delete(callId);
    const hard = this.hardStopHandles.get(callId);
    if (hard) clearTimeout(hard);
    this.hardStopHandles.delete(callId);
    const reconnect = this.reconnectHandles.get(callId);
    if (reconnect) clearTimeout(reconnect);
    this.reconnectHandles.delete(callId);
  }

  private issueRematchToken(userId: string, reason: CallEndReason): RematchToken {
    const token: RematchToken = {
      token: randomUUID(),
      userId,
      issuedAt: this.nowFn(),
      expiresAt: this.nowFn() + this.rematchTokenTtlMs,
      reason
    };
    this.rematchTokens.set(token.token, token);
    this.emit('rematch-token-issued', token);
    return token;
  }
}
