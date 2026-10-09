import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown, Copy, Download, FileText, LayoutGrid, List as ListIcon, MoreHorizontal, PenLine, Play, Plus, Search, Sparkles, Trash2, Upload, Wand2, Zap,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { supabase } from '@/lib/supabase';
import { Popover } from '@/components/spaces/room/Popover';
import { menuItem } from '@/components/spaces/room/styles';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/States';
import { RECIPES } from '@/workflows/recipes';
import { sketch } from '@/workflows/describe';
import { triggerDef, type Tone } from '@/workflows/catalog';
import { flatten, fromLegacy, issues, settingsFrom, type Step, type Trigger } from '@/workflows/model';
import { deleteWorkflow, listWorkflows, NEEDS_UPDATE, saveWorkflow, setStatus, type WorkflowRow } from '@/workflows/data';
import { PRESET_KEY, type Preset } from './Builder';
import { Chip } from './ui';
import { cn, timeAgo } from '@/lib/utils';

type Filter = 'all' | 'active' | 'draft';

export function WorkflowsHome() {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [rows, setRows] = useState<WorkflowRow[] | null>(null);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [inFlight, setInFlight] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'list' | 'grid'>(() => { try { return localStorage.getItem('synapse.workflows.view') === 'grid' ? 'grid' : 'list'; } catch { return 'list'; } });
  const [modal, setModal] = useState<null | 'recipes' | 'describe' | 'import'>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkflowRow | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    const [{ rows: r }, probe, runs] = await Promise.all([
      listWorkflows(workspace.id),
      supabase.from('workflows').select('definition').limit(1),
      supabase.from('wf_runs').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).in('status', ['active', 'waiting']),
    ]);
    setRows(r);
    setNeedsUpdate(!!probe.error);
    setInFlight(runs.error ? null : runs.count ?? 0);
  }, [workspace]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { try { localStorage.setItem('synapse.workflows.view', view); } catch { /* private mode */ } }, [view]);

  const startWith = (p: Preset) => {
    try { sessionStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch { /* private mode */ }
    setModal(null);
    navigate('/workflows/new');
  };

  const shown = useMemo(() => (rows ?? []).filter((r) => (filter === 'all' || (filter === 'active' ? r.status === 'active' : r.status !== 'active'))
    && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))), [rows, filter, q]);
  const counts = { active: (rows ?? []).filter((r) => r.status === 'active').length, draft: (rows ?? []).filter((r) => r.status !== 'active').length };

  const togglePublish = async (r: WorkflowRow) => {
    if (r.status !== 'active') {
      const d = r.definition;
      if (!d) { toast('Open it in the builder to publish.', 'info'); navigate(`/workflows/${r.id}`); return; }
      const p = issues(d.triggers ?? [], d.steps ?? [], settingsFrom(r.settings));
      if (p.length) { toast(`Not ready yet: ${p[0].message} Opening the builder.`, 'error'); navigate(`/workflows/${r.id}`); return; }
    }
    const err = await setStatus(r.id, r.status === 'active' ? 'draft' : 'active');
    toast(err ?? (r.status === 'active' ? 'Moved to draft.' : 'Published.'), err ? 'error' : 'info');
    void load();
  };
  const duplicate = async (r: WorkflowRow) => {
    if (!workspace) return;
    const base = r.definition ? { triggers: r.definition.triggers ?? [], steps: r.definition.steps ?? [] } : await legacyOf(r);
    const { error } = await saveWorkflow(workspace.id, { id: null, name: `${r.name} (copy)`, notes: r.notes ?? '', status: 'draft', settings: settingsFrom(r.settings), ...base, dropped: [] });
    toast(error ?? 'Copied as a draft.', error ? 'error' : 'info');
    void load();
  };
  const exportOne = async (r: WorkflowRow) => {
    const base = r.definition ? { triggers: r.definition.triggers ?? [], steps: r.definition.steps ?? [] } : await legacyOf(r);
    const blob = new Blob([JSON.stringify({ synapse_workflow: 2, name: r.name, notes: r.notes ?? '', settings: settingsFrom(r.settings), ...base }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${r.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'workflow'}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const remove = async () => {
    if (!confirmDelete) return;
    const err = await deleteWorkflow(confirmDelete.id);
    toast(err ?? 'Workflow deleted.', err ? 'error' : 'info');
    setConfirmDelete(null);
    void load();
  };

  return (
    <div className="w-full pb-10">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="font-display text-[26px] font-bold tracking-[-0.02em] text-navy-800">Workflows</h1>
          <p className="mt-1 text-[14px] text-ivory-700">Automations that run on their own, around the clock: when something happens, SYNAPSE does the next thing.</p>
        </div>
        <Popover
          label="New workflow"
          panelClassName="right-0 top-full mt-2 w-80 p-1.5"
          trigger={({ open, toggle }) => (
            <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="inline-flex h-11 items-center gap-2.5 rounded-xl bg-gold-400 pl-2 pr-3 text-[15px] font-semibold text-navy-900 shadow-[0_6px_16px_-8px_rgba(228,169,60,0.9)] hover:bg-gold-300">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-navy-800 text-gold-300"><Plus className="h-4 w-4" strokeWidth={2.5} /></span> New workflow <ChevronDown className={cn('h-4 w-4 transition', open && 'rotate-180')} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuChoice icon={PenLine} tone="navy" title="Start from scratch" text="Pick a trigger, then add steps." onClick={() => { close(); startWith({ name: 'Untitled workflow', triggers: [], steps: [] }); }} />
              <MenuChoice icon={Sparkles} tone="gold" title="Use a recipe" text="Ready-made SYNAPSE workflows to adjust." onClick={() => { close(); setModal('recipes'); }} />
              <MenuChoice icon={Wand2} tone="indigo" title="Describe it" text="Write what you want; we sketch the steps." onClick={() => { close(); setModal('describe'); }} />
              <MenuChoice icon={Upload} tone="slate" title="Import" text="From a SYNAPSE workflow file (.json)." onClick={() => { close(); setModal('import'); }} />
            </>
          )}
        </Popover>
      </div>

      {needsUpdate && (
        <div role="alert" className="mt-5 rounded-2xl bg-gold-50 px-5 py-4 text-sm text-navy-900 ring-1 ring-gold-200">
          <b>One database update needed.</b> {NEEDS_UPDATE} Until it’s applied you can look around, but workflows can’t be saved or run.
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-navy-100 bg-navy-100 lg:grid-cols-4">
        <Metric label="Published" value={rows ? counts.active : null} tone="green" />
        <Metric label="Drafts" value={rows ? counts.draft : null} tone="slate" />
        <Metric label="Contacts in workflows now" value={inFlight} tone="gold" />
        <Metric label="Total runs" value={rows ? rows.reduce((n, r) => n + (r.total_runs ?? 0), 0) : null} tone="navy" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Show" className="flex rounded-[10px] bg-navy-50 p-[3px]">
          {([['all', 'All'], ['active', 'Published'], ['draft', 'Drafts']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cn('rounded-[8px] px-3 py-1.5 text-[13px] font-semibold', filter === k ? 'bg-white text-navy-900 shadow-[0_1px_2px_rgba(13,28,59,0.14)]' : 'text-navy-600 hover:text-navy-900')}>{l}</button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search workflows" aria-label="Search workflows" className="h-10 w-full rounded-[10px] bg-white pl-9 pr-3 text-sm ring-1 ring-inset ring-navy-100 focus:outline-none focus:ring-2 focus:ring-gold-400" />
        </div>
        <div className="flex rounded-[10px] bg-navy-50 p-[3px]" role="group" aria-label="View">
          <button type="button" aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')} className={cn('rounded-[8px] p-1.5', view === 'list' ? 'bg-white text-navy-900 shadow' : 'text-navy-600')}><ListIcon className="h-4 w-4" /></button>
          <button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className={cn('rounded-[8px] p-1.5', view === 'grid' ? 'bg-white text-navy-900 shadow' : 'text-navy-600')}><LayoutGrid className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="mt-4">
        {rows === null ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[72px] rounded-2xl" />)}</div>
        ) : rows.length === 0 ? (
          <FirstRun onScratch={() => startWith({ name: 'Untitled workflow', triggers: [], steps: [] })} onRecipe={(i) => { const b = RECIPES[i].build(); startWith({ name: RECIPES[i].name, notes: RECIPES[i].description, triggers: b.triggers, steps: b.steps, settings: settingsFrom(b.settings) }); }} />
        ) : shown.length === 0 ? (
          <p className="rounded-2xl px-5 py-10 text-center text-sm text-ivory-700 ring-1 ring-navy-100">No workflows match.</p>
        ) : (
          <ul className={cn(view === 'grid' ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'divide-y divide-navy-50 overflow-hidden rounded-2xl ring-1 ring-navy-100')}>
            {shown.map((r) => <WorkflowItem key={r.id} r={r} grid={view === 'grid'} onOpen={() => navigate(`/workflows/${r.id}`)} onPublish={() => { void togglePublish(r); }} onDuplicate={() => { void duplicate(r); }} onExport={() => { void exportOne(r); }} onDelete={() => setConfirmDelete(r)} />)}
          </ul>
        )}
      </div>

      {modal === 'recipes' && (
        <Modal open onClose={() => setModal(null)} title="Recipes" description="Ready-made workflows for SYNAPSE. Everything stays editable before you publish." size="lg">
          <div className="flex flex-col">
          <LibraryTemplates onStart={startWith} />
          <div className="grid gap-3 sm:grid-cols-2">
            {RECIPES.map((r) => (
              <button key={r.key} type="button" onClick={() => { const b = r.build(); startWith({ name: r.name, notes: r.description, triggers: b.triggers, steps: b.steps, settings: settingsFrom(b.settings) }); }}
                className="flex items-start gap-3 rounded-2xl p-4 text-left ring-1 ring-navy-100 transition hover:-translate-y-px hover:ring-gold-400">
                <Chip tone={r.tone} icon={triggerDef(r.build().triggers[0]?.type ?? '')?.icon ?? Zap} />
                <span className="min-w-0"><span className="block text-sm font-bold text-navy-900">{r.name}</span><span className="mt-1 block text-xs text-ivory-700">{r.description}</span>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-gold-700">Use recipe →</span></span>
              </button>
            ))}
          </div>
          </div>
        </Modal>
      )}
      {modal === 'describe' && <DescribeModal onClose={() => setModal(null)} onStart={startWith} />}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} onStart={startWith} />}
      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => { void remove(); }} danger confirmLabel="Delete"
        title="Delete this workflow?" message={`“${confirmDelete?.name ?? ''}” and its history will be deleted. Contacts in it stop where they are.`} />
    </div>
  );
}

/** Templates saved in the account's template library (from the older builder), shown after the recipes. */
function LibraryTemplates({ onStart }: { onStart: (p: Preset) => void }) {
  const [rows, setRows] = useState<{ id: string; name: string; description: string | null; trigger_type: string; nodes: unknown }[]>([]);
  useEffect(() => {
    supabase.from('workflow_templates').select('id, name, description, trigger_type, nodes').order('sort_order').then(({ data }) => setRows((data ?? []) as typeof rows));
  }, []);
  if (!rows.length) return null;
  return (
    <div className="order-last mt-5">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-ivory-600">From the template library</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((t) => {
          const conv = fromLegacy(t.trigger_type, (Array.isArray(t.nodes) ? t.nodes : []) as { node_type: string; action_type: string | null; config: Record<string, unknown> }[]);
          const d = triggerDef(conv.triggers[0]?.type ?? '');
          return (
            <button key={t.id} type="button" onClick={() => onStart({ name: t.name, notes: t.description ?? '', triggers: conv.triggers.map((x) => ({ ...x, name: x.name || d?.label || '' })), steps: conv.steps })}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-navy-100 hover:ring-gold-400">
              <Chip tone={d?.tone ?? 'slate'} icon={d?.icon ?? Zap} size="sm" />
              <span className="min-w-0"><span className="block truncate text-sm font-semibold text-navy-900">{t.name}</span><span className="block truncate text-xs text-ivory-700">{t.description}</span></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

async function legacyOf(r: WorkflowRow): Promise<{ triggers: Trigger[]; steps: Step[] }> {
  const { data } = await supabase.from('workflow_nodes').select('node_type, action_type, config, sort_order').eq('workflow_id', r.id).order('sort_order');
  const out = fromLegacy(r.trigger_type, (data ?? []) as { node_type: string; action_type: string | null; config: Record<string, unknown> }[]);
  return { triggers: out.triggers, steps: out.steps };
}

function MenuChoice({ icon, tone, title, text, onClick }: { icon: React.ComponentType<{ className?: string }>; tone: Tone; title: string; text: string; onClick: () => void }) {
  return (
    <button role="menuitem" type="button" onClick={onClick} className={cn(menuItem, 'items-start gap-3 py-2.5')}>
      <Chip tone={tone} icon={icon} size="sm" />
      <span><span className="block text-sm font-semibold text-navy-900">{title}</span><span className="block text-xs text-ivory-700">{text}</span></span>
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | null; tone: 'green' | 'slate' | 'gold' | 'navy' }) {
  const dot = { green: 'bg-green-600', slate: 'bg-[#4F596B]', gold: 'bg-gold-400', navy: 'bg-navy-800' }[tone];
  return (
    <div className="bg-white px-5 py-4">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ivory-700"><span className={cn('h-2 w-2 rounded-full', dot)} />{label}</p>
      <p className="mt-1 font-display text-[28px] font-semibold tracking-tight text-navy-900">{value === null ? '–' : value.toLocaleString()}</p>
    </div>
  );
}

function WorkflowItem({ r, grid, onOpen, onPublish, onDuplicate, onExport, onDelete }: { r: WorkflowRow; grid: boolean; onOpen: () => void; onPublish: () => void; onDuplicate: () => void; onExport: () => void; onDelete: () => void }) {
  const triggers = r.definition?.triggers ?? [];
  const first = triggerDef(triggers[0]?.type ?? '');
  const steps = r.definition ? flatten(r.definition.steps ?? []).length : null;
  const when = first ? `${first.label}${triggers.length > 1 ? ` + ${triggers.length - 1} more` : ''}` : r.definition ? 'No trigger yet' : 'Older workflow: open to update';
  const live = r.status === 'active';
  const menu = (
    <Popover
      label={`Options for ${r.name}`}
      panelClassName="right-0 top-full mt-1 w-52"
      trigger={({ open, toggle }) => <button type="button" onClick={(e) => { e.stopPropagation(); toggle(); }} aria-label={`Options for ${r.name}`} aria-haspopup="menu" aria-expanded={open} className="flex h-8 w-8 items-center justify-center rounded-lg text-navy-600 hover:bg-navy-50"><MoreHorizontal className="h-4 w-4" /></button>}
    >
      {(close) => (
        <>
          <button role="menuitem" className={menuItem} onClick={() => { close(); onOpen(); }}><PenLine className="h-4 w-4" /> Open</button>
          <button role="menuitem" className={menuItem} onClick={() => { close(); onPublish(); }}><Play className="h-4 w-4" /> {live ? 'Move to draft' : 'Publish'}</button>
          <button role="menuitem" className={menuItem} onClick={() => { close(); onDuplicate(); }}><Copy className="h-4 w-4" /> Duplicate</button>
          <button role="menuitem" className={menuItem} onClick={() => { close(); onExport(); }}><Download className="h-4 w-4" /> Export (.json)</button>
          <button role="menuitem" className={cn(menuItem, '!text-burgundy-600')} onClick={() => { close(); onDelete(); }}><Trash2 className="h-4 w-4" /> Delete</button>
        </>
      )}
    </Popover>
  );
  const status = <span className={cn('status-pill shrink-0', live ? 'bg-green-50 text-green-700' : 'bg-navy-50 text-navy-600')}>{live ? 'Published' : 'Draft'}</span>;
  if (grid) {
    return (
      <li className="rounded-2xl bg-white p-4 ring-1 ring-navy-100 transition hover:-translate-y-px hover:shadow-card">
        <div className="flex items-start gap-3">
          <Chip tone={first?.tone ?? 'slate'} icon={first?.icon ?? FileText} />
          <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left"><span className="block truncate text-[15px] font-bold text-navy-900">{r.name}</span><span className="block truncate text-xs text-ivory-700">{when}</span></button>
          {menu}
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-ivory-700">{status}<span>{steps ?? '–'} steps</span><span>·</span><span>{r.total_runs ?? 0} runs</span><span className="ml-auto">{r.last_run_at ? `Ran ${timeAgo(r.last_run_at)}` : 'Not run yet'}</span></div>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 bg-white px-4 py-3 hover:bg-navy-50/40">
      <Chip tone={first?.tone ?? 'slate'} icon={first?.icon ?? FileText} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[15px] font-semibold text-navy-900">{r.name}</span>
        <span className="block truncate text-xs text-ivory-700">When: {when}{steps !== null ? ` · ${steps} step${steps === 1 ? '' : 's'}` : ''}</span>
      </button>
      <span className="hidden w-28 text-right text-xs text-ivory-700 md:block">{r.total_runs ?? 0} runs</span>
      <span className="hidden w-32 text-right text-xs text-ivory-700 lg:block">{r.last_run_at ? `Ran ${timeAgo(r.last_run_at)}` : 'Not run yet'}</span>
      {status}
      {menu}
    </li>
  );
}

function FirstRun({ onScratch, onRecipe }: { onScratch: () => void; onRecipe: (i: number) => void }) {
  return (
    <div className="rounded-2xl bg-white p-6 ring-1 ring-navy-100 sm:p-8">
      <h2 className="text-[20px] font-bold tracking-tight text-navy-900">Your first workflow</h2>
      <p className="mt-1 max-w-xl text-sm text-ivory-700">Pick a recipe to start from, or build your own. Nothing runs until you publish.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RECIPES.map((r, i) => (
          <button key={r.key} type="button" onClick={() => onRecipe(i)} className="flex items-start gap-3 rounded-2xl p-4 text-left ring-1 ring-navy-100 transition hover:-translate-y-px hover:ring-gold-400">
            <Chip tone={r.tone} icon={triggerDef(r.build().triggers[0]?.type ?? '')?.icon ?? Zap} />
            <span><span className="block text-sm font-bold text-navy-900">{r.name}</span><span className="mt-0.5 block text-xs text-ivory-700">{r.description}</span></span>
          </button>
        ))}
      </div>
      <button type="button" onClick={onScratch} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-gold-700 hover:text-gold-800"><PenLine className="h-4 w-4" /> Start from scratch</button>
    </div>
  );
}

function DescribeModal({ onClose, onStart }: { onClose: () => void; onStart: (p: Preset) => void }) {
  const [text, setText] = useState('');
  const result = text.trim().length > 8 ? sketch(text) : null;
  const IDEAS = ['When someone books an appointment, email them, wait 1 day, then create a follow-up task', 'When a contact is tagged "Interested", notify the owner, wait 2 days, then email them', 'After a no-show, email them and add a follow-up task'];
  return (
    <Modal open onClose={onClose} title="Describe it" description="Write what should happen. We sketch the trigger and steps; you finish them in the builder." size="lg"
      footer={<><button type="button" onClick={onClose} className="btn-secondary">Cancel</button><button type="button" disabled={!result} onClick={() => result && onStart({ name: result.name, notes: text, triggers: result.triggers, steps: result.steps })} className="btn-primary">Open in the builder</button></>}>
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label="What should the workflow do?" placeholder="When someone fills in my intake form, email them, wait 1 day, then create a call task."
        className="w-full rounded-[10px] bg-white px-3 py-2.5 text-sm ring-1 ring-inset ring-navy-100 focus:outline-none focus:ring-2 focus:ring-gold-400" />
      <div className="mt-2 flex flex-wrap gap-1.5">{IDEAS.map((i) => <button key={i} type="button" onClick={() => setText(i)} className="rounded-full px-2.5 py-1 text-xs text-navy-700 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">{i.split(',')[0]}…</button>)}</div>
      {result && (
        <div className="mt-4 rounded-2xl bg-navy-50/60 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-ivory-600">Sketch</p>
          <p className="mt-2 text-sm text-navy-900"><b>When:</b> {result.triggers[0] ? triggerDef(result.triggers[0].type)?.label : 'you choose the trigger in the builder'}</p>
          <ol className="mt-1 list-decimal pl-5 text-sm text-navy-900">{result.steps.map((s) => <li key={s.id}>{s.type === 'wait' ? `Wait ${s.config.amount} ${s.config.unit}` : s.type.replace(/_/g, ' ')}</li>)}</ol>
          {result.steps.length === 0 && <p className="text-sm text-ivory-700">No steps recognised yet. Mention email, wait, tag, notify, task or note.</p>}
          {result.unknown.map((u) => <p key={u} className="mt-2 text-xs text-burgundy-700">{u}</p>)}
        </div>
      )}
    </Modal>
  );
}

function ImportModal({ onClose, onStart }: { onClose: () => void; onStart: (p: Preset) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      if (j.synapse_workflow === 2 && Array.isArray(j.steps)) {
        onStart({ name: String(j.name ?? 'Imported workflow'), notes: String(j.notes ?? ''), triggers: (j.triggers as Trigger[]) ?? [], steps: j.steps as Step[], settings: settingsFrom(j.settings) });
        return;
      }
      if (typeof j.trigger === 'string' && Array.isArray(j.nodes)) {
        const out = fromLegacy(j.trigger, j.nodes as { node_type: string; action_type: string | null; config: Record<string, unknown> }[]);
        onStart({ name: String(j.name ?? 'Imported workflow'), notes: String(j.description ?? ''), triggers: out.triggers, steps: out.steps });
        return;
      }
      setError('This isn’t a SYNAPSE workflow file.');
    } catch { setError('That isn’t valid JSON. Paste the whole file.'); }
  };
  const readFile = async (f: File) => { setText(await f.text()); setError(null); };
  return (
    <Modal open onClose={onClose} title="Import a workflow" description="Paste a workflow exported from SYNAPSE (old or new builder), or choose the file. It opens as a draft."
      footer={<><button type="button" onClick={onClose} className="btn-secondary">Cancel</button><button type="button" disabled={!text.trim()} onClick={go} className="btn-primary">Import</button></>}>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setError(null); }} rows={8} aria-label="Workflow JSON" placeholder='{ "synapse_workflow": 2, "name": "…", "triggers": [...], "steps": [...] }'
        className="w-full rounded-[10px] bg-white px-3 py-2.5 font-mono text-xs ring-1 ring-inset ring-navy-100 focus:outline-none focus:ring-2 focus:ring-gold-400" />
      <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-gold-700 hover:text-gold-800"><Upload className="h-4 w-4" /> Choose a file<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} /></label>
      {error && <p role="alert" className="mt-2 text-sm text-burgundy-600">{error}</p>}
    </Modal>
  );
}
