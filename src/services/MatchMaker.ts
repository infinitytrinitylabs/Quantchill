export interface InterestGraph {
  [interest: string]: number;
}

export interface UserProfile {
  id: string;
  interestGraph: InterestGraph;
  quantsinkFeed?: {
    feedId: string;
    isVip: boolean;
  };
}

export interface BCIContext {
  eyeTrackingFocus: number;
  engagementScore: number;
  dopamineIndex?: number;
  attentionDecay?: number;
}

export interface MatchResult {
  candidate: UserProfile;
  score: number;
  shouldTransitionLoop: boolean;
}

export interface QuantsinkHook {
  mode: 'standard' | 'priority-feed';
  reason: 'interest-match' | 'attention-decay';
  attentionDecay: number | null;
  targetUserId?: string;
  targetFeedId?: string;
  usedCachedFeed: boolean;
}

export interface MatchResponse {
  candidates: MatchResult[];
  shouldTransitionLoop: boolean;
  quantsinkHook: QuantsinkHook;
}

export class MatchMaker {
  constructor(private readonly lowEngagementThreshold = 40, private readonly attentionDecayThreshold = 0.3) {}

  rankCandidates(user: UserProfile, candidates: UserProfile[], context: BCIContext): MatchResult[] {
    const prioritizeVip = this.shouldEscalateToPriorityFeed(context);

    return candidates
      .filter((candidate) => candidate.id !== user.id)
      .map((candidate) => ({
        candidate,
        score: this.calculateCompatibility(user.interestGraph, candidate.interestGraph, context),
        shouldTransitionLoop: this.shouldTransitionLoop(context)
      }))
      .sort((a, b) => {
        if (prioritizeVip) {
          const aVip = a.candidate.quantsinkFeed?.isVip === true;
          const bVip = b.candidate.quantsinkFeed?.isVip === true;

          if (aVip !== bVip) {
            return aVip ? -1 : 1;
          }
        }

        return b.score - a.score;
      });
  }

  createMatchResponse(user: UserProfile, candidates: UserProfile[], context: BCIContext): MatchResponse {
    const rankedCandidates = this.rankCandidates(user, candidates, context);
    const priorityCandidate = this.shouldEscalateToPriorityFeed(context)
      ? rankedCandidates.find((result) => result.candidate.quantsinkFeed?.isVip)
      : undefined;

    return {
      candidates: rankedCandidates,
      shouldTransitionLoop: this.shouldTransitionLoop(context),
      quantsinkHook: priorityCandidate
        ? {
            mode: 'priority-feed',
            reason: 'attention-decay',
            attentionDecay: context.attentionDecay ?? null,
            targetUserId: priorityCandidate.candidate.id,
            targetFeedId: priorityCandidate.candidate.quantsinkFeed?.feedId,
            usedCachedFeed: true
          }
        : {
            mode: 'standard',
            reason: 'interest-match',
            attentionDecay: context.attentionDecay ?? null,
            usedCachedFeed: false
          }
    };
  }

  shouldTransitionLoop(context: BCIContext): boolean {
    return context.engagementScore < this.lowEngagementThreshold || this.shouldEscalateToPriorityFeed(context);
  }

  shouldEscalateToPriorityFeed(context: BCIContext): boolean {
    return (context.attentionDecay ?? 1) < this.attentionDecayThreshold;
  }

  private calculateCompatibility(
    source: InterestGraph,
    target: InterestGraph,
    context: BCIContext
  ): number {
    const keys = new Set([...Object.keys(source), ...Object.keys(target)]);
    let overlapScore = 0;
    let totalWeight = 0;

    for (const key of keys) {
      const left = Math.max(0, source[key] ?? 0);
      const right = Math.max(0, target[key] ?? 0);

      overlapScore += Math.min(left, right);
      totalWeight += Math.max(left, right);
    }

    const graphSimilarity = totalWeight === 0 ? 0 : (overlapScore / totalWeight) * 100;
    const focusBoost = Math.min(1, Math.max(0, context.eyeTrackingFocus / 100)) * 15;
    const dopamineBoost = Math.min(1, Math.max(0, (context.dopamineIndex ?? 50) / 100)) * 10;

    return Number((graphSimilarity + focusBoost + dopamineBoost).toFixed(2));
  }
}
