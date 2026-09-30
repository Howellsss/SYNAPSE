import { supabase } from '@/lib/supabase';
import type { UserRole } from '@/types';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(normalizeEmail(email));
}

/** Link an invitee opens to accept (handled by AcceptInvitePage). */
export function invitationLink(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

export interface InviteOptions {
  workspaceId: string;
  emails: string[];
  role: UserRole;
  invitedBy: string | null;
  assignedCalendarIds?: string[];
}

/**
 * Invite people to the tenant workspace (team_invitations). Accepting adds them to
 * workspace_members; if they already use SYNAPSE they just sign in, no new account.
 */
export async function sendInvitations({
  workspaceId, emails, role, invitedBy, assignedCalendarIds = [],
}: InviteOptions): Promise<{ error: string | null; count: number }> {
  const unique = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (unique.length === 0) return { error: null, count: 0 };
  const { error } = await supabase.from('team_invitations').insert(
    unique.map((email) => ({
      workspace_id: workspaceId,
      email,
      role,
      assigned_calendar_ids: assignedCalendarIds,
      invited_by: invitedBy,
    })),
  );
  return { error: error?.message ?? null, count: error ? 0 : unique.length };
}
