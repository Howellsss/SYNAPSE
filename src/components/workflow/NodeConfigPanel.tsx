import { useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VariablePicker } from './ConditionBuilder';
import { ConditionBuilder } from './ConditionBuilder';
import {
  WAIT_DURATIONS, WAIT_MODES, GOAL_EVENTS, getActionOption,
} from '@/lib/workflow-constants';
import type { WorkflowNode, WorkflowCondition } from '@/types';

interface NodeConfigPanelProps {
  node: WorkflowNode;
  onUpdate: (config: Record<string, unknown>) => void;
  onClose: () => void;
}

export function NodeConfigPanel({ node, onUpdate, onClose }: NodeConfigPanelProps) {
  const actionType = node.action_type ?? '';
  const actionMeta = getActionOption(actionType);
  const [showVariables, setShowVariables] = useState(false);

  const insertVariable = (field: 'subject' | 'body' | 'content' | 'prompt' | 'message', variable: string) => {
    const current = (node.config[field] as string) ?? '';
    onUpdate({ [field]: current + variable });
  };

  const renderTitle = () => (
    <div className="flex items-center justify-between border-b border-navy-100 p-5">
      <div>
        <h3 className="text-base font-bold text-navy-800">{actionMeta?.label ?? 'Configure Node'}</h3>
        <p className="mt-0.5 text-xs text-ivory-600">{actionMeta?.description ?? ''}</p>
      </div>
      <button onClick={onClose} className="btn-ghost btn-sm"><X className="h-4 w-4" /></button>
    </div>
  );

  const renderVariableToggle = (field: 'subject' | 'body' | 'content' | 'prompt' | 'message') => (
    <div className="mt-2">
      <button
        onClick={() => setShowVariables(!showVariables)}
        className="flex items-center gap-1.5 text-xs font-medium text-gold-700 hover:text-gold-800"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Insert variable
      </button>
      {showVariables && (
        <div className="mt-2 rounded-xl border border-navy-100 bg-ivory-50/50 p-3">
          <VariablePicker onInsert={(v) => insertVariable(field, v)} />
        </div>
      )}
    </div>
  );

  // SEND EMAIL
  if (actionType === 'send_email') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">From</label>
            <input className="input-field py-2 text-sm" placeholder="sender@synapse.com"
              value={(node.config.from as string) ?? ''} onChange={(e) => onUpdate({ from: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">To</label>
            <select className="input-field py-2 text-sm" value={(node.config.to as string) ?? 'contact'} onChange={(e) => onUpdate({ to: e.target.value })}>
              <option value="contact">Contact email</option>
              <option value="host">Appointment host</option>
              <option value="custom">Custom email</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Subject</label>
            <input className="input-field py-2 text-sm" placeholder="Email subject"
              value={(node.config.subject as string) ?? ''} onChange={(e) => onUpdate({ subject: e.target.value })} />
            {renderVariableToggle('subject')}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Message</label>
            <textarea className="input-field min-h-[120px] py-2 text-sm" placeholder="Write your email..."
              value={(node.config.body as string) ?? ''} onChange={(e) => onUpdate({ body: e.target.value })} />
            {renderVariableToggle('body')}
          </div>
        </div>
      </div>
    );
  }

  // SEND SMS
  if (actionType === 'send_sms') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">From</label>
            <input className="input-field py-2 text-sm" placeholder="SYNAPSE"
              value={(node.config.from as string) ?? ''} onChange={(e) => onUpdate({ from: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">To</label>
            <select className="input-field py-2 text-sm" value={(node.config.to as string) ?? 'contact'} onChange={(e) => onUpdate({ to: e.target.value })}>
              <option value="contact">Contact phone</option>
              <option value="host">Appointment host</option>
              <option value="custom">Custom phone</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Message</label>
            <textarea className="input-field min-h-[100px] py-2 text-sm" placeholder="Write your SMS..."
              value={(node.config.body as string) ?? ''} onChange={(e) => onUpdate({ body: e.target.value })} />
            {renderVariableToggle('body')}
          </div>
        </div>
      </div>
    );
  }

  // WAIT
  if (actionType === 'wait' || node.node_type === 'wait' || node.node_type === 'delay') {
    const mode = (node.config.mode as string) ?? 'duration';
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Wait mode</label>
            <select className="input-field py-2 text-sm" value={mode} onChange={(e) => onUpdate({ mode: e.target.value })}>
              {WAIT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          {mode === 'duration' && (
            <div className="flex items-center gap-2">
              <input type="number" className="input-field w-24 py-2 text-sm" placeholder="Amount"
                value={(node.config.duration_value as number) ?? 1} onChange={(e) => onUpdate({ duration_value: parseInt(e.target.value) || 0 })} />
              <select className="input-field w-32 py-2 text-sm" value={(node.config.duration_unit as string) ?? 'hours'} onChange={(e) => onUpdate({ duration_unit: e.target.value })}>
                {WAIT_DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          )}
          {mode === 'until_datetime' && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-navy-700">Wait until date/time</label>
              <input type="datetime-local" className="input-field py-2 text-sm"
                value={(node.config.until_datetime as string) ?? ''} onChange={(e) => onUpdate({ until_datetime: e.target.value })} />
            </div>
          )}
          {mode === 'until_time' && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-navy-700">Wait until time</label>
              <input type="time" className="input-field py-2 text-sm"
                value={(node.config.until_time as string) ?? ''} onChange={(e) => onUpdate({ until_time: e.target.value })} />
            </div>
          )}
          {mode === 'business_hours' && (
            <div className="space-y-3 rounded-xl border border-navy-100 bg-ivory-50/50 p-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-navy-700">Business hours start</label>
                <input type="time" className="input-field py-2 text-sm"
                  value={(node.config.business_hours_start as string) ?? '09:00'} onChange={(e) => onUpdate({ business_hours_start: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-navy-700">Business hours end</label>
                <input type="time" className="input-field py-2 text-sm"
                  value={(node.config.business_hours_end as string) ?? '17:00'} onChange={(e) => onUpdate({ business_hours_end: e.target.value })} />
              </div>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Timezone</label>
            <select className="input-field py-2 text-sm" value={(node.config.timezone as string) ?? 'workspace'} onChange={(e) => onUpdate({ timezone: e.target.value })}>
              <option value="workspace">Workspace timezone</option>
              <option value="contact">Contact timezone</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Timeout behavior</label>
            <select className="input-field py-2 text-sm" value={(node.config.timeout_behavior as string) ?? 'continue'} onChange={(e) => onUpdate({ timeout_behavior: e.target.value })}>
              <option value="continue">Continue workflow</option>
              <option value="end">End workflow</option>
              <option value="skip">Skip to next step</option>
            </select>
          </div>
        </div>
      </div>
    );
  }

  // IF / ELSE
  if (actionType === 'if_else' || node.node_type === 'condition') {
    const conditions = (node.config.conditions as WorkflowCondition[]) ?? [];
    const logic = (node.config.logic as 'AND' | 'OR') ?? 'AND';
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <ConditionBuilder
            conditions={conditions}
            logic={logic}
            onLogicChange={(l) => onUpdate({ logic: l })}
            onConditionsChange={(c) => onUpdate({ conditions: c })}
          />
          <div className="rounded-xl border border-navy-100 bg-ivory-50/50 p-3">
            <p className="text-xs font-semibold text-navy-700">Yes branch</p>
            <p className="mt-0.5 text-xs text-ivory-600">Steps below this node will execute when the condition is true.</p>
          </div>
          <div className="rounded-xl border border-navy-100 bg-ivory-50/50 p-3">
            <p className="text-xs font-semibold text-navy-700">No branch</p>
            <p className="mt-0.5 text-xs text-ivory-600">Add a separate branch for when the condition is false.</p>
          </div>
        </div>
      </div>
    );
  }

  // GOAL
  if (actionType === 'goal' || node.node_type === 'goal') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Goal event</label>
            <select className="input-field py-2 text-sm" value={(node.config.goal_event as string) ?? 'appointment_booked'} onChange={(e) => onUpdate({ goal_event: e.target.value })}>
              {GOAL_EVENTS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="stop_on_reach" className="rounded border-navy-300"
              checked={(node.config.stop_on_reach as boolean) ?? true} onChange={(e) => onUpdate({ stop_on_reach: e.target.checked })} />
            <label htmlFor="stop_on_reach" className="text-xs font-medium text-navy-700">Stop workflow when goal is reached</label>
          </div>
          <div className="rounded-xl border border-navy-100 bg-ivory-50/50 p-3">
            <p className="text-xs text-ivory-600">The workflow will track this goal and mark it as reached when the event occurs. You can optionally continue or stop the workflow.</p>
          </div>
        </div>
      </div>
    );
  }

  // SPLIT TEST
  if (actionType === 'split_test' || node.node_type === 'split_test') {
    const branches = (node.config.branches as Array<{ label: string; percentage: number }>) ?? [
      { label: 'Branch A', percentage: 50 },
      { label: 'Branch B', percentage: 50 },
    ];
    const updateBranch = (idx: number, patch: Partial<{ label: string; percentage: number }>) => {
      const next = branches.map((b, i) => (i === idx ? { ...b, ...patch } : b));
      onUpdate({ branches: next });
    };
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <p className="text-xs text-ivory-600">Split contacts between branches with configurable percentages.</p>
          {branches.map((branch, idx) => (
            <div key={idx} className="rounded-xl border border-navy-100 p-3">
              <div className="flex items-center gap-2">
                <input className="input-field flex-1 py-1.5 text-sm" placeholder="Branch name"
                  value={branch.label} onChange={(e) => updateBranch(idx, { label: e.target.value })} />
                <input type="number" min={0} max={100} className="input-field w-20 py-1.5 text-sm"
                  value={branch.percentage} onChange={(e) => updateBranch(idx, { percentage: parseInt(e.target.value) || 0 })} />
                <span className="text-xs text-ivory-600">%</span>
              </div>
            </div>
          ))}
          <div className="text-xs font-semibold text-navy-600">Total: {branches.reduce((s, b) => s + b.percentage, 0)}%</div>
        </div>
      </div>
    );
  }

  // WEBHOOK
  if (actionType === 'send_webhook' || actionType === 'http_request') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">URL</label>
            <input className="input-field py-2 text-sm" placeholder="https://..."
              value={(node.config.url as string) ?? ''} onChange={(e) => onUpdate({ url: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Method</label>
            <select className="input-field py-2 text-sm" value={(node.config.method as string) ?? 'POST'} onChange={(e) => onUpdate({ method: e.target.value })}>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Headers (JSON)</label>
            <textarea className="input-field min-h-[60px] py-2 text-sm font-mono" placeholder='{"Content-Type": "application/json"}'
              value={(node.config.headers as string) ?? ''} onChange={(e) => onUpdate({ headers: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Body</label>
            <textarea className="input-field min-h-[80px] py-2 text-sm font-mono" placeholder='{"key": "value"}'
              value={(node.config.body as string) ?? ''} onChange={(e) => onUpdate({ body: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Retry behavior</label>
            <select className="input-field py-2 text-sm" value={(node.config.retry_behavior as string) ?? '3'} onChange={(e) => onUpdate({ retry_behavior: e.target.value })}>
              <option value="0">No retries</option>
              <option value="1">Retry once</option>
              <option value="3">Retry 3 times with backoff</option>
              <option value="5">Retry 5 times with backoff</option>
            </select>
          </div>
        </div>
      </div>
    );
  }

  // AI ACTIONS
  if (actionType === 'ai_action' || actionType === 'ai_prompt' || actionType === 'ai_summarize' || actionType === 'ai_extract_info' || actionType === 'ai_intent_detection' || actionType === 'ai_decision_maker') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Prompt</label>
            <textarea className="input-field min-h-[100px] py-2 text-sm" placeholder="Describe what you want the AI to do..."
              value={(node.config.prompt as string) ?? ''} onChange={(e) => onUpdate({ prompt: e.target.value })} />
            {renderVariableToggle('prompt')}
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Context (optional)</label>
            <input className="input-field py-2 text-sm" placeholder="Additional context for the AI"
              value={(node.config.context as string) ?? ''} onChange={(e) => onUpdate({ context: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Expected output</label>
            <input className="input-field py-2 text-sm" placeholder="e.g. A score from 1-10, a category, etc."
              value={(node.config.expected_output as string) ?? ''} onChange={(e) => onUpdate({ expected_output: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Output variable name</label>
            <input className="input-field py-2 text-sm" placeholder="e.g. ai_score"
              value={(node.config.output_variable as string) ?? ''} onChange={(e) => onUpdate({ output_variable: e.target.value })} />
          </div>
        </div>
      </div>
    );
  }

  // ADD/REMOVE TAG
  if (actionType === 'add_tag' || actionType === 'remove_tag') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Tag name</label>
            <input className="input-field py-2 text-sm" placeholder="e.g. New Lead"
              value={(node.config.tag as string) ?? ''} onChange={(e) => onUpdate({ tag: e.target.value })} />
          </div>
        </div>
      </div>
    );
  }

  // ADD NOTE
  if (actionType === 'add_note' || actionType === 'create_recording_note') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Note content</label>
            <textarea className="input-field min-h-[80px] py-2 text-sm" placeholder="Write a note..."
              value={(node.config.content as string) ?? ''} onChange={(e) => onUpdate({ content: e.target.value })} />
            {renderVariableToggle('content')}
          </div>
        </div>
      </div>
    );
  }

  // UPDATE CONTACT
  if (actionType === 'update_contact' || actionType === 'update_contact_field') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Field to update</label>
            <select className="input-field py-2 text-sm" value={(node.config.field as string) ?? ''} onChange={(e) => onUpdate({ field: e.target.value })}>
              <option value="">Select field…</option>
              <option value="first_name">First Name</option>
              <option value="last_name">Last Name</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="company">Company</option>
              <option value="job_title">Job Title</option>
              <option value="source">Source</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">New value</label>
            <input className="input-field py-2 text-sm" placeholder="Enter new value"
              value={(node.config.value as string) ?? ''} onChange={(e) => onUpdate({ value: e.target.value })} />
          </div>
        </div>
      </div>
    );
  }

  // CREATE TASK
  if (actionType === 'create_task') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Task title</label>
            <input className="input-field py-2 text-sm" placeholder="e.g. Follow up with lead"
              value={(node.config.title as string) ?? ''} onChange={(e) => onUpdate({ title: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Due in (days)</label>
            <input type="number" className="input-field py-2 text-sm" placeholder="1"
              value={(node.config.due_in_days as number) ?? 1} onChange={(e) => onUpdate({ due_in_days: parseInt(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Assign to</label>
            <select className="input-field py-2 text-sm" value={(node.config.assignee as string) ?? 'contact_owner'} onChange={(e) => onUpdate({ assignee: e.target.value })}>
              <option value="contact_owner">Contact owner</option>
              <option value="specific">Specific team member</option>
            </select>
          </div>
        </div>
      </div>
    );
  }

  // GO TO WORKFLOW
  if (actionType === 'go_to_workflow') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Target workflow</label>
            <input className="input-field py-2 text-sm" placeholder="Select workflow..."
              value={(node.config.target_workflow as string) ?? ''} onChange={(e) => onUpdate({ target_workflow: e.target.value })} />
          </div>
          <div className="rounded-xl border border-navy-100 bg-ivory-50/50 p-3">
            <p className="text-xs text-ivory-600">The contact will be enrolled into the target workflow. Loop prevention is built in — a contact cannot re-enter the same workflow within 24 hours.</p>
          </div>
        </div>
      </div>
    );
  }

  // END WORKFLOW
  if (actionType === 'end_workflow') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <p className="text-sm text-ivory-600">This will immediately terminate the workflow execution for the contact. No further steps will run.</p>
        </div>
      </div>
    );
  }

  // REMOVE FROM WORKFLOW
  if (actionType === 'remove_from_workflow') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Workflow to remove from</label>
            <select className="input-field py-2 text-sm" value={(node.config.target_workflow as string) ?? 'current'} onChange={(e) => onUpdate({ target_workflow: e.target.value })}>
              <option value="current">Current workflow</option>
              <option value="specific">Specific workflow</option>
            </select>
          </div>
        </div>
      </div>
    );
  }

  // SEND BOOKING LINK
  if (actionType === 'send_booking_link' || actionType === 'create_one_time_booking_link') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Calendar</label>
            <input className="input-field py-2 text-sm" placeholder="Select calendar..."
              value={(node.config.calendar as string) ?? ''} onChange={(e) => onUpdate({ calendar: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Send via</label>
            <select className="input-field py-2 text-sm" value={(node.config.channel as string) ?? 'email'} onChange={(e) => onUpdate({ channel: e.target.value })}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </div>
        </div>
      </div>
    );
  }

  // INTERNAL NOTIFICATION
  if (actionType === 'send_internal_notification') {
    return (
      <div className="flex h-full flex-col">
        {renderTitle()}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Recipient</label>
            <select className="input-field py-2 text-sm" value={(node.config.recipient as string) ?? 'all'} onChange={(e) => onUpdate({ recipient: e.target.value })}>
              <option value="all">All team members</option>
              <option value="owner">Contact owner</option>
              <option value="specific">Specific member</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-navy-700">Message</label>
            <textarea className="input-field min-h-[80px] py-2 text-sm" placeholder="Notification message..."
              value={(node.config.message as string) ?? ''} onChange={(e) => onUpdate({ message: e.target.value })} />
          </div>
        </div>
      </div>
    );
  }

  // DEFAULT / GENERIC
  return (
    <div className="flex h-full flex-col">
      {renderTitle()}
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <p className="text-sm text-ivory-600">Configure this action's settings.</p>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-navy-700">Configuration (JSON)</label>
          <textarea
            className="input-field min-h-[120px] py-2 text-sm font-mono"
            placeholder='{"key": "value"}'
            value={JSON.stringify(node.config, null, 2)}
            onChange={(e) => {
              try { onUpdate(JSON.parse(e.target.value)); } catch { /* invalid JSON, ignore */ }
            }}
          />
        </div>
      </div>
    </div>
  );
}
