/**
 * SpeedDatingQueue – Redis-style sorted-set queue for 60-second speed-dating
 * roulette.
 *
 * The SpeedDatingQueue models exactly the semantics described in issue #25:
 *
 *  1. Users join a global queue keyed by wait-time (a Redis sorted-set whose
 *     score is the `enqueuedAt` timestamp – longest-waiting user pops first).
 *  2. Pairing respects a ±5-year age window.  If two users are compatible on
 *     age they are pulled from the queue and enter a 10-second connection
 *     countdown before their call actually starts.
 *  3. During the first 5 seconds of that countdown either user may cancel
 *     without any penalty ("Cancel within 5s without penalty").  After 5s,
 *     cancellation is still allowed but the user is hit with a short
 *     penalty cooldown to discourage abuse.
 *  4. Each server instance caps out at `SESSION_CAPACITY` (100) concurrent
 *     active pairs.  New matches past the cap must wait in the queue until
 *     an active slot frees up.
 *  5. Once a user completes (or cancels after the grace window) a call,
 *     they serve a 30-second cooldown before being allowed back in the
 *     queue – the "anticipation" window from the spec.
 *  6. The queue emits rich lifecycle events (`enqueued`, `match-proposed`,
 *     `match-cancelled`, `match-accepted`, `match-started`, `capacity-full`,
 *     …) for wiring into the signaling / UI layer.
 *
 * Implementation notes:
 *  - Internally the queue uses an in-memory `RedisSortedSet` shim with the
 *     exact semantic subset we need (`ZADD`, `ZREM`, `ZRANGE`, `ZCARD`).  A
 *     production deployment swaps this out for ioredis by passing a Redis
 *     client that implements the `RedisLikeClient` interface.  The public
 *     surface of the class never touches Redis commands directly so the
 *     swap is mechanical.
 *  - No timers run unless there are pending proposals – once the queue is
 *     idle it is inert (important for test determinism and shutdown).
 *  - All time-sensitive values accept an injected `now()` function so tests
 *     can run with fake clocks.  When absent the service falls back to
 *     `Date.now()`.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum age delta (years) permitted when pairing two users. */
export const DEFAULT_AGE_RADIUS_YEARS = 5;

/** Countdown (ms) shown to both users before their WebRTC call starts. */
export const CONNECT_COUNTDOWN_MS = 10_000;

/** "No penalty" cancel window (ms) measured from when the match was proposed. */
export const FREE_CANCEL_WINDOW_MS = 5_000;

/** Default penalty applied when a user cancels after the free window. */
export const LATE_CANCEL_PENALTY_MS = 15_000;

/** Default cooldown applied after a call (success or abandonment). */
export const POST_CALL_COOLDOWN_MS = 30_000;

/** Maximum concurrent active pairs per server instance. */
export const SESSION_CAPACITY = 100;

/** Key under which queue state is stored in the Redis-like backend. */
export const QUEUE_KEY = 'speeddating:queue';

/** Peak-hour (happy-hour) Redis pub/sub channel – matchmaking 2× rate. */
export const HAPPY_HOUR_CHANNEL = 'speeddating:events:happyhour';

/** Default happy-hour multiplier applied to the effective age radius. */
export const HAPPY_HOUR_AGE_RADIUS_MULTIPLIER = 2;

/** Start / end hours (inclusive / exclusive) of the daily happy-hour window. */
export const HAPPY_HOUR_START_HOUR = 20; // 8pm
export const HAPPY_HOUR_END_HOUR = 22; // 10pm

// ─── Types ────────────────────────────────────────────────────────────────────

/** Gender preference filter – extensible beyond binary. */
export type GenderPreference = 'any' | 'male' | 'female' | 'nonbinary';

/** Optional theme a user selects when joining a themed night. */
export type ThemeTag = 'travel' | 'music' | 'tech' | 'foodie' | 'fitness' | 'art' | 'books';

/**
 * Public data sent by the UI when a user joins the speed-dating queue.
 * All fields except `userId` and `age` are optional.
 */
export interface SpeedDatingJoinRequest {
  userId: string;
  age: number;
  gender?: Exclude<GenderPreference, 'any'>;
  preference?: GenderPreference;
  themes?: ThemeTag[];
  /** Override the default ±5yr radius on a per-user basis (premium feature). */
  ageRadiusYears?: number;
  /** Latitude/longitude in degrees – used for proximity tie-breaking only. */
  location?: { lat: number; lon: number };
}

/** An entry in the queue – flat-serialized for compatibility with Redis. */
export interface QueueMember {
  userId: string;
  age: number;
  gender?: Exclude<GenderPreference, 'any'>;
  preference: GenderPreference;
  themes: ThemeTag[];
  ageRadiusYears: number;
  enqueuedAt: number;
  location?: { lat: number; lon: number };
}

/** Record of a proposed match awaiting connection. */
export interface MatchProposal {
  proposalId: string;
  a: QueueMember;
  b: QueueMember;
  proposedAt: number;
  connectDeadline: number;
  freeCancelUntil: number;
  accepted: { a: boolean; b: boolean };
  cancelled: boolean;
}

/** Reason a proposal was cancelled. */
export type CancelReason =
  | 'user-cancelled'
  | 'partner-cancelled'
  | 'timeout'
  | 'server-shutdown'
  | 'disconnect';

/** State stored per user for cooldown / penalty tracking. */
export interface UserCooldown {
  userId: string;
  releaseAt: number;
  reason: 'post-call' | 'late-cancel' | 'penalty';
}

/** Minimal Redis-like API the queue needs. */
export interface RedisLikeClient {
  zadd(key: string, score: number, member: string): Promise<number> | number;
  zrem(key: string, member: string): Promise<number> | number;
  zrange(key: string, start: number, stop: number): Promise<string[]> | string[];
  zcard(key: string): Promise<number> | number;
  exists(key: string): Promise<number> | number;
}

/** Optional wall-clock override – helps deterministic testing. */
export type NowFn = () => number;

// ─── InMemoryRedis shim ──────────────────────────────────────────────────────

/**
 * Tiny in-memory sorted-set implementation matching the exact subset of
 * Redis commands used by the SpeedDatingQueue.  Kept synchronous for
 * simplicity; the public interface is Promise-aware so a real Redis client
 * slots in without any call-site changes.
 */
export class InMemorySortedSetClient implements RedisLikeClient {
  private readonly sets = new Map<string, Map<string, number>>();

  zadd(key: string, score: number, member: string): number {
    const map = this.sets.get(key) ?? new Map<string, number>();
    const existed = map.has(member);
    map.set(member, score);
    this.sets.set(key, map);
    return existed ? 0 : 1;
  }

  zrem(key: string, member: string): number {
    const map = this.sets.get(key);
    if (!map) return 0;
    const had = map.delete(member);
    if (map.size === 0) this.sets.delete(key);
    return had ? 1 : 0;
  }

  zrange(key: string, start: number, stop: number): string[] {
    const map = this.sets.get(key);
    if (!map || map.size === 0) return [];
    const sorted = [...map.entries()].sort((a, b) => a[1] - b[1]);
    const len = sorted.length;
    const s = start < 0 ? Math.max(0, len + start) : Math.min(start, len);
    const e = stop < 0 ? len + stop + 1 : Math.min(stop + 1, len);
    if (e <= s) return [];
    return sorted.slice(s, e).map(([m]) => m);
  }

  zcard(key: string): number {
    return this.sets.get(key)?.size ?? 0;
  }

  exists(key: string): number {
    return this.sets.has(key) ? 1 : 0;
  }
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface SpeedDatingQueueConfig {
  /** Optional Redis-like backend.  If omitted, an in-memory shim is used. */
  redis?: RedisLikeClient;
  /** Maximum concurrent active pairs on this instance (default 100). */
  sessionCapacity?: number;
  /** Milliseconds of the pre-call countdown (default 10000). */
  connectCountdownMs?: number;
  /** Milliseconds of the no-penalty cancel window (default 5000). */
  freeCancelWindowMs?: number;
  /** Penalty cooldown for a late cancel (default 15000). */
  lateCancelPenaltyMs?: number;
  /** Cooldown after any completed/aborted call (default 30000). */
  postCallCooldownMs?: number;
  /** Default age radius in years (default 5). */
  ageRadiusYears?: number;
  /** Theme filter – when set, only same-theme pairings are allowed. */
  themeNight?: ThemeTag | null;
  /** Force happy-hour on regardless of wall-clock (for testing). */
  forceHappyHour?: boolean;
  /** Injectable clock for deterministic tests. */
  nowFn?: NowFn;
}

// ─── SpeedDatingQueue ─────────────────────────────────────────────────────────

/**
 * The primary queue service – combines Redis sorted-set membership with
 * in-process pairing logic.  The queue emits events for the signaling layer
 * to relay to connected WebSocket clients.
 */
export class SpeedDatingQueue extends EventEmitter {
  private readonly redis: RedisLikeClient;
  private readonly sessionCapacity: number;
  private readonly connectCountdownMs: number;
  private readonly freeCancelWindowMs: number;
  private readonly lateCancelPenaltyMs: number;
  private readonly postCallCooldownMs: number;
  private readonly defaultAgeRadius: number;
  private readonly nowFn: NowFn;

  /** Theme filter – null means "no theme night active". */
  private themeNight: ThemeTag | null;

  /** Force-enabled happy-hour flag (overrides the wall-clock check). */
  private forceHappyHour: boolean;

  /** userId → metadata for quick lookup during pairing. */
  private readonly members = new Map<string, QueueMember>();

  /** proposalId → MatchProposal. */
  private readonly proposals = new Map<string, MatchProposal>();

  /** userId → proposalId (at most one active proposal per user). */
  private readonly userToProposal = new Map<string, string>();

  /** Outstanding proposal timers. */
  private readonly proposalTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** userId → UserCooldown. */
  private readonly cooldowns = new Map<string, UserCooldown>();

  /** Count of currently active (accepted & started) pair sessions. */
  private activePairs = 0;

  constructor(config: SpeedDatingQueueConfig = {}) {
    super();
    this.redis = config.redis ?? new InMemorySortedSetClient();
    this.sessionCapacity = config.sessionCapacity ?? SESSION_CAPACITY;
    this.connectCountdownMs = config.connectCountdownMs ?? CONNECT_COUNTDOWN_MS;
    this.freeCancelWindowMs = config.freeCancelWindowMs ?? FREE_CANCEL_WINDOW_MS;
    this.lateCancelPenaltyMs = config.lateCancelPenaltyMs ?? LATE_CANCEL_PENALTY_MS;
    this.postCallCooldownMs = config.postCallCooldownMs ?? POST_CALL_COOLDOWN_MS;
    this.defaultAgeRadius = config.ageRadiusYears ?? DEFAULT_AGE_RADIUS_YEARS;
    this.themeNight = config.themeNight ?? null;
    this.forceHappyHour = config.forceHappyHour ?? false;
    this.nowFn = config.nowFn ?? (() => Date.now());
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Enqueue a user.  Rejects if the user is already queued, currently
   * in a proposal, in an active call, or in cooldown.
   */
  async join(req: SpeedDatingJoinRequest): Promise<QueueMember> {
    this.validateJoin(req);
    const now = this.nowFn();

    if (this.members.has(req.userId)) {
      throw new Error(`user ${req.userId} is already in queue`);
    }
    if (this.userToProposal.has(req.userId)) {
      throw new Error(`user ${req.userId} has an active match proposal`);
    }
    const cooldown = this.cooldowns.get(req.userId);
    if (cooldown && cooldown.releaseAt > now) {
      throw new Error(
        `user ${req.userId} is in ${cooldown.reason} cooldown for ${cooldown.releaseAt - now}ms`
      );
    }

    const member: QueueMember = {
      userId: req.userId,
      age: req.age,
      gender: req.gender,
      preference: req.preference ?? 'any',
      themes: req.themes ?? [],
      ageRadiusYears: req.ageRadiusYears ?? this.defaultAgeRadius,
      enqueuedAt: now,
      location: req.location
    };
    this.members.set(req.userId, member);
    await Promise.resolve(this.redis.zadd(QUEUE_KEY, now, req.userId));
    this.emit('enqueued', member);
    // Opportunistically try to pair them up immediately.
    this.tryPairUser(member);
    return member;
  }

  /**
   * Remove a user from the queue before any pairing has occurred.
   * Returns true if the user was queued and is now removed.
   */
  async leave(userId: string): Promise<boolean> {
    const member = this.members.get(userId);
    if (!member) return false;
    this.members.delete(userId);
    await Promise.resolve(this.redis.zrem(QUEUE_KEY, userId));
    this.emit('left', member);
    return true;
  }

  /**
   * Cancel a proposed match before the call starts.  Applies the
   * late-cancel penalty when invoked after the free-cancel window.
   * Both participants receive a `match-cancelled` event.
   */
  cancelProposal(userId: string, reason: CancelReason = 'user-cancelled'): boolean {
    const proposalId = this.userToProposal.get(userId);
    if (!proposalId) return false;
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.cancelled) return false;

    const now = this.nowFn();
    const inFreeWindow = now <= proposal.freeCancelUntil;
    proposal.cancelled = true;
    this.teardownProposal(proposal, reason);

    if (!inFreeWindow && reason === 'user-cancelled') {
      this.setCooldown(userId, 'late-cancel', this.lateCancelPenaltyMs);
    }
    return true;
  }

  /**
   * Accept a proposed match on behalf of one user.  When both participants
   * have accepted, the proposal is promoted to an active pair and the
   * `match-accepted` / `match-started` events fire.
   */
  acceptProposal(userId: string): boolean {
    const proposalId = this.userToProposal.get(userId);
    if (!proposalId) return false;
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.cancelled) return false;

    if (proposal.a.userId === userId) proposal.accepted.a = true;
    else if (proposal.b.userId === userId) proposal.accepted.b = true;
    else return false;

    this.emit('acceptance-received', { proposalId, userId });
    if (proposal.accepted.a && proposal.accepted.b) {
      this.promoteProposal(proposal);
    }
    return true;
  }

  /**
   * Mark an active pair as complete (call ended naturally, disconnected,
   * voting done, etc.).  Both users are placed in post-call cooldown.
   */
  completePair(userIdA: string, userIdB: string): boolean {
    if (this.activePairs === 0) return false;
    this.activePairs = Math.max(0, this.activePairs - 1);
    this.setCooldown(userIdA, 'post-call', this.postCallCooldownMs);
    this.setCooldown(userIdB, 'post-call', this.postCallCooldownMs);
    this.emit('pair-completed', { userIdA, userIdB, activePairs: this.activePairs });
    return true;
  }

  /** Force-disconnect a user – removes them from queue or active proposal. */
  disconnect(userId: string): void {
    if (this.members.has(userId)) {
      void this.leave(userId);
      return;
    }
    if (this.userToProposal.has(userId)) {
      this.cancelProposal(userId, 'disconnect');
    }
  }

  /** Start or stop a Theme Night filter.  Pass `null` to stop. */
  setThemeNight(theme: ThemeTag | null): void {
    const previous = this.themeNight;
    this.themeNight = theme;
    this.emit('theme-night-changed', { previous, current: theme });
  }

  /** Manually force happy-hour on or off; pass `undefined` to revert. */
  setHappyHour(enabled: boolean): void {
    this.forceHappyHour = enabled;
    this.emit('happy-hour-changed', { enabled });
  }

  /** Returns true if we are currently inside the happy-hour window. */
  isHappyHour(): boolean {
    if (this.forceHappyHour) return true;
    const hour = new Date(this.nowFn()).getHours();
    return hour >= HAPPY_HOUR_START_HOUR && hour < HAPPY_HOUR_END_HOUR;
  }

  /** Current queue size (does not include active or proposal members). */
  queueSize(): number {
    return this.members.size;
  }

  /** Current count of active pair sessions on this instance. */
  activeSessionCount(): number {
    return this.activePairs;
  }

  /** Snapshot of the user's current state (for UI polling / debugging). */
  inspectUser(userId: string):
    | { state: 'queued'; member: QueueMember }
    | { state: 'proposed'; proposal: MatchProposal }
    | { state: 'cooldown'; cooldown: UserCooldown }
    | { state: 'idle' } {
    if (this.members.has(userId)) {
      return { state: 'queued', member: this.members.get(userId)! };
    }
    const proposalId = this.userToProposal.get(userId);
    if (proposalId) {
      return { state: 'proposed', proposal: this.proposals.get(proposalId)! };
    }
    const cd = this.cooldowns.get(userId);
    if (cd && cd.releaseAt > this.nowFn()) {
      return { state: 'cooldown', cooldown: cd };
    }
    return { state: 'idle' };
  }

  /** Estimate wait time (ms) for a newly-joining user. */
  estimateWaitMs(): number {
    const n = this.queueSize();
    if (n === 0) return 3_000; // baseline "someone might be coming"
    // Simple rule of thumb: ~5s per pair ahead of you, halved in happy-hour.
    const base = Math.ceil(n / 2) * 5_000;
    return this.isHappyHour() ? Math.round(base / 2) : base;
  }

  /** Testing hook – clear absolutely all state. */
  shutdown(reason: CancelReason = 'server-shutdown'): void {
    for (const proposalId of [...this.proposals.keys()]) {
      const p = this.proposals.get(proposalId);
      if (p) {
        p.cancelled = true;
        this.teardownProposal(p, reason);
      }
    }
    this.members.clear();
    this.cooldowns.clear();
    this.userToProposal.clear();
    this.proposalTimers.clear();
    this.activePairs = 0;
    this.emit('shutdown', { reason });
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private validateJoin(req: SpeedDatingJoinRequest): void {
    if (!req.userId || typeof req.userId !== 'string') {
      throw new Error('userId is required');
    }
    if (!Number.isFinite(req.age) || req.age < 18 || req.age > 120) {
      throw new Error('age must be between 18 and 120');
    }
    if (req.ageRadiusYears !== undefined && req.ageRadiusYears < 0) {
      throw new Error('ageRadiusYears must be non-negative');
    }
    if (req.themes && req.themes.length > 5) {
      throw new Error('a user may pick at most 5 themes');
    }
  }

  /**
   * Attempt to pair the given newly-joined user with another queued user.
   * Uses a single linear pass over the sorted-set snapshot – the queue is
   * at most a few hundred entries per instance so this is cheap.
   */
  private tryPairUser(member: QueueMember): void {
    if (this.activePairs + this.proposals.size >= this.sessionCapacity) {
      this.emit('capacity-full', { limit: this.sessionCapacity });
      return;
    }

    // Grab a snapshot ordered by longest waiting first.
    let order: string[];
    const range = this.redis.zrange(QUEUE_KEY, 0, -1);
    if (range instanceof Promise) {
      // We only support sync pairing – if the Redis client is async we
      // fall back to the local member map ordering.
      order = [...this.members.values()]
        .sort((a, b) => a.enqueuedAt - b.enqueuedAt)
        .map((m) => m.userId);
    } else {
      order = range;
    }

    for (const candidateId of order) {
      if (candidateId === member.userId) continue;
      const candidate = this.members.get(candidateId);
      if (!candidate) continue;
      if (!this.isCompatible(member, candidate)) continue;
      this.proposeMatch(candidate, member); // candidate waited longer → A
      return;
    }
  }

  /** Compatibility check: age radius, gender preference, theme night. */
  private isCompatible(a: QueueMember, b: QueueMember): boolean {
    if (a.userId === b.userId) return false;
    const ageDelta = Math.abs(a.age - b.age);
    const radius = Math.min(a.ageRadiusYears, b.ageRadiusYears);
    const effectiveRadius = this.isHappyHour()
      ? radius * HAPPY_HOUR_AGE_RADIUS_MULTIPLIER
      : radius;
    if (ageDelta > effectiveRadius) return false;
    if (!matchesPreference(a, b)) return false;
    if (!matchesPreference(b, a)) return false;
    if (this.themeNight) {
      if (!a.themes.includes(this.themeNight)) return false;
      if (!b.themes.includes(this.themeNight)) return false;
    }
    return true;
  }

  /** Promote two queued users into a MatchProposal awaiting acceptance. */
  private proposeMatch(a: QueueMember, b: QueueMember): void {
    // Remove from queue.
    this.members.delete(a.userId);
    this.members.delete(b.userId);
    void Promise.resolve(this.redis.zrem(QUEUE_KEY, a.userId));
    void Promise.resolve(this.redis.zrem(QUEUE_KEY, b.userId));

    const now = this.nowFn();
    const proposal: MatchProposal = {
      proposalId: randomUUID(),
      a,
      b,
      proposedAt: now,
      connectDeadline: now + this.connectCountdownMs,
      freeCancelUntil: now + this.freeCancelWindowMs,
      accepted: { a: false, b: false },
      cancelled: false
    };
    this.proposals.set(proposal.proposalId, proposal);
    this.userToProposal.set(a.userId, proposal.proposalId);
    this.userToProposal.set(b.userId, proposal.proposalId);

    const timer = setTimeout(() => this.handleProposalTimeout(proposal.proposalId), this.connectCountdownMs);
    // Allow the Node process to exit cleanly if nothing else is pending.
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
    this.proposalTimers.set(proposal.proposalId, timer);

    this.emit('match-proposed', proposal);
  }

  private handleProposalTimeout(proposalId: string): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.cancelled) return;
    // If both never accepted → auto-cancel with no penalty.
    proposal.cancelled = true;
    this.teardownProposal(proposal, 'timeout');
  }

  private promoteProposal(proposal: MatchProposal): void {
    // Clear proposal timer – call will run under SpeedCallManager's clock.
    const timer = this.proposalTimers.get(proposal.proposalId);
    if (timer) clearTimeout(timer);
    this.proposalTimers.delete(proposal.proposalId);

    this.proposals.delete(proposal.proposalId);
    this.userToProposal.delete(proposal.a.userId);
    this.userToProposal.delete(proposal.b.userId);

    this.activePairs += 1;
    this.emit('match-accepted', proposal);
    this.emit('match-started', {
      proposalId: proposal.proposalId,
      a: proposal.a,
      b: proposal.b,
      startedAt: this.nowFn()
    });
  }

  private teardownProposal(proposal: MatchProposal, reason: CancelReason): void {
    const timer = this.proposalTimers.get(proposal.proposalId);
    if (timer) clearTimeout(timer);
    this.proposalTimers.delete(proposal.proposalId);
    this.proposals.delete(proposal.proposalId);
    this.userToProposal.delete(proposal.a.userId);
    this.userToProposal.delete(proposal.b.userId);
    this.emit('match-cancelled', { proposal, reason });
  }

  private setCooldown(userId: string, reason: UserCooldown['reason'], ms: number): void {
    const releaseAt = this.nowFn() + ms;
    const cd: UserCooldown = { userId, releaseAt, reason };
    this.cooldowns.set(userId, cd);
    this.emit('cooldown-started', cd);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return true if `self`'s gender preference allows partnering with `other`.
 */
export function matchesPreference(self: QueueMember, other: QueueMember): boolean {
  if (self.preference === 'any') return true;
  if (!other.gender) return false;
  return other.gender === self.preference;
}
