import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, History, RotateCcw, Search, X } from 'lucide-react';
import { STEPS, TRIGGERS, grouped } from '@/workflows/catalog';
import type { Issue, StepType, TriggerType } from '@/workflows/model';
import { listVersions, type VersionRow } from '@/workflows/data';
import { Chip } from './ui';
import { cn, timeAgo } from '@/lib/utils';

/** The right-hand sheet everything opens in. */
export function Sheet({ title, subtitle, onClose, children, footer, wide }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  return (
    <aside aria-label={title} className={cn('absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-navy-100 bg-white shadow-[-12px_0_32px_-16px_rgba(13,28,59,0.25)]', wide ? 'sm:w-[480px]' : 'sm:w-[420px]')}>
      <header className="flex items-start gap-3 border-b border-navy-100 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-bold text-navy-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ivory-700">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`} className="rounded-lg p-1.5 text-navy-500 hover:bg-navy-50 hover:text-navy-900"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && <footer className="flex items-center gap-2 border-t border-navy-100 px-5 py-3">{footer}</footer>}
    </aside>
  );
}

function Picker<T extends { type: string; label: string; description: string; group: string; tone: import('@/workflows/catalog').Tone; icon: import('lucide-react').LucideIcon }>({ items, title, subtitle, onPick, onClose }: { items: T[]; title: string; subtitle: string; onPick: (t: T['type']) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const groups = grouped(items, q);
  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose}>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label={`Search ${title.toLowerCase()}`} className="h-10 w-full rounded-[10px] bg-navy-50 pl-9 pr-3 text-sm text-navy-900 placeholder:text-ivory-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gold-400" />
      </div>
      {groups.length === 0 && <p className="py-8 text-center text-sm text-ivory-700">Nothing matches “{q}”.</p>}
      {groups.map(([g, list]) => (
        <section key={g} className="mb-4" aria-label={g}>
          <h3 className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-[0.1em] text-ivory-600">{g}</h3>
          <ul className="overflow-hidden rounded-2xl ring-1 ring-navy-100">
            {list.map((d) => (
              <li key={d.type} className="border-b border-navy-50 last:border-b-0">
                <button type="button" onClick={() => onPick(d.type)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-navy-50">
                  <Chip tone={d.tone} icon={d.icon} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-navy-900">{d.label}</span>
                    <span className="block text-xs text-ivory-700">{d.description}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ivory-500" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}

export const TriggerPicker = ({ onPick, onClose }: { onPick: (t: TriggerType) => void; onClose: () => void }) =>
  <Picker items={TRIGGERS} title="Add a trigger" subtitle="What starts this workflow? You can add more than one." onPick={onPick} onClose={onClose} />;

export const StepPicker = ({ onPick, onClose }: { onPick: (t: StepType) => void; onClose: () => void }) =>
  <Picker items={STEPS} title="Add a step" subtitle="What should happen next?" onPick={onPick} onClose={onClose} />;

export function ErrorsPanel({ issues, onGo, onClose }: { issues: Issue[]; onGo: (i: Issue) => void; onClose: () => void }) {
  return (
    <Sheet title="Errors found" subtitle="Fix these before publishing. Saving a draft is always fine." onClose={onClose}>
      {issues.length === 0 ? (
        <div className="py-10 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
          <p className="mt-3 text-sm font-semibold text-navy-900">All good</p>
          <p className="mt-1 text-xs text-ivory-700">This workflow is ready to publish.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {issues.map((i, n) => (
            <li key={n}>
              <button type="button" onClick={() => onGo(i)} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-burgundy-100 hover:bg-burgundy-50/50">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burgundy-600" />
                <span className="min-w-0 flex-1 text-sm text-navy-900">{i.message}<span className="block text-xs text-ivory-700">{i.where === 'trigger' ? 'Trigger' : i.where === 'step' ? 'Step' : 'Settings'}</span></span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ivory-500" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

export function NotesPanel({ value, onChange, onClose }: { value: string; onChange: (v: string) => void; onClose: () => void }) {
  return (
    <Sheet title="Notes" subtitle="What this workflow is for, who owns it, anything to remember." onClose={onClose}>
      <textarea autoFocus aria-label="Workflow notes" value={value} onChange={(e) => onChange(e.target.value)} rows={14}
        placeholder="e.g. Follows up new leads from the website. Owner: Howells. Review monthly."
        className="w-full rounded-[10px] bg-white px-3 py-2.5 text-sm text-navy-900 ring-1 ring-inset ring-navy-100 focus:outline-none focus:ring-2 focus:ring-gold-400" />
      <p className="mt-2 text-xs text-ivory-700">Saved with the workflow.</p>
    </Sheet>
  );
}

export function SwitcherPanel({ list, currentId, onOpen, onClose }: { list: { id: string; name: string }[]; currentId: string | null; onOpen: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const shown = list.filter((w) => w.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Sheet title="Switch workflow" subtitle="Jump to another workflow (Shift + W)." onClose={onClose}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search workflows" aria-label="Search workflows" className="mb-3 h-10 w-full rounded-[10px] bg-navy-50 px-3 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-gold-400" />
      <ul className="divide-y divide-navy-50 overflow-hidden rounded-2xl ring-1 ring-navy-100">
        {shown.map((w) => (
          <li key={w.id}>
            <button type="button" disabled={w.id === currentId} onClick={() => onOpen(w.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-navy-900 hover:bg-navy-50 disabled:bg-gold-50/60">
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.id === currentId ? <span className="text-xs font-semibold text-gold-700">Open</span> : <ChevronRight className="h-4 w-4 text-ivory-500" />}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-ivory-700">No workflows match.</li>}
      </ul>
    </Sheet>
  );
}

export function VersionsPanel({ workflowId, onRestore, onClose }: { workflowId: string | null; onRestore: (v: VersionRow) => void; onClose: () => void }) {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  useEffect(() => {
    if (!workflowId) { setRows([]); return; }
    let alive = true;
    listVersions(workflowId).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [workflowId]);
  return (
    <Sheet title="Version history" subtitle="Every save is kept. Restoring loads it into the builder; save to keep it." onClose={onClose}>
      {rows === null ? <p className="text-sm text-ivory-700">Loading…</p> : rows.length === 0 ? (
        <div className="py-10 text-center"><History className="mx-auto h-9 w-9 text-ivory-500" /><p className="mt-3 text-sm text-ivory-700">Versions appear here after you save.</p></div>
      ) : (
        <ul className="space-y-2">
          {rows.map((v) => (
            <li key={v.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-navy-100">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-50 text-xs font-bold text-navy-800">v{v.version_number}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-navy-900">{v.snapshot?.name ?? 'Workflow'}</span>
                <span className="block text-xs text-ivory-700">{timeAgo(v.created_at)} · {v.status === 'active' ? 'Published' : 'Draft'}</span>
              </span>
              <button type="button" onClick={() => onRestore(v)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><RotateCcw className="h-3.5 w-3.5" /> Restore</button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
