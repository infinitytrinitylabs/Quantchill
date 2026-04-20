import test from 'node:test';
import assert from 'node:assert/strict';
import { LullDetector } from '../src/services/LullDetector';

test('LullDetector emits a high-resonance notification during low-engagement lull', () => {
  let now = 0;
  const detector = new LullDetector({}, () => now);

  const userId = 'u-lull';
  let lastEvaluation = detector.evaluate(userId, now);
  for (const engagement of [58, 44, 36, 28]) {
    now += 60_000;
    lastEvaluation = detector.ingest(userId, {
      timestampMs: now,
      engagementScore: engagement,
      interactionsPerMinute: 0.7
    });
  }

  assert.equal(lastEvaluation.isLull, true);
  assert.equal(lastEvaluation.reason, 'low-engagement');
  assert.equal(lastEvaluation.shouldNotify, true);
  assert.equal(lastEvaluation.notification?.type, 'high-resonance');
});

test('LullDetector respects notification cooldown', () => {
  let now = 0;
  const detector = new LullDetector({ notificationCooldownMs: 30 * 60_000 }, () => now);
  const userId = 'u-cooldown';

  let first = detector.evaluate(userId, now);
  for (const engagement of [60, 49, 39, 31]) {
    now += 60_000;
    first = detector.ingest(userId, {
      timestampMs: now,
      engagementScore: engagement,
      interactionsPerMinute: 0.4
    });
  }

  assert.equal(first.shouldNotify, true);

  const second = detector.evaluate(userId, now + 5 * 60_000);
  assert.equal(second.isLull, true);
  assert.equal(second.shouldNotify, false);
});

test('LullDetector flags sharp engagement dips even before low absolute engagement', () => {
  let now = 0;
  const detector = new LullDetector({ dipThresholdPerMinute: 5 }, () => now);
  const userId = 'u-dip';

  for (const engagement of [90, 80, 70, 58]) {
    now += 60_000;
    detector.ingest(userId, {
      timestampMs: now,
      engagementScore: engagement,
      interactionsPerMinute: 2
    });
  }

  const evaluation = detector.evaluate(userId, now);
  assert.equal(evaluation.isLull, true);
  assert.equal(evaluation.reason, 'engagement-dip');
});
