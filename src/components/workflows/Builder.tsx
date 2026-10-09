import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, BarChart3, Copy, FlaskConical, History, Loader2, NotebookText, Search, Shuffle, Trash2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import {
  duplicateStep, flatten, insertStep, issues as findIssues, moveStep, newId, removeStep, settingsFrom, updateStep,
  type Issue, type Place, type Step, type StepType, type Trigger, type TriggerType,
} from '@/workflows/model';
import { stepDef, triggerDef } from '@/workflows/catalog';
import {
  loadOptions, loadWorkflow, saveWorkflow, searchContacts, shareClientKey, stepStats, testRun, triggerStats,
  type Editable, type Options, type VersionRow,
} from '@/workflows/data';
import { Canvas, type Selection, type StepStats } from './Canvas';
import { TriggerEditor, StepEditor } from './Editors';
import { ErrorsPanel, NotesPanel, Sheet, StepPicker, SwitcherPanel, TriggerPicker, VersionsPanel } from './Panels';
import { EnrollmentTab, LogsTab, SettingsTab } from './Tabs';
import { Chip } from './ui';
import { LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';

type Tab = 'builder' | 'settings' | 'enrollment' | 'logs';
type SheetState =
  | null
  | { kind: 'addTrigger' }
  | { kind: 'addStep'; place: Place; index: number }
  | { kind: 'edit' }
  | { kind: 'errors' } | { kind: 'notes' } | { kind: 'switcher' } | { kind: 'versions' } | { kind: 'test' };

const EMPTY_OPTIONS: Options = { tags: [], accounts: [], people: [], workflowList: [], users: {}, forms: {}, calendars: {}, events: {}, workflows: {} };

/** A new workflow handed over from the Workflows page (recipe, description or import). */
export interface Preset { name: string; notes?: string; triggers: Trigger[]; steps: Step[]; settings?: Editable['settings'] }
export const PRESET_KEY = 'synapse.workflow.preset';

export function Builder({ id }: { id: string | null }) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [wf, setWf] = useState<Editable | null>(null);
  const [savedJson, setSavedJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [o, setO] = useState<Options>(EMPTY_OPTIONS);
  const [tab, setTab] = useState<Tab>('builder');
  const [sel, setSel] = useState<Selection>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [saving, setSaving] = useState(false);
  const [statsOn, setStatsOn] = useState(false);
  const [stats, setStats] = useState<{ steps: StepStats; triggers: Record<string, number> } | null>(null);
  const [logRun, setLogRun] = useState<string | null>(null);

  // Load the workflow (or start a new one from a preset).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (id) {
        const { wf: w, error: e } = await loadWorkflow(id);
        if (!alive) return;
        if (!w) { setError(e); return; }
        setWf(w);
        setSavedJson(JSON.stringify(strip(w)));
        if (w.dropped.length) toast(`Some steps from the old builder can’t run here and were left out: ${[...new Set(w.dropped)].join(', ')}.`, 'info');
      } else {
        let preset: Preset | null = null;
        // Read the hand-over, then clear it once this load has settled (not straight away: in
        // development React runs this effect twice, and both runs need to see it).
        try { preset = JSON.parse(sessionStorage.getItem(PRESET_KEY) ?? 'null'); } catch { /* none */ }
        window.setTimeout(() => { try { sessionStorage.removeItem(PRESET_KEY); } catch { /* private mode */ } }, 0);
        const w: Editable = {
          id: null, name: preset?.name ?? 'Untitled workflow', notes: preset?.notes ?? '', status: 'draft',
          settings: settingsFrom(preset?.settings ?? {}), triggers: preset?.triggers ?? [], steps: preset?.steps ?? [], dropped: [],
        };
        setWf(w);
        setSavedJson(preset ? '' : JSON.stringify(strip(w)));
        if (!w.triggers.length) setSheet({ kind: 'addTrigger' });
      }
    })();
    return () => { alive = false; };
  }, [id, toast]);

  useEffect(() => {
    if (!workspace) return;
    loadOptions(workspace.id, user?.id ?? null).then(setO);
    void shareClientKey();
  }, [workspace, user?.id]);

  const dirty = !!wf && JSON.stringify(strip(wf)) !== savedJson;
  const problems = useMemo(() => (wf ? findIssues(wf.triggers, wf.steps, wf.settings) : []), [wf]);
  const problemIds = useMemo(() => new Set(problems.map((p) => p.id).filter(Boolean)), [problems]);

  // Stats view: counts for the last 30 days.
  useEffect(() => {
    if (!statsOn || !wf?.id) { setStats(null); return; }
    let alive = true;
    Promise.all([stepStats(wf.id), triggerStats(wf.id)]).then(([s, t]) => { if (alive) setStats({ steps: s, triggers: t.byTrigger }); });
    return () => { alive = false; };
  }, [statsOn, wf?.id]);

  const save = useCallback(async (status?: Editable['status']): Promise<boolean> => {
    if (!wf || !workspace) return false;
    const next = { ...wf, status: status ?? wf.status };
    if (next.status === 'active') {
      const p = findIssues(next.triggers, next.steps, next.settings);
      if (p.length) { setSheet({ kind: 'errors' }); toast(`Fix ${p.length} ${p.length === 1 ? 'thing' : 'things'} before publishing.`, 'error'); return false; }
    }
    setSaving(true);
    const { id: newIdSaved, error: e } = await saveWorkflow(workspace.id, next);
    setSaving(false);
    if (e || !newIdSaved) { toast(e ?? 'Could not save.', 'error'); return false; }
    const done = { ...next, id: newIdSaved };
    setWf(done);
    setSavedJson(JSON.stringify(strip(done)));
    toast(status === 'active' ? 'Published. It runs on its own from now on.' : status === 'draft' ? 'Moved to draft. Nothing runs until you publish again.' : 'Saved', 'info');
    if (!wf.id) navigate(`/workflows/${newIdSaved}`);
    return true;
  }, [wf, workspace, toast, navigate]);

  // Keyboard: Cmd/Ctrl+S saves, Shift+W opens the workflow switcher.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? '');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
      else if (!typing && e.shiftKey && e.key.toLowerCase() === 'w') { e.preventDefault(); setSheet({ kind: 'switcher' }); }
      else if (e.key === 'Escape' && sheet) setSheet(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, sheet]);

  if (error) {
    return (
      <Shell>
        <div className="flex h-full items-center justify-center p-6 text-center">
          <div><AlertTriangle className="mx-auto h-9 w-9 text-burgundy-500" /><p className="mt-3 font-semibold text-navy-900">{error}</p>
            <button type="button" onClick={() => navigate('/workflows')} className="btn-primary mt-5">Back to workflows</button></div>
        </div>
      </Shell>
    );
  }
  if (!wf) return <Shell><div className="flex h-full items-center justify-center"><LoadingSpinner className="h-9 w-9" /></div></Shell>;

  const leave = (to: string) => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    navigate(to);
  };
  const set = (patch: Partial<Editable>) => setWf((w) => (w ? { ...w, ...patch } : w));
  const selTrigger = sel?.kind === 'trigger' ? wf.triggers.find((t) => t.id === sel.id) : undefined;
  const selStep = sel?.kind === 'step' ? flatten(wf.steps).find((s) => s.id === sel.id) : undefined;

  const addTrigger = (type: TriggerType) => {
    const d = triggerDef(type)!;
    const t: Trigger = { id: newId('t'), type, name: d.label, filters: d.defaults() };
    set({ triggers: [...wf.triggers, t] });
    setSel({ kind: 'trigger', id: t.id });
    setSheet({ kind: 'edit' });
  };
  const addStep = (type: StepType, place: Place, index: number) => {
    const d = stepDef(type)!;
    const s: Step = { id: newId(), type, name: '', config: d.defaults() };
    set({ steps: insertStep(wf.steps, place, index, s) });
    setSel({ kind: 'step', id: s.id });
    setSheet({ kind: 'edit' });
  };
  const goToIssue = (i: Issue) => {
    if (i.where === 'settings') { setTab('settings'); setSheet(null); return; }
    if (!i.id) { setSheet(i.where === 'trigger' ? { kind: 'addTrigger' } : { kind: 'addStep', place: { parent: null, branch: null }, index: wf.steps.length }); return; }
    setTab('builder');
    setSel({ kind: i.where, id: i.id });
    setSheet({ kind: 'edit' });
  };
  const restore = (v: VersionRow) => {
    const d = v.snapshot?.definition;
    if (!d) return;
    set({ name: v.snapshot.name ?? wf.name, notes: v.snapshot.notes ?? wf.notes, settings: settingsFrom(v.snapshot.settings), triggers: d.triggers ?? [], steps: d.steps ?? [] });
    setSheet(null);
    toast(`Version ${v.version_number} loaded. Save to keep it.`, 'info');
  };

  const published = wf.status === 'active';
  const tz = workspace?.timezone || 'UTC';

  return (
    <Shell>
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-navy-100 bg-white px-3">
        <button type="button" onClick={() => leave('/workflows')} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-navy-700 hover:bg-navy-50"><ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Workflows</span></button>
        <span className="h-5 w-px bg-navy-100" />
        <input value={wf.name} onChange={(e) => set({ name: e.target.value })} aria-label="Workflow name" className="min-w-0 max-w-[16rem] flex-1 rounded-lg px-2 py-1 text-[15px] font-bold text-navy-900 hover:bg-navy-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gold-400" />
        <nav role="tablist" aria-label="Workflow" className="mx-auto hidden rounded-[10px] bg-navy-50 p-[3px] md:flex">
          {([['builder', 'Builder'], ['settings', 'Settings'], ['enrollment', 'Enrollment history'], ['logs', 'Execution logs']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); if (k !== 'logs') setLogRun(null); }}
              className={cn('rounded-[8px] px-3 py-1.5 text-[13px] font-semibold transition', tab === k ? 'bg-white text-navy-900 shadow-[0_1px_2px_rgba(13,28,59,0.14)]' : 'text-navy-600 hover:text-navy-900')}>{l}</button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className={cn('hidden items-center gap-1.5 text-xs font-medium lg:inline-flex', dirty ? 'text-burgundy-600' : 'text-ivory-700')}>
            <span className={cn('h-2 w-2 rounded-full', dirty ? 'bg-burgundy-500' : 'bg-green-600')} /> {dirty ? 'Unsaved changes' : 'Saved'}
          </span>
          <button type="button" onClick={() => (wf.id && !dirty ? setSheet({ kind: 'test' }) : toast('Save first, then test.', 'info'))} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50"><FlaskConical className="h-4 w-4" /> <span className="hidden sm:inline">Test</span></button>
          <div className="flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 ring-1 ring-inset ring-navy-100">
            <span className="hidden text-[13px] font-semibold text-navy-700 sm:inline">{published ? 'Published' : 'Draft'}</span>
            <button type="button" role="switch" aria-checked={published} aria-label="Published" disabled={saving} onClick={() => { void save(published ? 'draft' : 'active'); }}
              className={cn('relative inline-flex h-[22px] w-[38px] shrink-0 rounded-full transition disabled:opacity-60', published ? 'bg-green-600' : 'bg-navy-100')}>
              <span className={cn('absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all', published ? 'left-[19px]' : 'left-[3px]')} />
            </button>
          </div>
          <button type="button" onClick={() => { void save(); }} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-navy-800 px-4 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-70">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
        </div>
      </header>
      <nav role="tablist" aria-label="Workflow (small screens)" className="flex gap-1 overflow-x-auto border-b border-navy-100 bg-white px-3 py-1.5 md:hidden">
        {([['builder', 'Builder'], ['settings', 'Settings'], ['enrollment', 'Enrollment'], ['logs', 'Logs']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold', tab === k ? 'bg-navy-800 text-white' : 'text-navy-700')}>{l}</button>
        ))}
      </nav>

      <div className="relative flex min-h-0 flex-1">
        {/* Left rail */}
        <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-navy-100 bg-white py-3" role="toolbar" aria-label="Workflow tools" aria-orientation="vertical">
          <RailButton label="Notes" icon={NotebookText} on={sheet?.kind === 'notes'} onClick={() => setSheet(sheet?.kind === 'notes' ? null : { kind: 'notes' })} dot={!!wf.notes.trim()} />
          <RailButton label={`Errors found${problems.length ? ` (${problems.length})` : ''}`} icon={AlertTriangle} on={sheet?.kind === 'errors'} onClick={() => setSheet(sheet?.kind === 'errors' ? null : { kind: 'errors' })} badge={problems.length || undefined} />
          <RailButton label="Stats view" icon={BarChart3} on={statsOn} onClick={() => { if (!wf.id) { toast('Save the workflow to see its stats.', 'info'); return; } setStatsOn((v) => !v); setTab('builder'); setSheet(null); }} />
          <RailButton label="Switch workflow" icon={Shuffle} on={sheet?.kind === 'switcher'} onClick={() => setSheet(sheet?.kind === 'switcher' ? null : { kind: 'switcher' })} />
          <RailButton label="Version history" icon={History} on={sheet?.kind === 'versions'} onClick={() => setSheet(sheet?.kind === 'versions' ? null : { kind: 'versions' })} />
        </div>

        <main className="relative min-h-0 min-w-0 flex-1">
          {tab === 'builder' && (
            <>
              {statsOn && <p className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-navy-800 px-3 py-1 text-xs font-semibold text-white shadow">Stats view · last 30 days · editing is off</p>}
              <Canvas
                triggers={wf.triggers} steps={wf.steps} lookups={o} selected={sel} problems={problemIds} stats={statsOn ? stats : null} readOnly={statsOn}
                onSelect={(s) => { if (statsOn) return; setSel(s); setSheet({ kind: 'edit' }); }}
                onAddTrigger={() => setSheet({ kind: 'addTrigger' })}
                onAddStep={(place, index) => setSheet({ kind: 'addStep', place, index })}
                onMove={(sid, dir) => set({ steps: moveStep(wf.steps, sid, dir) })}
              />
            </>
          )}
          {tab === 'settings' && <SettingsTab settings={wf.settings} onChange={(s) => set({ settings: s })} o={o} accountTz={tz} />}
          {tab === 'enrollment' && <EnrollmentTab workflowId={wf.id} steps={wf.steps} onViewLogs={(r) => { setLogRun(r); setTab('logs'); }} />}
          {tab === 'logs' && <LogsTab workflowId={wf.id} runId={logRun} onClearRun={() => setLogRun(null)} />}

          {sheet?.kind === 'addTrigger' && <TriggerPicker onPick={addTrigger} onClose={() => setSheet(null)} />}
          {sheet?.kind === 'addStep' && <StepPicker onPick={(t) => addStep(t, sheet.place, sheet.index)} onClose={() => setSheet(null)} />}
          {sheet?.kind === 'edit' && selTrigger && (
            <Sheet title={triggerDef(selTrigger.type)?.label ?? 'Trigger'} subtitle={triggerDef(selTrigger.type)?.description} onClose={() => setSheet(null)}
              footer={<>
                <button type="button" onClick={() => { set({ triggers: wf.triggers.filter((t) => t.id !== selTrigger.id) }); setSheet(null); setSel(null); }} className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold text-burgundy-600 hover:bg-burgundy-50"><Trash2 className="h-4 w-4" /> Delete trigger</button>
                <button type="button" onClick={() => setSheet(null)} className="btn-primary ml-auto">Done</button>
              </>}>
              <SheetIcon kind="trigger" type={selTrigger.type} />
              <TriggerEditor t={selTrigger} o={o} onChange={(t) => set({ triggers: wf.triggers.map((x) => (x.id === t.id ? t : x)) })} />
            </Sheet>
          )}
          {sheet?.kind === 'edit' && selStep && (
            <Sheet title={stepDef(selStep.type)?.label ?? 'Step'} subtitle={stepDef(selStep.type)?.description} onClose={() => setSheet(null)}
              footer={<>
                <button type="button" onClick={() => { set({ steps: removeStep(wf.steps, selStep.id) }); setSheet(null); setSel(null); }} className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold text-burgundy-600 hover:bg-burgundy-50"><Trash2 className="h-4 w-4" /> Delete</button>
                {selStep.type !== 'if_else' && <button type="button" onClick={() => set({ steps: duplicateStep(wf.steps, selStep.id) })} className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold text-navy-800 hover:bg-navy-50"><Copy className="h-4 w-4" /> Duplicate</button>}
                <button type="button" onClick={() => setSheet(null)} className="btn-primary ml-auto">Done</button>
              </>}>
              <SheetIcon kind="step" type={selStep.type} />
              <StepEditor step={selStep} o={o} selfId={wf.id} onChange={(s) => set({ steps: updateStep(wf.steps, s.id, s) })} />
              {selStep.type === 'if_else' && <p className="mt-4 text-xs text-ivory-700">Deleting an If / Else keeps the steps on its Yes path and removes the No path.</p>}
            </Sheet>
          )}
          {sheet?.kind === 'errors' && <ErrorsPanel issues={problems} onGo={goToIssue} onClose={() => setSheet(null)} />}
          {sheet?.kind === 'notes' && <NotesPanel value={wf.notes} onChange={(v) => set({ notes: v })} onClose={() => setSheet(null)} />}
          {sheet?.kind === 'switcher' && <SwitcherPanel list={o.workflowList} currentId={wf.id} onOpen={(w) => leave(`/workflows/${w}`)} onClose={() => setSheet(null)} />}
          {sheet?.kind === 'versions' && <VersionsPanel workflowId={wf.id} onRestore={restore} onClose={() => setSheet(null)} />}
          {sheet?.kind === 'test' && wf.id && workspace && (
            <TestSheet workspaceId={workspace.id} onClose={() => setSheet(null)} onRun={async (contactId) => {
              const { runId, error: e } = await testRun(wf.id!, contactId);
              if (e || !runId) { toast(e ?? 'Could not run the test.', 'error'); return; }
              toast('Test started. Steps run for real for this contact (emails go out at the next minute).', 'info');
              setSheet(null); setLogRun(runId); setTab('logs');
            }} />
          )}
        </main>
      </div>
    </Shell>
  );
}

/** What the page compares to know if there are unsaved changes. */
const strip = (w: Editable) => ({ n: w.name, no: w.notes, st: w.settings, t: w.triggers, s: w.steps });

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[70] flex flex-col bg-white text-navy-900" data-workflow-builder>{children}</div>;
}

function RailButton({ label, icon: Icon, on, onClick, badge, dot }: { label: string; icon: React.ComponentType<{ className?: string }>; on: boolean; onClick: () => void; badge?: number; dot?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={on} title={label}
      className={cn('relative flex h-10 w-10 items-center justify-center rounded-[10px] transition', on ? 'bg-navy-800 text-gold-300' : 'text-navy-600 hover:bg-navy-50 hover:text-navy-900')}>
      <Icon className="h-[18px] w-[18px]" />
      {badge !== undefined && <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-burgundy-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{badge}</span>}
      {dot && !badge && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gold-400" />}
    </button>
  );
}

function SheetIcon({ kind, type }: { kind: 'trigger' | 'step'; type: string }) {
  const d = kind === 'trigger' ? triggerDef(type) : stepDef(type);
  if (!d) return null;
  return <div className="mb-4 flex items-center gap-3"><Chip tone={d.tone} icon={d.icon} size="lg" /><span className="text-xs font-bold uppercase tracking-[0.1em] text-ivory-600">{kind === 'trigger' ? 'Trigger' : d.group}</span></div>;
}

function TestSheet({ workspaceId, onRun, onClose }: { workspaceId: string; onRun: (contactId: string) => Promise<void>; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<{ id: string; name: string; email: string | null }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const t = useRef(0);
  useEffect(() => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => { searchContacts(workspaceId, q).then(setRows); }, 200);
    return () => window.clearTimeout(t.current);
  }, [q, workspaceId]);
  return (
    <Sheet title="Test this workflow" subtitle="Runs every step for one contact now, even while it’s a draft. Messages are real, so use your own test contact." onClose={onClose}>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a contact" aria-label="Find a contact" className="h-10 w-full rounded-[10px] bg-navy-50 pl-9 pr-3 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-gold-400" />
      </div>
      <ul className="divide-y divide-navy-50 overflow-hidden rounded-2xl ring-1 ring-navy-100">
        {rows.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-navy-900">{c.name}</span><span className="block truncate text-xs text-ivory-700">{c.email ?? 'No email'}</span></span>
            <button type="button" disabled={!!busy} onClick={async () => { setBusy(c.id); await onRun(c.id); setBusy(null); }} aria-label={`Run test for ${c.name}`} className="inline-flex items-center gap-1 rounded-lg bg-navy-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-700 disabled:opacity-60">{busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Run test</button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-ivory-700">No contacts found.</li>}
      </ul>
      <p className="mt-3 text-xs text-ivory-700">A test proves the steps work. To prove the trigger, publish and make the real thing happen with a fresh contact, then check Enrollment history.</p>
    </Sheet>
  );
}
