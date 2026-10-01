import { describe, it, expect } from 'vitest';
import { parseLayoutFile, checkLayoutFileMeta, exportLayout, MAX_LAYOUT_BYTES } from './layoutFile';

const valid = {
  format: 'synapse-space',
  version: 1,
  name: 'Lagos HQ',
  space_type: 'office',
  size_band: 'small',
  template_key: 'office-open-plan',
  map: { floor: 'wood' },
  config: { rooms: [
    { id: 'desks', name: 'Desk clusters', type: 'open_area', capacity: 10, lockable: false, knock_to_enter: false },
    { id: 'meet', name: 'Glass room', type: 'meeting_room', capacity: 6, lockable: true, knock_to_enter: true },
  ] },
};

describe('layout file import', () => {
  it('accepts a valid file', () => {
    const r = parseLayoutFile(JSON.stringify(valid));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.layout.space_type).toBe('office');
      expect(r.layout.config.rooms).toHaveLength(2);
      expect(r.layout.map).toEqual({ floor: 'wood' });
    }
  });

  it('explains invalid JSON', () => {
    const r = parseLayoutFile('{oops');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/valid JSON/);
  });

  it('rejects files that are not SYNAPSE layouts', () => {
    const r = parseLayoutFile(JSON.stringify({ hello: 'world' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join(' ')).toMatch(/not a SYNAPSE layout/);
      expect(r.errors.join(' ')).toMatch(/config.rooms/);
    }
  });

  it('lists every room problem with the room it belongs to', () => {
    const bad = {
      ...valid,
      config: { rooms: [
        { id: 'Bad Id', name: '', type: 'garage', capacity: 0, lockable: 'yes', knock_to_enter: false },
        { id: 'desks', name: 'A', type: 'lounge', capacity: 2, lockable: false, knock_to_enter: false },
        { id: 'desks', name: 'B', type: 'lounge', capacity: 2.5, lockable: false, knock_to_enter: false },
      ] },
    };
    const r = parseLayoutFile(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const text = r.errors.join('\n');
      expect(text).toMatch(/Room 1: id must be/);
      expect(text).toMatch(/Room 1: name must be/);
      expect(text).toMatch(/Room 1: type must be one of/);
      expect(text).toMatch(/Room 1: capacity must be/);
      expect(text).toMatch(/Room 1: lockable must be/);
      expect(text).toMatch(/Room 3 \("B"\): id "desks" is used twice/);
      expect(text).toMatch(/Room 3 \("B"\): capacity must be a whole number/);
    }
  });

  it('rejects campus and unknown types, versions and team sizes', () => {
    const r1 = parseLayoutFile(JSON.stringify({ ...valid, space_type: 'campus' }));
    expect(!r1.ok && r1.errors[0]).toMatch(/Campus layouts can't be imported/);
    const r2 = parseLayoutFile(JSON.stringify({ ...valid, version: 2, size_band: 'huge' }));
    expect(!r2.ok && r2.errors.join(' ')).toMatch(/Unsupported layout version 2[\s\S]*Unknown team size/);
  });

  it('rejects empty room lists and too many rooms', () => {
    const empty = parseLayoutFile(JSON.stringify({ ...valid, config: { rooms: [] } }));
    expect(!empty.ok && empty.errors[0]).toMatch(/no rooms/);
    const many = parseLayoutFile(JSON.stringify({ ...valid, config: { rooms: Array.from({ length: 61 }, (_, i) => ({ ...valid.config.rooms[0], id: `r${i}` })) } }));
    expect(!many.ok && many.errors[0]).toMatch(/61 rooms; the most is 60/);
  });

  it('drops unknown template keys instead of failing', () => {
    const r = parseLayoutFile(JSON.stringify({ ...valid, template_key: 'from-the-future' }));
    expect(r.ok && r.layout.template_key).toBeUndefined();
  });

  it('checks file name and size before reading', () => {
    expect(checkLayoutFileMeta({ name: 'office.png', size: 10 })).toMatch(/synapse-space\.json/);
    expect(checkLayoutFileMeta({ name: 'big.synapse-space.json', size: MAX_LAYOUT_BYTES + 1 })).toMatch(/up to 2 MB/);
    expect(checkLayoutFileMeta({ name: 'empty.json', size: 0 })).toMatch(/empty/);
    expect(checkLayoutFileMeta({ name: 'ok.synapse-space.json', size: 500 })).toBeNull();
  });
});

describe('layout file export', () => {
  it('round-trips through import and carries no access details', () => {
    const file = exportLayout({ name: 'Lagos HQ', space_type: 'office', size_band: 'small', template_key: 'office-open-plan', map: {}, config: { rooms: valid.config.rooms as never } });
    expect(Object.keys(file).sort()).toEqual(['config', 'format', 'map', 'name', 'size_band', 'space_type', 'template_key', 'version']);
    const r = parseLayoutFile(JSON.stringify(file));
    expect(r.ok).toBe(true);
  });
});
