import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

export interface EmailAccount {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: 'google';
  email: string;
  display_name: string | null;
  status: 'active' | 'revoked' | 'error';
  last_error: string | null;
  created_at: string;
}

/** Pull the `{ error }` message out of a failed Edge Function call. */
export async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    let text = '';
    try { text = await ctx.clone().text(); } catch { /* body unreadable */ }
    let body: { error?: unknown; message?: unknown; msg?: unknown } | null = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    const detail = String(body?.error ?? body?.message ?? body?.msg ?? text ?? '').trim();
    if (/invalid jwt|jwt/i.test(detail) && ctx.status === 401) {
      return 'The email function rejected your login (JWT). In Supabase, turn off “Verify JWT” for send-email.';
    }
    if (detail) return `${detail}${ctx.status ? ` (${ctx.status})` : ''}`;
    if (ctx.status) return `${fallback} (${ctx.status})`;
  }
  const msg = (error as Error)?.message ?? '';
  if (/Failed to send a request|Function not found|404/i.test(msg)) {
    return 'Gmail sending is not switched on yet (the email functions are not deployed).';
  }
  return msg || fallback;
}

/** The current user's connected mailboxes in this workspace. `ready` is false if the database update has not been run. */
export function useEmailAccounts() {
  const { user, workspace } = useAuth();
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(true);

  const reload = useCallback(async () => {
    if (!user || !workspace) { setAccounts([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('email_accounts')
      .select('id, workspace_id, user_id, provider, email, display_name, status, last_error, created_at')
      .eq('workspace_id', workspace.id)
      .eq('user_id', user.id)
      .order('created_at');
    setReady(!error);
    setAccounts(error ? [] : ((data ?? []) as EmailAccount[]));
    setLoading(false);
  }, [user, workspace]);

  useEffect(() => { reload(); }, [reload]);

  return { accounts, loading, ready, reload };
}

/** Send the browser to Google's consent screen; Google returns to `returnPath` afterwards. */
export async function connectGmail(workspaceId: string, returnPath: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('gmail-oauth', {
    body: { action: 'start', workspace_id: workspaceId, return_path: returnPath },
  });
  if (error || !data?.url) return functionErrorMessage(error, 'Could not start Google sign-in.');
  window.location.assign(data.url);
  return null;
}

export async function disconnectEmailAccount(accountId: string): Promise<string | null> {
  const { error } = await supabase.functions.invoke('gmail-oauth', {
    body: { action: 'disconnect', account_id: accountId },
  });
  return error ? functionErrorMessage(error, 'Could not disconnect.') : null;
}

const RETURN_REASONS: Record<string, string> = {
  denied: 'Google sign-in was cancelled.',
  scope: 'Please tick “Send email on your behalf” on Google’s screen so SYNAPSE can send for you.',
  expired: 'That Google sign-in took too long. Please try again.',
  exchange: 'Google did not accept the sign-in. Please try again.',
  profile: 'Could not read your Google email address.',
  no_refresh: 'Google did not grant ongoing access. Remove SYNAPSE at myaccount.google.com/permissions and connect again.',
  save: 'Connected to Google, but saving failed. Please try again.',
};

// Google's redirect is a full page load, so one notice per load is enough (also stops React dev double-runs).
let noticeShownFor: string | null = null;

/**
 * After Google sends the user back, the URL carries ?gmail=connected|error.
 * Show a message once and tidy the address bar.
 */
export function useGmailReturnNotice(path: string, onConnected?: () => void) {
  const { toast } = useToast();
  useEffect(() => {
    const [base, query] = path.split('?');
    if (!query) return;
    const params = new URLSearchParams(query);
    const result = params.get('gmail');
    if (!result || noticeShownFor === path) return;
    noticeShownFor = path;
    if (result === 'connected') {
      toast(`Gmail connected${params.get('email') ? `: ${params.get('email')}` : ''}. You can now send from it.`);
      onConnected?.();
    } else {
      toast(RETURN_REASONS[params.get('reason') ?? ''] ?? 'Could not connect Gmail.', 'error');
    }
    ['gmail', 'email', 'reason'].forEach((k) => params.delete(k));
    const rest = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}#${base}${rest ? `?${rest}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
}
