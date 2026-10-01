import {
  Building2, UsersRound, GraduationCap, CalendarDays, UserRound, Users, Landmark, SquarePlus, CloudUpload,
  Briefcase, Building, Rocket, School, Presentation, Megaphone, HeartHandshake, Sparkles, Globe, Wand2,
  type LucideIcon,
} from 'lucide-react';
import type { AccessMode, Persistence, SpacePermissions, SpaceType } from '@/types';

/** Cards on the "Choose a workspace type" step: every space type, plus importing a layout file. */
export type TypeChoice = SpaceType | 'import';

/** Which steps follow the type step (see stepsFor in the wizard state). */
export type TypeFlow = 'template' | 'custom' | 'import';

export interface TypeDefaults {
  access_mode: AccessMode;
  persistence: Persistence;
  permissions: SpacePermissions;
}

export interface SpaceTypeInfo {
  key: TypeChoice;
  /** The value stored in spaces.space_type. Import takes the type from the file. */
  type: SpaceType | null;
  name: string;
  /** Two short lines on the card. */
  description: string;
  icon: LucideIcon;
  /** Card and panel picture (optimised WebP in /public). Null shows a drawn placeholder. */
  image: string | null;
  bestFor: { label: string; icon: LucideIcon }[];
  recommendedTeamSize: string;
  /** Real workspace features, shown as a checklist. */
  features: string[];
  flow: TypeFlow;
  /** Not selectable yet. */
  comingSoon?: boolean;
  /** Starting access, availability and permissions on the Configure step. */
  defaults: TypeDefaults;
}

const STAFF: SpacePermissions['edit_office'] = ['owner', 'admin'];
const EVERYONE: SpacePermissions['edit_office'] = ['owner', 'admin', 'member'];
const BASE_PERMISSIONS: SpacePermissions = { edit_office: STAFF, lock_rooms: STAFF, broadcast: STAFF, invite: STAFF };

const IMG = (file: string) => `/assets/spatial/type-cards/${file}.webp`;

export const SPACE_TYPE_CHOICES: SpaceTypeInfo[] = [
  {
    key: 'office',
    type: 'office',
    name: 'Office',
    description: 'A professional space for focused work and team collaboration.',
    icon: Building2,
    image: IMG('office'),
    bestFor: [{ label: 'Teams', icon: Users }, { label: 'Companies', icon: Building }, { label: 'Departments', icon: Briefcase }],
    recommendedTeamSize: '5 – 250',
    features: [
      'Personal desks and open work areas',
      'Private meeting rooms you can lock',
      'Proximity video: walk over to talk',
      'Access control for members and guests',
      'Flexible layouts you can change any time',
    ],
    flow: 'template',
    defaults: { access_mode: 'members', persistence: 'always_on', permissions: { ...BASE_PERMISSIONS, lock_rooms: EVERYONE } },
  },
  {
    key: 'coworking',
    type: 'coworking',
    name: 'Co-working Space',
    description: 'A flexible, open environment for independent work and networking.',
    icon: UsersRound,
    image: IMG('coworking'),
    bestFor: [{ label: 'Freelancers', icon: UserRound }, { label: 'Start-ups', icon: Rocket }, { label: 'Communities', icon: Users }],
    recommendedTeamSize: '10 – 200',
    features: [
      'Hot-desk tables anyone can sit at',
      'Phone booths for private calls',
      'Proximity video at every table',
      'Coffee bar and lounge for networking',
      'Guest passes with a shareable link',
    ],
    flow: 'template',
    defaults: { access_mode: 'members', persistence: 'always_on', permissions: { ...BASE_PERMISSIONS, lock_rooms: EVERYONE } },
  },
  {
    key: 'classroom',
    type: 'classroom',
    name: 'Classroom',
    description: 'A structured space for teaching, learning and training sessions.',
    icon: GraduationCap,
    image: IMG('classroom'),
    bestFor: [{ label: 'Teachers', icon: Presentation }, { label: 'Schools', icon: School }, { label: 'Trainers', icon: Sparkles }],
    recommendedTeamSize: '5 – 100',
    features: [
      'Stage with screen for the teacher',
      'Broadcast to the whole class',
      'Breakout tables for group work',
      'Invite-only entry for enrolled students',
      'Quiet reading corner',
    ],
    flow: 'template',
    defaults: { access_mode: 'invite_only', persistence: 'always_on', permissions: BASE_PERMISSIONS },
  },
  {
    key: 'event_hall',
    type: 'event_hall',
    name: 'Event Space',
    description: 'A versatile venue for meetings, workshops and special events.',
    icon: CalendarDays,
    image: IMG('event-space'),
    bestFor: [{ label: 'Launches', icon: Rocket }, { label: 'Workshops', icon: Presentation }, { label: 'Meetups', icon: Megaphone }],
    recommendedTeamSize: '20 – 500',
    features: [
      'Lit stage with audience seating',
      'Broadcast speakers to everyone',
      'Networking tables after the talks',
      'Guest link so attendees need no account',
      'Opens and closes on a schedule',
    ],
    flow: 'template',
    defaults: { access_mode: 'guest_link', persistence: 'scheduled', permissions: BASE_PERMISSIONS },
  },
  {
    key: 'coaching_studio',
    type: 'coaching_studio',
    name: 'Coaching Studio',
    description: 'A private, comfortable space for one-on-one sessions and mentoring.',
    icon: UserRound,
    image: IMG('coaching-studio'),
    bestFor: [{ label: 'Coaches', icon: HeartHandshake }, { label: 'Mentors', icon: Sparkles }, { label: 'Therapists', icon: UserRound }],
    recommendedTeamSize: '1 – 25',
    features: [
      'Glass 1-to-1 session rooms with knock to enter',
      'Calm waiting lounge for clients',
      'Lockable rooms for private conversations',
      'Invite-only access for clients',
      'Link sessions to your SYNAPSE calendar',
    ],
    flow: 'template',
    defaults: { access_mode: 'invite_only', persistence: 'always_on', permissions: BASE_PERMISSIONS },
  },
  {
    key: 'town_square',
    type: 'town_square',
    name: 'Town Square',
    description: 'A vibrant, open space for casual meetups, networking and community.',
    icon: Users,
    image: IMG('town-square'),
    bestFor: [{ label: 'Communities', icon: Users }, { label: 'Networks', icon: Globe }, { label: 'Fan clubs', icon: Sparkles }],
    recommendedTeamSize: '20 – 1000',
    features: [
      'Open plaza with a stage and big screen',
      'Proximity video: join any circle',
      'Group rooms for smaller meetups',
      'Guest link for newcomers',
      'Broadcast announcements to everyone',
    ],
    flow: 'template',
    defaults: { access_mode: 'guest_link', persistence: 'always_on', permissions: BASE_PERMISSIONS },
  },
  {
    key: 'campus',
    type: 'campus',
    name: 'Campus',
    description: 'A complete campus with multiple buildings and shared spaces.',
    icon: Landmark,
    image: IMG('campus'),
    bestFor: [{ label: 'Universities', icon: School }, { label: 'Large orgs', icon: Building }, { label: 'Conferences', icon: Megaphone }],
    recommendedTeamSize: '200+',
    features: [
      'Several linked buildings',
      'Shared quad and paths between them',
      'Separate access per building',
      'Proximity video everywhere',
    ],
    flow: 'template',
    comingSoon: true,
    defaults: { access_mode: 'members', persistence: 'always_on', permissions: BASE_PERMISSIONS },
  },
  {
    key: 'custom',
    type: 'custom',
    name: 'Custom Space',
    description: 'Start with a blank canvas and design your own workspace.',
    icon: SquarePlus,
    image: null,
    bestFor: [{ label: 'Designers', icon: Wand2 }, { label: 'Any team', icon: Users }, { label: 'Special uses', icon: Sparkles }],
    recommendedTeamSize: 'Any',
    features: [
      'Empty floor sized for your team',
      'Add only the rooms and zones you need',
      'Proximity video and private rooms',
      'Access control for members and guests',
    ],
    flow: 'custom',
    defaults: { access_mode: 'members', persistence: 'always_on', permissions: BASE_PERMISSIONS },
  },
  {
    key: 'import',
    type: null,
    name: 'Import Template',
    description: 'Use a pre-designed layout and make it your own.',
    icon: CloudUpload,
    image: null,
    bestFor: [{ label: 'Teams with a layout', icon: Users }, { label: 'Agencies', icon: Briefcase }, { label: 'Copying a space', icon: Building2 }],
    recommendedTeamSize: 'From the file',
    features: [
      'Upload a .synapse-space.json layout',
      'Rooms and zones come from the file',
      'Export any workspace to share its layout',
      'Change anything after importing',
    ],
    flow: 'import',
    defaults: { access_mode: 'members', persistence: 'always_on', permissions: BASE_PERMISSIONS },
  },
];

/** The stored types (everything except "import"). */
export const SPACE_TYPES = SPACE_TYPE_CHOICES.filter((c): c is SpaceTypeInfo & { type: SpaceType } => c.type !== null);

export function typeChoiceInfo(key: TypeChoice): SpaceTypeInfo {
  return SPACE_TYPE_CHOICES.find((c) => c.key === key) ?? SPACE_TYPE_CHOICES[0];
}

/** Display info for a stored space type. Unknown values (old data) fall back to Office. */
export function spaceTypeInfo(type: SpaceType | string): SpaceTypeInfo {
  return SPACE_TYPES.find((t) => t.type === type) ?? SPACE_TYPES[0];
}

export const CUSTOMISE_NOTE = 'You can customise everything later and add more rooms and zones.';
