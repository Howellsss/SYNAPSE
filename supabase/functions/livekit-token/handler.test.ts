import { describe, expect, it } from 'vitest';
import { displayName, handle, roomName, type Deps } from './handler';

const SPACE = '11111111-1111-4111-8111-111111111111';
const deps = (over: Partial<Deps> = {}): Deps => ({
  livekitUrl: 'wss://x.livekit.cloud',
  getUser: async (jwt) => (jwt === 'good' ? { id: 'u1', email: 'ama@x.com' } : null),
  getSpaceWorkspace: async (id) => (id === SPACE ? 'ws1' : null),
  getMembershipStatus: async (ws, user) => (ws === 'ws1' && user === 'u1' ? 'active' : null),
  getProfileName: async () => ({ first_name: 'Ama', last_name: 'Owusu' }),
  makeToken: async (g) => JSON.stringify(g),
  ...over,
});
const post = (body: unknown, jwt = 'good') =>
  new Request('http://x', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) });

describe('livekit-token handler', () => {
  it('gives active members a token for space_<id>, 6 h, named after them', async () => {
    const res = await handle(post({ spaceId: SPACE }), deps());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.url).toBe('wss://x.livekit.cloud');
    expect(JSON.parse(body.token)).toEqual({ room: `space_${SPACE}`, identity: 'u1', name: 'Ama Owusu', ttl: '6h' });
  });

  it('refuses everyone else', async () => {
    expect((await handle(post({ spaceId: SPACE }, 'bad'), deps())).status).toBe(401);
    expect((await handle(post({ spaceId: 'x' }), deps())).status).toBe(400);
    expect((await handle(post({ spaceId: SPACE }), deps({ getMembershipStatus: async () => 'suspended' }))).status).toBe(403);
    expect((await handle(post({ spaceId: SPACE }), deps({ getMembershipStatus: async () => null }))).status).toBe(403);
  });

  it('names and rooms', () => {
    expect(roomName('abc')).toBe('space_abc');
    expect(displayName(null, 'kenji@x.com')).toBe('kenji');
    expect(displayName({ first_name: ' Ama ', last_name: null })).toBe('Ama');
  });
});
