import { useCallback, useEffect, useState } from 'react';
import { BookOpen, ChevronDown, Copy, KeyRound, Loader2, Plus, RefreshCw, ShieldOff, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, LoadingSpinner } from '@/components/ui/States';
import { cn, timeAgo } from '@/lib/utils';
import { ENDPOINTS, apiBase, createKey, curlMe, deleteKey, listCalls, listKeys, revokeKey, type ApiCall, type ApiKey } from '@/lib/apiKeys';

const METHOD_TONE: Record<string, string> = {
  GET: 'bg-green-50 text-green-700', POST: 'bg-[#E8F0FE] text-[#1A56DB]', PATCH: 'bg-gold-50 text-gold-800', DELETE: 'bg-burgundy-50 text-burgundy-700',
};

const copyText = async (text: string, toast: (m: string, t?: 'error') => void, what = 'Copied') => {
  try { await navigator.clipboard.writeText(text); toast(what); } catch { toast('Couldn’t copy. Select it and copy instead.', 'error'); }
};

/** Settings → API: keys other apps use to read and change contacts. Admins only. */
export function ApiKeysCard() {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const base = apiBase();

  const load = useCallback(async () => {
    if (!workspace) return;
    const res = await listKeys(workspace.id);
    setKeys(res.data);
    setError(res.error);
  }, [workspace]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="card p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-navy-800">API keys</h3>
          <p className="mt-0.5 max-w-xl text-sm text-ivory-600">
            Let your own code or another app read and change contacts, tags and notes. Each key works only for this account, can be read only, and can be revoked at any time.
          </p>
        </div>
        {!adding && <button onClick={() => { setAdding(true); setFresh(null); }} className="btn-primary btn-sm"><Plus className="h-4 w-4" /> New key</button>}
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>}

      {fresh && (
        <div className="mb-5 rounded-2xl border-2 border-gold-400 p-4">
          <p className="text-sm font-semibold text-navy-800">Copy your key for “{fresh.name}” now</p>
          <p className="mt-0.5 text-sm text-ivory-600">For safety it won’t be shown again. If it’s lost, revoke it and make a new one.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-navy-50 px-3 py-2 font-mono text-xs text-navy-800">{fresh.key}</code>
            <button onClick={() => copyText(fresh.key, toast, 'Key copied')} className="btn-secondary btn-sm"><Copy className="h-4 w-4" /> Copy key</button>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-navy-900 p-3 text-xs leading-relaxed text-ivory-100">{curlMe(base, fresh.key)}</pre>
          <div className="mt-3 flex justify-end"><button onClick={() => setFresh(null)} className="btn-primary btn-sm">I’ve copied it</button></div>
        </div>
      )}

      {adding && workspace && (
        <NewKey workspaceId={workspace.id} onCancel={() => setAdding(false)} onCreated={(name, key) => { setAdding(false); setFresh({ name, key }); void load(); }} />
      )}

      {keys === null ? (
        <div className="flex justify-center py-8"><LoadingSpinner className="h-8 w-8 text-ivory-600" /></div>
      ) : keys.length === 0 && !adding ? (
        <EmptyState icon={<KeyRound className="h-7 w-7" />} title="No API keys yet" description="Make one for each app, so you can see what each one does and revoke any on its own." />
      ) : (
        <div className="space-y-3">
          {keys.map((k) => <KeyCard key={k.id} k={k} onChanged={load} onDeleted={() => setKeys((x) => (x ?? []).filter((y) => y.id !== k.id))} />)}
        </div>
      )}

      <div className="mt-6 rounded-xl bg-navy-50/60 px-4 py-3">
        <button type="button" onClick={() => setShowDocs(!showDocs)} aria-expanded={showDocs} className="flex w-full items-center gap-2 text-left text-sm font-semibold text-navy-800">
          <BookOpen className="h-4 w-4" /> How to use the API
          <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', showDocs && 'rotate-180')} />
        </button>
        {showDocs && (
          <div className="mt-3 space-y-3 text-sm text-navy-700">
            <div>
              <p className="mb-1">Address. Every path below goes after it:</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs text-navy-800">{base}</code>
                <button onClick={() => copyText(base, toast, 'Address copied')} className="btn-ghost btn-sm" aria-label="Copy address"><Copy className="h-4 w-4" /></button>
              </div>
            </div>
            <p>Send the key in a header: <code className="rounded bg-white px-1">Authorization: Bearer syn_…</code> (or <code className="rounded bg-white px-1">X-Api-Key: syn_…</code>). Send bodies as JSON. Contacts use the same fields as incoming links (email, phone, first_name, last_name, company, job_title, date_of_birth, source).</p>
            <ul className="divide-y divide-navy-100 overflow-hidden rounded-xl border border-navy-100 bg-white">
              {ENDPOINTS.map((e) => (
                <li key={e.method + e.path} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                  <span className={cn('w-16 shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[11px] font-bold', METHOD_TONE[e.method])}>{e.method}</span>
                  <code className="font-mono text-xs font-semibold text-navy-800">{e.path}</code>
                  <span className="w-full text-xs text-ivory-600 sm:w-auto sm:flex-1">{e.what}</span>
                </li>
              ))}
            </ul>
            <p>Answers are JSON: one contact as <code className="rounded bg-white px-1">{'{ "data": {…} }'}</code>, lists as <code className="rounded bg-white px-1">{'{ "data": […], "has_more", "next_offset" }'}</code>, problems as <code className="rounded bg-white px-1">{'{ "error": "…" }'}</code> with 401 (key not valid), 403 (read-only key), 404, 422 (fix what was sent) or 429 (over 300 a minute). Changes start your workflows just like changes made in SYNAPSE.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function NewKey({ workspaceId, onCancel, onCreated }: { workspaceId: string; onCancel: () => void; onCreated: (name: string, key: string) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [canWrite, setCanWrite] = useState(true);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const { key, error } = await createKey(workspaceId, name, canWrite);
    setSaving(false);
    if (error || !key) { toast(error ?? 'Could not make the key', 'error'); return; }
    onCreated(name.trim(), key);
  };
  return (
    <div className="mb-5 space-y-3 rounded-2xl border border-navy-100 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="key-name" className="mb-1.5 block text-sm font-medium text-navy-700">Name</label>
          <input id="key-name" className="input-field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zapier, Website, Reporting" />
        </div>
        <fieldset>
          <legend className="mb-1.5 block text-sm font-medium text-navy-700">Access</legend>
          <div className="flex gap-2">
            {[{ v: true, label: 'Read and write' }, { v: false, label: 'Read only' }].map((o) => (
              <label key={o.label} className={cn('flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm', canWrite === o.v ? 'border-navy-800 text-navy-900' : 'border-navy-100 text-navy-700')}>
                <input type="radio" name="key-access" checked={canWrite === o.v} onChange={() => setCanWrite(o.v)} className="h-4 w-4 accent-navy-800" /> {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-secondary btn-sm">Cancel</button>
        <button onClick={save} disabled={!name.trim() || saving} className="btn-primary btn-sm">{saving ? 'Making…' : 'Make key'}</button>
      </div>
    </div>
  );
}

function KeyCard({ k, onChanged, onDeleted }: { k: ApiKey; onChanged: () => void; onDeleted: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState<ApiCall[] | null>(null);
  const [confirm, setConfirm] = useState<null | 'revoke' | 'delete'>(null);
  const revoked = !!k.revoked_at;

  const loadLog = useCallback(async () => { const { data } = await listCalls(k.id); setCalls(data); }, [k.id]);
  useEffect(() => { if (open) void loadLog(); }, [open, loadLog]);

  return (
    <div className={cn('rounded-2xl border border-navy-100', revoked && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-navy-800">
            {k.name}
            <span className={cn('status-pill', k.can_write ? 'bg-navy-50 text-navy-700' : 'bg-green-50 text-green-700')}>{k.can_write ? 'Read and write' : 'Read only'}</span>
            {revoked && <span className="status-pill bg-burgundy-50 text-burgundy-700">Revoked</span>}
          </p>
          <p className="truncate text-xs text-ivory-600">
            <span className="font-mono">{k.prefix}…</span> · made {timeAgo(k.created_at)} · {k.last_used_at ? `last used ${timeAgo(k.last_used_at)}` : 'not used yet'}
          </p>
        </div>
        {revoked
          ? <button onClick={() => setConfirm('delete')} className="btn-ghost btn-sm text-burgundy-600"><Trash2 className="h-4 w-4" /> Delete</button>
          : <button onClick={() => setConfirm('revoke')} className="btn-ghost btn-sm text-burgundy-600"><ShieldOff className="h-4 w-4" /> Revoke</button>}
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="btn-ghost btn-sm">Activity <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} /></button>
      </div>

      {open && (
        <div className="border-t border-navy-100 p-4">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-sm font-medium text-navy-700">Recent requests <span className="font-normal text-ivory-600">· kept 7 days</span></p>
            <button onClick={loadLog} className="btn-ghost btn-sm" aria-label="Refresh requests"><RefreshCw className="h-4 w-4" /></button>
          </div>
          {calls === null ? <p className="flex items-center gap-2 text-sm text-ivory-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p> : calls.length === 0 ? (
            <p className="text-sm text-ivory-600">No requests yet.</p>
          ) : (
            <ul className="divide-y divide-navy-50 overflow-hidden rounded-xl border border-navy-100">
              {calls.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className={cn('w-16 shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[11px] font-bold', METHOD_TONE[c.method] ?? 'bg-navy-50 text-navy-700')}>{c.method}</span>
                  <code className="min-w-0 truncate font-mono text-xs text-navy-800">{c.path}</code>
                  <span className={cn('font-mono text-xs font-semibold', c.status < 300 ? 'text-green-700' : 'text-burgundy-700')}>{c.status}</span>
                  <time className="ml-auto text-xs text-ivory-600" dateTime={c.at} title={new Date(c.at).toLocaleString()}>{timeAgo(c.at)}</time>
                  {c.error && <p className="w-full text-xs text-burgundy-700">{c.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'revoke'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { const err = await revokeKey(k.id); setConfirm(null); if (err) toast(err, 'error'); else { toast('Key revoked'); onChanged(); } }}
        title="Revoke this key?"
        message={`Anything using “${k.name}” stops working straight away. This can’t be undone, but you can make a new key.`}
        confirmLabel="Revoke"
        danger
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { const err = await deleteKey(k.id); setConfirm(null); if (err) toast(err, 'error'); else { toast('Key deleted'); onDeleted(); } }}
        title="Delete this revoked key?"
        message="It disappears from this list along with its request history."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
