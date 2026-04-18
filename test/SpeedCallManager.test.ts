import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeedCallManager, type SpeedCallState } from '../src/services/SpeedCallManager';

function fakeClock(start = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

// ─── Basic lifecycle ─────────────────────────────────────────────────────────

test('startCall creates a call with initial state', () => {
  const clock = fakeClock();
  const mgr = new SpeedCallManager({ nowFn: clock.now });
  const call = mgr.startCall({ proposalId: 'p1', userA: 'a', userB: 'b' });
  assert.equal(call.userA, 'a');
  assert.equal(call.userB, 'b');
  assert.equal(call.phase, 'connecting');
  assert.equal(mgr.activeCallCount(), 1);
  mgr.shutdown();
});

test('startCall rejects same-user calls and double booking', () => {
  const mgr = new SpeedCallManager();
  mgr.startCall({ proposalId: 'p1', userA: 'a', userB: 'b' });
  assert.throws(() => mgr.startCall({ proposalId: 'p2', userA: 'a', userB: 'c' }));
  assert.throws(() => mgr.startCall({ proposalId: 'p3', userA: 'x', userB: 'x' }));
  mgr.shutdown();
});

// ─── Signaling ───────────────────────────────────────────────────────────────

test('deliverSignal accepts offer/answer from participants only', () => {
  const mgr = new SpeedCallManager();
  const call = mgr.startCall({ proposalId: 'p1', userA: 'a', userB: 'b' });
  const signals: unknown[] = [];
  mgr.on('signal', (s) => signals.push(s));
  assert.equal(mgr.deliverSignal({ callId: call.callId, type: 'offer', fromUserId: 'a', toUserId: 'b', payload: {} }), true);
  assert.equal(mgr.deliverSignal({ callId: call.callId, type: 'offer', fromUserId: 'c', toUserId: 'b', payload: {} }), false);
  assert.equal(mgr.deliverSignal({ callId: 'nope', type: 'offer', fromUserId: 'a', toUserId: 'b', payload: {} }), false);
  assert.equal(mgr.deliverSignal({ callId: call.callId, type: 'offer', fromUserId: 'a', toUserId: 'a', payload: {} }), false);
  assert.equal(signals.length, 1);
  mgr.shutdown();
});

test('first offer transitions phase to connected', () => {
  const mgr = new SpeedCallManager();
  const call = mgr.startCall({ proposalId: 'p1', userA: 'a', userB: 'b' });
  let connected: SpeedCallState | null = null;
  mgr.on('call-connected', (c) => { connected = c; });
  mgr.deliverSignal({ callId: call.callId, type: 'offer', fromUserId: 'a', toUserId: 'b', payload: {} });
  assert.ok(connected);
  assert.equal(connected!.phase, 'connected');
  mgr.shutdown();
});

// ─── Timer / warning / hard stop ─────────────────────────────────────────────

test('tick fires warning within last 10s window', async () => {
  const clock = fakeClock();
  const mgr = new SpeedCallManager({ nowFn: clock.now, tickIntervalMs: 10, callDurationMs: 120, warningMsBeforeEnd: 40 });
  let warned = false;
  mgr.on('warning', () => { warned = true; });
  mgr.startCall({ proposalId: 'p1', userA: 'a', userB: 'b' });
  // Advance the wall-clock so the tick sees a small remaining time.
  await new Promise((r) => setTimeout(r, 20));
  clock.advance(90);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(warned, true);
  mgr.shutdown();
});

test('hard stop ends the call with timer-expired', async () => {
  const mgr = new SpeedCallManager({ callDurationMs: 30, tickIntervalMs: 200 });
  const events: string[] = [];
  mgr.on('call-ended', ({ reason }) => events.push(reason));
  mgr.startCall({ proposalId: 'p1', userA: 'a', userB: 'b' });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(events[0], 'timer-expired');
  mgr.shutdown();
});

// ─── Hangup ──────────────────────────────────────────────────────────────────

test('hangup ends the call with user-hangup', () => {
  const mgr = new SpeedCallManager();
  mgr.startCall({ proposalId: 'p1', userA: 'a', userB: 'b' });
  let reason: string | null = null;
  mgr.on('call-ended', (e) => { reason = e.reason; });
  assert.equal(mgr.hangup('a'), true);
  assert.equal(reason, 'user-hangup');
  assert.equal(mgr.activeCallCount(), 0);
});

test('hangup returns false for unknown user', () => {
  const mgr = new SpeedCallManager();
  assert.equal(mgr.hangup('nobody'), false);
});

// ─── Quality monitor / re-match tokens ───────────────────────────────────────

test('connection drop followed by no recovery ends call and issues tokens', async () => {
  const mgr = new SpeedCallManager({ reconnectGraceMs: 40 });
  const call = mgr.startCall({ proposalId: 'p1', userA: 'a', userB: 'b' });
  let tokens: Array<{ userId: string; token: string }> = [];
  mgr.on('call-ended', (e) => { tokens = e.rematchTokens.map((t) => ({ userId: t.userId, token: t.token })); });
  mgr.reportQuality({ userId: 'a', iceState: 'failed', sampledAt: Date.now() });
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(tokens.length, 2);
  assert.equal(mgr.getCall(call.callId), null);
});

test('connection drop followed by recovery does NOT end call', async () => {
  const mgr = new SpeedCallManager({ reconnectGraceMs: 40 });
  mgr.startCall({ proposalId: 'p1', userA: 'a', userB: 'b' });
  let ended = false;
  mgr.on('call-ended', () => { ended = true; });
  mgr.reportQuality({ userId: 'a', iceState: 'disconnected', sampledAt: Date.now() });
  mgr.reportQuality({ userId: 'a', iceState: 'connected', sampledAt: Date.now() });
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(ended, false);
  mgr.shutdown();
});

test('re-match token is single-use and user-bound', async () => {
  const mgr = new SpeedCallManager({ reconnectGraceMs: 10 });
  const call = mgr.startCall({ proposalId: 'p1', userA: 'a', userB: 'b' });
  let tokenA = '';
  mgr.on('call-ended', (e) => { tokenA = e.rematchTokens.find((t) => t.userId === 'a')?.token ?? ''; });
  mgr.reportQuality({ userId: 'a', iceState: 'failed', sampledAt: Date.now() });
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(tokenA);
  assert.equal(mgr.consumeRematchToken(tokenA, 'b'), false, 'wrong user cannot consume');
  assert.equal(mgr.consumeRematchToken(tokenA, 'a'), true);
  assert.equal(mgr.consumeRematchToken(tokenA, 'a'), false, 'single-use');
  assert.equal(call.phase, 'ended');
});

// ─── Shutdown ────────────────────────────────────────────────────────────────

test('shutdown ends every call with server-shutdown', () => {
  const mgr = new SpeedCallManager();
  mgr.startCall({ proposalId: 'p1', userA: 'a1', userB: 'b1' });
  mgr.startCall({ proposalId: 'p2', userA: 'a2', userB: 'b2' });
  const reasons: string[] = [];
  mgr.on('call-ended', (e) => reasons.push(e.reason));
  mgr.shutdown();
  assert.deepEqual(reasons.sort(), ['server-shutdown', 'server-shutdown']);
  assert.equal(mgr.activeCallCount(), 0);
});

test('listActiveCalls reflects current state', () => {
  const mgr = new SpeedCallManager();
  mgr.startCall({ proposalId: 'p1', userA: 'a', userB: 'b' });
  assert.equal(mgr.listActiveCalls().length, 1);
  mgr.hangup('a');
  assert.equal(mgr.listActiveCalls().length, 0);
});

test('getCallForUser returns the callId while active', () => {
  const mgr = new SpeedCallManager();
  const call = mgr.startCall({ proposalId: 'p1', userA: 'a', userB: 'b' });
  assert.equal(mgr.getCallForUser('a'), call.callId);
  assert.equal(mgr.getCallForUser('nobody'), null);
  mgr.shutdown();
});
