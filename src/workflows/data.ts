import { supabase, supabaseKey } from '@/lib/supabase';
import {
  compile, fromLegacy, settingsFrom, type Definition, type Step, type Trigger, type WorkflowSettings,
} from './model';
import type { Lookups } from './catalog';

export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived';

export interface WorkflowRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  trigger_type: string;
  settings: unknown;
  definition?: Definition | null;
  notes?: string | null;
  total_runs: number | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string | null;
  version_number?: number | null;
}

export interface Editable {
  id: string | null;
  name: string;
  notes: string;
  status: WorkflowStatus;
  settings: WorkflowSettings;
  triggers: Trigger[];
  steps: Step[];
  /** Steps from the old builder that the new one can't run (shown once). */
  dropped: string[];
}

/** Shown when the workflow tables for the new builder aren't in the database yet. */
export const NEEDS_UPDATE = 'Workflows need the database update 20261010090000_workflow_engine.sql.';
const missing = (m: string) => /definition|wf_runs|wf_logs|does not exist|Could not find|schema cache/i.test(m);

export async function listWorkflows(workspaceId: string): Promise<{ rows: WorkflowRow[]; error: string | null }> {
  const { data, error } = await supabase.from('workflows').select('*').eq('workspace_id', workspaceId).order('updated_at', { ascending: false });
  return { rows: (data ?? []) as WorkflowRow[], error: error?.message ?? null };
}

export async function loadWorkflow(id: string): Promise<{ wf: Editable | null; row: WorkflowRow | null; error: string | null }> {
  const { data, error } = await supabase.from('workflows').select('*').eq('id', id).maybeSingle();
  if (error || !data) return { wf: null, row: null, error: error?.message ?? 'Workflow not found.' };
  const row = data as WorkflowRow;
  let triggers: Trigger[] = [];
  let steps: Step[] = [];
  let dropped: string[] = [];
  if (row.definition && Array.isArray(row.definition.steps)) {
    triggers = row.definition.triggers ?? [];
    steps = row.definition.steps;
  } else {
    // Built with the old builder: bring its trigger and steps across.
    const { data: nodes } = await supabase.from('workflow_nodes').select('node_type, action_type, config, sort_order').eq('workflow_id', id).order('sort_order');
    const conv = fromLegacy(row.trigger_type, (nodes ?? []) as { node_type: string; action_type: string | null; config: Record<string, unknown> }[]);
    ({ triggers, steps, dropped } = conv);
  }
  return {
    wf: { id: row.id, name: row.name, notes: row.notes ?? row.description ?? '', status: row.status, settings: settingsFrom(row.settings), triggers, steps, dropped },
    row,
    error: null,
  };
}

/** Save (and optionally publish). Keeps a copy in Version history. Returns the id. */
export async function saveWorkflow(workspaceId: string, wf: Editable): Promise<{ id: string | null; error: string | null }> {
  const definition = compile(wf.triggers, wf.steps);
  const record = {
    workspace_id: workspaceId,
    name: wf.name.trim() || 'Untitled workflow',
    description: wf.notes.slice(0, 500) || null,
    notes: wf.notes,
    status: wf.status,
    trigger_type: wf.triggers[0]?.type ?? 'none',
    trigger_config: {},
    settings: wf.settings,
    definition,
    updated_at: new Date().toISOString(),
  };
  const res = wf.id
    ? await supabase.from('workflows').update(record).eq('id', wf.id).select('id, version_number').single()
    : await supabase.from('workflows').insert(record).select('id, version_number').single();
  if (res.error) return { id: null, error: missing(res.error.message) ? NEEDS_UPDATE : res.error.message };
  const id = (res.data as { id: string }).id;
  const version = ((res.data as { version_number?: number | null }).version_number ?? 0) + 1;
  // Version history is a nice-to-have: never fail a save because of it.
  await supabase.from('workflow_versions').insert({ workflow_id: id, version_number: version, status: wf.status === 'active' ? 'active' : 'draft', snapshot: { name: record.name, notes: wf.notes, settings: wf.settings, definition }, published_at: wf.status === 'active' ? new Date().toISOString() : null });
  await supabase.from('workflows').update({ version_number: version }).eq('id', id);
  return { id, error: null };
}

export async function setStatus(id: string, status: WorkflowStatus): Promise<string | null> {
  const { error } = await supabase.from('workflows').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  return error?.message ?? null;
}

export async function deleteWorkflow(id: string): Promise<string | null> {
  const { error } = await supabase.from('workflows').delete().eq('id', id);
  return error?.message ?? null;
}

// ---------------------------------------------------------------- look-ups

export interface Options extends Lookups {
  tags: string[];
  channelList: { id: string; name: string; department: boolean }[];
  departmentList: { id: string; name: string }[];
  accounts: { id: string; email: string; display_name: string | null }[];
  people: { id: string; name: string }[];
  workflowList: { id: string; name: string }[];
}

export async function loadOptions(workspaceId: string, meId: string | null): Promise<Options> {
  const [tags, members, forms, calendars, events, workflows, accounts, channels, departments] = await Promise.all([
    supabase.from('tags').select('name').eq('workspace_id', workspaceId).order('name'),
    supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId),
    supabase.from('forms').select('id, name').eq('workspace_id', workspaceId).order('name'),
    supabase.from('calendars').select('id, name').eq('workspace_id', workspaceId).order('name'),
    supabase.from('events').select('id, title').eq('workspace_id', workspaceId).order('starts_at', { ascending: false }).limit(200),
    supabase.from('workflows').select('id, name').eq('workspace_id', workspaceId).order('name'),
    supabase.from('email_accounts').select('id, email, display_name, status').eq('workspace_id', workspaceId),
    supabase.from('chat_channels').select('id, name, is_department').eq('workspace_id', workspaceId).eq('kind', 'channel').is('archived_at', null).order('name'),
    supabase.from('departments').select('id, name').eq('workspace_id', workspaceId).order('name'),
  ]);
  const channelRows = ((channels.data ?? []) as { id: string; name: string; is_department?: boolean }[]);
  const departmentRows = ((departments.data ?? []) as { id: string; name: string }[]);
  const ids = ((members.data ?? []) as { user_id: string }[]).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('user_id, first_name, last_name').in('user_id', ids) : { data: [] };
  const people = ids.map((id) => {
    const p = ((profiles ?? []) as { user_id: string; first_name: string | null; last_name: string | null }[]).find((x) => x.user_id === id);
    const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ');
    return { id, name: name || (id === meId ? 'You' : 'Team member') };
  });
  const map = <T,>(rows: T[] | null, key: (r: T) => [string, string]) => Object.fromEntries((rows ?? []).map(key));
  const wfRows = (workflows.data ?? []) as { id: string; name: string }[];
  return {
    tags: ((tags.data ?? []) as { name: string }[]).map((t) => t.name),
    people,
    users: Object.fromEntries(people.map((p) => [p.id, p.name])),
    forms: map((forms.data ?? []) as { id: string; name: string }[], (r) => [r.id, r.name]),
    calendars: map((calendars.data ?? []) as { id: string; name: string }[], (r) => [r.id, r.name]),
    events: map((events.data ?? []) as { id: string; title: string }[], (r) => [r.id, r.title]),
    workflows: map(wfRows, (r) => [r.id, r.name]),
    workflowList: wfRows,
    channels: map(channelRows, (r) => [r.id, r.name]),
    channelList: channelRows.map((r) => ({ id: r.id, name: r.name, department: !!r.is_department })),
    departments: map(departmentRows, (r) => [r.id, r.name]),
    departmentList: departmentRows,
    accounts: ((accounts.data ?? []) as { id: string; email: string; display_name: string | null; status: string }[]).filter((a) => a.status !== 'revoked'),
  };
}

// ---------------------------------------------------------------- history, logs, stats

export interface RunRow {
  id: string;
  contact_id: string | null;
  trigger_name: string | null;
  reason: string | null;
  status: 'active' | 'waiting' | 'completed' | 'failed' | 'removed' | 'stopped';
  current_step: string | null;
  resume_at: string | null;
  exit_reason: string | null;
  is_test: boolean;
  started_at: string;
  finished_at: string | null;
  contact?: { first_name: string | null; last_name: string | null; email: string | null } | null;
}

export interface LogRow {
  id: number;
  run_id: string;
  contact_id: string | null;
  step_id: string | null;
  step_type: string | null;
  step_name: string | null;
  status: 'success' | 'skipped' | 'failed' | 'waiting';
  detail: string;
  at: string;
}

async function withContacts<T extends { contact_id: string | null }>(rows: T[]): Promise<(T & { contact?: RunRow['contact'] })[]> {
  const ids = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))] as string[];
  if (!ids.length) return rows;
  const { data } = await supabase.from('contacts').select('id, first_name, last_name, email').in('id', ids);
  const byId = new Map(((data ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string | null }[]).map((c) => [c.id, c]));
  return rows.map((r) => ({ ...r, contact: r.contact_id ? byId.get(r.contact_id) ?? null : null }));
}

export async function listRuns(workflowId: string): Promise<{ rows: RunRow[]; error: string | null }> {
  const { data, error } = await supabase.from('wf_runs').select('id, contact_id, trigger_name, reason, status, current_step, resume_at, exit_reason, is_test, started_at, finished_at')
    .eq('workflow_id', workflowId).order('started_at', { ascending: false }).limit(200);
  if (error) return { rows: [], error: missing(error.message) ? NEEDS_UPDATE : error.message };
  return { rows: await withContacts((data ?? []) as RunRow[]), error: null };
}

export async function listLogs(workflowId: string, runId?: string): Promise<{ rows: (LogRow & { contact?: RunRow['contact'] })[]; error: string | null }> {
  let q = supabase.from('wf_logs').select('id, run_id, contact_id, step_id, step_type, step_name, status, detail, at').eq('workflow_id', workflowId).order('id', { ascending: false }).limit(300);
  if (runId) q = q.eq('run_id', runId);
  const { data, error } = await q;
  if (error) return { rows: [], error: missing(error.message) ? NEEDS_UPDATE : error.message };
  return { rows: await withContacts((data ?? []) as LogRow[]), error: null };
}

// ---------------------------------------------------------------- run history (every workflow)

export type RunFilter = 'all' | 'problems' | 'running' | 'finished';

/** One run in the account-wide history, with its workflow, contact and how many steps failed. */
export interface HistoryRun extends RunRow {
  workflow_id: string;
  workflow_name: string;
  failed_steps: number;
}

const RUN_COLS = 'id, workflow_id, contact_id, trigger_name, reason, status, current_step, resume_at, exit_reason, is_test, started_at, finished_at';
export const HISTORY_PAGE = 50;

/**
 * Runs across every workflow, newest first. "Problems" are runs where a step failed or the run
 * itself failed; "running" are contacts still in a workflow (active or waiting).
 */
export async function listHistory(workspaceId: string, opts: { filter: RunFilter; workflowId?: string; since: string; before?: string }): Promise<{ rows: HistoryRun[]; more: boolean; error: string | null }> {
  let q = supabase.from('wf_runs').select(RUN_COLS).eq('workspace_id', workspaceId).gte('started_at', opts.since)
    .order('started_at', { ascending: false }).limit(HISTORY_PAGE);
  if (opts.before) q = q.lt('started_at', opts.before);
  if (opts.workflowId) q = q.eq('workflow_id', opts.workflowId);
  if (opts.filter === 'running') q = q.in('status', ['active', 'waiting']);
  if (opts.filter === 'finished') q = q.in('status', ['completed', 'stopped', 'removed']);
  if (opts.filter === 'problems') {
    // The most recent failures (kept short: their ids go in the request address).
    let f = supabase.from('wf_logs').select('run_id').eq('status', 'failed').gte('at', opts.since).order('id', { ascending: false }).limit(150);
    if (opts.workflowId) f = f.eq('workflow_id', opts.workflowId);
    const { data: failed, error: fErr } = await f;
    if (fErr) return { rows: [], more: false, error: missing(fErr.message) ? NEEDS_UPDATE : fErr.message };
    const ids = [...new Set(((failed ?? []) as { run_id: string }[]).map((r) => r.run_id))];
    q = ids.length ? q.or(`status.eq.failed,id.in.(${ids.join(',')})`) : q.eq('status', 'failed');
  }
  const { data, error } = await q;
  if (error) return { rows: [], more: false, error: missing(error.message) ? NEEDS_UPDATE : error.message };
  const runs = (data ?? []) as (RunRow & { workflow_id: string })[];
  const runIds = runs.map((r) => r.id);
  const wfIds = [...new Set(runs.map((r) => r.workflow_id))];
  const [names, fails] = await Promise.all([
    wfIds.length ? supabase.from('workflows').select('id, name').in('id', wfIds) : Promise.resolve({ data: [] }),
    runIds.length ? supabase.from('wf_logs').select('run_id').eq('status', 'failed').in('run_id', runIds) : Promise.resolve({ data: [] }),
  ]);
  const nameOf = new Map(((names.data ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));
  const failCount = new Map<string, number>();
  for (const f of (fails.data ?? []) as { run_id: string }[]) failCount.set(f.run_id, (failCount.get(f.run_id) ?? 0) + 1);
  const rows = (await withContacts(runs)).map((r) => ({ ...r, workflow_name: nameOf.get(r.workflow_id) ?? 'Deleted workflow', failed_steps: failCount.get(r.id) ?? 0 }));
  return { rows, more: runs.length === HISTORY_PAGE, error: null };
}

/** The headline numbers for the period: runs, still running, finished, and runs with a problem. */
export async function historyCounts(workspaceId: string, since: string, workflowId?: string): Promise<{ total: number; running: number; finished: number; problems: number }> {
  const count = (statuses?: string[]) => {
    let q = supabase.from('wf_runs').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('started_at', since);
    if (workflowId) q = q.eq('workflow_id', workflowId);
    if (statuses) q = q.in('status', statuses);
    return q.then(({ count: n }) => n ?? 0);
  };
  let f = supabase.from('wf_logs').select('run_id').eq('status', 'failed').gte('at', since).limit(5000);
  if (workflowId) f = f.eq('workflow_id', workflowId);
  const [total, running, finished, failedRuns, failedLogs] = await Promise.all([
    count(), count(['active', 'waiting']), count(['completed', 'stopped', 'removed']), count(['failed']), f.then(({ data }) => data ?? []),
  ]);
  return { total, running, finished, problems: Math.max(failedRuns, new Set((failedLogs as { run_id: string }[]).map((x) => x.run_id)).size) };
}

/** Every step one run took, in order. */
export async function runSteps(runId: string): Promise<LogRow[]> {
  const { data } = await supabase.from('wf_logs').select('id, run_id, contact_id, step_id, step_type, step_name, status, detail, at').eq('run_id', runId).order('id');
  return (data ?? []) as LogRow[];
}

/** Per step, the last 30 days: how many contacts it ran for, and how many failed or were skipped. */
export async function stepStats(workflowId: string): Promise<Record<string, { done: number; failed: number; skipped: number; waiting: number }>> {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data } = await supabase.from('wf_logs').select('step_id, status').eq('workflow_id', workflowId).gte('at', since).limit(5000);
  const out: Record<string, { done: number; failed: number; skipped: number; waiting: number }> = {};
  for (const r of (data ?? []) as { step_id: string | null; status: LogRow['status'] }[]) {
    if (!r.step_id) continue;
    const s = (out[r.step_id] ??= { done: 0, failed: 0, skipped: 0, waiting: 0 });
    if (r.status === 'success') s.done++; else if (r.status === 'failed') s.failed++; else if (r.status === 'skipped') s.skipped++; else s.waiting++;
  }
  return out;
}

/** How many contacts each trigger brought in (last 30 days). */
export async function triggerStats(workflowId: string): Promise<{ byTrigger: Record<string, number>; active: number; total: number }> {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data } = await supabase.from('wf_runs').select('trigger_name, status').eq('workflow_id', workflowId).gte('started_at', since).limit(5000);
  const rows = (data ?? []) as { trigger_name: string | null; status: string }[];
  const byTrigger: Record<string, number> = {};
  for (const r of rows) byTrigger[r.trigger_name ?? ''] = (byTrigger[r.trigger_name ?? ''] ?? 0) + 1;
  return { byTrigger, active: rows.filter((r) => r.status === 'active' || r.status === 'waiting').length, total: rows.length };
}

export async function removeRun(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('wf_remove_run', { p_run: id });
  return error?.message ?? null;
}

export async function testRun(workflowId: string, contactId: string): Promise<{ runId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('wf_test_run', { p_workflow: workflowId, p_contact: contactId });
  if (error) return { runId: null, error: missing(error.message) ? NEEDS_UPDATE : error.message };
  return { runId: data as string, error: null };
}

export interface VersionRow { id: string; version_number: number; status: string; created_at: string; published_at: string | null; snapshot: { name?: string; notes?: string; settings?: unknown; definition?: Definition } }
export async function listVersions(workflowId: string): Promise<VersionRow[]> {
  const { data } = await supabase.from('workflow_versions').select('id, version_number, status, created_at, published_at, snapshot').eq('workflow_id', workflowId).order('version_number', { ascending: false }).limit(50);
  return (data ?? []) as VersionRow[];
}

/** Lets the scheduler's mailer call pass Supabase's gateway (the public key every visitor already has). */
export async function shareClientKey(): Promise<void> {
  const key: string | undefined = supabaseKey;
  if (key) await supabase.rpc('wf_set_client_key', { p_key: key }).then(() => {}, () => {});
}

export async function searchContacts(workspaceId: string, q: string): Promise<{ id: string; name: string; email: string | null }[]> {
  let query = supabase.from('contacts').select('id, first_name, last_name, email').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(8);
  const s = q.trim().replace(/[%,()]/g, '');
  if (s) query = query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%`);
  const { data } = await query;
  return ((data ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string | null }[]).map((c) => ({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Contact', email: c.email }));
}
