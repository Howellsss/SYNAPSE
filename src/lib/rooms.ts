/**
 * Company rooms: standing video rooms that admins and supervisors create and assign to experts
 * (or open to a whole department). Experts can't create rooms; in the rooms assigned to them they
 * start calls and make links for clients or teammates. A room shows busy while a call is on in it.
 * Database: 20261015090000_company_rooms.sql.
 */
import { supabase } from '@/lib/supabase';
import { createMeeting, type Meeting } from '@/lib/meetings';
import type { UserRole } from '@/types';

export const ROOMS_NOT_SET_UP = 'Rooms need the database update 20261015090000_company_rooms.sql (run it in the Supabase SQL editor).';
const missing = (msg: string) => /company_room|room_id|for_whom|does not exist|Could not find the (table|function|.*column)|schema cache/i.test(msg);
const friendly = (msg: string) => (missing(msg) ? ROOMS_NOT_SET_UP : msg);

export interface CompanyRoom {
  id: string;
  workspace_id: string;
  department_id: string | null;
  name: string;
  description: string | null;
  open_to_department: boolean;
  created_by: string | null;
  created_at: string;
  busy_until: string | null;
  busy_meeting: string | null;
  busy_by: string | null;
  /** Who is assigned (user ids). */
  assignees: string[];
}

/** Who I am, for working out what I may do with a room (the database checks the same). */
export interface RoomViewer {
  userId: string;
  role: UserRole | null;
  /** Departments I'm in, and the ones I lead. */
  departmentIds: string[];
  leadDepartmentIds: string[];
}

const isAdmin = (v: RoomViewer) => v.role === 'owner' || v.role === 'admin';

export function canCreateRooms(v: RoomViewer): boolean {
  return isAdmin(v) || v.role === 'supervisor';
}

export function canManageRoom(room: Pick<CompanyRoom, 'created_by' | 'department_id'>, v: RoomViewer): boolean {
  if (isAdmin(v)) return true;
  if (v.role !== 'supervisor') return false;
  return room.created_by === v.userId || (!!room.department_id && v.leadDepartmentIds.includes(room.department_id));
}

export function canUseRoom(room: Pick<CompanyRoom, 'created_by' | 'department_id' | 'assignees' | 'open_to_department'>, v: RoomViewer): boolean {
  if (canManageRoom(room, v)) return true;
  if (room.assignees.includes(v.userId)) return true;
  return room.open_to_department && !!room.department_id && v.departmentIds.includes(room.department_id);
}

/** Departments a room can be put in by this person: any for admins, the ones they lead for supervisors. */
export function departmentsForRooms<T extends { id: string }>(all: T[], v: RoomViewer): T[] {
  return isAdmin(v) ? all : all.filter((d) => v.leadDepartmentIds.includes(d.id));
}

export function isBusy(room: Pick<CompanyRoom, 'busy_until'>, now = Date.now()): boolean {
  return !!room.busy_until && Date.parse(room.busy_until) > now;
}

/** "Tech Room 1 · Jane (client)" */
export function linkTitle(roomName: string, forWhom: string): string {
  const who = forWhom.trim();
  return (who ? `${roomName} · ${who}` : roomName).slice(0, 120);
}

/** Which assignments to add and remove to go from `current` to `wanted`. */
export function assigneeChanges(current: string[], wanted: string[]): { add: string[]; remove: string[] } {
  const cur = new Set(current);
  const want = new Set(wanted);
  return { add: [...want].filter((id) => !cur.has(id)), remove: [...cur].filter((id) => !want.has(id)) };
}

type RoomRow = Omit<CompanyRoom, 'assignees'> & { company_room_assignees?: { user_id: string }[] | null };

export async function listRooms(workspaceId: string): Promise<{ data: CompanyRoom[]; error: string | null }> {
  const { data, error } = await supabase
    .from('company_rooms')
    .select('*, company_room_assignees(user_id)')
    .eq('workspace_id', workspaceId)
    .order('name');
  if (error) return { data: [], error: friendly(error.message) };
  return {
    data: ((data ?? []) as RoomRow[]).map(({ company_room_assignees, ...r }) => ({ ...r, assignees: (company_room_assignees ?? []).map((a) => a.user_id) })),
    error: null,
  };
}

export interface RoomInput {
  id?: string;
  name: string;
  description?: string | null;
  department_id: string | null;
  open_to_department: boolean;
}

export async function saveRoom(workspaceId: string, userId: string, room: RoomInput, assignees: string[], currentAssignees: string[] = []): Promise<{ id: string | null; error: string | null }> {
  const row = {
    name: room.name.trim().slice(0, 80),
    description: room.description?.trim().slice(0, 500) || null,
    department_id: room.department_id,
    open_to_department: room.open_to_department && !!room.department_id,
  };
  if (!row.name) return { id: null, error: 'Give the room a name.' };
  const res = room.id
    ? await supabase.from('company_rooms').update(row).eq('id', room.id).select('id').single()
    : await supabase.from('company_rooms').insert({ ...row, workspace_id: workspaceId, created_by: userId }).select('id').single();
  if (res.error) {
    if (res.error.code === '23505') return { id: null, error: `There is already a room called "${row.name}".` };
    if (/row-level security/i.test(res.error.message)) return { id: null, error: 'Only admins and supervisors can create rooms, and supervisors only in departments they lead.' };
    return { id: null, error: friendly(res.error.message) };
  }
  const id = (res.data as { id: string }).id;
  const { add, remove } = assigneeChanges(currentAssignees, assignees);
  if (remove.length) {
    const { error } = await supabase.from('company_room_assignees').delete().eq('room_id', id).in('user_id', remove);
    if (error) return { id, error: friendly(error.message) };
  }
  if (add.length) {
    const { error } = await supabase.from('company_room_assignees').insert(add.map((user_id) => ({ room_id: id, workspace_id: workspaceId, user_id, assigned_by: userId })));
    if (error) return { id, error: friendly(error.message) };
  }
  return { id, error: null };
}

export async function deleteRoom(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('company_rooms').delete().eq('id', id);
  return { error: error ? friendly(error.message) : null };
}

/** A call in the room now, or a link for later (for a client or a teammate). */
export async function createRoomMeeting(
  room: Pick<CompanyRoom, 'id' | 'workspace_id' | 'name'>,
  hostId: string,
  opts: { forWhom: string; scheduledAt?: Date | null; now?: boolean },
): Promise<{ data: Meeting | null; error: string | null }> {
  const { data, error } = await createMeeting({
    workspaceId: room.workspace_id,
    hostId,
    title: linkTitle(room.name, opts.forWhom),
    kind: opts.now ? 'instant' : opts.scheduledAt ? 'scheduled' : 'later',
    scheduledAt: opts.scheduledAt ?? null,
    durationMin: 60,
    roomId: room.id,
    forWhom: opts.forWhom,
  });
  return { data, error: error ? friendly(error) : null };
}

/** Links made in a room that are still open, newest first. */
export async function listRoomLinks(roomId: string): Promise<{ data: Meeting[]; error: string | null }> {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('room_id', roomId)
    .is('ended_at', null)
    .order('created_at', { ascending: false })
    .limit(20);
  return { data: (data ?? []) as Meeting[], error: error ? friendly(error.message) : null };
}

/** Keep the room busy while this call is on (every ~45 s), and free it when the call ends. */
export async function roomHeartbeat(meetingId: string): Promise<void> {
  await supabase.rpc('room_heartbeat', { p_meeting: meetingId });
}
export async function roomRelease(meetingId: string): Promise<void> {
  await supabase.rpc('room_release', { p_meeting: meetingId });
}
