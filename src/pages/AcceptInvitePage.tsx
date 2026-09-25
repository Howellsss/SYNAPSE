import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { HowellsLogo } from '@/components/layout/Sidebar';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, Clock, AlertCircle, Mail } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/States';

interface InvitationData {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  workspaces: { name: string } | null;
}

export function AcceptInvitePage({ token }: { token: string }) {
  const { user, signIn, signUp } = useAuth();
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('team_invitations')
        .select('id, workspace_id, email, role, status, expires_at, workspaces(name)')
        .eq('token', token)
        .maybeSingle();

      if (error || !data) {
        setError('This invitation could not be found or has been revoked.');
        setLoading(false);
        return;
      }

      const inv = data as unknown as InvitationData;
      if (inv.status !== 'pending') {
        setError('This invitation has already been used or revoked.');
        setLoading(false);
        return;
      }

      if (new Date(inv.expires_at) < new Date()) {
        setError('This invitation has expired. Please ask your workspace admin to send a new one.');
        setLoading(false);
        return;
      }

      setInvitation(inv);
      setLoading(false);
    })();
  }, [token]);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitation) return;
    setSubmitting(true);
    setError(null);

    if (mode === 'signup') {
      const { error } = await signUp(invitation.email, password, firstName, lastName);
      if (error) {
        setError(error);
        setSubmitting(false);
        return;
      }
    } else {
      const { error } = await signIn(invitation.email, password);
      if (error) {
        setError(error);
        setSubmitting(false);
        return;
      }
    }

    // After auth succeeds, accept the invitation
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setError('Authentication failed. Please try again.');
      setSubmitting(false);
      return;
    }

    // Insert workspace member
    const { error: memberErr } = await supabase.from('workspace_members').insert({
      workspace_id: invitation.workspace_id,
      user_id: userData.user.id,
      role: invitation.role,
      status: 'active',
    });

    if (memberErr) {
      // Might already be a member
      if (memberErr.code !== '23505') {
        setError(memberErr.message);
        setSubmitting(false);
        return;
      }
    }

    // Mark invitation as accepted
    await supabase
      .from('team_invitations')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    setAccepted(true);
    setSubmitting(false);

    // Redirect to dashboard after a brief delay
    setTimeout(() => {
      window.location.hash = '/dashboard';
      window.location.reload();
    }, 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <LoadingSpinner className="w-10 h-10" />
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-navy-800 mb-2">Welcome to the team!</h1>
          <p className="text-ivory-600">
            You've joined {invitation?.workspaces?.name ?? 'the workspace'}. Redirecting you to your dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (error || !invitation) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-burgundy-600" />
          </div>
          <h1 className="text-2xl font-bold text-navy-800 mb-2">Invitation Invalid</h1>
          <p className="text-ivory-600 mb-6">{error ?? 'Something went wrong.'}</p>
          <a href="/#/" className="btn-primary inline-block">Go to Sign In</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-[45%] bg-navy-800 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-20 left-20 w-72 h-72 rounded-full bg-gold-400 blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 rounded-full bg-navy-400 blur-3xl" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-navy-700 border border-navy-600 flex items-center justify-center">
              <HowellsLogo className="w-6 h-6" />
            </div>
            <span className="text-2xl font-bold tracking-wide text-ivory-100">SYNAPSE</span>
          </div>
        </div>
        <div className="relative space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-ivory-100 leading-tight">
              You've been invited to join {invitation.workspaces?.name ?? 'a workspace'}
            </h1>
            <p className="text-ivory-500 mt-4 text-lg leading-relaxed max-w-md">
              {invitation.role === 'admin'
                ? 'As an admin, you\'ll be able to manage workspace settings, team members, and all operational resources.'
                : 'As a member, you\'ll have access to the calendars and resources assigned to you.'}
            </p>
          </div>
          <div className="flex items-center gap-3 text-ivory-300">
            <Mail className="w-5 h-5 text-gold-400" />
            <span className="text-sm">{invitation.email}</span>
          </div>
          <div className="flex items-center gap-3 text-ivory-300">
            <Clock className="w-5 h-5 text-gold-400" />
            <span className="text-sm">Expires {new Date(invitation.expires_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="relative text-ivory-600 text-sm">© 2026 SYNAPSE. All rights reserved.</div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <div className="w-10 h-10 rounded-xl bg-navy-800 flex items-center justify-center">
              <HowellsLogo className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-wide text-navy-800">SYNAPSE</span>
          </div>

          <h2 className="text-2xl font-bold text-navy-800">
            {user ? 'Accept Invitation' : mode === 'signin' ? 'Sign in to accept' : 'Create your account'}
          </h2>
          <p className="text-ivory-600 mt-2 text-sm">
            {user
              ? `You're signed in as ${user.email}. Click below to join ${invitation.workspaces?.name ?? 'the workspace'}.`
              : `You've been invited to join ${invitation.workspaces?.name ?? 'a workspace'} as a ${invitation.role}.`}
          </p>

          {user ? (
            <div className="mt-8">
              <button
                onClick={async () => {
                  setSubmitting(true);
                  const { error: memberErr } = await supabase.from('workspace_members').insert({
                    workspace_id: invitation.workspace_id,
                    user_id: user.id,
                    role: invitation.role,
                    status: 'active',
                  });
                  if (memberErr && memberErr.code !== '23505') {
                    setError(memberErr.message);
                    setSubmitting(false);
                    return;
                  }
                  await supabase
                    .from('team_invitations')
                    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
                    .eq('id', invitation.id);
                  setAccepted(true);
                  setTimeout(() => {
                    window.location.hash = '/dashboard';
                    window.location.reload();
                  }, 2000);
                }}
                disabled={submitting}
                className="btn-primary w-full"
              >
                {submitting ? 'Joining...' : 'Accept Invitation'}
              </button>
            </div>
          ) : (
            <form onSubmit={handleAccept} className="mt-8 space-y-4">
              {mode === 'signup' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-navy-700 mb-1.5">First name</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      className="input-field"
                      placeholder="John"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-navy-700 mb-1.5">Last name</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                      className="input-field"
                      placeholder="Doe"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1.5">Email</label>
                <input
                  type="email"
                  value={invitation.email}
                  disabled
                  className="input-field opacity-60"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-navy-700 mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="input-field"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-700 text-sm rounded-xl px-4 py-3 border border-red-100">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-navy-800/30 border-t-navy-800 rounded-full animate-spin" />
                    Please wait...
                  </span>
                ) : mode === 'signin' ? (
                  'Sign In & Accept'
                ) : (
                  'Create Account & Accept'
                )}
              </button>
            </form>
          )}

          {!user && (
            <p className="text-center text-sm text-ivory-600 mt-6">
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <button
                onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
                className="font-semibold text-gold-700 hover:text-gold-600 transition-colors"
              >
                {mode === 'signin' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
