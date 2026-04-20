export interface LatentProfile {
  userId: string;
  latentVector: number[];
  region?: string;
  age?: number;
  demographicTags?: string[];
}

export interface DiscoveryFilter {
  regions?: string[];
  ageRange?: { min: number; max: number };
  demographicTags?: string[];
}

export interface SerendipityOptions {
  minCompatibility?: number;
  outOfPatternWeight?: number;
}

export interface RareConnection {
  candidate: LatentProfile;
  compatibility: number;
  rarityBoost: number;
  score: number;
  isOutsideUsualFilters: boolean;
  label: 'Rare Connection';
  reasons: string[];
}

const DEFAULTS: Required<SerendipityOptions> = {
  minCompatibility: 0.7,
  outOfPatternWeight: 0.25
};

export class SerendipityAlgorithm {
  private readonly options: Required<SerendipityOptions>;

  constructor(options: SerendipityOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  rankRareConnections(
    user: LatentProfile,
    candidates: LatentProfile[],
    usualFilter: DiscoveryFilter
  ): RareConnection[] {
    return candidates
      .filter((candidate) => candidate.userId !== user.userId)
      .map((candidate) => {
        const compatibility = cosineSimilarity(user.latentVector, candidate.latentVector);
        const rarity = this.computeRarityBoost(candidate, usualFilter);
        const score = compatibility * (1 - this.options.outOfPatternWeight) + rarity * this.options.outOfPatternWeight;
        const reasons = summarizeReasons(candidate, usualFilter, compatibility);
        return {
          candidate,
          compatibility: round4(compatibility),
          rarityBoost: round4(rarity),
          score: round4(score),
          isOutsideUsualFilters: rarity > 0,
          label: 'Rare Connection' as const,
          reasons
        };
      })
      .filter((result) => result.compatibility >= this.options.minCompatibility && result.isOutsideUsualFilters)
      .sort((left, right) => right.score - left.score);
  }

  private computeRarityBoost(candidate: LatentProfile, filter: DiscoveryFilter): number {
    let checks = 0;
    let outside = 0;

    if (filter.regions && filter.regions.length > 0) {
      checks += 1;
      if (candidate.region && !filter.regions.includes(candidate.region)) {
        outside += 1;
      }
    }

    if (filter.ageRange) {
      checks += 1;
      if (candidate.age !== undefined && (candidate.age < filter.ageRange.min || candidate.age > filter.ageRange.max)) {
        outside += 1;
      }
    }

    if (filter.demographicTags && filter.demographicTags.length > 0) {
      checks += 1;
      const tags = candidate.demographicTags ?? [];
      if (!tags.some((tag) => filter.demographicTags!.includes(tag))) {
        outside += 1;
      }
    }

    if (checks === 0) return 0;
    return outside / checks;
  }
}

/**
 * Computes cosine similarity between two latent feature vectors.
 * Inputs are numeric vectors (possibly with different lengths); comparison
 * uses the shared prefix length. Returns a normalized score in [0, 1].
 */
function cosineSimilarity(left: number[], right: number[]): number {
  const dimension = Math.min(left.length, right.length);
  if (dimension === 0) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < dimension; index += 1) {
    const l = left[index]!;
    const r = right[index]!;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))));
}

function summarizeReasons(
  candidate: LatentProfile,
  filter: DiscoveryFilter,
  compatibility: number
): string[] {
  const reasons: string[] = [`latent compatibility ${Math.round(compatibility * 100)}%`];

  if (filter.regions && filter.regions.length > 0 && candidate.region && !filter.regions.includes(candidate.region)) {
    reasons.push(`outside preferred region (${candidate.region})`);
  }
  if (filter.ageRange && candidate.age !== undefined && (candidate.age < filter.ageRange.min || candidate.age > filter.ageRange.max)) {
    reasons.push(`outside preferred age range (${candidate.age})`);
  }
  if (filter.demographicTags && filter.demographicTags.length > 0) {
    const tags = candidate.demographicTags ?? [];
    if (!tags.some((tag) => filter.demographicTags!.includes(tag))) {
      reasons.push('outside preferred demographic tags');
    }
  }

  return reasons;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}
