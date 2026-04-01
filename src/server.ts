import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { RawData, WebSocket } from 'ws';
import { BiometricHandshakeService, BiometricPayload } from './services/BiometricHandshakeService';
import { MatchMaker, UserProfile, BCIContext } from './services/MatchMaker';

type SocketMessage =
  | { type: 'register'; userId: string; interestGraph: Record<string, number>; bciContext?: BCIContext }
  | { type: 'offer' | 'answer' | 'ice-candidate'; targetUserId: string; payload: unknown }
  | { type: 'swap-video'; targetUserId: string; requestId?: string; startedAt?: number }
  | { type: 'biometric-handshake'; payload: BiometricPayload }
  | { type: 'biometric-update'; payload: BiometricPayload }
  | { type: 'match-request'; bciContext: BCIContext }
  | { type: 'ping'; sentAt?: number };

interface ClientState {
  socket: WebSocket;
  profile?: UserProfile;
  connectedAt: number;
  authenticated: boolean;
}

const app = Fastify({ logger: true });
const handshakeService = new BiometricHandshakeService();
const matchMaker = new MatchMaker();
const clients = new Map<string, ClientState>();

function sendSafe(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function terminateClient(clientId: string, reason: string): void {
  const state = clients.get(clientId);
  if (!state) return;

  sendSafe(state.socket, { type: 'terminated', reason, terminatedAt: Date.now() });
  state.socket.close(1008, reason);
  clients.delete(clientId);
}

app.register(websocket);

app.get('/health', async () => ({ status: 'ok' }));

app.get('/ws', { websocket: true }, (socket) => {
  const clientId = randomUUID();
  clients.set(clientId, {
    socket,
    connectedAt: Date.now(),
    authenticated: false
  });

  sendSafe(socket, { type: 'connected', clientId });

  socket.on('message', (raw: RawData) => {
    let message: SocketMessage;

    try {
      message = JSON.parse(String(raw)) as SocketMessage;
    } catch {
      sendSafe(socket, { type: 'error', message: 'invalid-json' });
      return;
    }

    const currentClient = clients.get(clientId);
    if (!currentClient) {
      return;
    }

    if (message.type === 'biometric-handshake') {
      const valid = handshakeService.validateInitialHandshake(message.payload);
      if (!valid) {
        terminateClient(clientId, 'biometric-handshake-failed');
        return;
      }

      currentClient.authenticated = true;
      sendSafe(socket, { type: 'biometric-handshake-accepted', acceptedAt: Date.now() });
      return;
    }

    if (!currentClient.authenticated) {
      sendSafe(socket, { type: 'error', message: 'biometric-handshake-required' });
      return;
    }

    if (message.type === 'biometric-update') {
      if (handshakeService.shouldTerminateForLiveness(message.payload)) {
        terminateClient(clientId, 'face-liveness-dropped');
        return;
      }

      sendSafe(socket, { type: 'biometric-ok', checkedAt: Date.now() });
      return;
    }

    if (message.type === 'register') {
      currentClient.profile = {
        id: message.userId,
        interestGraph: message.interestGraph
      };

      sendSafe(socket, { type: 'registered', userId: message.userId });
      return;
    }

    if (message.type === 'match-request') {
      if (!currentClient.profile) {
        sendSafe(socket, { type: 'error', message: 'register-required' });
        return;
      }

      const candidates = Array.from(clients.values())
        .filter((client) => client.authenticated && client.profile)
        .map((client) => client.profile as UserProfile);

      const ranked = matchMaker.rankCandidates(currentClient.profile, candidates, message.bciContext);
      sendSafe(socket, {
        type: 'match-response',
        transitionLoop: matchMaker.shouldTransitionLoop(message.bciContext),
        candidates: ranked.slice(0, 5)
      });
      return;
    }

    if (message.type === 'offer' || message.type === 'answer' || message.type === 'ice-candidate') {
      const target = Array.from(clients.values()).find((client) => client.profile?.id === message.targetUserId);
      if (!target) {
        sendSafe(socket, { type: 'error', message: 'target-not-found' });
        return;
      }

      sendSafe(target.socket, {
        type: message.type,
        fromUserId: currentClient.profile?.id,
        payload: message.payload,
        relayedAt: Date.now()
      });

      return;
    }

    if (message.type === 'swap-video') {
      const startedAt = message.startedAt ?? Date.now();
      const now = Date.now();
      const relayLatencyMs = Math.max(0, now - startedAt);
      const target = Array.from(clients.values()).find((client) => client.profile?.id === message.targetUserId);

      if (!target) {
        sendSafe(socket, { type: 'error', message: 'target-not-found' });
        return;
      }

      sendSafe(target.socket, {
        type: 'swap-video',
        fromUserId: currentClient.profile?.id,
        requestId: message.requestId ?? randomUUID(),
        startedAt,
        relayedAt: now,
        relayLatencyMs,
        under200ms: relayLatencyMs < 200
      });

      sendSafe(socket, {
        type: 'swap-video-ack',
        requestId: message.requestId,
        relayLatencyMs,
        under200ms: relayLatencyMs < 200
      });
      return;
    }

    if (message.type === 'ping') {
      sendSafe(socket, { type: 'pong', sentAt: message.sentAt ?? Date.now(), receivedAt: Date.now() });
    }
  });

  socket.on('close', () => {
    clients.delete(clientId);
  });
});

const start = async (): Promise<void> => {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen({ port, host });
};

if (require.main === module) {
  start().catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}

export { app, start };
