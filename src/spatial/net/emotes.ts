import type { EmoteKind } from './protocol';

export type ReactionKind = 'wave' | 'cheer' | 'heart';

/** Reactions everyone in the space sees (raise/lower hand have their own button). */
export const REACTIONS: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: 'wave', emoji: '👋', label: 'Wave' },
  { kind: 'cheer', emoji: '🎉', label: 'Cheer' },
  { kind: 'heart', emoji: '❤️', label: 'Heart' },
];

export const EMOTE_EMOJI: Record<EmoteKind, string> = {
  wave: '👋', cheer: '🎉', heart: '❤️', raise_hand: '✋', lower_hand: '✋',
};
