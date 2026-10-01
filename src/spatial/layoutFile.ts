import type { RoomType, SizeBand, Space, SpaceRoom, SpaceType } from '@/types';
import { MAX_ROOMS, MAX_ROOM_CAPACITY, ROOM_TYPES } from './data/rooms';
import { templateInfo } from './data/templates';

/** A shareable workspace layout (`.synapse-space.json`). */
export interface LayoutFile {
  format: 'synapse-space';
  version: 1;
  name?: string;
  space_type: SpaceType;
  size_band?: SizeBand;
  template_key?: string;
  map: Record<string, unknown>;
  config: { rooms: SpaceRoom[] };
}

export const LAYOUT_FILE_EXTENSION = '.synapse-space.json';
export const MAX_LAYOUT_BYTES = 2 * 1024 * 1024;

const IMPORTABLE_TYPES: SpaceType[] = ['office', 'coworking', 'classroom', 'event_hall', 'coaching_studio', 'town_square', 'custom'];
const SIZE_BANDS: SizeBand[] = ['solo', 'small', 'medium', 'large', 'xl'];
const ROOM_TYPE_KEYS = ROOM_TYPES.map((r) => r.type);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export type LayoutResult = { ok: true; layout: LayoutFile } | { ok: false; errors: string[] };

/** Check a layout file's name and size before reading it. */
export function checkLayoutFileMeta(file: { name: string; size: number }): string | null {
  if (!file.name.toLowerCase().endsWith('.json')) return `Choose a ${LAYOUT_FILE_EXTENSION} file.`;
  if (file.size > MAX_LAYOUT_BYTES) return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Layout files can be up to 2 MB.`;
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/** Parse and validate the text of a layout file. Every problem is listed, in plain language. */
export function parseLayoutFile(text: string): LayoutResult {
  if (new Blob([text]).size > MAX_LAYOUT_BYTES) return { ok: false, errors: ['Layout files can be up to 2 MB.'] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["This isn't a valid JSON file. Export a layout from SYNAPSE and try again."] };
  }
  if (!isObject(data)) return { ok: false, errors: ['The file should contain a single layout object.'] };

  const errors: string[] = [];
  if (data.format !== 'synapse-space') errors.push('This is not a SYNAPSE layout file (format must be "synapse-space").');
  if (data.version !== 1) errors.push(`Unsupported layout version ${JSON.stringify(data.version ?? null)}. This SYNAPSE reads version 1.`);
  if (!IMPORTABLE_TYPES.includes(data.space_type as SpaceType)) {
    errors.push(data.space_type === 'campus'
      ? 'Campus layouts can\'t be imported yet.'
      : `Unknown workspace type ${JSON.stringify(data.space_type ?? null)}.`);
  }
  if (data.size_band !== undefined && !SIZE_BANDS.includes(data.size_band as SizeBand)) errors.push(`Unknown team size ${JSON.stringify(data.size_band)}.`);
  if (data.template_key !== undefined && typeof data.template_key !== 'string') errors.push('template_key must be text.');
  if (data.name !== undefined && (typeof data.name !== 'string' || data.name.length > 60)) errors.push('name must be text of 60 characters or fewer.');
  if (data.map !== undefined && !isObject(data.map)) errors.push('map must be an object.');

  const rooms: SpaceRoom[] = [];
  if (!isObject(data.config) || !Array.isArray(data.config.rooms)) {
    errors.push('config.rooms must be a list of rooms.');
  } else if (data.config.rooms.length === 0) {
    errors.push('The layout has no rooms.');
  } else if (data.config.rooms.length > MAX_ROOMS) {
    errors.push(`The layout has ${data.config.rooms.length} rooms; the most is ${MAX_ROOMS}.`);
  } else {
    const ids = new Set<string>();
    data.config.rooms.forEach((raw: unknown, i: number) => {
      const where = `Room ${i + 1}`;
      if (!isObject(raw)) { errors.push(`${where} is not an object.`); return; }
      const label = typeof raw.name === 'string' && raw.name.trim() ? `${where} ("${raw.name.trim().slice(0, 30)}")` : where;
      if (typeof raw.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(raw.id)) errors.push(`${label}: id must be 1–40 lowercase letters, numbers or hyphens.`);
      else if (ids.has(raw.id)) errors.push(`${label}: id "${raw.id}" is used twice.`);
      else ids.add(raw.id);
      if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 60) errors.push(`${label}: name must be 1–60 characters.`);
      if (!ROOM_TYPE_KEYS.includes(raw.type as RoomType)) errors.push(`${label}: type must be one of ${ROOM_TYPE_KEYS.join(', ')}.`);
      if (!Number.isInteger(raw.capacity) || (raw.capacity as number) < 1 || (raw.capacity as number) > MAX_ROOM_CAPACITY) {
        errors.push(`${label}: capacity must be a whole number from 1 to ${MAX_ROOM_CAPACITY}.`);
      }
      if (typeof raw.lockable !== 'boolean') errors.push(`${label}: lockable must be true or false.`);
      if (typeof raw.knock_to_enter !== 'boolean') errors.push(`${label}: knock_to_enter must be true or false.`);
      rooms.push({
        id: String(raw.id), name: String(raw.name ?? '').trim(), type: raw.type as RoomType,
        capacity: Number(raw.capacity), lockable: !!raw.lockable, knock_to_enter: !!raw.knock_to_enter,
      });
    });
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    layout: {
      format: 'synapse-space',
      version: 1,
      name: typeof data.name === 'string' ? data.name : undefined,
      space_type: data.space_type as SpaceType,
      size_band: data.size_band as SizeBand | undefined,
      // Only keep keys this version knows; otherwise the floor starts blank.
      template_key: typeof data.template_key === 'string' && templateInfo(data.template_key) ? data.template_key : undefined,
      map: isObject(data.map) ? data.map : {},
      config: { rooms },
    },
  };
}

/** The shareable layout of an existing space. No account, member or access details. */
export function exportLayout(space: Pick<Space, 'name' | 'space_type' | 'size_band' | 'template_key' | 'map' | 'config'>): LayoutFile {
  return {
    format: 'synapse-space',
    version: 1,
    name: space.name,
    space_type: space.space_type === 'campus' ? 'custom' : space.space_type,
    size_band: space.size_band,
    template_key: space.template_key,
    map: space.map ?? {},
    config: { rooms: space.config?.rooms ?? [] },
  };
}

export function layoutFileName(slug: string): string {
  return `${slug || 'workspace'}${LAYOUT_FILE_EXTENSION}`;
}
