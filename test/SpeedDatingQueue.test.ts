import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SpeedDatingQueue,
  InMemorySortedSetClient,
  QUEUE_KEY,
  matchesPreference,
  type QueueMember
} from '../src/services/SpeedDatingQueue';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fake clock allowing deterministic tests. */
function fakeClock(start = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function makeQueue(overrides: Partial<ConstructorParameters<typeof SpeedDatingQueue>[0]> = {}): {
  q: SpeedDatingQueue;
  clock: ReturnType<typeof fakeClock>;
} {
  const clock = fakeClock();
  const q = new SpeedDatingQueue({ nowFn: clock.now, ...overrides });
  return { q, clock };
}

// ─── Join / Leave ─────────────────────────────────────────────────────────────

test('join adds a user and increases queueSize', async () => {
  const { q } = makeQueue();
  await q.join({ userId: 'u1', age: 25 });
  assert.equal(q.queueSize(), 1);
});

test('join rejects an age out of range', async () => {
  const { q } = makeQueue();
  await assert.rejects(() => q.join({ userId: 'u1', age: 10 }));
  await assert.rejects(() => q.join({ userId: 'u2', age: 200 }));
});

test('join rejects a duplicate userId', async () => {
  const { q } = makeQueue();
  await q.join({ userId: 'u1', age: 25 });
  await assert.rejects(() => q.join({ userId: 'u1', age: 26 }));
});

test('leave removes a queued user', async () => {
  const { q } = makeQueue();
  await q.join({ userId: 'u1', age: 25 });
  const left = await q.leave('u1');
  assert.equal(left, true);
  assert.equal(q.queueSize(), 0);
});

test('leave returns false for unknown user', async () => {
  const { q } = makeQueue();
  assert.equal(await q.leave('nobody'), false);
});

// ─── Pairing ──────────────────────────────────────────────────────────────────

test('joining a second compatible user proposes a match', async () => {
  const { q } = makeQueue();
  const proposed: unknown[] = [];
  q.on('match-proposed', (p) => proposed.push(p));
  await q.join({ userId: 'u1', age: 25 });
  await q.join({ userId: 'u2', age: 27 });
  assert.equal(proposed.length, 1);
  assert.equal(q.queueSize(), 0);
});

test('users outside the ±5 year radius are not paired', async () => {
  const { q } = makeQueue();
  await q.join({ userId: 'u1', age: 22 });
  await q.join({ userId: 'u2', age: 40 });
  assert.equal(q.queueSize(), 2);
});

test('gender preference is respected bidirectionally', async () => {
  const { q } = makeQueue();
  await q.join({ userId: 'u1', age: 25, gender: 'female', preference: 'female' });
  await q.join({ userId: 'u2', age: 25, gender: 'male', preference: 'any' });
  // u1 wants female only, u2 is male – incompatible.
  assert.equal(q.queueSize(), 2);
});

test('theme-night pairing filters out users missing the theme', async () => {
  const { q } = makeQueue({ themeNight: 'music' });
  await q.join({ userId: 'u1', age: 25, themes: ['music', 'tech'] });
  await q.join({ userId: 'u2', age: 25, themes: ['travel'] });
  assert.equal(q.queueSize(), 2);

  await q.join({ userId: 'u3', age: 25, themes: ['music'] });
  // u1 and u3 should now pair.
  assert.equal(q.queueSize(), 1);
});

test('happy hour doubles the age radius', async () => {
  const { q } = makeQueue({ forceHappyHour: true });
  await q.join({ userId: 'u1', age: 25 });
  await q.join({ userId: 'u2', age: 33 }); // 8-year delta, inside 10-year expanded radius
  assert.equal(q.queueSize(), 0);
});

// ─── Proposal lifecycle ──────────────────────────────────────────────────────

test('cancelProposal within free window imposes no cooldown', async () => {
  const { q, clock } = makeQueue();
  let proposalId: string | null = null;
  q.on('match-proposed', (p) => { proposalId = p.proposalId; });
  await q.join({ userId: 'u1', age: 25 });
  await q.join({ userId: 'u2', age: 25 });
  assert.ok(proposalId);

  clock.advance(2_000); // inside 5s free window
  const ok = q.cancelProposal('u1');
  assert.equal(ok, true);
  const state = q.inspectUser('u1');
  assert.equal(state.state, 'idle');
});

test('cancelProposal after free window triggers late-cancel cooldown', async () => {
  const { q, clock } = makeQueue();
  await q.join({ userId: 'u1', age: 25 });
  await q.join({ userId: 'u2', age: 25 });
  clock.advance(6_000); // outside 5s free window
  const ok = q.cancelProposal('u1');
  assert.equal(ok, true);
  const state = q.inspectUser('u1');
  assert.equal(state.state, 'cooldown');
});

test('acceptProposal from both sides starts the match', async () => {
  const { q } = makeQueue();
  const started: unknown[] = [];
  q.on('match-started', (e) => started.push(e));
  await q.join({ userId: 'u1', age: 25 });
  await q.join({ userId: 'u2', age: 25 });
  assert.equal(q.acceptProposal('u1'), true);
  assert.equal(started.length, 0, 'should not start until both accept');
  assert.equal(q.acceptProposal('u2'), true);
  assert.equal(started.length, 1);
  assert.equal(q.activeSessionCount(), 1);
});

test('proposal timeout fires and cancels both users', async () => {
  const { q, clock } = makeQueue({ connectCountdownMs: 50 });
  let cancelled = 0;
  q.on('match-cancelled', () => { cancelled += 1; });
  await q.join({ userId: 'u1', age: 25 });
  await q.join({ userId: 'u2', age: 25 });
  await new Promise((r) => setTimeout(r, 120));
  clock.advance(120);
  assert.equal(cancelled, 1);
});

// ─── Cooldown ─────────────────────────────────────────────────────────────────

test('completePair sets a 30-second cooldown on both users', async () => {
  const { q, clock } = makeQueue();
  await q.join({ userId: 'u1', age: 25 });
  await q.join({ userId: 'u2', age: 25 });
  q.acceptProposal('u1');
  q.acceptProposal('u2');
  q.completePair('u1', 'u2');
  assert.equal(q.inspectUser('u1').state, 'cooldown');
  clock.advance(30_001);
  assert.equal(q.inspectUser('u1').state, 'idle');
});

test('join is rejected for a user currently in cooldown', async () => {
  const { q } = makeQueue({ postCallCooldownMs: 100 });
  await q.join({ userId: 'u1', age: 25 });
  await q.join({ userId: 'u2', age: 25 });
  q.acceptProposal('u1');
  q.acceptProposal('u2');
  q.completePair('u1', 'u2');
  await assert.rejects(() => q.join({ userId: 'u1', age: 25 }));
});

// ─── Capacity ─────────────────────────────────────────────────────────────────

test('pairings stop once sessionCapacity is reached', async () => {
  const { q } = makeQueue({ sessionCapacity: 1 });
  await q.join({ userId: 'u1', age: 25 });
  await q.join({ userId: 'u2', age: 25 });
  assert.equal(q.activeSessionCount() + 0, 0, 'proposal counts, not yet active');
  let hit = false;
  q.on('capacity-full', () => { hit = true; });
  await q.join({ userId: 'u3', age: 25 });
  await q.join({ userId: 'u4', age: 25 });
  assert.equal(hit, true);
});

// ─── Misc / helpers ──────────────────────────────────────────────────────────

test('matchesPreference handles "any" and explicit genders', () => {
  const a: QueueMember = {
    userId: 'a', age: 25, preference: 'any', themes: [], ageRadiusYears: 5, enqueuedAt: 0
  };
  const b: QueueMember = {
    userId: 'b', age: 25, gender: 'male', preference: 'female', themes: [], ageRadiusYears: 5, enqueuedAt: 0
  };
  assert.equal(matchesPreference(a, b), true);
  assert.equal(matchesPreference(b, a), false); // b wants female, a has no gender
});

test('InMemorySortedSetClient supports zadd/zrange/zrem/zcard', () => {
  const c = new InMemorySortedSetClient();
  c.zadd('k', 100, 'x');
  c.zadd('k', 50, 'y');
  assert.deepEqual(c.zrange('k', 0, -1), ['y', 'x']);
  assert.equal(c.zcard('k'), 2);
  c.zrem('k', 'y');
  assert.deepEqual(c.zrange('k', 0, -1), ['x']);
  assert.equal(c.exists('k'), 1);
});

test('estimateWaitMs halves during happy hour', async () => {
  const { q } = makeQueue();
  for (let i = 0; i < 10; i++) {
    await q.join({ userId: `u${i}`, age: 25, preference: 'nonbinary' });
  }
  const normal = q.estimateWaitMs();
  q.setHappyHour(true);
  const happy = q.estimateWaitMs();
  assert.ok(happy < normal);
});

test('shutdown clears all state', async () => {
  const { q } = makeQueue();
  await q.join({ userId: 'u1', age: 25 });
  await q.join({ userId: 'u2', age: 25 });
  q.shutdown();
  assert.equal(q.queueSize(), 0);
  assert.equal(q.activeSessionCount(), 0);
});

test('QUEUE_KEY is a non-empty string constant', () => {
  assert.equal(typeof QUEUE_KEY, 'string');
  assert.ok(QUEUE_KEY.length > 0);
});
