/**
 * What each person can see. Owners and Admins see everything. Users see the sections in their
 * `workspace_members.access` list, or the standard set when nobody has chosen for them:
 * Conversations, Workspaces, Meetings (with their rooms) and their own Calendars.
 * The database enforces the same list (member_can() in 20261022120000_roles_and_access.sql).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { UserRole } from '@/types';

export type Feature =
  | 'dashboard' | 'conversations' | 'contacts' | 'calendars' | 'meetings' | 'workspaces' | 'events' | 'streams'
  | 'webinars' | 'forms' | 'workflows' | 'recordings' | 'media' | 'ai';

/** Every section an Admin can switch on for a User, in menu order. */
export const FEATURES: { key: Feature; label: string; hint: string }[] = [
  { key: 'conversations', label: 'Conversations', hint: 'Channels and direct messages with the team' },
  { key: 'workspaces', label: 'Workspaces', hint: 'Walk into the office and talk to people' },
  { key: 'meetings', label: 'Meetings', hint: 'Join and start meetings, use the rooms assigned to them' },
  { key: 'calendars', label: 'Calendars', hint: 'Only the calendars they own or are a host of' },
  { key: 'dashboard', label: 'Dashboard', hint: 'The company overview' },
  { key: 'contacts', label: 'Contacts', hint: 'All contacts, notes, tasks and emails' },
  { key: 'forms', label: 'Forms and surveys', hint: 'Build forms and see submissions' },
  { key: 'workflows', label: 'Workflows', hint: 'Build and run automations' },
  { key: 'events', label: 'Events', hint: 'Event pages and registrations' },
  { key: 'streams', label: 'Streams', hint: 'Go live' },
  { key: 'webinars', label: 'Webinars', hint: '' },
  { key: 'recordings', label: 'Recordings', hint: 'Meeting recordings' },
  { key: 'media', label: 'Media Library', hint: '' },
  { key: 'ai', label: 'AI Hub', hint: '' },
];

export const DEFAULT_USER_ACCESS: Feature[] = ['conversations', 'workspaces', 'meetings', 'calendars'];

const isAdminRole = (role: UserRole | null | undefined) => role === 'owner' || role === 'admin';

export function canUse(role: UserRole | null | undefined, access: string[] | null | undefined, feature: Feature): boolean {
  if (isAdminRole(role)) return true;
  return (access ?? DEFAULT_USER_ACCESS).includes(feature);
}

/** The section a path belongs to; null for places everyone can open (Settings, your profile). */
export function featureForPath(path: string): Feature | null {
  const p = path.split('?')[0];
  if (p === '/' || p.startsWith('/dashboard')) return 'dashboard';
  const map: [RegExp, Feature][] = [
    [/^\/conversations/, 'conversations'], [/^\/contacts/, 'contacts'], [/^\/calendars/, 'calendars'],
    [/^\/(meetings|rooms)/, 'meetings'], [/^\/workspaces?(\/|$)/, 'workspaces'], [/^\/events/, 'events'],
    [/^\/streams/, 'streams'], [/^\/webinars/, 'webinars'], [/^\/forms/, 'forms'], [/^\/workflows/, 'workflows'],
    [/^\/recordings/, 'recordings'], [/^\/media-library/, 'media'], [/^\/ai-hub/, 'ai'],
  ];
  return map.find(([re]) => re.test(p))?.[1] ?? null;
}

const HOME: [Feature, string][] = [
  ['dashboard', '/dashboard'], ['conversations', '/conversations'], ['workspaces', '/workspace'], ['meetings', '/meetings'],
  ['calendars', '/calendars'], ['contacts', '/contacts'], ['forms', '/forms'], ['workflows', '/workflows'],
];

/** Where someone lands: the Dashboard, or the first section they can use. */
export function homePath(role: UserRole | null | undefined, access: string[] | null | undefined): string {
  return HOME.find(([f]) => canUse(role, access, f))?.[1] ?? '/settings';
}

// One copy of the signed-in person's list, shared by the menu, the dock and the page guard.
let cache: { key: string; access: string[] | null } | null = null;
let pending: string | null = null;
const listeners = new Set<() => void>();

async function load(key: string, workspaceId: string, userId: string) {
  if (pending === key) return;
  pending = key;
  const { data, error } = await supabase.from('workspace_members').select('access').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
  pending = null;
  // Before the database update is run the column doesn't exist: the standard set applies.
  cache = { key, access: !error && Array.isArray(data?.access) ? (data!.access as string[]) : null };
  listeners.forEach((l) => l());
}

/** The signed-in person's role and what they can use. `ready` is false while their list loads. */
export function useAccess() {
  const { user, workspace, role } = useAuth();
  const key = user && workspace ? `${workspace.id}:${user.id}` : '';
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  useEffect(() => {
    if (key && cache?.key !== key && !isAdminRole(role)) void load(key, workspace!.id, user!.id);
  }, [key, role, workspace, user]);
  const access = cache?.key === key ? cache.access : null;
  const ready = !key || isAdminRole(role) || cache?.key === key;
  return {
    role,
    access,
    ready,
    isAdmin: isAdminRole(role),
    can: (f: Feature) => canUse(role, access, f),
    home: homePath(role, access),
  };
}

/** After an Admin changes someone's list, drop the cached copy so it's read again. */
export function forgetAccess() { cache = null; listeners.forEach((l) => l()); }
