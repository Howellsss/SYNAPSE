import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, X } from 'lucide-react';
import {
  CONTACT_FIELD_LABELS, ELEMENT_LIBRARY,
  type ColumnCount, type ContactFieldKey, type ElementContent, type ElementStyle, type FieldDefinition,
  type FormDefinition, type FormElement, type FormHeader, type FormSection, type FormTheme, type QuizSettings,
} from '@/lib/form-builder-types';
import { LinkKeyEditor, PaymentEditor, QuizScoringEditor } from './FieldExtras';
import { ImagePicker } from './ImagePicker';
import { ColorField, Field, Group, PanelButton, Segmented, SwitchRow, areaCls, inputCls } from './builder-ui';
import { cn } from '@/lib/utils';

interface PropertyPanelProps {
  definition: FormDefinition;
  selectedElementId: string | null;
  selectedSectionId: string | null;
  formName: string;
  formDescription: string;
  onUpdateForm: (updates: { name?: string; description?: string }) => void;
  onUpdateHeader: (updates: Partial<FormHeader>) => void;
  onUpdateTheme: (updates: Partial<FormTheme>) => void;
  onOpenDesign: () => void;
  onUpdateElement: (id: string, updates: Partial<FormElement>) => void;
  onUpdateElementField: (id: string, updates: Partial<FieldDefinition>) => void;
  onUpdateElementContent: (id: string, updates: Partial<ElementContent>) => void;
  onUpdateElementStyle: (id: string, updates: Partial<ElementStyle>) => void;
  onUpdateSection: (id: string, updates: Partial<{ name: string; visible: boolean; columnCount: ColumnCount; style?: ElementStyle }>) => void;
  onDuplicateElement: (id: string) => void;
  onRemoveElement: (id: string) => void;
  onDeselect: () => void;
}

/** Text-like fields whose answer can be saved to a contact field. */
const MAPPABLE = new Set(['first_name', 'last_name', 'full_name', 'email', 'phone', 'company', 'job_title', 'date_of_birth', 'text_field', 'website', 'hidden']);
const PLACEHOLDER = new Set(['first_name', 'last_name', 'full_name', 'email', 'phone', 'company', 'job_title', 'text_field', 'long_text', 'number', 'monetary', 'website', 'address', 'city', 'state', 'postal_code', 'country', 'dropdown']);
const CHOICE = new Set(['radio', 'checkbox', 'dropdown', 'multi_select', 'yes_no']);
const UNSEEN = new Set(['hidden', 'source']);
const CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud', 'ngn', 'ghs', 'kes', 'zar', 'inr', 'aed'];
const numOrUndef = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

export function PropertyPanel(props: PropertyPanelProps) {
  const { definition, selectedElementId, selectedSectionId, onDuplicateElement, onRemoveElement, onDeselect } = props;
  const [tab, setTab] = useState<'settings' | 'style'>('settings');
  const element = selectedElementId ? definition.elements[selectedElementId] : null;
  const section = !element && selectedSectionId ? definition.sections[selectedSectionId] : null;
  const item = element ? ELEMENT_LIBRARY.find((i) => i.type === element.type) : null;

  const head = (title: string, sub: string) => (
    <div className="flex items-start justify-between gap-2 border-b border-black/[0.06] px-4 pb-3 pt-3.5">
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-[#1D1D1F]">{title}</p>
        <p className="text-[12px] text-[#8E8E93]">{sub}</p>
      </div>
      <button type="button" onClick={onDeselect} aria-label="Close" className="rounded-full p-1.5 text-[#8E8E93] hover:bg-black/5"><X className="h-4 w-4" /></button>
    </div>
  );

  return (
    <div className="flex h-full flex-col border-l border-black/[0.06] bg-[#FBFBFD]">
      {element ? (
        <>
          {head(element.field?.label || element.displayLabel, item?.label ?? element.displayLabel)}
          <div className="flex items-center gap-1 px-3 pt-3">
            <Segmented size="sm" className="flex-1" value={tab} onChange={setTab} options={[{ value: 'settings', label: 'Settings' }, { value: 'style', label: 'Style' }]} />
            <PanelButton title="Duplicate" onClick={() => onDuplicateElement(element.id)} className="!px-2"><Copy className="h-4 w-4" /></PanelButton>
            <PanelButton title="Delete" tone="danger" onClick={() => onRemoveElement(element.id)} className="!px-2"><Trash2 className="h-4 w-4" /></PanelButton>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-3 pb-24">
            {tab === 'settings' ? <ElementSettings element={element} quiz={definition.settings.quiz} {...props} /> : <StyleSettings element={element} onUpdate={props.onUpdateElementStyle} />}
          </div>
        </>
      ) : section ? (
        <>
          {head(section.name, 'Section')}
          <div className="flex-1 space-y-3 overflow-y-auto p-3 pb-24"><SectionSettings section={section} onUpdate={props.onUpdateSection} /></div>
        </>
      ) : (
        <>
          <div className="border-b border-black/[0.06] px-4 pb-3 pt-3.5">
            <p className="text-[15px] font-semibold text-[#1D1D1F]">Form</p>
            <p className="text-[12px] text-[#8E8E93]">Click anything on the form to change it</p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-3 pb-24"><FormSettingsPanel {...props} /></div>
        </>
      )}
    </div>
  );
}

// ---------- nothing picked: the form itself ----------

function FormSettingsPanel({ definition, formName, formDescription, onUpdateForm, onUpdateHeader, onUpdateTheme, onOpenDesign }: PropertyPanelProps) {
  const h = definition.header;
  const t = definition.theme;
  return (
    <>
      <Group title="Details">
        <Field label="Name"><input className={inputCls} value={formName} onChange={(e) => onUpdateForm({ name: e.target.value })} /></Field>
        <Field label="Description" hint="Shown under the title."><textarea className={areaCls} value={formDescription} onChange={(e) => onUpdateForm({ description: e.target.value })} /></Field>
      </Group>
      <Group title="Header">
        <SwitchRow label="Show the header" checked={h.enabled} onChange={(v) => onUpdateHeader({ enabled: v })} />
        {h.enabled && (
          <>
            <SwitchRow label="Title" checked={h.showTitle} onChange={(v) => onUpdateHeader({ showTitle: v })} />
            <SwitchRow label="Description" checked={h.showDescription} onChange={(v) => onUpdateHeader({ showDescription: v })} />
            <SwitchRow label="Progress (forms with steps)" checked={h.showProgress} onChange={(v) => { onUpdateHeader({ showProgress: v }); if (v && !t.progress.show) onUpdateTheme({ progress: { ...t.progress, show: true } }); }} />
            <ImagePicker label="Logo" compact value={t.branding.logoUrl} onChange={(url) => onUpdateTheme({ branding: { ...t.branding, logoUrl: url } })} />
          </>
        )}
      </Group>
      <Group title="Look" collapsible={false}>
        <p className="text-[12.5px] leading-relaxed text-[#6E6E73]">Colours, fonts, buttons, backgrounds and layout are in Design.</p>
        <button type="button" onClick={onOpenDesign} className="h-9 w-full rounded-[10px] bg-[#1D1D1F] text-[13px] font-semibold text-white hover:bg-black">Open Design</button>
      </Group>
    </>
  );
}

// ---------- an element ----------

function ElementSettings({ element, quiz, onUpdateElementField, onUpdateElementContent }: PropertyPanelProps & { element: FormElement; quiz?: QuizSettings }) {
  const f = element.field;
  const c = element.content;
  const setF = (u: Partial<FieldDefinition>) => onUpdateElementField(element.id, u);
  const setC = (u: Partial<ElementContent>) => onUpdateElementContent(element.id, u);
  const type = element.type;

  // Content elements.
  if (type === 'heading') return (
    <Group title="Heading" collapsible={false}>
      <Field label="Text"><input className={inputCls} value={c?.text || ''} onChange={(e) => setC({ text: e.target.value })} /></Field>
      <Field label="Size"><Segmented size="sm" value={c?.headingLevel || 'h2'} onChange={(v) => setC({ headingLevel: v })} options={[{ value: 'h1', label: 'XL' }, { value: 'h2', label: 'L' }, { value: 'h3', label: 'M' }, { value: 'h4', label: 'S' }]} /></Field>
    </Group>
  );
  if (type === 'text' || type === 'paragraph') return (
    <Group title={type === 'text' ? 'Text' : 'Paragraph'} collapsible={false}>
      <Field label="Words"><textarea className={cn(areaCls, 'min-h-[120px]')} value={c?.text || ''} onChange={(e) => setC({ text: e.target.value })} /></Field>
    </Group>
  );
  if (type === 'image' || type === 'logo') return (
    <Group title={type === 'image' ? 'Image' : 'Logo'} collapsible={false}>
      <ImagePicker label={type === 'image' ? 'Picture' : 'Logo'} compact={type === 'logo'} value={c?.imageUrl} onChange={(url) => setC({ imageUrl: url })} />
      <Field label="Description for screen readers" hint="What the picture shows, for people who can’t see it."><input className={inputCls} value={c?.altText || ''} onChange={(e) => setC({ altText: e.target.value })} /></Field>
      {type === 'image' && <Field label="Opens a link when clicked (optional)"><input className={inputCls} value={c?.linkUrl || ''} onChange={(e) => setC({ linkUrl: e.target.value })} placeholder="https://" /></Field>}
    </Group>
  );
  if (type === 'divider') return (
    <Group title="Divider" collapsible={false}>
      <Field label="Line"><Segmented size="sm" value={c?.dividerStyle || 'solid'} onChange={(v) => setC({ dividerStyle: v })} options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }]} /></Field>
    </Group>
  );
  if (type === 'spacer') return (
    <Group title="Spacer" collapsible={false}>
      <Field label={`Height · ${c?.spacerHeight ?? 24} px`}><input type="range" min={8} max={120} value={c?.spacerHeight ?? 24} onChange={(e) => setC({ spacerHeight: Number(e.target.value) })} className="w-full accent-[#0071E3]" /></Field>
    </Group>
  );
  if (type === 'button') return (
    <Group title="Button" collapsible={false}>
      <Field label="Label"><input className={inputCls} value={c?.buttonText || ''} onChange={(e) => setC({ buttonText: e.target.value })} /></Field>
      <Field label="When clicked">
        <select className={inputCls} value={c?.buttonAction || 'submit'} onChange={(e) => setC({ buttonAction: e.target.value as ElementContent['buttonAction'] })}>
          <option value="submit">Submit the form</option><option value="next">Go to the next step</option><option value="previous">Go back a step</option><option value="open_url">Open a link</option>
        </select>
      </Field>
      {c?.buttonAction === 'open_url' && <Field label="Link"><input className={inputCls} value={c?.buttonUrl || ''} onChange={(e) => setC({ buttonUrl: e.target.value })} placeholder="https://" /></Field>}
    </Group>
  );
  if (!f) return <p className="p-2 text-[13px] text-[#8E8E93]">Nothing to set here.</p>;

  const unseen = UNSEEN.has(type);
  return (
    <>
      <Group title="Basics">
        <Field label={unseen ? 'Name (for you)' : 'Label'}><input className={inputCls} value={f.label} onChange={(e) => setF({ label: e.target.value })} /></Field>
        {!unseen && type !== 'captcha' && <Field label="Help text (optional)"><input className={inputCls} value={f.description || ''} onChange={(e) => setF({ description: e.target.value })} placeholder="Shown under the label" /></Field>}
        {PLACEHOLDER.has(type) && <Field label="Placeholder"><input className={inputCls} value={f.placeholder || ''} onChange={(e) => setF({ placeholder: e.target.value })} /></Field>}
        {!unseen && type !== 'captcha' && type !== 'payment' && <SwitchRow label="Required" hint={type === 'consent' ? 'They must tick it to send the form.' : undefined} checked={f.required} onChange={(v) => setF({ required: v })} />}
        {!unseen && type !== 'captcha' && <SwitchRow label="Visible" hint="Turn off to hide it (logic can still show it)." checked={f.visible !== false} onChange={(v) => setF({ visible: v })} />}
        {type === 'captcha' && <p className="text-[12px] leading-relaxed text-[#6E6E73]">People answer a small sum before sending. It stops most automated spam, on top of the hidden trap every form has.</p>}
      </Group>

      {type === 'consent' && (
        <Group title="Agreement">
          <Field label="What they agree to"><textarea className={areaCls} value={c?.text || ''} onChange={(e) => setC({ text: e.target.value })} placeholder="I agree to the terms and privacy policy." /></Field>
        </Group>
      )}

      {CHOICE.has(type) && (
        <Group title="Options">
          <OptionsEditor options={f.options?.length ? f.options : type === 'yes_no' ? ['Yes', 'No'] : []} onChange={(options) => setF({ options })} />
          {type !== 'yes_no' && <SwitchRow label="“Other” with their own answer" checked={!!f.allowOther} onChange={(v) => setF({ allowOther: v })} />}
        </Group>
      )}

      {type === 'rating' && (
        <Group title="Rating">
          <Field label={`Out of ${c?.maxRating ?? 5}`}><input type="range" min={3} max={10} value={c?.maxRating ?? 5} onChange={(e) => setC({ maxRating: Number(e.target.value) })} className="w-full accent-[#0071E3]" /></Field>
          <Field label="Symbol"><Segmented size="sm" value={c?.ratingSymbol || 'star'} onChange={(v) => setC({ ratingSymbol: v })} options={[{ value: 'star', label: '★ Stars' }, { value: 'heart', label: '♥ Hearts' }, { value: 'circle', label: '● Dots' }]} /></Field>
        </Group>
      )}
      {type === 'scale' && (
        <Group title="Scale">
          <div className="grid grid-cols-3 gap-2">
            <Field label="From"><input type="number" className={inputCls} value={c?.scaleMin ?? 1} onChange={(e) => setC({ scaleMin: Number(e.target.value) })} /></Field>
            <Field label="To"><input type="number" className={inputCls} value={c?.scaleMax ?? 10} onChange={(e) => setC({ scaleMax: Number(e.target.value) })} /></Field>
            <Field label="Step"><input type="number" min={0.5} step={0.5} className={inputCls} value={c?.scaleStep ?? 1} onChange={(e) => setC({ scaleStep: Math.max(0.5, Number(e.target.value) || 1) })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Low end says"><input className={inputCls} value={c?.scaleMinLabel || ''} onChange={(e) => setC({ scaleMinLabel: e.target.value })} placeholder="Not likely" /></Field>
            <Field label="High end says"><input className={inputCls} value={c?.scaleMaxLabel || ''} onChange={(e) => setC({ scaleMaxLabel: e.target.value })} placeholder="Very likely" /></Field>
          </div>
          <PanelButton tone="accent" onClick={() => setC({ scaleMin: 0, scaleMax: 10, scaleStep: 1, scaleMinLabel: 'Not at all likely', scaleMaxLabel: 'Extremely likely' })}>Make it an NPS (0–10)</PanelButton>
        </Group>
      )}

      {type === 'monetary' && (
        <Group title="Amount">
          <Field label="Currency">
            <select className={inputCls} value={f.currency || 'usd'} onChange={(e) => setF({ currency: e.target.value })}>{CURRENCIES.map((cur) => <option key={cur} value={cur}>{cur.toUpperCase()}</option>)}</select>
          </Field>
          <MinMax label="Amount" v={f.validation} onChange={(validation) => setF({ validation })} />
        </Group>
      )}
      {type === 'number' && <Group title="Limits"><MinMax label="Number" v={f.validation} onChange={(validation) => setF({ validation })} /></Group>}
      {['text_field', 'long_text'].includes(type) && <TextRules f={f} onChange={setF} />}

      {type === 'file_upload' && (
        <Group title="Files">
          <Field label="Allowed types" hint="Comma separated, e.g. pdf, jpg, png. Leave empty for any file.">
            <input className={inputCls} value={(f.allowedFileTypes || []).join(', ')} onChange={(e) => setF({ allowedFileTypes: e.target.value.split(',').map((x) => x.trim().replace(/^\./, '')).filter(Boolean) })} placeholder="pdf, jpg, png" />
          </Field>
          <Field label="Largest file (MB, up to 10)"><input type="number" min={1} max={10} className={inputCls} value={f.maxFileSizeMB ?? 10} onChange={(e) => setF({ maxFileSizeMB: Math.min(10, Math.max(1, Number(e.target.value) || 10)) })} /></Field>
          <SwitchRow label="More than one file" checked={!!f.allowMultipleFiles} onChange={(v) => setF({ allowMultipleFiles: v })} />
        </Group>
      )}

      {type === 'payment' && <PaymentEditor element={element} onUpdate={onUpdateElementField} />}
      {quiz?.enabled && CHOICE.has(type) && <QuizScoringEditor element={element} quiz={quiz} onUpdate={onUpdateElementField} />}

      {MAPPABLE.has(type) && (
        <Group title="Contact" hint="The answer is saved on the contact that the form makes or updates.">
          <Field label="Save the answer to">
            <select className={inputCls} value={f.mappedContactField || ''} onChange={(e) => setF({ mappedContactField: (e.target.value || null) as ContactFieldKey | null })}>
              <option value="">Don’t save to the contact</option>
              {(Object.keys(CONTACT_FIELD_LABELS) as ContactFieldKey[]).map((k) => <option key={k} value={k}>{CONTACT_FIELD_LABELS[k]}</option>)}
            </select>
          </Field>
        </Group>
      )}

      {type !== 'payment' && type !== 'captcha' && type !== 'signature' && type !== 'file_upload' && (
        <Group title="Advanced" defaultOpen={unseen}>
          {type !== 'consent' && (
            <Field label={unseen ? 'Value (when the link doesn’t give one)' : 'Pre-filled answer (optional)'}>
              <input className={inputCls} value={f.defaultValue || ''} onChange={(e) => setF({ defaultValue: e.target.value })} placeholder={CHOICE.has(type) ? 'One of the options' : undefined} />
            </Field>
          )}
          <LinkKeyEditor element={element} onUpdate={onUpdateElementField} />
        </Group>
      )}
    </>
  );
}

function MinMax({ label, v, onChange }: { label: string; v: FieldDefinition['validation']; onChange: (v: FieldDefinition['validation']) => void }) {
  const val = v || {};
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={`Smallest ${label.toLowerCase()}`}><input type="number" className={inputCls} value={val.minValue ?? ''} onChange={(e) => onChange({ ...val, minValue: numOrUndef(e.target.value) })} placeholder="None" /></Field>
      <Field label={`Largest ${label.toLowerCase()}`}><input type="number" className={inputCls} value={val.maxValue ?? ''} onChange={(e) => onChange({ ...val, maxValue: numOrUndef(e.target.value) })} placeholder="None" /></Field>
    </div>
  );
}

function TextRules({ f, onChange }: { f: FieldDefinition; onChange: (u: Partial<FieldDefinition>) => void }) {
  const val = f.validation || {};
  const set = (u: Partial<NonNullable<FieldDefinition['validation']>>) => onChange({ validation: { ...val, ...u } });
  return (
    <Group title="Rules" defaultOpen={!!(val.minLength || val.maxLength || val.pattern)}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Fewest characters"><input type="number" min={0} className={inputCls} value={val.minLength ?? ''} onChange={(e) => set({ minLength: numOrUndef(e.target.value) })} placeholder="None" /></Field>
        <Field label="Most characters"><input type="number" min={0} className={inputCls} value={val.maxLength ?? ''} onChange={(e) => set({ maxLength: numOrUndef(e.target.value) })} placeholder="None" /></Field>
      </div>
      <Field label="Must match (pattern, optional)" hint="For example ^[A-Z]{2}\d{4}$ for two letters and four digits.">
        <input className={cn(inputCls, 'font-mono text-[12px]')} value={val.pattern || ''} onChange={(e) => set({ pattern: e.target.value || undefined })} />
      </Field>
      {val.pattern && <Field label="Message when it doesn’t match"><input className={inputCls} value={val.patternMessage || ''} onChange={(e) => set({ patternMessage: e.target.value || undefined })} placeholder="This doesn’t look right." /></Field>}
    </Group>
  );
}

/** Options, one per row: rename, reorder, remove, add. Commas can't be used (they separate picks). */
function OptionsEditor({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  const [warn, setWarn] = useState(false);
  const set = (i: number, text: string) => {
    if (text.includes(',')) setWarn(true);
    const next = [...options]; next[i] = text.replace(/,/g, ''); onChange(next);
  };
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= options.length) return; const next = [...options]; [next[i], next[j]] = [next[j], next[i]]; onChange(next); };
  return (
    <div className="space-y-1.5">
      {options.map((opt, i) => (
        <div key={i} className="group flex items-center gap-1">
          <input className={cn(inputCls, 'flex-1')} value={opt} onChange={(e) => set(i, e.target.value)} aria-label={`Option ${i + 1}`} />
          <div className="flex opacity-50 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="rounded-md p-1 text-[#6E6E73] hover:bg-black/5 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="Move down" disabled={i === options.length - 1} onClick={() => move(i, 1)} className="rounded-md p-1 text-[#6E6E73] hover:bg-black/5 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="Remove" onClick={() => onChange(options.filter((_, j) => j !== i))} className="rounded-md p-1 text-[#6E6E73] hover:bg-[#FFF0F0] hover:text-[#D70015]"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      ))}
      <PanelButton tone="accent" onClick={() => onChange([...options, `Option ${options.length + 1}`])}><Plus className="h-3.5 w-3.5" /> Add option</PanelButton>
      {warn && <p className="text-[11.5px] text-[#B25000]">Commas can’t be used in options (they separate people’s picks), so they were left out.</p>}
    </div>
  );
}

// ---------- style ----------

function StyleSettings({ element, onUpdate }: { element: FormElement; onUpdate: (id: string, u: Partial<ElementStyle>) => void }) {
  const s = element.style || {};
  const set = (u: Partial<ElementStyle>) => onUpdate(element.id, u);
  const texty = ['heading', 'text', 'paragraph'].includes(element.type);
  return (
    <>
      <Group title="Layout">
        <Field label="Width in its column">
          <Segmented size="sm" value={s.width || 'full'} onChange={(v) => set({ width: v })} options={[{ value: 'full', label: 'Full' }, { value: 'half', label: 'Half' }, { value: 'third', label: 'Third' }]} />
        </Field>
        <Field label="Align">
          <Segmented size="sm" value={s.textAlign || 'left'} onChange={(v) => set({ textAlign: v })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Space inside"><input className={inputCls} value={s.padding || ''} onChange={(e) => set({ padding: e.target.value })} placeholder="e.g. 12px" /></Field>
          <Field label="Space below"><input className={inputCls} value={s.marginBottom || ''} onChange={(e) => set({ marginBottom: e.target.value })} placeholder="e.g. 16px" /></Field>
        </div>
      </Group>
      <Group title="Colour & text">
        <Field label="Text colour"><ColorField value={s.textColor || ''} onChange={(v) => set({ textColor: v })} placeholder="From Design" /></Field>
        <Field label="Background"><ColorField value={s.backgroundColor || ''} onChange={(v) => set({ backgroundColor: v })} /></Field>
        {texty && (
          <>
            <Field label="Text size"><input className={inputCls} value={s.fontSize || ''} onChange={(e) => set({ fontSize: e.target.value })} placeholder="From Design, e.g. 18px" /></Field>
            <Field label="Weight"><Segmented size="sm" value={s.fontWeight || 'normal'} onChange={(v) => set({ fontWeight: v })} options={[{ value: 'normal', label: 'Regular' }, { value: 'medium', label: 'Medium' }, { value: 'semibold', label: 'Semibold' }, { value: 'bold', label: 'Bold' }]} /></Field>
          </>
        )}
        <Field label="Corner rounding"><input className={inputCls} value={s.borderRadius || ''} onChange={(e) => set({ borderRadius: e.target.value })} placeholder="e.g. 12px" /></Field>
      </Group>
      <PanelButton onClick={() => onUpdate(element.id, { textColor: '', backgroundColor: '', fontSize: '', fontWeight: undefined, width: undefined, textAlign: undefined, padding: '', marginBottom: '', borderRadius: '' })}>Reset style</PanelButton>
    </>
  );
}

// ---------- a section ----------

function SectionSettings({ section, onUpdate }: { section: FormSection; onUpdate: (id: string, u: Partial<{ name: string; visible: boolean; columnCount: ColumnCount; style?: ElementStyle }>) => void }) {
  const s = section.style || {};
  const setStyle = (u: Partial<ElementStyle>) => onUpdate(section.id, { style: { ...s, ...u } });
  return (
    <>
      <Group title="Section">
        <Field label="Name (for you)"><input className={inputCls} value={section.name} onChange={(e) => onUpdate(section.id, { name: e.target.value })} /></Field>
        <Field label="Columns"><Segmented size="sm" value={section.columnCount} onChange={(v) => onUpdate(section.id, { columnCount: v })} options={[{ value: 1, label: 'One' }, { value: 2, label: 'Two' }, { value: 3, label: 'Three' }]} /></Field>
        <SwitchRow label="Visible" hint="Hidden sections stay here, faded, so you can bring them back." checked={section.visible} onChange={(v) => onUpdate(section.id, { visible: v })} />
      </Group>
      <Group title="Background" defaultOpen={!!(s.backgroundColor || s.backgroundImage)}>
        <Field label="Colour"><ColorField value={s.backgroundColor || ''} onChange={(v) => setStyle({ backgroundColor: v })} /></Field>
        <ImagePicker label="Picture" value={s.backgroundImage} onChange={(url) => setStyle({ backgroundImage: url })} />
        {s.backgroundImage && (
          <>
            <Field label="Fit"><Segmented size="sm" value={s.backgroundSize || 'cover'} onChange={(v) => setStyle({ backgroundSize: v })} options={[{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }, { value: 'auto', label: 'Actual size' }]} /></Field>
            <Field label="Tint colour"><ColorField value={s.overlayColor || ''} onChange={(v) => setStyle({ overlayColor: v })} /></Field>
            <Field label={`Tint strength · ${s.overlayOpacity ?? 0}%`}><input type="range" min={0} max={90} value={s.overlayOpacity ?? 0} onChange={(e) => setStyle({ overlayOpacity: Number(e.target.value) })} className="w-full accent-[#0071E3]" /></Field>
          </>
        )}
      </Group>
      <Group title="Shape" defaultOpen={!!(s.borderRadius || s.padding)}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Corner rounding"><input className={inputCls} value={s.borderRadius || ''} onChange={(e) => setStyle({ borderRadius: e.target.value })} placeholder="e.g. 16px" /></Field>
          <Field label="Space inside"><input className={inputCls} value={s.padding || ''} onChange={(e) => setStyle({ padding: e.target.value })} placeholder="e.g. 24px" /></Field>
        </div>
      </Group>
    </>
  );
}
