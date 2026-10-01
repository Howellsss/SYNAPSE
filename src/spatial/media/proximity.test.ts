import { describe, expect, it } from 'vitest';
import {
  candidatePairs, canEnterZone, computeProximity, inRange, linkFor, volumeAt, zoneRule,
  EDGE_VOLUME, type ProxPerson, type ZoneRule,
} from './proximity';

const at = (id: string, x: number, z = 0, zoneId: string | null = null): ProxPerson => ({ id, pos: { x, z }, zoneId });
const zones = new Map<string, ZoneRule>([
  ['meet', 'closed'], ['office', 'closed'], ['stage', 'stage'], ['quiet', 'quiet'], ['lounge', 'open'],
]);

describe('range and hysteresis', () => {
  it('enters at 4 tiles and leaves only beyond 5', () => {
    expect(inRange(4, false)).toBe(true);
    expect(inRange(4.5, false)).toBe(false);
    expect(inRange(4.5, true)).toBe(true);
    expect(inRange(5, true)).toBe(true);
    expect(inRange(5.01, true)).toBe(false);
    expect(inRange(null, true)).toBe(false);
  });

  it('keeps a conversation going while drifting between 4 and 5 tiles', () => {
    let r = computeProximity('me', [at('me', 0), at('ama', 3.9)], zones, null);
    expect(r.links.has('ama')).toBe(true);
    r = computeProximity('me', [at('me', 0), at('ama', 4.8)], zones, r.state);
    expect(r.links.has('ama')).toBe(true);
    r = computeProximity('me', [at('me', 0), at('ama', 5.2)], zones, r.state);
    expect(r.links.has('ama')).toBe(false);
    r = computeProximity('me', [at('me', 0), at('ama', 4.8)], zones, r.state);
    expect(r.links.has('ama')).toBe(false); // must come back within 4
  });
});

describe('volume falloff', () => {
  it('is full up close and about 20% at the edge', () => {
    expect(volumeAt(0)).toBe(1);
    expect(volumeAt(1.5)).toBe(1);
    expect(volumeAt(4)).toBeCloseTo(EDGE_VOLUME);
    expect(volumeAt(4.8)).toBeCloseTo(EDGE_VOLUME);
    expect(volumeAt(2.75)).toBeGreaterThan(0.5);
    expect(volumeAt(2.75)).toBeLessThan(0.7);
  });

  it('is full inside a room whatever the distance', () => {
    expect(linkFor(at('me', 0, 0, 'meet'), at('ama', 8, 0, 'meet'), zones, false)).toMatchObject({ volume: 1, reason: 'same-room' });
  });
});

describe('zone rules', () => {
  it('maps room types', () => {
    expect(zoneRule('meeting_room')).toBe('closed');
    expect(zoneRule('private_office')).toBe('closed');
    expect(zoneRule('stage')).toBe('stage');
    expect(zoneRule('quiet_zone')).toBe('quiet');
    expect(zoneRule('lounge')).toBe('open');
    expect(zoneRule(null)).toBe('open');
  });

  it('closed rooms: everyone inside, nobody outside, even right by the wall', () => {
    expect(linkFor(at('me', 0, 0, 'meet'), at('ama', 9, 0, 'meet'), zones, false)).not.toBeNull();
    expect(linkFor(at('me', 0, 0, 'meet'), at('out', 0.5), zones, false)).toBeNull();
    expect(linkFor(at('out', 0.5), at('me', 0, 0, 'meet'), zones, false)).toBeNull();
    expect(linkFor(at('me', 0, 0, 'meet'), at('other', 0.5, 0, 'office'), zones, false)).toBeNull();
  });

  it('stage: speakers reach the whole space; the audience only reaches people nearby', () => {
    const speaker = at('speaker', 0, 0, 'stage');
    expect(linkFor(at('far', 40), speaker, zones, false)).toMatchObject({ audio: true, reason: 'stage', volume: 1 });
    expect(linkFor(speaker, at('far', 40), zones, false)).toBeNull();
    expect(linkFor(speaker, at('front-row', 2), zones, false)).toMatchObject({ reason: 'nearby' });
    // Closed rooms and quiet zones don't hear the stage.
    expect(linkFor(at('meeting', 3, 0, 'meet'), speaker, zones, false)).toBeNull();
    expect(linkFor(at('reader', 3, 0, 'quiet'), speaker, zones, false)).toBeNull();
  });

  it('quiet zone: no audio or video in or out', () => {
    expect(linkFor(at('me', 0, 0, 'quiet'), at('ama', 1, 0, 'quiet'), zones, false)).toBeNull();
    expect(linkFor(at('me', 0), at('ama', 1, 0, 'quiet'), zones, false)).toBeNull();
  });

  it('lounges behave like the open floor', () => {
    expect(linkFor(at('me', 0, 0, 'lounge'), at('ama', 2), zones, false)).toMatchObject({ reason: 'nearby' });
  });

  it('locked rooms let in admins and people who knocked and were admitted', () => {
    expect(canEnterZone('closed', true, false, false)).toBe(false);
    expect(canEnterZone('closed', true, true, false)).toBe(true);
    expect(canEnterZone('closed', true, false, true)).toBe(true);
    expect(canEnterZone('closed', false, false, false)).toBe(true);
    expect(canEnterZone('open', true, false, false)).toBe(true);
  });
});

describe('groups', () => {
  it('chains people who are each in range into one group with a floor circle', () => {
    const r = computeProximity('me', [at('me', 0), at('a', 3), at('b', 6), at('far', 30)], zones, null);
    expect(r.myGroup.sort()).toEqual(['a', 'b']);
    expect(r.links.has('b')).toBe(false); // b is in my group but too far to hear directly
    const g = r.groups.find((x) => x.ids.includes('me'))!;
    expect(g.circle!.x).toBeCloseTo(3);
    expect(g.circle!.r).toBeCloseTo(4);
    expect(r.groups).toHaveLength(1);
  });

  it('a closed room is one group without a floor circle', () => {
    const r = computeProximity('me', [at('me', 0, 0, 'meet'), at('a', 6, 0, 'meet')], zones, null);
    expect(r.groups).toEqual([{ ids: ['a', 'me'], circle: null }]);
  });

  it('unplaced people only join by room', () => {
    const r = computeProximity('me', [{ id: 'me', pos: null, zoneId: null }, at('a', 0)], zones, null);
    expect(r.links.size).toBe(0);
  });
});

describe('data saver', () => {
  it('keeps audio for everyone but video for the nearest 2', () => {
    const people = [at('me', 0), at('a', 1), at('b', 2), at('c', 3), at('d', 0.5)];
    const r = computeProximity('me', people, zones, null, { dataSaver: true });
    expect(r.links.size).toBe(4);
    expect(r.videoIds.sort()).toEqual(['a', 'd']);
    expect(computeProximity('me', people, zones, null).videoIds).toHaveLength(4);
  });
});

describe('spatial hash', () => {
  it('finds the same links as checking every pair', () => {
    const people: ProxPerson[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 120; i++) people.push(at(`p${i}`, rnd() * 60, rnd() * 60, i % 17 === 0 ? 'meet' : null));
    const hashed = new Set(candidatePairs(people).map(([a, b]) => `${a},${b}`));
    // Every truly linked pair must be among the hashed candidates.
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const linked = linkFor(people[i], people[j], zones, true)?.reason;
        if (linked === 'nearby' || linked === 'same-room') expect(hashed.has(`${i},${j}`)).toBe(true);
      }
    }
    expect(hashed.size).toBeLessThan((120 * 119) / 2 / 3);
  });
});
