import { describe, it, expect, beforeEach } from 'vitest';
import {
  stepsFor, wizardReducer, freshState, stepPosition, isLastStep, effectiveRooms, effectiveTemplateKey,
  effectiveType, canContinue, readDraft, type WizardState,
} from './state';
import type { LayoutFile } from '@/spatial/layoutFile';

const run = (state: WizardState, ...actions: Parameters<typeof wizardReducer>[1][]) => actions.reduce(wizardReducer, state);

describe('wizard step order', () => {
  it('template types: 8 steps', () => {
    expect(stepsFor('office')).toEqual(['name', 'type', 'size', 'layout', 'configure', 'invite', 'avatar', 'media']);
    expect(stepsFor('event_hall')).toHaveLength(8);
  });

  it('Custom Space skips Layout: 7 steps', () => {
    expect(stepsFor('custom')).toEqual(['name', 'type', 'size', 'configure', 'invite', 'avatar', 'media']);
  });

  it('Import replaces Size and Layout with Import: 7 steps', () => {
    expect(stepsFor('import')).toEqual(['name', 'type', 'import', 'configure', 'invite', 'avatar', 'media']);
  });

  it('next/back walk the branch for the chosen type', () => {
    let s = run(freshState(), { type: 'setName', name: 'Team' }, { type: 'goTo', step: 'type' }, { type: 'setTypeChoice', choice: 'custom' });
    s = run(s, { type: 'next' }, { type: 'next' });
    expect(s.step).toBe('configure');
    expect(stepPosition(s)).toEqual({ index: 4, total: 7, label: 'Configure' });
    s = run(s, { type: 'back' });
    expect(s.step).toBe('size');
  });

  it('knows the last step and progress for each branch', () => {
    const s = run(freshState(), { type: 'setTypeChoice', choice: 'import' }, { type: 'goTo', step: 'media' });
    expect(isLastStep(s)).toBe(true);
    expect(stepPosition(s)).toEqual({ index: 7, total: 7, label: 'Camera & mic' });
  });
});

describe('wizard choices', () => {
  it('Custom Space starts from an empty floor sized by team size', () => {
    const s = run(freshState(), { type: 'setTypeChoice', choice: 'custom' }, { type: 'setSizeBand', sizeBand: 'large' });
    expect(effectiveTemplateKey(s)).toBe('blank');
    const rooms = effectiveRooms(s);
    expect(rooms[0]).toMatchObject({ name: 'Open floor', capacity: 50 });
    expect(rooms.filter((r) => r.type === 'meeting_room')).toHaveLength(4);
  });

  it('applies the type defaults when the type changes', () => {
    const s = run(freshState(), { type: 'setTypeChoice', choice: 'event_hall' });
    expect(s.accessMode).toBe('guest_link');
    expect(s.persistence).toBe('scheduled');
    expect(effectiveTemplateKey(s)).toBe('event-main-stage');
  });

  it('cannot choose Campus yet', () => {
    const s = run(freshState(), { type: 'setTypeChoice', choice: 'campus' });
    expect(s.typeChoice).toBe('office');
  });

  it('rebuilds rooms when the template or size changes, keeps edits otherwise', () => {
    let s = run(freshState(), { type: 'setRooms', rooms: [{ id: 'x', name: 'Mine', type: 'lounge', capacity: 3, lockable: false, knock_to_enter: false }] });
    expect(effectiveRooms(s)[0].name).toBe('Mine');
    s = run(s, { type: 'setSizeBand', sizeBand: 'xl' });
    expect(effectiveRooms(s)[0].name).not.toBe('Mine');
  });

  it('import takes type, size and rooms from the file and requires one', () => {
    const layout: LayoutFile = {
      format: 'synapse-space', version: 1, name: 'Shared HQ', space_type: 'classroom', size_band: 'medium',
      map: {}, config: { rooms: [{ id: 'stage', name: 'Stage', type: 'stage', capacity: 3, lockable: false, knock_to_enter: false }] },
    };
    let s = run(freshState(), { type: 'setTypeChoice', choice: 'import' }, { type: 'goTo', step: 'import' });
    expect(canContinue(s, 'available')).toBe(false);
    s = run(s, { type: 'setImported', layout, fileName: 'hq.synapse-space.json' });
    expect(canContinue(s, 'available')).toBe(true);
    expect(effectiveType(s)).toBe('classroom');
    expect(effectiveRooms(s).map((r) => r.id)).toEqual(['stage']);
    expect(s.name).toBe('Shared HQ');
  });

  it('configure needs at least one named room and a valid schedule', () => {
    let s = run(freshState(), { type: 'goTo', step: 'configure' });
    expect(canContinue(s, 'available')).toBe(true);
    s = run(s, { type: 'setRooms', rooms: [] });
    expect(canContinue(s, 'available')).toBe(false);
    s = run(s, { type: 'resetRooms' }, { type: 'setPersistence', persistence: 'scheduled' }, { type: 'setSchedule', schedule: { ...s.schedule, recurrence: 'weekly', days: [] } });
    expect(canContinue(s, 'available')).toBe(false);
  });
});

describe('draft restore', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    };
  });

  it('upgrades a first-version draft (numeric step, spaceType)', () => {
    window.sessionStorage.setItem('synapse.spaceDraft.ws', JSON.stringify({ step: 5, name: 'Old', slug: 'old', spaceType: 'community_hub', sizeBand: 'small', templateKey: 'community-cafe' }));
    const d = readDraft('ws')!;
    expect(d.typeChoice).toBe('town_square');
    expect(d.step).toBe('invite');
    expect(d.templateKey).toBe('community-cafe');
  });

  it('ignores junk', () => {
    window.sessionStorage.setItem('synapse.spaceDraft.ws', '{bad');
    expect(readDraft('ws')).toBeNull();
  });
});
