/**
 * Chat, reactions and meeting control messages, sent over LiveKit's data channel.
 * Nothing here is saved: chat lasts as long as the meeting. Messages are validated on receipt;
 * who sent them comes from LiveKit, never from the message.
 */

export const REACTIONS = ['👏', '👍', '❤️', '😂', '😮', '🎉'] as const;
export type Reaction = (typeof REACTIONS)[number];

export const MAX_CHAT = 1000;

export type ChatMsg = { t: 'msg'; id: string; text: string };
export type ReactMsg = { t: 'emoji'; e: Reaction } | { t: 'hand'; up: boolean };
export type ControlMsg = { t: 'ended' };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const okId = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);

export function parseChat(raw: unknown): ChatMsg | null {
  if (!isObj(raw) || raw.t !== 'msg' || !okId(raw.id) || typeof raw.text !== 'string') return null;
  const text = raw.text.slice(0, MAX_CHAT).trim();
  return text ? { t: 'msg', id: raw.id as string, text } : null;
}

export function parseReact(raw: unknown): ReactMsg | null {
  if (!isObj(raw)) return null;
  if (raw.t === 'emoji' && (REACTIONS as readonly unknown[]).includes(raw.e)) return { t: 'emoji', e: raw.e as Reaction };
  if (raw.t === 'hand' && typeof raw.up === 'boolean') return { t: 'hand', up: raw.up };
  return null;
}

export function parseControl(raw: unknown): ControlMsg | null {
  return isObj(raw) && raw.t === 'ended' ? { t: 'ended' } : null;
}

/** The host asking the person sharing their screen to stop. */
export const isStopShare = (raw: unknown) => isObj(raw) && raw.t === 'stopShare';

/** Host requests, obeyed only when they come from the host (checked by the receiver). */
export type HostRequest = 'mute' | 'muteAll' | 'remove';
export function parseHostRequest(raw: unknown): HostRequest | null {
  return isObj(raw) && (raw.t === 'mute' || raw.t === 'muteAll' || raw.t === 'remove') ? raw.t : null;
}

/** "0:42", "12:05", "1:02:09" */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const newChatId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
