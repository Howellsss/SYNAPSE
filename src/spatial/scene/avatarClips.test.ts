import { describe, expect, it } from 'vitest';
import { characterFor, chosenCharacterId, guessSpaceClips, pickSpaceCharacter, resolveSpaceClips } from './avatarClips';

const meshy = ['Joyful_Dance_with_Hand_Sway', 'Running', 'Walking', 'ymca_dance'];

describe('guessSpaceClips', () => {
  it('guesses from Meshy clip names', () => {
    expect(guessSpaceClips(meshy, 'ymca_dance')).toEqual({
      idle: 'ymca_dance', walk: 'Walking', wave: null, cheer: 'Joyful_Dance_with_Hand_Sway',
    });
  });
  it('prefers a real idle clip and a walk over a run', () => {
    expect(guessSpaceClips(['Run', 'Idle_Breathing', 'Walk_Cycle', 'Wave_Hello'], null)).toEqual({
      idle: 'Idle_Breathing', walk: 'Walk_Cycle', wave: 'Wave_Hello', cheer: null,
    });
  });
  it('never stands still with the walk clip', () => {
    expect(guessSpaceClips(['Walking', 'Running'], 'Walking').idle).toBeNull();
    expect(guessSpaceClips(['Walking', 'Running'], 'Running').idle).toBeNull();
  });
  it('handles a file without clips', () => {
    expect(guessSpaceClips([], null)).toEqual({ idle: null, walk: null, wave: null, cheer: null });
  });
});

describe('resolveSpaceClips', () => {
  const clips = meshy.map((name) => ({ name, duration: 1 }));
  it('uses saved choices that still exist, and guesses the rest', () => {
    expect(resolveSpaceClips({ clips, default_clip: 'Walking', space_clips: { idle: 'Running', cheer: 'Gone', wave: null } })).toEqual({
      idle: 'Running', walk: 'Walking', wave: null, cheer: 'Joyful_Dance_with_Hand_Sway',
    });
  });
  it('works before the columns exist', () => {
    expect(resolveSpaceClips({ clips, default_clip: null }).walk).toBe('Walking');
  });
});

describe('pickSpaceCharacter', () => {
  const a = { id: 'a', use_in_spaces: false, created_at: '2026-10-01T00:00:00Z' };
  const b = { id: 'b', created_at: '2026-10-05T00:00:00Z' };
  const c = { id: 'c', use_in_spaces: true, created_at: '2026-09-01T00:00:00Z' };
  it('uses the chosen character, else the newest', () => {
    expect(pickSpaceCharacter([a, b, c])?.id).toBe('c');
    expect(pickSpaceCharacter([a, b])?.id).toBe('b');
    expect(pickSpaceCharacter([])).toBeNull();
  });
});

describe('choosing your character', () => {
  const lib = [
    { id: 'man', use_in_spaces: true, created_at: '2026-10-01T00:00:00Z' },
    { id: 'mo', use_in_spaces: false, created_at: '2026-10-10T00:00:00Z' },
  ];
  it('reads the pick from the profile', () => {
    expect(chosenCharacterId({ characterId: 'mo' })).toBe('mo');
    expect(chosenCharacterId({ characterId: 42 })).toBeNull();
    expect(chosenCharacterId(null)).toBeNull();
    expect(chosenCharacterId(['mo'])).toBeNull();
  });
  it('uses the pick, else the default (also when the pick was deleted)', () => {
    expect(characterFor(lib, 'mo')?.id).toBe('mo');
    expect(characterFor(lib, null)?.id).toBe('man');
    expect(characterFor(lib, 'deleted')?.id).toBe('man');
    expect(characterFor([], 'mo')).toBeNull();
  });
});
