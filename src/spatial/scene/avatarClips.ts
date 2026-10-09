/**
 * Which animation clip of a character plays for each thing an avatar does in a space.
 * Uploaded characters (e.g. from Meshy) name their clips freely ("Walking", "ymca_dance"), so the
 * Characters page lets you choose; until you do, sensible guesses are made from the names.
 */
import type { Character } from '@/types';

export type AvatarAction = 'idle' | 'walk' | 'wave' | 'cheer';
export const AVATAR_ACTIONS: AvatarAction[] = ['idle', 'walk', 'wave', 'cheer'];

export const AVATAR_ACTION_LABELS: Record<AvatarAction, { label: string; hint: string }> = {
  idle: { label: 'Standing', hint: 'Plays while someone stands still' },
  walk: { label: 'Walking', hint: 'Plays while someone walks' },
  wave: { label: 'Wave', hint: 'Plays once for the 👋 reaction' },
  cheer: { label: 'Cheer', hint: 'Plays once for the 🎉 reaction' },
};

/** Clip name per action; null = no clip (standing still in the default pose, or no gesture). */
export type SpaceClips = Record<AvatarAction, string | null>;

const PATTERNS: Record<AvatarAction, RegExp[]> = {
  idle: [/idle/i, /stand/i, /breath/i],
  walk: [/walk/i, /jog/i, /run/i],
  wave: [/wave/i, /greet/i, /hello/i, /\bhi\b/i],
  cheer: [/cheer/i, /celebrat/i, /victory/i, /clap/i, /joy/i, /dance/i],
};

const firstMatch = (names: string[], patterns: RegExp[]) => {
  for (const p of patterns) {
    const hit = names.find((n) => p.test(n));
    if (hit) return hit;
  }
  return null;
};

/**
 * Best guesses from clip names. Standing falls back to the character's default clip, unless that
 * clip is the walk (a walk on the spot looks wrong), and then to nothing.
 */
export function guessSpaceClips(clipNames: string[], defaultClip: string | null = null): SpaceClips {
  const walk = firstMatch(clipNames, PATTERNS.walk);
  const fallbackIdle = defaultClip && clipNames.includes(defaultClip) && defaultClip !== walk && !PATTERNS.walk.some((p) => p.test(defaultClip))
    ? defaultClip : null;
  return {
    idle: firstMatch(clipNames, PATTERNS.idle) ?? fallbackIdle,
    walk,
    wave: firstMatch(clipNames, PATTERNS.wave),
    cheer: firstMatch(clipNames, PATTERNS.cheer),
  };
}

/** Saved choices (only clips that still exist), filling the gaps with guesses. */
export function resolveSpaceClips(character: Pick<Character, 'clips' | 'default_clip' | 'space_clips'>): SpaceClips {
  const names = character.clips.map((c) => c.name);
  const guess = guessSpaceClips(names, character.default_clip);
  const saved = character.space_clips ?? {};
  const out = { ...guess };
  for (const action of AVATAR_ACTIONS) {
    if (!(action in saved)) continue;
    const v = saved[action];
    if (v === null) out[action] = null;
    else if (typeof v === 'string' && names.includes(v)) out[action] = v;
  }
  return out;
}

/** The character people appear as in this workspace's spaces: the chosen one, else the newest. */
export function pickSpaceCharacter<T extends Pick<Character, 'use_in_spaces' | 'created_at'>>(characters: T[]): T | null {
  if (!characters.length) return null;
  const chosen = characters.find((c) => c.use_in_spaces);
  if (chosen) return chosen;
  return [...characters].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}
