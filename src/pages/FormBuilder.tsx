import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft, Eye, Share2, Upload, Undo2, Redo2,
  Layers, Palette, GitBranch, Settings, Bell, Inbox,
  Plus, Loader2, Check, AlertCircle, Send,
  Monitor, Tablet, Smartphone, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { cn } from '@/lib/utils';
import { ElementLibrary } from '@/components/forms/ElementLibrary';
import { FormCanvas } from '@/components/forms/FormCanvas';
import { PropertyPanel } from '@/components/forms/PropertyPanel';
import { FormRenderer } from '@/components/forms/FormRenderer';
import { DesignStudio } from '@/components/forms/DesignStudio';
import { NotificationsPanel } from '@/components/forms/NotificationsPanel';
import {
  type FormDefinition, type ElementType, type FormElement,
} from '@/lib/form-builder-types';
import {
  createDefaultDefinition, createElement, addElementToSection,
  removeElement, updateElement, updateElementField, updateElementContent,
  updateElementStyle, moveElement, duplicateElement,
  addSection, updateSection, removeSection,
  addPage,
  updateTheme, updateSettings, updateHeader, updateFooter, updateNotifications,
  serializeDefinition, deserializeDefinition, migrateLegacyFields,
  HistoryManager,
} from '@/lib/form-definition';
import type { Form } from '@/types';
import { publicOrigin } from '@/lib/publicUrl';

type BuilderTab = 'build' | 'design' | 'logic' | 'settings' | 'notifications' | 'submissions';
type Viewport = 'desktop' | 'tablet' | 'mobile';
type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

interface FormBuilderProps {
  formId: string;
  onBack: () => void;
}

export function FormBuilder({ formId, onBack }: FormBuilderProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<BuilderTab>('build');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<Viewport>('desktop');
  const [shareUrl, setShareUrl] = useState('');

  const historyRef = useRef(new HistoryManager<FormDefinition>());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const definitionRef = useRef<FormDefinition | null>(null);

  // Load form and definition
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: formData, error: formErr } = await supabase
        .from('forms')
        .select('*')
        .eq('id', formId)
        .single();
      if (formErr || cancelled) { if (!cancelled) setLoading(false); return; }

      const formRecord = formData as Form & { definition?: string | null };
      setForm(formData as Form);

      let def: FormDefinition | null = null;
      if (formRecord.definition) {
        def = deserializeDefinition(formRecord.definition);
      }
      if (!def) {
        def = createDefaultDefinition(formData.name, formData.description);
        // Try to migrate legacy form_fields
        const { data: legacyFields } = await supabase
          .from('form_fields')
          .select('*')
          .eq('form_id', formId)
          .order('sort_order', { ascending: true });
        if (legacyFields && legacyFields.length > 0) {
          def = migrateLegacyFields(def, legacyFields as unknown as Parameters<typeof migrateLegacyFields>[1]);
        }
      }

      if (cancelled) return;
      setDefinition(def);
      definitionRef.current = def;
      setLoading(false);
      setShareUrl(`${publicOrigin()}/forms/${formId}`);
    }
    load();
    return () => { cancelled = true; };
  }, [formId]);

  // Autosave
  const save = useCallback(async (def: FormDefinition) => {
    if (!formId) return;
    setSaveStatus('saving');
    const { error } = await supabase
      .from('forms')
      .update({
        definition: serializeDefinition(def),
        updated_at: new Date().toISOString(),
      })
      .eq('id', formId);

    if (error) {
      setSaveStatus('error');
      toast('Failed to save. Changes are preserved.', 'error');
    } else {
      setSaveStatus('saved');
    }
  }, [formId, toast]);

  // Debounced autosave on definition change
  const updateDefinition = useCallback((newDef: FormDefinition) => {
    setDefinition(newDef);
    definitionRef.current = newDef;
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => save(newDef), 1500);
  }, [save]);

  // Push to history before changes
  const withHistory = useCallback((newDef: FormDefinition) => {
    if (definitionRef.current) {
      historyRef.current.push(definitionRef.current);
    }
    updateDefinition(newDef);
  }, [updateDefinition]);

  const handleUndo = useCallback(() => {
    if (!definition) return;
    const prev = historyRef.current.undo(definition);
    if (prev) {
      setDefinition(prev);
      definitionRef.current = prev;
      setSaveStatus('unsaved');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => save(prev), 1500);
    }
  }, [definition, save]);

  const handleRedo = useCallback(() => {
    if (!definition) return;
    const next = historyRef.current.redo(definition);
    if (next) {
      setDefinition(next);
      definitionRef.current = next;
      setSaveStatus('unsaved');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => save(next), 1500);
    }
  }, [definition, save]);

  // === Element operations ===
  const handleAddElement = useCallback((type: ElementType) => {
    if (!definition) return;
    const page = definition.pages[currentPageIndex];
    if (!page || page.sectionIds.length === 0) {
      // Create a section first
      const withSec = addSection(definition, page?.id || definition.pages[0].id);
      const newSecId = withSec.pages[currentPageIndex]?.sectionIds[0] || Object.keys(withSec.sections).pop()!;
      const el = createElement(type, 0);
      withHistory(addElementToSection(withSec, newSecId, el));
      setSelectedElementId(el.id);
      return;
    }
    const sectionId = page.sectionIds[page.sectionIds.length - 1];
    const section = definition.sections[sectionId];
    const el = createElement(type, section.elementIds.length);
    withHistory(addElementToSection(definition, sectionId, el));
    setSelectedElementId(el.id);
  }, [definition, currentPageIndex, withHistory]);

  const handleAddSection = useCallback(() => {
    if (!definition) return;
    const pageId = definition.pages[currentPageIndex].id;
    const newDef = addSection(definition, pageId);
    withHistory(newDef);
    const newSecId = Object.keys(newDef.sections).pop()!;
    setSelectedSectionId(newSecId);
    setSelectedElementId(null);
  }, [definition, currentPageIndex, withHistory]);

  const handleRemoveElement = useCallback((id: string) => {
    if (!definition) return;
    withHistory(removeElement(definition, id));
    setSelectedElementId(null);
  }, [definition, withHistory]);

  const handleDuplicateElement = useCallback((id: string) => {
    if (!definition) return;
    const newDef = duplicateElement(definition, id);
    withHistory(newDef);
    // Find the new element ID (the one that was just added)
    const original = definition.elements[id];
    if (original) {
      const newId = Object.keys(newDef.elements).find(eid =>
        eid !== id && newDef.elements[eid].type === original.type &&
        newDef.elements[eid].displayLabel === original.displayLabel
      );
      if (newId) setSelectedElementId(newId);
    }
  }, [definition, withHistory]);

  const handleReorderElement = useCallback((elementId: string, toSectionId: string, toIndex: number) => {
    if (!definition) return;
    withHistory(moveElement(definition, elementId, toSectionId, toIndex));
  }, [definition, withHistory]);

  const handleUpdateElement = useCallback((id: string, updates: Partial<FormElement>) => {
    if (!definition) return;
    withHistory(updateElement(definition, id, updates));
  }, [definition, withHistory]);

  const handleUpdateElementField = useCallback((id: string, updates: Parameters<typeof updateElementField>[2]) => {
    if (!definition) return;
    withHistory(updateElementField(definition, id, updates));
  }, [definition, withHistory]);

  const handleUpdateElementContent = useCallback((id: string, updates: Parameters<typeof updateElementContent>[2]) => {
    if (!definition) return;
    withHistory(updateElementContent(definition, id, updates));
  }, [definition, withHistory]);

  const handleUpdateElementStyle = useCallback((id: string, updates: Parameters<typeof updateElementStyle>[2]) => {
    if (!definition) return;
    withHistory(updateElementStyle(definition, id, updates));
  }, [definition, withHistory]);

  const handleUpdateSection = useCallback((id: string, updates: Parameters<typeof updateSection>[2]) => {
    if (!definition) return;
    withHistory(updateSection(definition, id, updates));
  }, [definition, withHistory]);

  const handleRemoveSection = useCallback((id: string) => {
    if (!definition) return;
    withHistory(removeSection(definition, id));
    if (selectedSectionId === id) setSelectedSectionId(null);
  }, [definition, withHistory, selectedSectionId]);

  const handleToggleSectionVisibility = useCallback((id: string) => {
    if (!definition) return;
    const section = definition.sections[id];
    if (!section) return;
    withHistory(updateSection(definition, id, { visible: !section.visible }));
  }, [definition, withHistory]);

  const handlePublish = useCallback(async () => {
    if (!definition || !form) return;
    setSaveStatus('saving');
    const { error } = await supabase
      .from('forms')
      .update({
        status: 'published',
        definition: serializeDefinition(definition),
        updated_at: new Date().toISOString(),
      })
      .eq('id', formId);
    if (error) {
      setSaveStatus('error');
      toast('Failed to publish', 'error');
    } else {
      setSaveStatus('saved');
      setForm({ ...form, status: 'published' });
      toast('Form published');
    }
  }, [definition, form, formId, toast]);

  if (loading || !definition) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 text-gold-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* === TOP BAR === */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-navy-100 bg-white shrink-0">
        {/* Left — back + form name + undo/redo */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button onClick={onBack} className="btn-ghost btn-sm">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Submissions</span>
          </button>
          <div className="w-px h-6 bg-navy-100" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-navy-800 truncate">{form?.name || 'Untitled'}</p>
            <SaveStatusIndicator status={saveStatus} />
          </div>
          <div className="hidden sm:flex items-center gap-1 ml-2">
            <button onClick={handleUndo} disabled={!historyRef.current.canUndo()}
              className="p-1.5 rounded-lg text-ivory-600 hover:bg-ivory-50 disabled:opacity-30 disabled:cursor-not-allowed" title="Undo">
              <Undo2 className="w-4 h-4" />
            </button>
            <button onClick={handleRedo} disabled={!historyRef.current.canRedo()}
              className="p-1.5 rounded-lg text-ivory-600 hover:bg-ivory-50 disabled:opacity-30 disabled:cursor-not-allowed" title="Redo">
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Center — device toolbar (only in build tab) */}
        {tab === 'build' && (
          <div className="hidden md:flex items-center gap-1 rounded-lg border border-navy-100 px-1 py-0.5">
            {(['desktop', 'tablet', 'mobile'] as Viewport[]).map(vp => {
              const Icon = vp === 'desktop' ? Monitor : vp === 'tablet' ? Tablet : Smartphone;
              return (
                <button key={vp} onClick={() => setPreviewViewport(vp)}
                  className={cn('p-1.5 rounded-md transition-colors',
                    previewViewport === vp ? 'bg-navy-800 text-ivory-100' : 'text-ivory-500 hover:bg-ivory-50')}
                  title={vp.charAt(0).toUpperCase() + vp.slice(1)}>
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>
        )}

        {/* Right — preview, share, publish */}
        <div className="flex items-center gap-2 flex-1 justify-end">
          <button onClick={() => setPreviewOpen(true)} className="btn-secondary btn-sm">
            <Eye className="w-4 h-4" />
            <span className="hidden sm:inline">Preview</span>
          </button>
          <button onClick={() => { navigator.clipboard.writeText(shareUrl); toast('Link copied'); }} className="btn-secondary btn-sm">
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">Share</span>
          </button>
          <button onClick={handlePublish} className="btn-primary btn-sm"
            disabled={form?.status === 'published'}>
            <Upload className="w-4 h-4" />
            {form?.status === 'published' ? 'Published' : 'Publish'}
          </button>
        </div>
      </div>

      {/* === BUILDER NAVIGATION TABS === */}
      <div className="flex items-center gap-1 px-4 border-b border-navy-100 bg-white shrink-0">
        {([
          { id: 'build', label: 'Build', icon: Layers },
          { id: 'design', label: 'Design', icon: Palette },
          { id: 'logic', label: 'Logic', icon: GitBranch },
          { id: 'settings', label: 'Settings', icon: Settings },
          { id: 'notifications', label: 'Notifications', icon: Bell },
          { id: 'submissions', label: 'Submissions', icon: Inbox },
        ] as { id: BuilderTab; label: string; icon: typeof Layers }[]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.id ? 'border-gold-500 text-navy-800' : 'border-transparent text-ivory-500 hover:text-navy-700'
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* === MAIN CONTENT === */}
      {tab === 'build' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar — element library */}
          <div className="w-[270px] shrink-0">
            <ElementLibrary onAddElement={handleAddElement} onAddSection={handleAddSection} />
          </div>

          {/* Center — canvas */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Page tabs */}
            <div className="flex items-center gap-1 px-4 py-1.5 border-b border-navy-100 bg-white">
              {definition.pages.map((p, idx) => (
                <button
                  key={p.id}
                  onClick={() => setCurrentPageIndex(idx)}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                    currentPageIndex === idx ? 'bg-navy-800 text-ivory-100' : 'text-ivory-600 hover:bg-ivory-50'
                  )}
                >
                  {p.name}
                </button>
              ))}
              <button
                onClick={() => { withHistory(addPage(definition)); setCurrentPageIndex(definition.pages.length); }}
                className="p-1 text-ivory-500 hover:text-navy-700"
                title="Add page"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <FormCanvas
              definition={definition}
              formName={form?.name || 'Untitled'}
              formDescription={form?.description}
              selectedElementId={selectedElementId}
              selectedSectionId={selectedSectionId}
              onSelectElement={setSelectedElementId}
              onSelectSection={setSelectedSectionId}
              onDuplicateElement={handleDuplicateElement}
              onRemoveElement={handleRemoveElement}
              onAddSection={handleAddSection}
              onRemoveSection={handleRemoveSection}
              onToggleSectionVisibility={handleToggleSectionVisibility}
              onReorderElement={handleReorderElement}
              currentPageIndex={currentPageIndex}
            />
          </div>

          {/* Right sidebar — properties */}
          <div className="w-[270px] shrink-0">
            <PropertyPanel
              definition={definition}
              selectedElementId={selectedElementId}
              selectedSectionId={selectedSectionId}
              onUpdateElement={handleUpdateElement}
              onUpdateElementField={handleUpdateElementField}
              onUpdateElementContent={handleUpdateElementContent}
              onUpdateElementStyle={handleUpdateElementStyle}
              onUpdateSection={handleUpdateSection}
              onDuplicateElement={handleDuplicateElement}
              onRemoveElement={handleRemoveElement}
              onDeselect={() => { setSelectedElementId(null); setSelectedSectionId(null); }}
            />
          </div>
        </div>
      )}

      {tab === 'design' && (
        <DesignStudio
          definition={definition}
          formName={form?.name || 'Untitled'}
          formDescription={form?.description}
          onUpdateTheme={(updates) => withHistory(updateTheme(definition, updates))}
        />
      )}

      {tab === 'settings' && (
        <SettingsTab
          form={form}
          definition={definition}
          onUpdateForm={(updates) => {
            supabase.from('forms').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', formId);
            if (form) setForm({ ...form, ...updates });
          }}
          onUpdateSettings={(updates) => withHistory(updateSettings(definition, updates))}
          onUpdateHeader={(updates) => withHistory(updateHeader(definition, updates))}
          onUpdateFooter={(updates) => withHistory(updateFooter(definition, updates))}
        />
      )}

      {tab === 'logic' && <ComingSoonTab label="Logic" icon={GitBranch} />}
      {tab === 'notifications' && definition && (
        <NotificationsPanel
          definition={definition}
          formName={form?.name || 'Untitled'}
          onUpdateNotifications={(updates) => withHistory(updateNotifications(definition, updates))}
        />
      )}
      {tab === 'submissions' && <ComingSoonTab label="Submissions" icon={Inbox} />}

      {/* === PREVIEW MODAL === */}
      {previewOpen && (
        <PreviewModal
          definition={definition}
          formName={form?.name || 'Untitled'}
          formDescription={form?.description}
          viewport={previewViewport}
          onViewportChange={setPreviewViewport}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// SAVE STATUS INDICATOR
// ============================================================

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  const config = {
    saved: { icon: Check, text: 'Saved', color: 'text-green-600' },
    saving: { icon: Loader2, text: 'Saving...', color: 'text-ivory-500' },
    unsaved: { icon: AlertCircle, text: 'Unsaved changes', color: 'text-amber-600' },
    error: { icon: AlertCircle, text: 'Save failed', color: 'text-red-500' },
  };
  const c = config[status];
  return (
    <span className={cn('flex items-center gap-1 text-[11px]', c.color)}>
      <c.icon className={cn('w-3 h-3', status === 'saving' && 'animate-spin')} />
      {c.text}
    </span>
  );
}

// ============================================================
// SETTINGS TAB
// ============================================================

function SettingsTab({ form, definition, onUpdateForm, onUpdateSettings, onUpdateHeader, onUpdateFooter }: {
  form: Form | null;
  definition: FormDefinition;
  onUpdateForm: (updates: Partial<Form>) => void;
  onUpdateSettings: (updates: Partial<typeof definition.settings>) => void;
  onUpdateHeader: (updates: Partial<typeof definition.header>) => void;
  onUpdateFooter: (updates: Partial<typeof definition.footer>) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-navy-800 mb-4">Form Details</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Form name</label>
            <input className="input-field" value={form?.name || ''} onChange={e => onUpdateForm({ name: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Description</label>
            <textarea className="input-field min-h-[60px] resize-y" value={form?.description || ''} onChange={e => onUpdateForm({ description: e.target.value })} />
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-navy-800 mb-4">Header</h2>
        <div className="space-y-3">
          <ToggleRow label="Show header" checked={definition.header.enabled} onChange={v => onUpdateHeader({ enabled: v })} />
          <ToggleRow label="Show title" checked={definition.header.showTitle} onChange={v => onUpdateHeader({ showTitle: v })} />
          <ToggleRow label="Show description" checked={definition.header.showDescription} onChange={v => onUpdateHeader({ showDescription: v })} />
          <ToggleRow label="Show progress bar" checked={definition.header.showProgress} onChange={v => onUpdateHeader({ showProgress: v })} />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-navy-800 mb-4">Footer</h2>
        <div className="space-y-3">
          <ToggleRow label="Show footer" checked={definition.footer.enabled} onChange={v => onUpdateFooter({ enabled: v })} />
          {definition.footer.enabled && (
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1.5">Footer content</label>
              <textarea className="input-field min-h-[60px] resize-y" value={definition.footer.content} onChange={e => onUpdateFooter({ content: e.target.value })} placeholder="e.g. Privacy Policy | Terms of Service" />
            </div>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-navy-800 mb-4">Submission Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Success message</label>
            <textarea className="input-field min-h-[60px] resize-y" value={definition.settings.successMessage} onChange={e => onUpdateSettings({ successMessage: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Redirect URL (optional)</label>
            <input className="input-field" value={definition.settings.redirectUrl || ''} onChange={e => onUpdateSettings({ redirectUrl: e.target.value || null })} placeholder="https://" />
          </div>
          <ToggleRow label="Create contact on submission" checked={definition.settings.createContact} onChange={v => onUpdateSettings({ createContact: v })} />
          <ToggleRow label="Update existing contact" checked={definition.settings.updateContact} onChange={v => onUpdateSettings({ updateContact: v })} />
          <ToggleRow label="Show progress bar" checked={definition.settings.showProgressBar} onChange={v => onUpdateSettings({ showProgressBar: v })} />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// COMING SOON TAB
// ============================================================

function ComingSoonTab({ label, icon: Icon }: { label: string; icon: typeof Layers }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-ivory-100 flex items-center justify-center text-ivory-500 mx-auto mb-4">
          <Icon className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-semibold text-navy-800 mb-1">{label}</h3>
        <p className="text-sm text-ivory-600">This tab is coming soon.</p>
      </div>
    </div>
  );
}

// ============================================================
// PREVIEW MODAL
// ============================================================

function PreviewModal({ definition, formName, formDescription, viewport, onViewportChange, onClose }: {
  definition: FormDefinition;
  formName: string;
  formDescription?: string | null;
  viewport: Viewport;
  onViewportChange: (v: Viewport) => void;
  onClose: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-navy-900/80">
      {/* Preview toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-navy-100">
        <div className="flex items-center gap-1 rounded-lg border border-navy-100 overflow-hidden">
          {(['desktop', 'tablet', 'mobile'] as Viewport[]).map(vp => {
            const Icon = vp === 'desktop' ? Monitor : vp === 'tablet' ? Tablet : Smartphone;
            return (
              <button key={vp} onClick={() => onViewportChange(vp)}
                className={cn('p-2 transition-colors', viewport === vp ? 'bg-navy-800 text-ivory-100' : 'text-ivory-600 hover:bg-ivory-50')}>
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
        </div>
        <p className="text-sm font-semibold text-navy-800">Preview</p>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-ivory-50 text-ivory-600">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Preview content */}
      <div className="flex-1 overflow-y-auto flex justify-center p-6 bg-ivory-50">
        <div className="w-full" style={{ maxWidth: viewport === 'mobile' ? '375px' : viewport === 'tablet' ? '768px' : '900px' }}>
          {submitted ? (
            <PostSubmissionPreview definition={definition} />
          ) : (
            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <FormRenderer
                definition={definition}
                formName={formName}
                formDescription={formDescription}
                viewport={viewport}
                currentPageIndex={currentPage}
                currentPage={currentPage}
                totalPages={definition.pages.length}
                answers={answers}
                onAnswerChange={(fid, val) => setAnswers(prev => ({ ...prev, [fid]: val }))}
                onSubmit={() => setSubmitted(true)}
                onNext={() => setCurrentPage(p => Math.min(p + 1, definition.pages.length - 1))}
                onPrevious={() => setCurrentPage(p => Math.max(p - 1, 0))}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// POST-SUBMISSION PREVIEW
// ============================================================

function PostSubmissionPreview({ definition }: { definition: FormDefinition }) {
  const ps = definition.notifications.postSubmission;

  if (ps.type === 'redirect' && ps.redirectUrl) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-12 text-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
          <Send className="w-7 h-7 text-blue-600" />
        </div>
        <p className="text-lg font-semibold text-navy-800 mb-1">Redirecting...</p>
        <p className="text-sm text-ivory-500">{ps.redirectUrl}</p>
      </div>
    );
  }

  if (ps.type === 'custom_message') {
    return (
      <div className="bg-white rounded-xl shadow-lg p-12 text-center">
        <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
          <Check className="w-7 h-7 text-green-600" />
        </div>
        <p className="text-base text-navy-700 whitespace-pre-wrap">{ps.customMessage || definition.settings.successMessage}</p>
      </div>
    );
  }

  // thank_you page
  const ty = ps.thankYouPage;
  return (
    <div className="bg-white rounded-xl shadow-lg p-12 text-center">
      {ty.imageUrl && (
        <img src={ty.imageUrl} alt="" className="max-h-24 mx-auto mb-4 rounded-lg" />
      )}
      <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
        <Check className="w-7 h-7 text-green-600" />
      </div>
      <h2 className="text-xl font-bold text-navy-800 mb-2">{ty.heading}</h2>
      <p className="text-sm text-ivory-600 mb-6">{ty.message}</p>
      {ty.buttonText && ty.buttonLink && (
        <a
          href={ty.buttonLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-navy-800 text-white text-sm font-medium hover:bg-navy-700 transition-colors"
        >
          {ty.buttonText}
        </a>
      )}
    </div>
  );
}

// ============================================================
// SHARED UI
// ============================================================

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-1">
      <span className="text-sm font-medium text-navy-700">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={cn('relative w-10 h-5 rounded-full transition-colors', checked ? 'bg-gold-500' : 'bg-ivory-200')}
      >
        <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </label>
  );
}
