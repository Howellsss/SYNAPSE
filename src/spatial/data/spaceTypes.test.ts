import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SPACE_TYPE_CHOICES, SPACE_TYPES, spaceTypeInfo, typeChoiceInfo } from './spaceTypes';
import { templatesFor } from './templates';
import { buildRooms } from './rooms';
import type { SpaceType } from '@/types';

const DB_TYPES: SpaceType[] = ['office', 'coworking', 'classroom', 'event_hall', 'coaching_studio', 'town_square', 'campus', 'custom'];

describe('space type data', () => {
  it('lists the cards in the designed order', () => {
    expect(SPACE_TYPE_CHOICES.map((c) => c.name)).toEqual([
      'Office', 'Co-working Space', 'Classroom', 'Event Space', 'Coaching Studio', 'Town Square', 'Campus', 'Custom Space', 'Import Template',
    ]);
  });

  it('covers every database space_type exactly once', () => {
    expect(SPACE_TYPES.map((t) => t.type).sort()).toEqual([...DB_TYPES].sort());
  });

  it('fills in everything the card and the "at a glance" panel show', () => {
    for (const c of SPACE_TYPE_CHOICES) {
      expect(c.name, c.key).toBeTruthy();
      expect(c.description.length, c.key).toBeGreaterThan(20);
      expect(c.description.length, `${c.key} description fits two lines`).toBeLessThanOrEqual(80);
      expect(c.icon, c.key).toBeTruthy();
      expect(c.bestFor.length, c.key).toBeGreaterThanOrEqual(2);
      expect(c.recommendedTeamSize, c.key).toBeTruthy();
      expect(c.features.length, c.key).toBeGreaterThanOrEqual(4);
      expect(c.defaults.permissions.edit_office, c.key).toContain('owner');
    }
  });

  it('has a WebP image in /public for every card that names one', () => {
    for (const c of SPACE_TYPE_CHOICES) {
      if (!c.image) continue;
      expect(c.image).toMatch(/^\/assets\/spatial\/type-cards\/.+\.webp$/);
      expect(existsSync(resolve(__dirname, '../../../public', c.image.slice(1))), c.image).toBe(true);
    }
  });

  it('only Campus is "coming soon"', () => {
    expect(SPACE_TYPE_CHOICES.filter((c) => c.comingSoon).map((c) => c.key)).toEqual(['campus']);
  });

  it('gives every selectable template type three templates that build rooms', () => {
    for (const c of SPACE_TYPE_CHOICES) {
      if (c.flow !== 'template' || c.comingSoon || !c.type) continue;
      const list = templatesFor(c.type);
      expect(list.length, c.key).toBe(3);
      for (const t of list) expect(buildRooms(t.key, 'small').length, t.key).toBeGreaterThan(0);
    }
  });

  it('uses the sensible defaults per type', () => {
    expect(typeChoiceInfo('event_hall').defaults).toMatchObject({ access_mode: 'guest_link', persistence: 'scheduled' });
    expect(typeChoiceInfo('classroom').defaults.access_mode).toBe('invite_only');
    expect(typeChoiceInfo('classroom').defaults.permissions.broadcast).not.toContain('member');
    expect(typeChoiceInfo('office').defaults).toMatchObject({ access_mode: 'members', persistence: 'always_on' });
  });

  it('falls back to Office for unknown stored types', () => {
    expect(spaceTypeInfo('community_hub').type).toBe('office');
  });
});
