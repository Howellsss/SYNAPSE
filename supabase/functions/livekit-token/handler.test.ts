import { describe, expect, it } from 'vitest';
import { breakoutAllowed, displayName, guestName, handle, roomName, type Admission, type Deps } from './handler';

const SPACE = '11111111-1111-4111-8111-111111111111';
const deps = (over: Partial<Deps> = {}): Deps => ({
  livekitUrl: 'wss://x.livekit.cloud',
  getUser: async (jwt) => (jwt === 'good' ? { id: 'u1', email: 'ama@x.com' } : null),
  getSpaceWorkspace: async (id) => (id === SPACE ? 'ws1' : null),
  getMeeting: async (code) => (code === 'FOCU-358' ? { id: 'm1', workspaceId: 'ws1', ended: false, inviteToken: 'k'.repeat(32) } : code === 'DONE-001' ? { id: 'm2', workspaceId: 'ws1', ended: true, inviteToken: 'd'.repeat(32) } : code === 'OTHR-999' ? { id: 'm3', workspaceId: 'ws2', ended: false } : null),
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

  it('meetings: members of the meeting\'s account join meeting_<id>', async () => {
    const res = await handle(post({ meetingCode: 'focu-358' }), deps());
    expect(res.status).toBe(200);
    expect(JSON.parse((await res.json()).token).room).toBe('meeting_m1');
    expect((await handle(post({ meetingCode: 'OTHR-999' }), deps())).status).toBe(403);
    expect((await handle(post({ meetingCode: 'NOPE-000' }), deps())).status).toBe(403);
    expect((await handle(post({ meetingCode: 'DONE-001' }), deps())).status).toBe(410);
    expect((await handle(post({ meetingCode: 'x' }), deps())).status).toBe(400);
  });

  it('names and rooms', () => {
    expect(roomName('abc')).toBe('space_abc');
    expect(displayName(null, 'kenji@x.com')).toBe('kenji');
    expect(displayName({ first_name: ' Ama ', last_name: null })).toBe('Ama');
  });

  describe('guests with an invite link', () => {
    const K = 'k'.repeat(32);
    it('lets someone without a login join as "Name (Guest)"', async () => {
      const res = await handle(post({ meetingCode: 'FOCU-358', invite: K, guestName: '  Ada   Obi ' }, 'anon-key'), deps());
      expect(res.status).toBe(200);
      const t = JSON.parse((await res.json()).token);
      expect(t.room).toBe('meeting_m1');
      expect(t.name).toBe('Ada Obi (Guest)');
      expect(t.identity).toMatch(/^guest_[0-9a-z]{6,}$/i);
    });
    it('lets a signed-in person from another account join as themselves', async () => {
      const res = await handle(post({ meetingCode: 'FOCU-358', invite: K }, 'good'), deps({ getMembershipStatus: async () => null }));
      expect(res.status).toBe(200);
      expect(JSON.parse((await res.json()).token)).toMatchObject({ identity: 'u1', name: 'Ama Owusu' });
    });
    it('refuses a wrong or missing invite, and ended meetings', async () => {
      expect((await handle(post({ meetingCode: 'FOCU-358', invite: 'x'.repeat(32) }, 'anon-key'), deps())).status).toBe(403);
      expect((await handle(post({ meetingCode: 'FOCU-358' }, 'anon-key'), deps())).status).toBe(401);
      expect((await handle(post({ meetingCode: 'DONE-001', invite: 'd'.repeat(32) }, 'anon-key'), deps())).status).toBe(410);
      expect((await handle(post({ spaceId: SPACE, invite: K }, 'anon-key'), deps())).status).toBe(401);
    });
    it('tidies guest names', () => {
      expect(guestName('')).toBe('Guest (Guest)');
      expect(guestName('<b>Bo</b>')).toBe('bBo/b (Guest)');
      expect(guestName('x'.repeat(100))).toHaveLength(60 + ' (Guest)'.length);
    });
  });

  describe('admissions: waiting room, lock, remove', () => {
    const K = 'k'.repeat(32);
    const T = '22222222-2222-4222-8222-222222222222';
    const store = (rows: Admission[] = []) => {
      const made: { status: string; identity: string; name: string }[] = [];
      const d = deps({
        getMeeting: async (code) => (code === 'FOCU-358' ? { id: 'm1', workspaceId: 'ws1', hostId: 'host1', ended: false, inviteToken: K, waitingRoom: rooms.waiting, locked: rooms.locked, breakout: rooms.breakout } : null),
        getAdmission: async (t) => rows.find((r) => r.ticket === t) ?? null,
        findAdmission: async (m, id) => rows.find((r) => r.meetingId === m && r.identity === id) ?? null,
        createAdmission: async (r) => { made.push(r); return T; },
      });
      return { d, made };
    };
    const rooms: { waiting: boolean; locked: boolean; breakout: unknown } = { waiting: false, locked: false, breakout: null };
    const reset = () => { rooms.waiting = false; rooms.locked = false; rooms.breakout = null; };

    it('lets people straight in when the waiting room is off, and hands back a ticket', async () => {
      reset();
      const { d, made } = store();
      const res = await handle(post({ meetingCode: 'FOCU-358' }), d);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ticket: T, identity: 'u1' });
      expect(made[0]).toMatchObject({ status: 'admitted', identity: 'u1', name: 'Ama Owusu' });
    });

    it('holds people in the waiting room until admitted; the host never waits', async () => {
      reset(); rooms.waiting = true;
      const { d, made } = store();
      const res = await handle(post({ meetingCode: 'FOCU-358', invite: K, guestName: 'Bo' }, 'anon'), d);
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ waiting: true, ticket: T });
      expect(made[0]).toMatchObject({ status: 'waiting', name: 'Bo (Guest)' });
      expect(made[0].identity).toMatch(/^guest_/);

      const host = deps({ getUser: async () => ({ id: 'host1' }), getMembershipStatus: async () => 'active', getMeeting: d.getMeeting, createAdmission: async () => { throw new Error('host should not wait'); } });
      expect((await handle(post({ meetingCode: 'FOCU-358' }), host)).status).toBe(200);
    });

    it('a ticket: waiting stays waiting, admitted gets in with the same identity, removed/denied are refused', async () => {
      reset(); rooms.waiting = true;
      const row = (status: Admission['status']): Admission => ({ ticket: T, meetingId: 'm1', identity: 'guest_abc', status });
      for (const [status, code] of [['waiting', 202], ['admitted', 200], ['removed', 403], ['denied', 403]] as const) {
        const { d, made } = store([row(status)]);
        const res = await handle(post({ meetingCode: 'FOCU-358', invite: K, ticket: T }, 'anon'), d);
        expect(res.status).toBe(code);
        expect(made).toHaveLength(0);
        if (code === 200) expect(JSON.parse((await res.json()).token).identity).toBe('guest_abc');
      }
      // A ticket from another meeting is ignored.
      const { d, made } = store([{ ...row('admitted'), meetingId: 'other' }]);
      expect((await handle(post({ meetingCode: 'FOCU-358', invite: K, ticket: T }, 'anon'), d)).status).toBe(202);
      expect(made).toHaveLength(1);
    });

    it('a removed member can\'t come back by dropping the ticket', async () => {
      reset();
      const { d } = store([{ ticket: T, meetingId: 'm1', identity: 'u1', status: 'removed' }]);
      const res = await handle(post({ meetingCode: 'FOCU-358' }), d);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/removed/);
    });

    it('a locked meeting refuses new people but not people already in', async () => {
      reset(); rooms.locked = true;
      const { d } = store([{ ticket: T, meetingId: 'm1', identity: 'guest_abc', status: 'admitted' }]);
      const res = await handle(post({ meetingCode: 'FOCU-358', invite: K, guestName: 'Cy' }, 'anon'), d);
      expect(res.status).toBe(423);
      expect((await res.json()).error).toMatch(/locked/);
      expect((await handle(post({ meetingCode: 'FOCU-358', invite: K, ticket: T }, 'anon'), d)).status).toBe(200);
    });

    it('without the admissions table everyone with access goes straight in', async () => {
      reset(); rooms.waiting = true;
      const d = deps({ getAdmission: async () => undefined, findAdmission: async () => undefined, createAdmission: async () => undefined });
      expect((await handle(post({ meetingCode: 'FOCU-358', invite: K, guestName: 'Bo' }, 'anon'), d)).status).toBe(200);
      expect((await handle(post({ meetingCode: 'FOCU-358' }), d)).status).toBe(200);
    });

    it('breakout rooms: only the assigned room (the host may visit any)', async () => {
      reset();
      rooms.breakout = { open: true, rooms: [{ n: 1 }, { n: 2 }], assign: { u1: 2 } };
      const { d } = store();
      const ok = await handle(post({ meetingCode: 'FOCU-358', breakout: 2 }), d);
      expect(ok.status).toBe(200);
      expect(JSON.parse((await ok.json()).token).room).toBe('meeting_m1_b2');
      expect((await handle(post({ meetingCode: 'FOCU-358', breakout: 1 }), d)).status).toBe(403);
      expect(breakoutAllowed({ open: true, rooms: [{ n: 1 }], assign: {} }, 1, 'host1', true)).toBe(1);
      expect(breakoutAllowed({ open: false, rooms: [{ n: 1 }], assign: { a: 1 } }, 1, 'a', false)).toBeNull();
      expect(breakoutAllowed({ open: true, rooms: [{ n: 1 }], assign: { a: 1 } }, 3, 'a', true)).toBeNull();
    });
  });
});
