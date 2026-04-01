import test from 'node:test';
import assert from 'node:assert/strict';
import { QuantneonAvatarService } from '../src/services/QuantneonAvatarService';

test('QuantneonAvatarService returns a stub avatar when no base URL is configured', async () => {
  const service = new QuantneonAvatarService({ baseUrl: '' });
  const avatar = await service.getAvatar('user-42');

  assert.equal(avatar.userId, 'user-42');
  assert.equal(avatar.avatarId, 'stub-user-42');
  assert.ok(avatar.meshUrl.includes('user-42'));
  assert.ok(avatar.textureUrl.includes('user-42'));
  assert.ok(avatar.thumbnailUrl.includes('user-42'));
  assert.equal(avatar.boundingBoxScale, 1.0);
});

test('QuantneonAvatarService getAvatar produces deterministic stub output for the same user', async () => {
  const service = new QuantneonAvatarService({ baseUrl: '' });
  const a = await service.getAvatar('alice');
  const b = await service.getAvatar('alice');

  assert.deepEqual(a, b);
  assert.equal(a.userId, 'alice');
  assert.equal(a.avatarId, 'stub-alice');
});

test('QuantneonAvatarService falls back to stub when upstream is unreachable', async () => {
  const service = new QuantneonAvatarService({
    baseUrl: 'http://127.0.0.1:1',
    timeoutMs: 100
  });

  const avatar = await service.getAvatar('bob');

  assert.equal(avatar.userId, 'bob');
  assert.equal(avatar.avatarId, 'stub-bob');
});
