import test from 'node:test';
import assert from 'node:assert/strict';
import { BiometricHandshakeService } from '../src/services/BiometricHandshakeService';

test('BiometricHandshakeService accepts valid handshake', () => {
  const service = new BiometricHandshakeService();

  assert.equal(
    service.validateInitialHandshake({
      sessionToken: 'token-1',
      primaryCamera: { faceDetected: true },
      secondaryCamera: { faceLiveness: true, confidence: 0.95 }
    }),
    true
  );
});

test('BiometricHandshakeService rejects invalid handshake and drops liveness loss', () => {
  const service = new BiometricHandshakeService();

  assert.equal(
    service.validateInitialHandshake({
      sessionToken: 'token-2',
      primaryCamera: { faceDetected: true },
      secondaryCamera: { faceLiveness: false, confidence: 0.95 }
    }),
    false
  );

  assert.equal(
    service.shouldTerminateForLiveness({
      secondaryCamera: { faceLiveness: false, confidence: 0.99 }
    }),
    true
  );
});
