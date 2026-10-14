/**
 * Streams: one person broadcasts (camera, microphone, screen), many watch. Viewers join with the
 * watch link, no account needed, and can chat and react; they never send video or sound.
 * Database: 20261017090000_streams.sql; tokens: livekit-token ({ streamCode, watch }).
 */
import { supabase } from '@/lib/supabase';
import { makeCode } from '@/meetings/codes';
import { publicOrigin } from '@/lib/publicUrl';

export const STREAMS_NOT_SET_UP = 'Streams need the database update 20261017090000_streams.sql (run it in the Supabase SQL editor).';
const friendly = (msg: string) => (/streams|stream_by_watch|does not exist|Could not find the (table|function)|schema cache/i.test(msg) ? STREAMS_NOT_SET_UP : msg);

export type StreamStatus = 'scheduled' | 'live' | 'ended';

export interface Stream {
  id: string;
  workspace_id: string;
  host_id: string;
  title: string;
  description: string | null;
  code: string;
  watch_token: string;
  status: StreamStatus;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  chat_enabled: boolean;
  peak_viewers: number;
  created_at: string;
}

/** What the public watch page knows about a stream. */
export interface WatchInfo {
  id: string;
  title: string;
  description: string | null;
  code: string;
  status: StreamStatus;
  scheduled_at: string | null;
  started_at: string | null;
  chat_enabled: boolean;
  host_id: string;
  host_name: string;
  workspace_name: string | null;
}

/** /live/CODE?watch=TOKEN: anyone with it can watch. */
export function watchUrl(s: Pick<Stream, 'code' | 'watch_token'>, origin = publicOrigin()): string {
  return `${origin}/live/${s.code}?watch=${encodeURIComponent(s.watch_token)}`;
}

/** The watch token in the current address. */
export function watchFromLocation(path: string, search = typeof window !== 'undefined' ? window.location.search : ''): string {
  return (new URLSearchParams(search).get('watch') ?? new URLSearchParams(path.split('?')[1] ?? '').get('watch') ?? '').trim();
}

export async function listStreams(workspaceId: string): Promise<{ data: Stream[]; error: string | null }> {
  const { data, error } = await supabase.from('streams').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(100);
  return { data: (data ?? []) as Stream[], error: error ? friendly(error.message) : null };
}

export async function getStream(code: string): Promise<{ data: Stream | null; error: string | null }> {
  const { data, error } = await supabase.from('streams').select('*').eq('code', code.toUpperCase()).maybeSingle();
  return { data: (data as Stream | null) ?? null, error: error ? friendly(error.message) : null };
}

export async function getWatchInfo(code: string, token: string): Promise<{ data: WatchInfo | null; error: string | null }> {
  const { data, error } = await supabase.rpc('stream_by_watch', { p_code: code, p_token: token });
  return { data: (data as WatchInfo | null) ?? null, error: error ? friendly(error.message) : null };
}

export async function createStream(input: { workspaceId: string; hostId: string; title: string; description?: string; scheduledAt?: Date | null }): Promise<{ data: Stream | null; error: string | null }> {
  const title = input.title.trim().slice(0, 120) || 'Live stream';
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabase.from('streams').insert({
      workspace_id: input.workspaceId, host_id: input.hostId, title, description: input.description?.trim() || null,
      code: makeCode(title), scheduled_at: input.scheduledAt ? input.scheduledAt.toISOString() : null,
    }).select('*').single();
    if (!error) return { data: data as Stream, error: null };
    if (/streams_code_key|duplicate key/.test(error.message)) continue;
    return { data: null, error: friendly(error.message) };
  }
  return { data: null, error: 'Could not create a stream code. Try again.' };
}

export async function setStreamStatus(id: string, status: StreamStatus): Promise<{ data: Stream | null; error: string | null }> {
  const { data, error } = await supabase.from('streams').update({ status }).eq('id', id).select('*').single();
  return { data: (data as Stream | null) ?? null, error: error ? friendly(error.message) : null };
}

export async function recordPeak(id: string, viewers: number) {
  await supabase.from('streams').update({ peak_viewers: viewers }).eq('id', id);
}

export async function deleteStream(id: string) {
  const { error } = await supabase.from('streams').delete().eq('id', id);
  return { error: error ? friendly(error.message) : null };
}

/** Chat and reactions travel over the stream's data channel. */
export const STREAM_TOPICS = { chat: 'synapse.stream.chat', react: 'synapse.stream.react', state: 'synapse.stream.state' } as const;
export const STREAM_REACTIONS = ['👏', '❤️', '🔥', '😂', '🎉', '👍'] as const;

export interface StreamChatLine { id: string; from: string; name: string; text: string; at: number; host: boolean }

/** A chat message from the data channel, checked. */
export function parseStreamChat(raw: unknown): { id: string; text: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { id?: unknown; text?: unknown };
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(r.id) || typeof r.text !== 'string') return null;
  const text = r.text.replace(/\s+/g, ' ').trim().slice(0, 500);
  return text ? { id: r.id, text } : null;
}

export function parseReaction(raw: unknown): string | null {
  const e = raw && typeof raw === 'object' ? (raw as { e?: unknown }).e : null;
  return typeof e === 'string' && (STREAM_REACTIONS as readonly string[]).includes(e) ? e : null;
}

/** "1 viewer", "1.2K viewers" */
export function viewersLabel(n: number): string {
  const v = n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n);
  return `${v} ${n === 1 ? 'viewer' : 'viewers'}`;
}
