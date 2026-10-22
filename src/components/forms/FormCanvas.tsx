import { useEffect, useState } from 'react';
import { Copy, EyeOff, Eye, GripVertical, Layers, Link2, Plus, Trash2, UserRound } from 'lucide-react';
import { ELEMENT_LIBRARY, CONTACT_FIELD_LABELS, type FormDefinition, type FormSection, type Viewport, type ElementType } from '@/lib/form-builder-types';
import { cn } from '@/lib/utils';
import { BuilderElement, FormHeader, formWidthOf, getBackgroundCSS, getButtonStyle, surfaceOf } from './FormRenderer';

interface FormCanvasProps {
  definition: FormDefinition;
  formName: string;
  formDescription?: string | null;
  viewport: Viewport;
  kind: 'form' | 'survey';
  selectedElementId: string | null;
  selectedSectionId: string | null;
  onSelectElement: (id: string | null) => void;
  onSelectSection: (id: string | null) => void;
  onDuplicateElement: (id: string) => void;
  onRemoveElement: (id: string) => void;
  onAddSection: () => void;
  onRemoveSection: (id: string) => void;
  onToggleSectionVisibility: (id: string) => void;
  /** Move an element to a position in a section (index in the section's list) and column (1-based). */
  onReorderElement: (elementId: string, toSectionId: string, toIndex: number, toColumn?: number) => void;
  /** A new element dragged in from the library. sectionId '' means the page has no section yet. */
  onDropNewElement?: (type: ElementType, sectionId: string, index: number, column: number) => void;
  currentPageIndex: number;
}

/** Where a drag would land: a section, a column (0-based) and a place in that column. */
type DragOver = { sectionId: string; column: number; index: number };

const LIBRARY_TYPES = new Set<string>(ELEMENT_LIBRARY.map((i) => i.type));
/** The element type dragged in from the library, if that's what this drag is. */
function libraryType(e: React.DragEvent): ElementType | null {
  const t = e.dataTransfer.getData('text/plain');
  return LIBRARY_TYPES.has(t) ? t as ElementType : null;
}

const WIDTHS: Record<Viewport, number> = { desktop: 9999, tablet: 768, mobile: 390 };

/**
 * The form as people will see it (same fonts, colours and fields), where elements are picked,
 * dragged into place and dropped in from the library.
 */
export function FormCanvas({
  definition, formName, formDescription, viewport, kind,
  selectedElementId, selectedSectionId, onSelectElement, onSelectSection,
  onDuplicateElement, onRemoveElement, onAddSection, onRemoveSection, onToggleSectionVisibility,
  onReorderElement, onDropNewElement, currentPageIndex,
}: FormCanvasProps) {
  const [dragElementId, setDragElementId] = useState<string | null>(null);
  const [over, setOver] = useState<DragOver | null>(null);
  const theme = definition.theme;
  const page = definition.pages[currentPageIndex];
  // Bring a newly added (or picked) element into view.
  useEffect(() => {
    if (!selectedElementId) return;
    const t = window.setTimeout(() => document.getElementById(`cv-${selectedElementId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
    return () => window.clearTimeout(t);
  }, [selectedElementId]);
  if (!page) return null;

  /** A drop in a section: `column` is 0-based, `index` counts within that column. */
  const drop = (e: React.DragEvent, section: FormSection, column: number, index: number, columnIds: string[]) => {
    e.preventDefault();
    e.stopPropagation();
    let at = index < columnIds.length ? section.elementIds.indexOf(columnIds[index])
      : columnIds.length ? section.elementIds.indexOf(columnIds[columnIds.length - 1]) + 1 : section.elementIds.length;
    if (at < 0) at = section.elementIds.length;
    const moving = dragElementId;
    const type = libraryType(e);
    if (moving) {
      // Moving down within the same section: the element leaves its old place first.
      const from = section.elementIds.indexOf(moving);
      if (from >= 0 && from < at) at -= 1;
      onReorderElement(moving, section.id, at, column + 1);
    } else if (type && onDropNewElement) {
      onDropNewElement(type, section.id, at, column + 1);
    }
    setDragElementId(null);
    setOver(null);
  };

  const isLastPage = currentPageIndex >= definition.pages.length - 1;
  const hasFields = Object.values(definition.elements).some((el) => el.field);
  const btnAlign = theme.buttonStyle.align === 'center' ? 'center' : theme.buttonStyle.align === 'right' ? 'flex-end' : 'flex-start';
  const width = Math.min(WIDTHS[viewport], 10000);

  return (
    <div className="flex-1 overflow-y-auto bg-[#F2F2F5]" onClick={() => { onSelectElement(null); onSelectSection(null); }}>
      <div className="mx-auto px-6 pb-32 pt-8 transition-[max-width] duration-300" style={{ maxWidth: viewport === 'desktop' ? undefined : `${width + 48}px` }}>
        <div className={cn('mx-auto overflow-hidden transition-all duration-300', viewport !== 'desktop' && 'rounded-[28px] shadow-[0_0_0_10px_#1D1D1F,0_24px_60px_rgba(0,0,0,0.25)]')}
          style={{ ...getBackgroundCSS(theme), maxWidth: viewport === 'desktop' ? undefined : `${width}px`, borderRadius: viewport === 'desktop' ? 18 : undefined }}>
          <div className="py-8" style={{ paddingLeft: viewport === 'mobile' ? 12 : 24, paddingRight: viewport === 'mobile' ? 12 : 24 }}>
            <div className="mx-auto overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(0,0,0,0.06)]"
              style={{ ...surfaceOf(theme), maxWidth: theme.layoutPreset === 'full_width' ? undefined : formWidthOf(theme), borderRadius: surfaceOf(theme).borderRadius ?? 16 }}>
              {definition.header.enabled && (
                <FormHeader definition={definition} formName={formName} formDescription={formDescription} currentPage={currentPageIndex} totalPages={definition.pages.length} />
              )}

              <div style={{ padding: `${theme.layout.pagePadding}px` }}>
                {page.sectionIds.length === 0 ? (
                  <div className={cn('rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors', over ? 'border-[#0071E3] bg-[#0071E3]/[0.04]' : 'border-[#D2D2D7]')}
                    onDragOver={(e) => { e.preventDefault(); setOver({ sectionId: '', column: 0, index: 0 }); }}
                    onDragLeave={() => setOver(null)}
                    onDrop={(e) => { e.preventDefault(); const t = libraryType(e); if (t && onDropNewElement) onDropNewElement(t, '', 0, 1); setOver(null); }}>
                    <Layers className="mx-auto mb-3 h-9 w-9 text-[#C7C7CC]" />
                    <p className="text-[15px] font-semibold text-[#1D1D1F]">This page is empty</p>
                    <p className="mt-1 text-[13px] text-[#6E6E73]">Drag an element here from the left, or</p>
                    <button type="button" onClick={(e) => { e.stopPropagation(); onAddSection(); }} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:bg-black"><Plus className="h-4 w-4" /> Add a section</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: `${theme.layout.sectionSpacing}px` }}>
                    {page.sectionIds.map((sectionId) => {
                      const section = definition.sections[sectionId];
                      if (!section) return null;
                      return (
                        <CanvasSection key={sectionId} section={section} definition={definition} viewport={viewport}
                          selectedElementId={selectedElementId} selected={selectedSectionId === section.id && !selectedElementId}
                          onSelectElement={onSelectElement} onSelectSection={onSelectSection}
                          onDuplicateElement={onDuplicateElement} onRemoveElement={onRemoveElement}
                          onRemoveSection={onRemoveSection} onToggleSectionVisibility={onToggleSectionVisibility}
                          onDragStart={setDragElementId} onDragEnd={() => { setDragElementId(null); setOver(null); }} onDrop={drop}
                          over={over} setOver={setOver} />
                      );
                    })}
                  </div>
                )}

                {/* What the bottom of the form shows (the real buttons are on the live form). */}
                {hasFields && (
                  <div className="pointer-events-none mt-8 flex gap-3 border-t pt-6" style={{ borderColor: theme.colors.border, justifyContent: currentPageIndex > 0 ? 'space-between' : btnAlign }}>
                    {currentPageIndex > 0 && <span style={getButtonStyle(theme, theme.buttonStyle, 'outline')} className="inline-flex items-center">Back</span>}
                    <span style={getButtonStyle(theme, theme.buttonStyle, undefined, theme.buttonStyle.width === 'full' && currentPageIndex === 0 ? '100%' : 'auto')} className="inline-flex items-center justify-center">
                      {isLastPage ? (kind === 'survey' ? 'Finish' : 'Submit') : 'Next'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <button type="button" onClick={(e) => { e.stopPropagation(); onAddSection(); }}
          className="mx-auto mt-5 flex h-10 items-center gap-1.5 rounded-full bg-white px-5 text-[13px] font-semibold text-[#1D1D1F] shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06] transition hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
          <Plus className="h-4 w-4" /> Add section
        </button>
      </div>
    </div>
  );
}

interface CanvasSectionProps {
  section: FormSection; definition: FormDefinition; viewport: Viewport;
  selectedElementId: string | null; selected: boolean;
  onSelectElement: (id: string | null) => void; onSelectSection: (id: string | null) => void;
  onDuplicateElement: (id: string) => void; onRemoveElement: (id: string) => void;
  onRemoveSection: (id: string) => void; onToggleSectionVisibility: (id: string) => void;
  onDragStart: (id: string) => void; onDragEnd: () => void;
  onDrop: (e: React.DragEvent, section: FormSection, column: number, index: number, columnIds: string[]) => void;
  over: DragOver | null;
  setOver: (info: DragOver | null) => void;
}

function CanvasSection({
  section, definition, viewport, selectedElementId, selected,
  onSelectElement, onSelectSection, onDuplicateElement, onRemoveElement, onRemoveSection, onToggleSectionVisibility,
  onDragStart, onDragEnd, onDrop, over, setOver,
}: CanvasSectionProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const theme = definition.theme;
  const cols = viewport === 'mobile' ? 1 : section.columnCount;
  const columns: string[][] = Array.from({ length: cols }, () => []);
  for (const elId of section.elementIds) {
    const el = definition.elements[elId];
    if (!el) continue;
    columns[viewport === 'mobile' ? 0 : Math.min((el.column ?? 1) - 1, cols - 1)].push(elId);
  }
  const st = section.style;
  const line = <div className="h-[3px] rounded-full bg-[#0071E3] shadow-[0_0_0_2px_rgba(0,113,227,0.15)]" />;

  return (
    <div
      className={cn('group/section relative rounded-[12px] transition-shadow', selected ? 'ring-2 ring-[#0071E3] ring-offset-4' : 'hover:ring-1 hover:ring-[#0071E3]/30 hover:ring-offset-4', !section.visible && 'opacity-45')}
      onClick={(e) => { e.stopPropagation(); onSelectSection(section.id); onSelectElement(null); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => onDrop(e, section, 0, columns[0].length, columns[0])}
      style={{ backgroundColor: st?.backgroundColor, backgroundImage: st?.backgroundImage ? `url(${st.backgroundImage})` : undefined, backgroundSize: st?.backgroundSize ?? 'cover', backgroundPosition: 'center', borderRadius: st?.borderRadius, padding: st?.padding }}>
      {st?.overlayColor && st.overlayOpacity !== undefined && st.backgroundImage && <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: st.overlayColor, opacity: st.overlayOpacity / 100, borderRadius: st.borderRadius }} />}

      {/* The section's own bar: shows on hover or when picked. */}
      <div className={cn('absolute -top-[30px] left-0 z-20 flex items-center gap-0.5 rounded-[9px] bg-[#1D1D1F] py-0.5 pl-2.5 pr-0.5 text-white shadow-lg transition-opacity', selected || confirmRemove ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover/section:pointer-events-auto group-hover/section:opacity-100')}>
        <span className="mr-1 text-[11.5px] font-semibold">{section.name}</span>
        <span className="mr-1.5 text-[11px] text-white/55">{section.columnCount === 1 ? '1 column' : `${section.columnCount} columns`}{!section.visible && ' · hidden'}</span>
        {confirmRemove ? (
          <>
            <span className="px-1 text-[11.5px] text-white/80">Delete it{section.elementIds.length ? ` and its ${section.elementIds.length} element${section.elementIds.length === 1 ? '' : 's'}` : ''}?</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveSection(section.id); }} className="h-6 rounded-[7px] bg-[#FF3B30] px-2 text-[11.5px] font-semibold">Delete</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmRemove(false); }} className="h-6 rounded-[7px] px-2 text-[11.5px] hover:bg-white/10">Keep</button>
          </>
        ) : (
          <>
            <button type="button" title={section.visible ? 'Hide this section' : 'Show this section'} onClick={(e) => { e.stopPropagation(); onToggleSectionVisibility(section.id); }} className="rounded-[7px] p-1.5 hover:bg-white/15">{section.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
            <button type="button" title="Delete this section" onClick={(e) => { e.stopPropagation(); if (section.elementIds.length) setConfirmRemove(true); else onRemoveSection(section.id); }} className="rounded-[7px] p-1.5 hover:bg-white/15"><Trash2 className="h-3.5 w-3.5" /></button>
          </>
        )}
      </div>

      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: `${theme.layout.columnGap}px` }}>
        {columns.map((ids, colIdx) => (
          <div key={colIdx} className="flex min-h-[56px] flex-col" style={{ gap: `${theme.layout.fieldSpacing}px` }}
            onDragOver={(e) => { e.preventDefault(); if (e.target === e.currentTarget) setOver({ sectionId: section.id, column: colIdx, index: ids.length }); }}
            onDrop={(e) => onDrop(e, section, colIdx, over?.sectionId === section.id && over.column === colIdx ? over.index : ids.length, ids)}>
            {ids.map((elId, i) => {
              const el = definition.elements[elId];
              if (!el) return null;
              const picked = selectedElementId === elId;
              const marker = over?.sectionId === section.id && over.column === colIdx && over.index === i;
              const unseen = el.type === 'hidden' || el.type === 'source';
              const notShown = el.field?.visible === false && !unseen;
              const mapped = el.field?.mappedContactField;
              return (
                <div key={elId} id={`cv-${elId}`} className="relative scroll-my-24">
                  {marker && <div className="absolute -top-[7px] left-0 right-0 z-10">{line}</div>}
                  <div draggable
                    onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('application/x-synapse-element', elId); e.dataTransfer.effectAllowed = 'move'; onDragStart(elId); }}
                    onDragEnd={onDragEnd}
                    onDragOver={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      // Top half: before this element; bottom half: after it.
                      const r = e.currentTarget.getBoundingClientRect();
                      setOver({ sectionId: section.id, column: colIdx, index: e.clientY > r.top + r.height / 2 ? i + 1 : i });
                    }}
                    onClick={(e) => { e.stopPropagation(); onSelectElement(elId); onSelectSection(section.id); }}
                    className={cn('group/el relative -m-2 cursor-pointer rounded-[10px] p-2 transition-all',
                      picked ? 'bg-[#0071E3]/[0.04] ring-2 ring-[#0071E3]' : 'hover:ring-1 hover:ring-[#0071E3]/45',
                      notShown && 'opacity-50')}>
                    {/* Picked: move, copy, delete. */}
                    <div className={cn('absolute -top-3 right-2 z-20 flex items-center gap-0.5 rounded-[8px] bg-[#0071E3] p-0.5 text-white shadow-md', picked ? 'flex' : 'hidden')}>
                      <span title="Drag to move" className="cursor-grab rounded-[6px] p-1 hover:bg-white/15"><GripVertical className="h-3.5 w-3.5" /></span>
                      <button type="button" title="Duplicate" onClick={(e) => { e.stopPropagation(); onDuplicateElement(elId); }} className="rounded-[6px] p-1 hover:bg-white/15"><Copy className="h-3.5 w-3.5" /></button>
                      <button type="button" title="Delete" onClick={(e) => { e.stopPropagation(); onRemoveElement(elId); }} className="rounded-[6px] p-1 hover:bg-white/15"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                    {unseen ? (
                      <div className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-[#C7C7CC] bg-[#FAFAFB] px-3 py-2.5 text-[13px] text-[#6E6E73]">
                        {el.type === 'source' ? <Link2 className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        <span className="font-medium text-[#3A3A3C]">{el.field?.label}</span>
                        <span>· not shown on the form{el.field?.queryKey ? ` · filled from ?${el.field.queryKey}=` : ''}</span>
                      </div>
                    ) : (
                      <div className="pointer-events-none"><BuilderElement element={el} definition={definition} /></div>
                    )}
                    {(mapped || notShown) && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {mapped && <span className="inline-flex items-center gap-1 rounded-full bg-[#E9F3FF] px-2 py-0.5 text-[10.5px] font-semibold text-[#0062C4]"><UserRound className="h-3 w-3" /> Saves to contact · {CONTACT_FIELD_LABELS[mapped]}</span>}
                        {notShown && <span className="inline-flex items-center gap-1 rounded-full bg-[#F2F2F5] px-2 py-0.5 text-[10.5px] font-semibold text-[#6E6E73]"><EyeOff className="h-3 w-3" /> Not visible</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {ids.length > 0 && over?.sectionId === section.id && over.column === colIdx && over.index === ids.length && line}
            {ids.length === 0 && (
              <div className={cn('flex min-h-[64px] items-center justify-center rounded-[12px] border-2 border-dashed text-[12px] font-medium transition-colors',
                over?.sectionId === section.id && over.column === colIdx ? 'border-[#0071E3] bg-[#0071E3]/[0.05] text-[#0062C4]' : 'border-[#D2D2D7] text-[#8E8E93]')}>
                Drop an element here
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
