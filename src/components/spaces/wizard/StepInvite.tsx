import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { X, Copy, Check, Mail, Info } from 'lucide-react';
import { isValidEmail, normalizeEmail } from '@/lib/invitations';
import { spaceUrl } from '@/spatial/links';
import { cn } from '@/lib/utils';
import { StepTitle, FieldLabel } from './ui';
import type { WizardAction, WizardState } from './state';

const MAX_INVITES = 50;

export function StepInvite({ state, dispatch, ownEmail }: { state: WizardState; dispatch: (a: WizardAction) => void; ownEmail: string | null }) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /** Adds every email found in the text; keeps anything invalid in the box so it can be fixed. */
  const addFrom = (text: string): boolean => {
    const parts = text.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return false;
    const next = [...state.invites];
    const bad: string[] = [];
    let note: string | null = null;
    for (const p of parts) {
      const email = normalizeEmail(p);
      if (!isValidEmail(email)) { bad.push(p); continue; }
      if (ownEmail && email === normalizeEmail(ownEmail)) { note = "You're already in — no need to invite yourself."; continue; }
      if (next.includes(email)) continue;
      if (next.length >= MAX_INVITES) { note = `You can invite up to ${MAX_INVITES} people at once.`; break; }
      next.push(email);
    }
    dispatch({ type: 'setInvites', invites: next });
    setDraft(bad.join(', '));
    setProblem(bad.length ? `${bad.length === 1 ? `"${bad[0]}" isn't` : 'Some of these aren\'t'} a valid email.` : note);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === 'Tab') {
      if (!draft.trim()) return; // empty box: Enter continues, Tab moves on
      e.preventDefault();
      e.stopPropagation();
      addFrom(draft);
    } else if (e.key === 'Backspace' && !draft && state.invites.length) {
      dispatch({ type: 'setInvites', invites: state.invites.slice(0, -1) });
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (/[\s,;]/.test(text.trim())) { e.preventDefault(); addFrom(draft + ' ' + text); }
  };

  const link = state.slug ? spaceUrl(state.slug) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setProblem("Couldn't copy. Select the link and copy it yourself.");
    }
  };

  return (
    <>
      <StepTitle title="Invite your team" subtitle="If they already use SYNAPSE, they just sign in — no new account." />
      <div className="space-y-5">
        <div>
          <FieldLabel htmlFor="invite-emails" hint={state.invites.length ? `${state.invites.length} added` : undefined}>Email addresses</FieldLabel>
          <div
            className={cn(
              'flex min-h-[52px] flex-wrap items-center gap-1.5 rounded-xl border bg-white px-2.5 py-2 transition focus-within:ring-2',
              problem && draft ? 'border-burgundy-500 focus-within:ring-burgundy-400/20' : 'border-navy-100 focus-within:border-gold-400 focus-within:ring-gold-400/20',
            )}
            onClick={() => document.getElementById('invite-emails')?.focus()}
          >
            {state.invites.map((email) => (
              <span key={email} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-navy-50 py-1 pl-2 pr-1 text-sm text-navy-800">
                <span className="truncate">{email}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: 'setInvites', invites: state.invites.filter((x) => x !== email) }); }}
                  className="rounded p-0.5 text-navy-400 hover:bg-white hover:text-navy-800"
                  aria-label={`Remove ${email}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            <input
              id="invite-emails"
              type="email"
              inputMode="email"
              autoComplete="off"
              className="min-w-[160px] flex-1 bg-transparent px-1 py-1 text-sm text-navy-800 outline-none placeholder:text-ivory-600"
              placeholder={state.invites.length ? 'Add another…' : 'name@company.com, another@company.com'}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setProblem(null); }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onBlur={() => draft.trim() && addFrom(draft)}
              aria-invalid={!!problem && !!draft}
              aria-describedby="invite-problem"
            />
          </div>
          <p id="invite-problem" aria-live="polite" className={cn('mt-1.5 min-h-[20px] text-sm', draft ? 'text-burgundy-600' : 'text-ivory-700')}>
            {problem ?? 'Press Enter or comma after each address.'}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <FieldLabel>They join as</FieldLabel>
            <div role="radiogroup" aria-label="They join as" className="grid grid-cols-2 gap-1 rounded-xl bg-navy-50/70 p-1">
              {(['member', 'admin'] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  role="radio"
                  aria-checked={state.inviteRole === role}
                  onClick={() => dispatch({ type: 'setInviteRole', role })}
                  className={cn(
                    'rounded-lg py-2 text-sm font-semibold capitalize transition',
                    state.inviteRole === role ? 'bg-white text-navy-800 shadow-card' : 'text-navy-500 hover:text-navy-800',
                  )}
                >
                  {role}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ivory-700">{state.inviteRole === 'admin' ? 'Admins can create and manage workspaces.' : 'Members can enter and use workspaces.'}</p>
          </div>
          <div>
            <FieldLabel>Desks</FieldLabel>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-navy-100 bg-white p-3">
              <input
                type="checkbox"
                checked={state.assignDesks}
                onChange={(e) => dispatch({ type: 'setAssignDesks', value: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-navy-200 text-gold-500 focus:ring-gold-400/30"
              />
              <span className="text-sm text-navy-700">Give each person their own desk<span className="block text-xs text-ivory-700">Otherwise they pick any free desk.</span></span>
            </label>
          </div>
        </div>

        <div>
          <FieldLabel>Or share an invite link</FieldLabel>
          <div className="flex items-center gap-2">
            <input readOnly value={link} aria-label="Workspace link" className="input-field min-w-0 flex-1 !bg-ivory-200/30 font-mono !text-xs sm:!text-sm" onFocus={(e) => e.target.select()} />
            <button type="button" onClick={copy} disabled={!link} className="btn-secondary shrink-0">
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ivory-700">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Works for people already on your SYNAPSE team, once the workspace is created. New people need an email invite.
          </p>
        </div>

        {state.invites.length > 0 && (
          <p className="flex items-center gap-2 rounded-xl bg-gold-50 px-3 py-2.5 text-sm text-navy-800">
            <Mail className="h-4 w-4 shrink-0 text-gold-700" /> Invites go out when you enter your new workspace.
          </p>
        )}
      </div>
    </>
  );
}
