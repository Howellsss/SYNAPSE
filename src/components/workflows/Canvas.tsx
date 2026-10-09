import { useState } from 'react';
import { ArrowDown, ArrowUp, Maximize2, Minus, Plus, Zap } from 'lucide-react';
import type { Place, Step, Trigger } from '@/workflows/model';
import { stepDef, triggerDef, type Lookups } from '@/workflows/catalog';
import { Chip } from './ui';
import { cn } from '@/lib/utils';

export type Selection = { kind: 'trigger' | 'step'; id: string } | null;
export type StepStats = Record<string, { done: number; failed: number; skipped: number; waiting: number }>;

interface Props {
  triggers: Trigger[];
  steps: Step[];
  lookups: Lookups;
  selected: Selection;
  problems: Set<string>;
  stats: { steps: StepStats; triggers: Record<string, number> } | null;
  readOnly?: boolean;
  onSelect: (s: Selection) => void;
  onAddTrigger: () => void;
  onAddStep: (place: Place, index: number) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}

/** The workflow, drawn top to bottom: what starts it, then each step. */
export function Canvas(p: Props) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="relative h-full min-h-0 overflow-auto bg-white [background-image:radial-gradient(#E3E7EE_1px,transparent_1px)] [background-size:18px_18px]" data-canvas>
      <div className="flex min-w-max justify-center px-10 pb-40 pt-10" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
        <div className="flex flex-col items-center">
          <span className="mb-3 rounded-full bg-navy-800 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-gold-300">When</span>
          <div className="flex max-w-[960px] flex-wrap justify-center gap-3" aria-label="Triggers" role="list">
            {p.triggers.map((t) => <TriggerCard key={t.id} t={t} {...p} />)}
            {!p.readOnly && (
              <button type="button" onClick={p.onAddTrigger}
                className={cn('flex w-72 items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-3.5 text-left transition hover:border-gold-400 hover:bg-gold-50/40',
                  p.triggers.length ? 'border-navy-100' : 'border-gold-400 bg-gold-50/40')}>
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-navy-50 text-navy-700"><Plus className="h-4 w-4" /></span>
                <span>
                  <span className="block text-sm font-semibold text-navy-900">{p.triggers.length ? 'Add another trigger' : 'Add a trigger'}</span>
                  <span className="block text-xs text-ivory-700">{p.triggers.length ? 'Any of them starts the workflow' : 'What starts this workflow?'}</span>
                </span>
              </button>
            )}
          </div>
          <Line />
          <StepList list={p.steps} place={{ parent: null, branch: null }} {...p} />
        </div>
      </div>

      <div className="fixed bottom-5 left-[calc(56px+1.25rem)] z-10 flex items-center gap-0.5 rounded-xl bg-white p-1 shadow-popover ring-1 ring-navy-100" role="group" aria-label="Zoom">
        <button type="button" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))} aria-label="Zoom out" className="flex h-8 w-8 items-center justify-center rounded-lg text-navy-700 hover:bg-navy-50"><Minus className="h-4 w-4" /></button>
        <span className="w-11 text-center text-xs font-semibold tabular-nums text-navy-700">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))} aria-label="Zoom in" className="flex h-8 w-8 items-center justify-center rounded-lg text-navy-700 hover:bg-navy-50"><Plus className="h-4 w-4" /></button>
        <button type="button" onClick={() => setZoom(1)} aria-label="Reset zoom" title="Fit" className="flex h-8 w-8 items-center justify-center rounded-lg text-navy-700 hover:bg-navy-50"><Maximize2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function Line({ short }: { short?: boolean }) {
  return <span aria-hidden="true" className={cn('block w-0.5 bg-navy-100', short ? 'h-4' : 'h-7')} />;
}

function AddHere({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <Line short />
      <button type="button" onClick={onClick} aria-label={label} title="Add a step"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-navy-600 shadow-[0_1px_3px_rgba(13,28,59,0.15)] ring-1 ring-navy-100 transition hover:scale-110 hover:bg-gold-400 hover:text-navy-900 hover:ring-gold-400">
        <Plus className="h-4 w-4" strokeWidth={2.5} />
      </button>
      <Line short />
    </div>
  );
}

function TriggerCard({ t, lookups, selected, problems, stats, onSelect }: Props & { t: Trigger }) {
  const d = triggerDef(t.type);
  const Icon = d?.icon ?? Zap;
  const on = selected?.kind === 'trigger' && selected.id === t.id;
  const n = stats?.triggers[t.name || d?.label || ''];
  return (
    <div role="listitem">
    <button type="button" onClick={() => onSelect({ kind: 'trigger', id: t.id })} aria-pressed={on} aria-label={`Trigger: ${t.name || d?.label}`}
      className={cn('relative flex w-72 items-start gap-3 rounded-2xl bg-white px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(13,28,59,0.06),0_8px_20px_-12px_rgba(13,28,59,0.25)] ring-1 transition hover:-translate-y-px',
        on ? 'ring-2 ring-gold-400' : 'ring-navy-100')}>
      <Chip tone={d?.tone ?? 'navy'} icon={Icon} />
      <span className="min-w-0 flex-1">
        <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-ivory-600">{d?.label ?? t.type}</span>
        <span className="block truncate text-sm font-semibold text-navy-900">{t.name || d?.label}</span>
        <span className="mt-0.5 block truncate text-xs text-ivory-700">{d?.summary(t.filters, lookups)}</span>
      </span>
      {problems.has(t.id) && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-burgundy-500" title="Needs attention" aria-label="Needs attention" />}
      {stats && <span className="absolute -bottom-2.5 right-3 rounded-full bg-navy-800 px-2 py-0.5 text-[10.5px] font-bold text-white">{n ?? 0} entered</span>}
    </button>
    </div>
  );
}

function StepCard({ s, lookups, selected, problems, stats, onSelect, onMove, readOnly, canUp, canDown }: Props & { s: Step; canUp: boolean; canDown: boolean }) {
  const d = stepDef(s.type);
  const Icon = d?.icon ?? Zap;
  const on = selected?.kind === 'step' && selected.id === s.id;
  const st = stats?.steps[s.id];
  const compact = s.type === 'wait' || s.type === 'end';
  return (
    <div className="group relative">
      <button type="button" onClick={() => onSelect({ kind: 'step', id: s.id })} aria-pressed={on} aria-label={`Step: ${s.name || d?.label}`}
        className={cn('relative flex items-center gap-3 bg-white text-left shadow-[0_1px_2px_rgba(13,28,59,0.06),0_8px_20px_-12px_rgba(13,28,59,0.25)] ring-1 transition hover:-translate-y-px',
          compact ? 'w-56 rounded-full px-3 py-2' : 'w-72 rounded-2xl px-4 py-3.5',
          on ? 'ring-2 ring-gold-400' : 'ring-navy-100')}>
        <Chip tone={d?.tone ?? 'navy'} icon={Icon} size={compact ? 'sm' : 'md'} />
        <span className="min-w-0 flex-1">
          {!compact && <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-ivory-600">{d?.label}</span>}
          <span className="block truncate text-sm font-semibold text-navy-900">{compact ? d?.summary(s.config, lookups) : s.name || d?.label}</span>
          {!compact && <span className="mt-0.5 block truncate text-xs text-ivory-700">{d?.summary(s.config, lookups)}</span>}
        </span>
        {problems.has(s.id) && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-burgundy-500" title="Needs attention" aria-label="Needs attention" />}
      </button>
      {st && (
        <span className="absolute -bottom-2.5 right-3 flex gap-1 text-[10.5px] font-bold">
          <span className="rounded-full bg-green-600 px-2 py-0.5 text-white">{st.done} done</span>
          {st.waiting > 0 && <span className="rounded-full bg-gold-400 px-2 py-0.5 text-navy-900">{st.waiting} waiting</span>}
          {st.failed > 0 && <span className="rounded-full bg-burgundy-500 px-2 py-0.5 text-white">{st.failed} failed</span>}
        </span>
      )}
      {!readOnly && (canUp || canDown) && (
        <span className="absolute -right-10 top-1/2 hidden -translate-y-1/2 flex-col gap-1 group-focus-within:flex group-hover:flex">
          {canUp && <button type="button" onClick={() => onMove(s.id, -1)} aria-label={`Move ${s.name || d?.label} up`} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-navy-600 shadow ring-1 ring-navy-100 hover:bg-navy-50"><ArrowUp className="h-3.5 w-3.5" /></button>}
          {canDown && <button type="button" onClick={() => onMove(s.id, 1)} aria-label={`Move ${s.name || d?.label} down`} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-navy-600 shadow ring-1 ring-navy-100 hover:bg-navy-50"><ArrowDown className="h-3.5 w-3.5" /></button>}
        </span>
      )}
    </div>
  );
}

function StepList(p: Props & { list: Step[]; place: Place }) {
  const { list, place, readOnly, onAddStep } = p;
  const where = place.parent ? `${place.branch === 'yes' ? 'Yes' : 'No'} branch` : 'workflow';
  const last = list[list.length - 1];
  return (
    <div className="flex flex-col items-center">
      {list.map((s, i) => {
        const movable = s.type !== 'if_else';
        return (
          <div key={s.id} className="flex flex-col items-center">
            {!readOnly ? <AddHere onClick={() => onAddStep(place, i)} label={`Add a step before ${s.name || stepDef(s.type)?.label} (${where})`} /> : <Line />}
            <StepCard {...p} s={s} canUp={movable && i > 0 && list[i - 1].type !== 'if_else'} canDown={movable && i < list.length - 1 && list[i + 1].type !== 'if_else'} />
            {s.type === 'if_else' && <Branches {...p} s={s} />}
          </div>
        );
      })}
      {last?.type !== 'if_else' && (
        <>
          {!readOnly && <AddHere onClick={() => onAddStep(place, list.length)} label={`Add a step at the end of the ${where}`} />}
          {readOnly && <Line />}
          <span className="rounded-full bg-navy-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-navy-600 ring-1 ring-inset ring-navy-100">End</span>
        </>
      )}
    </div>
  );
}

function Branches(p: Props & { s: Step }) {
  const { s } = p;
  return (
    <div className="flex flex-col items-center">
      <Line short />
      <div className="relative flex items-start gap-10">
        <span aria-hidden="true" className="absolute left-[calc(25%)] right-[calc(25%)] top-0 h-0.5 bg-navy-100" />
        {(['yes', 'no'] as const).map((b) => (
          <div key={b} className="flex min-w-[18rem] flex-col items-center" aria-label={`${b === 'yes' ? 'Yes' : 'No'} branch of ${s.name || 'If / Else'}`} role="group">
            <Line short />
            <span className={cn('rounded-full px-3 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em]', b === 'yes' ? 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200' : 'bg-burgundy-50 text-burgundy-700 ring-1 ring-inset ring-burgundy-100')}>{b === 'yes' ? 'Yes' : 'No'}</span>
            <StepList {...p} list={s[b] ?? []} place={{ parent: s.id, branch: b }} />
          </div>
        ))}
      </div>
    </div>
  );
}
