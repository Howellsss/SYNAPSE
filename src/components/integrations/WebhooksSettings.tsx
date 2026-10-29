import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Copy, Eye, EyeOff, KeyRound, Loader2, Plus, RefreshCw, Send, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, LoadingSpinner } from '@/components/ui/States';
import { cn, timeAgo } from '@/lib/utils';
import {
  ALL_EVENTS, VERIFY_SNIPPET, WEBHOOK_EVENTS, createWebhook, deleteWebhook, eventLabel, isHttps, listDeliveries, listWebhooks,
  newSecret, retryDelivery, sendTest, updateWebhook, type Delivery, type Webhook,
} from '@/lib/webhooks';

const STATUS: Record<Delivery['status'], { label: string; tone: string }> = {
  pending: { label: 'Queued', tone: 'bg-navy-50 text-navy-700' },
  sending: { label: 'Sent, waiting for answer', tone: 'bg-[#E8F0FE] text-[#1A56DB]' },
  retrying: { label: 'Will retry', tone: 'bg-gold-50 text-gold-800' },
  delivered: { label: 'Delivered', tone: 'bg-green-50 text-green-700' },
  failed: { label: 'Failed', tone: 'bg-burgundy-50 text-burgundy-700' },
};

/** Settings → Webhooks: send SYNAPSE events to other apps, signed, retried and logged. Admins only. */
export function WebhooksSettings() {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showHow, setShowHow] = useState(false);

  const load = useCallback(async () => {
    if (!workspace) return;
    const res = await listWebhooks(workspace.id);
    setHooks(res.data);
    setError(res.error);
  }, [workspace]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="card p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-navy-800">Webhooks</h3>
          <p className="mt-0.5 max-w-xl text-sm text-ivory-600">
            Send SYNAPSE events to your other apps the moment they happen. Every request is signed, failed ones are retried for up to 9 hours, and each delivery is logged here for 30 days.
          </p>
        </div>
        {!adding && <button onClick={() => setAdding(true)} className="btn-primary btn-sm"><Plus className="h-4 w-4" /> Add webhook</button>}
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>}

      {adding && workspace && (
        <NewWebhook workspaceId={workspace.id} onCancel={() => setAdding(false)} onCreated={(w) => { setAdding(false); setHooks((h) => [...(h ?? []), w]); toast('Webhook added. Send a test to check it.'); }} />
      )}

      {hooks === null ? (
        <div className="flex justify-center py-8"><LoadingSpinner className="h-8 w-8 text-ivory-600" /></div>
      ) : hooks.length === 0 && !adding ? (
        <EmptyState icon={<WebhookIcon className="h-7 w-7" />} title="No webhooks yet" description="Add the address of another app (Zapier, Make, your own server) and choose which events it gets." />
      ) : (
        <div className="space-y-3">
          {hooks.map((w) => <WebhookCard key={w.id} w={w} onChanged={load} onDeleted={() => setHooks((h) => (h ?? []).filter((x) => x.id !== w.id))} />)}
        </div>
      )}

      <div className="mt-6 rounded-xl bg-navy-50/60 px-4 py-3">
        <button type="button" onClick={() => setShowHow(!showHow)} aria-expanded={showHow} className="flex w-full items-center gap-2 text-left text-sm font-semibold text-navy-800">
          <KeyRound className="h-4 w-4" /> How to check a request came from SYNAPSE
          <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', showHow && 'rotate-180')} />
        </button>
        {showHow && (
          <div className="mt-3 space-y-2 text-sm text-navy-700">
            <p>Each request has a <code className="rounded bg-white px-1">X-Synapse-Signature: t=…,v1=…</code> header: an HMAC-SHA256 of <code className="rounded bg-white px-1">{'"<t>.<raw body>"'}</code> made with the webhook’s secret. Also sent: <code className="rounded bg-white px-1">X-Synapse-Event</code> and <code className="rounded bg-white px-1">X-Synapse-Delivery</code> (the same id is in the body as <code className="rounded bg-white px-1">id</code>, to skip repeats).</p>
            <pre className="overflow-x-auto rounded-lg bg-navy-900 p-3 text-xs leading-relaxed text-ivory-100">{VERIFY_SNIPPET}</pre>
            <p>Answer with any 2xx status within 10 seconds. Anything else is tried again after 1, 5 and 30 minutes, then 2 and 6 hours.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EventPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const all = ALL_EVENTS.every((e) => value.includes(e));
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium text-navy-700">
        <input type="checkbox" checked={all} onChange={(e) => onChange(e.target.checked ? ALL_EVENTS : [])} className="h-4 w-4 accent-navy-800" /> Every event
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {WEBHOOK_EVENTS.map((g) => (
          <fieldset key={g.group} className="rounded-xl border border-navy-100 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-ivory-600">{g.group}</legend>
            <div className="space-y-1.5">
              {g.events.map((ev) => (
                <label key={ev.key} className="flex items-center gap-2 text-sm text-navy-700">
                  <input type="checkbox" checked={value.includes(ev.key)} onChange={(e) => onChange(e.target.checked ? [...value, ev.key] : value.filter((x) => x !== ev.key))} className="h-4 w-4 accent-navy-800" />
                  {ev.label} <span className="font-mono text-[11px] text-ivory-600">{ev.key}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}

function NewWebhook({ workspaceId, onCancel, onCreated }: { workspaceId: string; onCancel: () => void; onCreated: (w: Webhook) => void }) {
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [events, setEvents] = useState<string[]>(ALL_EVENTS);
  const [saving, setSaving] = useState(false);
  const valid = isHttps(url) && events.length > 0;
  const save = async () => {
    setSaving(true);
    const { data, error } = await createWebhook(workspaceId, { url, name, events });
    setSaving(false);
    if (error || !data) { toast(error ?? 'Could not add the webhook', 'error'); return; }
    onCreated(data);
  };
  return (
    <div className="mb-5 space-y-4 rounded-2xl border border-navy-100 p-4">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div>
          <label htmlFor="wh-url" className="mb-1.5 block text-sm font-medium text-navy-700">Address (URL)</label>
          <input id="wh-url" className="input-field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/…" />
          {url && !isHttps(url) && <p className="mt-1 text-xs text-burgundy-600">Use an https:// address.</p>}
        </div>
        <div>
          <label htmlFor="wh-name" className="mb-1.5 block text-sm font-medium text-navy-700">Name (optional)</label>
          <input id="wh-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zapier – new leads" />
        </div>
      </div>
      <EventPicker value={events} onChange={setEvents} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-secondary btn-sm">Cancel</button>
        <button onClick={save} disabled={!valid || saving} className="btn-primary btn-sm">{saving ? 'Adding…' : 'Add webhook'}</button>
      </div>
    </div>
  );
}

function WebhookCard({ w, onChanged, onDeleted }: { w: Webhook; onChanged: () => void; onDeleted: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [reveal, setReveal] = useState(false);
  const [secret, setSecret] = useState(w.secret ?? '');
  const [editing, setEditing] = useState(false);
  const [events, setEvents] = useState<string[]>(w.events);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete' | 'secret'>(null);

  const loadLog = useCallback(async () => { const { data } = await listDeliveries(w.id); setDeliveries(data); }, [w.id]);
  useEffect(() => { if (open) void loadLog(); }, [open, loadLog]);

  const test = async () => {
    setBusy(true);
    const err = await sendTest(w.id);
    setBusy(false);
    if (err) { toast(err, 'error'); return; }
    toast('Test sent. Its result shows in the log in a few seconds.');
    setOpen(true);
    void loadLog();
    window.setTimeout(() => { void loadLog(); }, 4000);
  };
  const toggle = async () => {
    const err = await updateWebhook(w.id, { is_active: !w.is_active });
    if (err) toast(err, 'error'); else { toast(w.is_active ? 'Webhook switched off' : 'Webhook switched on'); onChanged(); }
  };
  const saveEvents = async () => {
    const err = await updateWebhook(w.id, { events });
    if (err) toast(err, 'error'); else { toast('Events saved'); setEditing(false); onChanged(); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Couldn’t copy. Select it and copy instead.', 'error'); } };

  const failedRecently = deliveries?.some((d) => d.status === 'failed');
  return (
    <div className="rounded-2xl border border-navy-100">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-navy-800">{w.name || w.url}</p>
          <p className="truncate text-xs text-ivory-600">
            {w.name ? `${w.url} · ` : ''}{w.events.length === ALL_EVENTS.length ? 'Every event' : `${w.events.length} event${w.events.length === 1 ? '' : 's'}`}
            {w.last_triggered_at ? ` · last sent ${timeAgo(w.last_triggered_at)}` : ' · nothing sent yet'}
          </p>
        </div>
        <button type="button" role="switch" aria-checked={w.is_active} aria-label={w.is_active ? 'Switch off' : 'Switch on'} onClick={toggle}
          className={cn('relative h-6 w-11 shrink-0 rounded-full transition', w.is_active ? 'bg-green-500' : 'bg-navy-200')}>
          <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', w.is_active ? 'left-[22px]' : 'left-0.5')} />
        </button>
        <button onClick={test} disabled={busy || !w.is_active} className="btn-secondary btn-sm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test</button>
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="btn-ghost btn-sm">Details <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} /></button>
      </div>

      {open && (
        <div className="space-y-4 border-t border-navy-100 p-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-navy-700">Signing secret</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-navy-50 px-3 py-2 font-mono text-xs text-navy-800">{reveal ? secret : '•'.repeat(32)}</code>
              <button onClick={() => setReveal(!reveal)} className="btn-ghost btn-sm" aria-label={reveal ? 'Hide secret' : 'Show secret'}>{reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              <button onClick={() => copy(secret)} className="btn-ghost btn-sm" aria-label="Copy secret"><Copy className="h-4 w-4" /></button>
              <button onClick={() => setConfirm('secret')} className="btn-ghost btn-sm"><KeyRound className="h-4 w-4" /> New secret</button>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-medium text-navy-700">Events</p>
              {!editing && <button onClick={() => setEditing(true)} className="text-sm font-semibold text-gold-700 hover:text-gold-800">Change</button>}
            </div>
            {editing ? (
              <div className="space-y-3">
                <EventPicker value={events} onChange={setEvents} />
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setEvents(w.events); setEditing(false); }} className="btn-secondary btn-sm">Cancel</button>
                  <button onClick={saveEvents} disabled={!events.length} className="btn-primary btn-sm">Save events</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {w.events.map((e) => <span key={e} className="rounded-full bg-navy-50 px-2 py-0.5 text-xs text-navy-700">{eventLabel(e)}</span>)}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-medium text-navy-700">Recent deliveries {failedRecently && <span className="ml-1 text-xs font-semibold text-burgundy-600">· some failed</span>}</p>
              <button onClick={loadLog} className="btn-ghost btn-sm" aria-label="Refresh deliveries"><RefreshCw className="h-4 w-4" /></button>
            </div>
            {deliveries === null ? <p className="text-sm text-ivory-600">Loading…</p> : deliveries.length === 0 ? (
              <p className="text-sm text-ivory-600">Nothing sent yet. Send a test, or wait for the next event.</p>
            ) : (
              <ul className="divide-y divide-navy-50 overflow-hidden rounded-xl border border-navy-100">
                {deliveries.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                    <span className={cn('status-pill shrink-0', STATUS[d.status].tone)}>{STATUS[d.status].label}</span>
                    <span className="font-medium text-navy-800">{eventLabel(d.event)}</span>
                    <span className="text-xs text-ivory-600">
                      {d.response_status ? `answered ${d.response_status}` : ''}{d.attempts > 1 ? ` · ${d.attempts} tries` : ''}
                      {d.status === 'retrying' ? ` · next try ${new Date(d.next_attempt_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </span>
                    <time className="ml-auto text-xs text-ivory-600" dateTime={d.created_at} title={new Date(d.created_at).toLocaleString()}>{timeAgo(d.created_at)}</time>
                    {(d.status === 'failed' || d.status === 'retrying') && (
                      <button onClick={async () => { const err = await retryDelivery(d.id); if (err) toast(err, 'error'); else { toast('Sent again'); void loadLog(); window.setTimeout(() => { void loadLog(); }, 4000); } }}
                        className="text-xs font-semibold text-gold-700 hover:text-gold-800">Retry now</button>
                    )}
                    {d.error && d.status !== 'delivered' && <p className="w-full text-xs text-burgundy-700">{d.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={() => setConfirm('delete')} className="btn-ghost btn-sm text-burgundy-600"><Trash2 className="h-4 w-4" /> Delete webhook</button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { const err = await deleteWebhook(w.id); setConfirm(null); if (err) toast(err, 'error'); else { toast('Webhook deleted'); onDeleted(); } }}
        title="Delete this webhook?"
        message={`${w.url} will stop getting events, and its delivery log is deleted.`}
        confirmLabel="Delete"
        danger
      />
      <ConfirmDialog
        open={confirm === 'secret'}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { const { secret: s, error } = await newSecret(w.id); setConfirm(null); if (error || !s) { toast(error ?? 'Couldn’t change the secret', 'error'); return; } setSecret(s); setReveal(true); toast('New secret made. Update it in the receiving app.'); }}
        title="Make a new signing secret?"
        message="The old secret stops working straight away, so the receiving app must be given the new one."
        confirmLabel="Make new secret"
      />
    </div>
  );
}
