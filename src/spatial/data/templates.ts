import type { SpaceType } from '@/types';

export interface SpaceTemplate {
  key: string;
  name: string;
  type: SpaceType;
  description: string;
  /** Rooms and zones the floor is built with. */
  rooms: string[];
}

/** template_key for a space the owner lays out themselves. */
export const BLANK_TEMPLATE_KEY = 'blank';

export const BLANK_TEMPLATE: Omit<SpaceTemplate, 'type'> = {
  key: BLANK_TEMPLATE_KEY,
  name: 'Blank floor',
  description: 'An empty floor to lay out yourself.',
  rooms: ['Open floor', 'Entrance'],
};

/** Three per type; the first of each type is the recommended one. */
export const TEMPLATES: SpaceTemplate[] = [
  {
    key: 'office-open-plan',
    name: 'Open plan studio',
    type: 'office',
    description: 'Desk clusters around a conversation circle, with a glass meeting room.',
    rooms: ['Desk clusters', 'Glass meeting room', 'Conversation circle', 'Coffee bar', 'Lounge'],
  },
  {
    key: 'office-focus-hub',
    name: 'Focus & collaborate',
    type: 'office',
    description: 'Quiet focus desks on one side, team tables and rooms on the other.',
    rooms: ['Focus desks', 'Team tables', 'Two meeting rooms', 'Phone booths', 'Kitchen'],
  },
  {
    key: 'office-garden-loft',
    name: 'Garden loft',
    type: 'office',
    description: 'A bright loft with a rooftop garden for breaks and walks.',
    rooms: ['Loft desks', 'Meeting room', 'Rooftop garden', 'Library nook', 'Coffee bar'],
  },
  {
    key: 'classroom-lecture',
    name: 'Lecture hall',
    type: 'classroom',
    description: 'A stage with podium and screen facing rows of seats.',
    rooms: ['Stage & podium', 'Big screen', 'Tiered rows', 'Breakout tables', 'Reading corner'],
  },
  {
    key: 'classroom-workshop',
    name: 'Workshop studio',
    type: 'classroom',
    description: 'Group tables around a teaching wall for hands-on sessions.',
    rooms: ['Teaching wall', 'Group tables', 'Materials shelf', 'Breakout pods', 'Lounge'],
  },
  {
    key: 'classroom-seminar',
    name: 'Seminar circle',
    type: 'classroom',
    description: 'A discussion circle with a screen, for small cohorts.',
    rooms: ['Discussion circle', 'Screen', 'Quiet study desks', 'Reading corner'],
  },
  {
    key: 'event-main-stage',
    name: 'Main stage',
    type: 'event_hall',
    description: 'A lit stage, audience seating and a reception at the door.',
    rooms: ['Lit stage', 'Audience seating', 'Backstage', 'Networking tables', 'Reception'],
  },
  {
    key: 'event-expo-floor',
    name: 'Expo floor',
    type: 'event_hall',
    description: 'Booths along the walls around a central talk stage.',
    rooms: ['Exhibitor booths', 'Talk stage', 'Networking lounge', 'Reception', 'Info desk'],
  },
  {
    key: 'event-fireside',
    name: 'Fireside lounge',
    type: 'event_hall',
    description: 'An intimate stage with sofas for fireside chats and panels.',
    rooms: ['Fireside stage', 'Sofa seating', 'Bar tables', 'Reception'],
  },
  {
    key: 'coaching-private-suite',
    name: 'Private suite',
    type: 'coaching_studio',
    description: 'Private session rooms off a calm waiting lounge.',
    rooms: ['Private session rooms', 'Waiting lounge', 'Coach desk', 'Quiet garden'],
  },
  {
    key: 'coaching-group-circle',
    name: 'Group circle',
    type: 'coaching_studio',
    description: 'A circle for group coaching with side rooms for one-to-ones.',
    rooms: ['Group circle', 'One-to-one rooms', 'Whiteboard wall', 'Waiting lounge'],
  },
  {
    key: 'coaching-wellness-garden',
    name: 'Wellness garden',
    type: 'coaching_studio',
    description: 'Session pavilions set in a garden for relaxed conversations.',
    rooms: ['Garden pavilions', 'Walking path', 'Tea corner', 'Waiting lounge'],
  },
  {
    key: 'community-town-square',
    name: 'Town square',
    type: 'community_hub',
    description: 'An open square with a notice board and rooms for groups.',
    rooms: ['Open square', 'Notice board', 'Group rooms', 'Small stage', 'Hangout areas'],
  },
  {
    key: 'community-cafe',
    name: 'Community café',
    type: 'community_hub',
    description: 'A café floor with tables to join and a corner for meetups.',
    rooms: ['Café tables', 'Meetup corner', 'Notice board', 'Lounge'],
  },
  {
    key: 'community-campfire',
    name: 'Campfire',
    type: 'community_hub',
    description: 'A campfire circle outdoors, with tents for smaller groups.',
    rooms: ['Campfire circle', 'Group tents', 'Welcome cabin', 'Hangout areas'],
  },
];

export function templatesFor(type: SpaceType): SpaceTemplate[] {
  return TEMPLATES.filter((t) => t.type === type);
}

export function recommendedTemplate(type: SpaceType): SpaceTemplate {
  return templatesFor(type)[0];
}

/** Name, description and rooms for any template_key, including 'blank'. */
export function templateInfo(key: string | null | undefined): Omit<SpaceTemplate, 'type'> | null {
  if (!key) return null;
  if (key === BLANK_TEMPLATE_KEY) return BLANK_TEMPLATE;
  return TEMPLATES.find((t) => t.key === key) ?? null;
}
