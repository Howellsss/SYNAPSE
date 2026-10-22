import type { SpacePermissionKey, SpacePermissions, UserRole } from '@/types';
import { publicOrigin } from '@/lib/publicUrl';

export const PERMISSION_ROWS: { key: SpacePermissionKey; label: string }[] = [
  { key: 'edit_office', label: 'Edit the office' },
  { key: 'lock_rooms', label: 'Lock rooms' },
  { key: 'broadcast', label: 'Broadcast to everyone' },
  { key: 'invite', label: 'Invite people' },
];

export const ROLES: UserRole[] = ['owner', 'admin', 'member'];

export const DEFAULT_PERMISSIONS: SpacePermissions = {
  edit_office: ['owner', 'admin'],
  lock_rooms: ['owner', 'admin'],
  broadcast: ['owner', 'admin'],
  invite: ['owner', 'admin'],
};

/** Turn a role on or off for one permission. Owners always keep every permission. */
export function togglePermission(perms: SpacePermissions, key: SpacePermissionKey, role: UserRole, on: boolean): SpacePermissions {
  if (role === 'owner') return perms;
  const current = new Set(perms[key]);
  if (on) current.add(role); else current.delete(role);
  current.add('owner');
  return { ...perms, [key]: ROLES.filter((r) => current.has(r)) };
}

export function can(perms: SpacePermissions | null | undefined, key: SpacePermissionKey, role: UserRole | null): boolean {
  if (!role) return false;
  if (role === 'owner') return true;
  return (perms ?? DEFAULT_PERMISSIONS)[key]?.includes(role) ?? false;
}

/** Unguessable token for "anyone with a guest link" (32 random bytes, URL-safe). */
export function generateGuestToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function guestLinkUrl(token: string, origin = publicOrigin()): string {
  return `${origin}/join/${token}`;
}
