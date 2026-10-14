import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { channelSlug, dmPeople, formatRuns, startsGroup, webhookUrl, type ChatMessage } from './chat';

const m = (o: Partial<ChatMessage>): ChatMessage => ({
  id: 'x', channel_id: 'c', workspace_id: 'w', user_id: 'u1', parent_id: null, body: 'hi', source: 'user', sender_name: null, meta: {},
  reply_count: 0, last_reply_at: null, created_at: '2026-10-14T10:00:00Z', edited_at: null, deleted_at: null, ...o,
});

describe('conversations helpers', () => {
  it('makes channel names the database accepts', () => {
    expect(channelSlug('  Video Team! ')).toBe('video-team');
    expect(channelSlug('#sales_leads')).toBe('sales_leads');
    expect(channelSlug('!!!')).toBe('');
  });
  it('lists the other people in a direct message', () => {
    expect(dmPeople({ dm_key: 'a,b,c', members: [] }, 'b')).toEqual(['a', 'c']);
  });
  it('builds the webhook link', () => {
    expect(webhookUrl('abc', 'https://p.supabase.co/')).toBe('https://p.supabase.co/functions/v1/chat-webhook/abc');
  });
  it('finds bold text and links, never HTML', () => {
    expect(formatRuns('**New lead** see https://x.com/a. <b>no</b>')).toEqual([
      { t: 'bold', v: 'New lead' }, { t: 'text', v: ' see ' }, { t: 'link', v: 'https://x.com/a' }, { t: 'text', v: '. <b>no</b>' },
    ]);
  });
  it('groups quick messages from the same sender', () => {
    expect(startsGroup(m({}), m({ created_at: '2026-10-14T10:02:00Z' }))).toBe(false);
    expect(startsGroup(m({}), m({ created_at: '2026-10-14T10:09:00Z' }))).toBe(true);
    expect(startsGroup(m({}), m({ user_id: 'u2' }))).toBe(true);
    expect(startsGroup(m({ source: 'webhook', user_id: null, sender_name: 'Zapier' }), m({ source: 'webhook', user_id: null, sender_name: 'Airtable' }))).toBe(true);
  });
});
