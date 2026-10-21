import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronLeft, Eye, Link2, Undo2, Redo2, Loader2, Check, AlertCircle, Plus, X,
  Monitor, Tablet, Smartphone, Workflow, Copy, ExternalLink, Globe, Rocket, ChevronDown,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { cn } from '@/lib/utils';
import { ElementLibrary } from '@/components/forms/ElementLibrary';
import { FormCanvas } from '@/components/forms/FormCanvas';
import { PropertyPanel } from '@/components/forms/PropertyPanel';
import { FormPlayer, type FormPayload, type SubmitOutcome } from '@/components/forms/FormPlayer';
import { LogicPanel } from '@/components/forms/LogicPanel';
import { SettingsExtras } from '@/components/forms/SettingsExtras';
import { SubmissionsPanel } from '@/components/forms/SubmissionsPanel';
import { DesignStudio } from '@/components/forms/DesignStudio';
import { NotificationsPanel } from '@/components/forms/NotificationsPanel';
import { FormWorkspaceCtx } from '@/components/forms/ImagePicker';
import { Field, Group, SwitchRow, areaCls, inputCls } from '@/components/forms/builder-ui';
import { type FormDefinition, type ElementType, type FormElement, type Viewport } from '@/lib/form-builder-types';
import {
  createDefaultDefinition, createElement, addElementToSection,
  removeElement, updateElement, updateElementField, updateElementContent,
  updateElementStyle, moveElement, duplicateElementWithId,
  addSection, updateSection, removeSection,
  addPage, renamePage, removePage,
  updateTheme, updateSettings, updateHeader, updateFooter, updateNotifications,
  serializeDefinition, deserializeDefinition, migrateLegacyFields,
  HistoryManager,
} from '@/lib/form-definition';
import { prefillAnswers } from '@/lib/form-engine';
import { openWorkflowForForm } from '@/workflows/fromForm';
import type { Form } from '@/types';
import { publicOrigin } from '@/lib/publicUrl';

type BuilderTab = 'build' | 'design' | 'logic' | 'settings' | 'notifications' | 'submissions';
type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

interface FormBuilderProps {
  formId: string;
  onBack: () => void;
}

const TABS: { id: BuilderTab; label: string }[] = [
  { id: 'build', label: 'Build' },
  { id: 'design', label: 'Design' },
  { id: 'logic', label: 'Logic' },
  { id: 'settings', label: 'Settings' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'submissions', label: 'Responses' },
];
const VIEWPORTS: { id: Viewport; icon: typeof Monitor; label: string }[] = [
  { id: 'desktop', icon: Monitor, label: 'Desktop' },
  { id: 'tablet', icon: Tablet, label: 'Tablet' },
  { id: 'mobile', icon: Smartphone, label: 'Phone' },
];

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
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [shareOpen, setShareOpen] = useState(false);
  const [, forceRender] = useState(0);

  const historyRef = useRef(new HistoryManager<FormDefinition>(100));
  const lastPushRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const definitionRef = useRef<FormDefinition | null>(null);
  const shareUrl = `${publicOrigin()}/f/${formId}`;
  const kind = form?.type === 'survey' ? 'survey' : 'form';

  // Load form and definition
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: formData, error: formErr } = await supabase.from('forms').select('*').eq('id', formId).single();
      if (formErr || cancelled) { if (!cancelled) setLoading(false); return; }
      const formRecord = formData as Form & { definition?: string | null };
      setForm(formData as Form);

      let def: FormDefinition | null = formRecord.definition ? deserializeDefinition(formRecord.definition) : null;
      if (!def) {
        def = createDefaultDefinition(formData.name, formData.description);
        const { data: legacyFields } = await supabase.from('form_fields').select('*').eq('form_id', formId).order('sort_order', { ascending: true });
        if (legacyFields && legacyFields.length > 0) {
          def = migrateLegacyFields(def, legacyFields as unknown as Parameters<typeof migrateLegacyFields>[1]);
        }
        // Keep it, so the live form (and a copy of it) has these fields even before any edit.
        await supabase.from('forms').update({ definition: serializeDefinition(def) }).eq('id', formId);
      }
      if (cancelled) return;
      setDefinition(def);
      definitionRef.current = def;
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [formId]);

  const save = useCallback(async (def: FormDefinition) => {
    setSaveStatus('saving');
    const { error } = await supabase.from('forms').update({ definition: serializeDefinition(def), updated_at: new Date().toISOString() }).eq('id', formId);
    if (error) { setSaveStatus('error'); toast('Couldn’t save. Your changes are kept here; try Save again.', 'error'); return false; }
    setSaveStatus('saved');
    return true;
  }, [formId, toast]);

  const updateDefinition = useCallback((newDef: FormDefinition) => {
    setDefinition(newDef);
    definitionRef.current = newDef;
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { saveTimerRef.current = null; void save(newDef); }, 1200);
  }, [save]);

  // One undo step per burst of typing, not per key.
  const withHistory = useCallback((newDef: FormDefinition) => {
    const now = Date.now();
    if (definitionRef.current && now - lastPushRef.current > 700) historyRef.current.push(definitionRef.current);
    lastPushRef.current = now;
    updateDefinition(newDef);
  }, [updateDefinition]);

  const saveNow = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (definitionRef.current) return save(definitionRef.current);
    return true;
  }, [save]);

  const step = useCallback((dir: 'undo' | 'redo') => {
    const cur = definitionRef.current;
    if (!cur) return;
    const next = dir === 'undo' ? historyRef.current.undo(cur) : historyRef.current.redo(cur);
    if (!next) return;
    lastPushRef.current = 0;
    updateDefinition(next);
    forceRender((n) => n + 1);
  }, [updateDefinition]);

  // ⌘Z / ⌘⇧Z and ⌘S, but not while typing in a box (the box has its own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); void saveNow().then((ok) => ok && toast('Saved')); return; }
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (typing) return;
      if (k === 'z') { e.preventDefault(); step(e.shiftKey ? 'redo' : 'undo'); }
      if (k === 'y') { e.preventDefault(); step('redo'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow, step, toast]);

  // Leaving with changes not yet saved: save them first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (saveTimerRef.current) { void saveNow(); e.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveNow]);
  const back = async () => { await saveNow(); onBack(); };

  // The form's name and description (columns of the form, saved a moment after typing stops).
  const updateForm = useCallback((updates: { name?: string; description?: string }) => {
    setForm((f) => (f ? { ...f, ...updates } as Form : f));
    if (metaTimerRef.current) clearTimeout(metaTimerRef.current);
    metaTimerRef.current = setTimeout(async () => {
      const name = updates.name !== undefined ? updates.name.trim() || 'Untitled form' : undefined;
      const { error } = await supabase.from('forms').update({ ...updates, ...(name !== undefined ? { name } : {}), updated_at: new Date().toISOString() }).eq('id', formId);
      if (error) toast(`Couldn’t save the ${updates.name !== undefined ? 'name' : 'description'}: ${error.message}`, 'error');
    }, 600);
  }, [formId, toast]);

  // === Element operations ===
  /** The section new things go into: the picked one if it's on this page, else the page's last. */
  const targetSection = (def: FormDefinition) => {
    const page = def.pages[currentPageIndex];
    if (!page) return null;
    const picked = selectedSectionId ?? (selectedElementId ? Object.values(def.sections).find((s) => s.elementIds.includes(selectedElementId))?.id : null);
    if (picked && page.sectionIds.includes(picked)) return picked;
    return page.sectionIds[page.sectionIds.length - 1] ?? null;
  };

  const handleAddElement = (type: ElementType) => {
    if (!definition) return;
    let def = definition;
    let sid = targetSection(def);
    // Nothing picked and the last section has columns: new things go full width, below it.
    const nothingPicked = !selectedElementId && !selectedSectionId;
    if (!sid || (nothingPicked && def.sections[sid].columnCount > 1)) {
      const pageId = def.pages[currentPageIndex]?.id ?? def.pages[0].id;
      const before = new Set(Object.keys(def.sections));
      def = addSection(def, pageId);
      sid = Object.keys(def.sections).find((id) => !before.has(id)) ?? null;
      if (!sid) return;
    }
    const el = createElement(type, def.sections[sid].elementIds.length);
    // Right after the picked element, if it's in this section.
    const after = selectedElementId ? def.sections[sid].elementIds.indexOf(selectedElementId) : -1;
    // A picked multi-column section gets it in its shortest column.
    const sec = def.sections[sid];
    const counts = Array.from({ length: sec.columnCount }, (_, i) => sec.elementIds.filter((id) => (def.elements[id]?.column ?? 1) === i + 1).length);
    const col = after >= 0 ? def.elements[selectedElementId!]?.column : sec.columnCount > 1 ? counts.indexOf(Math.min(...counts)) + 1 : undefined;
    def = addElementToSection(def, sid, el, col);
    if (after >= 0) def = moveElement(def, el.id, sid, after + 1, col);
    withHistory(def);
    setSelectedElementId(el.id);
    setSelectedSectionId(sid);
  };

  /** Layout tiles: a new section with 1–3 columns (a card is a tinted, rounded section). */
  const handleAddSection = (columns: 1 | 2 | 3 = 1, card = false) => {
    if (!definition) return;
    const pageId = definition.pages[currentPageIndex].id;
    const before = new Set(Object.keys(definition.sections));
    let def = addSection(definition, pageId);
    const sid = Object.keys(def.sections).find((id) => !before.has(id));
    if (!sid) return;
    def = updateSection(def, sid, { columnCount: columns, ...(card ? { name: 'Card', style: { backgroundColor: '#F5F6F8', borderRadius: '16px', padding: '20px' } } : {}) });
    withHistory(def);
    setSelectedSectionId(sid);
    setSelectedElementId(null);
  };

  const handleRemoveElement = (id: string) => {
    if (!definition) return;
    withHistory(removeElement(definition, id));
    setSelectedElementId(null);
  };

  const handleDuplicateElement = (id: string) => {
    if (!definition) return;
    const [next, newId] = duplicateElementWithId(definition, id);
    withHistory(next);
    if (newId) setSelectedElementId(newId);
  };

  const handleReorderElement = (elementId: string, toSectionId: string, toIndex: number, toColumn?: number) => {
    if (!definition) return;
    withHistory(moveElement(definition, elementId, toSectionId, toIndex, toColumn));
    setSelectedElementId(elementId);
    setSelectedSectionId(toSectionId);
  };

  // Dragged in from the element panel: goes exactly where it was dropped.
  const handleDropNewElement = (type: ElementType, sectionId: string, index: number, column: number) => {
    if (!definition) return;
    let def = definition;
    let target = sectionId;
    if (!target) {
      const pageId = def.pages[currentPageIndex]?.id ?? def.pages[0].id;
      const before = new Set(Object.keys(def.sections));
      def = addSection(def, pageId);
      target = Object.keys(def.sections).find((id) => !before.has(id)) ?? '';
      if (!target) return;
    }
    const el = createElement(type, def.sections[target].elementIds.length);
    def = addElementToSection(def, target, el);
    withHistory(moveElement(def, el.id, target, index, column));
    setSelectedElementId(el.id);
    setSelectedSectionId(target);
  };

  const change = (fn: (d: FormDefinition) => FormDefinition) => { if (definition) withHistory(fn(definition)); };
  const handleUpdateElement = (id: string, u: Partial<FormElement>) => change((d) => updateElement(d, id, u));
  const handleUpdateElementField = (id: string, u: Parameters<typeof updateElementField>[2]) => change((d) => updateElementField(d, id, u));
  const handleUpdateElementContent = (id: string, u: Parameters<typeof updateElementContent>[2]) => change((d) => updateElementContent(d, id, u));
  const handleUpdateElementStyle = (id: string, u: Parameters<typeof updateElementStyle>[2]) => change((d) => updateElementStyle(d, id, u));
  const handleUpdateSection = (id: string, u: Parameters<typeof updateSection>[2]) => change((d) => updateSection(d, id, u));
  const handleRemoveSection = (id: string) => { change((d) => removeSection(d, id)); setSelectedSectionId(null); setSelectedElementId(null); };
  const handleToggleSectionVisibility = (id: string) => change((d) => (d.sections[id] ? updateSection(d, id, { visible: !d.sections[id].visible }) : d));

  // === Publishing ===
  const setStatus = async (status: 'published' | 'draft') => {
    if (!definition || !form) return;
    setSaveStatus('saving');
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const { error } = await supabase.from('forms').update({ status, definition: serializeDefinition(definition), updated_at: new Date().toISOString() }).eq('id', formId);
    if (error) { setSaveStatus('error'); toast(status === 'published' ? 'Couldn’t publish' : 'Couldn’t unpublish', 'error'); return; }
    setSaveStatus('saved');
    setForm({ ...form, status });
    toast(status === 'published' ? 'Published. The link is live.' : 'Unpublished. The link now says it isn’t taking responses.');
  };

  if (loading || !definition) {
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#F2F2F5]"><Loader2 className="h-7 w-7 animate-spin text-[#8E8E93]" /></div>;
  }
  const live = form?.status === 'published';

  return (
    <FormWorkspaceCtx.Provider value={form?.workspace_id ?? null}>
    <div className="fixed inset-0 z-50 flex flex-col bg-[#F2F2F5] text-[#1D1D1F]">
      {/* === TOP BAR === */}
      <header className="relative z-30 grid h-[58px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-black/[0.07] bg-white/85 px-3 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-1.5">
          <button type="button" onClick={back} className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-[9px] pl-1 pr-2.5 text-[13px] font-medium text-[#0066CC] hover:bg-[#EEF5FF]">
            <ChevronLeft className="h-[18px] w-[18px]" /> Forms
          </button>
          <div className="mx-1 h-5 w-px shrink-0 bg-black/10" />
          <div className="min-w-0">
            <input value={form?.name ?? ''} onChange={(e) => updateForm({ name: e.target.value })} aria-label="Form name"
              className="w-full max-w-[260px] truncate rounded-[7px] bg-transparent px-1.5 py-0.5 text-[14px] font-semibold text-[#1D1D1F] outline-none hover:bg-black/[0.04] focus:bg-white focus:ring-[3px] focus:ring-[#0071E3]/15" />
            <div className="flex items-center gap-2 px-1.5">
              <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', live ? 'text-[#248A3D]' : 'text-[#8E8E93]')}>
                <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-[#34C759]' : 'bg-[#C7C7CC]')} />{live ? 'Live' : 'Draft'}
              </span>
              <SaveState status={saveStatus} />
            </div>
          </div>
        </div>

        {/* Centre: the builder's areas. */}
        <nav className="flex rounded-[11px] bg-[#EFEFF2] p-[3px]" aria-label="Builder">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
              className={cn('h-8 rounded-[8px] px-2.5 text-[13px] font-medium transition-all xl:px-3.5',
                tab === t.id ? 'bg-white text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]' : 'text-[#6E6E73] hover:text-[#1D1D1F]')}>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-1.5">
          <div className="mr-1 hidden items-center lg:flex">
            <IconBtn title="Undo (⌘Z)" disabled={!historyRef.current.canUndo()} onClick={() => step('undo')}><Undo2 className="h-4 w-4" /></IconBtn>
            <IconBtn title="Redo (⌘⇧Z)" disabled={!historyRef.current.canRedo()} onClick={() => step('redo')}><Redo2 className="h-4 w-4" /></IconBtn>
          </div>
          <BarBtn onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4" /><span className="hidden md:inline">Preview</span></BarBtn>
          <div className="relative">
            <BarBtn onClick={() => setShareOpen((o) => !o)}><Link2 className="h-4 w-4" /><span className="hidden md:inline">Share</span></BarBtn>
            {shareOpen && <SharePopover url={shareUrl} live={live} onPublish={() => void setStatus('published')} onClose={() => setShareOpen(false)} toast={toast} />}
          </div>
          <button type="button" onClick={() => void saveNow().then((ok) => ok && toast('Saved'))} title="Save (⌘S)"
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[#0071E3] px-3.5 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.15)] transition hover:bg-[#0077ED] active:bg-[#006EDB]">
            {saveStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
          </button>
          <PublishButton live={live} onPublish={() => void setStatus('published')} onUnpublish={() => void setStatus('draft')} />
        </div>
      </header>

      {/* === BUILD === */}
      {tab === 'build' && (
        <div className="flex flex-1 overflow-hidden">
          <div className="w-[292px] shrink-0">
            <ElementLibrary onAddElement={handleAddElement} onAddSection={handleAddSection} />
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3">
              <PageTabs pages={definition.pages} current={currentPageIndex} survey={kind === 'survey'}
                onPick={(i) => { setCurrentPageIndex(i); setSelectedElementId(null); setSelectedSectionId(null); }}
                onAdd={() => { withHistory(addPage(definition, `${kind === 'survey' ? 'Slide' : 'Page'} ${definition.pages.length + 1}`)); setCurrentPageIndex(definition.pages.length); }}
                onRename={(id, name) => withHistory(renamePage(definition, id, name))}
                onRemove={(id) => { withHistory(removePage(definition, id)); setCurrentPageIndex((c) => Math.max(0, Math.min(c, definition.pages.length - 2))); }} />
              <div className="flex shrink-0 rounded-[10px] bg-[#E6E6EA] p-[3px]" role="radiogroup" aria-label="Screen size">
                {VIEWPORTS.map((v) => (
                  <button key={v.id} type="button" role="radio" aria-checked={viewport === v.id} title={v.label} onClick={() => setViewport(v.id)}
                    className={cn('flex h-7 w-8 items-center justify-center rounded-[7px] transition', viewport === v.id ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73] hover:text-[#1D1D1F]')}>
                    <v.icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>

            <FormCanvas
              definition={definition}
              formName={form?.name || 'Untitled'}
              formDescription={form?.description}
              viewport={viewport}
              kind={kind}
              selectedElementId={selectedElementId}
              selectedSectionId={selectedSectionId}
              onSelectElement={setSelectedElementId}
              onSelectSection={setSelectedSectionId}
              onDuplicateElement={handleDuplicateElement}
              onRemoveElement={handleRemoveElement}
              onAddSection={() => handleAddSection(1)}
              onRemoveSection={handleRemoveSection}
              onToggleSectionVisibility={handleToggleSectionVisibility}
              onReorderElement={handleReorderElement}
              onDropNewElement={handleDropNewElement}
              currentPageIndex={currentPageIndex}
            />
          </div>

          <div className="w-[320px] shrink-0">
            <PropertyPanel
              definition={definition}
              selectedElementId={selectedElementId}
              selectedSectionId={selectedSectionId}
              formName={form?.name ?? ''}
              formDescription={form?.description ?? ''}
              onUpdateForm={updateForm}
              onUpdateHeader={(u) => change((d) => updateHeader(d, u))}
              onUpdateTheme={(u) => change((d) => updateTheme(d, u))}
              onOpenDesign={() => setTab('design')}
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
        <DesignStudio definition={definition} formName={form?.name || 'Untitled'} formDescription={form?.description} onUpdateTheme={(u) => change((d) => updateTheme(d, u))} />
      )}

      {tab === 'settings' && (
        <SettingsTab
          form={form}
          definition={definition}
          onUpdateForm={updateForm}
          onUpdateSettings={(u) => change((d) => updateSettings(d, u))}
          onUpdateHeader={(u) => change((d) => updateHeader(d, u))}
          onUpdateFooter={(u) => change((d) => updateFooter(d, u))}
          onOpenNotifications={() => setTab('notifications')}
          onUseInWorkflow={async () => { await saveNow(); openWorkflowForForm(formId, form?.name || 'Form', kind === 'survey'); }}
        />
      )}

      {tab === 'logic' && <LogicPanel definition={definition} onChange={(logic) => change((d) => ({ ...d, logic }))} />}
      {tab === 'notifications' && (
        <NotificationsPanel definition={definition} formName={form?.name || 'Untitled'} onUpdateNotifications={(u) => change((d) => updateNotifications(d, u))} />
      )}
      {tab === 'submissions' && <div className="flex-1 overflow-y-auto bg-white"><SubmissionsPanel formId={formId} definition={definition} isSurvey={kind === 'survey'} /></div>}

      {previewOpen && (
        <PreviewModal definition={definition} formName={form?.name || 'Untitled'} formDescription={form?.description} kind={kind}
          viewport={viewport} onViewportChange={setViewport} onClose={() => setPreviewOpen(false)} formId={formId} beforeSend={async () => { await saveNow(); }} />
      )}
    </div>
    </FormWorkspaceCtx.Provider>
  );
}

// ============================================================
// TOP BAR PIECES
// ============================================================

function IconBtn({ children, onClick, disabled, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title: string }) {
  return <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title} className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[#3A3A3C] transition hover:bg-black/[0.05] disabled:opacity-30">{children}</button>;
}

function BarBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-white px-3 text-[13px] font-medium text-[#1D1D1F] ring-1 ring-black/[0.1] transition hover:bg-[#F7F7F9]">{children}</button>;
}

function SaveState({ status }: { status: SaveStatus }) {
  const map = {
    saved: { text: 'All changes saved', cls: 'text-[#8E8E93]', icon: null },
    saving: { text: 'Saving…', cls: 'text-[#8E8E93]', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    unsaved: { text: 'Editing…', cls: 'text-[#8E8E93]', icon: null },
    error: { text: 'Not saved', cls: 'text-[#D70015]', icon: <AlertCircle className="h-3 w-3" /> },
  }[status];
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-[11px]', map.cls)} aria-live="polite">{map.icon}{map.text}</span>;
}

function PublishButton({ live, onPublish, onUnpublish }: { live: boolean; onPublish: () => void; onUnpublish: () => void }) {
  const [menu, setMenu] = useState(false);
  if (!live) {
    return <button type="button" onClick={onPublish} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[#1D1D1F] px-3.5 text-[13px] font-semibold text-white transition hover:bg-black"><Rocket className="h-3.5 w-3.5" /> Publish</button>;
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[#E8F7EC] px-3 text-[13px] font-semibold text-[#1B7F37] ring-1 ring-[#34C759]/30 transition hover:bg-[#DDF3E3]">
        <Globe className="h-3.5 w-3.5" /> Live <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
          <div className="absolute right-0 top-10 z-50 w-64 rounded-[14px] bg-white p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.06]">
            <p className="px-2.5 pb-1.5 pt-1 text-[12px] leading-snug text-[#6E6E73]">It’s taking responses. Changes you save go live straight away.</p>
            <button type="button" onClick={() => { setMenu(false); onUnpublish(); }} className="w-full rounded-[9px] px-2.5 py-2 text-left text-[13px] font-medium text-[#D70015] hover:bg-[#FFF0F0]">Unpublish (stop taking responses)</button>
          </div>
        </>
      )}
    </div>
  );
}

function SharePopover({ url, live, onPublish, onClose, toast }: { url: string; live: boolean; onPublish: () => void; onClose: () => void; toast: (m: string, t?: 'success' | 'error') => void }) {
  const embed = `<iframe src="${url}?embed=1" style="width:100%;min-height:720px;border:0" title="Form"></iframe>`;
  const copy = (text: string, what: string) => { void navigator.clipboard.writeText(text).then(() => toast(`${what} copied`), () => toast('Copy didn’t work; select the text and copy it', 'error')); };
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-10 z-50 w-[360px] rounded-[16px] bg-white p-4 shadow-[0_16px_48px_rgba(0,0,0,0.2)] ring-1 ring-black/[0.06]">
        <p className="text-[15px] font-semibold">Share</p>
        {!live && (
          <div className="mt-3 rounded-[12px] bg-[#FFF8E6] p-3 text-[12.5px] leading-relaxed text-[#8A5A00]">
            It’s a draft, so people who open the link are told it isn’t published yet.
            <button type="button" onClick={() => { onPublish(); onClose(); }} className="mt-1.5 block font-semibold text-[#0066CC] hover:underline">Publish now</button>
          </div>
        )}
        <p className="mb-1.5 mt-3.5 text-[12px] font-medium text-[#3A3A3C]">Link</p>
        <div className="flex gap-1.5">
          <input readOnly value={url} aria-label="Link" className={cn(inputCls, 'font-mono text-[12px]')} onFocus={(e) => e.target.select()} />
          <button type="button" onClick={() => copy(url, 'Link')} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[9px] bg-[#0071E3] px-3 text-[13px] font-semibold text-white hover:bg-[#0077ED]"><Copy className="h-3.5 w-3.5" /> Copy</button>
        </div>
        <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-[#0066CC] hover:underline">Open it <ExternalLink className="h-3 w-3" /></a>
        <p className="mb-1.5 mt-3.5 text-[12px] font-medium text-[#3A3A3C]">Embed on a website</p>
        <textarea readOnly value={embed} aria-label="Embed code" className={cn(areaCls, 'min-h-[64px] font-mono text-[11.5px]')} onFocus={(e) => e.target.select()} />
        <button type="button" onClick={() => copy(embed, 'Embed code')} className="mt-1.5 text-[12.5px] font-medium text-[#0066CC] hover:underline">Copy embed code</button>
        <p className="mt-3 text-[11.5px] leading-relaxed text-[#8E8E93]">Add <code className="rounded bg-[#F2F2F5] px-1">?email=…</code> or <code className="rounded bg-[#F2F2F5] px-1">?first_name=…</code> to the link to fill fields in for people.</p>
      </div>
    </>
  );
}

/** Page or slide tabs: pick, add, double-click to rename, × to delete (when there's more than one). */
function PageTabs({ pages, current, survey, onPick, onAdd, onRename, onRemove }: {
  pages: FormDefinition['pages']; current: number; survey: boolean;
  onPick: (i: number) => void; onAdd: () => void; onRename: (id: string, name: string) => void; onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1">
      {pages.map((p, i) => (
        <div key={p.id} className={cn('group flex h-8 shrink-0 items-center rounded-[9px] pl-3 text-[12.5px] font-medium transition', i === current ? 'bg-white text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.1)] ring-1 ring-black/[0.05]' : 'text-[#6E6E73] hover:bg-white/60')}>
          {editing === p.id ? (
            <input autoFocus defaultValue={p.name} aria-label="Page name" className="w-28 rounded bg-transparent text-[12.5px] outline-none"
              onBlur={(e) => { onRename(p.id, e.target.value.trim() || p.name); setEditing(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
          ) : (
            <button type="button" onClick={() => onPick(i)} onDoubleClick={() => setEditing(p.id)} title="Double-click to rename">{p.name}</button>
          )}
          {pages.length > 1 ? (confirm === p.id ? (
            <span className="ml-1.5 flex items-center gap-1 pr-1">
              <button type="button" onClick={() => { onRemove(p.id); setConfirm(null); }} className="rounded-[6px] bg-[#FF3B30] px-1.5 py-0.5 text-[11px] font-semibold text-white">Delete</button>
              <button type="button" onClick={() => setConfirm(null)} className="rounded-[6px] px-1 py-0.5 text-[11px]">Keep</button>
            </span>
          ) : (
            <button type="button" aria-label={`Delete ${p.name}`} onClick={() => setConfirm(p.id)} className="ml-1 mr-1 rounded-[6px] p-0.5 text-[#8E8E93] opacity-0 transition hover:bg-black/5 hover:text-[#D70015] group-hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
          )) : <span className="w-3" />}
        </div>
      ))}
      <button type="button" onClick={onAdd} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[9px] px-2.5 text-[12.5px] font-medium text-[#0066CC] hover:bg-white/60"><Plus className="h-3.5 w-3.5" /> {survey ? 'Slide' : 'Page'}</button>
    </div>
  );
}

// ============================================================
// SETTINGS TAB
// ============================================================

function SettingsTab({ form, definition, onUpdateForm, onUpdateSettings, onUpdateHeader, onUpdateFooter, onOpenNotifications, onUseInWorkflow }: {
  form: Form | null;
  definition: FormDefinition;
  onUpdateForm: (updates: { name?: string; description?: string }) => void;
  onUpdateSettings: (updates: Partial<FormDefinition['settings']>) => void;
  onUpdateHeader: (updates: Partial<FormDefinition['header']>) => void;
  onUpdateFooter: (updates: Partial<FormDefinition['footer']>) => void;
  onOpenNotifications: () => void;
  onUseInWorkflow: () => void;
}) {
  const s = definition.settings;
  const h = definition.header;
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-4 px-6 pb-28 pt-8">
        <h1 className="text-[26px] font-bold tracking-tight">Settings</h1>
        <Group title="Form">
          <Field label="Name"><input className={inputCls} value={form?.name || ''} onChange={(e) => onUpdateForm({ name: e.target.value })} /></Field>
          <Field label="Description"><textarea className={areaCls} value={form?.description || ''} onChange={(e) => onUpdateForm({ description: e.target.value })} /></Field>
        </Group>

        <Group title="Contacts" hint="Each response finds the contact by email (then phone), or makes a new one.">
          <SwitchRow label="Make a contact from each response" checked={s.createContact} onChange={(v) => onUpdateSettings({ createContact: v })} />
          <SwitchRow label="Update the contact if they’re already there" checked={s.updateContact} disabled={!s.createContact} onChange={(v) => onUpdateSettings({ updateContact: v })} />
        </Group>

        <Group title="After they submit" collapsible={false}>
          <p className="text-[13px] leading-relaxed text-[#6E6E73]">The thank-you page, a message, or a link to send people to, and the emails that go out, are in Notifications.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onOpenNotifications} className="h-9 rounded-[10px] bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:bg-black">Open Notifications</button>
            <button type="button" onClick={onUseInWorkflow} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-white px-4 text-[13px] font-semibold ring-1 ring-black/[0.1] hover:bg-[#F7F7F9]"><Workflow className="h-4 w-4" /> Use in a workflow</button>
          </div>
        </Group>

        <Group title="Header & footer">
          <SwitchRow label="Show the header" checked={h.enabled} onChange={(v) => onUpdateHeader({ enabled: v })} />
          <SwitchRow label="Title" checked={h.showTitle} disabled={!h.enabled} onChange={(v) => onUpdateHeader({ showTitle: v })} />
          <SwitchRow label="Description" checked={h.showDescription} disabled={!h.enabled} onChange={(v) => onUpdateHeader({ showDescription: v })} />
          <SwitchRow label="Progress" hint="For forms with more than one page, and surveys. Its look is in Design." checked={h.showProgress} disabled={!h.enabled} onChange={(v) => onUpdateHeader({ showProgress: v })} />
          <SwitchRow label="Footer text" checked={definition.footer.enabled} onChange={(v) => onUpdateFooter({ enabled: v })} />
          {definition.footer.enabled && <Field label="Footer"><textarea className={areaCls} value={definition.footer.content} onChange={(e) => onUpdateFooter({ content: e.target.value })} placeholder="e.g. We never share your details." /></Field>}
        </Group>

        <SettingsExtras definition={definition} kind={form?.type === 'survey' ? 'survey' : 'form'} workspaceId={form?.workspace_id ?? null} onUpdate={onUpdateSettings} />
      </div>
    </div>
  );
}

// ============================================================
// PREVIEW
// ============================================================

function PreviewModal({ definition, formName, formDescription, kind, viewport, onViewportChange, onClose, formId, beforeSend }: {
  kind: 'form' | 'survey';
  formId: string;
  /** Saves the builder's latest changes first. */
  beforeSend: () => Promise<void>;
  definition: FormDefinition;
  formName: string;
  formDescription?: string | null;
  viewport: Viewport;
  onViewportChange: (v: Viewport) => void;
  onClose: () => void;
}) {
  const [restart, setRestart] = useState(0);
  const [contactId, setContactId] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  // A real submission (source "preview"): makes or updates the contact and starts workflows,
  // like the live form, but works on drafts and never charges a card.
  const submit = async (p: FormPayload): Promise<SubmitOutcome> => {
    await beforeSend();
    const { data, error } = await supabase.functions.invoke('form-submit', {
      body: { mode: 'submit', preview: true, formId, answers: p.answers, disqualified: p.disqualified, trap: p.trap, source: 'preview' },
    });
    if (error || !data?.success) {
      let msg = data?.error as string | undefined;
      const ctx = (error as { context?: Response } | null)?.context;
      if (!msg && ctx && typeof ctx.json === 'function') { try { msg = (await ctx.json())?.error; } catch { /* not JSON */ } }
      return { ok: false, error: msg ?? 'The preview couldn’t be sent. Check that the form-submit function is deployed.' };
    }
    setContactId((data.contactId as string | null) ?? null);
    return { ok: true, checkoutUrl: null };
  };
  const width = viewport === 'mobile' ? 390 : viewport === 'tablet' ? 768 : 960;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#F2F2F5]">
      <div className="grid h-[58px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-black/[0.07] bg-white/85 px-4 backdrop-blur-xl">
        <p className="truncate text-[14px] font-semibold">Preview <span className="font-normal text-[#8E8E93]">· fill it in as people will</span></p>
        <div className="flex rounded-[10px] bg-[#EFEFF2] p-[3px]">
          {VIEWPORTS.map((v) => (
            <button key={v.id} type="button" title={v.label} aria-label={v.label} onClick={() => onViewportChange(v.id)}
              className={cn('flex h-7 w-9 items-center justify-center rounded-[7px] transition', viewport === v.id ? 'bg-white shadow-sm' : 'text-[#6E6E73]')}><v.icon className="h-4 w-4" /></button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          {contactId && <a href={`#/contacts/${contactId}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[#0071E3] px-3 text-[13px] font-semibold text-white hover:bg-[#0077ED]">Open the contact <ExternalLink className="h-3.5 w-3.5" /></a>}
          <button type="button" onClick={() => { setRestart((n) => n + 1); setContactId(null); }} className="inline-flex h-8 items-center rounded-[9px] bg-white px-3 text-[13px] font-medium ring-1 ring-black/[0.1] hover:bg-[#F7F7F9]">Start again</button>
          <button type="button" onClick={onClose} className="inline-flex h-8 items-center rounded-[9px] bg-[#1D1D1F] px-3.5 text-[13px] font-semibold text-white hover:bg-black">Done</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="mx-auto overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.08)] transition-[max-width] duration-300" style={{ maxWidth: `${width}px` }}>
          <FormPlayer key={restart} definition={definition} formName={formName} formDescription={formDescription} kind={kind}
            viewport={viewport} onSubmit={submit} formId={formId} initialAnswers={prefillAnswers(definition, new URLSearchParams())} />
        </div>
        <p className="mx-auto mt-4 max-w-lg text-center text-[12px] leading-relaxed text-[#8E8E93]">Sending it here saves a real response (marked “preview”), makes or updates the contact and starts this form’s workflows. Cards are never charged.</p>
      </div>
    </div>
  );
}
