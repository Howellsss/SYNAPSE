import { useState } from 'react';
import { Users, Mail, Link2, Copy, Check, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AccessMode, SpacePermissions, UserRole } from '@/types';
import { PERMISSION_ROWS, ROLES, togglePermission, guestLinkUrl } from '@/spatial/access';
import { cn } from '@/lib/utils';

const MODES: { mode: AccessMode; title: string; text: string; icon: typeof Users }[] = [
  { mode: 'members', title: 'Members of this account', text: 'Everyone on your SYNAPSE team can enter.', icon: Users },
  { mode: 'invite_only', title: 'Invite only', text: 'Only people you invite to this workspace.', icon: Mail },
  { mode: 'guest_link', title: 'Anyone with a guest link', text: 'People outside your team can join with a link.', icon: Link2 },
];

/** Who can enter, plus the role permissions table. */
export function AccessEditor({ mode, token, permissions, onMode, onNewToken, onPermissions }: {
  mode: AccessMode;
  token: string | null;
  permissions: SpacePermissions;
  onMode: (mode: AccessMode) => void;
  /** Make a fresh guest link (the old one stops working). */
  onNewToken: () => void;
  onPermissions: (p: SpacePermissions) => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = token ? guestLinkUrl(token) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* user can select it */ }
  };

  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Who can enter" className="grid gap-2.5 md:grid-cols-3">
        {MODES.map((m) => {
          const selected = mode === m.mode;
          return (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onMode(m.mode)}
              className={cn(
                'rounded-xl border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60',
                selected ? 'border-gold-400 bg-gold-50/50 shadow-[0_0_0_3px_rgba(228,169,60,0.15)]' : 'border-navy-100 bg-white hover:border-navy-200',
              )}
            >
              <span className="flex items-center gap-2 font-semibold text-navy-800"><m.icon className="h-4 w-4 text-gold-600" /> {m.title}</span>
              <span className="mt-1 block text-xs text-ivory-700">{m.text}</span>
            </button>
          );
        })}
      </div>

      {mode === 'guest_link' && (
        <div className="rounded-xl border border-navy-100 bg-ivory-200/20 p-3">
          <div className="flex items-center gap-2">
            <input readOnly value={link || 'Creating link…'} aria-label="Guest link" onFocus={(e) => e.target.select()} className="input-field min-w-0 flex-1 !bg-white font-mono !text-xs" />
            <button type="button" onClick={copy} disabled={!link} className="btn-secondary shrink-0 !py-2">
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ivory-700">
            <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-green-700" /> Guests can only enter this workspace.</span>
            <button type="button" onClick={onNewToken} className="inline-flex items-center gap-1 font-semibold text-navy-700 hover:text-gold-700">
              <RefreshCw className="h-3.5 w-3.5" /> New link
            </button>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-navy-800">Role permissions</p>
        <div className="overflow-x-auto rounded-xl border border-navy-100">
          <table className="w-full min-w-[300px] text-sm">
            <thead>
              <tr className="bg-ivory-200/30 text-left text-xs uppercase tracking-wider text-ivory-700">
                <th className="px-3 py-2 font-semibold">Who can…</th>
                {ROLES.map((r) => <th key={r} className="w-16 px-2 py-2 text-center font-semibold capitalize">{r}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_ROWS.map((row) => (
                <tr key={row.key} className="border-t border-navy-50">
                  <td className="px-3 py-2 text-navy-700">{row.label}</td>
                  {ROLES.map((role: UserRole) => {
                    const checked = role === 'owner' || permissions[row.key]?.includes(role);
                    return (
                      <td key={role} className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={role === 'owner'}
                          onChange={(e) => onPermissions(togglePermission(permissions, row.key, role, e.target.checked))}
                          aria-label={`${row.label}: ${role}`}
                          className="h-4 w-4 rounded border-navy-200 text-gold-500 focus:ring-gold-400/30 disabled:opacity-60"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-ivory-700">Owners can always do everything.</p>
      </div>
    </div>
  );
}
