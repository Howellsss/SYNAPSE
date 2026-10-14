import { describe, expect, it } from 'vitest';
import { handle, readPayload, tokenFrom, type Deps } from './handler';

const TOKEN = 'ab'.repeat(24);
const make = (over: Partial<Deps> = {}) => {
  const posted: { body: string; senderName: string; meta: Record<string, unknown> }[] = [];
  const deps: Deps = {
    findWebhook: async (t) => (t === TOKEN ? { id: 'w1', channelId: 'c1', name: 'Zapier', archived: false } : null),
    countRecent: async () => 0,
    insertMessage: async (m) => { posted.push(m); return 'm1'; },
    touch: async () => {},
    ...over,
  };
  return { deps, posted };
};
const post = (body: string, type = 'application/json', path = `/functions/v1/chat-webhook/${TOKEN}`) =>
  new Request(`https://x.supabase.co${path}`, { method: 'POST', headers: { 'Content-Type': type }, body });

describe('chat-webhook', () => {
  it('reads the token from the path or the query', () => {
    expect(tokenFrom(`https://x/functions/v1/chat-webhook/${TOKEN}`)).toBe(TOKEN);
    expect(tokenFrom(`https://x/functions/v1/chat-webhook?token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFrom('https://x/functions/v1/chat-webhook')).toBeNull();
    expect(tokenFrom('https://x/functions/v1/chat-webhook/short')).toBeNull();
  });

  it('posts JSON text with the sender name', async () => {
    const { deps, posted } = make();
    const res = await handle(post(JSON.stringify({ text: 'New lead: Jane', username: 'Airtable' })), deps);
    expect(res.status).toBe(200);
    expect(posted[0].body).toBe('New lead: Jane');
    expect(posted[0].senderName).toBe('Airtable');
  });

  it('shows fields when there is no text, and a title as a heading', () => {
    expect(readPayload(JSON.stringify({ name: 'Modal', status: 'done', run: { id: 7 } }), 'application/json').text).toBe('status: done\nrun: {"id":7}');
    expect(readPayload(JSON.stringify({ title: 'Job finished', message: 'All good' }), 'application/json').text).toBe('**Job finished**\nAll good');
  });

  it('takes form posts and plain text', () => {
    expect(readPayload('text=Hello+there&username=Zap', 'application/x-www-form-urlencoded')).toMatchObject({ text: 'Hello there', sender: 'Zap' });
    expect(readPayload('just words', 'text/plain').text).toBe('just words');
  });

  it('falls back to the webhook name when nobody is named', async () => {
    const { deps, posted } = make();
    await handle(post('{"text":"hi"}'), deps);
    expect(posted[0].senderName).toBe('Zapier');
  });

  it('refuses unknown links, empty posts, floods and GETs', async () => {
    expect((await handle(post('{"text":"x"}', 'application/json', '/functions/v1/chat-webhook/' + 'cd'.repeat(24)), make().deps)).status).toBe(401);
    expect((await handle(post('{}'), make().deps)).status).toBe(400);
    expect((await handle(post('{"text":"x"}'), make({ countRecent: async () => 30 }).deps)).status).toBe(429);
    expect((await handle(new Request(`https://x/functions/v1/chat-webhook/${TOKEN}`), make().deps)).status).toBe(405);
    expect((await handle(post('{"text":"x"}'), make({ findWebhook: async () => ({ id: 'w', channelId: 'c', name: 'Z', archived: true }) }).deps)).status).toBe(410);
  });

  it('caps very long text', async () => {
    const { deps, posted } = make();
    await handle(post(JSON.stringify({ text: 'a'.repeat(9000) })), deps);
    expect(posted[0].body.length).toBe(8000);
  });
});
