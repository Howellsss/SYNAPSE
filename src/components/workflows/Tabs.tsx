import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, Search, UserMinus } from 'lucide-react';
import type { WorkflowSettings, Step } from '@/workflows/model';
import { flatten } from '@/workflows/model';
import { stepDef, WEEKDAYS } from '@/workflows/catalog';
import { listLogs, listRuns, removeRun, type LogRow, type Options, type RunRow } from '@/workflows/data';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { Field, Segmented, Select, Switch, TextInput, inputCls } from './ui';
import { cn, timeAgo } from '@/lib/utils';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl bg-white p-5 ring-1 ring-navy-100">
      <h3 className="mb-4 text-[15px] font-bold text-navy-900">{title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function SettingsTab({ settings, onChange, o, accountTz }: { settings: WorkflowSettings; onChange: (s: WorkflowSettings) => void; o: Options; accountTz: string }) {
  const w = settings.time_window;
  const setW = (p: Partial<WorkflowSettings['time_window']>) => onChange({ ...settings, time_window: { ...w, ...p } });
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="mx-auto max-w-2xl space-y-4 px-5 py-8">
        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-navy-900">Settings</h2>
          <p className="mt-1 text-sm text-ivory-700">How this workflow treats contacts. Changes apply when you save.</p>
        </div>
        <Card title="Entering the workflow">
          <Switch label="Allow re-entry" checked={settings.allow_reentry} onChange={(v) => onChange({ ...settings, allow_reentry: v })}
            description="On: a contact can go through again after finishing (never while still in it). Off: once only. Turn on for birthdays and other yearly reminders." />
          <Switch label="Stop on response" checked={settings.stop_on_response} onChange={(v) => onChange({ ...settings, stop_on_response: v })}
            description="When a contact replies to an email this workflow sent, they leave the workflow." />
        </Card>
        <Card title="Timing">
          <Segmented label="Time zone for waits and the sending window" value={settings.timezone} onChange={(v) => onChange({ ...settings, timezone: v })}
            options={[{ value: 'account', label: `Account (${accountTz})` }, { value: 'contact', label: 'Contact’s own' }]} />
          <Switch label="Only send emails during set hours" checked={w.enabled} onChange={(v) => setW({ enabled: v })}
            description="Emails outside these hours wait until the next allowed time. Tags, notes and tasks aren’t held back." />
          {w.enabled && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <TextInput label="From" type="time" value={w.start} onChange={(v) => setW({ start: v })} />
                <TextInput label="Until" type="time" value={w.end} onChange={(v) => setW({ end: v })} />
              </div>
              <Field label="On these days">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
                  {WEEKDAYS.map((d, i) => {
                    const on = w.days.includes(i);
                    return (
                      <button key={d} type="button" aria-pressed={on} onClick={() => setW({ days: on ? w.days.filter((x) => x !== i) : [...w.days, i].sort() })}
                        className={cn('h-9 w-12 rounded-[10px] text-[13px] font-semibold ring-1 ring-inset', on ? 'bg-navy-800 text-white ring-navy-800' : 'text-navy-700 ring-navy-100 hover:bg-navy-50')}>{d.slice(0, 3)}</button>
                    );
                  })}
                </div>
              </Field>
            </>
          )}
        </Card>
        <Card title="Sender">
          <Select label="Send emails from" value={settings.sender.account_id} onChange={(v) => onChange({ ...settings, sender: { ...settings.sender, account_id: v } })}
            options={[{ value: '', label: o.accounts.length ? 'Choose an account…' : 'No Gmail connected yet' }, ...o.accounts.map((a) => ({ value: a.id, label: a.display_name ? `${a.display_name} <${a.email}>` : a.email }))]}
            hint={o.accounts.length ? 'Each Send email step can override this.' : 'Connect your Gmail in Settings → Email, then come back.'} />
          <TextInput label="From name" value={settings.sender.from_name} onChange={(v) => onChange({ ...settings, sender: { ...settings.sender, from_name: v } })} placeholder="e.g. Howells at SYNAPSE" hint="Leave empty to use the account’s name." />
        </Card>
      </div>
    </div>
  );
}

const STATUS: Record<RunRow['status'], [string, string]> = {
  active: ['Running', 'bg-green-50 text-green-700'],
  waiting: ['Waiting', 'bg-gold-50 text-gold-800'],
  completed: ['Completed', 'bg-navy-50 text-navy-700'],
  failed: ['Failed', 'bg-burgundy-50 text-burgundy-700'],
  removed: ['Removed', 'bg-navy-50 text-ivory-700'],
  stopped: ['Stopped (replied)', 'bg-navy-50 text-ivory-700'],
};
const who = (c: RunRow['contact']) => [c?.first_name, c?.last_name].filter(Boolean).join(' ') || c?.email || 'Contact';

export function EnrollmentTab({ workflowId, steps, onViewLogs }: { workflowId: string | null; steps: Step[]; onViewLogs: (runId: string) => void }) {
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'in' | 'done'>('all');
  const [q, setQ] = useState('');
  const names = useMemo(() => Object.fromEntries(flatten(steps).map((s) => [s.id, s.name || stepDef(s.type)?.label || s.type])), [steps]);
  const load = useCallback(() => {
    if (!workflowId) { setRows([]); return; }
    listRuns(workflowId).then(({ rows: r, error: e }) => { setRows(r); setError(e); });
  }, [workflowId]);
  useEffect(load, [load]);
  const shown = (rows ?? []).filter((r) => (filter === 'all' || (filter === 'in' ? r.status === 'active' || r.status === 'waiting' : !(r.status === 'active' || r.status === 'waiting')))
    && (!q.trim() || who(r.contact).toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <HistoryShell title="Enrollment history" subtitle="Who entered this workflow, why, and where they are now. Kept for 30 days." onRefresh={load} q={q} setQ={setQ}
      extra={<Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'in', label: 'In progress' }, { value: 'done', label: 'Finished' }]} />}>
      {error ? <p className="rounded-xl bg-gold-50 px-4 py-3 text-sm text-navy-900 ring-1 ring-gold-200">{error}</p>
        : rows === null ? <p className="text-sm text-ivory-700">Loading…</p>
          : shown.length === 0 ? <Empty text={workflowId ? 'Nobody has entered this workflow yet. Publish it, or use Test to try it with one contact.' : 'Save the workflow first.'} />
            : (
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] font-bold uppercase tracking-[0.08em] text-ivory-600"><tr><th className="py-2 pr-3">Contact</th><th className="py-2 pr-3">Entered because</th><th className="py-2 pr-3">Status</th><th className="hidden py-2 pr-3 md:table-cell">Now / why it ended</th><th className="py-2 pr-3">Entered</th><th /></tr></thead>
                <tbody className="divide-y divide-navy-50">
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 pr-3"><button type="button" onClick={() => r.contact_id && navigate(`/contacts/${r.contact_id}`)} className="font-semibold text-navy-900 hover:underline">{who(r.contact)}</button>{r.is_test && <span className="ml-1.5 rounded bg-navy-50 px-1.5 py-0.5 text-[10px] font-bold text-navy-600">TEST</span>}</td>
                      <td className="py-2.5 pr-3 text-ivory-700">{r.reason || r.trigger_name || '—'}</td>
                      <td className="py-2.5 pr-3"><span className={cn('status-pill', STATUS[r.status][1])}>{STATUS[r.status][0]}</span></td>
                      <td className="hidden py-2.5 pr-3 text-ivory-700 md:table-cell">{r.status === 'waiting' ? `${names[r.current_step ?? ''] ?? 'Next step'}${r.resume_at ? ` · ${new Date(r.resume_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}` : r.exit_reason || '—'}</td>
                      <td className="py-2.5 pr-3 text-ivory-700">{timeAgo(r.started_at)}</td>
                      <td className="py-2.5 text-right">
                        <span className="inline-flex gap-1">
                          <button type="button" onClick={() => onViewLogs(r.id)} className="rounded-lg px-2 py-1 text-xs font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">Steps</button>
                          {(r.status === 'active' || r.status === 'waiting') && (
                            <button type="button" aria-label={`Remove ${who(r.contact)} from this workflow`} onClick={async () => { const e = await removeRun(r.id); toast(e ?? 'Removed from the workflow.', e ? 'error' : 'info'); load(); }}
                              className="rounded-lg p-1.5 text-burgundy-600 ring-1 ring-inset ring-navy-100 hover:bg-burgundy-50"><UserMinus className="h-3.5 w-3.5" /></button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
    </HistoryShell>
  );
}

const LOG: Record<LogRow['status'], [string, string]> = {
  success: ['Done', 'bg-green-50 text-green-700'], skipped: ['Skipped', 'bg-navy-50 text-ivory-700'], failed: ['Failed', 'bg-burgundy-50 text-burgundy-700'], waiting: ['Waiting', 'bg-gold-50 text-gold-800'],
};

export function LogsTab({ workflowId, runId, onClearRun }: { workflowId: string | null; runId: string | null; onClearRun: () => void }) {
  const [rows, setRows] = useState<(LogRow & { contact?: RunRow['contact'] })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | LogRow['status']>('all');
  const load = useCallback(() => {
    if (!workflowId) { setRows([]); return; }
    listLogs(workflowId, runId ?? undefined).then(({ rows: r, error: e }) => { setRows(r); setError(e); });
  }, [workflowId, runId]);
  useEffect(load, [load]);
  const shown = (rows ?? []).filter((r) => (status === 'all' || r.status === status) && (!q.trim() || `${who(r.contact)} ${r.step_name} ${r.detail}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <HistoryShell title="Execution logs" subtitle={runId ? 'One contact’s path through the workflow.' : 'Every step that ran, newest first. Kept for 30 days.'} onRefresh={load} q={q} setQ={setQ}
      extra={(
        <div className="flex items-center gap-2">
          {runId && <button type="button" onClick={onClearRun} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">Show everyone</button>}
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={cn(inputCls, 'h-9 w-36')}>
            <option value="all">All results</option><option value="success">Done</option><option value="waiting">Waiting</option><option value="skipped">Skipped</option><option value="failed">Failed</option>
          </select>
        </div>
      )}>
      {error ? <p className="rounded-xl bg-gold-50 px-4 py-3 text-sm text-navy-900 ring-1 ring-gold-200">{error}</p>
        : rows === null ? <p className="text-sm text-ivory-700">Loading…</p>
          : shown.length === 0 ? <Empty text="No steps have run yet." />
            : (
              <ol className="space-y-2">
                {shown.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5 ring-1 ring-navy-100">
                    <span className={cn('status-pill mt-0.5 shrink-0', LOG[r.status][1])}>{LOG[r.status][0]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-navy-900">{r.step_name || stepDef(r.step_type ?? '')?.label || r.step_type} <span className="font-normal text-ivory-700">· {who(r.contact)}</span></span>
                      <span className="block break-words text-xs text-ivory-700">{r.detail}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ivory-700" title={new Date(r.at).toLocaleString()}>{timeAgo(r.at)}</span>
                  </li>
                ))}
              </ol>
            )}
    </HistoryShell>
  );
}

function HistoryShell({ title, subtitle, onRefresh, q, setQ, extra, children }: { title: string; subtitle: string; onRefresh: () => void; q: string; setQ: (v: string) => void; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="mx-auto max-w-5xl px-5 py-8">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 className="text-[22px] font-bold tracking-tight text-navy-900">{title}</h2>
            <p className="mt-1 text-sm text-ivory-700">{subtitle}</p>
          </div>
          {extra}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contact" aria-label="Search contact" className={cn(inputCls, 'h-9 w-48 pl-9')} />
          </div>
          <button type="button" onClick={onRefresh} aria-label="Refresh" className="flex h-9 w-9 items-center justify-center rounded-[10px] text-navy-700 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><RefreshCw className="h-4 w-4" /></button>
        </div>
        <div className="mt-5 rounded-2xl bg-white p-4 ring-1 ring-navy-100">{children}</div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-12 text-center"><ExternalLink className="mx-auto hidden" /><p className="text-sm text-ivory-700">{text}</p></div>;
}
