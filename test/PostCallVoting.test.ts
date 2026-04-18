import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PostCallVoting,
  InMemoryChemistryStore,
  scoreMatch,
  type BallotSnapshot
} from '../src/services/PostCallVoting';

function fakeClock(start = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function open(): { v: PostCallVoting; ballot: BallotSnapshot; store: InMemoryChemistryStore; clock: ReturnType<typeof fakeClock> } {
  const store = new InMemoryChemistryStore();
  const clock = fakeClock();
  const v = new PostCallVoting({ store, nowFn: clock.now });
  const ballot = v.openBallot({ callId: 'call1', userA: 'a', userB: 'b', callDurationMs: 60_000 });
  return { v, ballot, store, clock };
}

test('openBallot creates a ballot scoped to two users', () => {
  const { v, ballot } = open();
  assert.equal(ballot.userA, 'a');
  assert.equal(ballot.userB, 'b');
  assert.equal(v.openBallotCount(), 1);
});

test('openBallot rejects duplicate callId and identical users', () => {
  const { v } = open();
  assert.throws(() => v.openBallot({ callId: 'call1', userA: 'a', userB: 'b', callDurationMs: 60_000 }));
  assert.throws(() => v.openBallot({ callId: 'call2', userA: 'x', userB: 'x', callDurationMs: 60_000 }));
});

test('both hearts → mutual-match, chatRoomId, persisted', () => {
  const { v, store } = open();
  let mutual: unknown = null;
  v.on('mutual-match', (e) => { mutual = e; });
  v.vote('a', 'heart');
  v.vote('b', 'heart');
  assert.ok(mutual);
  assert.equal(store.count(), 1);
  const record = store.load('call1')!;
  assert.equal(record.outcome.kind, 'mutual-match');
  assert.ok(record.outcome.chatRoomId);
});

test('heart + skip produces a FOMO notification to the skip-caster', () => {
  const { v } = open();
  let fomo: { notifyUserId: string; fromUserId: string } | null = null;
  v.on('fomo-notification', (e) => { fomo = e; });
  v.vote('a', 'heart');
  v.vote('b', 'skip');
  assert.ok(fomo);
  assert.equal(fomo!.notifyUserId, 'b');
  assert.equal(fomo!.fromUserId, 'a');
});

test('double skip produces no match and no FOMO', () => {
  const { v, store } = open();
  let fomo = false;
  v.on('fomo-notification', () => { fomo = true; });
  v.vote('a', 'skip');
  v.vote('b', 'skip');
  assert.equal(fomo, false);
  assert.equal(store.load('call1')!.outcome.kind, 'double-skip');
});

test('timeout with no votes closes with timeout-no-votes outcome', async () => {
  const store = new InMemoryChemistryStore();
  const v = new PostCallVoting({ store, votingWindowMs: 30 });
  v.openBallot({ callId: 'c', userA: 'a', userB: 'b', callDurationMs: 60_000 });
  await new Promise((r) => setTimeout(r, 70));
  const rec = store.load('c');
  assert.ok(rec);
  assert.equal(rec!.outcome.kind, 'timeout-no-votes');
});

test('timeout with one heart still emits FOMO for the absent voter', async () => {
  const store = new InMemoryChemistryStore();
  const v = new PostCallVoting({ store, votingWindowMs: 30 });
  v.openBallot({ callId: 'c', userA: 'a', userB: 'b', callDurationMs: 60_000 });
  let fomo = false;
  v.on('fomo-notification', () => { fomo = true; });
  v.vote('a', 'heart');
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(fomo, true);
});

test('re-voting the same ballot throws', () => {
  const { v } = open();
  v.vote('a', 'heart');
  assert.throws(() => v.vote('a', 'skip'));
});

test('voting after close throws', () => {
  const { v } = open();
  v.close('call1', 'abandoned');
  assert.throws(() => v.vote('a', 'heart'));
});

test('shutdown closes all ballots as abandoned', () => {
  const { v, store } = open();
  v.shutdown();
  assert.equal(store.count(), 1);
});

test('scoreMatch rewards fast decisions and long calls', () => {
  const a = { userId: 'a', choice: 'heart' as const, castAt: 1000 };
  const b = { userId: 'b', choice: 'heart' as const, castAt: 1200 };
  const fast = scoreMatch(a, b, 60_000);
  const slow = scoreMatch(a, { ...b, castAt: 10_000 }, 60_000);
  const short = scoreMatch(a, b, 10_000);
  assert.ok(fast > slow);
  assert.ok(fast > short);
  assert.ok(fast <= 1);
  assert.ok(short >= 0);
});

test('getBallotForUser returns current or null', () => {
  const { v } = open();
  assert.ok(v.getBallotForUser('a'));
  v.close('call1', 'abandoned');
  assert.equal(v.getBallotForUser('a'), null);
});

test('matchScore > 0 only for mutual-match', () => {
  const { v, store } = open();
  v.vote('a', 'heart');
  v.vote('b', 'skip');
  assert.equal(store.load('call1')!.outcome.matchScore, 0);
});
