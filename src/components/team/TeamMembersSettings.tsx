import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban, Check, Clock, Copy, Download, Mail as MailIcon, MoreVertical, Pencil, Search, Trash2, Upload, UserPlus, Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, LoadingSpinner } from '@/components/ui/States';
import type { UserRole } from '@/types';
import { invitationLink } from '@/lib/invitations';
import { DEFAULT_USER_ACCESS, FEATURES, forgetAccess } from '@/lib/access';
import {
  ASSIGNABLE_ROLES, ROLE_HINTS, ROLE_LABELS, invitationLinksCsv, loadDepartments, loadDirectory, matchDepartment,
  describeWork, loadMemberWork, memberName, offboardMember, parseInvites, saveDepartment, sendInviteRows,
  setMemberDepartments, updateMember,
  type Department, type DirectoryMember, type InviteRow, type MemberWork,
} from '@/lib/team';

interface InvitationRow {
  id: string;
  email: string;
  role: UserRole;
  title: string | null;
  department_id: string | null;
  token: string;
  created_at: string;
  expires_at: string;
}

const PAGE = 50;

/** Everyone in the workspace: search, filter by role/department/status, invite many at once. */
export function TeamMembersSettings() {
  const { workspace, user, canManageTeam } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editMember, setEditMember] = useState<DirectoryMember | null>(null);
  const [offboard, setOffboard] = useState<{ member: DirectoryMember; action: 'suspend' | 'remove' } | null>(null);
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    setLoading(true);
    const [dir, depts, invRes, calRes] = await Promise.all([
      loadDirectory(workspace.id),
      loadDepartments(workspace.id),
      canManageTeam
        ? supabase.from('team_invitations')
          .select('id, email, role, title, department_id, token, created_at, expires_at')
          .eq('workspace_id', workspace.id).eq('status', 'pending').order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from('calendars').select('id, name').eq('workspace_id', workspace.id),
    ]);
    setLoadError(dir.error);
    setMembers(dir.data);
    setDepartments(depts.data);
    setInvitations(((invRes as { data: unknown }).data ?? []) as InvitationRow[]);
    setCalendars((calRes.data ?? []) as { id: string; name: string }[]);
    setLoading(false);
  }, [workspace, canManageTeam]);

  useEffect(() => { loadData(); }, [loadData]);

  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (roleFilter && m.role !== roleFilter) return false;
      if (statusFilter && m.status !== statusFilter) return false;
      if (deptFilter === 'none' && m.department_ids.length) return false;
      if (deptFilter && deptFilter !== 'none' && !m.department_ids.includes(deptFilter)) return false;
      if (!q) return true;
      return [memberName(m), m.email ?? '', m.title ?? ''].some((v) => v.toLowerCase().includes(q));
    });
  }, [members, query, roleFilter, deptFilter, statusFilter]);

  useEffect(() => { setShown(PAGE); }, [query, roleFilter, deptFilter, statusFilter]);

  const handleSuspend = async (m: DirectoryMember) => {
    setActionMenu(null);
    if (m.status !== 'suspended') { setOffboard({ member: m, action: 'suspend' }); return; }
    const { error } = await updateMember(m.member_id, { status: 'active' });
    if (error) { toast(error, 'error'); return; }
    toast(`${memberName(m)} can sign in again`);
    loadData();
  };

  const handleRevokeInvite = async (id: string) => {
    const { error } = await supabase.from('team_invitations').update({ status: 'revoked' }).eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Invitation cancelled');
    loadData();
  };

  const copyLink = async (inv: InvitationRow) => {
    try {
      await navigator.clipboard.writeText(invitationLink(inv.token));
      toast(`Invite link for ${inv.email} copied`);
    } catch { toast('Could not copy. Select the link and copy it instead.', 'error'); }
  };

  const downloadLinks = () => {
    const csv = invitationLinksCsv(invitations.map((i) => ({ email: i.email, role: ROLE_LABELS[i.role], link: invitationLink(i.token) })));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(workspace?.name ?? 'workspace').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-invite-links.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="card p-6"><LoadingSpinner className="w-8 h-8 text-ivory-600" /></div>;
  }

  const counts = {
    total: members.length,
    active: members.filter((m) => m.status === 'active').length,
    admins: members.filter((m) => m.role === 'admin' || m.role === 'owner').length,
  };

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-navy-800">Team Members</h3>
            <p className="mt-0.5 text-sm text-ivory-600">
              {counts.total} {counts.total === 1 ? 'person' : 'people'} · {counts.active} active · {counts.admins} {counts.admins === 1 ? 'admin' : 'admins'} · {departments.length} {departments.length === 1 ? 'department' : 'departments'}
            </p>
          </div>
          {canManageTeam && (
            <button onClick={() => setInviteOpen(true)} className="btn-primary btn-sm">
              <UserPlus className="h-4 w-4" />
              Invite people
            </button>
          )}
        </div>

        {loadError && (
          <p role="alert" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            The team list needs a database update that hasn't been applied yet. {loadError}
          </p>
        )}

        {/* Search and filters */}
        <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <label className="relative">
            <span className="sr-only">Search people</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-500" />
            <input className="input-field !pl-9" placeholder="Search by name, email or title" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <select aria-label="Filter by role" className="input-field" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as UserRole | '')}>
            <option value="">All roles</option>
            {(['owner', 'admin', 'member'] as UserRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <select aria-label="Filter by department" className="input-field" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="none">No department</option>
          </select>
          <select aria-label="Filter by status" className="input-field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        <div className="space-y-2" role="list" aria-label="Team members">
          {filtered.slice(0, shown).map((m) => (
            <div role="listitem" key={m.user_id} className="flex items-center gap-3 rounded-xl border border-navy-100 p-3 transition-colors hover:border-navy-200">
              <Avatar firstName={m.first_name} lastName={m.last_name} src={m.avatar_url} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-navy-700">
                  {memberName(m)}
                  {m.user_id === user?.id && <span className="ml-2 text-xs text-ivory-500">(You)</span>}
                </p>
                <p className="truncate text-xs text-ivory-600">
                  {ROLE_LABELS[m.role]}{m.title ? ` · ${m.title}` : ''}{m.email ? ` · ${m.email}` : ''}
                </p>
                {m.department_ids.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.department_ids.map((id) => {
                      const d = deptById.get(id);
                      if (!d) return null;
                      const lead = m.lead_department_ids.includes(id);
                      return (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-medium text-navy-700">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: d.color }} />
                          {d.name}{lead ? ' · Lead' : ''}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <MemberStatusBadge status={m.status} />
              {canManageTeam && m.role !== 'owner' && (
                <div className="relative">
                  <button
                    onClick={() => setActionMenu(actionMenu === m.member_id ? null : m.member_id)}
                    aria-label={`Actions for ${memberName(m)}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-ivory-600 transition-colors hover:bg-ivory-100"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {actionMenu === m.member_id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setActionMenu(null)} />
                      <div className="absolute right-0 top-full z-20 mt-1 w-48 animate-scale-in overflow-hidden rounded-xl border border-navy-100 bg-white shadow-popover">
                        <button onClick={() => { setEditMember(m); setActionMenu(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-navy-600 transition-colors hover:bg-ivory-50">
                          <Pencil className="h-3.5 w-3.5" /> Edit role and access
                        </button>
                        <button onClick={() => handleSuspend(m)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-navy-600 transition-colors hover:bg-ivory-50">
                          <Ban className="h-3.5 w-3.5" /> {m.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                        </button>
                        <button onClick={() => { setOffboard({ member: m, action: 'remove' }); setActionMenu(null); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-burgundy-600 transition-colors hover:bg-burgundy-400/10">
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {filtered.length > shown && (
          <div className="mt-3 flex justify-center">
            <button className="btn-secondary btn-sm" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({filtered.length - shown} left)
            </button>
          </div>
        )}
        {members.length > 0 && filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-ivory-600">Nobody matches. Try another search or filter.</p>
        )}

        {/* Pending invitations */}
        {invitations.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-navy-700">Pending invitations · {invitations.length}</p>
              <button className="btn-ghost btn-sm" onClick={downloadLinks}>
                <Download className="h-4 w-4" /> Download all invite links (CSV)
              </button>
            </div>
            <p className="mb-2 text-xs text-ivory-600">
              People join by opening their invite link, or by signing up or signing in with the invited email.
            </p>
            <div className="space-y-2">
              {invitations.slice(0, 100).map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 rounded-xl border border-navy-100 bg-ivory-50/50 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ivory-100">
                    <MailIcon className="h-4 w-4 text-ivory-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy-700">{inv.email}</p>
                    <p className="truncate text-xs text-ivory-600">
                      {ROLE_LABELS[inv.role] ?? inv.role}
                      {inv.department_id && deptById.get(inv.department_id) ? ` · ${deptById.get(inv.department_id)!.name}` : ''}
                      {inv.title ? ` · ${inv.title}` : ''} · Invited {new Date(inv.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="status-pill hidden bg-amber-50 text-amber-700 sm:inline-flex">
                    <Clock className="h-3 w-3" /> Pending
                  </span>
                  <button onClick={() => copyLink(inv)} className="btn-ghost btn-sm" aria-label={`Copy invite link for ${inv.email}`}>
                    <Copy className="h-4 w-4" /> <span className="hidden sm:inline">Copy link</span>
                  </button>
                  <button onClick={() => handleRevokeInvite(inv.id)} className="text-sm text-ivory-500 transition-colors hover:text-burgundy-600">
                    Cancel
                  </button>
                </div>
              ))}
              {invitations.length > 100 && (
                <p className="text-xs text-ivory-600">And {invitations.length - 100} more. Download the CSV for the full list.</p>
              )}
            </div>
          </div>
        )}

        {members.length === 0 && invitations.length === 0 && !loadError && (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="No team members yet"
            description="Invite your team. You can paste a list of emails or upload a CSV."
          />
        )}
      </div>

      {inviteOpen && (
        <InviteModal
          departments={departments}
          calendars={calendars}
          members={members}
          invitations={invitations}
          onClose={() => setInviteOpen(false)}
          onInvited={() => { setInviteOpen(false); loadData(); }}
        />
      )}

      {editMember && (
        <EditMemberModal
          member={editMember}
          departments={departments}
          calendars={calendars}
          onClose={() => setEditMember(null)}
          onSaved={() => { setEditMember(null); loadData(); }}
        />
      )}

      {offboard && (
        <OffboardModal
          member={offboard.member}
          action={offboard.action}
          people={members.filter((p) => p.status === 'active' && p.user_id !== offboard.member.user_id)}
          meId={user?.id ?? null}
          onClose={() => setOffboard(null)}
          onDone={() => { setOffboard(null); loadData(); }}
        />
      )}
    </div>
  );
}

/**
 * Suspend or remove someone, handing their contacts, tasks, calendars, bookings, forms, events,
 * meetings and rooms to another active person. Removing needs someone to take over; suspending
 * can leave everything with them (for a short absence).
 */
function OffboardModal({ member, action, people, meId, onClose, onDone }: {
  member: DirectoryMember;
  action: 'suspend' | 'remove';
  people: DirectoryMember[];
  meId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [work, setWork] = useState<MemberWork | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);
  const [handTo, setHandTo] = useState(action === 'remove' ? (meId ?? '') : '');
  const [saving, setSaving] = useState(false);
  const name = memberName(member);
  const removing = action === 'remove';

  useEffect(() => {
    loadMemberWork(member.member_id).then(({ data, error }) => { setWork(data); setWorkError(error); });
  }, [member.member_id]);

  const has = describeWork(work);
  const confirm = async () => {
    if (removing && !handTo) { toast('Choose who takes over their work', 'error'); return; }
    setSaving(true);
    const { moved, error } = await offboardMember(member.member_id, action, handTo || null);
    setSaving(false);
    if (error) { toast(error, 'error'); return; }
    const to = people.find((p) => p.user_id === handTo);
    const movedText = describeWork(moved);
    toast(`${name} ${removing ? 'removed' : 'suspended'}${to && movedText ? `. ${movedText} moved to ${memberName(to)}` : ''}`);
    onDone();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${removing ? 'Remove' : 'Suspend'} ${name}`}
      description={removing
        ? 'They leave the account and are signed out straight away. You can invite them again later.'
        : 'They are signed out and can’t get back in until you reactivate them. Their place in the team is kept.'}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={confirm} disabled={saving || (removing && !handTo)} className={removing ? 'btn-danger' : 'btn-primary'}>
            {saving ? (removing ? 'Removing…' : 'Suspending…') : (removing ? 'Remove' : 'Suspend')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-navy-50 px-4 py-3 text-sm text-navy-700">
          {workError
            ? <>Couldn’t check what {name} has. {workError}</>
            : work === null
              ? <>Checking what {name} has…</>
              : has
                ? <>{name} has {has}.</>
                : <>{name} has no contacts, tasks, calendars, bookings, forms, events, meetings or rooms to hand over.</>}
        </div>
        <div>
          <label htmlFor="offboard-hand-to" className="mb-1.5 block text-sm font-medium text-navy-700">
            Who takes over their work?
          </label>
          <select id="offboard-hand-to" className="input-field" value={handTo} onChange={(e) => setHandTo(e.target.value)}>
            {!removing && <option value="">Nobody, keep it with {name}</option>}
            {removing && !handTo && <option value="">Choose a person</option>}
            {people.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {memberName(p)}{p.user_id === meId ? ' (You)' : ''} · {ROLE_LABELS[p.role]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ivory-600">
            Upcoming bookings and meetings move to them; past ones stay as they were.
            {removing ? ' They also leave every channel, department, room and space.' : ''}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function MemberStatusBadge({ status }: { status: string }) {
  if (status === 'active') {
    return <span className="status-pill hidden bg-green-50 text-green-700 sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-green-500" />Active</span>;
  }
  if (status === 'suspended') {
    return <span className="status-pill bg-red-50 text-red-700"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />Suspended</span>;
  }
  return <span className="status-pill bg-amber-50 text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Invited</span>;
}

// ============================================================
// Invite people (one, or hundreds from a list or CSV)
// ============================================================
function InviteModal({ departments, calendars, members, invitations, onClose, onInvited }: {
  departments: Department[];
  calendars: { id: string; name: string }[];
  members: DirectoryMember[];
  invitations: InvitationRow[];
  onClose: () => void;
  onInvited: () => void;
}) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [role, setRole] = useState<Exclude<UserRole, 'owner'>>('member');
  const [departmentId, setDepartmentId] = useState('');
  const [title, setTitle] = useState('');
  const [assignedCalendars, setAssignedCalendars] = useState<string[]>([]);
  const [createMissing, setCreateMissing] = useState(true);
  const [sending, setSending] = useState(false);

  const defaultDeptName = departments.find((d) => d.id === departmentId)?.name ?? '';
  const parsed = useMemo(() => parseInvites(text, { role, department: defaultDeptName }), [text, role, defaultDeptName]);
  const rows: InviteRow[] = parsed.rows.map((r) => ({ ...r, title: r.title || title.trim() }));
  const missingDepts = [...new Set(rows.map((r) => r.department.trim()).filter((n) => n && !matchDepartment(departments, n)))];
  const memberEmails = members.map((m) => m.email ?? '').filter(Boolean);
  const pendingEmails = invitations.map((i) => i.email);
  const already = rows.filter((r) => memberEmails.includes(r.email) || pendingEmails.includes(r.email)).length;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('That file is over 2 MB. Split it into smaller files.', 'error'); return; }
    setText(await file.text());
  };

  const handleSend = async () => {
    if (!workspace || !rows.length) return;
    setSending(true);
    const known = [...departments];
    if (createMissing) {
      for (const name of missingDepts) {
        const { data, error } = await saveDepartment(workspace.id, user?.id ?? null, { name, color: '#0D1C3B' });
        if (error) { toast(error, 'error'); setSending(false); return; }
        if (data) known.push(data);
      }
    }
    const { sent, skipped, error } = await sendInviteRows(
      workspace.id,
      user?.id ?? null,
      rows.map((r) => ({ email: r.email, role: r.role, title: r.title, departmentId: matchDepartment(known, r.department) })),
      { memberEmails, pendingEmails },
    );
    if (error) { toast(`Sent ${sent}, then stopped: ${error}`, 'error'); setSending(false); return; }
    if (assignedCalendars.length && sent) {
      await supabase.from('team_invitations').update({ assigned_calendar_ids: assignedCalendars })
        .eq('workspace_id', workspace.id).eq('status', 'pending').in('email', rows.map((r) => r.email));
    }
    toast(`${sent} ${sent === 1 ? 'invitation' : 'invitations'} created${skipped.length ? ` · ${skipped.length} skipped (already in or invited)` : ''}`);
    onInvited();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Invite people"
      description="Paste one or more emails, or upload a CSV with columns: email, role, department, title."
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSend} disabled={sending || rows.length === 0} className="btn-primary">
            {sending ? 'Inviting…' : rows.length > 1 ? `Invite ${rows.length} people` : 'Invite'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="invite-emails" className="block text-sm font-medium text-navy-700">Emails or CSV</label>
            <button type="button" className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> Upload CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          <textarea
            id="invite-emails"
            className="input-field min-h-[120px] font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'ada@company.com, ben@company.com\n\nor a CSV:\nemail,role,department,title\nada@company.com,member,Tech Support,GHL Expert'}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-navy-700">Role</label>
            <select className="input-field" value={role} onChange={(e) => setRole(e.target.value as Exclude<UserRole, 'owner'>)}>
              {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-navy-700">Department</label>
            <select className="input-field" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">None</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-navy-700">Job title</label>
            <input className="input-field" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. GHL Tech Expert" />
          </div>
        </div>
        <p className="-mt-2 text-xs text-ivory-600">{ROLE_HINTS[role]}. A CSV's own role, department and title columns win over these.</p>

        {(rows.length > 0 || parsed.problems.length > 0) && (
          <div className="rounded-xl border border-navy-100">
            <p className="border-b border-navy-100 px-3 py-2 text-sm font-semibold text-navy-700">
              {rows.length} {rows.length === 1 ? 'person' : 'people'} ready
              {already > 0 && <span className="font-normal text-ivory-600"> · {already} already in or invited (skipped)</span>}
            </p>
            <ul className="max-h-48 divide-y divide-navy-50 overflow-y-auto text-xs">
              {rows.slice(0, 200).map((r) => (
                <li key={r.email} className="flex items-center gap-2 px-3 py-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
                  <span className="min-w-0 flex-1 truncate text-navy-700">{r.email}</span>
                  <span className="text-ivory-600">{ROLE_LABELS[r.role]}{r.department ? ` · ${r.department}` : ''}{r.title ? ` · ${r.title}` : ''}</span>
                </li>
              ))}
              {parsed.problems.map((p) => (
                <li key={`${p.line}-${p.text}`} className="flex items-center gap-2 px-3 py-1.5 text-burgundy-600">
                  <Ban className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">Line {p.line}: {p.text}</span>
                  <span>{p.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {missingDepts.length > 0 && (
          <label className="flex items-start gap-2.5 rounded-xl bg-ivory-50 p-3 text-sm text-navy-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-navy-200" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
            <span>Create {missingDepts.length === 1 ? 'the department' : `${missingDepts.length} departments`} from the CSV: <strong>{missingDepts.join(', ')}</strong>. Otherwise those people join without a department.</span>
          </label>
        )}

        {calendars.length > 0 && (
          <details className="rounded-xl border border-navy-100 p-3">
            <summary className="cursor-pointer text-sm font-medium text-navy-700">Assign calendars (optional)</summary>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {calendars.map((cal) => (
                <label key={cal.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-ivory-50">
                  <input
                    type="checkbox"
                    checked={assignedCalendars.includes(cal.id)}
                    onChange={(e) => setAssignedCalendars(e.target.checked ? [...assignedCalendars, cal.id] : assignedCalendars.filter((c) => c !== cal.id))}
                    className="h-4 w-4 rounded border-navy-200 text-gold-500 focus:ring-gold-400/20"
                  />
                  <span className="text-sm text-navy-700">{cal.name}</span>
                </label>
              ))}
            </div>
          </details>
        )}
      </div>
    </Modal>
  );
}

// ============================================================
// Edit role, title, departments and calendars
// ============================================================
function EditMemberModal({ member, departments, calendars, onClose, onSaved }: {
  member: DirectoryMember;
  departments: Department[];
  calendars: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [role, setRole] = useState<UserRole>(member.role);
  const [title, setTitle] = useState(member.title ?? '');
  const [deptIds, setDeptIds] = useState<string[]>(member.department_ids);
  const leadIds: string[] = [];
  const [assignedCalendars, setAssignedCalendars] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // What they can see (Users only; Admins see everything). null = the standard set.
  const [access, setAccess] = useState<string[] | null>(null);
  const [accessLoaded, setAccessLoaded] = useState<string[] | null>(null);
  const shown = access ?? DEFAULT_USER_ACCESS;

  useEffect(() => {
    supabase.from('workspace_members').select('access').eq('id', member.member_id).maybeSingle()
      .then(({ data, error }) => { const a = !error && Array.isArray(data?.access) ? (data!.access as string[]) : null; setAccess(a); setAccessLoaded(a); });
  }, [member.member_id]);

  useEffect(() => {
    supabase.from('calendar_hosts').select('calendar_id').eq('user_id', member.user_id)
      .then(({ data }) => setAssignedCalendars((data ?? []).map((r: { calendar_id: string }) => r.calendar_id)));
  }, [member.user_id]);

  const toggleDept = (id: string, on: boolean) => {
    setDeptIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));
  };

  const handleSave = async () => {
    if (!workspace) return;
    setLoading(true);
    const changes: { role?: UserRole; title?: string | null } = {};
    if (role !== member.role && member.role !== 'owner') changes.role = role;
    if ((title.trim() || null) !== member.title) changes.title = title.trim() || null;
    if (Object.keys(changes).length) {
      const { error } = await updateMember(member.member_id, changes);
      if (error) { toast(error, 'error'); setLoading(false); return; }
    }
    if (JSON.stringify(access) !== JSON.stringify(accessLoaded)) {
      const { error } = await supabase.from('workspace_members').update({ access }).eq('id', member.member_id);
      if (error) {
        toast(/access/.test(error.message) ? 'Run the database update 06_roles_and_access.sql first.' : error.message, 'error');
        setLoading(false); return;
      }
      forgetAccess();
    }
    const { error: deptErr } = await setMemberDepartments(workspace.id, member.user_id, deptIds, leadIds, user?.id ?? null);
    if (deptErr) { toast(deptErr, 'error'); setLoading(false); return; }

    // Calendar assignments (as before).
    const { error: delErr } = await supabase.from('calendar_hosts').delete().eq('user_id', member.user_id);
    if (delErr) { toast(delErr.message, 'error'); setLoading(false); return; }
    if (assignedCalendars.length > 0) {
      const { error: insErr } = await supabase.from('calendar_hosts').insert(assignedCalendars.map((calendar_id) => ({ calendar_id, user_id: member.user_id })));
      if (insErr) { toast(insErr.message, 'error'); setLoading(false); return; }
    }
    toast(`${memberName(member)} updated`);
    onSaved();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${memberName(member)}`}
      description="Role, job title, departments, calendars and what they can see."
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="btn-primary">{loading ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-navy-700">Role</label>
          <select className="input-field" value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={member.role === 'owner'}>
            {member.role === 'owner' && <option value="owner">Owner</option>}
            {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]} — {ROLE_HINTS[r]}</option>)}
          </select>
          {member.role === 'owner' && <p className="mt-1 text-xs text-ivory-500">The owner's role can't be changed.</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-navy-700">Job title</label>
          <input className="input-field" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. GHL Tech Expert" />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-navy-700">Departments</p>
          {departments.length === 0 ? (
            <p className="text-xs text-ivory-600">No departments yet. Create them under Settings → Departments.</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {departments.map((d) => {
                const inIt = deptIds.includes(d.id);
                return (
                  <div key={d.id} className="flex items-center gap-2.5 rounded-lg p-2 hover:bg-ivory-50">
                    <input id={`dept-${d.id}`} type="checkbox" checked={inIt} onChange={(e) => toggleDept(d.id, e.target.checked)} className="h-4 w-4 rounded border-navy-200" />
                    <label htmlFor={`dept-${d.id}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm text-navy-700">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                      <span className="truncate">{d.name}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {role === 'member' ? (
          <div>
            <p className="mb-1 text-sm font-medium text-navy-700">What they can see</p>
            <p className="mb-2 text-xs text-ivory-600">Users see only what's switched on here. Admins see everything.</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <label key={f.key} className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 hover:bg-ivory-50">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-navy-200" checked={shown.includes(f.key)}
                    onChange={(e) => setAccess(e.target.checked ? [...shown, f.key] : shown.filter((k) => k !== f.key))} />
                  <span className="min-w-0"><span className="block text-sm text-navy-800">{f.label}</span>{f.hint && <span className="block text-[11px] text-ivory-600">{f.hint}</span>}</span>
                </label>
              ))}
            </div>
            {access && <button type="button" onClick={() => setAccess(null)} className="btn-ghost btn-sm mt-1">Back to the standard set</button>}
          </div>
        ) : (
          <p className="rounded-xl bg-ivory-50 px-3 py-2 text-xs text-ivory-700">{role === 'owner' ? 'The owner sees and manages everything.' : 'Admins see and manage everything.'}</p>
        )}
        {calendars.length > 0 && (
          <details className="rounded-xl border border-navy-100 p-3">
            <summary className="cursor-pointer text-sm font-medium text-navy-700">Assigned calendars</summary>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {calendars.map((cal) => (
                <label key={cal.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-ivory-50">
                  <input
                    type="checkbox"
                    checked={assignedCalendars.includes(cal.id)}
                    onChange={(e) => setAssignedCalendars(e.target.checked ? [...assignedCalendars, cal.id] : assignedCalendars.filter((c) => c !== cal.id))}
                    className="h-4 w-4 rounded border-navy-200 text-gold-500 focus:ring-gold-400/20"
                  />
                  <span className="text-sm text-navy-700">{cal.name}</span>
                </label>
              ))}
            </div>
          </details>
        )}
      </div>
    </Modal>
  );
}
