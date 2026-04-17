/**
 * PostCallVoting – collects hearts/skips from both participants after a
 * SpeedCallManager call ends, detects mutual matches, and emits rich
 * events for the UI / notification / analytics layers.
 *
 * Spec (issue #25 §3):
 *  - 10-second voting window starts the moment the call ends.
 *  - Each user casts exactly one vote: `heart` (match) or `skip`.
 *  - Both hearts → instant chat room opened, confetti, match notification.
 *  - Mismatch (one heart, one skip) → the heart-sender gets a
 *    "They liked you!" FOMO notification on the other user.
 *  - All voting records are persisted via a pluggable `ChemistryStore` so
 *    the Chemistry AI model can train on outcomes.
 *
 * Design notes:
 *  - Voting ballots are one-shot per call; re-voting is rejected.
 *  - If the window times out and only one user voted, the non-voting user
 *    is treated as an implicit `skip` but we still record the voter's
 *    choice and deliver a FOMO notification if they hearted.
 *  - The service is deliberately light on its own state – it delegates to
 *    the store for anything long-lived.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { NowFn } from './SpeedDatingQueue';

// ─── Constants ────────────────────────────────────────────────────────────────

export const VOTING_WINDOW_MS = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type VoteChoice = 'heart' | 'skip';

export interface Vote {
  userId: string;
  choice: VoteChoice;
  castAt: number;
}

export interface BallotSnapshot {
  ballotId: string;
  callId: string;
  userA: string;
  userB: string;
  openedAt: number;
  closesAt: number;
  closed: boolean;
  votes: {
    a: Vote | null;
    b: Vote | null;
  };
  outcome: BallotOutcome | null;
}

/** The settled outcome of a voting round. */
export type BallotOutcomeKind =
  | 'mutual-match'
  | 'one-sided-a-liked-b'
  | 'one-sided-b-liked-a'
  | 'double-skip'
  | 'timeout-no-votes';

export interface BallotOutcome {
  kind: BallotOutcomeKind;
  settledAt: number;
  chatRoomId: string | null;
  matchScore: number;
}

/** Record of a completed ballot – written to the store. */
export interface ChemistryRecord {
  ballotId: string;
  callId: string;
  userA: string;
  userB: string;
  openedAt: number;
  closedAt: number;
  outcome: BallotOutcome;
  votes: Array<Pick<Vote, 'userId' | 'choice' | 'castAt'>>;
}

/** Pluggable persistence – in-memory by default. */
export interface ChemistryStore {
  save(record: ChemistryRecord): Promise<void> | void;
  load(callId: string): Promise<ChemistryRecord | null> | ChemistryRecord | null;
  count(): Promise<number> | number;
}

export class InMemoryChemistryStore implements ChemistryStore {
  private readonly records = new Map<string, ChemistryRecord>();

  save(record: ChemistryRecord): void {
    this.records.set(record.callId, record);
  }

  load(callId: string): ChemistryRecord | null {
    return this.records.get(callId) ?? null;
  }

  count(): number {
    return this.records.size;
  }

  list(): ChemistryRecord[] {
    return [...this.records.values()];
  }
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface PostCallVotingConfig {
  store?: ChemistryStore;
  votingWindowMs?: number;
  nowFn?: NowFn;
}

export interface OpenBallotArgs {
  callId: string;
  userA: string;
  userB: string;
  callDurationMs: number;
}

// ─── PostCallVoting ───────────────────────────────────────────────────────────

export class PostCallVoting extends EventEmitter {
  private readonly store: ChemistryStore;
  private readonly votingWindowMs: number;
  private readonly nowFn: NowFn;

  /** callId → ballot state. */
  private readonly ballots = new Map<string, BallotSnapshot>();
  /** userId → callId for fast lookup. */
  private readonly userBallotIndex = new Map<string, string>();
  /** callId → timeout handle. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The original call duration for outcome weighting. */
  private readonly callDurations = new Map<string, number>();

  constructor(config: PostCallVotingConfig = {}) {
    super();
    this.store = config.store ?? new InMemoryChemistryStore();
    this.votingWindowMs = config.votingWindowMs ?? VOTING_WINDOW_MS;
    this.nowFn = config.nowFn ?? (() => Date.now());
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Open a new voting ballot for a completed call. */
  openBallot(args: OpenBallotArgs): BallotSnapshot {
    if (this.ballots.has(args.callId)) {
      throw new Error(`ballot already open for call ${args.callId}`);
    }
    if (args.userA === args.userB) {
      throw new Error('ballot cannot have identical participants');
    }
    const now = this.nowFn();
    const ballot: BallotSnapshot = {
      ballotId: randomUUID(),
      callId: args.callId,
      userA: args.userA,
      userB: args.userB,
      openedAt: now,
      closesAt: now + this.votingWindowMs,
      closed: false,
      votes: { a: null, b: null },
      outcome: null
    };
    this.ballots.set(args.callId, ballot);
    this.userBallotIndex.set(args.userA, args.callId);
    this.userBallotIndex.set(args.userB, args.callId);
    this.callDurations.set(args.callId, Math.max(0, args.callDurationMs));

    const timer = setTimeout(() => this.close(args.callId, 'timeout'), this.votingWindowMs);
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
    this.timers.set(args.callId, timer);

    this.emit('ballot-opened', ballot);
    return ballot;
  }

  /**
   * Cast a vote.  Throws if the user is not part of an open ballot or has
   * already voted.  Returns the updated ballot snapshot.
   */
  vote(userId: string, choice: VoteChoice): BallotSnapshot {
    const callId = this.userBallotIndex.get(userId);
    if (!callId) throw new Error(`no open ballot for user ${userId}`);
    const ballot = this.ballots.get(callId);
    if (!ballot || ballot.closed) throw new Error(`ballot closed for user ${userId}`);

    const which: 'a' | 'b' = userId === ballot.userA ? 'a' : 'b';
    if (ballot.votes[which] != null) {
      throw new Error(`user ${userId} already voted`);
    }

    ballot.votes[which] = { userId, choice, castAt: this.nowFn() };
    this.emit('vote-cast', { ballot, userId, choice });

    if (ballot.votes.a && ballot.votes.b) {
      // Both voted – settle immediately.
      this.close(callId, 'both-voted');
    }
    return ballot;
  }

  /**
   * Explicit close triggered by timeout or "both-voted".  Idempotent.
   */
  close(callId: string, reason: 'timeout' | 'both-voted' | 'abandoned'): BallotSnapshot | null {
    const ballot = this.ballots.get(callId);
    if (!ballot || ballot.closed) return ballot ?? null;

    ballot.closed = true;
    const timer = this.timers.get(callId);
    if (timer) clearTimeout(timer);
    this.timers.delete(callId);

    const outcome = this.computeOutcome(ballot);
    ballot.outcome = outcome;

    this.userBallotIndex.delete(ballot.userA);
    this.userBallotIndex.delete(ballot.userB);
    this.ballots.delete(callId);

    this.emit('ballot-closed', { ballot, reason, outcome });

    if (outcome.kind === 'mutual-match') {
      this.emit('mutual-match', {
        ballot,
        chatRoomId: outcome.chatRoomId!,
        matchScore: outcome.matchScore
      });
    } else if (outcome.kind === 'one-sided-a-liked-b') {
      this.emit('fomo-notification', {
        ballot,
        notifyUserId: ballot.userB,
        fromUserId: ballot.userA
      });
    } else if (outcome.kind === 'one-sided-b-liked-a') {
      this.emit('fomo-notification', {
        ballot,
        notifyUserId: ballot.userA,
        fromUserId: ballot.userB
      });
    }

    // Persist for Chemistry model training.
    const record: ChemistryRecord = {
      ballotId: ballot.ballotId,
      callId: ballot.callId,
      userA: ballot.userA,
      userB: ballot.userB,
      openedAt: ballot.openedAt,
      closedAt: this.nowFn(),
      outcome,
      votes: [ballot.votes.a, ballot.votes.b]
        .filter((v): v is Vote => v != null)
        .map((v) => ({ userId: v.userId, choice: v.choice, castAt: v.castAt }))
    };
    void Promise.resolve(this.store.save(record));

    this.callDurations.delete(callId);
    return ballot;
  }

  /** Snapshot of a user's currently-open ballot, if any. */
  getBallotForUser(userId: string): BallotSnapshot | null {
    const callId = this.userBallotIndex.get(userId);
    if (!callId) return null;
    return this.ballots.get(callId) ?? null;
  }

  /** Number of currently-open ballots. */
  openBallotCount(): number {
    return this.ballots.size;
  }

  /** Underlying store – exposed for analytics dashboards. */
  getStore(): ChemistryStore {
    return this.store;
  }

  /** Testing / shutdown helper. */
  shutdown(): void {
    for (const callId of [...this.ballots.keys()]) {
      this.close(callId, 'abandoned');
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private computeOutcome(ballot: BallotSnapshot): BallotOutcome {
    const a = ballot.votes.a;
    const b = ballot.votes.b;
    const now = this.nowFn();
    const callDurationMs = this.callDurations.get(ballot.callId) ?? 0;

    // No votes at all.
    if (!a && !b) {
      return {
        kind: 'timeout-no-votes',
        settledAt: now,
        chatRoomId: null,
        matchScore: 0
      };
    }

    // Treat a missing vote as an implicit skip.
    const aChoice: VoteChoice = a?.choice ?? 'skip';
    const bChoice: VoteChoice = b?.choice ?? 'skip';

    if (aChoice === 'heart' && bChoice === 'heart') {
      return {
        kind: 'mutual-match',
        settledAt: now,
        chatRoomId: randomUUID(),
        matchScore: scoreMatch(a!, b!, callDurationMs)
      };
    }
    if (aChoice === 'heart' && bChoice === 'skip') {
      return { kind: 'one-sided-a-liked-b', settledAt: now, chatRoomId: null, matchScore: 0 };
    }
    if (aChoice === 'skip' && bChoice === 'heart') {
      return { kind: 'one-sided-b-liked-a', settledAt: now, chatRoomId: null, matchScore: 0 };
    }
    return { kind: 'double-skip', settledAt: now, chatRoomId: null, matchScore: 0 };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute a 0-1 chemistry score for a mutual match.  Factors in:
 *  - How quickly both users hearted (fast decisions = higher chemistry).
 *  - Whether both users used most of the 60-second call (longer call → higher).
 */
export function scoreMatch(a: Vote, b: Vote, callDurationMs: number): number {
  const decisionSpread = Math.abs(a.castAt - b.castAt);
  // Faster decisions are better, up to an 8-second cap.
  const decisionScore = Math.max(0, 1 - decisionSpread / 8_000);
  // Longer calls are better (up to 60s).
  const callScore = Math.min(1, callDurationMs / 60_000);
  return Math.round((0.6 * decisionScore + 0.4 * callScore) * 100) / 100;
}
