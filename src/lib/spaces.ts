import { supabase } from '@/lib/supabase';
import { sendInvitations } from '@/lib/invitations';
import { sizingFor } from '@/spatial/data/sizing';
import type {
  AccessMode, MediaPrefs, Persistence, Space, SpaceBranding, SpaceConfig, SpacePermissions, SpaceSchedule, SpaceType, SizeBand, UserRole,
} from '@/types';

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

/** Whether the person has entered this space before. Null when it couldn't be checked. */
export async function hasEntered(spaceId: string, userId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('space_members')
    .select('first_entered_at')
    .eq('space_id', spaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  return !!(data as { first_entered_at: string | null } | null)?.first_entered_at;
}

/** Saves how the person joins spaces (muted, camera off, data saver) on their profile. */
export async function saveMediaPrefs(userId: string, prefs: MediaPrefs): Promise<string | null> {
  const { error } = await supabase.from('profiles').update({ media_prefs: prefs }).eq('user_id', userId);
  return error?.message ?? null;
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
  /** Imported map data, or {} until the map builder fills it in. */
  map?: Record<string, unknown>;
  accessMode: AccessMode;
  guestLinkToken: string | null;
  permissions: SpacePermissions;
  persistence: Persistence;
  /** Saved only when persistence is 'scheduled'. */
  schedule: SpaceSchedule | null;
  branding: SpaceBranding;
  config: SpaceConfig;
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
        map: input.map ?? {},
        capacity: sizingFor(input.sizeBand).capacity,
        access_mode: input.accessMode,
        guest_link_token: input.accessMode === 'guest_link' ? input.guestLinkToken : null,
        permissions: input.permissions,
        persistence: input.persistence,
        schedule: input.persistence === 'scheduled' ? input.schedule : null,
        branding: input.branding,
        config: input.config,
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

/** Fields the Workspace settings panel can change. */
export type SpaceSettingsPatch = Partial<Pick<Space,
  'name' | 'description' | 'access_mode' | 'guest_link_token' | 'permissions' | 'persistence' | 'schedule' | 'branding' | 'config'>>;

export async function updateSpace(spaceId: string, patch: SpaceSettingsPatch): Promise<{ data: Space | null; error: string | null }> {
  const { data, error } = await supabase
    .from('spaces')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', spaceId)
    .select()
    .maybeSingle();
  if (error) return { data: null, error: error.code === '42501' ? 'Only workspace owners and admins can change these settings.' : error.message };
  if (!data) return { data: null, error: 'Only workspace owners and admins can change these settings.' };
  return { data: data as Space, error: null };
}

/** Calendars the user can link a schedule to: the account's, plus their own without an account. */
export async function listCalendars(workspaceId: string, userId: string): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase
    .from('calendars')
    .select('id, name')
    .or(`workspace_id.eq.${workspaceId},owner_id.eq.${userId}`)
    .order('name');
  return (data ?? []) as { id: string; name: string }[];
}

/** Uploads a workspace logo to the public workspace-logos bucket (same bucket as account logos). */
export async function uploadSpaceLogo(workspaceId: string, file: File): Promise<{ url: string | null; error: string | null }> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `spaces/${workspaceId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('workspace-logos').upload(path, file, { upsert: false, contentType: file.type });
  if (error) return { url: null, error: error.message };
  const { data } = supabase.storage.from('workspace-logos').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

/** What a guest sees about a guest-link space (from the join_space_as_guest RPC). */
export interface GuestSpaceInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  space_type: SpaceType;
  template_key: string;
  capacity: number;
  persistence: Persistence;
  schedule: SpaceSchedule | null;
  branding: SpaceBranding;
  config: SpaceConfig;
  map: Record<string, unknown>;
}

/** Works without signing in. Returns null for unknown tokens or spaces that aren't guest-link. */
export async function joinSpaceAsGuest(token: string): Promise<{ data: GuestSpaceInfo | null; error: string | null }> {
  const { data, error } = await supabase.rpc('join_space_as_guest', { p_token: token });
  if (error) return { data: null, error: error.message };
  return { data: (data as GuestSpaceInfo | null) ?? null, error: null };
}
