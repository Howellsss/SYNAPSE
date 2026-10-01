import type { RoomType, SizeBand, SpaceRoom } from '@/types';
import { sizingFor } from './sizing';
import { templateInfo, BLANK_TEMPLATE } from './templates';

export const ROOM_TYPES: { type: RoomType; label: string }[] = [
  { type: 'open_area', label: 'Open work area' },
  { type: 'meeting_room', label: 'Meeting room' },
  { type: 'private_office', label: 'Private office' },
  { type: 'stage', label: 'Stage' },
  { type: 'quiet_zone', label: 'Quiet zone' },
  { type: 'lounge', label: 'Lounge' },
  { type: 'breakout', label: 'Breakout' },
];

export const MAX_ROOMS = 60;
export const MAX_ROOM_CAPACITY = 1000;

export function roomTypeLabel(type: RoomType): string {
  return ROOM_TYPES.find((r) => r.type === type)?.label ?? 'Room';
}

/** Starting capacity and door settings for each kind of room. */
export const ROOM_DEFAULTS: Record<RoomType, { capacity: number; lockable: boolean; knock_to_enter: boolean }> = {
  open_area: { capacity: 10, lockable: false, knock_to_enter: false },
  meeting_room: { capacity: 6, lockable: true, knock_to_enter: true },
  private_office: { capacity: 2, lockable: true, knock_to_enter: true },
  stage: { capacity: 4, lockable: false, knock_to_enter: false },
  quiet_zone: { capacity: 6, lockable: false, knock_to_enter: false },
  lounge: { capacity: 8, lockable: false, knock_to_enter: false },
  breakout: { capacity: 6, lockable: false, knock_to_enter: false },
};

function slugPart(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'room';
}

/** A short id that is unique among `taken`, readable in exported files. */
export function makeRoomId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugPart(name);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function newRoom(type: RoomType, existing: SpaceRoom[]): SpaceRoom {
  const label = roomTypeLabel(type);
  const sameType = existing.filter((r) => r.type === type).length;
  const name = sameType ? `${label} ${sameType + 1}` : label;
  return { id: makeRoomId(name, existing.map((r) => r.id)), name, type, ...ROOM_DEFAULTS[type] };
}

/**
 * The rooms a new space starts with: the template's rooms, with desk/audience areas
 * sized to the team and repeated rooms (meeting rooms, lounges) matching the team size.
 * Unknown keys and 'blank' give the blank floor.
 */
export function buildRooms(templateKey: string, band: SizeBand): SpaceRoom[] {
  const template = templateInfo(templateKey) ?? BLANK_TEMPLATE;
  const sizing = sizingFor(band);
  const rooms: SpaceRoom[] = [];
  for (const spec of template.rooms) {
    const count = spec.repeat === 'meeting_rooms' ? sizing.meetingRooms : spec.repeat === 'lounges' ? sizing.lounges : 1;
    for (let i = 1; i <= count; i++) {
      const name = count > 1 ? `${spec.name} ${i}` : spec.name;
      const defaults = ROOM_DEFAULTS[spec.type];
      const capacity = spec.capacity === 'desks' ? sizing.desks
        : spec.capacity === 'audience' ? sizing.capacity
          : spec.capacity ?? defaults.capacity;
      rooms.push({
        id: makeRoomId(name, rooms.map((r) => r.id)),
        name,
        type: spec.type,
        capacity,
        lockable: spec.lockable ?? defaults.lockable,
        knock_to_enter: spec.knock_to_enter ?? defaults.knock_to_enter,
      });
    }
  }
  return rooms;
}
