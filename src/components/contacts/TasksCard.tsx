import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Circle, ClipboardList, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { cn } from '@/lib/utils';

interface TaskRow { id: string; title: string; body: string; due_at: string | null; assigned_to: string | null; completed_at: string | null; created_at: string }

const dueText = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  const label = diff === 0 ? 'Due today' : diff === 1 ? 'Due tomorrow' : diff === -1 ? 'Due yesterday' : diff < 0 ? `${-diff} days overdue` : `Due ${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
  return { label, late: diff < 0 };
};

/** To-dos on a contact. Workflows can add them, remind about them and react when they're done. */
export function TasksCard({ contactId, members }: { contactId: string; members: { user_id: string; name: string }[] }) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('tasks').select('id, title, body, due_at, assigned_to, completed_at, created_at').eq('contact_id', contactId).order('created_at', { ascending: false }).limit(100);
    if (error) { setMissing(true); setRows([]); return; }
    setRows((data ?? []) as TaskRow[]);
  }, [contactId]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!workspace || !title.trim()) return;
    const { error } = await supabase.from('tasks').insert({
      workspace_id: workspace.id, contact_id: contactId, title: title.trim().slice(0, 200),
      due_at: due ? new Date(`${due}T17:00:00`).toISOString() : null, assigned_to: assignee || null, created_by: user?.id ?? null,
    });
    if (error) { toast(error.message, 'error'); return; }
    setTitle(''); setDue(''); setAssignee(''); setAdding(false);
    void load();
  };
  const toggle = async (t: TaskRow) => {
    const completed_at = t.completed_at ? null : new Date().toISOString();
    setRows((r) => (r ?? []).map((x) => (x.id === t.id ? { ...x, completed_at } : x)));
    const { error } = await supabase.from('tasks').update({ completed_at, updated_at: new Date().toISOString() }).eq('id', t.id);
    if (error) { toast(error.message, 'error'); void load(); }
  };
  const remove = async (t: TaskRow) => {
    const { error } = await supabase.from('tasks').delete().eq('id', t.id);
    if (error) toast(error.message, 'error');
    void load();
  };

  const open = (rows ?? []).filter((t) => !t.completed_at);
  const done = (rows ?? []).filter((t) => t.completed_at);
  const name = (id: string | null) => members.find((m) => m.user_id === id)?.name;

  return (
    <section aria-label="Tasks" className="rounded-xl border border-navy-100 bg-white p-4 shadow-card">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#5B5BD6] text-white"><ClipboardList className="h-3.5 w-3.5" /></span>
        <h2 className="text-sm font-semibold text-navy-800">Tasks</h2>
        {open.length > 0 && <span className="rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-bold text-navy-700">{open.length}</span>}
        {!missing && <button type="button" onClick={() => setAdding((v) => !v)} aria-label="Add task" className="ml-auto rounded-md p-1 text-gold-700 hover:bg-gold-50"><Plus className="h-4 w-4" /></button>}
      </div>
      {missing ? (
        <p className="mt-3 text-xs text-ivory-700">Tasks need the workflows database update.</p>
      ) : (
        <>
          {adding && (
            <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" aria-label="Task title" className="input-field" />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className="input-field" />
                <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assign to" className="input-field">
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAdding(false)} className="btn-ghost btn-sm">Cancel</button>
                <button type="submit" disabled={!title.trim()} className="btn-primary btn-sm">Add task</button>
              </div>
            </form>
          )}
          {rows === null ? <p className="mt-3 text-xs text-ivory-700">Loading…</p> : open.length === 0 && !adding ? (
            <p className="mt-3 text-xs text-ivory-700">No open tasks.</p>
          ) : (
            <ul className="mt-2 divide-y divide-navy-50">
              {open.map((t) => <TaskItem key={t.id} t={t} who={name(t.assigned_to)} onToggle={() => { void toggle(t); }} onDelete={() => { void remove(t); }} />)}
            </ul>
          )}
          {done.length > 0 && (
            <>
              <button type="button" onClick={() => setShowDone((v) => !v)} className="mt-2 text-xs font-semibold text-navy-600 hover:text-navy-900">{showDone ? 'Hide' : 'Show'} {done.length} done</button>
              {showDone && <ul className="mt-1 divide-y divide-navy-50">{done.map((t) => <TaskItem key={t.id} t={t} who={name(t.assigned_to)} onToggle={() => { void toggle(t); }} onDelete={() => { void remove(t); }} />)}</ul>}
            </>
          )}
        </>
      )}
    </section>
  );
}

function TaskItem({ t, who, onToggle, onDelete }: { t: TaskRow; who?: string; onToggle: () => void; onDelete: () => void }) {
  const due = dueText(t.due_at);
  return (
    <li className="group flex items-start gap-2 py-2">
      <button type="button" onClick={onToggle} aria-label={t.completed_at ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`} className="mt-0.5 text-navy-400 hover:text-green-600">
        {t.completed_at ? <CheckCircle2 className="h-[18px] w-[18px] text-green-600" /> : <Circle className="h-[18px] w-[18px]" />}
      </button>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm text-navy-900', t.completed_at && 'text-ivory-600 line-through')}>{t.title}</span>
        <span className="block text-xs text-ivory-700">
          {due && <span className={cn(due.late && !t.completed_at && 'font-semibold text-burgundy-600')}>{due.label}</span>}
          {due && who && ' · '}{who}
        </span>
      </span>
      <button type="button" onClick={onDelete} aria-label={`Delete task "${t.title}"`} className="rounded p-1 text-ivory-500 opacity-0 hover:text-burgundy-600 focus:opacity-100 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
    </li>
  );
}
