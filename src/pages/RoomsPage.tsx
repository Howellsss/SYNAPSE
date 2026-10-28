import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, DoorOpen, Link2, Mail, Pencil, Plus, Search, Trash2, Users, Video } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';
import { inviteUrl } from '@/meetings/codes';
import type { Meeting } from '@/lib/meetings';
import { loadDepartments, loadDirectory, memberName, type Department, type DirectoryMember } from '@/lib/team';
import {
  canCreateRooms, canManageRoom, canUseRoom, createRoomMeeting, deleteRoom, departmentsForRooms, isBusy, listRoomLinks, listRooms, saveRoom,
  type CompanyRoom, type RoomViewer,
} from '@/lib/rooms';

/**
 * Rooms: standing video rooms of the company. Admins create them and assign
 * experts; experts start calls and make links (for clients or teammates) in the rooms assigned
 * to them. Each room shows whether a call is on in it right now.
 */
export function RoomsPage() {
  const { workspace, user, role } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [rooms, setRooms] = useState<CompanyRoom[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const [query, setQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [editing, setEditing] = useState<CompanyRoom | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CompanyRoom | null>(null);
  const [linkFor, setLinkFor] = useState<CompanyRoom | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    const [r, d, m] = await Promise.all([listRooms(workspace.id), loadDepartments(workspace.id), loadDirectory(workspace.id)]);
    setError(r.error);
    setRooms(r.data);
    setDepartments(d.data);
    setMembers(m.data);
    setLoading(false);
  }, [workspace]);
  useEffect(() => { load(); }, [load]);
  // Busy status changes on its own: look again every 20 seconds.
  useEffect(() => {
    const t = window.setInterval(() => { setNow(Date.now()); if (workspace) listRooms(workspace.id).then((r) => { if (!r.error) setRooms(r.data); }); }, 20_000);
    return () => window.clearInterval(t);
  }, [workspace]);

  const me = members.find((m) => m.user_id === user?.id);
  const viewer: RoomViewer = useMemo(() => ({
    userId: user?.id ?? '',
    role,
    departmentIds: me?.department_ids ?? [],
    leadDepartmentIds: me?.lead_department_ids ?? [],
  }), [user?.id, role, me]);
  const byId = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);

  const mine = rooms.filter((r) => canUseRoom(r, viewer));
  const list = (tab === 'mine' ? mine : rooms)
    .filter((r) => deptFilter === 'all' || (deptFilter === 'none' ? !r.department_id : r.department_id === deptFilter))
    .filter((r) => !query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()));

  const startCall = async (room: CompanyRoom) => {
    if (!user) return;
    const { data, error: err } = await createRoomMeeting(room, user.id, { forWhom: '', now: true });
    if (err || !data) { toast(err ?? 'Could not start the call.', 'error'); return; }
    navigate(`/meetings/${data.code}`);
  };

  const remove = async () => {
    if (!deleting) return;
    const { error: err } = await deleteRoom(deleting.id);
    if (err) { toast(err, 'error'); return; }
    toast(`${deleting.name} deleted. Links already sent stop belonging to it but still work.`);
    setDeleting(null);
    load();
  };

  return (
    <div className="page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-navy-800">Rooms</h1>
          <p className="mt-1 max-w-2xl text-sm text-ivory-700">
            Standing video rooms for your teams. Admins create rooms and assign people; people start calls and send links to clients or teammates from the rooms assigned to them.
          </p>
        </div>
        {canCreateRooms(viewer) && (
          <button type="button" onClick={() => setEditing('new')} className="btn-primary"><Plus className="h-4 w-4" /> Create room</button>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Which rooms" className="inline-flex rounded-lg bg-ivory-100 p-1">
          {([['mine', `My rooms (${mine.length})`], ['all', `All rooms (${rooms.length})`]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)}
              className={cn('rounded-md px-3 py-1.5 text-sm font-semibold transition', tab === id ? 'bg-white text-navy-800 shadow-sm' : 'text-ivory-700 hover:text-navy-800')}>
              {label}
            </button>
          ))}
        </div>
        <label className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <span className="sr-only">Search rooms</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rooms" className="input-field !pl-9" />
        </label>
        {departments.length > 0 && (
          <select aria-label="Department" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="input-field !w-auto">
            <option value="all">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="none">No department</option>
          </select>
        )}
      </div>

      <div className="mt-5 page-fill">
        {loading ? (
          <div className="card flex flex-1 items-center justify-center p-6"><LoadingSpinner className="h-8 w-8 text-ivory-600" /></div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : list.length === 0 ? (
          <div className="card flex flex-1 flex-col justify-center">
            <EmptyState
              icon={<DoorOpen className="h-6 w-6" />}
              title={tab === 'mine' ? 'No rooms assigned to you yet' : 'No rooms yet'}
              description={canCreateRooms(viewer)
                ? 'Create a room, put it in a department and assign the people who use it.'
                : 'An admin creates rooms and assigns them. Ask yours to assign you one.'}
            />
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                busy={isBusy(room, now)}
                department={room.department_id ? deptById.get(room.department_id) ?? null : null}
                people={room.assignees.map((id) => byId.get(id)).filter((m): m is DirectoryMember => !!m)}
                busyBy={room.busy_by ? byId.get(room.busy_by) ?? null : null}
                canUse={canUseRoom(room, viewer)}
                canManage={canManageRoom(room, viewer)}
                onStart={() => startCall(room)}
                onLink={() => setLinkFor(room)}
                onEdit={() => setEditing(room)}
                onDelete={() => setDeleting(room)}
              />
            ))}
          </ul>
        )}
      </div>

      {editing && user && workspace && (
        <RoomEditor
          room={editing === 'new' ? null : editing}
          departments={departmentsForRooms(departments, viewer)}
          allDepartments={departments}
          members={members}
          onClose={() => setEditing(null)}
          onSave={async (input, assignees) => {
            const current = editing === 'new' ? [] : editing.assignees;
            const { error: err } = await saveRoom(workspace.id, user.id, { ...input, id: editing === 'new' ? undefined : editing.id }, assignees, current);
            if (err) { toast(err, 'error'); return false; }
            toast(editing === 'new' ? `${input.name.trim()} created` : 'Room saved');
            setEditing(null);
            load();
            return true;
          }}
        />
      )}
      {linkFor && user && <LinkMaker room={linkFor} userId={user.id} onClose={() => setLinkFor(null)} onJoin={(code) => navigate(`/meetings/${code}`)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={`Delete ${deleting?.name ?? 'room'}?`}
        message="The room and its assignments are removed. Links already sent keep working as ordinary meetings."
        confirmLabel="Delete room"
        danger
      />
    </div>
  );
}

function RoomCard({ room, busy, department, people, busyBy, canUse, canManage, onStart, onLink, onEdit, onDelete }: {
  room: CompanyRoom; busy: boolean; department: Department | null; people: DirectoryMember[]; busyBy: DirectoryMember | null;
  canUse: boolean; canManage: boolean; onStart: () => void; onLink: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [linksOpen, setLinksOpen] = useState(false);
  const shown = people.slice(0, 5);
  return (
    <li className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-navy-800">{room.name}</h2>
          {department && (
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-ivory-100 px-2 py-0.5 text-xs font-medium text-navy-700">
              <span className="h-2 w-2 rounded-full" style={{ background: department.color }} /> {department.name}
            </span>
          )}
        </div>
        <span
          className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold', busy ? 'bg-burgundy-50 text-burgundy-700' : 'bg-green-50 text-green-800')}
          title={busy && busyBy ? `In a call with ${memberName(busyBy)}` : undefined}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', busy ? 'animate-pulse bg-[#C42B1C]' : 'bg-green-500')} />
          {busy ? 'Busy' : 'Free'}
        </span>
      </div>
      {room.description && <p className="mt-2 line-clamp-2 text-sm text-ivory-700">{room.description}</p>}
      {busy && busyBy && <p className="mt-2 text-xs text-ivory-700">In a call with {memberName(busyBy)}</p>}

      <div className="mt-4 flex items-center gap-2">
        <div className="flex items-center">
          {shown.map((m, i) => (
            <Avatar key={m.user_id} firstName={m.first_name} lastName={m.last_name} src={m.avatar_url} size="sm" className={cn('ring-2 ring-white', i > 0 && '-ml-2')} />
          ))}
        </div>
        <span className="text-xs text-ivory-700">
          {people.length ? `${people.length} assigned` : 'Nobody assigned yet'}
          {room.open_to_department && department ? ` · open to ${department.name}` : ''}
        </span>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {canUse && (
          <>
            <button type="button" onClick={onStart} className="btn-primary !px-3 !py-1.5"><Video className="h-4 w-4" /> Start call</button>
            <button type="button" onClick={onLink} className="btn-secondary !px-3 !py-1.5"><Link2 className="h-4 w-4" /> Create link</button>
            <button type="button" onClick={() => setLinksOpen((v) => !v)} aria-expanded={linksOpen} className="btn-ghost !px-3 !py-1.5">Open links</button>
          </>
        )}
        {canManage && (
          <span className="ml-auto flex gap-1">
            <button type="button" onClick={onEdit} aria-label={`Edit ${room.name}`} title="Edit and assign" className="rounded-lg p-2 text-navy-700 hover:bg-ivory-100"><Pencil className="h-4 w-4" /></button>
            <button type="button" onClick={onDelete} aria-label={`Delete ${room.name}`} title="Delete" className="rounded-lg p-2 text-burgundy-600 hover:bg-burgundy-50"><Trash2 className="h-4 w-4" /></button>
          </span>
        )}
        {!canUse && !canManage && <span className="text-xs text-ivory-700">Assigned rooms only: ask an admin to assign you.</span>}
      </div>
      {linksOpen && <RoomLinks roomId={room.id} />}
    </li>
  );
}

function RoomLinks({ roomId }: { roomId: string }) {
  const { toast } = useToast();
  const [links, setLinks] = useState<Meeting[] | null>(null);
  useEffect(() => { listRoomLinks(roomId).then((r) => setLinks(r.data)); }, [roomId]);
  if (!links) return <p className="mt-3 text-xs text-ivory-700">Loading links…</p>;
  if (!links.length) return <p className="mt-3 text-xs text-ivory-700">No open links in this room.</p>;
  return (
    <ul className="mt-3 divide-y divide-ivory-200 rounded-lg border border-ivory-200">
      {links.map((m) => (
        <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{m.for_whom || 'Call'} <span className="text-xs text-ivory-700">· {m.code}</span></span>
          <button type="button" onClick={async () => { await navigator.clipboard.writeText(inviteUrl(m)); toast('Link copied'); }} aria-label={`Copy link for ${m.for_whom || m.code}`} className="rounded-md p-1.5 text-navy-700 hover:bg-ivory-100"><Copy className="h-4 w-4" /></button>
        </li>
      ))}
    </ul>
  );
}

function RoomEditor({ room, departments, allDepartments, members, onClose, onSave }: {
  room: CompanyRoom | null;
  /** Departments this person may put a room in. */
  departments: Department[];
  allDepartments: Department[];
  members: DirectoryMember[];
  onClose: () => void;
  onSave: (input: { name: string; description: string; department_id: string | null; open_to_department: boolean }, assignees: string[]) => Promise<boolean>;
}) {
  const [name, setName] = useState(room?.name ?? '');
  const [description, setDescription] = useState(room?.description ?? '');
  const [departmentId, setDepartmentId] = useState<string | null>(room?.department_id ?? (departments.length === 1 ? departments[0].id : null));
  const [openToDept, setOpenToDept] = useState(room?.open_to_department ?? false);
  const [assigned, setAssigned] = useState<string[]>(room?.assignees ?? []);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const active = members.filter((m) => m.status === 'active');
  // People in the room's department first.
  const sorted = [...active].sort((a, b) => Number(!!departmentId && b.department_ids.includes(departmentId)) - Number(!!departmentId && a.department_ids.includes(departmentId)) || memberName(a).localeCompare(memberName(b)));
  const shown = sorted.filter((m) => !search.trim() || `${memberName(m)} ${m.title ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  // A room already in a department that isn't on offer keeps it.
  const options = room?.department_id && !departments.some((d) => d.id === room.department_id)
    ? [...departments, ...allDepartments.filter((d) => d.id === room.department_id)]
    : departments;
  const toggle = (id: string) => setAssigned((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const submit = async () => {
    setSaving(true);
    const ok = await onSave({ name, description, department_id: departmentId, open_to_department: openToDept }, assigned);
    if (!ok) setSaving(false);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={room ? `Edit ${room.name}` : 'Create a room'}
      description="Experts can only start calls and make links in rooms assigned to them."
      size="lg"
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="button" onClick={submit} disabled={saving || !name.trim()} className="btn-primary">{saving ? 'Saving…' : room ? 'Save' : 'Create room'}</button>
        </>
      )}
    >
      <div className="grid gap-4">
        <label className="grid gap-1.5 text-sm font-medium text-navy-800">
          Room name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Video Support 3" className="input-field" autoFocus />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-navy-800">
          What it's for <span className="text-xs font-normal text-ivory-700">(optional)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} className="input-field" placeholder="Client video sessions for the Tech team" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-navy-800">
          Department
          <select value={departmentId ?? ''} onChange={(e) => setDepartmentId(e.target.value || null)} className="input-field">
            <option value="">No department</option>
            {options.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        {departmentId && (
          <label className="flex items-start gap-2 text-sm text-navy-800">
            <input type="checkbox" checked={openToDept} onChange={(e) => setOpenToDept(e.target.checked)} className="mt-0.5" />
            <span>Everyone in {allDepartments.find((d) => d.id === departmentId)?.name ?? 'the department'} can use this room <span className="block text-xs text-ivory-700">Otherwise only the people assigned below.</span></span>
          </label>
        )}
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-navy-800"><Users className="h-4 w-4" /> Assigned experts <span className="text-xs font-normal text-ivory-700">({assigned.length})</span></p>
          <label className="relative mt-2 block">
            <span className="sr-only">Search people</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" className="input-field !pl-9" />
          </label>
          <ul className="mt-2 max-h-64 divide-y divide-ivory-200 overflow-y-auto rounded-lg border border-ivory-200">
            {shown.length === 0 && <li className="px-3 py-3 text-sm text-ivory-700">Nobody matches.</li>}
            {shown.slice(0, 200).map((m) => {
              const on = assigned.includes(m.user_id);
              return (
                <li key={m.user_id}>
                  <button type="button" onClick={() => toggle(m.user_id)} aria-pressed={on} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-ivory-50">
                    <Avatar firstName={m.first_name} lastName={m.last_name} src={m.avatar_url} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-navy-800">{memberName(m)}</span>
                      {m.title && <span className="block truncate text-xs text-ivory-700">{m.title}</span>}
                    </span>
                    <span className={cn('flex h-5 w-5 items-center justify-center rounded border', on ? 'border-navy-800 bg-navy-800 text-white' : 'border-ivory-400')}>{on && <Check className="h-3.5 w-3.5" />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

function LinkMaker({ room, userId, onClose, onJoin }: { room: CompanyRoom; userId: string; onClose: () => void; onJoin: (code: string) => void }) {
  const { toast } = useToast();
  const [forWhom, setForWhom] = useState('');
  const [when, setWhen] = useState('');
  const [made, setMade] = useState<Meeting | null>(null);
  const [busy, setBusy] = useState(false);
  const link = made ? inviteUrl(made) : '';

  const create = async () => {
    setBusy(true);
    const { data, error } = await createRoomMeeting(room, userId, { forWhom, scheduledAt: when ? new Date(when) : null });
    setBusy(false);
    if (error || !data) { toast(error ?? 'Could not create the link.', 'error'); return; }
    setMade(data);
  };
  const mail = made
    ? `mailto:?subject=${encodeURIComponent(`Video call: ${room.name}`)}&body=${encodeURIComponent(`Hi${forWhom.trim() ? ` ${forWhom.trim()}` : ''},\n\nJoin the video call here:\n${link}\n${when ? `\nWhen: ${new Date(when).toLocaleString()}\n` : ''}\nNo account or download needed.`)}`
    : '';

  return (
    <Modal
      open
      onClose={onClose}
      title={made ? 'Your link is ready' : `Create a link in ${room.name}`}
      description={made ? 'Anyone with this link can join (people outside SYNAPSE enter their name). Teammates join with their login.' : 'Send it to a client, or to a teammate you want to bring in.'}
      footer={made ? (
        <>
          <a href={mail} className="btn-ghost"><Mail className="h-4 w-4" /> Email it</a>
          <button type="button" onClick={() => onJoin(made.code)} className="btn-primary"><Video className="h-4 w-4" /> Join now</button>
        </>
      ) : (
        <>
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="button" onClick={create} disabled={busy} className="btn-primary">{busy ? 'Creating…' : 'Create link'}</button>
        </>
      )}
    >
      {made ? (
        <div className="flex items-center gap-2">
          <input readOnly value={link} aria-label="Link" className="input-field flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={async () => { await navigator.clipboard.writeText(link); toast('Link copied'); }} className="btn-secondary"><Copy className="h-4 w-4" /> Copy</button>
        </div>
      ) : (
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium text-navy-800">
            Who is it for?
            <input value={forWhom} onChange={(e) => setForWhom(e.target.value)} maxLength={120} placeholder="e.g. Jane Doe (client) or Sam from Tech" className="input-field" autoFocus />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-navy-800">
            When <span className="text-xs font-normal text-ivory-700">(optional: leave empty for any time)</span>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="input-field" />
          </label>
        </div>
      )}
    </Modal>
  );
}
