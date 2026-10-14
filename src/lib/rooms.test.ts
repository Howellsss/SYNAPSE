import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { assigneeChanges, canCreateRooms, canManageRoom, canUseRoom, departmentsForRooms, isBusy, linkTitle, type RoomViewer } from './rooms';

const viewer = (o: Partial<RoomViewer>): RoomViewer => ({ userId: 'me', role: 'member', departmentIds: [], leadDepartmentIds: [], ...o });
const room = { created_by: 'sup', department_id: 'tech', assignees: ['ada'], open_to_department: false };

describe('who may do what with rooms', () => {
  it('lets admins and supervisors create rooms, not experts', () => {
    expect(canCreateRooms(viewer({ role: 'admin' }))).toBe(true);
    expect(canCreateRooms(viewer({ role: 'supervisor' }))).toBe(true);
    expect(canCreateRooms(viewer({ role: 'member' }))).toBe(false);
  });
  it('lets the creating supervisor or a lead of the department manage it', () => {
    expect(canManageRoom(room, viewer({ userId: 'sup', role: 'supervisor' }))).toBe(true);
    expect(canManageRoom(room, viewer({ role: 'supervisor', leadDepartmentIds: ['tech'] }))).toBe(true);
    expect(canManageRoom(room, viewer({ role: 'supervisor', leadDepartmentIds: ['video'] }))).toBe(false);
    expect(canManageRoom(room, viewer({ role: 'owner' }))).toBe(true);
    expect(canManageRoom(room, viewer({ userId: 'sup', role: 'member' }))).toBe(false);
  });
  it('lets assigned experts use a room, and the department when it is open to it', () => {
    expect(canUseRoom(room, viewer({ userId: 'ada' }))).toBe(true);
    expect(canUseRoom(room, viewer({ userId: 'bo', departmentIds: ['tech'] }))).toBe(false);
    expect(canUseRoom({ ...room, open_to_department: true }, viewer({ userId: 'bo', departmentIds: ['tech'] }))).toBe(true);
  });
  it('offers supervisors only the departments they lead', () => {
    const all = [{ id: 'tech' }, { id: 'video' }];
    expect(departmentsForRooms(all, viewer({ role: 'supervisor', leadDepartmentIds: ['video'] }))).toEqual([{ id: 'video' }]);
    expect(departmentsForRooms(all, viewer({ role: 'admin' }))).toEqual(all);
  });
});

describe('room helpers', () => {
  it('is busy only until the heartbeat runs out', () => {
    expect(isBusy({ busy_until: new Date(2000).toISOString() }, 1000)).toBe(true);
    expect(isBusy({ busy_until: new Date(2000).toISOString() }, 3000)).toBe(false);
    expect(isBusy({ busy_until: null })).toBe(false);
  });
  it('names links after the room and who they are for', () => {
    expect(linkTitle('Tech Room 1', ' Jane (client) ')).toBe('Tech Room 1 · Jane (client)');
    expect(linkTitle('Tech Room 1', '')).toBe('Tech Room 1');
  });
  it('works out assignment changes', () => {
    expect(assigneeChanges(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
  });
});
