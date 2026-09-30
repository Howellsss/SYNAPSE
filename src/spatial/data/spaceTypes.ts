import { Briefcase, GraduationCap, Mic2, HeartHandshake, Users, type LucideIcon } from 'lucide-react';
import type { SpaceType } from '@/types';

export interface SpaceTypeInfo {
  type: SpaceType;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Four short highlights shown in the live preview. */
  features: [string, string, string, string];
}

export const SPACE_TYPES: SpaceTypeInfo[] = [
  {
    type: 'office',
    name: 'Office',
    description: 'Desks, meeting rooms and a lounge for everyday teamwork.',
    icon: Briefcase,
    features: ['Personal desks', 'Meeting rooms', 'Drop-in chats', 'Coffee lounge'],
  },
  {
    type: 'classroom',
    name: 'Classroom',
    description: 'A stage, rows of seats and breakout tables for teaching.',
    icon: GraduationCap,
    features: ['Stage & screen', 'Rows of seats', 'Breakout tables', 'Reading corner'],
  },
  {
    type: 'event_hall',
    name: 'Event hall',
    description: 'A lit stage and audience seating for talks and launches.',
    icon: Mic2,
    features: ['Lit stage', 'Audience seating', 'Networking tables', 'Reception desk'],
  },
  {
    type: 'coaching_studio',
    name: 'Coaching studio',
    description: 'Calm private rooms for one-to-one and small-group sessions.',
    icon: HeartHandshake,
    features: ['Private rooms', 'Group circle', 'Waiting lounge', 'Quiet garden'],
  },
  {
    type: 'community_hub',
    name: 'Community hub',
    description: 'An open square where members meet, mingle and host meetups.',
    icon: Users,
    features: ['Open square', 'Group rooms', 'Notice board', 'Hangout areas'],
  },
];

export function spaceTypeInfo(type: SpaceType): SpaceTypeInfo {
  return SPACE_TYPES.find((t) => t.type === type) ?? SPACE_TYPES[0];
}
