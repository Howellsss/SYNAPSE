import { useState } from 'react';
import {
  Monitor, Tablet, Smartphone, Plus, Copy, Trash2, GripVertical,
  Eye, EyeOff, Layers, Image as ImageIcon,
} from 'lucide-react';
import { ELEMENT_LIBRARY, type FormDefinition, type FormSection, type FormElement, type Viewport, type ElementType } from '@/lib/form-builder-types';
import { cn } from '@/lib/utils';

interface FormCanvasProps {
  definition: FormDefinition;
  formName: string;
  formDescription?: string | null;
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

export function FormCanvas({
  definition, formName, formDescription,
  selectedElementId, selectedSectionId,
  onSelectElement, onSelectSection,
  onDuplicateElement, onRemoveElement,
  onAddSection, onRemoveSection, onToggleSectionVisibility,
  onReorderElement, onDropNewElement,
  currentPageIndex,
}: FormCanvasProps) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [dragElementId, setDragElementId] = useState<string | null>(null);
  const [dragOverInfo, setDragOverInfo] = useState<DragOver | null>(null);

  const page = definition.pages[currentPageIndex];
  if (!page) return null;

  /** A drop in a section: `column` is 0-based, `index` counts within that column. */
  const handleDrop = (e: React.DragEvent, section: FormSection, column: number, index: number, columnIds: string[]) => {
    e.preventDefault();
    e.stopPropagation();
    // Where that is in the section's own list.
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
    setDragOverInfo(null);
  };

  const handleDropOnEmptyPage = (e: React.DragEvent) => {
    e.preventDefault();
    const type = libraryType(e);
    if (type && onDropNewElement) onDropNewElement(type, '', 0, 1);
    setDragOverInfo(null);
  };

  return (
    <div className="flex flex-col h-full bg-ivory-50/30">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-navy-100 bg-white">
        <div className="flex items-center gap-1 rounded-lg border border-navy-100 overflow-hidden">
          {(['desktop', 'tablet', 'mobile'] as Viewport[]).map(vp => {
            const Icon = vp === 'desktop' ? Monitor : vp === 'tablet' ? Tablet : Smartphone;
            return <button key={vp} onClick={() => setViewport(vp)} className={cn('p-2 transition-colors', viewport === vp ? 'bg-navy-800 text-ivory-100' : 'text-ivory-600 hover:bg-ivory-50')} title={vp}><Icon className="w-4 h-4" /></button>;
          })}
        </div>
        <p className="text-xs text-ivory-500">WYSIWYG Canvas</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex justify-center">
        <div className="w-full" style={{ maxWidth: viewport === 'mobile' ? '375px' : viewport === 'tablet' ? '768px' : '800px' }}>
          <div className="bg-white rounded-xl shadow-sm border border-navy-100 overflow-hidden" onClick={() => { onSelectElement(null); onSelectSection(null); }} style={{ fontFamily: definition.theme.fontFamily }}>
            {definition.header.enabled && (
              <div className="px-6 pt-8 pb-3 sm:px-8 border-b" style={{ borderColor: definition.theme.inputBorderColor }}>
                {definition.header.showLogo && definition.header.logoUrl && <img src={definition.header.logoUrl} alt="Logo" className="h-10 w-auto mb-4" />}
                {definition.header.showTitle && <h1 className="text-2xl font-bold tracking-tight" style={{ color: definition.theme.primaryColor }}>{formName}</h1>}
                {definition.header.showDescription && formDescription && <p className="mt-1.5 text-sm" style={{ color: '#64748b' }}>{formDescription}</p>}
              </div>
            )}

            <div className="px-6 py-6 sm:px-8 sm:py-8">
              {page.sectionIds.length === 0 ? (
                <div className={cn('text-center py-16 rounded-lg border-2 border-dashed', dragOverInfo ? 'border-gold-400 bg-gold-50/30' : 'border-transparent')}
                  onDragOver={e => { e.preventDefault(); setDragOverInfo({ sectionId: '', column: 0, index: 0 }); }}
                  onDragLeave={() => setDragOverInfo(null)}
                  onDrop={handleDropOnEmptyPage}>
                  <Layers className="w-10 h-10 mx-auto text-ivory-300 mb-3" />
                  <p className="text-sm text-ivory-600 mb-4">This page is empty. Drag an element here, or</p>
                  <button onClick={onAddSection} className="btn-primary btn-sm"><Plus className="w-4 h-4" /> Add Section</button>
                </div>
              ) : (
                <>
                  {page.sectionIds.map(sectionId => {
                    const section = definition.sections[sectionId];
                    if (!section || !section.visible) return null;
                    return (
                      <CanvasSection
                        key={sectionId} section={section} definition={definition} viewport={viewport}
                        selectedElementId={selectedElementId} selectedSectionId={selectedSectionId}
                        onSelectElement={onSelectElement} onSelectSection={onSelectSection}
                        onDuplicateElement={onDuplicateElement} onRemoveElement={onRemoveElement}
                        onRemoveSection={onRemoveSection} onToggleSectionVisibility={onToggleSectionVisibility}
                        onDragStart={setDragElementId} onDragEnd={() => { setDragElementId(null); setDragOverInfo(null); }} onDrop={handleDrop}
                        dragOverInfo={dragOverInfo} setDragOverInfo={setDragOverInfo}
                      />
                    );
                  })}
                  <button onClick={onAddSection} className="w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed border-navy-100 text-ivory-500 hover:border-gold-400 hover:text-gold-700 hover:bg-gold-50/30 transition-all text-sm font-medium">
                    <Plus className="w-4 h-4" /> Add Section
                  </button>
                </>
              )}
            </div>

            {definition.footer.enabled && definition.footer.content && (
              <div className="px-6 py-4 sm:px-8 text-center text-xs" style={{ color: '#94a3b8' }}>{definition.footer.content}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface CanvasSectionProps {
  section: FormSection; definition: FormDefinition; viewport: Viewport;
  selectedElementId: string | null; selectedSectionId: string | null;
  onSelectElement: (id: string | null) => void; onSelectSection: (id: string | null) => void;
  onDuplicateElement: (id: string) => void; onRemoveElement: (id: string) => void;
  onRemoveSection: (id: string) => void; onToggleSectionVisibility: (id: string) => void;
  onDragStart: (id: string) => void; onDragEnd: () => void;
  onDrop: (e: React.DragEvent, section: FormSection, column: number, index: number, columnIds: string[]) => void;
  dragOverInfo: DragOver | null;
  setDragOverInfo: (info: DragOver | null) => void;
}

/** Where a drag would land: a section, a column (0-based) and a place in that column. */
type DragOver = { sectionId: string; column: number; index: number };

const LIBRARY_TYPES = new Set<string>(ELEMENT_LIBRARY.map((i) => i.type));
/** The element type dragged in from the library, if that's what this drag is. */
function libraryType(e: React.DragEvent): ElementType | null {
  const t = e.dataTransfer.getData('text/plain');
  return LIBRARY_TYPES.has(t) ? t as ElementType : null;
}

function CanvasSection({
  section, definition, viewport,
  selectedElementId, selectedSectionId,
  onSelectElement, onSelectSection,
  onDuplicateElement, onRemoveElement,
  onRemoveSection, onToggleSectionVisibility,
  onDragStart, onDragEnd, onDrop,
  dragOverInfo, setDragOverInfo,
}: CanvasSectionProps) {
  const isSectionSelected = selectedSectionId === section.id;
  const effectiveColumnCount = viewport === 'mobile' ? 1 : section.columnCount;
  const columns: string[][] = Array.from({ length: effectiveColumnCount }, () => []);
  for (const elId of section.elementIds) {
    const el = definition.elements[elId];
    if (!el) continue;
    const col = viewport === 'mobile' ? 0 : Math.min((el.column ?? 1) - 1, effectiveColumnCount - 1);
    columns[col].push(elId);
  }
  const style = section.style;

  return (
    <div
      className={cn('relative mb-6 last:mb-0 group/section', isSectionSelected && 'ring-2 ring-gold-400 rounded-lg')}
      onClick={e => { e.stopPropagation(); onSelectSection(section.id); }}
      onDragOver={e => { e.preventDefault(); }}
      onDrop={e => onDrop(e, section, 0, columns[0].length, columns[0])}
      style={{ backgroundColor: style?.backgroundColor, backgroundImage: style?.backgroundImage ? `url(${style.backgroundImage})` : undefined, backgroundSize: style?.backgroundSize, borderRadius: style?.borderRadius, padding: style?.padding }}
    >
      {style?.overlayColor && style?.overlayOpacity !== undefined && style?.backgroundImage && (
        <div className="absolute inset-0" style={{ backgroundColor: style.overlayColor, opacity: style.overlayOpacity / 100, borderRadius: style?.borderRadius, pointerEvents: 'none' }} />
      )}

      <div className={cn('flex items-center justify-between px-2 py-1.5 -mt-1 mb-1 rounded-md relative', isSectionSelected ? 'bg-gold-50' : 'bg-transparent opacity-0 group-hover/section:opacity-100')}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-navy-700">{section.name}</span>
          <span className="text-[10px] text-ivory-500">{section.columnCount} col · {section.elementIds.length} elements</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={e => { e.stopPropagation(); onToggleSectionVisibility(section.id); }} className="p-1 rounded hover:bg-white text-ivory-500">{section.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}</button>
          <button onClick={e => { e.stopPropagation(); onRemoveSection(section.id); }} className="p-1 rounded hover:bg-red-50 text-ivory-500 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>

      <div className={cn('relative', effectiveColumnCount === 2 && 'grid grid-cols-1 sm:grid-cols-2 gap-4', effectiveColumnCount === 3 && 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4', effectiveColumnCount === 1 && 'space-y-4')}>
        {columns.map((colElementIds, colIdx) => (
          <div
            key={colIdx} className="space-y-3 min-h-[40px]"
            onDragOver={e => { e.preventDefault(); if (e.target === e.currentTarget) setDragOverInfo({ sectionId: section.id, column: colIdx, index: colElementIds.length }); }}
            onDrop={e => {
              const over = dragOverInfo?.sectionId === section.id && dragOverInfo.column === colIdx ? dragOverInfo.index : colElementIds.length;
              onDrop(e, section, colIdx, over, colElementIds);
            }}
          >
            {colElementIds.map((elId, elIdx) => {
              const el = definition.elements[elId];
              if (!el) return null;
              const isSelected = selectedElementId === elId;
              const isDragOver = dragOverInfo?.sectionId === section.id && dragOverInfo.column === colIdx && dragOverInfo.index === elIdx;
              return (
                <div key={elId}>
                  {isDragOver && <div className="h-0.5 bg-gold-400 rounded-full mb-1" />}
                  <div
                    draggable
                    onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('application/x-synapse-element', elId); e.dataTransfer.effectAllowed = 'move'; onDragStart(elId); }}
                    onDragEnd={onDragEnd}
                    onDragOver={e => {
                      e.preventDefault(); e.stopPropagation();
                      // Top half: before this element; bottom half: after it.
                      const r = e.currentTarget.getBoundingClientRect();
                      setDragOverInfo({ sectionId: section.id, column: colIdx, index: e.clientY > r.top + r.height / 2 ? elIdx + 1 : elIdx });
                    }}
                    onClick={e => { e.stopPropagation(); onSelectElement(elId); }}
                    className={cn('relative group/el rounded-lg transition-all cursor-pointer', isSelected ? 'ring-2 ring-gold-400 ring-offset-1' : 'hover:ring-1 hover:ring-navy-200')}
                  >
                    {isSelected && (
                      <div className="absolute -top-8 left-0 flex items-center gap-1 bg-white rounded-md shadow-popover px-1 py-0.5 z-10">
                        <GripVertical className="w-3 h-3 text-ivory-400 cursor-grab" />
                        <button onClick={e => { e.stopPropagation(); onDuplicateElement(elId); }} className="p-1 hover:bg-ivory-50 rounded text-ivory-600"><Copy className="w-3 h-3" /></button>
                        <button onClick={e => { e.stopPropagation(); onRemoveElement(elId); }} className="p-1 hover:bg-red-50 rounded text-ivory-600 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    )}
                    <CanvasElement element={el} definition={definition} viewport={viewport} />
                  </div>
                </div>
              );
            })}
            {colElementIds.length > 0 && dragOverInfo?.sectionId === section.id && dragOverInfo.column === colIdx && dragOverInfo.index === colElementIds.length && <div className="h-0.5 bg-gold-400 rounded-full" />}
            {colElementIds.length === 0 && (
              <div className={cn('min-h-[60px] rounded-lg border-2 border-dashed flex items-center justify-center text-xs', dragOverInfo?.sectionId === section.id && dragOverInfo.column === colIdx ? 'border-gold-400 bg-gold-50/30 text-gold-700' : 'border-navy-100 text-ivory-400')}>Drop elements here</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CanvasElement({ element, definition }: { element: FormElement; definition: FormDefinition; viewport: Viewport }) {
  const theme = definition.theme;
  const c = element.content;
  const f = element.field;
  const style = element.style;
  const elementStyle: React.CSSProperties = { color: style?.textColor, fontSize: style?.fontSize, fontWeight: style?.fontWeight, textAlign: style?.textAlign, backgroundColor: style?.backgroundColor, borderRadius: style?.borderRadius, padding: style?.padding };
  const inputBase = "w-full px-3.5 py-2.5 text-sm border rounded-lg bg-white pointer-events-none";
  const inputStyle: React.CSSProperties = { borderColor: theme.inputBorderColor, borderRadius: theme.inputBorderRadius };

  if (element.type === 'heading') {
    const level = c?.headingLevel ?? 'h2';
    const sizes: Record<string, string> = { h1: 'text-2xl', h2: 'text-xl', h3: 'text-lg', h4: 'text-base' };
    const Tag = level as 'h1' | 'h2' | 'h3' | 'h4';
    return <div style={elementStyle}><Tag className={cn(sizes[level], 'font-bold')} style={{ color: style?.textColor || theme.primaryColor }}>{c?.text || 'Heading'}</Tag></div>;
  }
  if (element.type === 'text') return <div style={elementStyle}><p className="text-sm font-medium" style={{ color: style?.textColor || theme.primaryColor }}>{c?.text || 'Text'}</p></div>;
  if (element.type === 'paragraph') return <div style={elementStyle}><p className="text-sm leading-relaxed" style={{ color: style?.textColor || '#64748b' }}>{c?.text || 'Paragraph text.'}</p></div>;
  if (element.type === 'image') return c?.imageUrl ? <img src={c.imageUrl} alt={c.altText || ''} className="w-full" style={{ borderRadius: style?.borderRadius, objectFit: style?.objectFit || 'cover' }} /> : <div className="rounded-lg border-2 border-dashed border-navy-200 bg-ivory-50 flex items-center justify-center py-12 text-sm text-ivory-400"><ImageIcon className="w-5 h-5 mr-2" /> Upload an image</div>;
  if (element.type === 'logo') return c?.imageUrl ? <img src={c.imageUrl} alt="Logo" className="h-10 w-auto" /> : <div className="h-10 w-32 rounded bg-ivory-100 flex items-center justify-center text-xs text-ivory-400">Logo</div>;
  if (element.type === 'divider') return <hr style={{ borderStyle: c?.dividerStyle || 'solid', borderColor: '#e2e8f0', borderWidth: '0 0 1px 0' }} />;
  if (element.type === 'spacer') return <div style={{ height: `${c?.spacerHeight ?? 24}px` }} />;
  if (element.type === 'button') return <div style={{ textAlign: style?.textAlign || 'left' }}><button type="button" className="px-5 py-2.5 font-semibold text-sm pointer-events-none" style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor, borderRadius: theme.borderRadius, width: style?.width === 'full' ? '100%' : 'auto' }}>{c?.buttonText || 'Button'}</button></div>;
  if (!f) return null;

  return (
    <div style={elementStyle}>
      <label className="block text-sm font-medium mb-1.5" style={{ color: '#334155' }}>{f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}</label>
      {f.description && <p className="text-xs text-slate-500 mb-2">{f.description}</p>}
      <FieldPreview element={element} f={f} inputBase={inputBase} inputStyle={inputStyle} theme={theme} />
    </div>
  );
}

function FieldPreview({ element, f, inputBase, inputStyle, theme }: {
  element: FormElement; f: NonNullable<FormElement['field']>; inputBase: string; inputStyle: React.CSSProperties; theme: { primaryColor: string };
}) {
  const type = element.type;
  if (type === 'long_text' || type === 'address') return <textarea className={cn(inputBase, 'min-h-[80px] resize-y')} style={inputStyle} placeholder={f.placeholder} disabled />;
  if (type === 'radio' || type === 'yes_no') return <div className="space-y-1.5">{(f.options || ['Yes', 'No']).map((opt, i) => <div key={i} className="flex items-center gap-2.5 text-sm"><input type="radio" disabled className="w-4 h-4 pointer-events-none" style={{ accentColor: theme.primaryColor }} /><span style={{ color: '#334155' }}>{opt}</span></div>)}</div>;
  if (type === 'checkbox' || type === 'multi_select') return <div className="space-y-1.5">{(f.options || []).map((opt, i) => <div key={i} className="flex items-center gap-2.5 text-sm"><input type="checkbox" disabled className="w-4 h-4 pointer-events-none" style={{ accentColor: theme.primaryColor }} /><span style={{ color: '#334155' }}>{opt}</span></div>)}</div>;
  if (type === 'dropdown') return <select className={inputBase} style={inputStyle} disabled><option value="">Select...</option>{(f.options || []).map((o, i) => <option key={i}>{o}</option>)}</select>;
  if (type === 'consent') return <div className="flex items-start gap-2.5 text-sm"><input type="checkbox" disabled className="w-4 h-4 mt-0.5 pointer-events-none" style={{ accentColor: theme.primaryColor }} /><span style={{ color: '#334155' }}>{element.content?.text || 'I agree to be contacted regarding my submission.'}</span></div>;
  if (type === 'rating') return <div className="flex items-center gap-1.5 pointer-events-none">{Array.from({ length: element.content?.maxRating ?? 5 }, (_, i) => <span key={i} className="text-2xl text-gray-300">★</span>)}</div>;
  if (type === 'scale') { const min = element.content?.scaleMin ?? 1; const max = element.content?.scaleMax ?? 10; return <div className="flex flex-wrap gap-2 pointer-events-none">{Array.from({ length: max - min + 1 }, (_, i) => <span key={i} className="w-10 h-10 rounded-lg border text-sm flex items-center justify-center" style={{ borderColor: '#e2e8f0', color: '#334155' }}>{min + i}</span>)}</div>; }
  if (type === 'file_upload') return <div className="rounded-lg border-2 border-dashed py-8 text-center pointer-events-none" style={{ borderColor: '#e2e8f0' }}><p className="text-sm text-ivory-400">Click to upload or drag and drop</p></div>;
  if (type === 'signature') return <div className="rounded-lg border-2 border-dashed py-8 text-center pointer-events-none" style={{ borderColor: '#e2e8f0' }}><p className="text-sm text-ivory-400">Signature pad</p></div>;
  if (type === 'hidden') return null;
  const inputType = type === 'email' ? 'email' : type === 'phone' ? 'tel' : type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'time' ? 'time' : type === 'website' ? 'url' : 'text';
  return <input type={inputType} className={inputBase} style={inputStyle} placeholder={f.placeholder} disabled />;
}
