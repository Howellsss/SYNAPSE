import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Network, Pencil, Plus, Search, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';
import {
  DEPARTMENT_COLORS, ROLE_LABELS, addToDepartment, deleteDepartment, loadDepartments, loadDirectory, memberName,
  removeFromDepartment, saveDepartment, type Department, type DirectoryMember,
} from '@/lib/team';

/**
 * Departments of a company account: Admins create them and choose who is in each;
 * leads add and remove the people in their own department; everyone else can look.
 */
export function DepartmentsSettings() {
  const { workspace, user, canManageTeam } = useAuth();
  const { toast } = useToast();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);

  const load = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    setLoading(true);
    const [d, m] = await Promise.all([loadDepartments(workspace.id), loadDirectory(workspace.id)]);
    setError(d.error ?? m.error);
    setDepartments(d.data);
    setMembers(m.data);
    setLoading(false);
  }, [workspace]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!deleting) return;
    const { error: err } = await deleteDepartment(deleting.id);
    if (err) { toast(err, 'error'); return; }
    toast(`${deleting.name} deleted. Its people stay in the workspace.`);
    setDeleting(null);
    if (openId === deleting.id) setOpenId(null);
    load();
  };

  if (loading) return <div className="card p-6"><LoadingSpinner className="h-8 w-8 text-ivory-600" /></div>;

  const open = departments.find((d) => d.id === openId) ?? null;
  if (open) {
    return (
      <DepartmentDetail
        department={open}
        members={members}
        canAdmin={canManageTeam}
        isLead={!!members.find((m) => m.user_id === user?.id)?.lead_department_ids.includes(open.id)}
        onBack={() => setOpenId(null)}
        onEdit={() => setEditing(open)}
        onChanged={load}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-navy-800">Departments</h3>
            <p className="mt-0.5 text-sm text-ivory-600">Group your people into teams. Admins choose who is in each one.</p>
          </div>
          {canManageTeam && (
            <button className="btn-primary btn-sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> New department
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Departments need a database update that hasn't been applied yet. {error}
          </p>
        )}

        {departments.length === 0 && !error ? (
          <EmptyState
            icon={<Network className="h-7 w-7" />}
            title="No departments yet"
            description={canManageTeam ? 'Create departments like Tech Support or Video, then add people to each one.' : 'Your admins haven\'t created departments yet.'}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {departments.map((d) => {
              const people = members.filter((m) => m.department_ids.includes(d.id));
              return (
                <div key={d.id} className="flex flex-col rounded-2xl border border-navy-100 p-4 transition-colors hover:border-navy-200">
                  <button type="button" onClick={() => setOpenId(d.id)} className="flex items-start gap-3 text-left">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: d.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-navy-800">{d.name}</span>
                      <span className="block text-xs text-ivory-600">
                        {people.length} {people.length === 1 ? 'person' : 'people'}
                      </span>
                      {d.description && <span className="mt-1 block line-clamp-2 text-xs text-ivory-700">{d.description}</span>}
                    </span>
                  </button>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex -space-x-2">
                      {people.slice(0, 6).map((m) => (
                        <Avatar key={m.user_id} firstName={m.first_name} lastName={m.last_name} src={m.avatar_url} size="sm" className="ring-2 ring-white" />
                      ))}
                    </div>
                    {canManageTeam && (
                      <div className="flex gap-1">
                        <button className="btn-ghost btn-sm" aria-label={`Edit ${d.name}`} onClick={() => setEditing(d)}><Pencil className="h-4 w-4" /></button>
                        <button className="btn-ghost btn-sm text-burgundy-600" aria-label={`Delete ${d.name}`} onClick={() => setDeleting(d)}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <DepartmentModal
          department={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(d) => { setEditing(null); load(); if (editing === 'new' && d) setOpenId(d.id); }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete department"
        message={`Delete ${deleting?.name ?? 'this department'}? Its people stay in the workspace; they just aren't grouped any more.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function DepartmentModal({ department, onClose, onSaved }: {
  department: Department | null;
  onClose: () => void;
  onSaved: (d: Department | null) => void;
}) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState(department?.name ?? '');
  const [description, setDescription] = useState(department?.description ?? '');
  const [color, setColor] = useState(department?.color ?? DEPARTMENT_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!workspace || !name.trim()) return;
    setSaving(true);
    const { data, error } = await saveDepartment(workspace.id, user?.id ?? null, { id: department?.id, name, description, color });
    setSaving(false);
    if (error) { toast(error, 'error'); return; }
    toast(department ? 'Department saved' : `${name.trim()} created`);
    onSaved(data);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={department ? `Edit ${department.name}` : 'New department'}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()} className="btn-primary">{saving ? 'Saving…' : department ? 'Save' : 'Create'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="dept-name" className="mb-1.5 block text-sm font-medium text-navy-700">Name</label>
          <input id="dept-name" className="input-field" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tech Support" autoFocus />
        </div>
        <div>
          <label htmlFor="dept-desc" className="mb-1.5 block text-sm font-medium text-navy-700">Description (optional)</label>
          <textarea id="dept-desc" className="input-field min-h-[70px]" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this team does" />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-navy-700">Colour</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            {DEPARTMENT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn('h-8 w-8 rounded-full ring-offset-2 transition', color === c ? 'ring-2 ring-gold-500' : 'ring-0')}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DepartmentDetail({ department, members, canAdmin, isLead, onBack, onEdit, onChanged }: {
  department: Department;
  members: DirectoryMember[];
  canAdmin: boolean;
  isLead: boolean;
  onBack: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const canManage = canAdmin || isLead;

  const people = members.filter((m) => m.department_ids.includes(department.id));
  const others = people;
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => !m.department_ids.includes(department.id) && m.status === 'active')
      .filter((m) => !q || [memberName(m), m.email ?? '', m.title ?? ''].some((v) => v.toLowerCase().includes(q)));
  }, [members, department.id, query]);

  const add = async () => {
    if (!workspace || !picked.length) return;
    const { error } = await addToDepartment(workspace.id, department.id, picked, false, user?.id ?? null);
    if (error) { toast(error, 'error'); return; }
    toast(`${picked.length} added to ${department.name}`);
    setPicked([]);
    setAdding(false);
    onChanged();
  };

  const remove = async (m: DirectoryMember) => {
    const { error } = await removeFromDepartment(department.id, m.user_id);
    if (error) { toast(error, 'error'); return; }
    toast(`${memberName(m)} removed from ${department.name}`);
    onChanged();
  };

  const row = (m: DirectoryMember) => (
    <div key={m.user_id} className="flex items-center gap-3 rounded-xl border border-navy-100 p-3">
      <Avatar firstName={m.first_name} lastName={m.last_name} src={m.avatar_url} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-navy-700">
          {memberName(m)}{m.user_id === user?.id && <span className="ml-2 text-xs text-ivory-500">(You)</span>}
        </p>
        <p className="truncate text-xs text-ivory-600">{ROLE_LABELS[m.role]}{m.title ? ` · ${m.title}` : ''}</p>
      </div>
      {canManage && (
        <button className="btn-ghost btn-sm text-burgundy-600" aria-label={`Remove ${memberName(m)} from ${department.name}`} onClick={() => remove(m)}>
          <UserMinus className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <button className="btn-ghost btn-sm -ml-2 mb-3" onClick={onBack}><ArrowLeft className="h-4 w-4" /> All departments</button>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-1.5 h-3.5 w-3.5 rounded-full" style={{ background: department.color }} />
            <div>
              <h3 className="text-lg font-semibold text-navy-800">{department.name}</h3>
              <p className="text-sm text-ivory-600">{people.length} {people.length === 1 ? 'person' : 'people'}{department.description ? ` · ${department.description}` : ''}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {canAdmin && <button className="btn-secondary btn-sm" onClick={onEdit}><Pencil className="h-4 w-4" /> Edit</button>}
            {canManage && <button className="btn-primary btn-sm" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> Add people</button>}
          </div>
        </div>
        {!canManage && <p className="mb-3 rounded-xl bg-ivory-50 px-3 py-2 text-xs text-ivory-700">Only admins can change who is in it.</p>}

        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ivory-600">Members · {others.length}</p>
        <div className="space-y-2">
          {others.length ? others.map((m) => row(m)) : <p className="text-sm text-ivory-600">Nobody else yet.</p>}
        </div>
      </div>

      {adding && (
        <Modal
          open
          onClose={() => { setAdding(false); setPicked([]); }}
          title={`Add people to ${department.name}`}
          footer={
            <>
              <button className="btn-secondary" onClick={() => { setAdding(false); setPicked([]); }}>Cancel</button>
              <button className="btn-primary" disabled={!picked.length} onClick={add}>Add {picked.length || ''}</button>
            </>
          }
        >
          <label className="relative mb-3 block">
            <span className="sr-only">Search people</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-500" />
            <input className="input-field !pl-9" placeholder="Search by name, email or title" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </label>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {candidates.length === 0 && <p className="py-4 text-center text-sm text-ivory-600">Everyone is already in this department, or nobody matches.</p>}
            {candidates.slice(0, 200).map((m) => (
              <label key={m.user_id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-ivory-50">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-navy-200"
                  checked={picked.includes(m.user_id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, m.user_id] : p.filter((x) => x !== m.user_id)))}
                />
                <Avatar firstName={m.first_name} lastName={m.last_name} src={m.avatar_url} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-navy-700">{memberName(m)}</span>
                  <span className="block truncate text-xs text-ivory-600">{ROLE_LABELS[m.role]}{m.title ? ` · ${m.title}` : ''}</span>
                </span>
              </label>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
