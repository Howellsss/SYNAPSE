import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Download, History, Rocket, Search, Settings2, Trash2, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { EmptyState, LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';
import { loadDirectory, memberName, type DirectoryMember } from '@/lib/team';
import {
  AUDIT_CATEGORIES, auditCsv, categoryOf, dayLabel, describeAudit, loadAudit,
  type AuditCategory, type AuditEntry,
} from '@/lib/audit';

const PERIODS = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: 'all', label: 'All time', days: 0 },
];

const LOOK: Record<AuditCategory, { icon: typeof Users; tone: string }> = {
  people: { icon: Users, tone: 'bg-[#E8F0FE] text-[#1A56DB]' },
  deletions: { icon: Trash2, tone: 'bg-[#FDECEC] text-[#B42318]' },
  publishing: { icon: Rocket, tone: 'bg-[#E7F6EC] text-[#1E7B3C]' },
  settings: { icon: Settings2, tone: 'bg-[#FDF3DC] text-[#8A5A00]' },
  other: { icon: Activity, tone: 'bg-navy-50 text-navy-700' },
};

/** Who changed what: roles, deletions, publishing and settings, newest first. Admins only. */
export function AuditLogSettings() {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [people, setPeople] = useState<DirectoryMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<AuditCategory | ''>('');
  const [person, setPerson] = useState('');
  const [period, setPeriod] = useState('30');
  const [query, setQuery] = useState('');

  const since = useMemo(() => {
    const days = PERIODS.find((p) => p.key === period)?.days ?? 0;
    return days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined;
  }, [period]);

  const load = useCallback(async (before?: string) => {
    if (!workspace) return;
    const res = await loadAudit(workspace.id, { before, since, category, userId: person || undefined });
    setError(res.error);
    setEntries((prev) => (before ? [...prev, ...res.data] : res.data));
    setMore(res.full);
  }, [workspace, since, category, person]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (workspace) loadDirectory(workspace.id).then(({ data }) => setPeople(data));
  }, [workspace]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => { const { actor, text } = describeAudit(e); return `${actor} ${text}`.toLowerCase().includes(q); });
  }, [entries, query]);

  const days = useMemo(() => {
    const out: { day: string; items: AuditEntry[] }[] = [];
    for (const e of shown) {
      const day = dayLabel(e.created_at);
      if (out[out.length - 1]?.day === day) out[out.length - 1].items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [shown]);

  const loadOlder = async () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    setLoadingMore(true);
    await load(last.created_at);
    setLoadingMore(false);
  };

  const exportCsv = () => {
    if (!shown.length) { toast('Nothing to export with these filters', 'error'); return; }
    const url = URL.createObjectURL(new Blob([auditCsv(shown)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(workspace?.name ?? 'workspace').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-audit-log.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-navy-800">Audit log</h3>
          <p className="mt-0.5 max-w-xl text-sm text-ivory-600">
            Every change to people, roles, settings and important records, written down by the system with who made it. Entries can’t be edited or deleted. Only admins see this page.
          </p>
        </div>
        <button onClick={exportCsv} className="btn-secondary btn-sm"><Download className="h-4 w-4" /> Export CSV</button>
      </div>

      <div className="mb-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <label className="relative">
          <span className="sr-only">Search the log</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-500" />
          <input className="input-field !pl-9" placeholder="Search, e.g. a name or “deleted”" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select aria-label="Filter by kind of change" className="input-field" value={category} onChange={(e) => setCategory(e.target.value as AuditCategory | '')}>
          <option value="">Every kind of change</option>
          {AUDIT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select aria-label="Filter by person" className="input-field" value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Anyone</option>
          {people.map((p) => <option key={p.user_id} value={p.user_id}>{memberName(p)}</option>)}
        </select>
        <select aria-label="Time period" className="input-field" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The audit log couldn’t load. {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><LoadingSpinner className="h-8 w-8 text-ivory-600" /></div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<History className="h-7 w-7" />}
          title={entries.length ? 'Nothing matches' : 'No changes yet'}
          description={entries.length ? 'Try another search or filter.' : 'Changes to people, roles, settings and records will appear here as they happen.'}
        />
      ) : (
        <div className="space-y-6">
          {days.map(({ day, items }) => (
            <section key={day}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ivory-600">{day}</h4>
              <ol className="divide-y divide-navy-50 overflow-hidden rounded-xl border border-navy-100">
                {items.map((e) => {
                  const { actor, text } = describeAudit(e);
                  const look = LOOK[categoryOf(e.action)];
                  const Icon = look.icon;
                  return (
                    <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', look.tone)}><Icon className="h-4 w-4" aria-hidden /></span>
                      <p className="min-w-0 flex-1 text-sm leading-relaxed text-navy-700">
                        <span className="font-semibold text-navy-800">{actor}</span> {text}
                      </p>
                      <time dateTime={e.created_at} title={new Date(e.created_at).toLocaleString()} className="shrink-0 pt-0.5 text-xs tabular-nums text-ivory-600">
                        {new Date(e.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </time>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {more && (
            <div className="flex justify-center">
              <button className="btn-secondary btn-sm" onClick={loadOlder} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show older changes'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
