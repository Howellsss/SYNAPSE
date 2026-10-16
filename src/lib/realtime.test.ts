import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ channels: [] as { topic: string }[], disconnecting: false, created: [] as string[] }));
vi.mock('./supabase', () => ({
  supabase: {
    realtime: { isDisconnecting: () => state.disconnecting },
    getChannels: () => state.channels,
    removeChannel: vi.fn(async (c: { topic: string }) => { state.channels = state.channels.filter((x) => x !== c); return 'ok'; }),
    channel: (name: string) => { const c = { topic: `realtime:${name}` }; state.channels.push(c); state.created.push(name); return c; },
  },
}));

import { openChannel } from './realtime';

describe('openChannel', () => {
  beforeEach(() => { state.channels = []; state.disconnecting = false; state.created = []; vi.useRealTimers(); });

  it('opens straight away when nothing else uses the name', async () => {
    const ch = await openChannel('space:a', { config: {} }, () => false);
    expect(ch).toEqual({ topic: 'realtime:space:a' });
  });

  it('waits for a channel that is still leaving, so it gets a new one rather than the old', async () => {
    const old = { topic: 'realtime:space:a' };
    state.channels = [old];
    setTimeout(() => { state.channels = []; }, 120);
    const ch = await openChannel('space:a', { config: {} }, () => false);
    expect(ch).not.toBe(old);
    expect(state.created).toEqual(['space:a']);
  });

  it('waits while the connection is closing', async () => {
    state.disconnecting = true;
    let done = false;
    const p = openChannel('space:a', { config: {} }, () => false).then((c) => { done = true; return c; });
    await new Promise((r) => setTimeout(r, 120));
    expect(done).toBe(false);
    state.disconnecting = false;
    expect(await p).toEqual({ topic: 'realtime:space:a' });
  });

  it('opens nothing once cancelled', async () => {
    state.channels = [{ topic: 'realtime:space:a' }];
    let stop = false;
    setTimeout(() => { stop = true; }, 60);
    expect(await openChannel('space:a', { config: {} }, () => stop)).toBeNull();
    expect(state.created).toEqual([]);
  });
});
