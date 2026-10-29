import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '@/lib/router';
import { ChevronDown, Copy, Eye, EyeOff, Inbox, Loader2, Plus, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, LoadingSpinner } from '@/components/ui/States';
import { cn, timeAgo } from '@/lib/utils';
import {
  FIELD_HELP, createLink, curlExample, deleteLink, incomingUrl, listCalls, listLinks, parseTags, updateLink, type InboundCall, type InboundLink,
} from '@/lib/incoming';

/** Settings → API: incoming contact links other apps POST contacts to. Admins only. */
export function ApiSettings() {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [links, setLinks] = useState<InboundLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showFields, setShowFields] = useState(false);

  const load = useCallback(async () => {
    if (!workspace) return;
    const res = await listLinks(workspace.id);
    setLinks(res.data);
    setError(res.error);
  }, [workspace]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="card p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-navy-800">Incoming contacts</h3>
          <p className="mt-0.5 max-w-xl text-sm text-ivory-600">
            Give another app (Zapier, Make, your website form, a live chat) a secret link. Each contact it sends is added, or updated when the email or phone is already here, tagged, and your workflows start as usual.
          </p>
        </div>
        {!adding && <button onClick={() => setAdding(true)} className="btn-primary btn-sm"><Plus className="h-4 w-4" /> New link</button>}
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>}

      {adding && workspace && (
        <NewLink workspaceId={workspace.id} onCancel={() => setAdding(false)} onCreated={(l) => { setAdding(false); setLinks((x) => [...(x ?? []), l]); toast('Link made. Copy it into the other app.'); }} />
      )}

      {links === null ? (
        <div className="flex justify-center py-8"><LoadingSpinner className="h-8 w-8 text-ivory-600" /></div>
      ) : links.length === 0 && !adding ? (
        <EmptyState icon={<UserPlus className="h-7 w-7" />} title="No incoming links yet" description="Make one for each app that should add contacts, so you can see where each came from and switch any off on its own." />
      ) : (
        <div className="space-y-3">
          {links.map((l) => <LinkCard key={l.id} l={l} onChanged={load} onDeleted={() => setLinks((x) => (x ?? []).filter((y) => y.id !== l.id))} />)}
        </div>
      )}

      <div className="mt-6 rounded-xl bg-navy-50/60 px-4 py-3">
        <button type="button" onClick={() => setShowFields(!showFields)} aria-expanded={showFields} className="flex w-full items-center gap-2 text-left text-sm font-semibold text-navy-800">
          <Inbox className="h-4 w-4" /> What to send
          <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', showFields && 'rotate-180')} />
        </button>
        {showFields && (
          <div className="mt-3 space-y-2 text-sm text-navy-700">
            <p>POST JSON or a form post to the link. An <code className="rounded bg-white px-1">email</code> or a <code className="rounded bg-white px-1">phone</code> is needed; everything else is optional. Fields sent fill in the contact; fields not sent are left as they are.</p>
            <ul className="divide-y divide-navy-100 overflow-hidden rounded-xl border border-navy-100 bg-white">
              {FIELD_HELP.map((f) => (
                <li key={f.field} className="flex flex-wrap gap-x-3 px-3 py-2">
                  <code className="w-32 shrink-0 font-mono text-xs font-semibold text-navy-800">{f.field}</code>
                  <span className="text-xs text-ivory-600">also {f.also}</span>
                </li>
              ))}
            </ul>
            <p>Answers: <b>201</b> added, <b>200</b> updated (both with <code className="rounded bg-white px-1">contact_id</code>), <b>404</b> link not valid or switched off, <b>422</b> no email or phone, <b>429</b> more than 120 a minute.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function NewLink({ workspaceId, onCancel, onCreated }: { workspaceId: string; onCancel: () => void; onCreated: (l: InboundLink) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const { data, error } = await createLink(workspaceId, user?.id, { name, tags: parseTags(tags), source });
    setSaving(false);
    if (error || !data) { toast(error ?? 'Could not make the link', 'error'); return; }
    onCreated(data);
  };
  return (
    <div className="mb-5 space-y-3 rounded-2xl border border-navy-100 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="in-name" className="mb-1.5 block text-sm font-medium text-navy-700">Name</label>
          <input id="in-name" className="input-field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website contact form" />
        </div>
        <div>
          <label htmlFor="in-tags" className="mb-1.5 block text-sm font-medium text-navy-700">Tags to add (optional)</label>
          <input id="in-tags" className="input-field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. Lead, Website" />
        </div>
        <div>
          <label htmlFor="in-source" className="mb-1.5 block text-sm font-medium text-navy-700">Source (optional)</label>
          <input id="in-source" className="input-field" value={source} maxLength={60} onChange={(e) => setSource(e.target.value)} placeholder="Defaults to the name" />
        </div>
      </div>
      <p className="text-xs text-ivory-600">New contacts get this source unless the app sends one. Tags are added to new and existing contacts.</p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-secondary btn-sm">Cancel</button>
        <button onClick={save} disabled={!name.trim() || saving} className="btn-primary btn-sm">{saving ? 'Making…' : 'Make link'}</button>
      </div>
    </div>
  );
}

function LinkCard({ l, onChanged, onDeleted }: { l: InboundLink; onChanged: () => void; onDeleted: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [calls, setCalls] = useState<InboundCall[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState(l.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete' | 'off'>(null);
  const on = !l.revoked_at;
  const url = incomingUrl(l.token);

  const loadLog = useCallback(async () => { const { data } = await listCalls(l.id); setCalls(data); }, [l.id]);
  useEffect(() => { if (open) void loadLog(); }, [open, loadLog]);

  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Couldn’t copy. Select it and copy instead.', 'error'); } };
  const setOn = async (next: boolean) => {
    setBusy(true);
    const err = await updateLink(l.id, { revoked_at: next ? null : new Date().toISOString() });
    setBusy(false);
    if (err) toast(err, 'error'); else { toast(next ? 'Link switched on' : 'Link switched off'); onChanged(); }
  };
  const saveTags = async () => {
    const err = await updateLink(l.id, { tags: parseTags(tags) });
    if (err) toast(err, 'error'); else { toast('Tags saved'); setEditing(false); onChanged(); }
  };

  return (
    <div className="rounded-2xl border border-navy-100">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-navy-800">{l.name}</p>
          <p className="truncate text-xs text-ivory-600">
            {on ? '' : 'Switched off · '}{l.tags.length ? `Tags ${l.tags.join(', ')} · ` : ''}{l.last_used_at ? `last used ${timeAgo(l.last_used_at)}` : 'not used yet'}
          </p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-label={on ? 'Switch off' : 'Switch on'} disabled={busy} onClick={() => (on ? setConfirm('off') : setOn(true))}
          className={cn('relative h-6 w-11 shrink-0 rounded-full transition', on ? 'bg-green-500' : 'bg-navy-200')}>
          <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
        </button>
        <button onClick={() => copy(url, 'Link')} disabled={!on} className="btn-secondary btn-sm"><Copy className="h-4 w-4" /> Copy link</button>
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="btn-ghost btn-sm">Details <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} /></button>
      </div>

      {open && (
        <div className="space-y-4 border-t border-navy-100 p-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-navy-700">Link <span className="font-normal text-ivory-600">· anyone with it can add contacts, so keep it private</span></p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-navy-50 px-3 py-2 font-mono text-xs text-navy-800">{reveal ? url : url.replace(l.token, '•'.repeat(24))}</code>
              <button onClick={() => setReveal(!reveal)} className="btn-ghost btn-sm" aria-label={reveal ? 'Hide link' : 'Show link'}>{reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              <button onClick={() => copy(url, 'Link')} className="btn-ghost btn-sm" aria-label="Copy link"><Copy className="h-4 w-4" /></button>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-medium text-navy-700">Tags added to every contact</p>
              {!editing && <button onClick={() => setEditing(true)} className="text-sm font-semibold text-gold-700 hover:text-gold-800">Change</button>}
            </div>
            {editing ? (
              <div className="flex flex-wrap gap-2">
                <input className="input-field min-w-0 flex-1" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. Lead, Website" aria-label="Tags" />
                <button onClick={() => { setTags(l.tags.join(', ')); setEditing(false); }} className="btn-secondary btn-sm">Cancel</button>
                <button onClick={saveTags} className="btn-primary btn-sm">Save tags</button>
              </div>
            ) : l.tags.length ? (
              <div className="flex flex-wrap gap-1.5">{l.tags.map((t) => <span key={t} className="rounded-full bg-navy-50 px-2 py-0.5 text-xs text-navy-700">{t}</span>)}</div>
            ) : <p className="text-sm text-ivory-600">None</p>}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-medium text-navy-700">Try it</p>
              <button onClick={() => copy(curlExample(url), 'Example')} className="btn-ghost btn-sm" aria-label="Copy example"><Copy className="h-4 w-4" /></button>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-navy-900 p-3 text-xs leading-relaxed text-ivory-100">{curlExample(reveal ? url : url.replace(l.token, '<token>'))}</pre>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-medium text-navy-700">Recent calls <span className="font-normal text-ivory-600">· kept 30 days</span></p>
              <button onClick={loadLog} className="btn-ghost btn-sm" aria-label="Refresh calls"><RefreshCw className="h-4 w-4" /></button>
            </div>
            {calls === null ? <p className="flex items-center gap-2 text-sm text-ivory-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p> : calls.length === 0 ? (
              <p className="text-sm text-ivory-600">Nothing received yet.</p>
            ) : (
              <ul className="divide-y divide-navy-50 overflow-hidden rounded-xl border border-navy-100">
                {calls.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                    <span className={cn('status-pill shrink-0', !c.ok ? 'bg-burgundy-50 text-burgundy-700' : c.created ? 'bg-green-50 text-green-700' : 'bg-navy-50 text-navy-700')}>
                      {!c.ok ? 'Refused' : c.created ? 'Added' : 'Updated'}
                    </span>
                    <span className="min-w-0 truncate text-navy-800">{who(c)}</span>
                    {c.contact_id && <button onClick={() => navigate(`/contacts/${c.contact_id}`)} className="text-xs font-semibold text-gold-700 hover:text-gold-800">Open contact</button>}
                    <time className="ml-auto text-xs text-ivory-600" dateTime={c.at} title={new Date(c.at).toLocaleString()}>{timeAgo(c.at)}</time>
                    {c.error && <p className="w-full text-xs text-burgundy-700">{c.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={() => setConfirm('delete')} className="btn-ghost btn-sm text-burgundy-600"><Trash2 className="h-4 w-4" /> Delete link</button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'off'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { setConfirm(null); await setOn(false); }}
        title="Switch this link off?"
        message={`Apps sending to “${l.name}” will be refused until you switch it back on. Contacts already added stay.`}
        confirmLabel="Switch off"
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { const err = await deleteLink(l.id); setConfirm(null); if (err) toast(err, 'error'); else { toast('Link deleted'); onDeleted(); } }}
        title="Delete this link?"
        message={`Apps sending to “${l.name}” will be refused for good, and its call log is deleted. Contacts already added stay.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

/** Who a call was about, from what was sent. */
function who(c: InboundCall): string {
  const p = (c.payload ?? {}) as Record<string, unknown>;
  const inner = [p, p.contact, p.data].filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  for (const o of inner) {
    const v = ['email', 'email_address', 'phone', 'phone_number', 'name', 'first_name'].map((k) => o[k]).find((x) => typeof x === 'string' && x.trim());
    if (typeof v === 'string') return v;
  }
  return c.payload && 'too_large_to_keep' in c.payload ? '(large call, not kept)' : '—';
}
