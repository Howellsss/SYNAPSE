import { useEffect, useState, useCallback, type ComponentType } from 'react';
import {
  Users, Plus, Search, Download, Upload, Tag, Mail,
  Trash2, Filter, ChevronLeft, ChevronRight, Calendar, MessageCircle, CheckCircle2, UserRound, Globe2, Star, SlidersHorizontal, ListFilter, ClipboardList,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Avatar } from '@/components/ui/Avatar';
import { TagPill } from '@/components/ui/StatusPills';
import { Modal } from '@/components/ui/Modal';
import { AddContactModal } from '@/components/contacts/AddContactModal';
import { useRouter } from '@/lib/router';
import { saveContactNav } from '@/lib/contact-nav';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, Skeleton, ErrorState } from '@/components/ui/States';
import { getFullName, formatDate, timeAgo, downloadCSV, parseCSV, cn } from '@/lib/utils';
import type { Contact, Tag as TagType, SmartList } from '@/types';

const PAGE_SIZE = 10;

export function ContactsPage() {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [contacts, setContacts] = useState<(Contact & { tags: TagType[] })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBulkEmail, setShowBulkEmail] = useState(false);
  const [showBulkSMS, setShowBulkSMS] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [tags, setTags] = useState<TagType[]>([]);
  const [smartLists, setSmartLists] = useState<SmartList[]>([]);
  const [activeSmartList, setActiveSmartList] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'all' | 'smart' | 'tags'>('all');
  const [newThisMonth, setNewThisMonth] = useState(0);
  const [withAppointments, setWithAppointments] = useState(0);

  const [, navigate] = useRouter();

  const openContact = (id: string) => {
    saveContactNav({ ids: contacts.map((c) => c.id), offset: page * PAGE_SIZE, total });
    navigate(`/contacts/${id}`);
  };

  const loadContacts = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    setLoading(true);
    setError(false);

    let query = supabase
      .from('contacts')
      .select('*, contact_tags(tag_id, tags(*))', { count: 'exact' })
      .eq('workspace_id', workspace.id);

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    if (activeTag) {
      query = query.filter('contact_tags.tag_id', 'eq', activeTag);
    }

    if (activeSmartList) {
      const smartList = smartLists.find((sl) => sl.id === activeSmartList);
      if (smartList?.rules) {
        for (const rule of smartList.rules) {
          if (rule.operator === 'equals') {
            query = query.eq(rule.field, rule.value);
          } else if (rule.operator === 'contains') {
            query = query.ilike(rule.field, `%${rule.value}%`);
          } else if (rule.operator === 'not_equals') {
            query = query.neq(rule.field, rule.value);
          }
        }
      }
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      setError(true);
      setLoading(false);
      return;
    }

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [monthResult, appointmentsResult] = await Promise.all([
      supabase
        .from('contacts')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id)
        .gte('created_at', monthStart.toISOString()),
      supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id),
    ]);

    const formatted = (data ?? []).map((c) => ({
      ...c,
      tags: (c as unknown as { contact_tags: { tags: TagType }[] }).contact_tags?.map((ct) => ct.tags) ?? [],
    }));

    setNewThisMonth(monthResult.count ?? 0);
    setWithAppointments(appointmentsResult.count ?? 0);
    setContacts(formatted);
    setTotal(count ?? 0);
    setLoading(false);
  }, [workspace, search, page, activeSmartList, activeTag, smartLists]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    if (!workspace) return;
    supabase.from('tags').select('*').eq('workspace_id', workspace.id).then(({ data }) => setTags(data ?? []));
    supabase
      .from('smart_lists')
      .select('*')
      .eq('workspace_id', workspace.id)
      .then(({ data }) => setSmartLists(data ?? []));
  }, [workspace]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map((c) => c.id)));
    }
  };

  const handleExport = (type: 'all' | 'selected' | 'filtered') => {
    let rows: Record<string, unknown>[] = [];
    if (type === 'selected') {
      rows = contacts
        .filter((c) => selectedIds.has(c.id))
        .map((c) => ({
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          phone: c.phone,
          company: c.company,
          source: c.source,
          created_at: c.created_at,
        }));
    } else {
      rows = contacts.map((c) => ({
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        phone: c.phone,
        company: c.company,
        source: c.source,
        created_at: c.created_at,
      }));
    }
    downloadCSV('synapse-contacts.csv', rows);
    toast(`Exported ${rows.length} contacts`);
  };

  const handleDeleteSelected = async () => {
    if (!workspace) return;
    await supabase.from('contacts').delete().in('id', [...selectedIds]);
    setSelectedIds(new Set());
    setDeleteConfirm(false);
    toast('Contacts deleted');
    loadContacts();
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6 pb-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-[24px] leading-tight font-bold tracking-[-0.02em] text-navy-800 sm:text-[24px]">Contacts</h1>
          <p className="mt-1 text-[15px] text-ivory-700">Manage your contacts, clients, and relationships.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowAddModal(true)} className="flex h-[38px] items-center gap-1.5 rounded-lg bg-navy-800 px-4 text-sm font-semibold text-white transition hover:bg-navy-700"><Plus className="h-4 w-4" /> Add Contact</button>
          <button onClick={() => setShowImportModal(true)} className="flex h-[38px] items-center gap-1.5 rounded-lg bg-white ring-1 ring-inset ring-navy-100 px-4 text-sm font-semibold text-navy-800 transition hover:bg-navy-50"><Upload className="h-4 w-4" /> Import</button>
          <button onClick={() => handleExport('all')} className="flex h-[38px] items-center gap-1.5 rounded-lg bg-white ring-1 ring-inset ring-navy-100 px-4 text-sm font-semibold text-navy-800 transition hover:bg-navy-50"><Download className="h-4 w-4" /> Export</button>
        </div>
      </section>

      <section className="card grid grid-cols-2 gap-px overflow-hidden bg-sand xl:grid-cols-4">
        <ContactMetric label="Total Contacts" value={total} icon={Users} tone="gold" />
        <ContactMetric label="New This Month" value={newThisMonth} icon={UserRound} tone="gold" />
        <ContactMetric label="Active" value={total} icon={CheckCircle2} tone="green" />
        <ContactMetric label="With Appointments" value={withAppointments} icon={Calendar} tone="gold" />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[196px_minmax(0,1fr)]">
        <aside className="flex h-fit flex-col rounded-xl bg-white ring-1 ring-inset ring-navy-100 p-3">
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <p className="text-[13px] font-semibold text-ivory-700">Smart Lists</p>
            <button onClick={() => toast('Smart list creation is coming soon')} aria-label="New smart list" className="flex h-7 w-7 items-center justify-center rounded-full text-navy-700 hover:bg-navy-50"><Plus className="h-4 w-4" /></button>
          </div>
          <div className="space-y-1">
            <ContactListButton icon={UserRound} label="All Leads" count={total} active={activeView === 'all' && !activeSmartList && !activeTag} onClick={() => { setActiveView('all'); setActiveSmartList(null); setActiveTag(null); }} />
            <ContactListButton icon={Globe2} label="Website Leads" count={undefined} active={activeSmartList === smartLists[0]?.id} onClick={() => { setActiveView('smart'); if (smartLists[0]) { setActiveSmartList(smartLists[0].id); setActiveTag(null); } }} />
            <ContactListButton icon={Users} label="Clients" count={undefined} active={false} onClick={() => toast('Client smart list is ready to configure')} />
            <ContactListButton icon={Star} label="VIP Contacts" count={undefined} active={false} onClick={() => toast('VIP smart list is ready to configure')} />
            <ContactListButton icon={Calendar} label="Booked an Appointment" count={withAppointments} active={false} onClick={() => toast('Appointment filter selected')} />
            <ContactListButton icon={ClipboardList} label="Submitted Intake Form" count={undefined} active={false} onClick={() => toast('Form filter selected')} />
          </div>
          <div className="mt-5 rounded-2xl bg-white p-4">
            <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-gold-100 text-gold-700"><Star className="h-4 w-4" /></div>
            <p className="text-xs font-semibold leading-relaxed text-navy-700">Smart lists help you segment and automate outreach efficiently.</p>
            <button onClick={() => toast('Smart lists organize contacts by rules and activity')} className="mt-3 text-xs font-semibold text-gold-700 hover:text-gold-600">Learn more <span className="ml-1">→</span></button>
          </div>
        </aside>

        <div className="card min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand px-4 py-3">
            <div role="tablist" aria-label="Show" className="flex rounded-[10px] bg-white ring-1 ring-inset ring-navy-100 p-[3px]">
              {(['all', 'smart', 'tags'] as const).map((view) => (
                <button key={view} role="tab" aria-selected={activeView === view} onClick={() => setActiveView(view)} className={cn('h-8 rounded-lg px-4 text-[13px] transition-all duration-200', activeView === view ? 'bg-navy-800 font-semibold text-white' : 'font-medium text-navy-700 hover:text-navy-900')}>
                  {view === 'all' ? 'All Contacts' : view === 'smart' ? 'Smart Lists' : 'Tags'}
                </button>
              ))}
            </div>
            <button aria-label="Table settings" className="hidden h-9 w-9 items-center justify-center rounded-lg text-navy-700 hover:bg-navy-50 sm:flex"><SlidersHorizontal className="h-4 w-4" /></button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-sand px-4 py-3">
            <label className="relative min-w-[220px] flex-1 sm:flex-none">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-700" />
              <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search contacts" aria-label="Search contacts" className="h-9 w-full rounded-[10px] border border-navy-100 bg-white pl-9 pr-3 text-sm text-navy-800 outline-none placeholder:text-ivory-700 focus:border-gold-400 focus:bg-white" />
            </label>
            {[
              [Filter, 'Filter'], [Tag, 'Tags'], [Globe2, 'Source'], [CheckCircle2, 'Status'], [Calendar, 'Appointments'], [ListFilter, 'More filters'],
            ].map(([Icon, label]) => {
              const I = Icon as typeof Filter;
              return <button key={label as string} className="flex h-9 items-center gap-1.5 rounded-lg bg-white ring-1 ring-inset ring-navy-100 px-3.5 text-[13px] font-medium text-navy-800 transition hover:bg-navy-50"><I className="h-3.5 w-3.5" /> {label as string}</button>;
            })}
            <button onClick={() => handleExport('all')} className="flex h-9 items-center gap-1.5 rounded-lg bg-white ring-1 ring-inset ring-navy-100 px-3.5 text-[13px] font-medium text-navy-800 transition hover:bg-navy-50 sm:ml-auto"><Upload className="h-3.5 w-3.5" /> Export</button>
          </div>
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-gold-100 bg-gold-50/60 px-4 py-2.5">
              <span className="mr-1 text-xs font-semibold text-navy-700">{selectedIds.size} selected</span>
              <button onClick={() => toast('Select a tag to add')} className="btn-secondary btn-sm"><Tag className="h-3.5 w-3.5" /> Add Tag</button>
              <button onClick={() => toast('Tag removal ready')} className="btn-secondary btn-sm"><Tag className="h-3.5 w-3.5" /> Remove Tag</button>
              <button onClick={() => setShowBulkEmail(true)} className="btn-secondary btn-sm"><Mail className="h-3.5 w-3.5" /> Email</button>
              <button onClick={() => setShowBulkSMS(true)} className="btn-secondary btn-sm"><MessageCircle className="h-3.5 w-3.5" /> SMS</button>
              <button onClick={() => handleExport('selected')} className="btn-secondary btn-sm"><Download className="h-3.5 w-3.5" /> Export</button>
              <button onClick={() => setDeleteConfirm(true)} className="btn-secondary btn-sm text-burgundy-500"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
            </div>
          )}

          {/* Contacts table */}
          <div>
        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message="We couldn't load your contacts. Please try again." onRetry={loadContacts} />
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={<Users className="w-7 h-7" />}
            title="No contacts yet"
            description="Add your first contact or import a CSV to get started."
            action={
              <button onClick={() => setShowAddModal(true)} className="btn-primary">
                <Plus className="w-4 h-4" />
                Add Contact
              </button>
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-sand">
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === contacts.length && contacts.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-navy-300 text-gold-500 focus:ring-gold-400"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-[13px] font-medium text-ivory-700">Name</th>
                    <th className="px-4 py-3 text-left text-[13px] font-medium text-ivory-700">Email</th>
                    <th className="px-4 py-3 text-left text-[13px] font-medium text-ivory-700">Phone</th>
                    <th className="px-4 py-3 text-left text-[13px] font-medium text-ivory-700">Tags</th>
                    <th className="px-4 py-3 text-left text-[13px] font-medium text-ivory-700">Source</th>
                    <th className="px-4 py-3 text-left text-[13px] font-medium text-ivory-700">Last Activity</th>
                    <th className="px-4 py-3 text-left text-[13px] font-medium text-ivory-700">Created</th>
                    <th className="px-4 py-3 text-left text-[13px] font-medium text-ivory-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr
                      key={contact.id}
                      className="border-b border-sand last:border-0 hover:bg-navy-50 transition-colors cursor-pointer"
                      onClick={() => openContact(contact.id)}
                    >
                      <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(contact.id)}
                          onChange={() => toggleSelect(contact.id)}
                          className="rounded border-navy-300 text-gold-500 focus:ring-gold-400"
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar firstName={contact.first_name} lastName={contact.last_name} src={contact.avatar_url} size="sm" />
                          <span className="text-[15px] font-semibold text-navy-800">{getFullName(contact)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm text-ivory-600">{contact.email || '—'}</td>
                      <td className="px-4 py-3.5 text-sm text-ivory-600">{contact.phone || '—'}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {contact.tags.slice(0, 3).map((tag) => (
                            <TagPill key={tag.id} name={tag.name} color={tag.color} />
                          ))}
                          {contact.tags.length > 3 && (
                            <span className="text-xs text-ivory-500">+{contact.tags.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm text-ivory-600 capitalize">{contact.source}</td>
                      <td className="px-4 py-3.5 text-sm text-ivory-600"><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-green-600" />{timeAgo(contact.last_activity_at)}</span></td>
                      <td className="px-4 py-3.5 text-sm text-ivory-600">{formatDate(contact.created_at)}</td>
                      <td className="px-4 py-3.5"><span className="inline-flex items-center gap-1.5 rounded-md bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700"><span className="h-1.5 w-1.5 rounded-full bg-green-600" />Active</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-sand">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="p-4 hover:bg-ivory-50 transition-colors cursor-pointer"
                  onClick={() => openContact(contact.id)}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(contact.id)}
                      onChange={() => toggleSelect(contact.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-navy-300 text-gold-500"
                    />
                    <Avatar firstName={contact.first_name} lastName={contact.last_name} src={contact.avatar_url} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-navy-700">{getFullName(contact)}</p>
                      <p className="text-xs text-ivory-600 truncate">{contact.email || contact.phone || '—'}</p>
                    </div>
                    {contact.tags[0] && <TagPill name={contact.tags[0].name} color={contact.tags[0].color} />}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-navy-100">
                <p className="text-sm text-ivory-600">
                  Page {page + 1} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="btn-secondary btn-sm disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="btn-secondary btn-sm disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
          </div>
        </div>
      </section>

      {/* Add Contact Modal */}
      {showAddModal && (
        <AddContactModal
          onClose={() => setShowAddModal(false)}
          onAdded={(keepOpen) => { if (!keepOpen) setShowAddModal(false); loadContacts(); }}
        />
      )}

      {/* Import Modal */}
      {showImportModal && (
        <ImportModal
          tags={tags}
          onClose={() => setShowImportModal(false)}
          onImported={() => { setShowImportModal(false); loadContacts(); }}
        />
      )}

      {/* Bulk Email */}
      {showBulkEmail && (
        <BulkMessageModal
          channel="email"
          count={selectedIds.size}
          onClose={() => setShowBulkEmail(false)}
          onSend={async (subject, body) => {
            if (!workspace) return;
            for (const id of selectedIds) {
              await supabase.from('messages').insert({
                workspace_id: workspace.id,
                contact_id: id,
                channel: 'email',
                subject,
                body,
                status: 'queued',
              });
            }
            toast(`Email queued for ${selectedIds.size} contacts`);
            setShowBulkEmail(false);
            setSelectedIds(new Set());
          }}
        />
      )}

      {/* Bulk SMS */}
      {showBulkSMS && (
        <BulkMessageModal
          channel="sms"
          count={selectedIds.size}
          onClose={() => setShowBulkSMS(false)}
          onSend={async (_subject, body) => {
            if (!workspace) return;
            for (const id of selectedIds) {
              await supabase.from('messages').insert({
                workspace_id: workspace.id,
                contact_id: id,
                channel: 'sms',
                body,
                status: 'queued',
              });
            }
            toast(`SMS queued for ${selectedIds.size} contacts`);
            setShowBulkSMS(false);
            setSelectedIds(new Set());
          }}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDeleteSelected}
        title="Delete contacts?"
        message={`This will permanently delete ${selectedIds.size} contacts and all associated data. This cannot be undone.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function ContactMetric({ label, value, icon: Icon, tone }: { label: string; value: number; icon: ComponentType<{ className?: string }>; tone: 'gold' | 'green' }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-white px-6 py-5">
      <div>
        <p className="flex items-center gap-1.5 text-[13px] text-ivory-700"><Icon className={cn('h-3.5 w-3.5', tone === 'green' ? 'text-green-700' : 'text-gold-600')} />{label}</p>
        <p className="mt-1 font-display text-[32px] leading-none font-bold tracking-[-0.03em] tabular-nums text-navy-800">{value.toLocaleString()}</p>
      </div>
    </div>
  );
}

function ContactListButton({ icon: Icon, label, count, active, onClick }: { icon: ComponentType<{ className?: string }>; label: string; count: number | undefined; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-current={active || undefined} className={cn('flex h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left transition-colors', active ? 'bg-navy-800 text-white' : 'text-navy-800 hover:bg-navy-50')}>
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-gold-400' : 'text-ivory-700')} />
      <span className={cn('min-w-0 flex-1 truncate text-[14px]', active ? 'font-semibold' : 'font-medium')}>{label}</span>
      {count !== undefined && <span className={cn('text-[13px] tabular-nums', active ? 'text-ivory-300' : 'text-ivory-700')}>{count.toLocaleString()}</span>}
    </button>
  );
}

// ============================================================
// Contact Profile Drawer
// ============================================================
// ============================================================
// Import Modal
// ============================================================
function ImportModal({ onClose, onImported }: { tags: TagType[]; onClose: () => void; onImported: () => void }) {
  const { workspace, user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'result'>('upload');
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [results, setResults] = useState<{ imported: number; skipped: number; duplicates: number; invalid: number } | null>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const rows = parseCSV(text);
      setCsvData(rows);
      const headers = rows[0];
      const initialMappings: Record<string, string> = {};
      headers.forEach((h) => {
        const lower = h.toLowerCase().trim();
        if (lower.includes('first')) initialMappings[h] = 'first_name';
        else if (lower.includes('last')) initialMappings[h] = 'last_name';
        else if (lower === 'email' || lower.includes('e-mail')) initialMappings[h] = 'email';
        else if (lower === 'phone' || lower.includes('tel')) initialMappings[h] = 'phone';
        else if (lower.includes('company') || lower.includes('org')) initialMappings[h] = 'company';
        else initialMappings[h] = '';
      });
      setMappings(initialMappings);
      setStep('map');
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    if (!workspace) return;
    setStep('preview');
  };

  const confirmImport = async () => {
    if (!workspace || csvData.length < 2) return;
    let imported = 0, skipped = 0, duplicates = 0, invalid = 0;

    const headers = csvData[0];
    for (let i = 1; i < csvData.length; i++) {
      const row = csvData[i];
      const contact: Record<string, string> = {};
      headers.forEach((h, j) => {
        const field = mappings[h];
        if (field) contact[field] = row[j] || '';
      });

      if (!contact.first_name && !contact.last_name && !contact.email) {
        invalid++;
        continue;
      }

      // Check for duplicate by email
      if (contact.email) {
        const { data: existing } = await supabase
          .from('contacts')
          .select('id')
          .eq('workspace_id', workspace.id)
          .eq('email', contact.email)
          .maybeSingle();
        if (existing) {
          duplicates++;
          skipped++;
          continue;
        }
      }

      const { error } = await supabase.from('contacts').insert({
        ...contact,
        workspace_id: workspace.id,
        owner_id: user?.id ?? null,
        source: 'import',
      });

      if (error) {
        invalid++;
      } else {
        imported++;
      }
    }

    setResults({ imported, skipped, duplicates, invalid });
    setStep('result');
    toast(`Imported ${imported} contacts`);
  };

  return (
    <Modal open onClose={onClose} title="Import Contacts" description="Upload a CSV file to import contacts in bulk." size="lg">
      {step === 'upload' && (
        <div className="py-8">
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-navy-200 rounded-2xl py-12 px-6 cursor-pointer hover:border-gold-400 hover:bg-gold-50/30 transition-all">
            <Upload className="w-10 h-10 text-ivory-600 mb-3" />
            <p className="text-sm font-medium text-navy-700">Click to upload CSV</p>
            <p className="text-xs text-ivory-600 mt-1">Max 10MB</p>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
        </div>
      )}

      {step === 'map' && csvData.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-ivory-600">Map your CSV columns to SYNAPSE contact fields:</p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {csvData[0].map((header, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm font-medium text-navy-700 w-40 truncate">{header}</span>
                <span className="text-ivory-400">→</span>
                <select
                  value={mappings[header] || ''}
                  onChange={(e) => setMappings({ ...mappings, [header]: e.target.value })}
                  className="input-field flex-1"
                >
                  <option value="">Skip this column</option>
                  <option value="first_name">First Name</option>
                  <option value="last_name">Last Name</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="company">Company</option>
                </select>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setStep('upload')} className="btn-secondary">Back</button>
            <button onClick={doImport} className="btn-primary">Preview</button>
          </div>
        </div>
      )}

      {step === 'preview' && csvData.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-ivory-600">Preview of {csvData.length - 1} records to import:</p>
          <div className="overflow-x-auto max-h-64 border border-navy-100 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-ivory-50 sticky top-0">
                <tr>
                  {Object.values(mappings).filter(Boolean).map((field, i) => (
                    <th key={i} className="px-3 py-2 text-left text-xs font-semibold text-ivory-600 uppercase">{field}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvData.slice(1, 6).map((row, i) => (
                  <tr key={i} className="border-t border-sand">
                    {csvData[0].map((header, j) => mappings[header] ? (
                      <td key={j} className="px-3 py-2 text-navy-700">{row[j]}</td>
                    ) : null)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ivory-600">Showing first 5 of {csvData.length - 1} records</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setStep('map')} className="btn-secondary">Back</button>
            <button onClick={confirmImport} className="btn-primary">Import {csvData.length - 1} Contacts</button>
          </div>
        </div>
      )}

      {step === 'result' && results && (
        <div className="py-6 space-y-4">
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-navy-800">Import Complete</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ResultStat label="Imported" value={results.imported} color="text-green-600" />
            <ResultStat label="Skipped" value={results.skipped} color="text-amber-600" />
            <ResultStat label="Duplicates" value={results.duplicates} color="text-blue-600" />
            <ResultStat label="Invalid" value={results.invalid} color="text-red-600" />
          </div>
          <div className="flex justify-end">
            <button onClick={onImported} className="btn-primary">Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ResultStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="p-3 rounded-xl bg-ivory-50 border border-sand text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-ivory-600 mt-0.5">{label}</p>
    </div>
  );
}

// ============================================================
// Bulk Message Modal
// ============================================================
function BulkMessageModal({
  channel,
  count,
  onClose,
  onSend,
}: {
  channel: 'email' | 'sms';
  count: number;
  onClose: () => void;
  onSend: (subject: string, body: string) => Promise<void>;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  return (
    <Modal open onClose={onClose} title={`Send Bulk ${channel === 'email' ? 'Email' : 'SMS'}`} description={`Message will be sent to ${count} contacts.`}>
      <div className="space-y-4">
        {channel === 'email' && (
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Subject</label>
            <input className="input-field" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Message</label>
          <textarea className="input-field min-h-[120px] resize-y" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={() => onSend(subject, body)} className="btn-primary" disabled={!body.trim()}>
          Send to {count} Contacts
        </button>
      </div>
    </Modal>
  );
}


