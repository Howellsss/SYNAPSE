import type { RoomType, SpaceType } from '@/types';

/*
 * TODO(Prompt 3): the 3D office is built from the space's saved `config.rooms`
 * (SpaceRoom: id, name, type, capacity, lockable, knock_to_enter), NOT from these
 * templates. A template only seeds config.rooms when the space is created (see
 * buildRooms in ./rooms.ts); after that the owner can rename, add or remove rooms in
 * Configure / Workspace settings, and the map generator must follow config.rooms.
 * Use template_key only to pick the art style and furniture set for the floor.
 */

/** A room or zone a template starts with. Capacity can scale with the team size. */
export interface TemplateRoom {
  name: string;
  type: RoomType;
  /** 'desks' = one place per desk, 'audience' = the whole space's capacity, otherwise a number. */
  capacity?: number | 'desks' | 'audience';
  /** Repeat this room to match the team size (e.g. one meeting room per sizing.meetingRooms). */
  repeat?: 'meeting_rooms' | 'lounges';
  lockable?: boolean;
  knock_to_enter?: boolean;
}

export interface SpaceTemplate {
  key: string;
  name: string;
  type: SpaceType;
  description: string;
  rooms: TemplateRoom[];
}

/** template_key for a space the owner lays out themselves. */
export const BLANK_TEMPLATE_KEY = 'blank';

/** An empty floor sized by team size: open floor plus meeting rooms and lounges to match. */
export const BLANK_TEMPLATE: Omit<SpaceTemplate, 'type'> = {
  key: BLANK_TEMPLATE_KEY,
  name: 'Blank floor',
  description: 'An empty floor to lay out yourself.',
  rooms: [
    { name: 'Open floor', type: 'open_area', capacity: 'desks' },
    { name: 'Meeting room', type: 'meeting_room', repeat: 'meeting_rooms' },
    { name: 'Lounge', type: 'lounge', repeat: 'lounges' },
  ],
};

/** Three per selectable type; the first of each type is the recommended one. */
export const TEMPLATES: SpaceTemplate[] = [
  // Office
  {
    key: 'office-open-plan',
    name: 'Open plan studio',
    type: 'office',
    description: 'Desk clusters around a conversation circle, with a glass meeting room.',
    rooms: [
      { name: 'Desk clusters', type: 'open_area', capacity: 'desks' },
      { name: 'Glass meeting room', type: 'meeting_room', repeat: 'meeting_rooms' },
      { name: 'Conversation circle', type: 'breakout', capacity: 8 },
      { name: 'Coffee bar', type: 'lounge', capacity: 6 },
      { name: 'Lounge', type: 'lounge', repeat: 'lounges' },
    ],
  },
  {
    key: 'office-focus-hub',
    name: 'Focus & collaborate',
    type: 'office',
    description: 'Quiet focus desks on one side, team tables and rooms on the other.',
    rooms: [
      { name: 'Focus desks', type: 'quiet_zone', capacity: 'desks' },
      { name: 'Team tables', type: 'open_area', capacity: 12 },
      { name: 'Meeting room', type: 'meeting_room', repeat: 'meeting_rooms' },
      { name: 'Phone booths', type: 'private_office', capacity: 1 },
      { name: 'Kitchen', type: 'lounge', repeat: 'lounges' },
    ],
  },
  {
    key: 'office-garden-loft',
    name: 'Garden loft',
    type: 'office',
    description: 'A bright loft with a rooftop garden for breaks and walks.',
    rooms: [
      { name: 'Loft desks', type: 'open_area', capacity: 'desks' },
      { name: 'Meeting room', type: 'meeting_room', repeat: 'meeting_rooms' },
      { name: 'Rooftop garden', type: 'lounge', repeat: 'lounges' },
      { name: 'Library nook', type: 'quiet_zone', capacity: 4 },
    ],
  },
  // Co-working
  {
    key: 'coworking-hot-desk',
    name: 'Hot-desk hall',
    type: 'coworking',
    description: 'Shared tables, a coffee bar, phone booths and a bean-bag lounge.',
    rooms: [
      { name: 'Shared tables', type: 'open_area', capacity: 'desks' },
      { name: 'Coffee bar', type: 'lounge', capacity: 10 },
      { name: 'Phone booths', type: 'private_office', capacity: 1 },
      { name: 'Bean-bag lounge', type: 'lounge', repeat: 'lounges' },
      { name: 'Meeting room', type: 'meeting_room', repeat: 'meeting_rooms' },
    ],
  },
  {
    key: 'coworking-studio-loft',
    name: 'Studio loft',
    type: 'coworking',
    description: 'Workbenches along big windows, with bookable studios upstairs.',
    rooms: [
      { name: 'Workbenches', type: 'open_area', capacity: 'desks' },
      { name: 'Bookable studio', type: 'private_office', repeat: 'meeting_rooms' },
      { name: 'Plant wall lounge', type: 'lounge', repeat: 'lounges' },
      { name: 'Quiet corner', type: 'quiet_zone', capacity: 6 },
    ],
  },
  {
    key: 'coworking-community',
    name: 'Community floor',
    type: 'coworking',
    description: 'A long community table, a talk corner and drop-in desks.',
    rooms: [
      { name: 'Community table', type: 'open_area', capacity: 'desks' },
      { name: 'Talk corner', type: 'stage', capacity: 20 },
      { name: 'Meeting room', type: 'meeting_room', repeat: 'meeting_rooms' },
      { name: 'Coffee bar', type: 'lounge', repeat: 'lounges' },
    ],
  },
  // Classroom
  {
    key: 'classroom-lecture',
    name: 'Lecture hall',
    type: 'classroom',
    description: 'A stage with podium and screen facing rows of seats.',
    rooms: [
      { name: 'Stage & podium', type: 'stage', capacity: 3 },
      { name: 'Seating rows', type: 'open_area', capacity: 'desks' },
      { name: 'Breakout table', type: 'breakout', repeat: 'meeting_rooms' },
      { name: 'Reading corner', type: 'quiet_zone', repeat: 'lounges' },
    ],
  },
  {
    key: 'classroom-workshop',
    name: 'Workshop studio',
    type: 'classroom',
    description: 'Group tables around a teaching wall for hands-on sessions.',
    rooms: [
      { name: 'Teaching wall', type: 'stage', capacity: 2 },
      { name: 'Group tables', type: 'open_area', capacity: 'desks' },
      { name: 'Breakout pod', type: 'breakout', repeat: 'meeting_rooms' },
      { name: 'Lounge', type: 'lounge', repeat: 'lounges' },
    ],
  },
  {
    key: 'classroom-seminar',
    name: 'Seminar circle',
    type: 'classroom',
    description: 'A discussion circle with a screen, for small cohorts.',
    rooms: [
      { name: 'Discussion circle', type: 'open_area', capacity: 'desks' },
      { name: 'Study room', type: 'quiet_zone', repeat: 'meeting_rooms' },
      { name: 'Reading corner', type: 'quiet_zone', repeat: 'lounges' },
    ],
  },
  // Event space
  {
    key: 'event-main-stage',
    name: 'Main stage',
    type: 'event_hall',
    description: 'A lit stage, audience seating and a reception at the door.',
    rooms: [
      { name: 'Main stage', type: 'stage', capacity: 6 },
      { name: 'Audience seating', type: 'open_area', capacity: 'audience' },
      { name: 'Backstage', type: 'private_office', capacity: 6, lockable: true, knock_to_enter: true },
      { name: 'Networking table', type: 'breakout', repeat: 'meeting_rooms' },
      { name: 'Reception', type: 'lounge', repeat: 'lounges' },
    ],
  },
  {
    key: 'event-expo-floor',
    name: 'Expo floor',
    type: 'event_hall',
    description: 'Booths along the walls around a central talk stage.',
    rooms: [
      { name: 'Talk stage', type: 'stage', capacity: 4 },
      { name: 'Expo floor', type: 'open_area', capacity: 'audience' },
      { name: 'Exhibitor booth', type: 'meeting_room', repeat: 'meeting_rooms' },
      { name: 'Networking lounge', type: 'lounge', repeat: 'lounges' },
    ],
  },
  {
    key: 'event-fireside',
    name: 'Fireside lounge',
    type: 'event_hall',
    description: 'An intimate stage with sofas for fireside chats and panels.',
    rooms: [
      { name: 'Fireside stage', type: 'stage', capacity: 4 },
      { name: 'Sofa seating', type: 'lounge', capacity: 'audience' },
      { name: 'Bar tables', type: 'breakout', repeat: 'meeting_rooms' },
    ],
  },
  // Coaching studio
  {
    key: 'coaching-private-suite',
    name: 'Private suite',
    type: 'coaching_studio',
    description: 'Glass session rooms off a calm waiting lounge, with a reception.',
    rooms: [
      { name: 'Reception', type: 'lounge', capacity: 4 },
      { name: 'Waiting lounge', type: 'lounge', repeat: 'lounges' },
      { name: 'Session room', type: 'private_office', repeat: 'meeting_rooms' },
      { name: 'Coach desk', type: 'quiet_zone', capacity: 2 },
    ],
  },
  {
    key: 'coaching-group-circle',
    name: 'Group circle',
    type: 'coaching_studio',
    description: 'A circle for group coaching with side rooms for one-to-ones.',
    rooms: [
      { name: 'Group circle', type: 'open_area', capacity: 'desks' },
      { name: 'One-to-one room', type: 'private_office', repeat: 'meeting_rooms' },
      { name: 'Waiting lounge', type: 'lounge', repeat: 'lounges' },
    ],
  },
  {
    key: 'coaching-wellness-garden',
    name: 'Wellness garden',
    type: 'coaching_studio',
    description: 'Session pavilions set in a garden for relaxed conversations.',
    rooms: [
      { name: 'Garden pavilion', type: 'private_office', repeat: 'meeting_rooms' },
      { name: 'Walking path', type: 'open_area', capacity: 'desks' },
      { name: 'Tea corner', type: 'lounge', repeat: 'lounges' },
    ],
  },
  // Town square (keys kept from the earlier "community hub" type so saved spaces still resolve)
  {
    key: 'community-town-square',
    name: 'Town square',
    type: 'town_square',
    description: 'A plaza with a fountain, market stalls, an open-air screen and stage.',
    rooms: [
      { name: 'Plaza', type: 'open_area', capacity: 'audience' },
      { name: 'Open-air stage', type: 'stage', capacity: 6 },
      { name: 'Market stall', type: 'breakout', repeat: 'meeting_rooms' },
      { name: 'Picnic tables', type: 'lounge', repeat: 'lounges' },
    ],
  },
  {
    key: 'community-cafe',
    name: 'Community café',
    type: 'town_square',
    description: 'A café floor with tables to join and a corner for meetups.',
    rooms: [
      { name: 'Café tables', type: 'open_area', capacity: 'audience' },
      { name: 'Meetup corner', type: 'meeting_room', repeat: 'meeting_rooms' },
      { name: 'Lounge', type: 'lounge', repeat: 'lounges' },
    ],
  },
  {
    key: 'community-campfire',
    name: 'Campfire',
    type: 'town_square',
    description: 'A campfire circle outdoors, with tents for smaller groups.',
    rooms: [
      { name: 'Campfire circle', type: 'open_area', capacity: 'audience' },
      { name: 'Group tent', type: 'breakout', repeat: 'meeting_rooms' },
      { name: 'Welcome cabin', type: 'lounge', repeat: 'lounges' },
    ],
  },
];

export function templatesFor(type: SpaceType): SpaceTemplate[] {
  return TEMPLATES.filter((t) => t.type === type);
}

/** The recommended (first) template for a type, or the blank floor when the type has none. */
export function recommendedTemplate(type: SpaceType): Omit<SpaceTemplate, 'type'> {
  return templatesFor(type)[0] ?? BLANK_TEMPLATE;
}

/** Name, description and rooms for any template_key, including 'blank'. */
export function templateInfo(key: string | null | undefined): Omit<SpaceTemplate, 'type'> | null {
  if (!key) return null;
  if (key === BLANK_TEMPLATE_KEY) return BLANK_TEMPLATE;
  return TEMPLATES.find((t) => t.key === key) ?? null;
}
