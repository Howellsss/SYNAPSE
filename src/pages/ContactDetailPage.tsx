import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, Trash2, Phone, Mail, Copy, Search, Plus, X,
  Calendar, CalendarCheck, CalendarX, Clock, FileText, MessageSquare, StickyNote, UserPlus, Loader2,
  PhoneIncoming, Smartphone, Building2, Globe2, Sparkles,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { useRouter } from '@/lib/router';
import { Avatar } from '@/components/ui/Avatar';
import { TagPill } from '@/components/ui/StatusPills';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TimezoneSelect } from '@/components/ui/TimezoneSelect';
import { MessageComposer } from '@/components/contacts/MessageComposer';
import { cn, formatDate, formatTime, getFullName, timeAgo } from '@/lib/utils';
import { readContactNav, type ContactNav } from '@/lib/contact-nav';
import type { Contact, Tag, DndChannel } from '@/types';

type ContactRow = Contact & { owner_id?: string | null; contact_tags?: { tag_id: string; tags: Tag | null }[] };
interface ApptRow { id: string; title: string; status: string; start_time: string; end_time: string; created_at: string; calendars?: { name: string } | null }
interface MessageRow { id: string; channel: 'email' | 'sms'; direction: string | null; subject: string | null; body: string | null; status: string; created_at: string }
interface NoteRow { id: string; content: string; created_at: string; author_id: string | null }
interface SubmissionRow { id: string; created_at: string; source: string | null; forms?: { name: string } | null }
interface Member { user_id: string; name: string }

const DND_CHANNELS: { value: DndChannel; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'sms', label: 'Text messages', icon: MessageSquare },
  { value: 'calls', label: 'Calls & voicemail', icon: Smartphone },
  { value: 'inbound', label: 'Inbound calls and SMS', icon: PhoneIncoming },
];

function isMissingColumnError(error: { code?: string; message?: string }) {
  return error.code === 'PGRST204' || /column .* does not exist|schema cache/i.test(error.message ?? '');
}

export function ContactDetailPage({ contactId }: { contactId: string }) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useRouter();

  const [contact, setContact] = useState<ContactRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [appointments, setAppointments] = useState<ApptRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const nav = useMemo<ContactNav | null>(() => readContactNav(), []);
  const navIndex = nav ? nav.ids.indexOf(contactId) : -1;

  const loadContact = useCallback(async () => {
    const { data } = await supabase.from('contacts').select('*, contact_tags(tag_id, tags(*))').eq('id', contactId).maybeSingle();
    setContact((data as ContactRow | null) ?? null);
    return data as ContactRow | null;
  }, [contactId]);

  const loadActivity = useCallback(async () => {
    const [appts, msgs, nts, subs] = await Promise.all([
      supabase.from('appointments').select('id, title, status, start_time, end_time, created_at, calendars(name)').eq('contact_id', contactId).order('start_time', { ascending: false }).limit(50),
      supabase.from('messages').select('id, channel, direction, subject, body, status, created_at').eq('contact_id', contactId).order('created_at', { ascending: true }).limit(200),
      supabase.from('notes').select('id, content, created_at, author_id').eq('contact_id', contactId).order('created_at', { ascending: true }).limit(200),
      supabase.from('form_submissions').select('id, created_at, source, forms(name)').eq('contact_id', contactId).order('created_at', { ascending: false }).limit(50),
    ]);
    setAppointments((appts.data ?? []) as unknown as ApptRow[]);
    setMessages((msgs.data ?? []) as MessageRow[]);
    setNotes((nts.data ?? []) as NoteRow[]);
    setSubmissions((subs.data ?? []) as unknown as SubmissionRow[]);
  }, [contactId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadContact(), loadActivity()]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadContact, loadActivity]);

  useEffect(() => {
    if (!workspace) return;
    supabase.from('tags').select('*').eq('workspace_id', workspace.id).order('name').then(({ data }) => setAllTags((data ?? []) as Tag[]));
    (async () => {
      const { data: rows } = await supabase.from('workspace_members').select('user_id').eq('workspace_id', workspace.id);
      const ids = (rows ?? []).map((r: { user_id: string }) => r.user_id);
      if (ids.length === 0) return;
      const { data: profiles } = await supabase.from('profiles').select('user_id, first_name, last_name').in('user_id', ids);
      setMembers(ids.map((id) => {
        const p = (profiles ?? []).find((x: { user_id: string }) => x.user_id === id) as { first_name?: string; last_name?: string } | undefined;
        const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ');
        return { user_id: id, name: name || (id === user?.id ? 'You' : 'Team member') };
      }));
    })();
  }, [workspace, user?.id]);

  const goTo = (index: number) => {
    if (!nav || index < 0 || index >= nav.ids.length) return;
    navigate(`/contacts/${nav.ids[index]}`);
  };

  const updateContact = async (patch: Record<string, unknown>, detailKeys: string[] = []): Promise<boolean> => {
    if (!contact) return false;
    let { error } = await supabase.from('contacts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', contact.id);
    if (error && isMissingColumnError(error) && detailKeys.length) {
      const core = Object.fromEntries(Object.entries(patch).filter(([k]) => !detailKeys.includes(k)));
      ({ error } = await supabase.from('contacts').update(core).eq('id', contact.id));
      if (!error) toast('Saved. Some fields need the latest database update before they can be stored.', 'info');
    }
    if (error) { toast(error.message, 'error'); return false; }
    await loadContact();
    return true;
  };

  const deleteContact = async () => {
    if (!contact) return;
    const { error } = await supabase.from('contacts').delete().eq('id', contact.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Contact deleted');
    navigate('/contacts');
  };

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gold-500" /></div>;
  }
  if (!contact) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="text-xl font-semibold text-navy-800">Contact not found</h1>
        <p className="mt-2 text-sm text-ivory-600">It may have been deleted, or you don't have access to it.</p>
        <button onClick={() => navigate('/contacts')} className="btn-primary mt-6">Back to contacts</button>
      </div>
    );
  }

  const contactTags = (contact.contact_tags ?? []).map((ct) => ct.tags).filter((t): t is Tag => Boolean(t));

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100vh-4rem)] flex-col bg-ivory-50 lg:-mx-8">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-navy-100 bg-white px-4 py-3 lg:px-8">
        <button onClick={() => navigate('/contacts')} className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-navy-700 hover:bg-ivory-50">
          <ArrowLeft className="h-4 w-4" /> Contacts
        </button>
        <ChevronRight className="h-4 w-4 text-ivory-400" />
        <span className="truncate text-sm font-medium text-navy-800">{getFullName(contact)}</span>
        <div className="flex-1" />
        {nav && navIndex >= 0 && (
          <div className="flex items-center gap-1 text-sm text-ivory-600">
            <span className="mr-1 whitespace-nowrap tabular-nums">{(nav.offset + navIndex + 1).toLocaleString()} / {nav.total.toLocaleString()}</span>
            <button aria-label="Previous contact" disabled={navIndex === 0} onClick={() => goTo(navIndex - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-navy-100 bg-white text-navy-700 hover:bg-ivory-50 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button aria-label="Next contact" disabled={navIndex === nav.ids.length - 1} onClick={() => goTo(navIndex + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-navy-100 bg-white text-navy-700 hover:bg-ivory-50 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 p-4 lg:p-6 xl:grid-cols-[340px_minmax(0,1fr)_320px]">
        {/* LEFT: profile + fields */}
        <div className="space-y-4">
          <ProfileCard
            contact={contact}
            tags={contactTags}
            allTags={allTags}
            members={members}
            onUpdate={updateContact}
            onDelete={() => setDeleteOpen(true)}
            onTagsChanged={async () => { await loadContact(); if (workspace) { const { data } = await supabase.from('tags').select('*').eq('workspace_id', workspace.id).order('name'); setAllTags((data ?? []) as Tag[]); } }}
          />
          <FieldsPanel contact={contact} onUpdate={updateContact} />
        </div>

        {/* CENTER: snapshot + one thread */}
        <div className="min-w-0 space-y-4">
          <Snapshot contact={contact} appointments={appointments} messages={messages} submissions={submissions} onBook={() => navigate('/calendars')} />
          <ThreadPanel contact={contact} messages={messages} notes={notes} onSent={async () => { await loadActivity(); await updateContact({ last_activity_at: new Date().toISOString() }); }} />
        </div>

        {/* RIGHT: journey */}
        <JourneyPanel contact={contact} appointments={appointments} messages={messages} notes={notes} submissions={submissions} />
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteContact}
        title="Delete contact?"
        message={`${getFullName(contact)} and their notes will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete contact"
        danger
      />
    </div>
  );
}

// ============================================================
// LEFT COLUMN
// ============================================================

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-2xl border border-navy-100 bg-white', className)}>{children}</section>;
}

function ProfileCard({ contact, tags, allTags, members, onUpdate, onDelete, onTagsChanged }: {
  contact: ContactRow;
  tags: Tag[];
  allTags: Tag[];
  members: Member[];
  onUpdate: (patch: Record<string, unknown>) => Promise<boolean>;
  onDelete: () => void;
  onTagsChanged: () => Promise<void>;
}) {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [tagOpen, setTagOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState('');

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast("Couldn't copy", 'error'); }
  };

  const addTag = async (tag: Tag) => {
    const { error } = await supabase.from('contact_tags').insert({ contact_id: contact.id, tag_id: tag.id });
    if (error && error.code !== '23505') { toast(error.message, 'error'); return; }
    setTagOpen(false); setTagQuery('');
    await onTagsChanged();
  };
  const createTag = async () => {
    const name = tagQuery.trim();
    if (!name || !workspace) return;
    const { data, error } = await supabase.from('tags').insert({ workspace_id: workspace.id, name, color: '#E4A93C' }).select().single();
    if (error || !data) { toast(error?.message ?? "Couldn't create tag", 'error'); return; }
    await addTag(data as Tag);
  };
  const removeTag = async (tag: Tag) => {
    const { error } = await supabase.from('contact_tags').delete().eq('contact_id', contact.id).eq('tag_id', tag.id);
    if (error) { toast(error.message, 'error'); return; }
    await onTagsChanged();
  };

  const available = allTags.filter((t) => !tags.some((x) => x.id === t.id) && t.name.toLowerCase().includes(tagQuery.toLowerCase()));
  const typeLabel = contact.contact_type === 'customer' ? 'Customer' : contact.contact_type === 'lead' ? 'Lead' : null;

  return (
    <Card className="overflow-hidden">
      <div className="bg-navy-800 px-5 pb-5 pt-5 text-white">
        <div className="flex items-start gap-3">
          <Avatar firstName={contact.first_name} lastName={contact.last_name} src={contact.avatar_url} size="lg" className="ring-2 ring-gold-400/60" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{getFullName(contact)}</h1>
            <p className="truncate text-sm text-ivory-300">{[contact.job_title, contact.company].filter(Boolean).join(' · ') || 'No company'}</p>
            {typeLabel && <span className="mt-1.5 inline-block rounded-full bg-gold-400 px-2 py-0.5 text-[11px] font-semibold text-navy-900">{typeLabel}</span>}
          </div>
          <button onClick={onDelete} aria-label="Delete contact" title="Delete contact" className="rounded-lg p-1.5 text-ivory-300 hover:bg-white/10 hover:text-white">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <QuickAction href={contact.phone ? `tel:${contact.phone.replace(/\s/g, '')}` : undefined} icon={Phone} label="Call" />
          <QuickAction href={contact.email ? `mailto:${contact.email}` : undefined} icon={Mail} label="Email" />
          <QuickAction onClick={contact.email || contact.phone ? () => copy(contact.email || contact.phone || '') : undefined} icon={Copy} label="Copy" />
        </div>
      </div>

      <div className="space-y-4 p-5">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-ivory-600">Owner</span>
          <div className="relative mt-1.5">
            <select
              className="input-field appearance-none pr-9"
              value={contact.owner_id ?? ''}
              onChange={(e) => onUpdate({ owner_id: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
          </div>
        </label>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-ivory-600">Tags</span>
            <button onClick={() => setTagOpen((v) => !v)} aria-label="Add tag" className="rounded-md p-1 text-gold-700 hover:bg-ivory-50"><Plus className="h-4 w-4" /></button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.length === 0 && <span className="text-sm text-ivory-500">No tags yet</span>}
            {tags.map((t) => (
              <span key={t.id} className="group inline-flex items-center">
                <TagPill name={t.name} color={t.color} />
                <button onClick={() => removeTag(t)} aria-label={`Remove tag ${t.name}`} className="-ml-1 rounded-full p-0.5 text-ivory-400 opacity-0 hover:text-burgundy-600 group-hover:opacity-100 focus:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          {tagOpen && (
            <div className="mt-2 rounded-xl border border-navy-100 bg-white p-2 shadow-sm">
              <input
                autoFocus
                value={tagQuery}
                onChange={(e) => setTagQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (available[0]) addTag(available[0]); else createTag(); } }}
                placeholder="Search or create a tag"
                className="w-full rounded-lg border border-navy-100 px-2.5 py-1.5 text-sm outline-none focus:border-gold-400"
              />
              <div className="mt-1 max-h-40 overflow-y-auto">
                {available.map((t) => (
                  <button key={t.id} onClick={() => addTag(t)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-navy-700 hover:bg-ivory-50">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} /> {t.name}
                  </button>
                ))}
                {tagQuery.trim() && !allTags.some((t) => t.name.toLowerCase() === tagQuery.trim().toLowerCase()) && (
                  <button onClick={createTag} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-gold-700 hover:bg-ivory-50">
                    <Plus className="h-3.5 w-3.5" /> Create “{tagQuery.trim()}”
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function QuickAction({ href, onClick, icon: Icon, label }: { href?: string; onClick?: () => void; icon: ComponentType<{ className?: string }>; label: string }) {
  const cls = 'flex flex-col items-center gap-1 rounded-xl bg-white/10 py-2 text-xs font-medium text-white transition hover:bg-white/20';
  if (href) return <a href={href} className={cls}><Icon className="h-4 w-4 text-gold-400" />{label}</a>;
  return (
    <button onClick={onClick} disabled={!onClick} className={cn(cls, !onClick && 'cursor-not-allowed opacity-40')}>
      <Icon className="h-4 w-4 text-gold-400" />{label}
    </button>
  );
}

const DETAIL_KEYS = ['contact_type', 'timezone', 'phone_type'];

function FieldsPanel({ contact, onUpdate }: { contact: ContactRow; onUpdate: (patch: Record<string, unknown>, detailKeys?: string[]) => Promise<boolean> }) {
  const [tab, setTab] = useState<'details' | 'dnd'>('details');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const blank = () => ({
    first_name: contact.first_name ?? '',
    last_name: contact.last_name ?? '',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    company: contact.company ?? '',
    job_title: contact.job_title ?? '',
    contact_type: contact.contact_type ?? '',
    timezone: contact.timezone ?? '',
  });
  const [form, setForm] = useState(blank);

  const startEdit = () => { setForm(blank()); setEditing(true); };
  const save = async () => {
    setSaving(true);
    const ok = await onUpdate({
      first_name: form.first_name.trim() || null,
      last_name: form.last_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      company: form.company.trim() || null,
      job_title: form.job_title.trim() || null,
      contact_type: form.contact_type || null,
      timezone: form.timezone || null,
    }, DETAIL_KEYS);
    setSaving(false);
    if (ok) setEditing(false);
  };

  const fields: { key: string; label: string; value: ReactNode; edit?: ReactNode }[] = [
    { key: 'first_name', label: 'First name', value: contact.first_name, edit: <input className="input-field" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /> },
    { key: 'last_name', label: 'Last name', value: contact.last_name, edit: <input className="input-field" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /> },
    {
      key: 'email', label: 'Email',
      value: contact.email && (
        <span className="block">
          {contact.email}
          {(contact.additional_emails ?? []).map((e) => <span key={e} className="block text-sm text-ivory-600">{e}</span>)}
        </span>
      ),
      edit: <input type="email" className="input-field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />,
    },
    {
      key: 'phone', label: 'Phone',
      value: contact.phone && (
        <span className="block">
          {contact.phone}{contact.phone_type && <span className="ml-2 text-xs capitalize text-ivory-500">{contact.phone_type}</span>}
          {(contact.additional_phones ?? []).map((p) => <span key={p.number} className="block text-sm text-ivory-600">{p.number} <span className="text-xs capitalize text-ivory-500">{p.type}</span></span>)}
        </span>
      ),
      edit: <input type="tel" className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />,
    },
    { key: 'company', label: 'Company', value: contact.company, edit: <input className="input-field" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /> },
    { key: 'job_title', label: 'Job title', value: contact.job_title, edit: <input className="input-field" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} /> },
    {
      key: 'contact_type', label: 'Contact type',
      value: contact.contact_type ? (contact.contact_type === 'lead' ? 'Lead' : 'Customer') : null,
      edit: (
        <select className="input-field" value={form.contact_type} onChange={(e) => setForm({ ...form, contact_type: e.target.value })}>
          <option value="">Not set</option><option value="lead">Lead</option><option value="customer">Customer</option>
        </select>
      ),
    },
    { key: 'timezone', label: 'Time zone', value: contact.timezone, edit: <TimezoneSelect value={form.timezone} onChange={(tz) => setForm({ ...form, timezone: tz })} /> },
    { key: 'source', label: 'Contact source', value: contact.source },
    { key: 'created', label: 'Created', value: `${formatDate(contact.created_at)} · ${formatTime(contact.created_at)}` },
  ];
  const q = query.trim().toLowerCase();
  const shown = fields.filter((f) => !q || f.label.toLowerCase().includes(q));

  return (
    <Card>
      <div className="grid grid-cols-2 border-b border-navy-100 p-1" role="tablist">
        {([['details', 'Details'], ['dnd', 'Do not disturb']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('rounded-lg py-2 text-sm font-semibold transition', tab === k ? 'bg-ivory-100 text-navy-800' : 'text-ivory-600 hover:text-navy-700')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'details' ? (
        <div className="p-4">
          <div className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2 rounded-lg border border-navy-100 px-2.5 py-1.5">
              <Search className="h-4 w-4 text-ivory-500" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search fields" aria-label="Search fields" className="w-full bg-transparent text-sm outline-none placeholder:text-ivory-500" />
            </label>
            {!editing && <button onClick={startEdit} className="btn-secondary btn-sm">Edit</button>}
          </div>
          <dl className="mt-3 divide-y divide-navy-50">
            {shown.map((f) => (
              <div key={f.key} className="py-2.5">
                <dt className="text-xs font-medium text-ivory-600">{f.label}</dt>
                <dd className="mt-1 text-sm font-medium text-navy-800">
                  {editing && f.edit ? f.edit : (f.value || <span className="text-ivory-400">—</span>)}
                </dd>
              </div>
            ))}
            {shown.length === 0 && <p className="py-4 text-center text-sm text-ivory-500">No fields match “{query}”.</p>}
          </dl>
          {editing && (
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setEditing(false)} className="btn-secondary btn-sm">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary btn-sm">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          )}
        </div>
      ) : (
        <DndPanel contact={contact} onUpdate={onUpdate} />
      )}
    </Card>
  );
}

function DndPanel({ contact, onUpdate }: { contact: ContactRow; onUpdate: (patch: Record<string, unknown>, detailKeys?: string[]) => Promise<boolean> }) {
  const channels = contact.dnd_channels ?? [];
  const apply = (dnd_all: boolean, dnd_channels: DndChannel[]) => onUpdate({
    dnd_all,
    dnd_channels,
    email_opt_in: !(dnd_all || dnd_channels.includes('email')),
    sms_opt_in: !(dnd_all || dnd_channels.includes('sms')),
  }, ['dnd_all', 'dnd_channels']);

  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-ivory-600">Stop messages to this contact on some or all channels.</p>
      <label className="flex items-center gap-3 rounded-xl border border-navy-100 p-3 text-sm font-semibold text-navy-800">
        <input type="checkbox" checked={!!contact.dnd_all} onChange={(e) => apply(e.target.checked, e.target.checked ? DND_CHANNELS.map((c) => c.value) : [])} className="h-4 w-4 accent-navy-800" />
        Do not disturb on all channels
      </label>
      <div className="space-y-2">
        {DND_CHANNELS.map(({ value, label, icon: Icon }) => (
          <label key={value} className="flex items-center gap-3 px-1 text-sm text-navy-700">
            <input
              type="checkbox"
              checked={!!contact.dnd_all || channels.includes(value)}
              onChange={(e) => {
                const next = e.target.checked ? [...new Set([...channels, value])] : channels.filter((c) => c !== value);
                apply(next.length === DND_CHANNELS.length, next);
              }}
              className="h-4 w-4 accent-navy-800"
            />
            <Icon className="h-4 w-4 text-ivory-600" /> {label}
          </label>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// CENTER COLUMN
// ============================================================

function Snapshot({ contact, appointments, messages, submissions, onBook }: {
  contact: ContactRow; appointments: ApptRow[]; messages: MessageRow[]; submissions: SubmissionRow[]; onBook: () => void;
}) {
  const now = Date.now();
  const next = [...appointments]
    .filter((a) => new Date(a.start_time).getTime() > now && a.status !== 'cancelled')
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0];
  const past = appointments.filter((a) => new Date(a.start_time).getTime() <= now && a.status !== 'cancelled');
  const kept = past.filter((a) => a.status !== 'no_show').length;
  const lastOutbound = [...messages].reverse().find((m) => (m.direction ?? 'outbound') === 'outbound');

  return (
    <section className="overflow-hidden rounded-2xl bg-navy-800 text-white">
      <div className="flex items-center gap-2 px-5 pt-4 text-xs font-semibold uppercase tracking-wider text-gold-400">
        <Sparkles className="h-3.5 w-3.5" /> Relationship snapshot
      </div>
      <div className="grid grid-cols-3 gap-px bg-white/10">
        <div className="col-span-3 bg-navy-800 px-5 pb-4 pt-3">
          <p className="text-xs text-ivory-300">Next appointment</p>
          {next ? (
            <>
              <p className="mt-1 text-base font-semibold">{formatDate(next.start_time, { weekday: 'short', day: 'numeric', month: 'short' })} · {formatTime(next.start_time)}</p>
              <p className="truncate text-sm text-ivory-300">{next.calendars?.name ?? next.title} · <span className="capitalize">{next.status}</span></p>
            </>
          ) : (
            <>
              <p className="mt-1 text-base font-semibold">None booked</p>
              <button onClick={onBook} className="mt-1 text-sm font-semibold text-gold-400 hover:text-gold-300">Book one →</button>
            </>
          )}
        </div>
        <SnapshotStat label="Appointments kept" value={past.length ? `${kept} of ${past.length}` : '—'} />
        <SnapshotStat label="Last contacted" value={lastOutbound ? timeAgo(lastOutbound.created_at) : 'Never'} sub={lastOutbound ? (lastOutbound.channel === 'email' ? 'by email' : 'by text') : undefined} />
        <SnapshotStat label="Forms submitted" value={String(submissions.length)} sub={contact.source ? `via ${contact.source}` : undefined} />
      </div>
    </section>
  );
}

function SnapshotStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 bg-navy-800 px-5 py-4">
      <p className="text-xs text-ivory-300">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
      {sub && <p className="truncate text-xs text-ivory-400">{sub}</p>}
    </div>
  );
}

type ThreadItem =
  | { kind: 'message'; at: string; m: MessageRow }
  | { kind: 'note'; at: string; n: NoteRow };

function ThreadPanel({ contact, messages, notes, onSent }: { contact: ContactRow; messages: MessageRow[]; notes: NoteRow[]; onSent: () => Promise<void> }) {
  const threadRef = useRef<HTMLDivElement>(null);

  const items: ThreadItem[] = useMemo(() => [
    ...messages.map((m) => ({ kind: 'message' as const, at: m.created_at, m })),
    ...notes.map((n) => ({ kind: 'note' as const, at: n.created_at, n })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()), [messages, notes]);

  // Keep the newest message in view by scrolling the thread box itself, not the page.
  useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [items.length]);

  return (
    <Card className="flex min-h-[520px] flex-col">
      <div className="flex items-center justify-between border-b border-navy-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-navy-800">Conversation &amp; notes</h2>
          <p className="text-xs text-ivory-600">Messages and internal notes in one thread</p>
        </div>
        <span className="text-xs text-ivory-500">{messages.length} messages · {notes.length} notes</span>
      </div>

      <div ref={threadRef} className="max-h-[52vh] min-h-[280px] flex-1 space-y-3 overflow-y-auto bg-ivory-50/60 px-5 py-4">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
            <MessageSquare className="h-8 w-8 text-ivory-400" />
            <p className="mt-2 text-sm font-semibold text-navy-800">Nothing here yet</p>
            <p className="text-sm text-ivory-600">Send an email or text, or leave a note for your team.</p>
          </div>
        ) : items.map((it) => it.kind === 'note' ? (
          <div key={`n-${it.n.id}`} className="mx-auto max-w-[88%] rounded-xl border border-gold-200 bg-gold-50 px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gold-800"><StickyNote className="h-3.5 w-3.5" /> Internal note</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-navy-800">{it.n.content}</p>
            <p className="mt-1 text-[11px] text-ivory-600">{formatDate(it.at)} · {formatTime(it.at)}</p>
          </div>
        ) : (
          <div key={`m-${it.m.id}`} className={cn('flex', (it.m.direction ?? 'outbound') === 'outbound' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[78%] rounded-2xl px-4 py-2.5', (it.m.direction ?? 'outbound') === 'outbound' ? 'rounded-br-md bg-navy-800 text-white' : 'rounded-bl-md border border-navy-100 bg-white text-navy-800')}>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-70">
                {it.m.channel === 'email' ? <Mail className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}{it.m.channel === 'email' ? 'Email' : 'SMS'}
              </p>
              {it.m.subject && <p className="mt-1 text-sm font-semibold">{it.m.subject}</p>}
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{it.m.body}</p>
              <p className="mt-1 text-[11px] opacity-60">{formatTime(it.at)} · <span className="capitalize">{it.m.status}</span></p>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-navy-100">
        <MessageComposer contact={contact} onSent={onSent} />
      </div>
    </Card>
  );
}

// ============================================================
// RIGHT COLUMN
// ============================================================

interface JourneyEvent { id: string; at: string; icon: ComponentType<{ className?: string }>; tone: string; title: string; detail?: string }

function JourneyPanel({ contact, appointments, messages, notes, submissions }: {
  contact: ContactRow; appointments: ApptRow[]; messages: MessageRow[]; notes: NoteRow[]; submissions: SubmissionRow[];
}) {
  const events: JourneyEvent[] = [
    { id: 'created', at: contact.created_at, icon: UserPlus, tone: 'bg-navy-100 text-navy-700', title: 'Became a contact', detail: contact.source ? `Source: ${contact.source}` : undefined },
    ...submissions.map((s) => ({ id: `s-${s.id}`, at: s.created_at, icon: FileText, tone: 'bg-blue-50 text-blue-700', title: 'Submitted a form', detail: s.forms?.name ?? undefined })),
    ...appointments.map((a) => ({ id: `a-${a.id}`, at: a.created_at, icon: Calendar, tone: 'bg-gold-50 text-gold-800', title: 'Booked an appointment', detail: `${a.calendars?.name ?? a.title} · ${formatDate(a.start_time, { day: 'numeric', month: 'short' })} ${formatTime(a.start_time)}` })),
    ...appointments.filter((a) => a.status === 'completed' || a.status === 'no_show' || a.status === 'cancelled').map((a) => ({
      id: `a2-${a.id}`, at: a.status === 'cancelled' ? a.created_at : a.end_time,
      icon: a.status === 'completed' ? CalendarCheck : CalendarX,
      tone: a.status === 'completed' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-burgundy-600',
      title: a.status === 'completed' ? 'Attended appointment' : a.status === 'no_show' ? 'Missed appointment' : 'Cancelled appointment',
      detail: a.calendars?.name ?? a.title,
    })),
    ...messages.map((m) => ({ id: `m-${m.id}`, at: m.created_at, icon: m.channel === 'email' ? Mail : MessageSquare, tone: 'bg-ivory-100 text-navy-700', title: `${(m.direction ?? 'outbound') === 'outbound' ? 'Sent' : 'Received'} ${m.channel === 'email' ? 'an email' : 'a text'}`, detail: m.subject ?? m.body?.slice(0, 60) ?? undefined })),
    ...notes.map((n) => ({ id: `n-${n.id}`, at: n.created_at, icon: StickyNote, tone: 'bg-gold-50 text-gold-800', title: 'Note added', detail: n.content.slice(0, 60) })),
  ].filter((e) => new Date(e.at).getTime() <= Date.now() + 60_000)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const groups: { day: string; items: JourneyEvent[] }[] = [];
  for (const e of events) {
    const day = formatDate(e.at, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(e); else groups.push({ day, items: [e] });
  }

  return (
    <Card className="flex flex-col xl:max-h-[calc(100vh-9rem)]">
      <div className="border-b border-navy-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-navy-800">Journey</h2>
        <p className="text-xs text-ivory-600">Everything that's happened with {contact.first_name || 'this contact'}</p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {groups.map((g) => (
          <div key={g.day} className="mb-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ivory-500">{g.day}</p>
            <ol className="relative space-y-3 border-l border-navy-100 pl-5">
              {g.items.map(({ id, at, icon: Icon, tone, title, detail }) => (
                <li key={id} className="relative">
                  <span className={cn('absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white', tone)}><Icon className="h-3.5 w-3.5" /></span>
                  <p className="text-sm font-medium text-navy-800">{title}</p>
                  {detail && <p className="truncate text-xs text-ivory-600">{detail}</p>}
                  <p className="text-[11px] text-ivory-500"><Clock className="mr-1 inline h-3 w-3" />{formatTime(at)}</p>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <div className="space-y-1 border-t border-navy-100 px-5 py-3 text-xs text-ivory-600">
        <p className="flex items-center gap-1.5"><Globe2 className="h-3.5 w-3.5" /> Source: <span className="font-medium text-navy-800">{contact.source || 'Unknown'}</span></p>
        {contact.company && <p className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> {contact.company}</p>}
      </div>
    </Card>
  );
}
