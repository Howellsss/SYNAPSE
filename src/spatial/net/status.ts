import type { PresenceStatus } from './protocol';

export type { PresenceStatus } from './protocol';
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export const STATUS_OPTIONS: { value: PresenceStatus; label: string; dot: string }[] = [
  { value: 'available', label: 'Available', dot: 'bg-green-500' },
  { value: 'busy', label: 'Busy', dot: 'bg-gold-500' },
  { value: 'focus', label: 'Focus', dot: 'bg-indigo-500' },
  { value: 'dnd', label: 'Do not disturb', dot: 'bg-burgundy-500' },
];

export const AWAY = { label: 'Away', dot: 'bg-ivory-500' } as const;

export const statusInfo = (s: PresenceStatus | undefined) => STATUS_OPTIONS.find((o) => o.value === s) ?? STATUS_OPTIONS[0];

/** How a person's dot and label read in lists: "Away" wins over their chosen status. */
export const shownStatus = (p: { status: PresenceStatus; away: boolean }) => (p.away ? AWAY : statusInfo(p.status));

const STATUS_KEY = 'synapse.status';

export function loadStatus(): PresenceStatus {
  try {
    const v = localStorage.getItem(STATUS_KEY);
    return STATUS_OPTIONS.some((o) => o.value === v) ? (v as PresenceStatus) : 'available';
  } catch {
    return 'available';
  }
}

export function saveStatus(s: PresenceStatus) {
  try { localStorage.setItem(STATUS_KEY, s); } catch { /* private mode */ }
}
