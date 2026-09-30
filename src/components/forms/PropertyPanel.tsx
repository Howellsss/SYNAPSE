import { useState } from 'react';
import { Copy, Trash2, X, Plus, GripVertical } from 'lucide-react';
import type { FormDefinition, FormElement, FieldDefinition, ElementContent, ElementStyle, ColumnCount } from '@/lib/form-builder-types';
import { cn } from '@/lib/utils';

interface PropertyPanelProps {
  definition: FormDefinition;
  selectedElementId: string | null;
  selectedSectionId: string | null;
  onUpdateElement: (id: string, updates: Partial<FormElement>) => void;
  onUpdateElementField: (id: string, updates: Partial<FieldDefinition>) => void;
  onUpdateElementContent: (id: string, updates: Partial<ElementContent>) => void;
  onUpdateElementStyle: (id: string, updates: Partial<ElementStyle>) => void;
  onUpdateSection: (id: string, updates: Partial<{ name: string; visible: boolean; columnCount: ColumnCount; style?: ElementStyle }>) => void;
  onDuplicateElement: (id: string) => void;
  onRemoveElement: (id: string) => void;
  onDeselect: () => void;
}

export function PropertyPanel({
  definition, selectedElementId, selectedSectionId,
  onUpdateElementField, onUpdateElementContent, onUpdateElementStyle,
  onUpdateSection, onDuplicateElement, onRemoveElement, onDeselect,
}: PropertyPanelProps) {
  const [tab, setTab] = useState<'general' | 'style'>('general');
  const element = selectedElementId ? definition.elements[selectedElementId] : null;
  const section = selectedSectionId ? definition.sections[selectedSectionId] : null;

  if (!element && !section) return <EmptyPanel />;

  return (
    <div className="flex flex-col h-full bg-white border-l border-navy-100">
      <div className="px-4 py-3 border-b border-navy-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy-800">{element ? element.displayLabel : 'Section'}</h3>
        <button onClick={onDeselect} className="p-1 rounded hover:bg-ivory-50 text-ivory-500"><X className="w-4 h-4" /></button>
      </div>

      {element && (
        <>
          <div className="flex items-center gap-1 px-3 pt-2 border-b border-navy-100">
            <TabBtn active={tab === 'general'} onClick={() => setTab('general')}>General</TabBtn>
            <TabBtn active={tab === 'style'} onClick={() => setTab('style')}>Style</TabBtn>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-navy-100">
            <button onClick={() => onDuplicateElement(element.id)} className="btn-ghost btn-sm text-xs"><Copy className="w-3 h-3" /> Duplicate</button>
            <button onClick={() => onRemoveElement(element.id)} className="btn-ghost btn-sm text-xs text-red-500 hover:bg-red-50"><Trash2 className="w-3 h-3" /> Delete</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {tab === 'general' && <GeneralTab element={element} onUpdateElementField={onUpdateElementField} onUpdateElementContent={onUpdateElementContent} />}
            {tab === 'style' && <StyleTab element={element} onUpdateElementStyle={onUpdateElementStyle} />}
          </div>
        </>
      )}

      {section && !element && <SectionProperties section={section} onUpdate={onUpdateSection} />}
    </div>
  );
}

function EmptyPanel() {
  return (
    <div className="flex flex-col h-full bg-white border-l border-navy-100">
      <div className="px-4 py-3 border-b border-navy-100"><h3 className="text-sm font-semibold text-navy-800">Properties</h3></div>
      <div className="flex-1 flex items-center justify-center px-6 text-center"><p className="text-sm text-ivory-500">Select an element to configure its properties</p></div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={cn('px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors', active ? 'border-gold-500 text-navy-800' : 'border-transparent text-ivory-500 hover:text-navy-700')}>{children}</button>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-navy-600 mb-1.5">{label}</label>{children}</div>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <button onClick={() => onChange(!checked)} className={cn('relative w-10 h-5 rounded-full transition-colors', checked ? 'bg-gold-500' : 'bg-ivory-200')}><span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} /></button>;
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <div className="flex items-center gap-2"><input type="color" value={value || '#ffffff'} onChange={e => onChange(e.target.value)} className="w-8 h-8 rounded border border-navy-100 cursor-pointer" /><input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="No color" className="input-field flex-1 text-sm" /></div>;
}

// ============================================================
// GENERAL TAB
// ============================================================

function GeneralTab({ element, onUpdateElementField, onUpdateElementContent }: {
  element: FormElement;
  onUpdateElementField: (id: string, updates: Partial<FieldDefinition>) => void;
  onUpdateElementContent: (id: string, updates: Partial<ElementContent>) => void;
}) {
  const f = element.field;
  const c = element.content;

  if (element.type === 'heading') {
    return <><Field label="Heading text"><input className="input-field" value={c?.text || ''} onChange={e => onUpdateElementContent(element.id, { text: e.target.value })} /></Field><Field label="Heading level"><select className="input-field" value={c?.headingLevel || 'h2'} onChange={e => onUpdateElementContent(element.id, { headingLevel: e.target.value as 'h1' | 'h2' | 'h3' | 'h4' })}><option value="h1">H1 (Largest)</option><option value="h2">H2</option><option value="h3">H3</option><option value="h4">H4 (Smallest)</option></select></Field></>;
  }
  if (element.type === 'text' || element.type === 'paragraph') return <Field label="Text content"><textarea className="input-field min-h-[80px] resize-y" value={c?.text || ''} onChange={e => onUpdateElementContent(element.id, { text: e.target.value })} /></Field>;
  if (element.type === 'button') {
    return <><Field label="Button text"><input className="input-field" value={c?.buttonText || ''} onChange={e => onUpdateElementContent(element.id, { buttonText: e.target.value })} /></Field><Field label="Action"><select className="input-field" value={c?.buttonAction || 'submit'} onChange={e => onUpdateElementContent(element.id, { buttonAction: e.target.value as 'submit' | 'next' | 'previous' | 'open_url' | 'navigate_page' })}><option value="submit">Submit Form</option><option value="next">Next Page</option><option value="previous">Previous Page</option><option value="open_url">Open URL</option></select></Field>{c?.buttonAction === 'open_url' && <Field label="URL"><input className="input-field" value={c?.buttonUrl || ''} onChange={e => onUpdateElementContent(element.id, { buttonUrl: e.target.value })} placeholder="https://" /></Field>}</>;
  }
  if (element.type === 'image' || element.type === 'logo') {
    return <><Field label="Image URL"><input className="input-field" value={c?.imageUrl || ''} onChange={e => onUpdateElementContent(element.id, { imageUrl: e.target.value })} placeholder="https://example.com/image.png" /></Field><Field label="Alt text"><input className="input-field" value={c?.altText || ''} onChange={e => onUpdateElementContent(element.id, { altText: e.target.value })} /></Field>{element.type === 'image' && <><Field label="Link URL (optional)"><input className="input-field" value={c?.linkUrl || ''} onChange={e => onUpdateElementContent(element.id, { linkUrl: e.target.value })} placeholder="https://" /></Field></>}</>;
  }
  if (element.type === 'divider') return <Field label="Divider style"><select className="input-field" value={c?.dividerStyle || 'solid'} onChange={e => onUpdateElementContent(element.id, { dividerStyle: e.target.value as 'solid' | 'dashed' | 'dotted' })}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></Field>;
  if (element.type === 'spacer') return <Field label={`Height: ${c?.spacerHeight ?? 24}px`}><input type="range" min="8" max="96" value={c?.spacerHeight ?? 24} onChange={e => onUpdateElementContent(element.id, { spacerHeight: Number(e.target.value) })} className="w-full" /></Field>;
  if (element.type === 'rating') return <><Field label={`Max rating: ${c?.maxRating ?? 5}`}><input type="range" min="3" max="10" value={c?.maxRating ?? 5} onChange={e => onUpdateElementContent(element.id, { maxRating: Number(e.target.value) })} className="w-full" /></Field><Field label="Symbol"><select className="input-field" value={c?.ratingSymbol || 'star'} onChange={e => onUpdateElementContent(element.id, { ratingSymbol: e.target.value as 'star' | 'heart' | 'circle' })}><option value="star">Stars</option><option value="heart">Hearts</option><option value="circle">Circles</option></select></Field></>;
  if (element.type === 'scale') return <><div className="grid grid-cols-2 gap-3"><Field label="Min value"><input type="number" className="input-field" value={c?.scaleMin ?? 1} onChange={e => onUpdateElementContent(element.id, { scaleMin: Number(e.target.value) })} /></Field><Field label="Max value"><input type="number" className="input-field" value={c?.scaleMax ?? 10} onChange={e => onUpdateElementContent(element.id, { scaleMax: Number(e.target.value) })} /></Field></div><Field label="Min label"><input className="input-field" value={c?.scaleMinLabel || ''} onChange={e => onUpdateElementContent(element.id, { scaleMinLabel: e.target.value })} /></Field><Field label="Max label"><input className="input-field" value={c?.scaleMaxLabel || ''} onChange={e => onUpdateElementContent(element.id, { scaleMaxLabel: e.target.value })} /></Field></>;

  if (!f) return null;
  const isChoice = ['radio', 'checkbox', 'dropdown', 'multi_select'].includes(element.type);

  return (
    <div className="space-y-4">
      <Field label="Field label"><input className="input-field" value={f.label} onChange={e => onUpdateElementField(element.id, { label: e.target.value })} /></Field>
      <Field label="Description (optional)"><input className="input-field" value={f.description || ''} onChange={e => onUpdateElementField(element.id, { description: e.target.value })} placeholder="Help text shown below the field" /></Field>
      {element.type !== 'consent' && element.type !== 'hidden' && element.type !== 'date' && element.type !== 'time' && <Field label="Placeholder (optional)"><input className="input-field" value={f.placeholder || ''} onChange={e => onUpdateElementField(element.id, { placeholder: e.target.value })} /></Field>}
      <label className="flex items-center justify-between cursor-pointer"><span className="text-sm font-medium text-navy-700">Required</span><Toggle checked={f.required} onChange={v => onUpdateElementField(element.id, { required: v })} /></label>
      {element.type !== 'hidden' && <label className="flex items-center justify-between cursor-pointer"><span className="text-sm font-medium text-navy-700">Visible</span><Toggle checked={f.visible !== false} onChange={v => onUpdateElementField(element.id, { visible: v })} /></label>}
      {element.type !== 'consent' && element.type !== 'hidden' && <Field label="Default value (optional)"><input className="input-field" value={f.defaultValue || ''} onChange={e => onUpdateElementField(element.id, { defaultValue: e.target.value })} /></Field>}
      {isChoice && <ChoiceOptionsEditor options={f.options || []} allowOther={f.allowOther || false} onOptionsChange={opts => onUpdateElementField(element.id, { options: opts })} onAllowOtherChange={v => onUpdateElementField(element.id, { allowOther: v })} />}
      {element.type === 'consent' && <Field label="Consent text"><textarea className="input-field min-h-[60px] resize-y" value={element.content?.text || ''} onChange={e => onUpdateElementContent(element.id, { text: e.target.value })} /></Field>}
      {['first_name', 'last_name', 'email', 'phone', 'text_field'].includes(element.type) && <Field label="Map to contact field"><select className="input-field" value={f.mappedContactField || ''} onChange={e => onUpdateElementField(element.id, { mappedContactField: (e.target.value || null) as FieldDefinition['mappedContactField'] })}><option value="">No mapping</option><option value="first_name">Contact First Name</option><option value="last_name">Contact Last Name</option><option value="email">Contact Email</option><option value="phone">Contact Phone</option><option value="company">Contact Company</option><option value="job_title">Contact Job Title</option></select></Field>}
      {['text_field', 'long_text', 'number'].includes(element.type) && <ValidationEditor element={element} onUpdate={onUpdateElementField} />}
      {element.type === 'file_upload' && <><Field label="Allowed file types (comma separated)"><input className="input-field" value={(f.allowedFileTypes || []).join(', ')} onChange={e => onUpdateElementField(element.id, { allowedFileTypes: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="pdf, jpg, png" /></Field><Field label="Max file size (MB)"><input type="number" className="input-field" value={f.maxFileSizeMB || ''} onChange={e => onUpdateElementField(element.id, { maxFileSizeMB: Number(e.target.value) || undefined })} /></Field></>}
    </div>
  );
}

// ============================================================
// STYLE TAB
// ============================================================

function StyleTab({ element, onUpdateElementStyle }: { element: FormElement; onUpdateElementStyle: (id: string, updates: Partial<ElementStyle>) => void }) {
  const s = element.style || {};
  return (
    <div className="space-y-4">
      <Field label="Text color"><ColorInput value={s.textColor || ''} onChange={v => onUpdateElementStyle(element.id, { textColor: v })} /></Field>
      <Field label="Background color"><ColorInput value={s.backgroundColor || ''} onChange={v => onUpdateElementStyle(element.id, { backgroundColor: v })} /></Field>
      <Field label="Text alignment"><select className="input-field" value={s.textAlign || 'left'} onChange={e => onUpdateElementStyle(element.id, { textAlign: e.target.value as 'left' | 'center' | 'right' })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></Field>
      <Field label="Font size"><input className="input-field" value={s.fontSize || ''} onChange={e => onUpdateElementStyle(element.id, { fontSize: e.target.value })} placeholder="e.g. 14px, 1.25rem" /></Field>
      <Field label="Font weight"><select className="input-field" value={s.fontWeight || 'normal'} onChange={e => onUpdateElementStyle(element.id, { fontWeight: e.target.value as 'normal' | 'medium' | 'semibold' | 'bold' })}><option value="normal">Normal</option><option value="medium">Medium</option><option value="semibold">Semibold</option><option value="bold">Bold</option></select></Field>
      <Field label="Width"><select className="input-field" value={s.width || 'full'} onChange={e => onUpdateElementStyle(element.id, { width: e.target.value as 'full' | 'half' | 'third' | 'auto' })}><option value="full">Full width</option><option value="half">Half width</option><option value="third">Third width</option><option value="auto">Auto</option></select></Field>
      <Field label="Border radius"><input className="input-field" value={s.borderRadius || ''} onChange={e => onUpdateElementStyle(element.id, { borderRadius: e.target.value })} placeholder="e.g. 8px" /></Field>
      <Field label="Padding"><input className="input-field" value={s.padding || ''} onChange={e => onUpdateElementStyle(element.id, { padding: e.target.value })} placeholder="e.g. 16px" /></Field>
      <Field label="Margin bottom"><input className="input-field" value={s.marginBottom || ''} onChange={e => onUpdateElementStyle(element.id, { marginBottom: e.target.value })} placeholder="e.g. 16px" /></Field>
    </div>
  );
}

// ============================================================
// SECTION PROPERTIES
// ============================================================

function SectionProperties({ section, onUpdate }: { section: import('@/lib/form-builder-types').FormSection; onUpdate: (id: string, updates: Partial<{ name: string; visible: boolean; columnCount: ColumnCount; style?: ElementStyle }>) => void }) {
  const s = section.style || {};
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      <Field label="Section name"><input className="input-field" value={section.name} onChange={e => onUpdate(section.id, { name: e.target.value })} /></Field>
      <Field label="Column layout">
        <div className="grid grid-cols-3 gap-2">
          {([1, 2, 3] as ColumnCount[]).map(n => <button key={n} onClick={() => onUpdate(section.id, { columnCount: n })} className={cn('py-2 rounded-lg text-sm font-medium border transition-all', section.columnCount === n ? 'bg-navy-800 text-ivory-100 border-navy-800' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}>{n} col</button>)}
        </div>
      </Field>
      <label className="flex items-center justify-between cursor-pointer"><span className="text-sm font-medium text-navy-700">Visible</span><Toggle checked={section.visible} onChange={v => onUpdate(section.id, { visible: v })} /></label>
      <div className="border-t border-navy-100 pt-4 space-y-4">
        <p className="text-xs font-bold uppercase tracking-wider text-ivory-500">Section Style</p>
        <Field label="Background color"><ColorInput value={s.backgroundColor || ''} onChange={v => onUpdate(section.id, { style: { ...s, backgroundColor: v } })} /></Field>
        <Field label="Background image URL"><input className="input-field" value={s.backgroundImage || ''} onChange={e => onUpdate(section.id, { style: { ...s, backgroundImage: e.target.value } })} placeholder="https://" /></Field>
        {s.backgroundImage && <><Field label="Background size"><select className="input-field" value={s.backgroundSize || 'cover'} onChange={e => onUpdate(section.id, { style: { ...s, backgroundSize: e.target.value as 'cover' | 'contain' | 'auto' } })}><option value="cover">Cover</option><option value="contain">Contain</option><option value="auto">Auto</option></select></Field><Field label={`Overlay opacity: ${s.overlayOpacity ?? 0}%`}><input type="range" min="0" max="100" value={s.overlayOpacity ?? 0} onChange={e => onUpdate(section.id, { style: { ...s, overlayOpacity: Number(e.target.value) } })} className="w-full" /></Field><Field label="Overlay color"><ColorInput value={s.overlayColor || ''} onChange={v => onUpdate(section.id, { style: { ...s, overlayColor: v } })} /></Field></>}
        <Field label="Border radius"><input className="input-field" value={s.borderRadius || ''} onChange={e => onUpdate(section.id, { style: { ...s, borderRadius: e.target.value } })} placeholder="e.g. 12px" /></Field>
        <Field label="Padding"><input className="input-field" value={s.padding || ''} onChange={e => onUpdate(section.id, { style: { ...s, padding: e.target.value } })} placeholder="e.g. 24px" /></Field>
      </div>
    </div>
  );
}

// ============================================================
// CHOICE OPTIONS EDITOR
// ============================================================

function ChoiceOptionsEditor({ options, allowOther, onOptionsChange, onAllowOtherChange }: { options: string[]; allowOther: boolean; onOptionsChange: (opts: string[]) => void; onAllowOtherChange: (v: boolean) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-navy-600 mb-1.5">Options</label>
      <div className="space-y-2">
        {options.map((opt, i) => <div key={i} className="flex items-center gap-2"><GripVertical className="w-3 h-3 text-ivory-300 shrink-0" /><input className="input-field flex-1 text-sm" value={opt} onChange={e => { const next = [...options]; next[i] = e.target.value; onOptionsChange(next); }} /><button onClick={() => onOptionsChange(options.filter((_, idx) => idx !== i))} className="p-1 text-ivory-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button></div>)}
        <button onClick={() => onOptionsChange([...options, `Option ${options.length + 1}`])} className="flex items-center gap-1.5 text-xs font-medium text-gold-700 hover:text-gold-600"><Plus className="w-3.5 h-3.5" /> Add option</button>
      </div>
      <label className="flex items-center justify-between mt-3 cursor-pointer"><span className="text-xs font-medium text-navy-600">Allow "Other" option</span><Toggle checked={allowOther} onChange={onAllowOtherChange} /></label>
    </div>
  );
}

// ============================================================
// VALIDATION EDITOR
// ============================================================

function ValidationEditor({ element, onUpdate }: { element: FormElement; onUpdate: (id: string, updates: Partial<FieldDefinition>) => void }) {
  const v = element.field?.validation || {};
  const isText = ['text_field', 'long_text'].includes(element.type);
  return (
    <div className="border-t border-navy-100 pt-4 space-y-3">
      <p className="text-xs font-bold uppercase tracking-wider text-ivory-500">Validation</p>
      <div className="grid grid-cols-2 gap-3">
        {isText ? <><Field label="Min length"><input type="number" className="input-field" value={v.minLength ?? ''} onChange={e => onUpdate(element.id, { validation: { ...v, minLength: Number(e.target.value) || undefined } })} /></Field><Field label="Max length"><input type="number" className="input-field" value={v.maxLength ?? ''} onChange={e => onUpdate(element.id, { validation: { ...v, maxLength: Number(e.target.value) || undefined } })} /></Field></> : <><Field label="Min value"><input type="number" className="input-field" value={v.minValue ?? ''} onChange={e => onUpdate(element.id, { validation: { ...v, minValue: Number(e.target.value) || undefined } })} /></Field><Field label="Max value"><input type="number" className="input-field" value={v.maxValue ?? ''} onChange={e => onUpdate(element.id, { validation: { ...v, maxValue: Number(e.target.value) || undefined } })} /></Field></>}
      </div>
    </div>
  );
}
