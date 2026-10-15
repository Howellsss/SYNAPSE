/**
 * Conversations: channels, direct messages and threads for the people in an account, posts from
 * Zapier, Airtable or Modal through a channel's webhook link, and replies to emails sent from
 * SYNAPSE. Database: 20261016090000_conversations.sql; Edge Function: chat-webhook.
 */
import { supabase } from '@/lib/supabase';

export const CHAT_NOT_SET_UP = 'Conversations need the database update 20261016090000_conversations.sql (run it in the Supabase SQL editor).';
const missing = (msg: string) => /chat_|create_channel|open_dm|does not exist|Could not find the (table|function)|schema cache/i.test(msg);
const friendly = (msg: string) => (missing(msg) ? CHAT_NOT_SET_UP : msg);

export interface Channel {
  id: string;
  workspace_id: string;
  kind: 'channel' | 'dm';
  name: string | null;
  description: string | null;
  is_private: boolean;
  department_id: string | null;
  dm_key: string | null;
  created_by: string | null;
  created_at: string;
  archived_at: string | null;
  last_message_at: string | null;
  /** user ids in the channel */
  members: { user_id: string; role: 'owner' | 'member'; last_read_at: string; muted: boolean }[];
}

export interface ChatMessage {
  id: string;
  channel_id: string;
  workspace_id: string;
  user_id: string | null;
  parent_id: string | null;
  body: string;
  source: 'user' | 'webhook' | 'system';
  sender_name: string | null;
  meta: Record<string, unknown>;
  reply_count: number;
  last_reply_at: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface Webhook {
  id: string;
  channel_id: string;
  name: string;
  token: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** An email reply brought back from Gmail (a messages row). */
export interface EmailReply {
  id: string;
  contact_id: string | null;
  subject: string | null;
  body: string | null;
  from_email: string | null;
  from_name: string | null;
  sent_at: string | null;
  created_at: string;
  contacts?: { first_name: string | null; last_name: string | null } | null;
}

/** "Video Team!" -> "video-team" (the database only takes lowercase letters, numbers, - and _). */
export function channelSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 80);
}

/** The other people in a direct message (everyone but me). */
export function dmPeople(c: Pick<Channel, 'dm_key' | 'members'>, me: string): string[] {
  const ids = c.dm_key ? c.dm_key.split(',') : c.members.map((m) => m.user_id);
  return ids.filter((id) => id !== me);
}

/** The link Zapier, Airtable or Modal posts to. */
export function webhookUrl(token: string, base = import.meta.env.VITE_SUPABASE_URL as string): string {
  return `${String(base).replace(/\/+$/, '')}/functions/v1/chat-webhook/${token}`;
}

/** Split text into plain runs, **bold** runs and links, for display (never as HTML). */
export type Run = { t: 'text' | 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'mention'; v: string };
/**
 * A message's text as runs to draw (never HTML): **bold**, _italic_, ~strike~, `code`, links and
 * @mentions (@Name, @here, @channel).
 */
export function formatRuns(text: string): Run[] {
  const out: Run[] = [];
  const re = /(\*\*[^*\n]+\*\*)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(`[^`\n]+`)|((?<![\w*])_[^_\n]+_(?!\w))|((?<![\w~])~[^~\n]+~(?!\w))|((?<![\w@])@(?:here|channel|everyone|[A-Za-z][\w.'-]*(?: [A-Z][\w.'-]*)?))/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1]) out.push({ t: 'bold', v: m[1].slice(2, -2) });
    else if (m[2]) out.push({ t: 'link', v: m[2] });
    else if (m[3]) out.push({ t: 'code', v: m[3].slice(1, -1) });
    else if (m[4]) out.push({ t: 'italic', v: m[4].slice(1, -1) });
    else if (m[5]) out.push({ t: 'strike', v: m[5].slice(1, -1) });
    else out.push({ t: 'mention', v: m[6] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

/** Does this message mention someone called `name` (or everyone, with @here / @channel)? */
export function mentions(body: string, name: string): boolean {
  const first = name.trim().split(/\s+/)[0];
  if (/(^|[^\w@])@(here|channel|everyone)\b/i.test(body)) return true;
  if (!first) return false;
  return new RegExp(`(^|[^\\w@])@${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(body);
}

/** Every link in a set of messages, newest first (the channel's Links tab). */
export function linksIn(messages: ChatMessage[]): { url: string; message: ChatMessage }[] {
  const out: { url: string; message: ChatMessage }[] = [];
  for (const m of [...messages].reverse()) {
    if (m.deleted_at) continue;
    for (const r of formatRuns(m.body)) if (r.t === 'link' && !out.some((o) => o.url === r.v)) out.push({ url: r.v, message: m });
  }
  return out;
}

/** Group consecutive messages by the same sender within 5 minutes (shown without repeating the name). */
export function startsGroup(prev: ChatMessage | undefined, m: ChatMessage): boolean {
  if (!prev) return true;
  const sameSender = prev.user_id === m.user_id && prev.source === m.source && prev.sender_name === m.sender_name;
  return !sameSender || Date.parse(m.created_at) - Date.parse(prev.created_at) > 5 * 60_000;
}

type ChannelRow = Omit<Channel, 'members'> & { chat_members?: Channel['members'] | null };

export async function listChannels(workspaceId: string): Promise<{ data: Channel[]; error: string | null }> {
  const { data, error } = await supabase
    .from('chat_channels')
    .select('*, chat_members(user_id, role, last_read_at, muted)')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .order('name');
  if (error) return { data: [], error: friendly(error.message) };
  return { data: ((data ?? []) as ChannelRow[]).map(({ chat_members, ...c }) => ({ ...c, members: chat_members ?? [] })), error: null };
}

export async function unreadCounts(workspaceId: string): Promise<Record<string, number>> {
  const { data } = await supabase.rpc('chat_unread', { p_workspace: workspaceId });
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { channel_id: string; unread: number }[]) out[r.channel_id] = Number(r.unread);
  return out;
}

export async function createChannel(workspaceId: string, input: { name: string; description?: string; isPrivate?: boolean; departmentId?: string | null }): Promise<{ id: string | null; error: string | null }> {
  const name = channelSlug(input.name);
  if (!name) return { id: null, error: 'Give the channel a name.' };
  const { data, error } = await supabase.rpc('create_channel', {
    p_workspace: workspaceId, p_name: name, p_description: input.description?.trim() || null, p_private: !!input.isPrivate, p_department: input.departmentId ?? null,
  });
  if (error) {
    if (/chat_channels_name_key|duplicate/i.test(error.message)) return { id: null, error: `There is already a #${name} channel.` };
    return { id: null, error: friendly(error.message) };
  }
  return { id: data as string, error: null };
}

export async function openDm(workspaceId: string, userIds: string[]): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('open_dm', { p_workspace: workspaceId, p_users: userIds });
  return { id: (data as string | null) ?? null, error: error ? friendly(error.message) : null };
}

export async function joinChannel(channel: Pick<Channel, 'id' | 'workspace_id'>, userId: string) {
  const { error } = await supabase.from('chat_members').insert({ channel_id: channel.id, workspace_id: channel.workspace_id, user_id: userId });
  return { error: error && error.code !== '23505' ? friendly(error.message) : null };
}

export async function addMembers(channel: Pick<Channel, 'id' | 'workspace_id'>, userIds: string[]) {
  if (!userIds.length) return { error: null };
  const { error } = await supabase.from('chat_members').upsert(
    userIds.map((user_id) => ({ channel_id: channel.id, workspace_id: channel.workspace_id, user_id })),
    { onConflict: 'channel_id,user_id', ignoreDuplicates: true },
  );
  return { error: error ? friendly(error.message) : null };
}

export async function leaveChannel(channelId: string, userId: string) {
  const { error } = await supabase.from('chat_members').delete().eq('channel_id', channelId).eq('user_id', userId);
  return { error: error ? friendly(error.message) : null };
}

export async function markRead(channelId: string, userId: string) {
  await supabase.from('chat_members').update({ last_read_at: new Date().toISOString() }).eq('channel_id', channelId).eq('user_id', userId);
}

export async function updateChannel(id: string, changes: Partial<Pick<Channel, 'description' | 'archived_at'>>) {
  const { error } = await supabase.from('chat_channels').update(changes).eq('id', id);
  return { error: error ? friendly(error.message) : null };
}

const PAGE = 50;

/** The newest top-level messages of a channel (oldest first), or the page before `before`. */
export async function listMessages(channelId: string, before?: string): Promise<{ data: ChatMessage[]; more: boolean; error: string | null }> {
  let q = supabase.from('chat_messages').select('*').eq('channel_id', channelId).is('parent_id', null).order('created_at', { ascending: false }).limit(PAGE + 1);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) return { data: [], more: false, error: friendly(error.message) };
  const rows = (data ?? []) as ChatMessage[];
  return { data: rows.slice(0, PAGE).reverse(), more: rows.length > PAGE, error: null };
}

export async function listThread(parentId: string): Promise<ChatMessage[]> {
  const { data } = await supabase.from('chat_messages').select('*').eq('parent_id', parentId).order('created_at').limit(500);
  return (data ?? []) as ChatMessage[];
}

export async function sendMessage(channelId: string, userId: string, body: string, parentId: string | null = null): Promise<{ data: ChatMessage | null; error: string | null }> {
  const text = body.trim().slice(0, 8000);
  if (!text) return { data: null, error: null };
  const { data, error } = await supabase.from('chat_messages').insert({ channel_id: channelId, user_id: userId, body: text, parent_id: parentId }).select('*').single();
  return { data: (data as ChatMessage | null) ?? null, error: error ? friendly(error.message) : null };
}

export async function editMessage(id: string, body: string) {
  const { error } = await supabase.from('chat_messages').update({ body: body.trim().slice(0, 8000) }).eq('id', id);
  return { error: error ? friendly(error.message) : null };
}

export async function deleteMessage(id: string) {
  const { error } = await supabase.from('chat_messages').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  return { error: error ? friendly(error.message) : null };
}

/** New and changed messages in the account, as they happen. Returns the unsubscribe. */
export function subscribeMessages(workspaceId: string, onChange: (m: ChatMessage, kind: 'INSERT' | 'UPDATE') => void): () => void {
  const ch = supabase
    .channel(`chat:${workspaceId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `workspace_id=eq.${workspaceId}` }, (p) => onChange(p.new as ChatMessage, 'INSERT'))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `workspace_id=eq.${workspaceId}` }, (p) => onChange(p.new as ChatMessage, 'UPDATE'))
    .subscribe();
  return () => { void supabase.removeChannel(ch); };
}

export async function listWebhooks(channelId: string): Promise<Webhook[]> {
  const { data } = await supabase.from('chat_webhooks').select('*').eq('channel_id', channelId).is('revoked_at', null).order('created_at');
  return (data ?? []) as Webhook[];
}

export async function createWebhook(channel: Pick<Channel, 'id' | 'workspace_id'>, name: string, userId: string): Promise<{ data: Webhook | null; error: string | null }> {
  const { data, error } = await supabase.from('chat_webhooks').insert({ channel_id: channel.id, workspace_id: channel.workspace_id, name: name.trim().slice(0, 80) || 'Webhook', created_by: userId }).select('*').single();
  return { data: (data as Webhook | null) ?? null, error: error ? friendly(error.message) : null };
}

export async function revokeWebhook(id: string) {
  const { error } = await supabase.from('chat_webhooks').update({ revoked_at: new Date().toISOString() }).eq('id', id);
  return { error: error ? friendly(error.message) : null };
}

/** Replies to emails sent from SYNAPSE, newest first. */
export async function listEmailReplies(workspaceId: string): Promise<{ data: EmailReply[]; error: string | null }> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, contact_id, subject, body, from_email, from_name, sent_at, created_at, contacts(first_name, last_name)')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'email')
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(100);
  return { data: (data ?? []) as unknown as EmailReply[], error: error?.message ?? null };
}

/**
 * Recent messages in the conversations you're in (newest first): for the Activity view (mentions
 * of you, replies in threads you started) and for each direct message's latest line.
 */
export async function listRecent(workspaceId: string, limit = 300): Promise<ChatMessage[]> {
  const { data } = await supabase.from('chat_messages').select('*').eq('workspace_id', workspaceId).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(limit);
  return (data ?? []) as ChatMessage[];
}

/** The messages you wrote among some ids (to find replies to your threads). */
export async function myMessagesAmong(ids: string[], userId: string): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await supabase.from('chat_messages').select('id').in('id', ids.slice(0, 200)).eq('user_id', userId);
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}
