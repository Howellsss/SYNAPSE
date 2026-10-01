import { HEARTBEAT_MS, MAX_MOVES_PER_SECOND, PATH_CORRECTION_MS } from './protocol';

export interface VolumeInput {
  users: number;
  /** People moving with the keyboard at any moment (10 msgs/s each). */
  keyboardMovers: number;
  /** People walking a clicked path at any moment (1 correction/s each, plus the path message). */
  pathWalkers: number;
  /** Average seconds a clicked walk lasts. */
  walkSeconds?: number;
  heartbeatMs?: number;
  /** Presence updates (join, status, zone change, away) per person per hour. */
  presenceUpdatesPerHour?: number;
  /** Emotes per person per hour. */
  emotesPerHour?: number;
}

/**
 * Rough Realtime message volume for one space. Supabase counts a broadcast once per client that
 * receives it, so each message sent is delivered to everyone else (`users - 1`; we don't echo
 * to ourselves).
 */
export function estimateVolume({
  users, keyboardMovers, pathWalkers, walkSeconds = 6, heartbeatMs = HEARTBEAT_MS,
  presenceUpdatesPerHour = 6, emotesPerHour = 4,
}: VolumeInput) {
  const standing = Math.max(0, users - keyboardMovers - pathWalkers);
  const sentPerSecond =
    keyboardMovers * MAX_MOVES_PER_SECOND +
    pathWalkers * (1000 / PATH_CORRECTION_MS + 1 / walkSeconds) +
    (heartbeatMs > 0 ? standing * (1000 / heartbeatMs) : 0) +
    (users * (presenceUpdatesPerHour + emotesPerHour)) / 3600;
  const deliveredPerSecond = sentPerSecond * Math.max(0, users - 1);
  const perHour = deliveredPerSecond * 3600;
  return {
    sentPerSecond,
    deliveredPerSecond,
    perHour,
    /** An 8-hour working day. */
    perDay: perHour * 8,
    /** 22 working days. */
    perMonth: perHour * 8 * 22,
  };
}
