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
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<{ error: string | null; needsConfirmation?: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  role: UserRole | null;
  canManageTeam: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// One setup run per user per page load, so the sign-in call and the auth
// listener can't both create a workspace for the same new account.
const accountSetupInFlight = new Map<string, Promise<boolean>>();

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

  // Creates the profile and first workspace for a brand-new account. Runs on the
  // first signed-in load, because with email confirmation on there is no session
  // at sign-up time and row-level security rejects these writes.
  function setUpNewAccount(authUser: User): Promise<boolean> {
    const existing = accountSetupInFlight.get(authUser.id);
    if (existing) return existing;

    const run = (async () => {
      const meta = authUser.user_metadata ?? {};
      const firstName = (meta.first_name as string | undefined)?.trim() || authUser.email?.split('@')[0] || 'My';
      const lastName = (meta.last_name as string | undefined)?.trim() || '';

      await supabase.from('profiles').upsert(
        {
          user_id: authUser.id,
          first_name: firstName,
          last_name: lastName,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        },
        { onConflict: 'user_id' },
      );

      if (authUser.email) await acceptPendingInvitations(authUser.id, authUser.email);

      const workspaceSlug = slugifyWorkspace(`${firstName}-${lastName}-workspace`);
      const { data: ws } = await supabase
        .from('workspaces')
        .insert({
          name: `${firstName}'s Workspace`,
          slug: workspaceSlug,
          owner_id: authUser.id,
        })
        .select()
        .single();

      if (!ws) return false;

      await supabase.from('workspace_members').insert({
        workspace_id: ws.id,
        user_id: authUser.id,
        role: 'owner',
      });

      await supabase.rpc('seed_workspace_demo_data', {
        p_workspace_id: ws.id,
        p_owner_id: authUser.id,
      });
      return true;
    })();

    accountSetupInFlight.set(authUser.id, run);
    return run;
  }

  async function loadUserData(authUser: User, allowSetup = true) {
    const userId = authUser.id;
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
      } else if (allowSetup && (await setUpNewAccount(authUser))) {
        await loadUserData(authUser, false);
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
        loadUserData(session.user).finally(() => setLoading(false));
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
            await loadUserData(session.user);
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
    if (error) {
      if (error.code === 'email_not_confirmed') {
        return { error: 'Please confirm your email first. Check your inbox for the link we sent you.' };
      }
      return { error: error.message };
    }
    if (data.user) {
      await acceptPendingInvitations(data.user.id, email);
      await loadUserData(data.user);
    }
    return { error: null };
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, last_name: lastName },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) return { error: error.message };

    // Email confirmation is on: there is no session until the user clicks the
    // link, so their workspace is created on first sign-in instead.
    if (!data.session) return { error: null, needsConfirmation: true };

    if (data.user) await loadUserData(data.user);
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
    if (user) await loadUserData(user);
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
