import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  FileText, Plus, Search, Copy, Trash2, Edit, Link2, Eye,
  Archive, MoreVertical, LayoutGrid, List as ListIcon, Clock,
  ChevronDown, CheckSquare, BarChart3,
  Inbox, ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { FormStatusPill } from '@/components/ui/StatusPills';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, Skeleton, ErrorState } from '@/components/ui/States';
import { formatDate, timeAgo, cn } from '@/lib/utils';
import { CreateFormFlow } from '@/components/forms/CreateFormFlow';
import type { Form, FormSubmission, FormUsage, FormStatus, FormUsageModule } from '@/types';

type Tab = 'forms' | 'surveys';
type ViewMode = 'list' | 'grid';
type SortKey = 'recently_updated' | 'recently_created' | 'most_submissions' | 'alphabetical';
type StatusFilter = 'all' | FormStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recently_updated', label: 'Recently updated' },
  { value: 'recently_created', label: 'Recently created' },
  { value: 'most_submissions', label: 'Most submissions' },
  { value: 'alphabetical', label: 'Alphabetical' },
];

const USAGE_MODULE_LABELS: Record<FormUsageModule, string> = {
  calendar: 'Calendar',
  event: 'Event',
  webinar: 'Webinar',
  workflow: 'Workflow',
  landing_page: 'Landing Page',
  external: 'External',
};



type FormWithMeta = Form & { submission_count: number; usages: FormUsage[] };

export function FormsPage() {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('forms');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [forms, setForms] = useState<FormWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('recently_updated');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [renameForm, setRenameForm] = useState<Form | null>(null);
  const [shareForm, setShareForm] = useState<Form | null>(null);
  const [submissionsForm, setSubmissionsForm] = useState<FormWithMeta | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<Form | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<FormWithMeta | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const loadForms = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    setLoading(true);
    setError(false);
    const { data, error: err } = await supabase
      .from('forms')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('updated_at', { ascending: false });

    if (err) { setError(true); setLoading(false); return; }

    const formList = (data ?? []) as Form[];
    if (formList.length === 0) { setForms([]); setLoading(false); return; }

    const [subRes, usageRes] = await Promise.all([
      supabase.rpc('get_form_submission_counts', { form_ids: formList.map(f => f.id) }),
      supabase.from('form_usages').select('*').in('form_id', formList.map(f => f.id)),
    ]);

    const counts: Record<string, number> = {};
    if (subRes.data) {
      for (const row of subRes.data as { form_id: string; count: number }[]) {
        counts[row.form_id] = row.count;
      }
    }

    const usages: Record<string, FormUsage[]> = {};
    if (usageRes.data) {
      for (const u of usageRes.data as FormUsage[]) {
        if (!usages[u.form_id]) usages[u.form_id] = [];
        usages[u.form_id].push(u);
      }
    }

    setForms(formList.map(f => ({
      ...f,
      submission_count: counts[f.id] ?? 0,
      usages: usages[f.id] ?? [],
    })));
    setLoading(false);
  }, [workspace]);

  useEffect(() => { loadForms(); }, [loadForms]);

  useEffect(() => {
    const handleClick = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [openMenuId]);

  const formsForTab = useMemo(() => {
    const filtered = forms.filter(f => {
      if (tab === 'forms' && f.type !== 'form') return false;
      if (tab === 'surveys' && f.type !== 'survey') return false;
      if (statusFilter !== 'all' && f.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!f.name.toLowerCase().includes(q) && !(f.description ?? '').toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const sorted = [...filtered];
    switch (sort) {
      case 'recently_updated': sorted.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()); break;
      case 'recently_created': sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); break;
      case 'most_submissions': sorted.sort((a, b) => b.submission_count - a.submission_count); break;
      case 'alphabetical': sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    return sorted;
  }, [forms, tab, statusFilter, search, sort]);

  const stats = useMemo(() => ({
    total: forms.filter(f => tab === 'forms' ? f.type === 'form' : f.type === 'survey').length,
    active: forms.filter(f => (tab === 'forms' ? f.type === 'form' : f.type === 'survey') && f.status === 'published').length,
    submissions: forms.filter(f => tab === 'forms' ? f.type === 'form' : f.type === 'survey').reduce((sum, f) => sum + f.submission_count, 0),
  }), [forms, tab]);

  const copyLink = (form: Form) => {
    const url = `${window.location.origin}/forms/${form.id}`;
    navigator.clipboard.writeText(url);
    toast('Link copied to clipboard');
  };

  const duplicateForm = async (form: Form) => {
    if (!workspace) return;
    const { data, error: err } = await supabase.from('forms').insert({
      workspace_id: workspace.id,
      name: `${form.name} (Copy)`,
      description: form.description,
      type: form.type,
      status: 'draft',
      success_message: form.success_message,
      owner_id: form.owner_id ?? null,
    }).select().single();
    if (err) { toast(err.message, 'error'); return; }

    const { data: fields } = await supabase.from('form_fields').select('*').eq('form_id', form.id);
    if (fields && fields.length > 0) {
      await supabase.from('form_fields').insert(fields.map(f => ({
        form_id: data.id,
        label: f.label,
        field_type: f.field_type,
        required: f.required,
        placeholder: f.placeholder,
        help_text: f.help_text,
        default_value: f.default_value,
        options: f.options,
        sort_order: f.sort_order,
        mapped_field: f.mapped_field,
      })));
    }
    toast('Form duplicated');
    loadForms();
  };

  const renameFormFn = async (form: Form, newName: string) => {
    if (!newName.trim()) return;
    await supabase.from('forms').update({ name: newName.trim(), updated_at: new Date().toISOString() }).eq('id', form.id);
    toast('Form renamed');
    setRenameForm(null);
    loadForms();
  };

  const archiveForm = async () => {
    if (!archiveConfirm) return;
    await supabase.from('forms').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', archiveConfirm.id);
    toast('Form archived');
    setArchiveConfirm(null);
    loadForms();
  };

  const unarchiveForm = async (form: Form) => {
    await supabase.from('forms').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', form.id);
    toast('Form restored');
    loadForms();
  };

  const toggleStatus = async (form: Form) => {
    const newStatus: FormStatus = form.status === 'published' ? 'inactive' : 'published';
    await supabase.from('forms').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', form.id);
    toast(newStatus === 'published' ? 'Form published' : 'Form deactivated');
    loadForms();
  };

  const deleteForm = async () => {
    if (!deleteConfirm) return;
    await supabase.from('forms').delete().eq('id', deleteConfirm.id);
    toast('Form deleted');
    setDeleteConfirm(null);
    loadForms();
  };

  const handleCreated = (formId: string) => {
    setShowCreate(false);
    loadForms();
    window.location.hash = `/forms/${formId}/edit`;
  };

  const isEmpty = !loading && !error && formsForTab.length === 0;
  const hasNoFormsAtAll = !loading && !error && forms.length === 0;

  return (
    <div className="space-y-6 max-w-7xl" onClick={() => openMenuId && setOpenMenuId(null)}>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em] text-navy-800">
            Submissions
          </h1>
          <p className="mt-1 text-sm text-ivory-700">
            Create, manage and share forms and surveys for collecting information.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCreate(true)} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" />
            Create New
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-navy-100">
        {(['forms', 'surveys'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setStatusFilter('all'); }}
            className={cn(
              'px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px',
              tab === t
                ? 'border-gold-500 text-navy-800'
                : 'border-transparent text-ivory-600 hover:text-navy-700'
            )}
          >
            {t === 'forms' ? 'Forms' : 'Surveys'}
          </button>
        ))}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label={tab === 'forms' ? 'Total Forms' : 'Total Surveys'} value={stats.total} icon={FileText} />
        <StatCard label="Active" value={stats.active} icon={CheckSquare} />
        <StatCard label={tab === 'forms' ? 'Submissions' : 'Responses'} value={stats.submissions} icon={Inbox} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-ivory-600" />
          <input
            className="input-field pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${tab === 'forms' ? 'forms' : 'surveys'}...`}
          />
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-1.5">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                statusFilter === f.value
                  ? 'bg-navy-800 text-ivory-100'
                  : 'bg-white text-ivory-600 border border-navy-100 hover:bg-ivory-50'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setShowSortMenu(!showSortMenu); }}
            className="btn-secondary btn-sm"
          >
            <Clock className="w-3.5 h-3.5" />
            {SORT_OPTIONS.find(o => o.value === sort)?.label}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {showSortMenu && (
            <div
              className="absolute right-0 top-full mt-1 z-20 bg-white rounded-xl border border-navy-100 shadow-popover py-1 min-w-[180px]"
              onClick={(e) => e.stopPropagation()}
            >
              {SORT_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => { setSort(o.value); setShowSortMenu(false); }}
                  className={cn(
                    'w-full text-left px-3 py-2 text-sm transition-colors',
                    sort === o.value ? 'text-gold-700 font-semibold bg-gold-50' : 'text-navy-700 hover:bg-ivory-50'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center rounded-lg border border-navy-100 overflow-hidden">
          <button
            onClick={() => setViewMode('grid')}
            className={cn('p-2 transition-colors', viewMode === 'grid' ? 'bg-navy-800 text-ivory-100' : 'text-ivory-600 hover:bg-ivory-50')}
            title="Grid view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn('p-2 transition-colors', viewMode === 'list' ? 'bg-navy-800 text-ivory-100' : 'text-ivory-600 hover:bg-ivory-50')}
            title="List view"
          >
            <ListIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-44" />)}
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 m-3" />)}
          </div>
        )
      ) : error ? (
        <ErrorState message="We couldn't load your forms. Please try again." onRetry={loadForms} />
      ) : isEmpty ? (
        hasNoFormsAtAll ? (
          <div className="card">
            <EmptyState
              icon={<FileText className="w-7 h-7" />}
              title={tab === 'forms' ? 'Create your first form' : 'Create your first survey'}
              description={tab === 'forms'
                ? 'Build from scratch, start with a template, or let AI help you create one.'
                : 'Build from scratch, start with a template, or let AI help you create one.'}
              action={
                <button onClick={() => setShowCreate(true)} className="btn-primary">
                  <Plus className="w-4 h-4" />
                  {tab === 'forms' ? 'Create Form' : 'Create Survey'}
                </button>
              }
            />
          </div>
        ) : (
          <div className="card">
            <EmptyState
              icon={<FileText className="w-7 h-7" />}
              title="No results found"
              description="Try adjusting your search or filters to find what you're looking for."
              action={
                <button
                  onClick={() => { setSearch(''); setStatusFilter('all'); }}
                  className="btn-secondary"
                >
                  Clear filters
                </button>
              }
            />
          </div>
        )
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {formsForTab.map(form => (
            <FormCard
              key={form.id}
              form={form}
              isSurvey={tab === 'surveys'}
              onEdit={() => { window.location.hash = `/forms/${form.id}/edit`; }}
              onPreview={() => { window.open(`/forms/${form.id}`, '_blank'); }}
              onShare={() => setShareForm(form)}
              onDuplicate={() => duplicateForm(form)}
              onSubmissions={() => setSubmissionsForm(form)}
              onRename={() => setRenameForm(form)}
              onArchive={() => setArchiveConfirm(form)}
              onUnarchive={() => unarchiveForm(form)}
              onToggleStatus={() => toggleStatus(form)}
              onDelete={() => setDeleteConfirm(form)}
              menuOpen={openMenuId === form.id}
              onMenuToggle={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === form.id ? null : form.id); }}
            />
          ))}
        </div>
      ) : (
        <FormList
          forms={formsForTab}
          isSurvey={tab === 'surveys'}
          onEdit={(f) => { window.location.hash = `/forms/${f.id}/edit`; }}
          onPreview={(f) => { window.open(`/forms/${f.id}`, '_blank'); }}
          onShare={(f) => setShareForm(f)}
          onDuplicate={(f) => duplicateForm(f)}
          onSubmissions={(f) => setSubmissionsForm(f)}
          onRename={(f) => setRenameForm(f)}
          onArchive={(f) => setArchiveConfirm(f)}
          onUnarchive={(f) => unarchiveForm(f)}
          onToggleStatus={(f) => toggleStatus(f)}
          onDelete={(f) => setDeleteConfirm(f)}
          openMenuId={openMenuId}
          onMenuToggle={(id, e) => { e.stopPropagation(); setOpenMenuId(openMenuId === id ? null : id); }}
        />
      )}

      {/* Create flow */}
      <CreateFormFlow
        open={showCreate}
        onClose={() => setShowCreate(false)}
        isSurvey={tab === 'surveys'}
        onCreated={handleCreated}
      />

      {/* Rename modal */}
      <RenameModal
        form={renameForm}
        onClose={() => setRenameForm(null)}
        onConfirm={renameFormFn}
      />

      {/* Share modal */}
      <ShareModal
        form={shareForm}
        onClose={() => setShareForm(null)}
        onCopy={copyLink}
      />

      {/* Submissions modal */}
      {submissionsForm && (
        <SubmissionsModal form={submissionsForm} onClose={() => setSubmissionsForm(null)} />
      )}

      {/* Archive confirm */}
      <ConfirmDialog
        open={!!archiveConfirm}
        onClose={() => setArchiveConfirm(null)}
        onConfirm={archiveForm}
        title="Archive form?"
        message="This form will be archived and no longer accept submissions. You can restore it anytime."
        confirmLabel="Archive"
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={deleteForm}
        title="Delete form permanently?"
        message={
          deleteConfirm && deleteConfirm.submission_count > 0
            ? `This form has ${deleteConfirm.submission_count} submission${deleteConfirm.submission_count !== 1 ? 's' : ''}. Deleting it will permanently remove all submission data. Consider archiving instead. This cannot be undone.`
            : 'This will permanently delete this form and all its data. This cannot be undone.'
        }
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

// ============================================================
// Stat Card
// ============================================================
function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof FileText }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-gold-50 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-gold-700" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-navy-800 leading-none">{value}</p>
        <p className="text-xs text-ivory-600 mt-1">{label}</p>
      </div>
    </div>
  );
}

// ============================================================
// Form Card (Grid view)
// ============================================================
interface FormCardProps {
  form: FormWithMeta;
  isSurvey: boolean;
  onEdit: () => void;
  onPreview: () => void;
  onShare: () => void;
  onDuplicate: () => void;
  onSubmissions: () => void;
  onRename: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
  menuOpen: boolean;
  onMenuToggle: (e: React.MouseEvent) => void;
}

function FormCard({ form, isSurvey, onEdit, onPreview, onShare, onDuplicate, onSubmissions, onRename, onArchive, onUnarchive, onToggleStatus, onDelete, menuOpen, onMenuToggle }: FormCardProps) {
  return (
    <div className="card card-hover p-5 relative">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-ivory-100 flex items-center justify-center shrink-0">
            {isSurvey
              ? <BarChart3 className="w-5 h-5 text-navy-600" />
              : <FileText className="w-5 h-5 text-navy-600" />}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-navy-800 truncate">{form.name}</h3>
            <p className="text-xs text-ivory-600">
              {form.submission_count} {isSurvey ? 'response' : 'submission'}{form.submission_count !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <FormStatusPill status={form.status} />
      </div>

      {form.description && (
        <p className="text-xs text-ivory-600 mb-3 line-clamp-2">{form.description}</p>
      )}

      {/* Usage badges */}
      {form.usages.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-500 mb-1.5">Used in</p>
          <div className="flex flex-wrap gap-1.5">
            {form.usages.slice(0, 3).map(u => (
              <span key={u.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-navy-50 text-navy-600 border border-navy-100 text-xs">
                {USAGE_MODULE_LABELS[u.module]}
                {u.entity_name && <span className="text-ivory-500">· {u.entity_name}</span>}
              </span>
            ))}
            {form.usages.length > 3 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-ivory-50 text-ivory-600 text-xs">
                +{form.usages.length - 3} more
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-ivory-600 mb-4">
        <Clock className="w-3 h-3" />
        <span>Updated {timeAgo(form.updated_at)}</span>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={onEdit} className="btn-secondary btn-sm flex-1">
          <Edit className="w-3.5 h-3.5" />
          Edit
        </button>
        <button onClick={onSubmissions} className="btn-ghost btn-sm" title="View submissions">
          <Eye className="w-3.5 h-3.5" />
        </button>
        <button onClick={onShare} className="btn-ghost btn-sm" title="Share">
          <Link2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={onPreview} className="btn-ghost btn-sm" title="Preview">
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
        <div className="relative">
          <button onClick={onMenuToggle} className="btn-ghost btn-sm" title="More actions">
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          {menuOpen && <ActionMenu form={form} onRename={onRename} onDuplicate={onDuplicate} onArchive={onArchive} onUnarchive={onUnarchive} onToggleStatus={onToggleStatus} onDelete={onDelete} />}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Form List (List view)
// ============================================================
interface FormListProps {
  forms: FormWithMeta[];
  isSurvey: boolean;
  onEdit: (f: FormWithMeta) => void;
  onPreview: (f: FormWithMeta) => void;
  onShare: (f: FormWithMeta) => void;
  onDuplicate: (f: FormWithMeta) => void;
  onSubmissions: (f: FormWithMeta) => void;
  onRename: (f: FormWithMeta) => void;
  onArchive: (f: FormWithMeta) => void;
  onUnarchive: (f: FormWithMeta) => void;
  onToggleStatus: (f: FormWithMeta) => void;
  onDelete: (f: FormWithMeta) => void;
  openMenuId: string | null;
  onMenuToggle: (id: string, e: React.MouseEvent) => void;
}

function FormList({ forms, isSurvey, onEdit, onShare, onDuplicate, onSubmissions, onRename, onArchive, onUnarchive, onToggleStatus, onDelete, openMenuId, onMenuToggle }: FormListProps) {
  return (
    <div className="card p-0 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-navy-100 bg-ivory-50/50">
            <th className="px-4 py-3 text-left text-xs font-semibold text-ivory-600 uppercase tracking-wider">Name</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-ivory-600 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-ivory-600 uppercase tracking-wider hidden md:table-cell">
              {isSurvey ? 'Responses' : 'Submissions'}
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-ivory-600 uppercase tracking-wider hidden lg:table-cell">Used in</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-ivory-600 uppercase tracking-wider hidden sm:table-cell">Updated</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-ivory-600 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody>
          {forms.map(form => (
            <tr key={form.id} className="border-b border-navy-50 last:border-0 hover:bg-ivory-50/50 transition-colors">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-ivory-100 flex items-center justify-center shrink-0">
                    {isSurvey
                      ? <BarChart3 className="w-4 h-4 text-navy-600" />
                      : <FileText className="w-4 h-4 text-navy-600" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-navy-800 truncate">{form.name}</p>
                    {form.description && <p className="text-xs text-ivory-600 truncate max-w-[260px]">{form.description}</p>}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <FormStatusPill status={form.status} />
              </td>
              <td className="px-4 py-3 hidden md:table-cell">
                <span className="text-sm text-navy-700 font-medium">{form.submission_count}</span>
              </td>
              <td className="px-4 py-3 hidden lg:table-cell">
                {form.usages.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {form.usages.slice(0, 2).map(u => (
                      <span key={u.id} className="inline-flex items-center px-2 py-0.5 rounded-md bg-navy-50 text-navy-600 border border-navy-100 text-xs">
                        {USAGE_MODULE_LABELS[u.module]}
                      </span>
                    ))}
                    {form.usages.length > 2 && <span className="text-xs text-ivory-500">+{form.usages.length - 2}</span>}
                  </div>
                ) : (
                  <span className="text-xs text-ivory-400">—</span>
                )}
              </td>
              <td className="px-4 py-3 hidden sm:table-cell">
                <span className="text-xs text-ivory-600">{timeAgo(form.updated_at)}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <button onClick={() => onEdit(form)} className="btn-ghost btn-sm" title="Edit">
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => onSubmissions(form)} className="btn-ghost btn-sm" title="Submissions">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => onShare(form)} className="btn-ghost btn-sm" title="Share">
                    <Link2 className="w-3.5 h-3.5" />
                  </button>
                  <div className="relative">
                    <button onClick={(e) => onMenuToggle(form.id, e)} className="btn-ghost btn-sm" title="More">
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                    {openMenuId === form.id && (
                      <ActionMenu
                        form={form}
                        onRename={() => onRename(form)}
                        onDuplicate={() => onDuplicate(form)}
                        onArchive={() => onArchive(form)}
                        onUnarchive={() => onUnarchive(form)}
                        onToggleStatus={() => onToggleStatus(form)}
                        onDelete={() => onDelete(form)}
                      />
                    )}
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Action Menu (dropdown)
// ============================================================
function ActionMenu({ form, onRename, onDuplicate, onArchive, onUnarchive, onToggleStatus, onDelete }: {
  form: Form;
  onRename: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute right-0 top-full mt-1 z-30 bg-white rounded-xl border border-navy-100 shadow-popover py-1 min-w-[180px]">
      <MenuItem icon={Edit} label="Rename" onClick={onRename} />
      <MenuItem icon={Copy} label="Duplicate" onClick={onDuplicate} />
      <MenuItem icon={Eye} label="Preview" onClick={() => window.open(`/forms/${form.id}`, '_blank')} />
      <MenuItem icon={Link2} label="Share link" onClick={() => {
        const url = `${window.location.origin}/forms/${form.id}`;
        navigator.clipboard.writeText(url);
      }} />
      <div className="my-1 border-t border-navy-50" />
      {form.status === 'archived' ? (
        <MenuItem icon={Archive} label="Restore" onClick={onUnarchive} />
      ) : (
        <>
          <MenuItem
            icon={form.status === 'published' ? CheckSquare : CheckSquare}
            label={form.status === 'published' ? 'Deactivate' : 'Publish'}
            onClick={onToggleStatus}
          />
          <MenuItem icon={Archive} label="Archive" onClick={onArchive} />
        </>
      )}
      <div className="my-1 border-t border-navy-50" />
      <MenuItem icon={Trash2} label="Delete" onClick={onDelete} danger />
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Edit; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left',
        danger ? 'text-burgundy-600 hover:bg-red-50' : 'text-navy-700 hover:bg-ivory-50'
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {label}
    </button>
  );
}

// ============================================================
// Rename Modal
// ============================================================
function RenameModal({ form, onClose, onConfirm }: {
  form: Form | null;
  onClose: () => void;
  onConfirm: (form: Form, newName: string) => void;
}) {
  const [name, setName] = useState('');
  useEffect(() => { setName(form?.name ?? ''); }, [form]);
  if (!form) return null;
  return (
    <Modal open={!!form} onClose={onClose} title="Rename form" size="sm"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => onConfirm(form, name)} className="btn-primary" disabled={!name.trim()}>Save</button>
        </>
      }
    >
      <label className="block text-sm font-medium text-navy-700 mb-1.5">Form name</label>
      <input
        className="input-field"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Enter form name"
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onConfirm(form, name); }}
      />
    </Modal>
  );
}

// ============================================================
// Share Modal
// ============================================================
function ShareModal({ form, onClose, onCopy }: {
  form: Form | null;
  onClose: () => void;
  onCopy: (form: Form) => void;
}) {
  if (!form) return null;
  const url = `${window.location.origin}/forms/${form.id}`;
  return (
    <Modal open={!!form} onClose={onClose} title="Share form" size="md"
      footer={<button onClick={() => { onCopy(form); onClose(); }} className="btn-primary"><Link2 className="w-4 h-4" /> Copy link</button>}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Share link</label>
          <div className="flex items-center gap-2">
            <input className="input-field flex-1 text-sm" value={url} readOnly onClick={(e) => e.currentTarget.select()} />
            <button onClick={() => { onCopy(form); onClose(); }} className="btn-secondary btn-sm">
              <Copy className="w-3.5 h-3.5" />
              Copy
            </button>
          </div>
        </div>
        <div className="rounded-xl bg-ivory-50 border border-navy-100 p-4">
          <p className="text-xs text-ivory-600">
            {form.status === 'published'
              ? 'This form is published and accepting submissions. Anyone with the link can fill it out.'
              : form.status === 'archived'
                ? 'This form is archived and will not accept submissions. Restore it to make it active again.'
                : 'This form is currently a draft. Publish it to start collecting submissions.'}
          </p>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// Submissions Modal
// ============================================================
function SubmissionsModal({ form, onClose }: { form: FormWithMeta; onClose: () => void }) {
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('form_submissions')
      .select('*')
      .eq('form_id', form.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setSubmissions((data ?? []) as FormSubmission[]);
        setLoading(false);
      });
  }, [form.id]);

  return (
    <Modal open onClose={onClose} title={`${form.submission_count} submission${form.submission_count !== 1 ? 's' : ''} — ${form.name}`} size="lg">
      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : submissions.length === 0 ? (
        <EmptyState
          icon={<Inbox className="w-7 h-7" />}
          title="No submissions yet"
          description="Submissions will appear here when people fill out this form."
        />
      ) : (
        <div className="space-y-3">
          {submissions.map(s => (
            <div key={s.id} className="p-4 rounded-xl border border-navy-100">
              <p className="text-xs text-ivory-600 mb-2">{formatDate(s.created_at, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
              <div className="space-y-1">
                {Object.entries(s.answers).map(([key, value]) => (
                  <div key={key} className="flex gap-2 text-sm">
                    <span className="text-ivory-600 font-medium capitalize shrink-0">{key.replace(/_/g, ' ')}:</span>
                    <span className="text-navy-700">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
