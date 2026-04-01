import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchMaker, UserProfile } from '../src/services/MatchMaker';

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

test('MatchMaker transitions loop for low attention decay even when engagement stays high', () => {
  const matchMaker = new MatchMaker();

  assert.equal(
    matchMaker.shouldTransitionLoop({
      eyeTrackingFocus: 60,
      engagementScore: 70,
      dopamineIndex: 40,
      attentionDecay: 0.25
    }),
    true
  );
});

test('MatchMaker escalates to cached Quantsink VIP routing when attention decay drops below threshold', () => {
  const matchMaker = new MatchMaker();
  const user: UserProfile = {
    id: 'u1',
    interestGraph: { music: 100, travel: 80 }
  };

  const candidates: UserProfile[] = [
    {
      id: 'u2',
      interestGraph: { music: 65, travel: 50 },
      quantsinkFeed: { feedId: 'feed-vip', isVip: true }
    },
    {
      id: 'u3',
      interestGraph: { music: 90, travel: 70 },
      quantsinkFeed: { feedId: 'feed-standard', isVip: false }
    }
  ];

  const response = matchMaker.createMatchResponse(user, candidates, {
    eyeTrackingFocus: 60,
    engagementScore: 70,
    dopamineIndex: 55,
    attentionDecay: 0.25
  });

  assert.equal(response.shouldTransitionLoop, true);
  assert.equal(response.quantsinkHook.mode, 'priority-feed');
  assert.equal(response.quantsinkHook.reason, 'attention-decay');
  assert.equal(response.quantsinkHook.targetUserId, 'u2');
  assert.equal(response.quantsinkHook.targetFeedId, 'feed-vip');
  assert.equal(response.candidates[0]?.candidate.id, 'u2');
});

test('MatchMaker keeps standard routing when attention decay is not below threshold', () => {
  const matchMaker = new MatchMaker();
  const user: UserProfile = {
    id: 'u1',
    interestGraph: { music: 100, travel: 80 }
  };

  const candidates: UserProfile[] = [
    {
      id: 'u2',
      interestGraph: { music: 65, travel: 50 },
      quantsinkFeed: { feedId: 'feed-vip', isVip: true }
    },
    {
      id: 'u3',
      interestGraph: { music: 90, travel: 70 },
      quantsinkFeed: { feedId: 'feed-standard', isVip: false }
    }
  ];

  const response = matchMaker.createMatchResponse(user, candidates, {
    eyeTrackingFocus: 60,
    engagementScore: 70,
    dopamineIndex: 55,
    attentionDecay: 0.3
  });

  assert.equal(response.shouldTransitionLoop, false);
  assert.equal(response.quantsinkHook.mode, 'standard');
  assert.equal(response.quantsinkHook.reason, 'interest-match');
  assert.equal(response.quantsinkHook.usedCachedFeed, false);
  assert.equal(response.quantsinkHook.targetUserId, undefined);
  assert.equal(response.candidates[0]?.candidate.id, 'u3');
});
