import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleSlash, Clock, ExternalLink, Loader2, RefreshCw, Search, XCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/lib/router';
import { stepDef } from '@/workflows/catalog';
import {
  historyCounts, listHistory, runSteps,
  type HistoryRun, type LogRow, type RunFilter,
} from '@/workflows/data';
import { cn, timeAgo } from '@/lib/utils';
import { inputCls } from './ui';

const PERIODS = [
  { key: '1', label: 'Last 24 hours', days: 1 },
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
];

const FILTERS: [RunFilter, string][] = [['all', 'All runs'], ['problems', 'With problems'], ['running', 'Still running'], ['finished', 'Finished']];

const RUN: Record<HistoryRun['status'], { label: string; tone: string }> = {
  active: { label: 'Running', tone: 'bg-[#E8F0FE] text-[#1A56DB]' },
  waiting: { label: 'Waiting', tone: 'bg-gold-50 text-gold-800' },
  completed: { label: 'Finished', tone: 'bg-green-50 text-green-700' },
  failed: { label: 'Failed', tone: 'bg-burgundy-50 text-burgundy-700' },
  stopped: { label: 'Stopped', tone: 'bg-navy-50 text-navy-700' },
  removed: { label: 'Removed', tone: 'bg-navy-50 text-navy-700' },
};

const STEP: Record<LogRow['status'], { label: string; icon: typeof CheckCircle2; tone: string }> = {
  success: { label: 'Done', icon: CheckCircle2, tone: 'text-green-600' },
  waiting: { label: 'Waiting', icon: Clock, tone: 'text-gold-700' },
  skipped: { label: 'Skipped', icon: CircleSlash, tone: 'text-ivory-600' },
  failed: { label: 'Failed', icon: XCircle, tone: 'text-burgundy-600' },
};

const who = (c: HistoryRun['contact']) => [c?.first_name, c?.last_name].filter(Boolean).join(' ') || c?.email || 'A contact';

/** Every workflow run in the account: who went through what, each step, and why anything failed. */
export function RunHistory({ workflows }: { workflows: { id: string; name: string }[] }) {
  const { workspace } = useAuth();
  const [, navigate] = useRouter();
  const [filter, setFilter] = useState<RunFilter>('all');
  const [workflowId, setWorkflowId] = useState('');
  const [period, setPeriod] = useState('7');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<HistoryRun[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [counts, setCounts] = useState<{ total: number; running: number; finished: number; problems: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const since = useMemo(() => new Date(Date.now() - (PERIODS.find((p) => p.key === period)?.days ?? 7) * 86_400_000).toISOString(), [period]);

  const load = useCallback(async (before?: string) => {
    if (!workspace) return;
    const res = await listHistory(workspace.id, { filter, workflowId: workflowId || undefined, since, before });
    setError(res.error);
    setRows((prev) => (before ? [...(prev ?? []), ...res.rows] : res.rows));
    setMore(res.more);
  }, [workspace, filter, workflowId, since]);

  const refresh = useCallback(() => {
    if (!workspace) return;
    setRows(null);
    void load();
    historyCounts(workspace.id, since, workflowId || undefined).then(setCounts);
  }, [workspace, load, since, workflowId]);
  useEffect(refresh, [refresh]);

  const shown = (rows ?? []).filter((r) => !q.trim() || `${who(r.contact)} ${r.workflow_name} ${r.reason ?? ''} ${r.exit_reason ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  const older = async () => {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    await load(last.started_at);
    setLoadingMore(false);
  };

  return (
    <section aria-label="Run history" className="flex flex-1 flex-col">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-navy-100 bg-navy-100 lg:grid-cols-4">
        <Count label="Runs" value={counts?.total} onClick={() => setFilter('all')} on={filter === 'all'} />
        <Count label="Still running" value={counts?.running} onClick={() => setFilter('running')} on={filter === 'running'} />
        <Count label="Finished" value={counts?.finished} onClick={() => setFilter('finished')} on={filter === 'finished'} />
        <Count label="With problems" value={counts?.problems} onClick={() => setFilter('problems')} on={filter === 'problems'} alert />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Show" className="flex flex-wrap rounded-[10px] bg-navy-50 p-[3px]">
          {FILTERS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cn('rounded-[8px] px-3 py-1.5 text-[13px] font-semibold', filter === k ? 'bg-white text-navy-900 shadow-[0_1px_2px_rgba(13,28,59,0.14)]' : 'text-navy-600 hover:text-navy-900')}>{l}</button>
          ))}
        </div>
        <select aria-label="Workflow" value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} className={cn(inputCls, 'h-10 w-full sm:w-52')}>
          <option value="">Every workflow</option>
          {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)} className={cn(inputCls, 'h-10 w-full sm:w-40')}>
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contact or workflow" aria-label="Search runs" className="h-10 w-full rounded-[10px] bg-white pl-9 pr-3 text-sm ring-1 ring-inset ring-navy-100 focus:outline-none focus:ring-2 focus:ring-gold-400" />
        </div>
        <button type="button" onClick={refresh} aria-label="Refresh" className="flex h-10 w-10 items-center justify-center rounded-[10px] text-navy-700 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><RefreshCw className="h-4 w-4" /></button>
      </div>

      <div className="mt-4 flex flex-1 flex-col">
        {error ? (
          <p role="alert" className="rounded-2xl bg-gold-50 px-5 py-4 text-sm text-navy-900 ring-1 ring-gold-200">{error}</p>
        ) : rows === null ? (
          <p className="flex items-center gap-2 py-10 text-sm text-ivory-700"><Loader2 className="h-4 w-4 animate-spin" /> Loading runs…</p>
        ) : shown.length === 0 ? (
          <p className="flex flex-1 items-center justify-center rounded-2xl px-5 py-12 text-center text-sm text-ivory-700 ring-1 ring-navy-100">
            {filter === 'problems' ? 'No problems in this period. Every step that ran, worked.' : 'No runs in this period yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-navy-50 overflow-hidden rounded-2xl ring-1 ring-navy-100">
            {shown.map((r) => (
              <RunItem key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onOpenWorkflow={() => navigate(`/workflows/${r.workflow_id}`)} />
            ))}
          </ul>
        )}
        {more && rows && (
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={older} disabled={loadingMore} className="rounded-[10px] px-4 py-2 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">{loadingMore ? 'Loading…' : 'Show older runs'}</button>
          </div>
        )}
        <p className="mt-3 text-xs text-ivory-700">Runs and their steps are kept for 30 days.</p>
      </div>
    </section>
  );
}

function Count({ label, value, onClick, on, alert }: { label: string; value: number | undefined; onClick: () => void; on: boolean; alert?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cn('bg-white px-5 py-4 text-left transition hover:bg-navy-50/50', on && 'shadow-[inset_0_-3px_0_#E4A93C]')}>
      <span className={cn('block text-[26px] font-bold tabular-nums tracking-tight', alert && value ? 'text-burgundy-600' : 'text-navy-900')}>{value ?? '–'}</span>
      <span className="text-[13px] font-medium text-ivory-700">{label}</span>
    </button>
  );
}

function RunItem({ r, open, onToggle, onOpenWorkflow }: { r: HistoryRun; open: boolean; onToggle: () => void; onOpenWorkflow: () => void }) {
  const [steps, setSteps] = useState<LogRow[] | null>(null);
  useEffect(() => { if (open && steps === null) runSteps(r.id).then(setSteps); }, [open, steps, r.id]);
  const st = RUN[r.status];
  const problem = r.failed_steps > 0 || r.status === 'failed';
  return (
    <li className={cn('bg-white', problem && 'shadow-[inset_3px_0_0_#B42318]')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-navy-50/40 sm:px-5">
        <span className={cn('status-pill shrink-0', st.tone)}>{st.label}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-navy-900">
            {who(r.contact)} <span className="font-normal text-ivory-700">in</span> {r.workflow_name}
            {r.is_test && <span className="ml-2 rounded bg-navy-50 px-1.5 py-px text-[10px] font-bold uppercase text-navy-700">Test</span>}
          </span>
          <span className="block truncate text-xs text-ivory-700">
            {r.reason || r.trigger_name || 'Started'}{r.exit_reason && r.status !== 'active' && r.status !== 'waiting' ? ` · ${r.exit_reason}` : ''}
            {r.status === 'waiting' && r.resume_at ? ` · carries on ${new Date(r.resume_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
        </span>
        {r.failed_steps > 0 && (
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-burgundy-50 px-2 py-0.5 text-xs font-semibold text-burgundy-700 sm:inline-flex">
            <AlertTriangle className="h-3.5 w-3.5" /> {r.failed_steps} step{r.failed_steps === 1 ? '' : 's'} failed
          </span>
        )}
        <time className="shrink-0 text-xs text-ivory-700" dateTime={r.started_at} title={new Date(r.started_at).toLocaleString()}>{timeAgo(r.started_at)}</time>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-ivory-600 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-navy-50 bg-[#FAFBFC] px-4 py-4 sm:px-5">
          {steps === null ? (
            <p className="flex items-center gap-2 text-sm text-ivory-700"><Loader2 className="h-4 w-4 animate-spin" /> Loading steps…</p>
          ) : steps.length === 0 ? (
            <p className="text-sm text-ivory-700">No steps have run yet.</p>
          ) : (
            <ol className="relative ml-2 space-y-3 border-l border-navy-100 pl-5">
              {steps.map((s) => {
                const look = STEP[s.status];
                const Icon = look.icon;
                return (
                  <li key={s.id} className="relative">
                    <span className={cn('absolute -left-[29px] top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#FAFBFC]', look.tone)}><Icon className="h-[18px] w-[18px]" aria-label={look.label} /></span>
                    <p className="text-sm font-semibold text-navy-900">
                      {s.step_name || stepDef(s.step_type ?? '')?.label || s.step_type}
                      <span className={cn('ml-2 text-xs font-semibold', look.tone)}>{look.label}</span>
                      <time className="ml-2 text-xs font-normal text-ivory-600" dateTime={s.at}>{new Date(s.at).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</time>
                    </p>
                    {s.detail && (
                      <p className={cn('mt-0.5 break-words text-[13px]', s.status === 'failed' ? 'rounded-lg bg-burgundy-50 px-2.5 py-1.5 text-burgundy-800' : 'text-ivory-700')}>
                        {s.status === 'failed' && <b>Why: </b>}{s.detail}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <button type="button" onClick={onOpenWorkflow} className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-navy-800 hover:text-navy-900"><ExternalLink className="h-3.5 w-3.5" /> Open the workflow</button>
        </div>
      )}
    </li>
  );
}
