import { useEffect, useState, useCallback, type ComponentType } from 'react';
import {
  Workflow as WorkflowIcon, Plus, Search, Play, Pause, Copy, Trash2, Edit,
  Zap, Tag, Clock, FileText, ChevronDown,
  PlusCircle, RefreshCw, LayoutGrid, List as ListIcon, Sparkles, Folder, ArrowUpDown, Upload as UploadIcon, Download, ArrowLeft,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { WorkflowStatusPill } from '@/components/ui/StatusPills';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { timeAgo, cn } from '@/lib/utils';
import { WorkflowBuilder } from '@/components/workflow/WorkflowBuilder';
import { getTriggerOption, getActionOption } from '@/lib/workflow-constants';
import type { Workflow, WorkflowNode, WorkflowExecution, WorkflowExecutionLog, TriggerType, WorkflowTemplate } from '@/types';

const TRIGGERS: { value: TriggerType; label: string; icon: typeof Zap }[] = [
  { value: 'appointment_booked', label: 'Appointment Booked', icon: Zap },
  { value: 'appointment_confirmed', label: 'Appointment Confirmed', icon: Zap },
  { value: 'appointment_cancelled', label: 'Appointment Cancelled', icon: Zap },
  { value: 'appointment_rescheduled', label: 'Appointment Rescheduled', icon: Zap },
  { value: 'appointment_completed', label: 'Appointment Completed', icon: Zap },
  { value: 'appointment_no_show', label: 'No-show', icon: Zap },
  { value: 'form_submitted', label: 'Form Submitted', icon: FileText },
  { value: 'contact_created', label: 'Contact Created', icon: Zap },
  { value: 'tag_added', label: 'Tag Added', icon: Tag },
  { value: 'tag_removed', label: 'Tag Removed', icon: Tag },
];

export function WorkflowsPage() {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [historyWorkflow, setHistoryWorkflow] = useState<Workflow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Workflow | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'draft' | 'paused'>('all');
  const [listView, setListView] = useState<'table' | 'grid'>('table');
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [editorScreen, setEditorScreen] = useState<'scratch' | 'ai' | 'templates' | 'import' | null>(null);
  const [editorPreset, setEditorPreset] = useState<EditorPreset | undefined>();
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('workflows')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    setWorkflows((data ?? []) as Workflow[]);
    setLoading(false);
  }, [workspace]);

  useEffect(() => { loadWorkflows(); }, [loadWorkflows]);

  const toggleStatus = async (wf: Workflow) => {
    const newStatus = wf.status === 'active' ? 'paused' : 'active';
    await supabase.from('workflows').update({ status: newStatus }).eq('id', wf.id);
    toast(`Workflow ${newStatus === 'active' ? 'activated' : 'paused'}`);
    loadWorkflows();
  };

  const duplicateWorkflow = async (wf: Workflow) => {
    if (!workspace) return;
    const { data } = await supabase.from('workflows').insert({
      workspace_id: workspace.id,
      name: `${wf.name} (Copy)`,
      description: wf.description,
      trigger_type: wf.trigger_type,
      trigger_config: wf.trigger_config,
      status: 'draft',
    }).select().single();
    if (data) {
      const { data: nodes } = await supabase.from('workflow_nodes').select('*').eq('workflow_id', wf.id);
      if (nodes && nodes.length > 0) {
        await supabase.from('workflow_nodes').insert(nodes.map(n => ({
          workflow_id: data.id,
          node_type: n.node_type,
          action_type: n.action_type,
          config: n.config,
          sort_order: n.sort_order,
        })));
      }
      toast('Workflow duplicated');
      loadWorkflows();
    }
  };

  const exportWorkflow = async (wf: Workflow) => {
    const { data: nodes } = await supabase.from('workflow_nodes').select('*').eq('workflow_id', wf.id).order('sort_order');
    const exportData = {
      name: wf.name,
      description: wf.description,
      trigger: wf.trigger_type,
      nodes: (nodes ?? []).map(n => ({
        node_type: n.node_type,
        action_type: n.action_type,
        config: n.config,
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${wf.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-workflow.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Workflow exported');
  };

  const deleteWorkflow = async () => {
    if (!deleteConfirm) return;
    await supabase.from('workflows').delete().eq('id', deleteConfirm.id);
    toast('Workflow deleted');
    setDeleteConfirm(null);
    loadWorkflows();
  };

  const filteredWorkflows = workflows.filter(w =>
    (!search || w.name.toLowerCase().includes(search.toLowerCase())) &&
    (statusFilter === 'all' || w.status === statusFilter)
  );
  const activeCount = workflows.filter((workflow) => workflow.status === 'active').length;
  const draftCount = workflows.filter((workflow) => workflow.status === 'draft').length;
  const pausedCount = workflows.filter((workflow) => workflow.status === 'paused').length;
  const executionCount = workflows.reduce((sum, workflow) => sum + (workflow.total_runs || 0), 0);

  return (
    <div className="space-y-6 pb-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em] text-navy-800">Workflows</h1>
          <p className="mt-1 text-sm text-ivory-700">Automate your appointments, contacts, forms, and client follow-ups.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <button onClick={() => setCreateMenuOpen((open) => !open)} className="btn-primary btn-sm"><Plus className="h-4 w-4" /> Create Workflow <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', createMenuOpen && 'rotate-180')} /></button>
            {createMenuOpen && <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border border-navy-100 bg-white p-2 shadow-popover">
              <CreateWorkflowOption icon={PlusCircle} title="Start from scratch" description="Build a workflow step by step" onClick={() => { setCreateMenuOpen(false); setEditorPreset(undefined); setEditorScreen('scratch'); }} />
              <CreateWorkflowOption icon={Sparkles} title="Create with AI" description="Describe what you want to automate" onClick={() => { setCreateMenuOpen(false); setEditorScreen('ai'); }} />
              <CreateWorkflowOption icon={FileText} title="Use a template" description="Start with a ready-made workflow" onClick={() => { setCreateMenuOpen(false); setEditorScreen('templates'); }} />
              <CreateWorkflowOption icon={UploadIcon} title="Import workflow" description="Import a workflow from JSON" onClick={() => { setCreateMenuOpen(false); setEditorScreen('import'); }} />
            </div>}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <WorkflowMetric label="Active" value={activeCount} icon={Play} tone="green" />
        <WorkflowMetric label="Drafts" value={draftCount} icon={FileText} tone="navy" />
        <WorkflowMetric label="Paused" value={pausedCount} icon={Pause} tone="gold" />
        <WorkflowMetric label="Executions This Month" value={executionCount} icon={ArrowUpDown} tone="gold" />
      </section>

      {loading ? (
        <div className="card space-y-3 p-6">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : filteredWorkflows.length === 0 ? (
        <div className="card"><EmptyState icon={<WorkflowIcon className="h-7 w-7" />} title="No workflows yet" description="Create your first workflow to automate actions when events happen." action={<button onClick={() => { setEditingWorkflow(null); setShowBuilder(true); }} className="btn-primary"><Plus className="h-4 w-4" /> Create Workflow</button>} /></div>
      ) : (
        <section className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-navy-100 p-3 lg:flex-row lg:items-center">
            <div className="relative min-w-[210px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
              <input className="input-field h-9 pl-9 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search workflows..." />
            </div>
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-navy-100 p-1">
              {(['all', 'active', 'draft', 'paused'] as const).map((filter) => <button key={filter} onClick={() => setStatusFilter(filter)} className={cn('rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors', statusFilter === filter ? 'bg-gold-50 text-gold-700' : 'text-ivory-600 hover:bg-ivory-50')}>{filter}</button>)}
            </div>
            <button className="btn-secondary btn-sm"><Folder className="h-3.5 w-3.5" /> All Folders <ChevronDown className="h-3.5 w-3.5" /></button>
            <button className="btn-secondary btn-sm"><ArrowUpDown className="h-3.5 w-3.5" /> Recently Updated <ChevronDown className="h-3.5 w-3.5" /></button>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={loadWorkflows} className="btn-ghost btn-sm"><RefreshCw className="h-4 w-4" /></button>
              <button onClick={() => setListView('table')} className={cn('btn-ghost btn-sm', listView === 'table' && 'bg-gold-50 text-gold-700')}><ListIcon className="h-4 w-4" /></button>
              <button onClick={() => setListView('grid')} className={cn('btn-ghost btn-sm', listView === 'grid' && 'bg-gold-50 text-gold-700')}><LayoutGrid className="h-4 w-4" /></button>
            </div>
          </div>

          {listView === 'grid' ? (
            <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredWorkflows.map((wf) => <WorkflowCard key={wf.id} workflow={wf} onToggle={() => toggleStatus(wf)} onEdit={() => { setEditingWorkflowId(wf.id); setEditorPreset(undefined); setEditorScreen('scratch'); }} onHistory={() => setHistoryWorkflow(wf)} onDuplicate={() => duplicateWorkflow(wf)} onDelete={() => setDeleteConfirm(wf)} onExport={() => exportWorkflow(wf)} />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead><tr className="border-b border-navy-100 bg-ivory-50/60"><th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-ivory-600">Workflow</th><th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-ivory-600">Status</th><th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-ivory-600">Trigger</th><th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-ivory-600">Executions</th><th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-ivory-600">Last Execution</th><th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-ivory-600">Updated</th><th className="px-5 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-ivory-600">Actions</th></tr></thead>
                <tbody>{filteredWorkflows.map((wf) => {
                  const triggerMeta = TRIGGERS.find((trigger) => trigger.value === wf.trigger_type);
                  const TriggerIcon = triggerMeta?.icon ?? Zap;
                  return <tr key={wf.id} className="border-b border-sand transition-colors last:border-0 hover:bg-ivory-50/70">
                    <td className="px-5 py-4"><div className="flex min-w-[250px] items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-50 text-gold-700"><WorkflowIcon className="h-5 w-5" /></div><div><p className="text-sm font-semibold text-navy-800">{wf.name}</p><p className="mt-0.5 max-w-[280px] truncate text-xs text-ivory-600">{wf.description || 'Automatically run actions based on this event.'}</p></div></div></td>
                    <td className="px-4 py-4"><WorkflowStatusPill status={wf.status} /></td>
                    <td className="px-4 py-4"><span className="inline-flex items-center gap-2 text-xs text-ivory-700"><TriggerIcon className="h-4 w-4 text-navy-500" />{triggerMeta?.label ?? wf.trigger_type.replace(/_/g, ' ')}</span></td>
                    <td className="px-4 py-4 text-xs font-semibold text-navy-700">{wf.total_runs.toLocaleString()}</td>
                    <td className="px-4 py-4 text-xs text-ivory-700">{wf.last_run_at ? <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-green-600" />{timeAgo(wf.last_run_at)}</span> : '—'}</td>
                    <td className="px-4 py-4 text-xs text-ivory-700">{timeAgo(wf.updated_at)}</td>
                    <td className="px-5 py-4"><div className="flex justify-end gap-1"><button onClick={() => toggleStatus(wf)} title={wf.status === 'active' ? 'Pause' : 'Activate'} className="btn-ghost btn-sm">{wf.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</button><button onClick={() => { setEditingWorkflowId(wf.id); setEditorPreset(undefined); setEditorScreen('scratch'); }} className="btn-ghost btn-sm"><Edit className="h-3.5 w-3.5" /></button><button onClick={() => setHistoryWorkflow(wf)} className="btn-ghost btn-sm"><Clock className="h-3.5 w-3.5" /></button><button onClick={() => duplicateWorkflow(wf)} className="btn-ghost btn-sm"><Copy className="h-3.5 w-3.5" /></button><button onClick={() => exportWorkflow(wf)} title="Export" className="btn-ghost btn-sm"><Download className="h-3.5 w-3.5" /></button><button onClick={() => setDeleteConfirm(wf)} className="btn-ghost btn-sm text-burgundy-600"><Trash2 className="h-3.5 w-3.5" /></button></div></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          )}
        </section>
      )}


      {editorScreen === 'scratch' && (
        <WorkflowBuilder
          workflowId={editingWorkflowId}
          preset={editorPreset}
          onClose={() => { setEditorScreen(null); setEditorPreset(undefined); setEditingWorkflowId(null); }}
          onSaved={() => { setEditorScreen(null); setEditorPreset(undefined); setEditingWorkflowId(null); loadWorkflows(); }}
        />
      )}

      {editorScreen === 'ai' && (
        <AIWorkflowScreen onClose={() => setEditorScreen(null)} onStart={(preset) => { setEditorPreset(preset); setEditorScreen('scratch'); }} />
      )}

      {editorScreen === 'templates' && (
        <WorkflowTemplatesScreen onClose={() => setEditorScreen(null)} onSelect={(preset) => { setEditorPreset(preset); setEditorScreen('scratch'); }} />
      )}

      {editorScreen === 'import' && (
        <ImportWorkflowScreen onClose={() => setEditorScreen(null)} onImported={(preset) => { setEditorPreset(preset); setEditorScreen('scratch'); }} />
      )}

      {showBuilder && (
        <WorkflowBuilder
          workflowId={editingWorkflow?.id ?? null}
          preset={editingWorkflow ? undefined : undefined}
          onClose={() => setShowBuilder(false)}
          onSaved={() => { setShowBuilder(false); loadWorkflows(); }}
        />
      )}

      {historyWorkflow && (
        <WorkflowHistoryDrawer workflow={historyWorkflow} onClose={() => setHistoryWorkflow(null)} />
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={deleteWorkflow}
        title="Delete workflow?"
        message="This will permanently delete this workflow and all its execution history."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function WorkflowMetric({ label, value, icon: Icon, tone }: { label: string; value: number; icon: ComponentType<{ className?: string }>; tone: 'green' | 'navy' | 'gold' }) {
  const toneClasses = tone === 'green' ? 'bg-green-50 text-green-700' : tone === 'navy' ? 'bg-ivory-100 text-navy-700' : 'bg-gold-50 text-gold-700';
  return (
    <div className="card flex items-center justify-between p-5">
      <div><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-ivory-600"><span className={cn('h-2 w-2 rounded-full', tone === 'green' ? 'bg-green-600' : tone === 'gold' ? 'bg-gold-500' : 'bg-ivory-500')} />{label}</p><p className="mt-2 text-[28px] leading-none font-bold tracking-[-0.03em] text-navy-800">{value.toLocaleString()}</p></div>
      <div className={cn('flex h-11 w-11 items-center justify-center rounded-xl', toneClasses)}><Icon className="h-5 w-5" /></div>
    </div>
  );
}

type EditorPreset = { name: string; description: string; trigger: TriggerType; nodes: WorkflowNode[] };

function CreateWorkflowOption({ icon: Icon, title, description, onClick, disabled = false }: { icon: ComponentType<{ className?: string }>; title: string; description: string; onClick?: () => void; disabled?: boolean }) {
  return <button disabled={disabled} onClick={onClick} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors', disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-ivory-50')}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold-50 text-gold-700"><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-navy-800">{title}</span><span className="mt-0.5 block text-[11px] text-ivory-600">{description}</span></span></button>;
}

function AIWorkflowScreen({ onClose, onStart }: { onClose: () => void; onStart: (preset: EditorPreset) => void }) {
  const [prompt, setPrompt] = useState('');
  const [generated, setGenerated] = useState<EditorPreset | null>(null);
  const [generating, setGenerating] = useState(false);

  const generateWorkflow = () => {
    setGenerating(true);
    setTimeout(() => {
      const lower = prompt.toLowerCase();
      let trigger: TriggerType = 'form_submitted';
      const nodes: WorkflowNode[] = [];

      if (lower.includes('appointment') && (lower.includes('book') || lower.includes('confirm'))) {
        trigger = 'appointment_booked';
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'send_email', config: { subject: 'Your appointment is confirmed', body: 'Hi {{contact.first_name}}, your appointment is confirmed. We look forward to seeing you!' }, sort_order: 0 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'wait', action_type: 'wait', config: { mode: 'duration', duration_value: 24, duration_unit: 'hours' }, sort_order: 1 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'send_sms', config: { body: 'Hi {{contact.first_name}}, reminder for your appointment tomorrow.' }, sort_order: 2 } as WorkflowNode);
      } else if (lower.includes('no-show') || lower.includes('no show') || lower.includes('missed')) {
        trigger = 'appointment_no_show';
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'add_tag', config: { tag: 'No-Show' }, sort_order: 0 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'send_sms', config: { body: 'Hi {{contact.first_name}}, we missed you today. Would you like to reschedule? {{appointment.booking_link}}' }, sort_order: 1 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'wait', action_type: 'wait', config: { mode: 'duration', duration_value: 1, duration_unit: 'days' }, sort_order: 2 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'send_email', config: { subject: 'We missed you today', body: 'Hi {{contact.first_name}}, we noticed you couldn\'t make your appointment. Reschedule anytime: {{appointment.booking_link}}' }, sort_order: 3 } as WorkflowNode);
      } else if (lower.includes('lead') || lower.includes('form') || lower.includes('intake')) {
        trigger = 'form_submitted';
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'send_email', config: { subject: 'Thanks for reaching out!', body: 'Hi {{contact.first_name}}, thanks for your interest! We\'ll be in touch within 24 hours.' }, sort_order: 0 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'add_tag', config: { tag: 'New Lead' }, sort_order: 1 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'wait', action_type: 'wait', config: { mode: 'duration', duration_value: 1, duration_unit: 'days' }, sort_order: 2 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'send_sms', config: { body: 'Hi {{contact.first_name}}, just following up on your inquiry. Do you have any questions?' }, sort_order: 3 } as WorkflowNode);
      } else if (lower.includes('welcome') || lower.includes('client')) {
        trigger = 'contact_created';
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'send_email', config: { subject: 'Welcome aboard!', body: 'Hi {{contact.first_name}}, welcome! Here\'s everything you need to get started.' }, sort_order: 0 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'add_tag', config: { tag: 'New Client' }, sort_order: 1 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'wait', action_type: 'wait', config: { mode: 'duration', duration_value: 3, duration_unit: 'days' }, sort_order: 2 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'send_email', config: { subject: 'How\'s it going?', body: 'Hi {{contact.first_name}}, checking in to see if you have any questions.' }, sort_order: 3 } as WorkflowNode);
      } else {
        trigger = 'form_submitted';
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'send_email', config: { subject: 'Thank you', body: 'Hi {{contact.first_name}}, thank you for reaching out.' }, sort_order: 0 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'wait', action_type: 'wait', config: { mode: 'duration', duration_value: 1, duration_unit: 'days' }, sort_order: 1 } as WorkflowNode);
        nodes.push({ id: crypto.randomUUID(), workflow_id: '', node_type: 'action', action_type: 'send_sms', config: { body: 'Hi {{contact.first_name}}, following up on your inquiry.' }, sort_order: 2 } as WorkflowNode);
      }

      const preset: EditorPreset = { name: 'AI Generated Workflow', description: prompt, trigger, nodes };
      setGenerated(preset);
      setGenerating(false);
    }, 800);
  };

  return <div className="fixed inset-y-0 left-0 right-0 z-[80] overflow-y-auto bg-white lg:left-[270px]"><header className="flex h-[70px] items-center gap-4 border-b border-navy-100 bg-white px-5"><button onClick={onClose} className="btn-ghost btn-sm"><ArrowLeft className="h-4 w-4" /> Workflows</button><div className="h-6 w-px bg-navy-100" /><span className="text-sm font-semibold text-navy-800">Create with AI</span></header><div className="mx-auto flex min-h-[calc(100vh-70px)] max-w-3xl flex-col items-center justify-center px-5 py-12"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gold-400 text-navy-800 shadow-sm"><Sparkles className="h-8 w-8" /></div><p className="mt-6 text-xs font-bold uppercase tracking-[0.16em] text-gold-700">Workflow assistant</p><h1 className="mt-3 text-center text-3xl font-bold tracking-[-0.03em] text-navy-800">What would you like to automate?</h1><p className="mt-3 max-w-xl text-center text-sm leading-6 text-ivory-700">Describe the outcome you want in plain language. We'll turn it into a workflow you can review and customize.</p><div className="mt-8 w-full rounded-2xl border border-navy-200 bg-white p-4 shadow-card"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-[150px] w-full resize-none border-0 text-sm leading-6 text-navy-800 outline-none placeholder:text-ivory-500" placeholder="Example: When someone submits my intake form, send them an email immediately, wait one day, then send an SMS reminder." /><div className="flex flex-col gap-3 border-t border-navy-100 pt-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-ivory-600">Be as specific as you like.</span><button disabled={!prompt.trim() || generating} onClick={generateWorkflow} className="btn-primary btn-sm"><Sparkles className="h-4 w-4" /> {generating ? 'Generating...' : 'Generate workflow'}</button></div></div>{generated && <div className="mt-5 w-full rounded-2xl border border-gold-200 bg-gold-50/50 p-5"><p className="text-sm font-bold text-navy-800">Your workflow outline is ready</p><p className="mt-1 text-xs text-ivory-700">Trigger: {getTriggerOption(generated.trigger)?.label ?? generated.trigger} with {generated.nodes.length} steps including {generated.nodes.map((n) => getActionOption(n.action_type ?? '')?.label ?? n.action_type).join(', ')}.</p><div className="mt-3 space-y-1">{generated.nodes.map((n, i) => <div key={i} className="flex items-center gap-2 text-xs text-navy-700"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold-100 text-[10px] font-bold text-gold-700">{i + 1}</span>{getActionOption(n.action_type ?? '')?.label ?? n.action_type}</div>)}</div><button onClick={() => onStart(generated)} className="btn-primary btn-sm mt-4">Open in workflow editor <ArrowLeft className="h-4 w-4 rotate-180" /></button></div>}<div className="mt-8 flex flex-wrap justify-center gap-2">{['Follow up with new leads', 'Confirm appointments', 'Welcome new clients', 'Recover no-shows'].map((suggestion) => <button key={suggestion} onClick={() => setPrompt(suggestion)} className="rounded-md border border-navy-100 bg-white px-3 py-2 text-xs text-navy-700 hover:border-gold-300">{suggestion}</button>)}</div></div></div>;
}

function WorkflowTemplatesScreen({ onClose, onSelect }: { onClose: () => void; onSelect: (preset: EditorPreset) => void }) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  useEffect(() => {
    supabase.from('workflow_templates').select('*').order('sort_order').then(({ data }) => {
      setTemplates((data ?? []) as WorkflowTemplate[]);
      setLoading(false);
    });
  }, []);

  const categories = ['all', ...new Set(templates.map((t) => t.category))];
  const filtered = templates.filter((t) => {
    const matchesSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.description ?? '').toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === 'all' || t.category === category;
    return matchesSearch && matchesCategory;
  });

  const templateColors: Record<string, string> = {
    Appointments: 'bg-green-50 text-green-700',
    'Lead management': 'bg-blue-50 text-blue-700',
    'Client experience': 'bg-gold-50 text-gold-700',
    Forms: 'bg-navy-50 text-navy-700',
    Recordings: 'bg-burgundy-50 text-burgundy-700',
    AI: 'bg-purple-50 text-purple-700',
  };

  return <div className="fixed inset-y-0 left-0 right-0 z-[80] overflow-y-auto bg-white lg:left-[270px]"><header className="sticky top-0 z-10 flex h-[70px] items-center gap-4 border-b border-navy-100 bg-white px-5"><button onClick={onClose} className="btn-ghost btn-sm"><ArrowLeft className="h-4 w-4" /> Workflows</button><div className="h-6 w-px bg-navy-100" /><span className="text-sm font-semibold text-navy-800">Workflow templates</span></header><div className="mx-auto max-w-5xl px-5 py-10"><div className="max-w-xl"><p className="text-xs font-bold uppercase tracking-[0.16em] text-gold-700">Start faster</p><h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-navy-800">Choose a workflow template</h1><p className="mt-3 text-sm leading-6 text-ivory-700">Pick a starting point and customize every step before you activate it.</p></div><div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-500" /><input className="input-field h-9 pl-9 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates..." /></div><div className="flex gap-1 overflow-x-auto">{categories.map((cat) => <button key={cat} onClick={() => setCategory(cat)} className={cn('shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors', category === cat ? 'bg-gold-50 text-gold-700' : 'text-ivory-600 hover:bg-ivory-50')}>{cat === 'all' ? 'All' : cat}</button>)}</div></div>{loading ? <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div> : <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">{filtered.map((template) => { const colorClass = templateColors[template.category] ?? 'bg-ivory-100 text-navy-700'; const triggerOpt = getTriggerOption(template.trigger_type); return <button key={template.id} onClick={() => onSelect({ name: template.name, description: template.description ?? '', trigger: template.trigger_type, nodes: (template.nodes as unknown as WorkflowNode[]) ?? [] })} className="card card-hover flex items-start gap-4 p-5 text-left"><span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', colorClass)}><WorkflowIcon className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-navy-800">{template.name}</span><span className="mt-1 block text-[11px] font-semibold uppercase tracking-wider text-ivory-500">{template.category}</span><span className="mt-3 block text-sm leading-5 text-ivory-700">{template.description}</span><span className="mt-2 flex items-center gap-1.5 text-[11px] text-ivory-500"><Zap className="h-3 w-3" /> {triggerOpt?.label ?? template.trigger_type}</span><span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-gold-700">Use template <ArrowLeft className="h-3.5 w-3.5 rotate-180" /></span></span></button>; })}</div>}</div></div>;
}

function ImportWorkflowScreen({ onClose, onImported }: { onClose: () => void; onImported: (preset: EditorPreset) => void }) {
  const { toast } = useToast();
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleImport = () => {
    setError(null);
    try {
      const data = JSON.parse(jsonText);
      if (!data.name || typeof data.name !== 'string') { setError('Missing or invalid "name" field'); return; }
      if (!data.trigger || typeof data.trigger !== 'string') { setError('Missing or invalid "trigger" field'); return; }
      if (!Array.isArray(data.nodes)) { setError('"nodes" must be an array'); return; }
      const validNodeTypes = ['trigger', 'action', 'condition', 'delay', 'wait', 'goal', 'split_test', 'branch', 'end'];
      for (const node of data.nodes) {
        if (!validNodeTypes.includes(node.node_type)) { setError(`Invalid node_type: ${node.node_type}`); return; }
        if (!node.action_type || typeof node.action_type !== 'string') { setError('Each node must have an action_type'); return; }
      }
      const preset: EditorPreset = {
        name: data.name,
        description: data.description ?? '',
        trigger: data.trigger as TriggerType,
        nodes: data.nodes.map((n: Record<string, unknown>, i: number) => ({
          id: crypto.randomUUID(),
          workflow_id: '',
          node_type: n.node_type as WorkflowNode['node_type'],
          action_type: n.action_type as string,
          config: (n.config as Record<string, unknown>) ?? {},
          sort_order: i,
        } as WorkflowNode)),
      };
      toast('Workflow imported successfully');
      onImported(preset);
    } catch {
      setError('Invalid JSON format');
    }
  };

  return <div className="fixed inset-y-0 left-0 right-0 z-[80] overflow-y-auto bg-white lg:left-[270px]"><header className="flex h-[70px] items-center gap-4 border-b border-navy-100 bg-white px-5"><button onClick={onClose} className="btn-ghost btn-sm"><ArrowLeft className="h-4 w-4" /> Workflows</button><div className="h-6 w-px bg-navy-100" /><span className="text-sm font-semibold text-navy-800">Import Workflow</span></header><div className="mx-auto max-w-2xl px-5 py-10"><div className="max-w-xl"><p className="text-xs font-bold uppercase tracking-[0.16em] text-gold-700">Import</p><h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-navy-800">Import a workflow</h1><p className="mt-3 text-sm leading-6 text-ivory-700">Paste a workflow JSON export below. The workflow will be created as a draft — you can review and activate it after import.</p></div><div className="mt-8"><textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} className="input-field min-h-[200px] py-3 font-mono text-sm" placeholder='{\n  "name": "My Workflow",\n  "description": "...",\n  "trigger": "form_submitted",\n  "nodes": [\n    { "node_type": "action", "action_type": "send_email", "config": { "subject": "...", "body": "..." } }\n  ]\n}' />{error && <div className="mt-3 rounded-xl border border-burgundy-200 bg-burgundy-50/40 p-3 text-xs text-burgundy-700">{error}</div>}<button onClick={handleImport} disabled={!jsonText.trim()} className="btn-primary btn-sm mt-4"><UploadIcon className="h-4 w-4" /> Import workflow</button></div><div className="mt-6 rounded-xl border border-navy-100 bg-ivory-50/50 p-4"><p className="text-xs font-semibold text-navy-700">Export format</p><p className="mt-1 text-xs text-ivory-600">You can export any workflow from the workflow list by clicking the export button. The JSON includes the workflow name, trigger, all nodes, and their configurations.</p></div></div></div>;
}

function WorkflowCard({ workflow, onToggle, onEdit, onHistory, onDuplicate, onDelete, onExport }: { workflow: Workflow; onToggle: () => void; onEdit: () => void; onHistory: () => void; onDuplicate: () => void; onDelete: () => void; onExport: () => void }) {
  return <div className="card card-hover p-5"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-50 text-gold-700"><WorkflowIcon className="h-5 w-5" /></div><div><h3 className="text-sm font-semibold text-navy-800">{workflow.name}</h3><p className="text-xs capitalize text-ivory-600">{workflow.trigger_type.replace(/_/g, ' ')}</p></div></div><WorkflowStatusPill status={workflow.status} /></div><p className="mt-4 line-clamp-2 text-xs text-ivory-600">{workflow.description || 'Automatically run actions based on this event.'}</p><div className="mt-4 flex items-center justify-between text-xs text-ivory-600"><span>{workflow.total_runs} executions</span><span>{workflow.last_run_at ? timeAgo(workflow.last_run_at) : 'Not run yet'}</span></div><div className="mt-4 flex items-center gap-1 border-t border-sand pt-3"><button onClick={onToggle} className="btn-secondary btn-sm flex-1">{workflow.status === 'active' ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Activate</>}</button><button onClick={onEdit} className="btn-ghost btn-sm"><Edit className="h-3.5 w-3.5" /></button><button onClick={onHistory} className="btn-ghost btn-sm"><Clock className="h-3.5 w-3.5" /></button><button onClick={onDuplicate} className="btn-ghost btn-sm"><Copy className="h-3.5 w-3.5" /></button><button onClick={onExport} className="btn-ghost btn-sm"><Download className="h-3.5 w-3.5" /></button><button onClick={onDelete} className="btn-ghost btn-sm text-burgundy-600"><Trash2 className="h-3.5 w-3.5" /></button></div></div>;
}

// ============================================================
// Workflow History
// ============================================================
function WorkflowHistoryDrawer({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [logs, setLogs] = useState<Record<string, WorkflowExecutionLog['status']>>({});
  const [loading, setLoading] = useState(true);
  const [selectedExecution, setSelectedExecution] = useState<WorkflowExecution | null>(null);

  useEffect(() => {
    supabase
      .from('workflow_executions')
      .select('*')
      .eq('workflow_id', workflow.id)
      .order('started_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setExecutions((data ?? []) as WorkflowExecution[]);
        setLoading(false);
      });
  }, [workflow.id]);

  useEffect(() => {
    if (!selectedExecution) return;
    supabase
      .from('workflow_execution_logs')
      .select('*')
      .eq('execution_id', selectedExecution.id)
      .order('executed_at', { ascending: true })
      .then(({ data }) => {
        const logMap: Record<string, WorkflowExecutionLog['status']> = {};
        (data ?? []).forEach((log) => { logMap[log.id] = log.status as WorkflowExecutionLog['status']; });
        setLogs(logMap);
      });
  }, [selectedExecution]);

  return (
    <Drawer open onClose={onClose} title="Execution History" description={workflow.name} width="lg">
      <div className="p-6">
        {loading ? (
          <Skeleton className="h-40" />
        ) : executions.length === 0 ? (
          <EmptyState icon={<Clock className="w-7 h-7" />} title="No executions yet" description="This workflow hasn't run yet." />
        ) : selectedExecution ? (
          <div>
            <button onClick={() => setSelectedExecution(null)} className="btn-ghost btn-sm mb-4"><ArrowLeft className="h-4 w-4" /> Back to list</button>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-navy-800">Execution Details</p>
                <p className="text-xs text-ivory-600">Started {timeAgo(selectedExecution.started_at)}</p>
              </div>
              <span className={cn('status-pill', selectedExecution.status === 'completed' ? 'bg-green-50 text-green-700' : selectedExecution.status === 'failed' ? 'bg-red-50 text-red-700' : selectedExecution.status === 'running' ? 'bg-blue-50 text-blue-700' : 'bg-ivory-100 text-ivory-700')}>
                <span className={cn('w-1.5 h-1.5 rounded-full', selectedExecution.status === 'completed' ? 'bg-green-500' : selectedExecution.status === 'failed' ? 'bg-red-500' : 'bg-blue-500')} />
                {selectedExecution.status}
              </span>
            </div>
            <div className="space-y-2">
              {Object.entries(logs).map(([logId, status]) => (
                <div key={logId} className="flex items-center gap-3 rounded-xl border border-navy-100 p-3">
                  <span className={cn('flex h-6 w-6 items-center justify-center rounded-full', status === 'success' ? 'bg-green-100 text-green-700' : status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-ivory-100 text-ivory-600')}>
                    <span className="text-[10px] font-bold">{status === 'success' ? 'OK' : status === 'failed' ? 'X' : '...'}</span>
                  </span>
                  <span className="text-xs font-medium text-navy-700 capitalize">{status}</span>
                </div>
              ))}
              {Object.keys(logs).length === 0 && <p className="text-xs text-ivory-500">No step logs available.</p>}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {executions.map(ex => (
              <button key={ex.id} onClick={() => setSelectedExecution(ex)} className="w-full p-3 rounded-xl border border-navy-100 text-left transition-colors hover:bg-ivory-50">
                <div className="flex items-center justify-between mb-1">
                  <span className={cn('status-pill', ex.status === 'completed' ? 'bg-green-50 text-green-700' : ex.status === 'failed' ? 'bg-red-50 text-red-700' : ex.status === 'running' ? 'bg-blue-50 text-blue-700' : ex.status === 'waiting' ? 'bg-gold-50 text-gold-700' : 'bg-ivory-100 text-ivory-700')}>
                    <span className={cn('w-1.5 h-1.5 rounded-full', ex.status === 'completed' ? 'bg-green-500' : ex.status === 'failed' ? 'bg-red-500' : ex.status === 'running' ? 'bg-blue-500' : 'bg-gold-500')} />
                    {ex.status}
                  </span>
                  <span className="text-xs text-ivory-600">{timeAgo(ex.started_at)}</span>
                </div>
                <p className="text-xs text-ivory-600">Node {ex.current_node_index} · {ex.completed_at ? 'Completed' : 'In progress'}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
