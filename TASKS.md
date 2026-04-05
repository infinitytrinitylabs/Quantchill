# Quantchill - Production Tasks

## Phase 1: Critical (Week 1-2)
- [ ] Add PostgreSQL database (users, matches, sessions tables)
- [ ] Add Redis for WebSocket session management and pub/sub
- [ ] Implement real WebRTC signaling (STUN/TURN server integration)
- [ ] Add Quantmail SSO token verification middleware
- [ ] Add proper WebSocket authentication (verify token on connection)
- [ ] Create Dockerfile and docker-compose.yml

## Phase 2: Core Features (Week 3-4)
- [ ] Build user profile persistence (save interest graphs to DB)
- [ ] Implement match history and analytics
- [ ] Add video call quality monitoring (bitrate, latency, packet loss)
- [ ] Build group matching (not just 1:1)
- [ ] Add content moderation for video streams (AI-based)
- [ ] Create `.github/workflows/ci.yml`

## Phase 3: Scale (Week 5-6)
- [ ] Add horizontal WebSocket scaling with Redis adapter
- [ ] Implement connection pooling and reconnection logic
- [ ] Add load balancing support (sticky sessions)
- [ ] Build admin dashboard for monitoring active connections
- [ ] Add Quantneon 3D avatar rendering in video calls
