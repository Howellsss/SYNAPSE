import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ArrowLeft, X, Plus, Zap, Clock, GitBranch, Target, Split, Square,
  CheckCircle2, Settings2, Play, Sparkles, AlertTriangle, MousePointer2,
  Hand, ZoomIn, ZoomOut, Maximize2, Undo2, Redo2, Trash2, Copy,
  ChevronDown, Workflow as WorkflowIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import {
  TRIGGER_CATEGORIES, ACTION_CATEGORIES, getTriggerOption, getActionOption,
} from '@/lib/workflow-constants';
import { TriggerSelector, ActionSelector } from './Selectors';
import { NodeConfigPanel } from './NodeConfigPanel';
import type {
  Workflow, WorkflowNode, WorkflowStatus, TriggerType,
  WorkflowValidationIssue, WorkflowSettings,
} from '@/types';

interface BuilderNode extends Omit<WorkflowNode, 'id' | 'workflow_id'> {
  id: string;
  temp?: boolean;
}

interface WorkflowBuilderProps {
  workflowId: string | null;
  preset?: { name: string; description: string; trigger: TriggerType; nodes: BuilderNode[] };
  onClose: () => void;
  onSaved: () => void;
}

const NODE_ICONS: Record<string, typeof Zap> = {
  trigger: Zap, action: Settings2, condition: GitBranch, delay: Clock,
  wait: Clock, goal: Target, split_test: Split, branch: GitBranch, end: Square,
};

function nodeLabel(node: BuilderNode): string {
  if (node.node_type === 'trigger') return getTriggerOption(node.action_type ?? '')?.label ?? 'Trigger';
  const action = getActionOption(node.action_type ?? '');
  return action?.label ?? node.action_type ?? 'Step';
}

function nodeSummary(node: BuilderNode): string {
  const c = node.config;
  if (node.action_type === 'send_email') return (c.subject as string) || 'No subject';
  if (node.action_type === 'send_sms' || node.action_type === 'send_whatsapp') return (c.body as string)?.slice(0, 50) || 'No message';
  if (node.action_type === 'wait' || node.node_type === 'wait' || node.node_type === 'delay') {
    const val = c.duration_value ?? 1;
    const unit = c.duration_unit ?? 'hours';
    return `Wait ${val} ${unit}`;
  }
  if (node.action_type === 'add_tag' || node.action_type === 'remove_tag') return (c.tag as string) || 'No tag';
  if (node.action_type === 'add_note') return (c.content as string)?.slice(0, 50) || 'No content';
  if (node.action_type === 'if_else' || node.node_type === 'condition') {
    const conds = (c.conditions as unknown[]) ?? [];
    return conds.length > 0 ? `${conds.length} condition(s)` : 'No conditions';
  }
  if (node.action_type === 'goal') return GOAL_EVENT_LABELS[(c.goal_event as string)] ?? 'Goal';
  if (node.action_type === 'split_test') {
    const branches = (c.branches as unknown[]) ?? [];
    return `${branches.length} branches`;
  }
  if (node.action_type === 'end_workflow') return 'Stop execution';
  if (node.action_type === 'send_webhook' || node.action_type === 'http_request') return (c.url as string) || 'No URL';
  return '';
}

const GOAL_EVENT_LABELS: Record<string, string> = {
  appointment_booked: 'Appointment Booked',
  appointment_confirmed: 'Appointment Confirmed',
  form_submitted: 'Form Submitted',
  contact_replied: 'Contact Replied',
  tag_added: 'Tag Added',
  custom_condition: 'Custom Condition',
};

export function WorkflowBuilder({ workflowId, preset, onClose, onSaved }: WorkflowBuilderProps) {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState(preset?.name ?? 'Untitled Workflow');
  const [description, setDescription] = useState(preset?.description ?? '');
  const [status, setStatus] = useState<WorkflowStatus>('draft');
  const [trigger, setTrigger] = useState<TriggerType | null>(preset?.trigger ?? null);
  const [nodes, setNodes] = useState<BuilderNode[]>(preset?.nodes ?? []);
  const [loading, setLoading] = useState(!!workflowId);
  const [saving, setSaving] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showTriggerSelector, setShowTriggerSelector] = useState(!preset?.trigger && !workflowId);
  const [showActionSelector, setShowActionSelector] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [history, setHistory] = useState<{ nodes: BuilderNode[]; trigger: TriggerType | null }[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [settings, setSettings] = useState<WorkflowSettings>({ allow_reentry: false, max_reentry_count: 1, stop_on_response: false, timezone: 'UTC', error_handling: 'continue' });
  const actualWorkflowId = useRef(workflowId);

  // Load existing workflow
  useEffect(() => {
    if (!workflowId) return;
    (async () => {
      const { data: wf } = await supabase.from('workflows').select('*').eq('id', workflowId).maybeSingle();
      if (wf) {
        setName(wf.name);
        setDescription(wf.description ?? '');
        setStatus(wf.status);
        setTrigger(wf.trigger_type as TriggerType);
        setSettings((wf.settings as WorkflowSettings) ?? settings);
        actualWorkflowId.current = wf.id;
        const { data: dbNodes } = await supabase.from('workflow_nodes').select('*').eq('workflow_id', wf.id).order('sort_order');
        const loaded: BuilderNode[] = (dbNodes ?? []).map((n) => ({
          id: n.id, node_type: n.node_type, action_type: n.action_type,
          config: n.config, sort_order: n.sort_order,
          parent_node_id: n.parent_node_id, branch_label: n.branch_label,
        }));
        if (loaded.length > 0 && loaded[0].node_type === 'trigger') {
          setTrigger(loaded[0].action_type as TriggerType);
          setNodes(loaded.slice(1));
        } else {
          setNodes(loaded);
        }
      }
      setLoading(false);
    })();
  }, [workflowId]);

  // History management
  const pushHistory = useCallback((n: BuilderNode[], t: TriggerType | null) => {
    const newHistory = history.slice(0, historyIdx + 1);
    newHistory.push({ nodes: [...n], trigger: t });
    setHistory(newHistory);
    setHistoryIdx(newHistory.length - 1);
  }, [history, historyIdx]);

  const undo = () => {
    if (historyIdx > 0) {
      setHistoryIdx(historyIdx - 1);
      setNodes([...history[historyIdx - 1].nodes]);
      setTrigger(history[historyIdx - 1].trigger);
    }
  };
  const redo = () => {
    if (historyIdx < history.length - 1) {
      setHistoryIdx(historyIdx + 1);
      setNodes([...history[historyIdx + 1].nodes]);
      setTrigger(history[historyIdx + 1].trigger);
    }
  };

  const addNode = (actionType: string, afterId?: string) => {
    const actionMeta = getActionOption(actionType);
    const nodeType = actionType === 'wait' ? 'wait' : actionType === 'if_else' ? 'condition' : actionType === 'goal' ? 'goal' : actionType === 'split_test' ? 'split_test' : actionType === 'end_workflow' ? 'end' : 'action';
    const newNode: BuilderNode = {
      id: crypto.randomUUID(),
      node_type: nodeType as BuilderNode['node_type'],
      action_type: actionType,
      config: actionType === 'wait' ? { mode: 'duration', duration_value: 1, duration_unit: 'hours' } : actionType === 'if_else' ? { conditions: [], logic: 'AND' } : actionType === 'split_test' ? { branches: [{ label: 'Branch A', percentage: 50 }, { label: 'Branch B', percentage: 50 }] } : actionType === 'goal' ? { goal_event: 'appointment_booked', stop_on_reach: true } : {},
      sort_order: 0,
      temp: !actualWorkflowId.current,
    };
    if (afterId) {
      const idx = nodes.findIndex((n) => n.id === afterId);
      const newNodes = [...nodes];
      newNodes.splice(idx + 1, 0, newNode);
      setNodes(newNodes.map((n, i) => ({ ...n, sort_order: i })));
      pushHistory(newNodes, trigger);
    } else {
      const newNodes = [...nodes, newNode];
      setNodes(newNodes.map((n, i) => ({ ...n, sort_order: i })));
      pushHistory(newNodes, trigger);
    }
    setSelectedNodeId(newNode.id);
  };

  const updateNode = (id: string, config: Record<string, unknown>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...config } } : n)));
  };

  const removeNode = (id: string) => {
    const newNodes = nodes.filter((n) => n.id !== id);
    setNodes(newNodes.map((n, i) => ({ ...n, sort_order: i })));
    pushHistory(newNodes, trigger);
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  const duplicateNode = (id: string) => {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx < 0) return;
    const original = nodes[idx];
    const copy: BuilderNode = { ...original, id: crypto.randomUUID(), config: { ...original.config } };
    const newNodes = [...nodes];
    newNodes.splice(idx + 1, 0, copy);
    setNodes(newNodes.map((n, i) => ({ ...n, sort_order: i })));
    pushHistory(newNodes, trigger);
  };

  const handleSave = async (activate = false) => {
    if (!workspace || !name.trim()) { toast('Enter a workflow name first', 'error'); return; }
    if (!trigger) { toast('Add a trigger first', 'error'); return; }
    setSaving(true);
    const newStatus: WorkflowStatus = activate ? 'active' : status;
    const allNodes = [
      { node_type: 'trigger', action_type: trigger, config: {}, sort_order: 0 },
      ...nodes.map((n, i) => ({ node_type: n.node_type, action_type: n.action_type, config: n.config, sort_order: i + 1, parent_node_id: n.parent_node_id, branch_label: n.branch_label })),
    ];
    const wfId = actualWorkflowId.current;
    if (wfId) {
      await supabase.from('workflows').update({
        name: name.trim(), description: description.trim(), trigger_type: trigger,
        status: newStatus, settings: settings as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      }).eq('id', wfId);
      await supabase.from('workflow_nodes').delete().eq('workflow_id', wfId);
    } else {
      const { data, error } = await supabase.from('workflows').insert({
        workspace_id: workspace.id, name: name.trim(), description: description.trim(),
        trigger_type: trigger, status: newStatus, settings: settings as unknown as Record<string, unknown>,
      }).select().single();
      if (error || !data) { toast(error?.message ?? 'Failed to create workflow', 'error'); setSaving(false); return; }
      actualWorkflowId.current = data.id;
    }
    if (allNodes.length > 0) {
      await supabase.from('workflow_nodes').insert(allNodes.map((n) => ({
        workflow_id: actualWorkflowId.current,
        node_type: n.node_type, action_type: n.action_type, config: n.config, sort_order: n.sort_order,
        parent_node_id: n.parent_node_id ?? null, branch_label: n.branch_label ?? null,
      })));
    }
    if (activate) {
      // Create a version snapshot
      await supabase.from('workflow_versions').insert({
        workflow_id: actualWorkflowId.current,
        version_number: Date.now(),
        status: 'active',
        snapshot: { name: name.trim(), trigger_type: trigger, nodes: allNodes, settings },
        published_at: new Date().toISOString(),
      });
    }
    // Audit log
    await supabase.from('audit_logs').insert({
      workspace_id: workspace.id, user_id: null,
      action: activate ? 'workflow_activated' : 'workflow_updated',
      entity_type: 'workflow', entity_id: actualWorkflowId.current,
      details: { name: name.trim() },
    });
    setStatus(newStatus);
    setSaving(false);
    toast(activate ? 'Workflow activated' : 'Workflow saved');
    onSaved();
  };

  const validate = (): WorkflowValidationIssue[] => {
    const issues: WorkflowValidationIssue[] = [];
    if (!trigger) issues.push({ type: 'error', message: 'No trigger selected', node_label: 'Trigger' });
    nodes.forEach((n) => {
      if (n.action_type === 'send_email') {
        if (!n.config.subject) issues.push({ type: 'error', message: 'Email subject is empty', node_id: n.id, node_label: nodeLabel(n) });
        if (!n.config.body) issues.push({ type: 'error', message: 'Email body is empty', node_id: n.id, node_label: nodeLabel(n) });
      }
      if (n.action_type === 'send_sms' && !n.config.body)
        issues.push({ type: 'error', message: 'SMS message is empty', node_id: n.id, node_label: nodeLabel(n) });
      if (n.action_type === 'send_webhook' && !n.config.url)
        issues.push({ type: 'error', message: 'Webhook URL is empty', node_id: n.id, node_label: nodeLabel(n) });
      if (n.action_type === 'http_request' && !n.config.url)
        issues.push({ type: 'error', message: 'HTTP request URL is empty', node_id: n.id, node_label: nodeLabel(n) });
      if ((n.action_type === 'add_tag' || n.action_type === 'remove_tag') && !n.config.tag)
        issues.push({ type: 'warning', message: 'Tag name is empty', node_id: n.id, node_label: nodeLabel(n) });
      if ((n.node_type === 'condition' || n.action_type === 'if_else')) {
        const conds = (n.config.conditions as unknown[]) ?? [];
        if (conds.length === 0) issues.push({ type: 'warning', message: 'No conditions configured', node_id: n.id, node_label: nodeLabel(n) });
      }
    });
    return issues;
  };

  const issues = validate();
  const hasErrors = issues.some((i) => i.type === 'error');
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  if (loading) {
    return (
      <div className="fixed inset-y-0 left-0 right-0 z-[80] flex items-center justify-center bg-white lg:left-[270px]">
        <div className="text-sm text-ivory-600">Loading workflow...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-y-0 left-0 right-0 z-[80] flex flex-col bg-white lg:left-[270px]">
      {/* Top Toolbar */}
      <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-navy-100 px-4">
        <button onClick={onClose} className="btn-ghost btn-sm"><ArrowLeft className="h-4 w-4" /> Back</button>
        <div className="h-5 w-px bg-navy-100" />
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-40 border-0 bg-transparent text-sm font-semibold text-navy-800 outline-none" />
        <span className={cn(
          'status-pill text-[10px]',
          status === 'active' ? 'bg-green-50 text-green-700' :
          status === 'paused' ? 'bg-gold-50 text-gold-700' :
          status === 'archived' ? 'bg-ivory-100 text-ivory-700' :
          'bg-navy-50 text-navy-600',
        )}>
          <span className={cn('h-1.5 w-1.5 rounded-full',
            status === 'active' ? 'bg-green-600' : status === 'paused' ? 'bg-gold-500' : 'bg-navy-400',
          )} />
          {status}
        </span>
        <span className="hidden items-center gap-1 text-xs text-green-700 md:flex">
          <CheckCircle2 className="h-3.5 w-3.5" /> Saved
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={undo} disabled={historyIdx <= 0} className="btn-ghost btn-sm" title="Undo"><Undo2 className="h-4 w-4" /></button>
          <button onClick={redo} disabled={historyIdx >= history.length - 1} className="btn-ghost btn-sm" title="Redo"><Redo2 className="h-4 w-4" /></button>
          <div className="h-5 w-px bg-navy-100" />
          <button onClick={() => setShowTest(true)} className="btn-secondary btn-sm" title="Test Workflow"><Play className="h-3.5 w-3.5" /> Test</button>
          <button onClick={() => setShowAI(true)} className="btn-secondary btn-sm" title="AI Assistant"><Sparkles className="h-3.5 w-3.5" /> AI</button>
          <button onClick={() => setShowValidation(true)} className="btn-secondary btn-sm relative" title="Validation">
            <AlertTriangle className="h-3.5 w-3.5" /> Validate
            {issues.length > 0 && (
              <span className={cn('ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold', hasErrors ? 'bg-burgundy-100 text-burgundy-700' : 'bg-gold-100 text-gold-700')}>
                {issues.length}
              </span>
            )}
          </button>
          <button onClick={() => setShowSettings(true)} className="btn-ghost btn-sm" title="Settings"><Settings2 className="h-4 w-4" /></button>
          <div className="h-5 w-px bg-navy-100" />
          <button onClick={() => handleSave(false)} disabled={saving} className="btn-secondary btn-sm">{saving ? 'Saving...' : 'Save'}</button>
          <button onClick={() => handleSave(true)} disabled={saving || hasErrors} className="btn-primary btn-sm">
            {status === 'active' ? 'Update & Publish' : 'Activate'}
          </button>
        </div>
      </header>

      {/* Main Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <main className="relative flex-1 overflow-auto bg-white bg-[radial-gradient(#e8e6e0_1px,transparent_1px)] [background-size:20px_20px]">
          {/* Canvas Controls */}
          <div className="absolute left-4 top-4 z-10 flex flex-col gap-1 rounded-xl border border-navy-100 bg-white p-1 shadow-sm">
            <button className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-50 text-gold-700"><MousePointer2 className="h-4 w-4" /></button>
            <button className="flex h-8 w-8 items-center justify-center rounded-lg text-ivory-600 hover:bg-ivory-50"><Hand className="h-4 w-4" /></button>
            <div className="my-1 h-px bg-navy-100" />
            <button onClick={() => setZoom(Math.min(150, zoom + 10))} className="flex h-8 w-8 items-center justify-center rounded-lg text-ivory-600 hover:bg-ivory-50"><ZoomIn className="h-4 w-4" /></button>
            <span className="py-0.5 text-center text-[9px] font-semibold text-ivory-500">{zoom}%</span>
            <button onClick={() => setZoom(Math.max(50, zoom - 10))} className="flex h-8 w-8 items-center justify-center rounded-lg text-ivory-600 hover:bg-ivory-50"><ZoomOut className="h-4 w-4" /></button>
            <button onClick={() => setZoom(100)} className="flex h-8 w-8 items-center justify-center rounded-lg text-ivory-600 hover:bg-ivory-50"><Maximize2 className="h-3.5 w-3.5" /></button>
          </div>

          {/* Workflow Nodes */}
          <div className="flex min-h-full flex-col items-center px-4 py-16" style={{ zoom: zoom / 100 }}>
            {/* Trigger Node */}
            <div className="relative">
              {trigger ? (
                <div
                  className="w-[280px] cursor-pointer rounded-2xl border-2 border-gold-300 bg-white p-5 text-center shadow-sm transition-all hover:shadow-md"
                  onClick={() => setShowTriggerSelector(true)}
                >
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold-50 text-gold-700">
                    {(() => { const Icon = getTriggerOption(trigger)?.icon ?? Zap; return <Icon className="h-6 w-6" />; })()}
                  </div>
                  <h2 className="mt-3 text-sm font-bold text-navy-800">{getTriggerOption(trigger)?.label ?? 'Trigger'}</h2>
                  <p className="mt-1 text-xs text-ivory-600">This event starts your workflow</p>
                </div>
              ) : (
                <button
                  onClick={() => setShowTriggerSelector(true)}
                  className="flex w-[280px] flex-col items-center rounded-2xl border-2 border-dashed border-navy-200 bg-white/50 p-8 transition-all hover:border-gold-300 hover:bg-white"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 text-navy-400">
                    <Plus className="h-6 w-6" />
                  </div>
                  <h2 className="mt-3 text-sm font-bold text-navy-700">Add Trigger</h2>
                  <p className="mt-1 text-xs text-ivory-500">Choose what starts this workflow</p>
                </button>
              )}
              {showTriggerSelector && (
                <div className="absolute left-1/2 top-full z-20 -translate-x-1/2">
                  <TriggerSelector open onClose={() => setShowTriggerSelector(false)} onSelect={(t) => { setTrigger(t); pushHistory(nodes, t); }} />
                </div>
              )}
            </div>

            {/* Nodes */}
            {trigger && nodes.map((node, idx) => (
              <div key={node.id}>
                {/* Plus button between nodes */}
                <div className="relative flex h-10 items-center justify-center">
                  <div className="h-full w-px bg-navy-300" />
                  <button
                    onClick={() => setShowActionSelector(node.id)}
                    className="absolute flex h-7 w-7 items-center justify-center rounded-full border border-navy-200 bg-white text-navy-500 shadow-sm transition-all hover:border-gold-400 hover:bg-gold-50 hover:text-gold-700"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  {showActionSelector === node.id && (
                    <div className="absolute left-1/2 top-full z-20 -translate-x-1/2">
                      <ActionSelector open onClose={() => setShowActionSelector(null)} onSelect={(a) => addNode(a, node.id)} />
                    </div>
                  )}
                </div>

                {/* Node Card */}
                <NodeCard
                  node={node}
                  selected={selectedNodeId === node.id}
                  onSelect={() => setSelectedNodeId(node.id)}
                  onRemove={() => removeNode(node.id)}
                  onDuplicate={() => duplicateNode(node.id)}
                />

                {/* Branch rendering for conditions */}
                {(node.node_type === 'condition' || node.action_type === 'if_else') && (
                  <div className="mt-4 flex gap-8">
                    <div className="flex flex-col items-center">
                      <span className="mb-2 rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700">Yes</span>
                      <div className="h-6 w-px bg-navy-300" />
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="mb-2 rounded-full bg-burgundy-50 px-3 py-1 text-xs font-bold text-burgundy-700">No</span>
                      <div className="h-6 w-px bg-navy-300" />
                    </div>
                  </div>
                )}

                {/* Split test rendering */}
                {(node.node_type === 'split_test' || node.action_type === 'split_test') && (
                  <div className="mt-4 flex gap-4">
                    {(((node.config.branches as Array<{ label: string; percentage: number }>) ?? []).map((b, bidx) => (
                      <div key={bidx} className="flex flex-col items-center">
                        <span className="mb-2 rounded-full bg-gold-50 px-3 py-1 text-xs font-bold text-gold-700">{b.label} ({b.percentage}%)</span>
                        <div className="h-6 w-px bg-navy-300" />
                      </div>
                    )))}
                  </div>
                )}
              </div>
            ))}

            {/* Final plus button */}
            {trigger && (
              <div className="relative mt-4 flex h-10 items-center justify-center">
                <div className="h-full w-px bg-navy-300" />
                <button
                  onClick={() => setShowActionSelector('end')}
                  className="absolute flex h-8 w-8 items-center justify-center rounded-full border border-navy-200 bg-white text-navy-500 shadow-sm transition-all hover:border-gold-400 hover:bg-gold-50 hover:text-gold-700"
                >
                  <Plus className="h-4 w-4" />
                </button>
                {showActionSelector === 'end' && (
                  <div className="absolute left-1/2 top-full z-20 -translate-x-1/2">
                    <ActionSelector open onClose={() => setShowActionSelector(null)} onSelect={(a) => addNode(a)} />
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* Right Config Panel */}
        {selectedNode && (
          <aside className="w-[380px] shrink-0 border-l border-navy-100 bg-white">
            <NodeConfigPanel
              node={selectedNode}
              onUpdate={(config) => updateNode(selectedNode.id, config)}
              onClose={() => setSelectedNodeId(null)}
            />
          </aside>
        )}
      </div>

      {/* Settings Drawer */}
      {showSettings && (
        <SettingsDrawer
          name={name} description={description}
          settings={settings}
          onNameChange={setName} onDescriptionChange={setDescription}
          onSettingsChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Validation Panel */}
      {showValidation && (
        <ValidationPanel
          issues={issues}
          onClose={() => setShowValidation(false)}
          onJumpToNode={(id) => { setSelectedNodeId(id); setShowValidation(false); }}
        />
      )}

      {/* Test Panel */}
      {showTest && (
        <TestPanel
          trigger={trigger}
          nodes={nodes}
          onClose={() => setShowTest(false)}
        />
      )}

      {/* AI Assistant */}
      {showAI && (
        <AIAssistantPanel
          workflowName={name}
          trigger={trigger}
          nodes={nodes}
          onClose={() => setShowAI(false)}
          onAddNode={(actionType) => addNode(actionType)}
          onSetTrigger={(t) => { setTrigger(t); pushHistory(nodes, t); }}
        />
      )}
    </div>
  );
}

// ============================================================
// Node Card Component
// ============================================================
function NodeCard({ node, selected, onSelect, onRemove, onDuplicate }: {
  node: BuilderNode;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const Icon = NODE_ICONS[node.node_type] ?? Settings2;
  const actionMeta = getActionOption(node.action_type ?? '');
  const label = nodeLabel(node);
  const summary = nodeSummary(node);
  const isControl = node.node_type === 'condition' || node.node_type === 'goal' || node.node_type === 'split_test' || node.node_type === 'end';

  return (
    <div
      onClick={onSelect}
      className={cn(
        'w-[300px] cursor-pointer rounded-2xl border-2 bg-white p-4 shadow-sm transition-all',
        selected ? 'border-gold-400 shadow-md' : 'border-navy-200 hover:border-navy-300',
        isControl && 'border-l-4',
        node.node_type === 'condition' && 'border-l-burgundy-400',
        node.node_type === 'goal' && 'border-l-green-400',
        node.node_type === 'split_test' && 'border-l-gold-400',
        node.node_type === 'end' && 'border-l-navy-400',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          node.node_type === 'condition' ? 'bg-burgundy-50 text-burgundy-600' :
          node.node_type === 'goal' ? 'bg-green-50 text-green-600' :
          node.node_type === 'split_test' ? 'bg-gold-50 text-gold-700' :
          node.node_type === 'wait' || node.node_type === 'delay' ? 'bg-blue-50 text-blue-600' :
          node.node_type === 'end' ? 'bg-navy-100 text-navy-600' :
          'bg-ivory-100 text-navy-600',
        )}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-navy-800">{label}</p>
          {summary && <p className="mt-0.5 truncate text-xs text-ivory-500">{summary}</p>}
        </div>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button onClick={onDuplicate} className="rounded p-1 text-ivory-500 hover:bg-ivory-100 hover:text-navy-700"><Copy className="h-3.5 w-3.5" /></button>
          <button onClick={onRemove} className="rounded p-1 text-ivory-500 hover:bg-burgundy-50 hover:text-burgundy-600"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Settings Drawer
// ============================================================
function SettingsDrawer({ name, description, settings, onNameChange, onDescriptionChange, onSettingsChange, onClose }: {
  name: string;
  description: string;
  settings: WorkflowSettings;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onSettingsChange: (s: WorkflowSettings) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[85] flex justify-end">
      <div className="absolute inset-0 bg-navy-900/30 animate-backdrop-in" onClick={onClose} />
      <div className="relative h-full w-[440px] animate-drawer-in bg-white shadow-popover">
        <div className="flex items-center justify-between border-b border-navy-100 p-5">
          <h3 className="text-base font-bold text-navy-800">Workflow Settings</h3>
          <button onClick={onClose} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-5 overflow-y-auto p-5" style={{ maxHeight: 'calc(100vh - 80px)' }}>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Workflow Name</label>
            <input className="input-field py-2 text-sm" value={name} onChange={(e) => onNameChange(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Description</label>
            <textarea className="input-field min-h-[60px] py-2 text-sm" value={description} onChange={(e) => onDescriptionChange(e.target.value)} />
          </div>
          <div className="border-t border-navy-100 pt-4">
            <h4 className="mb-3 text-sm font-bold text-navy-800">Execution Settings</h4>
            <div className="space-y-4">
              <label className="flex items-center justify-between">
                <span className="text-xs font-medium text-navy-700">Allow Re-entry</span>
                <input type="checkbox" checked={settings.allow_reentry ?? false} onChange={(e) => onSettingsChange({ ...settings, allow_reentry: e.target.checked })} className="rounded border-navy-300" />
              </label>
              {settings.allow_reentry && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-navy-700">Max re-entry count</label>
                  <input type="number" className="input-field py-2 text-sm" value={settings.max_reentry_count ?? 1} onChange={(e) => onSettingsChange({ ...settings, max_reentry_count: parseInt(e.target.value) || 0 })} />
                </div>
              )}
              <label className="flex items-center justify-between">
                <span className="text-xs font-medium text-navy-700">Stop on Response</span>
                <input type="checkbox" checked={settings.stop_on_response ?? false} onChange={(e) => onSettingsChange({ ...settings, stop_on_response: e.target.checked })} className="rounded border-navy-300" />
              </label>
              <div>
                <label className="mb-1 block text-xs font-semibold text-navy-700">Timezone</label>
                <select className="input-field py-2 text-sm" value={settings.timezone ?? 'UTC'} onChange={(e) => onSettingsChange({ ...settings, timezone: e.target.value })}>
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">Eastern (ET)</option>
                  <option value="America/Chicago">Central (CT)</option>
                  <option value="America/Denver">Mountain (MT)</option>
                  <option value="America/Los_Angeles">Pacific (PT)</option>
                  <option value="Europe/London">London (GMT)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-navy-700">Error Handling</label>
                <select className="input-field py-2 text-sm" value={settings.error_handling ?? 'continue'} onChange={(e) => onSettingsChange({ ...settings, error_handling: e.target.value as 'stop' | 'continue' | 'retry' })}>
                  <option value="continue">Continue to next step</option>
                  <option value="stop">Stop workflow</option>
                  <option value="retry">Retry with backoff</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-navy-700">Execution Limit (per hour)</label>
                <input type="number" className="input-field py-2 text-sm" value={settings.execution_limit ?? 100} onChange={(e) => onSettingsChange({ ...settings, execution_limit: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
          </div>
          <div className="border-t border-navy-100 pt-4">
            <h4 className="mb-3 text-sm font-bold text-navy-800">Sender Details</h4>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-navy-700">Sender Name</label>
                <input className="input-field py-2 text-sm" placeholder="SYNAPSE" value={settings.sender_name ?? ''} onChange={(e) => onSettingsChange({ ...settings, sender_name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-navy-700">Sender Email</label>
                <input className="input-field py-2 text-sm" placeholder="noreply@synapse.com" value={settings.sender_email ?? ''} onChange={(e) => onSettingsChange({ ...settings, sender_email: e.target.value })} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Validation Panel
// ============================================================
function ValidationPanel({ issues, onClose, onJumpToNode }: {
  issues: WorkflowValidationIssue[];
  onClose: () => void;
  onJumpToNode: (id: string) => void;
}) {
  const errors = issues.filter((i) => i.type === 'error');
  const warnings = issues.filter((i) => i.type === 'warning');
  return (
    <div className="fixed inset-0 z-[85] flex justify-end">
      <div className="absolute inset-0 bg-navy-900/30 animate-backdrop-in" onClick={onClose} />
      <div className="relative h-full w-[440px] animate-drawer-in bg-white shadow-popover">
        <div className="flex items-center justify-between border-b border-navy-100 p-5">
          <div>
            <h3 className="text-base font-bold text-navy-800">Validation</h3>
            <p className="mt-0.5 text-xs text-ivory-600">{errors.length} errors, {warnings.length} warnings</p>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2 overflow-y-auto p-5" style={{ maxHeight: 'calc(100vh - 100px)' }}>
          {issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="mt-4 text-sm font-semibold text-navy-800">No issues found</p>
              <p className="mt-1 text-xs text-ivory-600">Your workflow is ready to activate.</p>
            </div>
          ) : (
            issues.map((issue, idx) => (
              <button
                key={idx}
                onClick={() => issue.node_id && onJumpToNode(issue.node_id)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-ivory-50',
                  issue.type === 'error' ? 'border-burgundy-200 bg-burgundy-50/30' : 'border-gold-200 bg-gold-50/30',
                )}
              >
                <span className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                  issue.type === 'error' ? 'bg-burgundy-100 text-burgundy-700' : 'bg-gold-100 text-gold-700',
                )}>
                  <AlertTriangle className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-navy-800">{issue.type === 'error' ? 'Error' : 'Warning'}</p>
                  <p className="mt-0.5 text-xs text-ivory-700">{issue.message}</p>
                  {issue.node_label && <p className="mt-1 text-[10px] font-medium text-ivory-500">Node: {issue.node_label}</p>}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Test Panel
// ============================================================
function TestPanel({ trigger, nodes, onClose }: {
  trigger: TriggerType | null;
  nodes: BuilderNode[];
  onClose: () => void;
}) {
  const [testContact, setTestContact] = useState('John Doe');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Array<{ step: string; status: 'success' | 'skipped' | 'warning'; detail: string }>>([]);

  const runTest = () => {
    setRunning(true);
    setResults([]);
    const steps: Array<{ step: string; status: 'success' | 'skipped' | 'warning'; detail: string }> = [];
    setTimeout(() => {
      steps.push({ step: 'Trigger', status: 'success', detail: trigger ? `Triggered by: ${getTriggerOption(trigger)?.label}` : 'No trigger' });
      nodes.forEach((n) => {
        const label = nodeLabel(n);
        if (n.action_type === 'send_email') {
          steps.push({ step: label, status: 'success', detail: `Email would be sent to ${testContact}` });
        } else if (n.action_type === 'send_sms') {
          steps.push({ step: label, status: 'success', detail: `SMS would be sent to ${testContact}` });
        } else if (n.action_type === 'wait' || n.node_type === 'wait' || n.node_type === 'delay') {
          steps.push({ step: label, status: 'success', detail: `Would wait ${n.config.duration_value ?? 1} ${n.config.duration_unit ?? 'hours'}` });
        } else if (n.node_type === 'condition' || n.action_type === 'if_else') {
          steps.push({ step: label, status: 'warning', detail: 'Condition would be evaluated — both branches shown' });
        } else if (n.action_type === 'add_tag') {
          steps.push({ step: label, status: 'success', detail: `Would add tag: ${n.config.tag ?? 'unnamed'}` });
        } else {
          steps.push({ step: label, status: 'success', detail: 'Would execute (no real side effects in test mode)' });
        }
      });
      setResults(steps);
      setRunning(false);
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-[85] flex justify-end">
      <div className="absolute inset-0 bg-navy-900/30 animate-backdrop-in" onClick={onClose} />
      <div className="relative h-full w-[440px] animate-drawer-in bg-white shadow-popover">
        <div className="flex items-center justify-between border-b border-navy-100 p-5">
          <div>
            <h3 className="text-base font-bold text-navy-800">Test Workflow</h3>
            <p className="mt-0.5 text-xs text-ivory-600">Safe test mode — no real messages sent</p>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5" style={{ maxHeight: 'calc(100vh - 100px)' }}>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Test Contact</label>
            <input className="input-field py-2 text-sm" value={testContact} onChange={(e) => setTestContact(e.target.value)} placeholder="Contact name" />
          </div>
          <button onClick={runTest} disabled={running || !trigger} className="btn-primary btn-sm w-full">
            <Play className="h-4 w-4" /> {running ? 'Running...' : 'Run Test'}
          </button>
          {results.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-ivory-500">Execution Timeline</p>
              {results.map((r, idx) => (
                <div key={idx} className="flex items-start gap-3 rounded-xl border border-navy-100 p-3">
                  <span className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                    r.status === 'success' ? 'bg-green-100 text-green-700' :
                    r.status === 'warning' ? 'bg-gold-100 text-gold-700' :
                    'bg-ivory-100 text-ivory-600',
                  )}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-navy-800">{r.step}</p>
                    <p className="mt-0.5 text-xs text-ivory-600">{r.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// AI Assistant Panel
// ============================================================
function AIAssistantPanel({ workflowName, trigger, nodes, onClose, onAddNode, onSetTrigger }: {
  workflowName: string;
  trigger: TriggerType | null;
  nodes: BuilderNode[];
  onClose: () => void;
  onAddNode: (actionType: string) => void;
  onSetTrigger: (t: TriggerType) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [processing, setProcessing] = useState(false);
  const suggestions = [
    'Add an SMS reminder after the first email',
    'Change the wait from 24 hours to 48 hours',
    'Explain what this workflow does',
    'Add a goal for appointment booked',
  ];

  const processPrompt = (text: string) => {
    setProcessing(true);
    setResponse('');
    setTimeout(() => {
      const lower = text.toLowerCase();
      if (lower.includes('explain')) {
        const triggerLabel = trigger ? getTriggerOption(trigger)?.label : 'no trigger';
        const steps = nodes.map((n) => nodeLabel(n)).join(', ');
        setResponse(`This workflow ("${workflowName}") starts when ${triggerLabel}. It then runs these steps: ${steps || 'none yet'}.`);
      } else if (lower.includes('add') && lower.includes('sms')) {
        onAddNode('send_sms');
        setResponse('I added a Send SMS action to the end of your workflow. You can configure the message in the panel on the right.');
      } else if (lower.includes('add') && lower.includes('email')) {
        onAddNode('send_email');
        setResponse('I added a Send Email action to the end of your workflow.');
      } else if (lower.includes('wait') && lower.includes('48')) {
        setResponse('To change the wait duration, click on the Wait node in the canvas and update the duration value to 48 hours in the config panel.');
      } else if (lower.includes('goal')) {
        onAddNode('goal');
        setResponse('I added a Goal node. You can configure the goal event in the panel on the right.');
      } else if (lower.includes('add') && lower.includes('wait')) {
        onAddNode('wait');
        setResponse('I added a Wait node. Configure the duration in the panel on the right.');
      } else if (lower.includes('add') && lower.includes('condition') || lower.includes('if') && lower.includes('else')) {
        onAddNode('if_else');
        setResponse('I added an If/Else branch. Configure the conditions in the panel on the right.');
      } else {
        setResponse('I can help you add steps, modify configurations, explain the workflow, or suggest improvements. Try one of the suggestions below.');
      }
      setProcessing(false);
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-[85] flex justify-end">
      <div className="absolute inset-0 bg-navy-900/30 animate-backdrop-in" onClick={onClose} />
      <div className="relative h-full w-[440px] animate-drawer-in bg-white shadow-popover">
        <div className="flex items-center justify-between border-b border-navy-100 p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-gold-600" />
            <div>
              <h3 className="text-base font-bold text-navy-800">AI Assistant</h3>
              <p className="mt-0.5 text-xs text-ivory-600">Modify or explain your workflow</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col p-5" style={{ height: 'calc(100vh - 80px)' }}>
          <div className="flex-1 space-y-3 overflow-y-auto">
            {response && (
              <div className="rounded-xl border border-gold-200 bg-gold-50/40 p-4">
                <p className="text-sm text-navy-800">{response}</p>
              </div>
            )}
          </div>
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s} onClick={() => { setPrompt(s); processPrompt(s); }} className="rounded-full border border-navy-100 bg-ivory-50 px-3 py-1.5 text-xs text-navy-700 hover:border-gold-300">
                  {s}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input className="input-field py-2 text-sm" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask AI to modify or explain..." onKeyDown={(e) => { if (e.key === 'Enter' && prompt.trim()) processPrompt(prompt); }} />
              <button onClick={() => prompt.trim() && processPrompt(prompt)} disabled={processing} className="btn-primary btn-sm shrink-0">
                {processing ? '...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
