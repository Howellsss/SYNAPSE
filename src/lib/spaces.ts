import { supabase } from '@/lib/supabase';
import { sendInvitations } from '@/lib/invitations';
import { sizingFor } from '@/spatial/data/sizing';
import type { Space, SpaceType, SizeBand, UserRole } from '@/types';

/** A space with who belongs to it, for the Workspaces grid. */
export interface SpaceWithMembers extends Space {
  memberIds: string[];
}

export async function listSpaces(workspaceId: string): Promise<{ data: SpaceWithMembers[]; error: string | null }> {
  const { data, error } = await supabase
    .from('spaces')
    .select('*, space_members(user_id)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) return { data: [], error: error.message };
  const rows = (data ?? []) as (Space & { space_members: { user_id: string }[] | null })[];
  return {
    data: rows.map(({ space_members, ...space }) => ({
      ...space,
      memberIds: (space_members ?? []).map((m) => m.user_id),
    })),
    error: null,
  };
}

export async function getSpaceBySlug(slug: string): Promise<{ data: Space | null; error: string | null }> {
  const { data, error } = await supabase.from('spaces').select('*').eq('slug', slug).maybeSingle();
  return { data: (data as Space | null) ?? null, error: error?.message ?? null };
}

/** true = free, false = taken, null = couldn't check (the insert still enforces uniqueness). */
export async function isSlugAvailable(slug: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('is_space_slug_available', { p_slug: slug });
  if (error || typeof data !== 'boolean') return null;
  return data;
}

/** Records the person's first visit to a space (their own space_members row). */
export async function markEntered(spaceId: string, userId: string): Promise<void> {
  const { data } = await supabase
    .from('space_members')
    .select('first_entered_at')
    .eq('space_id', spaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (data?.first_entered_at) return;
  await supabase
    .from('space_members')
    .upsert({ space_id: spaceId, user_id: userId, first_entered_at: new Date().toISOString() }, { onConflict: 'space_id,user_id' });
}

export interface NewSpace {
  workspaceId: string;
  userId: string;
  name: string;
  slug: string;
  description: string;
  spaceType: SpaceType;
  sizeBand: SizeBand;
  templateKey: string;
  invites: string[];
  inviteRole: UserRole;
}

export type CreateStage = 'space' | 'membership' | 'invites';

export interface CreateResult {
  space: Space | null;
  error: string | null;
  /** Where it failed, so the wizard can send the user to the right step. */
  failedAt?: CreateStage;
  slugTaken?: boolean;
  /** Invites that could not be sent; the space itself was created. */
  inviteError?: string | null;
}

/**
 * Creates the space, the creator's space_members row and the invites. Safe to call
 * again after a failure: pass the space from the earlier attempt as `existing` and it
 * picks up where it stopped instead of inserting a second space.
 */
export async function createSpace(input: NewSpace, existing: Space | null = null): Promise<CreateResult> {
  let space = existing;

  if (!space) {
    const { data, error } = await supabase
      .from('spaces')
      .insert({
        workspace_id: input.workspaceId,
        name: input.name.trim(),
        slug: input.slug,
        description: input.description.trim() || null,
        space_type: input.spaceType,
        size_band: input.sizeBand,
        template_key: input.templateKey,
        map: {},
        capacity: sizingFor(input.sizeBand).capacity,
        created_by: input.userId,
      })
      .select()
      .single();
    if (error || !data) {
      const slugTaken = error?.code === '23505';
      return {
        space: null,
        failedAt: 'space',
        slugTaken,
        error: slugTaken
          ? 'That link was just taken. Pick another one.'
          : error?.code === '42501'
            ? 'Only workspace owners and admins can create workspaces.'
            : error?.message ?? 'Could not create the workspace.',
      };
    }
    space = data as Space;
  }

  const { error: memberError } = await supabase
    .from('space_members')
    .upsert({ space_id: space.id, user_id: input.userId }, { onConflict: 'space_id,user_id' });
  if (memberError) return { space, failedAt: 'membership', error: memberError.message };

  const { error: inviteError } = await sendInvitations({
    workspaceId: input.workspaceId,
    emails: input.invites,
    role: input.inviteRole,
    invitedBy: input.userId,
  });

  return { space, error: null, inviteError };
}
