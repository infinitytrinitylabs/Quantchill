import { MoodName } from './MoodEngine';

/** Maximum free-tier session duration in seconds (60 minutes). */
export const FREE_TIER_LIMIT_SECONDS = 3600;

export interface SessionState {
  sessionId: string;
  userId: string;
  mood: MoodName;
  startedAt: number;     // Unix ms
  sessionTime: number;   // cumulative seconds
  isPremium: boolean;
  paywallShown: boolean;
  quantchatSynced: boolean;
  quantchatPartyId?: string;
}

export interface PaywallTrigger {
  triggered: true;
  message: string;
  offerMonthlyPrice: number;
  sessionTime: number;
}

export interface QuantchatSyncResult {
  partyId: string;
  mood: MoodName;
  inviteUrl: string;
  syncedAt: number;
}

export class SessionTracker {
  private readonly sessions = new Map<string, SessionState>();
  private readonly SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
  private lastCleanupMs = 0;
  private readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Create and register a new listening/watching session.
   * Returns the initial `SessionState`.
   */
  createSession(params: {
    sessionId: string;
    userId: string;
    mood: MoodName;
    isPremium: boolean;
  }): SessionState {
    // Periodic cleanup of stale sessions
    this.maybeCleanupStaleSessions();

    const state: SessionState = {
      sessionId: params.sessionId,
      userId: params.userId,
      mood: params.mood,
      startedAt: Date.now(),
      sessionTime: 0,
      isPremium: params.isPremium,
      paywallShown: false,
      quantchatSynced: false
    };
    this.sessions.set(params.sessionId, state);
    return state;
  }

  /**
   * Advance the session clock by `deltaSeconds`.
   * Returns a `PaywallTrigger` when a non-premium user exceeds the free
   * limit and the paywall has not yet been shown; otherwise returns `null`.
   */
  tick(sessionId: string, deltaSeconds: number): PaywallTrigger | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;

    state.sessionTime += deltaSeconds;

    if (!state.isPremium && !state.paywallShown && state.sessionTime >= FREE_TIER_LIMIT_SECONDS) {
      state.paywallShown = true;
      return {
        triggered: true,
        message: 'Unlock Spatial Audio & 8K Generative Visuals with Quantchill Premium',
        offerMonthlyPrice: 12,
        sessionTime: state.sessionTime
      };
    }

    return null;
  }

  /**
   * Mock a "Sync with Quantchat" action.
   * Generates a party invite URL and marks the session as synced.
   * Returns a `QuantchatSyncResult` with the generated party details.
   */
  syncWithQuantchat(sessionId: string): QuantchatSyncResult {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const partyId = `party-${sessionId.slice(0, 8)}-${Date.now().toString(36)}`;
    state.quantchatSynced = true;
    state.quantchatPartyId = partyId;

    return {
      partyId,
      mood: state.mood,
      inviteUrl: `/quantchat/join/${partyId}`,
      syncedAt: Date.now()
    };
  }

  /** End a session and return the final state snapshot. */
  endSession(sessionId: string): SessionState | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    this.sessions.delete(sessionId);
    return { ...state };
  }

  /** Look up the current state of a session without mutating it. */
  getSession(sessionId: string): SessionState | null {
    const state = this.sessions.get(sessionId);
    return state ? { ...state } : null;
  }

  /**
   * Clean up stale sessions that haven't been accessed in SESSION_MAX_AGE_MS.
   * Called periodically to prevent memory leaks.
   */
  private maybeCleanupStaleSessions(): void {
    const now = Date.now();
    if (now - this.lastCleanupMs < this.CLEANUP_INTERVAL_MS) {
      return;
    }

    this.lastCleanupMs = now;
    const cutoff = now - this.SESSION_MAX_AGE_MS;

    for (const [sessionId, state] of this.sessions.entries()) {
      if (state.startedAt < cutoff) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
