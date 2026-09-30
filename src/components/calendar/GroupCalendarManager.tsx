import { useEffect, useState } from 'react';
import { CalendarDays, Check, Copy, FileText, Link, Plus, Settings, UsersRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { slugify } from '@/lib/utils';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import type { Calendar as CalendarType, CalendarGroup } from '@/types';

interface FormInfo {
  id: string;
  name: string;
  status: string;
}

interface GroupWithMembers extends CalendarGroup {
  members: { calendar_id: string; calendars: CalendarType | null }[];
}

interface GroupCalendarManagerProps {
  workspaceId: string | null;
  ownerFallbackId?: string | null;
  calendars: CalendarType[];
  onClose: () => void;
  onSaved: () => void;
  onOpenSettings?: (groupId: string) => void;
}

export function GroupCalendarManager({ workspaceId, ownerFallbackId, calendars, onClose, onSaved, onOpenSettings }: GroupCalendarManagerProps) {
  const { toast } = useToast();
  const [groups, setGroups] = useState<GroupWithMembers[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<GroupWithMembers | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [forms, setForms] = useState<FormInfo[]>([]);
  const [connectedFormId, setConnectedFormId] = useState<string>('');
  const [bookingFlow, setBookingFlow] = useState<'calendar_first' | 'form_first'>('calendar_first');

  useEffect(() => {
    let active = true;
    async function loadGroups() {
      let q = supabase
        .from('calendar_groups')
        .select('*, calendar_group_members(calendar_id, calendars(*))')
        .order('created_at', { ascending: false });
      if (workspaceId) q = q.eq('workspace_id', workspaceId);
      else if (ownerFallbackId) q = q.eq('owner_id', ownerFallbackId);
      const { data } = await q;
      if (!active) return;
      setGroups(((data ?? []) as unknown as (CalendarGroup & { calendar_group_members: { calendar_id: string; calendars: CalendarType | null }[] })[]).map(g => ({ ...g, members: g.calendar_group_members ?? [] })));
      setLoading(false);
    }
    loadGroups();
    let fq = supabase
      .from('forms')
      .select('id, name, status')
      .order('name');
    if (workspaceId) fq = fq.eq('workspace_id', workspaceId);
    else if (ownerFallbackId) fq = fq.eq('owner_id', ownerFallbackId);
    fq.then(({ data }) => setForms((data ?? []) as FormInfo[]));
    return () => { active = false; };
  }, [workspaceId, ownerFallbackId]);


  function startCreate() {
    setSelectedGroup(null);
    setName('');
    setDescription('');
    setSelectedCalendarIds(new Set());
    setConnectedFormId('');
    setBookingFlow('calendar_first');
    setShowForm(true);
  }

  function startEdit(group: GroupWithMembers) {
    setSelectedGroup(group);
    setName(group.name);
    setDescription(group.description ?? '');
    setSelectedCalendarIds(new Set(group.members.map(member => member.calendar_id)));
    setConnectedFormId(group.connected_form_id ?? '');
    setBookingFlow(group.booking_flow ?? 'calendar_first');
    setShowForm(true);
  }

  function toggleCalendar(id: string) {
    setSelectedCalendarIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function saveGroup() {
    if (!name.trim() || selectedCalendarIds.size === 0) {
      toast('Add a group name and at least one calendar.', 'error');
      return;
    }
    setSaving(true);
    const slug = slugify(name.trim());
    const groupPayload = {
      name: name.trim(),
      description: description.trim() || null,
      slug,
      connected_form_id: connectedFormId || null,
      booking_flow: bookingFlow,
    };
    const groupResult = selectedGroup
      ? await supabase.from('calendar_groups').update(groupPayload).eq('id', selectedGroup.id).select().maybeSingle()
      : await supabase.from('calendar_groups').insert({
          ...(workspaceId ? { workspace_id: workspaceId } : {}),
          ...(ownerFallbackId && !workspaceId ? { owner_id: ownerFallbackId } : {}),
          ...groupPayload,
        }).select().maybeSingle();

    if (groupResult.error || !groupResult.data) {
      setSaving(false);
      toast(groupResult.error?.message ?? 'Could not save this group.', 'error');
      return;
    }

    const groupId = groupResult.data.id as string;
    if (selectedGroup) {
      const { error: deleteError } = await supabase.from('calendar_group_members').delete().eq('group_id', groupId);
      if (deleteError) {
        setSaving(false);
        toast('Could not update the calendars in this group.', 'error');
        return;
      }
    }
    const { error: memberError } = await supabase.from('calendar_group_members').insert(
      [...selectedCalendarIds].map((calendarId, index) => ({ group_id: groupId, calendar_id: calendarId, sort_order: index })),
    );
    setSaving(false);
    if (memberError) {
      toast('The group was saved, but its calendars could not be added.', 'error');
      return;
    }
    toast(selectedGroup ? 'Group calendar updated.' : 'Group calendar created.', 'success');
    setShowForm(false);
    onSaved();
  }

  async function copyLink(group: GroupWithMembers) {
    await navigator.clipboard.writeText(`${window.location.origin}/group/${group.slug}`);
    toast('Group booking link copied.', 'success');
  }

  return (
    <Modal open onClose={onClose} title="Group calendars" description="Combine existing calendars into one booking experience." size="lg">
      {showForm ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between border-b border-navy-100 pb-4">
            <div>
              <h3 className="text-base font-semibold text-navy-800">{selectedGroup ? 'Edit group calendar' : 'Create group calendar'}</h3>
              <p className="mt-1 text-xs text-ivory-500">Visitors will choose from the calendars you add here.</p>
            </div>
            <button onClick={() => setShowForm(false)} className="text-sm font-medium text-ivory-600 hover:text-navy-800">Back</button>
          </div>
          <label className="block text-sm font-medium text-navy-700">Group name <span className="text-red-500">*</span>
            <input value={name} onChange={event => setName(event.target.value)} placeholder="Sales team" className="mt-2 w-full rounded-lg border border-navy-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <label className="block text-sm font-medium text-navy-700">Description
            <textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="Choose the right calendar for your request" rows={3} className="mt-2 w-full resize-none rounded-lg border border-navy-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-navy-700">Add calendars <span className="text-red-500">*</span></label>
              <span className="text-xs text-ivory-500">{selectedCalendarIds.size} selected</span>
            </div>
            <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
              {calendars.map(calendar => {
                const selected = selectedCalendarIds.has(calendar.id);
                return (
                  <button key={calendar.id} onClick={() => toggleCalendar(calendar.id)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${selected ? 'border-blue-500 bg-blue-50' : 'border-navy-100 hover:border-blue-300'}`}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${calendar.color}18` }}><CalendarDays className="h-4 w-4" style={{ color: calendar.color }} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-navy-800">{calendar.name}</span><span className="block text-xs capitalize text-ivory-500">{calendar.calendar_type.replace('_', ' ')}</span></span>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-navy-200'}`}>{selected && <Check className="h-3 w-3" />}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Form selection */}
          <div>
            <label className="mb-2 block text-sm font-medium text-navy-700">Booking form</label>
            <p className="mb-2 text-xs text-ivory-500">Show a form to visitors before they choose a calendar. Leave on default to skip the form step.</p>
            <div className="space-y-2">
              <button
                onClick={() => setConnectedFormId('')}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${!connectedFormId ? 'border-blue-500 bg-blue-50' : 'border-navy-100 hover:border-blue-300'}`}
              >
                <FileText className="h-4 w-4 text-ivory-500" />
                <span className="text-sm font-medium text-navy-700">No form (choose calendar first)</span>
              </button>
              {forms.map(f => (
                <button
                  key={f.id}
                  onClick={() => setConnectedFormId(f.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${connectedFormId === f.id ? 'border-blue-500 bg-blue-50' : 'border-navy-100 hover:border-blue-300'}`}
                >
                  <FileText className="h-4 w-4 text-ivory-500" />
                  <span className="text-sm font-medium text-navy-700">{f.name}</span>
                  <span className={`ml-auto text-xs ${f.status === 'active' ? 'text-green-600' : 'text-ivory-500'}`}>{f.status}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Booking flow */}
          {connectedFormId && (
            <div>
              <label className="mb-2 block text-sm font-medium text-navy-700">Booking flow</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setBookingFlow('calendar_first')}
                  className={`rounded-xl border-2 p-3 text-sm font-medium transition ${bookingFlow === 'calendar_first' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-navy-100 text-navy-700 hover:border-navy-200'}`}
                >
                  Calendar first
                </button>
                <button
                  onClick={() => setBookingFlow('form_first')}
                  className={`rounded-xl border-2 p-3 text-sm font-medium transition ${bookingFlow === 'form_first' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-navy-100 text-navy-700 hover:border-navy-200'}`}
                >
                  Form first
                </button>
              </div>
              <p className="mt-1.5 text-xs text-ivory-500">
                {bookingFlow === 'form_first'
                  ? 'Visitors fill out the form, then pick a calendar and time.'
                  : 'Visitors pick a calendar and time, then fill out the form.'}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-navy-100 pt-4">
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-navy-200 px-4 py-2 text-sm font-semibold text-navy-700">Cancel</button>
            <button disabled={saving} onClick={saveGroup} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save group'}</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div><h3 className="text-base font-semibold text-navy-800">Your group calendars</h3><p className="mt-1 text-xs text-ivory-500">One link can present multiple calendars and their forms.</p></div>
            <button onClick={startCreate} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"><Plus className="h-3.5 w-3.5" /> Create group</button>
          </div>
          {loading ? <p className="py-10 text-center text-sm text-ivory-500">Loading group calendars...</p> : groups.length === 0 ? <div className="rounded-xl border border-dashed border-navy-200 p-8 text-center"><UsersRound className="mx-auto h-8 w-8 text-ivory-400" /><p className="mt-3 text-sm font-semibold text-navy-700">No group calendars yet</p><p className="mt-1 text-xs text-ivory-500">Create one to share several calendars from a single link.</p></div> : <div className="space-y-2">{groups.map(group => <div key={group.id} className="rounded-xl border border-navy-100 p-4"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><UsersRound className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="font-semibold text-navy-800">{group.name}</p><p className="mt-1 text-xs text-ivory-500">{group.members.length} calendars{group.description ? ` · ${group.description}` : ''}</p><div className="mt-2 flex flex-wrap gap-1.5">{group.members.map(member => <span key={member.calendar_id} className="rounded-full bg-ivory-100 px-2 py-1 text-[10px] font-medium text-ivory-700">{member.calendars?.name ?? 'Calendar'}</span>)}</div></div><button onClick={() => startEdit(group)} className="rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50">Edit</button>
                      {onOpenSettings && (
                        <button onClick={() => onOpenSettings(group.id)} className="rounded-lg px-2 py-1 text-xs font-semibold text-navy-600 hover:bg-navy-50">
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                      )}</div><div className="mt-3 flex items-center gap-2 border-t border-navy-50 pt-3"><Link className="h-3.5 w-3.5 text-ivory-400" /><span className="min-w-0 flex-1 truncate text-xs text-ivory-500">/group/{group.slug}</span><button onClick={() => copyLink(group)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-ivory-600 hover:bg-ivory-50"><Copy className="h-3 w-3" /> Copy link</button></div></div>)}</div>}
        </div>
      )}
    </Modal>
  );
}
