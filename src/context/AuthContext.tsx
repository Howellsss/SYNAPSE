import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile, Workspace, WorkspaceMember, UserRole } from '@/types';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  workspace: Workspace | null;
  membership: WorkspaceMember | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  role: UserRole | null;
  canManageTeam: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [membership, setMembership] = useState<WorkspaceMember | null>(null);
  const [loading, setLoading] = useState(true);

  async function acceptPendingInvitations(userId: string, email: string) {
    const { data: invites } = await supabase
      .from('team_invitations')
      .select('id, workspace_id, role')
      .eq('email', email.toLowerCase())
      .eq('status', 'pending');
    if (!invites || invites.length === 0) return;
    for (const inv of invites) {
      await supabase.from('workspace_members').upsert(
        { workspace_id: inv.workspace_id, user_id: userId, role: inv.role, status: 'active' },
        { onConflict: 'workspace_id,user_id' }
      );
      await supabase.from('team_invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', inv.id);
    }
  }

  async function loadUserData(userId: string) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    setProfile(prof as Profile | null);

    const { data: members } = await supabase
      .from('workspace_members')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);

    const member = members && members.length > 0 ? members[0] : null;

    if (member) {
      const memberData = member as unknown as WorkspaceMember;
      const { data: workspaceData } = await supabase
        .from('workspaces')
        .select('*')
        .eq('id', memberData.workspace_id)
        .maybeSingle();
      const resolvedWorkspace = workspaceData ?? (await supabase
        .from('workspaces')
        .select('*')
        .eq('owner_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()).data;

      setMembership({
        id: memberData.id,
        workspace_id: memberData.workspace_id,
        user_id: memberData.user_id,
        role: memberData.role,
        status: (memberData as { status?: string }).status as WorkspaceMember['status'] ?? 'active',
        created_at: memberData.created_at,
      });
      setWorkspace(resolvedWorkspace as Workspace | null);
    } else {
      const { data: ownedWorkspace } = await supabase
        .from('workspaces')
        .select('*')
        .eq('owner_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (ownedWorkspace) {
        const { data: restoredMember } = await supabase
          .from('workspace_members')
          .upsert(
            { workspace_id: ownedWorkspace.id, user_id: userId, role: 'owner' },
            { onConflict: 'workspace_id,user_id' },
          )
          .select()
          .maybeSingle();
        setWorkspace(ownedWorkspace as Workspace);
        setMembership((restoredMember as WorkspaceMember | null) ?? {
          id: '',
          workspace_id: ownedWorkspace.id,
          user_id: userId,
          role: 'owner',
          status: 'active',
          created_at: ownedWorkspace.created_at,
        });
      } else {
        setMembership(null);
        setWorkspace(null);
      }
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadUserData(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    let isInitialSession = true;
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        if (!isInitialSession) {
          (async () => {
            await loadUserData(session.user.id);
            setLoading(false);
          })();
        }
      } else if (event === 'SIGNED_OUT') {
        setProfile(null);
        setWorkspace(null);
        setMembership(null);
        setLoading(false);
      }
      isInitialSession = false;
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    if (data.user) {
      await acceptPendingInvitations(data.user.id, email);
      await loadUserData(data.user.id);
    }
    return { error: null };
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, last_name: lastName },
      },
    });
    if (error) return { error: error.message };

    if (data.user) {
      await supabase.from('profiles').upsert({
        user_id: data.user.id,
        first_name: firstName,
        last_name: lastName,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });

      // Accept any pending invitations for this email
      await acceptPendingInvitations(data.user.id, email);

      const workspaceSlug = slugifyWorkspace(`${firstName}-${lastName}-workspace`);
      const { data: ws } = await supabase
        .from('workspaces')
        .insert({
          name: `${firstName}'s Workspace`,
          slug: workspaceSlug,
          owner_id: data.user.id,
        })
        .select()
        .single();

      if (ws) {
        await supabase.from('workspace_members').insert({
          workspace_id: ws.id,
          user_id: data.user.id,
          role: 'owner',
        });

        await supabase.rpc('seed_workspace_demo_data', {
          p_workspace_id: ws.id,
          p_owner_id: data.user.id,
        });
      }

      await loadUserData(data.user.id);
    }

    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setWorkspace(null);
    setMembership(null);
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/#/reset-password',
    });
    return { error: error?.message ?? null };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  };

  const refreshProfile = async () => {
    if (user) await loadUserData(user.id);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        workspace,
        membership,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
        resetPassword,
        updatePassword,
        role: membership?.role ?? null,
        canManageTeam: membership?.role === 'owner' || membership?.role === 'admin',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function slugifyWorkspace(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
