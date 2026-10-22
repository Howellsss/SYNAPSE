/**
 * Company accounts: the team directory, departments, and bulk invitations.
 * Roles: owner (the account holder), admin (sees and manages everything), and users ('member'),
 * who see what an admin gives them (src/lib/access.ts).
 */
import { supabase } from '@/lib/supabase';
import type { UserRole } from '@/types';
import { isValidEmail, normalizeEmail } from '@/lib/invitations';

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'User',
};

export const ROLE_HINTS: Record<Exclude<UserRole, 'owner'>, string> = {
  admin: 'Sees everything and manages people, rooms and settings',
  member: 'Sees what an admin switches on for them',
};

/** Roles an admin can give (owner is only ever the account holder). */
export const ASSIGNABLE_ROLES: Exclude<UserRole, 'owner'>[] = ['member', 'admin'];

export interface DirectoryMember {
  member_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  /** Only filled in for admins. */
  email: string | null;
  role: UserRole;
  status: 'invited' | 'active' | 'suspended';
  title: string | null;
  joined_at: string;
  department_ids: string[];
  lead_department_ids: string[];
}

export interface Department {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
}

export const DEPARTMENT_COLORS = ['#0D1C3B', '#2F5D9F', '#1F7A6B', '#B7791F', '#9B2C2C', '#6B46C1', '#4A5568', '#C05621'];

export function memberName(m: Pick<DirectoryMember, 'first_name' | 'last_name' | 'email'>): string {
  const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim();
  return name || m.email || 'Unnamed member';
}

export async function loadDirectory(workspaceId: string): Promise<{ data: DirectoryMember[]; error: string | null }> {
  const { data, error } = await supabase.rpc('workspace_directory', { p_workspace_id: workspaceId });
  return { data: (data ?? []) as DirectoryMember[], error: error?.message ?? null };
}

export async function loadDepartments(workspaceId: string): Promise<{ data: Department[]; error: string | null }> {
  const { data, error } = await supabase.from('departments').select('*').eq('workspace_id', workspaceId).order('name');
  return { data: (data ?? []) as Department[], error: error?.message ?? null };
}

export async function saveDepartment(
  workspaceId: string,
  userId: string | null,
  dept: { id?: string; name: string; description?: string | null; color: string },
): Promise<{ data: Department | null; error: string | null }> {
  const row = { name: dept.name.trim(), description: dept.description?.trim() || null, color: dept.color };
  const q = dept.id
    ? supabase.from('departments').update(row).eq('id', dept.id).select('*').single()
    : supabase.from('departments').insert({ ...row, workspace_id: workspaceId, created_by: userId }).select('*').single();
  const { data, error } = await q;
  if (error?.code === '23505') return { data: null, error: `There is already a department called "${row.name}".` };
  return { data: (data as Department | null) ?? null, error: error?.message ?? null };
}

export async function deleteDepartment(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('departments').delete().eq('id', id);
  return { error: error?.message ?? null };
}

/** Put people in a department. Existing memberships are updated. */
export async function addToDepartment(
  workspaceId: string, departmentId: string, userIds: string[], isLead = false, addedBy: string | null = null,
): Promise<{ error: string | null }> {
  if (!userIds.length) return { error: null };
  const { error } = await supabase.from('department_members').upsert(
    userIds.map((user_id) => ({ department_id: departmentId, workspace_id: workspaceId, user_id, is_lead: isLead, added_by: addedBy })),
    { onConflict: 'department_id,user_id' },
  );
  return { error: error?.message ?? null };
}

export async function removeFromDepartment(departmentId: string, userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('department_members').delete().eq('department_id', departmentId).eq('user_id', userId);
  return { error: error?.message ?? null };
}

/** Set exactly which departments someone is in (and which they lead). Admins only. */
export async function setMemberDepartments(
  workspaceId: string, userId: string, departmentIds: string[], leadIds: string[], addedBy: string | null,
): Promise<{ error: string | null }> {
  const { data: current, error: readErr } = await supabase
    .from('department_members').select('department_id').eq('workspace_id', workspaceId).eq('user_id', userId);
  if (readErr) return { error: readErr.message };
  const keep = new Set(departmentIds);
  const remove = (current ?? []).map((r: { department_id: string }) => r.department_id).filter((id) => !keep.has(id));
  if (remove.length) {
    const { error } = await supabase.from('department_members').delete().eq('user_id', userId).in('department_id', remove);
    if (error) return { error: error.message };
  }
  if (departmentIds.length) {
    const { error } = await supabase.from('department_members').upsert(
      departmentIds.map((department_id) => ({
        department_id, workspace_id: workspaceId, user_id: userId, is_lead: leadIds.includes(department_id), added_by: addedBy,
      })),
      { onConflict: 'department_id,user_id' },
    );
    if (error) return { error: error.message };
  }
  return { error: null };
}

export async function updateMember(memberId: string, changes: { role?: UserRole; title?: string | null; status?: string }) {
  const { error } = await supabase.from('workspace_members').update(changes).eq('id', memberId);
  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------- bulk invite

export interface InviteRow {
  email: string;
  role: Exclude<UserRole, 'owner'>;
  /** Department name as typed (matched to a department by name, case-insensitive). */
  department: string;
  title: string;
}

export interface ParsedInvites {
  rows: InviteRow[];
  /** Line number (1-based) and why it was skipped. */
  problems: { line: number; text: string; reason: string }[];
}

const ROLE_WORDS: Record<string, Exclude<UserRole, 'owner'>> = {
  member: 'member', expert: 'member', staff: 'member', agent: 'member', user: 'member',
  supervisor: 'member', manager: 'member', lead: 'member', 'team lead': 'member',
  admin: 'admin', administrator: 'admin',
};

/** Split one CSV line, honouring quotes ("Smith, Jane"). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Read pasted emails or a CSV. Accepts:
 *  - one email per line, or emails separated by commas/spaces, or
 *  - a CSV with a header row containing "email" and optionally "role", "department", "title"
 *    (in any order; "position"/"job title" work for title, "team" for department).
 * Unknown roles fall back to the default. Duplicates are dropped.
 */
export function parseInvites(text: string, defaults: { role: Exclude<UserRole, 'owner'>; department: string }): ParsedInvites {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const rows: InviteRow[] = [];
  const problems: ParsedInvites['problems'] = [];
  const seen = new Set<string>();
  const add = (row: InviteRow, line: number, raw: string) => {
    if (!isValidEmail(row.email)) { problems.push({ line, text: raw, reason: 'Not a valid email address' }); return; }
    const email = normalizeEmail(row.email);
    if (seen.has(email)) { problems.push({ line, text: raw, reason: 'Listed twice' }); return; }
    seen.add(email);
    rows.push({ ...row, email });
  };

  const firstIdx = lines.findIndex((l) => l.trim());
  if (firstIdx < 0) return { rows, problems };
  const header = splitCsvLine(lines[firstIdx]).map((h) => h.toLowerCase().replace(/[^a-z ]/g, '').trim());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const emailCol = col('email', 'email address', 'e mail', 'mail');

  if (emailCol >= 0) {
    const roleCol = col('role', 'access');
    const deptCol = col('department', 'team', 'group', 'dept');
    const titleCol = col('title', 'job title', 'position');
    for (let i = firstIdx + 1; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.trim()) continue;
      const cells = splitCsvLine(raw);
      const roleWord = (roleCol >= 0 ? cells[roleCol] ?? '' : '').toLowerCase().trim();
      add({
        email: cells[emailCol] ?? '',
        role: ROLE_WORDS[roleWord] ?? defaults.role,
        department: (deptCol >= 0 ? cells[deptCol] : '')?.trim() || defaults.department,
        title: (titleCol >= 0 ? cells[titleCol] : '')?.trim().slice(0, 80) ?? '',
      }, i + 1, raw);
    }
    return { rows, problems };
  }

  // A plain list of emails.
  lines.forEach((raw, i) => {
    for (const piece of raw.split(/[\s,;]+/)) {
      const email = piece.replace(/^<|>$/g, '').trim();
      if (!email) continue;
      add({ email, role: defaults.role, department: defaults.department, title: '' }, i + 1, email);
    }
  });
  return { rows, problems };
}

/** Find a department by the name typed in a CSV (case and extra spaces don't matter). */
export function matchDepartment(departments: Pick<Department, 'id' | 'name'>[], name: string): string | null {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return null;
  return departments.find((d) => d.name.trim().toLowerCase().replace(/\s+/g, ' ') === key)?.id ?? null;
}

/**
 * Create invitations in batches (fine for hundreds). People who are already members or already
 * have a pending invitation are skipped and reported.
 */
export async function sendInviteRows(
  workspaceId: string,
  invitedBy: string | null,
  rows: (Omit<InviteRow, 'department'> & { departmentId: string | null })[],
  existing: { memberEmails: string[]; pendingEmails: string[] },
): Promise<{ sent: number; skipped: { email: string; reason: string }[]; error: string | null }> {
  const members = new Set(existing.memberEmails.map(normalizeEmail));
  const pending = new Set(existing.pendingEmails.map(normalizeEmail));
  const skipped: { email: string; reason: string }[] = [];
  const toSend = rows.filter((r) => {
    if (members.has(r.email)) { skipped.push({ email: r.email, reason: 'Already a member' }); return false; }
    if (pending.has(r.email)) { skipped.push({ email: r.email, reason: 'Already invited' }); return false; }
    return true;
  });
  let sent = 0;
  for (let i = 0; i < toSend.length; i += 100) {
    const batch = toSend.slice(i, i + 100);
    const { error } = await supabase.from('team_invitations').insert(batch.map((r) => ({
      workspace_id: workspaceId,
      email: r.email,
      role: r.role,
      title: r.title || null,
      department_id: r.departmentId,
      invited_by: invitedBy,
    })));
    if (error) return { sent, skipped, error: error.message };
    sent += batch.length;
  }
  return { sent, skipped, error: null };
}

/** CSV of pending invitations with their join links, for sending from your own email or chat tool. */
export function invitationLinksCsv(rows: { email: string; role: string; link: string }[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ['email,role,invite link', ...rows.map((r) => [r.email, r.role, r.link].map(esc).join(','))].join('\n');
}
