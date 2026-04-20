export interface ActivitySample {
  timestampMs: number;
  engagementScore: number;
  interactionsPerMinute: number;
}

export interface LullDetectorOptions {
  historyWindowMs?: number;
  minSamples?: number;
  lowEngagementThreshold?: number;
  lowActivityThreshold?: number;
  dipThresholdPerMinute?: number;
  notificationCooldownMs?: number;
}

export interface HighResonanceNotification {
  type: 'high-resonance';
  title: string;
  message: string;
  triggeredAtMs: number;
}

export interface LullState {
  isLull: boolean;
  reason: 'stable' | 'low-engagement' | 'engagement-dip' | 'low-activity';
  averageEngagement: number;
  averageActivity: number;
  dipPerMinute: number;
}

export interface LullEvaluation extends LullState {
  shouldNotify: boolean;
  notification: HighResonanceNotification | null;
}

const DEFAULTS: Required<LullDetectorOptions> = {
  historyWindowMs: 15 * 60 * 1000,
  minSamples: 4,
  lowEngagementThreshold: 42,
  lowActivityThreshold: 0.6,
  dipThresholdPerMinute: 8,
  notificationCooldownMs: 45 * 60 * 1000
};

export class LullDetector {
  private readonly options: Required<LullDetectorOptions>;
  private readonly samplesByUser = new Map<string, ActivitySample[]>();
  private readonly lastNotificationMs = new Map<string, number>();

  constructor(
    options: LullDetectorOptions = {},
    private readonly now: () => number = () => Date.now()
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  ingest(userId: string, sample: ActivitySample): LullEvaluation {
    const samples = this.getSamples(userId);
    samples.push({
      timestampMs: sample.timestampMs,
      engagementScore: clamp(sample.engagementScore, 0, 100),
      interactionsPerMinute: Math.max(0, sample.interactionsPerMinute)
    });
    this.prune(samples, sample.timestampMs);
    return this.evaluate(userId, sample.timestampMs);
  }

  evaluate(userId: string, nowMs = this.now()): LullEvaluation {
    const samples = this.getSamples(userId);
    this.prune(samples, nowMs);
    const state = this.computeState(samples);
    const shouldNotify = state.isLull && this.canNotify(userId, nowMs);
    let notification: HighResonanceNotification | null = null;
    if (shouldNotify && state.reason !== 'stable') {
      notification = this.createNotification(nowMs, state.reason);
    }

    if (shouldNotify) {
      this.lastNotificationMs.set(userId, nowMs);
    }

    return { ...state, shouldNotify, notification };
  }

  private computeState(samples: ActivitySample[]): LullState {
    if (samples.length < this.options.minSamples) {
      return {
        isLull: false,
        reason: 'stable',
        averageEngagement: 0,
        averageActivity: 0,
        dipPerMinute: 0
      };
    }

    const averageEngagement = mean(samples.map((sample) => sample.engagementScore));
    const averageActivity = mean(samples.map((sample) => sample.interactionsPerMinute));
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    const elapsedMinutes = Math.max(1 / 60, (last.timestampMs - first.timestampMs) / 60000);
    const dipPerMinute = (first.engagementScore - last.engagementScore) / elapsedMinutes;

    if (averageEngagement <= this.options.lowEngagementThreshold) {
      return {
        isLull: true,
        reason: 'low-engagement',
        averageEngagement: round2(averageEngagement),
        averageActivity: round2(averageActivity),
        dipPerMinute: round2(dipPerMinute)
      };
    }

    if (averageActivity <= this.options.lowActivityThreshold) {
      return {
        isLull: true,
        reason: 'low-activity',
        averageEngagement: round2(averageEngagement),
        averageActivity: round2(averageActivity),
        dipPerMinute: round2(dipPerMinute)
      };
    }

    if (dipPerMinute >= this.options.dipThresholdPerMinute) {
      return {
        isLull: true,
        reason: 'engagement-dip',
        averageEngagement: round2(averageEngagement),
        averageActivity: round2(averageActivity),
        dipPerMinute: round2(dipPerMinute)
      };
    }

    return {
      isLull: false,
      reason: 'stable',
      averageEngagement: round2(averageEngagement),
      averageActivity: round2(averageActivity),
      dipPerMinute: round2(dipPerMinute)
    };
  }

  private canNotify(userId: string, nowMs: number): boolean {
    const last = this.lastNotificationMs.get(userId);
    if (last === undefined) return true;
    return nowMs - last >= this.options.notificationCooldownMs;
  }

  private createNotification(
    nowMs: number,
    reason: Exclude<LullState['reason'], 'stable'>
  ): HighResonanceNotification {
    const reasonText =
      reason === 'low-engagement'
        ? 'Your vibe signal is quieter than usual.'
        : reason === 'engagement-dip'
        ? 'Your engagement curve dipped just now.'
        : 'Activity is in a calm window.';

    return {
      type: 'high-resonance',
      title: 'High Resonance Window',
      message: `${reasonText} We found a Rare Connection for this moment.`,
      triggeredAtMs: nowMs
    };
  }

  private getSamples(userId: string): ActivitySample[] {
    const existing = this.samplesByUser.get(userId);
    if (existing) return existing;
    const created: ActivitySample[] = [];
    this.samplesByUser.set(userId, created);
    return created;
  }

  private prune(samples: ActivitySample[], nowMs: number): void {
    const cutoff = nowMs - this.options.historyWindowMs;
    let firstValidIndex = 0;
    while (firstValidIndex < samples.length && samples[firstValidIndex]!.timestampMs < cutoff) {
      firstValidIndex += 1;
    }
    if (firstValidIndex > 0) {
      samples.splice(0, firstValidIndex);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}
