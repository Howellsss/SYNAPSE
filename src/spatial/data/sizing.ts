import type { SizeBand, SpaceType } from '@/types';

export interface SizeOption {
  band: SizeBand;
  label: string;
  /** People range, e.g. "2–10 people". */
  people: string;
}

export const SIZE_OPTIONS: SizeOption[] = [
  { band: 'solo', label: 'Just me', people: '1 person' },
  { band: 'small', label: '2–10', people: '2–10 people' },
  { band: 'medium', label: '11–25', people: '11–25 people' },
  { band: 'large', label: '26–50', people: '26–50 people' },
  { band: 'xl', label: '50+', people: '50+ people' },
];

export interface SpaceSizing {
  desks: number;
  meetingRooms: number;
  lounges: number;
  /** Most people in the space at once (stored as spaces.capacity). */
  capacity: number;
}

/**
 * What a new space is set up with for each team size. Desks cover the top of the
 * band; capacity leaves room for guests on top of the desks.
 */
export const SIZING: Record<SizeBand, SpaceSizing> = {
  solo: { desks: 1, meetingRooms: 1, lounges: 1, capacity: 6 },
  small: { desks: 10, meetingRooms: 1, lounges: 1, capacity: 15 },
  medium: { desks: 25, meetingRooms: 2, lounges: 1, capacity: 35 },
  large: { desks: 50, meetingRooms: 4, lounges: 2, capacity: 70 },
  xl: { desks: 80, meetingRooms: 6, lounges: 3, capacity: 120 },
};

export function sizingFor(band: SizeBand): SpaceSizing {
  return SIZING[band];
}

/** The same numbers, named the way each kind of space talks about them. */
const LABELS: Record<SpaceType, { desk: [string, string]; room: [string, string]; lounge: [string, string] }> = {
  office: { desk: ['desk', 'desks'], room: ['meeting room', 'meeting rooms'], lounge: ['lounge', 'lounges'] },
  classroom: { desk: ['seat', 'seats'], room: ['breakout room', 'breakout rooms'], lounge: ['reading corner', 'reading corners'] },
  event_hall: { desk: ['seat', 'seats'], room: ['networking table', 'networking tables'], lounge: ['reception area', 'reception areas'] },
  coaching_studio: { desk: ['chair', 'chairs'], room: ['private session room', 'private session rooms'], lounge: ['waiting lounge', 'waiting lounges'] },
  town_square: { desk: ['spot', 'spots'], room: ['group area', 'group areas'], lounge: ['hangout area', 'hangout areas'] },
  coworking: { desk: ['hot desk', 'hot desks'], room: ['meeting room', 'meeting rooms'], lounge: ['lounge', 'lounges'] },
  campus: { desk: ['seat', 'seats'], room: ['building room', 'building rooms'], lounge: ['common area', 'common areas'] },
  custom: { desk: ['place', 'places'], room: ['meeting room', 'meeting rooms'], lounge: ['lounge', 'lounges'] },
};

const plural = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`;

export function setupSummary(band: SizeBand, type: SpaceType): { key: string; text: string }[] {
  const s = SIZING[band];
  const l = LABELS[type];
  return [
    { key: 'desks', text: plural(s.desks, l.desk) },
    { key: 'rooms', text: plural(s.meetingRooms, l.room) },
    { key: 'lounges', text: plural(s.lounges, l.lounge) },
    { key: 'capacity', text: `Room for ${s.capacity} people at once` },
  ];
}
