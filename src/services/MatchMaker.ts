export interface InterestGraph {
  [interest: string]: number;
}

export interface UserProfile {
  id: string;
  interestGraph: InterestGraph;
}

export interface BCIContext {
  eyeTrackingFocus: number;
  engagementScore: number;
  dopamineIndex?: number;
}

export interface MatchResult {
  candidate: UserProfile;
  score: number;
  shouldTransitionLoop: boolean;
}

export class MatchMaker {
  constructor(private readonly lowEngagementThreshold = 40) {}

  rankCandidates(user: UserProfile, candidates: UserProfile[], context: BCIContext): MatchResult[] {
    return candidates
      .filter((candidate) => candidate.id !== user.id)
      .map((candidate) => ({
        candidate,
        score: this.calculateCompatibility(user.interestGraph, candidate.interestGraph, context),
        shouldTransitionLoop: this.shouldTransitionLoop(context)
      }))
      .sort((a, b) => b.score - a.score);
  }

  shouldTransitionLoop(context: BCIContext): boolean {
    return context.engagementScore < this.lowEngagementThreshold;
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
