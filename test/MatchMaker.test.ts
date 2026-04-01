import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchMaker, UserProfile, SwipeAction } from '../src/services/MatchMaker';

test('MatchMaker ranks candidates by interest graph compatibility', () => {
  const matchMaker = new MatchMaker();
  const user: UserProfile = {
    id: 'u1',
    interestGraph: { music: 100, travel: 80, movies: 40 }
  };

  const candidates: UserProfile[] = [
    { id: 'u2', interestGraph: { music: 100, travel: 75, movies: 35 } },
    { id: 'u3', interestGraph: { gaming: 90, coding: 70 } }
  ];

  const ranked = matchMaker.rankCandidates(user, candidates, {
    eyeTrackingFocus: 80,
    engagementScore: 85,
    dopamineIndex: 65
  });

  assert.equal(ranked[0]?.candidate.id, 'u2');
  assert.ok(ranked[0]!.score > ranked[1]!.score);
  assert.equal(ranked[0]?.shouldTransitionLoop, false);
});

test('MatchMaker triggers instant loop transition for low engagement', () => {
  const matchMaker = new MatchMaker();

  assert.equal(
    matchMaker.shouldTransitionLoop({ eyeTrackingFocus: 60, engagementScore: 39, dopamineIndex: 40 }),
    true
  );
  assert.equal(
    matchMaker.shouldTransitionLoop({ eyeTrackingFocus: 60, engagementScore: 40, dopamineIndex: 40 }),
    false
  );
});

test('SwipeAction type has correct shape for hologram push/pull', () => {
  const action: SwipeAction = {
    userId: 'u1',
    candidateId: 'u2',
    direction: 'left',
    recordedAt: Date.now()
  };

  assert.equal(action.direction, 'left');
  assert.equal(action.userId, 'u1');
  assert.equal(action.candidateId, 'u2');
  assert.ok(typeof action.recordedAt === 'number');
});

test('SwipeAction direction accepts left (push away) and right (pull closer)', () => {
  const base = { userId: 'u1', candidateId: 'u2', recordedAt: 0 };
  const leftSwipe: SwipeAction = { ...base, direction: 'left' };
  const rightSwipe: SwipeAction = { ...base, direction: 'right' };

  assert.equal(leftSwipe.direction, 'left');
  assert.equal(rightSwipe.direction, 'right');
});
