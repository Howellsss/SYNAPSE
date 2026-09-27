import { useState, useEffect } from 'react';
import {
  ChevronDown, ChevronRight, Plus, X, GripVertical, Eye, EyeOff, Upload,
  ArrowUp, ArrowDown, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { PublicGroupCalendarPage } from '@/components/calendar/PublicGroupCalendarPage';
import { FormRenderer } from '@/components/forms/FormRenderer';
import { deserializeDefinition } from '@/lib/form-definition';
import type { FormDefinition } from '@/lib/form-builder-types';
import type { Calendar as CalendarType } from '@/types';
import {
  type GroupPageConfig, type NavItem, type PageLayout, type CardStyle,
  type HeadingFont, type BodyFont, type HeadingWeight, type Alignment,
  type ChildCalendarPresentation,
  DEFAULT_GROUP_PAGE_CONFIG, mergeGroupPageConfig,
} from '@/lib/group-page-config';

interface Props {
  config: GroupPageConfig;
  groupName: string;
  groupDescription: string | null;
  calendars: CalendarType[];
  onChange: (config: GroupPageConfig) => void;
}

// Names must match ICON_MAP in PublicGroupCalendarPage.
const NAV_ICON_OPTIONS = [
  { label: 'Calendar', value: 'Calendar' },
  { label: 'Clock', value: 'Clock' },
  { label: 'Video', value: 'Video' },
  { label: 'Phone', value: 'Phone' },
  { label: 'Location pin', value: 'MapPin' },
  { label: 'Person', value: 'User' },
  { label: 'People', value: 'Users' },
  { label: 'Globe', value: 'Globe' },
  { label: 'Quill / invite', value: 'Feather' },
  { label: 'Chat / counselling', value: 'MessageCircle' },
  { label: 'Briefcase / consulting', value: 'Briefcase' },
  { label: 'Mail / contact', value: 'Mail' },
  { label: 'Heart', value: 'Heart' },
  { label: 'Helping hand', value: 'HandHeart' },
  { label: 'Book', value: 'BookOpen' },
  { label: 'Microphone', value: 'Mic' },
  { label: 'Star', value: 'Star' },
  { label: 'Graduation cap', value: 'GraduationCap' },
  { label: 'Stethoscope', value: 'Stethoscope' },
];

export function GroupPageDesigner({ config, groupName, groupDescription, calendars, onChange }: Props) {
  const [openSection, setOpenSection] = useState<string | null>('childPresentations');
  const [showPreview, setShowPreview] = useState(true);
  const [previewCalendarId, setPreviewCalendarId] = useState<string | null>(
    (calendars.length > 0 ? calendars : sampleCalendars)[0]?.id ?? null
  );

  const update = (section: keyof GroupPageConfig, updates: Record<string, unknown>) => {
    onChange({ ...config, [section]: { ...config[section], ...updates } });
  };

  const toggle = (section: string) => setOpenSection(openSection === section ? null : section);

  const previewCalendars = calendars.length > 0 ? calendars : sampleCalendars;
  const previewCalendar = previewCalendars.find(c => c.id === previewCalendarId) ?? previewCalendars[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-ivory-600">Configure your public booking page appearance.</p>
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="flex items-center gap-1.5 text-sm font-medium text-navy-700 hover:text-navy-900"
        >
          {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {showPreview ? 'Hide preview' : 'Show preview'}
        </button>
      </div>

      {/* Live preview */}
      {showPreview && (
        <div className="rounded-xl border border-navy-100 overflow-hidden mb-4">
          <div className="px-4 py-2 bg-ivory-50 border-b border-navy-100 flex items-center gap-2">
            <span className="text-xs font-medium text-ivory-500">Live Preview</span>
            <span className="text-xs text-ivory-400">·</span>
            <span className="text-xs text-ivory-400">{window.location.origin}/group/...</span>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            <PublicGroupCalendarPage
              config={config}
              groupName={groupName}
              groupDescription={groupDescription}
              calendars={previewCalendars}
              selectedCalendarId={previewCalendar?.id ?? null}
              onSelectCalendar={(cal) => setPreviewCalendarId(cal.id)}
              rightPanelLabel="Form"
              preview
            >
              <PreviewFormPanel calendar={previewCalendar} buttonColor={config.branding.buttonColor} />
            </PublicGroupCalendarPage>
          </div>
        </div>
      )}

      <CollapsibleSection id="childPresentations" title="Calendar panels (left side)" isOpen={openSection === 'childPresentations'} onToggle={toggle}>
        <p className="text-xs text-ivory-500 mb-3">Each calendar has its own left panel. Pick a calendar, then change its colour, image and text. The preview above switches to it.</p>
        <ChildPresentationEditor
          presentations={config.childPresentations}
          calendars={previewCalendars}
          onChange={items => onChange({ ...config, childPresentations: items })}
          activeId={previewCalendar?.id ?? null}
          onActiveChange={setPreviewCalendarId}
          defaultPanelColor={config.branding.leftPanelColor}
        />
      </CollapsibleSection>

      <CollapsibleSection id="branding" title="Branding" isOpen={openSection === 'branding'} onToggle={toggle}>
        <div className="grid grid-cols-2 gap-3">
          <ColorField label="Background color" value={config.branding.backgroundColor} onChange={v => update('branding', { backgroundColor: v })} />
          <ColorField label="Primary accent" value={config.branding.primaryAccent} onChange={v => update('branding', { primaryAccent: v })} />
          <ColorField label="Secondary accent" value={config.branding.secondaryAccent} onChange={v => update('branding', { secondaryAccent: v })} />
          <ColorField label="Button color" value={config.branding.buttonColor} onChange={v => update('branding', { buttonColor: v })} />
          <ColorField label="Left panel color" value={config.branding.leftPanelColor} onChange={v => update('branding', { leftPanelColor: v })} />
        </div>
        <TextField label="Logo URL" value={config.branding.logoUrl ?? ''} onChange={v => update('branding', { logoUrl: v || null })} placeholder="https://..." />
        <TextField label="Organization name" value={config.branding.organizationName ?? ''} onChange={v => update('branding', { organizationName: v || null })} placeholder="Your business name" />
        <TextField label="Background image URL (optional)" value={config.branding.backgroundImage ?? ''} onChange={v => update('branding', { backgroundImage: v || null })} placeholder="https://..." />
        {config.branding.backgroundImage && (
          <>
            <SliderField label="Background overlay opacity" value={config.branding.backgroundOverlay} min={0} max={100} onChange={v => update('branding', { backgroundOverlay: v })} />
            <SelectField label="Background position" value={config.branding.backgroundPosition} options={[{ label: 'Center', value: 'center' }, { label: 'Top', value: 'top' }, { label: 'Bottom', value: 'bottom' }]} onChange={v => update('branding', { backgroundPosition: v as 'center' | 'top' | 'bottom' })} />
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection id="typography" title="Typography" isOpen={openSection === 'typography'} onToggle={toggle}>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Heading font" value={config.typography.headingFont} options={headingFontOptions} onChange={v => update('typography', { headingFont: v as HeadingFont })} />
          <SelectField label="Body font" value={config.typography.bodyFont} options={bodyFontOptions} onChange={v => update('typography', { bodyFont: v as BodyFont })} />
          <SelectField label="Heading size" value={config.typography.headingSize} options={[{ label: 'Small', value: 'small' }, { label: 'Medium', value: 'medium' }, { label: 'Large', value: 'large' }, { label: 'Extra Large', value: 'xl' }]} onChange={v => update('typography', { headingSize: v as 'small' | 'medium' | 'large' | 'xl' })} />
          <SelectField label="Body size" value={config.typography.bodySize} options={[{ label: 'Small', value: 'small' }, { label: 'Medium', value: 'medium' }, { label: 'Large', value: 'large' }]} onChange={v => update('typography', { bodySize: v as 'small' | 'medium' | 'large' })} />
          <SelectField label="Heading weight" value={String(config.typography.headingWeight)} options={[{ label: 'Regular (400)', value: '400' }, { label: 'Medium (500)', value: '500' }, { label: 'Semibold (600)', value: '600' }, { label: 'Bold (700)', value: '700' }]} onChange={v => update('typography', { headingWeight: Number(v) as HeadingWeight })} />
          <SelectField label="Letter spacing" value={config.typography.letterSpacing} options={[{ label: 'Tight', value: 'tight' }, { label: 'Normal', value: 'normal' }, { label: 'Wide', value: 'wide' }]} onChange={v => update('typography', { letterSpacing: v as 'tight' | 'normal' | 'wide' })} />
          <SelectField label="Line height" value={config.typography.lineHeight} options={[{ label: 'Compact', value: 'compact' }, { label: 'Normal', value: 'normal' }, { label: 'Relaxed', value: 'relaxed' }]} onChange={v => update('typography', { lineHeight: v as 'compact' | 'normal' | 'relaxed' })} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection id="layout" title="Layout" isOpen={openSection === 'layout'} onToggle={toggle}>
        <SelectField label="Page layout" value={config.layout.layout} options={layoutOptions} onChange={v => update('layout', { layout: v as PageLayout })} />
        <SelectField label="Card style" value={config.layout.cardStyle} options={cardStyleOptions} onChange={v => update('layout', { cardStyle: v as CardStyle })} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Content width" value={config.layout.maxContentWidth} options={[{ label: 'Narrow', value: 'narrow' }, { label: 'Standard', value: 'standard' }, { label: 'Wide', value: 'wide' }, { label: 'Full', value: 'full' }]} onChange={v => update('layout', { maxContentWidth: v as 'narrow' | 'standard' | 'wide' | 'full' })} />
          <SelectField label="Page spacing" value={config.layout.pageSpacing} options={[{ label: 'Compact', value: 'compact' }, { label: 'Normal', value: 'normal' }, { label: 'Spacious', value: 'spacious' }]} onChange={v => update('layout', { pageSpacing: v as 'compact' | 'normal' | 'spacious' })} />
          <SelectField label="Left panel width" value={config.layout.leftPanelWidth} options={[{ label: 'Narrow', value: 'narrow' }, { label: 'Standard', value: 'standard' }, { label: 'Wide', value: 'wide' }]} onChange={v => update('layout', { leftPanelWidth: v as 'narrow' | 'standard' | 'wide' })} />
        </div>
        <ToggleRow label="Show search" checked={config.layout.showSearch} onChange={v => update('layout', { showSearch: v })} />
        <ToggleRow label="Show category filter" checked={config.layout.showCategoryFilter} onChange={v => update('layout', { showCategoryFilter: v })} />
      </CollapsibleSection>

      <CollapsibleSection id="header" title="Header" isOpen={openSection === 'header'} onToggle={toggle}>
        <ToggleRow label="Show header" checked={config.header.visible} onChange={v => update('header', { visible: v })} />
        {config.header.visible && (
          <>
            <ToggleRow label="Show logo" checked={config.header.showLogo} onChange={v => update('header', { showLogo: v })} />
            <SelectField label="Alignment" value={config.header.alignment} options={[{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }]} onChange={v => update('header', { alignment: v as Alignment })} />
            <TextField label="Title (overrides group name)" value={config.header.title ?? ''} onChange={v => update('header', { title: v || null })} placeholder={groupName} />
            <TextAreaField label="Description (overrides group description)" value={config.header.description ?? ''} onChange={v => update('header', { description: v || null })} placeholder={groupDescription ?? 'Choose the right appointment type for your needs'} />
            <TextAreaField label="Introductory text (optional)" value={config.header.introText ?? ''} onChange={v => update('header', { introText: v || null })} placeholder="Additional supporting text..." />
            <TextField label="Cover image URL (optional)" value={config.header.coverImage ?? ''} onChange={v => update('header', { coverImage: v || null })} placeholder="https://..." />
            {config.header.coverImage && (
              <SelectField label="Cover height" value={config.header.coverHeight} options={[{ label: 'Short', value: 'short' }, { label: 'Medium', value: 'medium' }, { label: 'Tall', value: 'tall' }]} onChange={v => update('header', { coverHeight: v as 'short' | 'medium' | 'tall' })} />
            )}
            <ToggleRow label="Show accent bar" checked={config.header.showAccentBar} onChange={v => update('header', { showAccentBar: v })} />
          </>
        )}
      </CollapsibleSection>


      <CollapsibleSection id="navigation" title="Extra Navigation Links" isOpen={openSection === 'navigation'} onToggle={toggle}>
        <p className="text-xs text-ivory-500 mb-3">Child calendars appear in the navigation automatically. Add extra links here for external pages or sections.</p>
        <NavigationEditor
          items={config.navigation}
          calendars={calendars}
          onChange={items => onChange({ ...config, navigation: items })}
        />
      </CollapsibleSection>

      <CollapsibleSection id="footer" title="Footer" isOpen={openSection === 'footer'} onToggle={toggle}>
        <ToggleRow label="Show footer" checked={config.footer.visible} onChange={v => update('footer', { visible: v })} />
        {config.footer.visible && (
          <>
            <TextAreaField label="Footer text" value={config.footer.text ?? ''} onChange={v => update('footer', { text: v || null })} placeholder="© 2026 Your Organization" />
            <ToggleRow label="Show 'Powered by SYNAPSE'" checked={config.footer.showPoweredBy} onChange={v => update('footer', { showPoweredBy: v })} />
          </>
        )}
      </CollapsibleSection>

      <div className="pt-2">
        <button
          onClick={() => onChange(DEFAULT_GROUP_PAGE_CONFIG)}
          className="text-xs font-medium text-ivory-500 hover:text-navy-700"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

// ============================================================
// PREVIEW FORM PANEL — fetches and renders the real form
// ============================================================

function PreviewFormPanel({ calendar, buttonColor }: { calendar: CalendarType | null; buttonColor: string }) {
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [formName, setFormName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    setDefinition(null);
    setAnswers({});
    if (!calendar?.connected_form_id) {
      setFormName(calendar?.name ?? '');
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: formRow } = await supabase
        .from('forms')
        .select('definition, name, description')
        .eq('id', calendar.connected_form_id!)
        .maybeSingle();
      if (cancelled) return;
      if (formRow?.definition) {
        const def = deserializeDefinition(formRow.definition);
        if (def) {
          setDefinition(def);
          setFormName(formRow.name ?? calendar.name);
          setLoading(false);
          return;
        }
      }
      setFormName(formRow?.name ?? calendar.name ?? '');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [calendar?.id, calendar?.connected_form_id]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin mb-3" />
        <p className="text-sm text-gray-500">Loading form...</p>
      </div>
    );
  }

  if (definition) {
    return (
      <FormRenderer
        definition={definition}
        formName={formName}
        formDescription={null}
        answers={answers}
        onAnswerChange={(id, val) => setAnswers(prev => ({ ...prev, [id]: val }))}
        onSubmit={() => {}}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        {calendar?.connected_form_id
          ? 'This form uses the default booking fields.'
          : 'No custom form connected. Default booking fields will be used.'}
      </p>
      <div className="space-y-2">
        <div className="h-10 rounded-lg border border-gray-200 bg-gray-50" />
        <div className="h-10 rounded-lg border border-gray-200 bg-gray-50" />
        <div className="h-10 rounded-lg border border-gray-200 bg-gray-50" />
      </div>
      <div className="h-11 rounded-lg" style={{ backgroundColor: buttonColor }} />
    </div>
  );
}

// ============================================================
// NAVIGATION EDITOR
// ============================================================

function NavigationEditor({
  items, calendars, onChange,
}: {
  items: NavItem[];
  calendars: CalendarType[];
  onChange: (items: NavItem[]) => void;
}) {
  const addItem = () => {
    const newItem: NavItem = {
      id: crypto.randomUUID(),
      label: 'New Link',
      icon: null,
      type: 'section',
      target: null,
      visible: true,
      sort_order: items.length,
    };
    onChange([...items, newItem]);
  };

  const updateItem = (id: string, updates: Partial<NavItem>) => {
    onChange(items.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const removeItem = (id: string) => {
    onChange(items.filter(item => item.id !== id));
  };

  const moveItem = (id: string, direction: 'up' | 'down') => {
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const next = [...items];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    onChange(next.map((item, i) => ({ ...item, sort_order: i })));
  };

  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <div key={item.id} className="rounded-lg border border-navy-100 p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <GripVertical className="w-4 h-4 text-ivory-300" />
            <input
              value={item.label}
              onChange={e => updateItem(item.id, { label: e.target.value })}
              className="flex-1 rounded-md border border-navy-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
              placeholder="Link label"
            />
            <button onClick={() => moveItem(item.id, 'up')} disabled={idx === 0} className="text-ivory-400 hover:text-navy-700 disabled:opacity-30">
              <ArrowUp className="w-4 h-4" />
            </button>
            <button onClick={() => moveItem(item.id, 'down')} disabled={idx === items.length - 1} className="text-ivory-400 hover:text-navy-700 disabled:opacity-30">
              <ArrowDown className="w-4 h-4" />
            </button>
            <button onClick={() => updateItem(item.id, { visible: !item.visible })} className="text-ivory-400 hover:text-navy-700">
              {item.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
            <button onClick={() => removeItem(item.id)} className="text-red-400 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 pl-6">
            <select
              value={item.type}
              onChange={e => updateItem(item.id, { type: e.target.value as NavItem['type'], target: null })}
              className="rounded-md border border-navy-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
            >
              <option value="section">Section</option>
              <option value="calendar">Calendar</option>
              <option value="external">External link</option>
              <option value="booking_flow">Booking flow</option>
            </select>
            {item.type === 'calendar' ? (
              <select
                value={item.target ?? ''}
                onChange={e => updateItem(item.id, { target: e.target.value || null })}
                className="rounded-md border border-navy-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
              >
                <option value="">Select calendar...</option>
                {calendars.map(cal => <option key={cal.id} value={cal.id}>{cal.name}</option>)}
              </select>
            ) : item.type === 'external' ? (
              <input
                value={item.target ?? ''}
                onChange={e => updateItem(item.id, { target: e.target.value || null })}
                placeholder="https://..."
                className="rounded-md border border-navy-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
              />
            ) : (
              <select
                value={item.icon ?? ''}
                onChange={e => updateItem(item.id, { icon: e.target.value || null })}
                className="rounded-md border border-navy-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
              >
                <option value="">No icon</option>
                {NAV_ICON_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            )}
          </div>
          {item.type !== 'calendar' && item.type !== 'external' && (
            <div className="pl-6">
              <select
                value={item.icon ?? ''}
                onChange={e => updateItem(item.id, { icon: e.target.value || null })}
                className="rounded-md border border-navy-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
              >
                <option value="">No icon</option>
                {NAV_ICON_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          )}
        </div>
      ))}
      <button
        onClick={addItem}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-navy-200 px-3 py-2 text-sm font-medium text-ivory-600 hover:border-navy-300 hover:bg-ivory-50 transition w-full"
      >
        <Plus className="w-4 h-4" /> Add navigation item
      </button>
    </div>
  );
}

// ============================================================
// CALENDAR PANELS EDITOR (left panel content per calendar)
// ============================================================

const PANEL_IMAGE_BUCKET = 'workspace-logos';
const MAX_PANEL_IMAGE_BYTES = 5 * 1024 * 1024;

function ImageField({ label, hint, value, onChange, folder }: {
  label: string;
  hint: string;
  value: string | null;
  onChange: (url: string | null) => void;
  folder: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    if (file.size > MAX_PANEL_IMAGE_BYTES) { setError('Images must be 5 MB or smaller.'); return; }
    setUploading(true);
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `group-pages/${folder}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(PANEL_IMAGE_BUCKET).upload(path, file, { contentType: file.type });
    setUploading(false);
    if (uploadError) { setError(`Upload failed: ${uploadError.message}`); return; }
    onChange(supabase.storage.from(PANEL_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl);
  };

  return (
    <div>
      <span className="text-xs font-medium text-navy-700">{label}</span>
      <p className="text-[11px] text-ivory-500">{hint}</p>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-navy-100 bg-ivory-50">
          {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] text-ivory-400">No image</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-semibold text-navy-700 hover:bg-ivory-50', uploading && 'pointer-events-none opacity-60')}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? 'Uploading…' : value ? 'Replace' : 'Upload'}
            <input type="file" accept="image/*" className="hidden" onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {value && (
            <button type="button" onClick={() => onChange(null)} className="text-xs font-medium text-red-500 hover:text-red-700">Remove</button>
          )}
        </div>
      </div>
      <input
        value={value ?? ''}
        onChange={e => onChange(e.target.value.trim() || null)}
        placeholder="…or paste an image URL"
        className="mt-2 w-full rounded-lg border border-navy-200 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ChildPresentationEditor({
  presentations, calendars, onChange, activeId, onActiveChange, defaultPanelColor,
}: {
  presentations: ChildCalendarPresentation[];
  calendars: CalendarType[];
  onChange: (items: ChildCalendarPresentation[]) => void;
  activeId: string | null;
  onActiveChange: (id: string) => void;
  defaultPanelColor: string;
}) {
  const ensurePresentation = (calId: string): ChildCalendarPresentation => {
    const existing = presentations.find(p => p.calendarId === calId);
    if (existing) return existing;
    return {
      calendarId: calId,
      navLabel: null,
      navIcon: null,
      heading: null,
      description: null,
      label: null,
      image: null,
      backgroundImage: null,
      leftPanelColor: null,
      backgroundOverlay: null,
      textColor: 'auto',
    };
  };

  const updatePresentation = (calId: string, updates: Partial<ChildCalendarPresentation>) => {
    const existing = presentations.find(p => p.calendarId === calId);
    if (existing) {
      onChange(presentations.map(p => p.calendarId === calId ? { ...p, ...updates } : p));
    } else {
      onChange([...presentations, { ...ensurePresentation(calId), ...updates }]);
    }
  };

  if (calendars.length === 0) {
    return <p className="text-xs text-ivory-500 text-center py-4">Add calendars to the group first.</p>;
  }

  const index = Math.max(0, calendars.findIndex(c => c.id === activeId));
  const cal = calendars[index];
  const pres = ensurePresentation(cal.id);
  const set = (updates: Partial<ChildCalendarPresentation>) => updatePresentation(cal.id, updates);
  const inputClass = 'mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm outline-none focus:border-blue-500';

  return (
    <div className="space-y-4">
      {/* Which calendar's panel is being edited */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Calendar to edit">
        {calendars.map((c, i) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === cal.id}
            onClick={() => onActiveChange(c.id)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
              c.id === cal.id ? 'border-navy-800 bg-navy-800 text-white' : 'border-navy-200 text-navy-700 hover:bg-ivory-50',
            )}
          >
            {String(i + 1).padStart(2, '0')} · {c.name}
          </button>
        ))}
      </div>

      {/* Tab */}
      <fieldset className="space-y-3 rounded-lg border border-navy-100 p-3">
        <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ivory-500">Tab</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-navy-700">Tab name</span>
            <input value={pres.navLabel ?? ''} onChange={e => set({ navLabel: e.target.value || null })} placeholder={cal.name} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-navy-700">Tab icon</span>
            <select value={pres.navIcon ?? ''} onChange={e => set({ navIcon: e.target.value || null })} className={inputClass}>
              <option value="">Automatic</option>
              {NAV_ICON_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      {/* Text */}
      <fieldset className="space-y-3 rounded-lg border border-navy-100 p-3">
        <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ivory-500">Text on the panel</legend>
        <div className="grid grid-cols-[96px_1fr] gap-3">
          <label className="block">
            <span className="text-xs font-medium text-navy-700">Number</span>
            <input value={pres.label ?? ''} onChange={e => set({ label: e.target.value || null })} placeholder={String(index + 1).padStart(2, '0')} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-navy-700">Heading</span>
            <input value={pres.heading ?? ''} onChange={e => set({ heading: e.target.value || null })} placeholder={cal.name} className={inputClass} />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-navy-700">Text</span>
          <textarea
            value={pres.description ?? ''}
            onChange={e => set({ description: e.target.value || null })}
            placeholder={cal.description ?? 'A short line about this option'}
            rows={3}
            className={cn(inputClass, 'resize-y')}
          />
        </label>
        <div>
          <span className="text-xs font-medium text-navy-700">Text colour</span>
          <div className="mt-1 inline-flex rounded-lg border border-navy-200 p-0.5" role="radiogroup" aria-label="Text colour">
            {([['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']] as const).map(([v, text]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={(pres.textColor ?? 'auto') === v}
                onClick={() => set({ textColor: v })}
                className={cn('rounded-md px-3 py-1 text-xs font-medium', (pres.textColor ?? 'auto') === v ? 'bg-navy-800 text-white' : 'text-navy-700 hover:bg-ivory-50')}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      {/* Background */}
      <fieldset className="space-y-3 rounded-lg border border-navy-100 p-3">
        <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ivory-500">Background</legend>
        <div>
          <span className="text-xs font-medium text-navy-700">Background colour</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              aria-label="Background colour"
              value={pres.leftPanelColor ?? defaultPanelColor}
              onChange={e => set({ leftPanelColor: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded-lg border border-navy-200"
            />
            <input
              value={pres.leftPanelColor ?? ''}
              onChange={e => set({ leftPanelColor: e.target.value || null })}
              placeholder={`${defaultPanelColor} (page default)`}
              className="flex-1 rounded-lg border border-navy-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
            />
            {pres.leftPanelColor && (
              <button type="button" onClick={() => set({ leftPanelColor: null })} className="text-xs text-ivory-500 hover:text-navy-700">Use default</button>
            )}
          </div>
        </div>
        <ImageField
          label="Background image"
          hint="Fills the whole panel behind the text."
          value={pres.backgroundImage}
          onChange={url => set({ backgroundImage: url })}
          folder={cal.id}
        />
        {pres.backgroundImage && (
          <label className="block">
            <span className="flex items-center justify-between text-xs font-medium text-navy-700">
              Darken image so text is readable <span className="text-ivory-500">{pres.backgroundOverlay ?? 35}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              value={pres.backgroundOverlay ?? 35}
              onChange={e => set({ backgroundOverlay: Number(e.target.value) })}
              className="mt-1 w-full accent-navy-800"
            />
          </label>
        )}
        <ImageField
          label="Picture below the text (optional)"
          hint="A smaller image shown under the heading and text."
          value={pres.image}
          onChange={url => set({ image: url })}
          folder={cal.id}
        />
      </fieldset>
    </div>
  );
}

// ============================================================
// SHARED UI COMPONENTS
// ============================================================

function CollapsibleSection({
  id, title, isOpen, onToggle, children,
}: {
  id: string;
  title: string;
  isOpen: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-navy-100 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between p-3.5 hover:bg-ivory-50 transition-colors"
      >
        <span className="text-sm font-semibold text-navy-800">{title}</span>
        {isOpen ? <ChevronDown className="w-4 h-4 text-ivory-400" /> : <ChevronRight className="w-4 h-4 text-ivory-400" />}
      </button>
      {isOpen && <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-navy-50">{children}</div>}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-navy-700">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input type="color" value={value} onChange={e => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-navy-200" />
        <input value={value} onChange={e => onChange(e.target.value)} className="flex-1 rounded-lg border border-navy-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500" />
      </div>
    </label>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-navy-700">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm outline-none focus:border-blue-500" />
    </label>
  );
}

function TextAreaField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-navy-700">{label}</span>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={2} className="mt-1 w-full resize-none rounded-lg border border-navy-200 px-3 py-2 text-sm outline-none focus:border-blue-500" />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: { label: string; value: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-navy-700">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm outline-none focus:border-blue-500">
        {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </label>
  );
}

function SliderField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-navy-700">{label}: {value}%</span>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} className="mt-1 w-full" />
    </label>
  );
}

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

// ============================================================
// CONSTANTS
// ============================================================

const headingFontOptions = [
  { label: 'Georgia (Serif)', value: 'Georgia' },
  { label: 'Playfair Display', value: 'Playfair Display' },
  { label: 'Cormorant Garamond', value: 'Cormorant Garamond' },
  { label: 'System Serif', value: 'serif' },
  { label: 'Inter (Sans)', value: 'Inter' },
  { label: 'System UI', value: 'system-ui' },
];

const bodyFontOptions = [
  { label: 'Inter', value: 'Inter' },
  { label: 'System UI', value: 'system-ui' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Helvetica', value: 'Helvetica' },
];

const layoutOptions = [
  { label: 'Centered', value: 'centered' },
  { label: 'Wide Editorial', value: 'wide_editorial' },
  { label: 'Compact', value: 'compact' },
  { label: 'Full Width', value: 'full_width' },
  { label: 'Card Grid', value: 'card_grid' },
  { label: 'Split', value: 'split' },
];

const cardStyleOptions = [
  { label: 'Classic Cards', value: 'classic_cards' },
  { label: 'Editorial List', value: 'editorial_list' },
  { label: 'Compact List', value: 'compact_list' },
  { label: 'Two Column', value: 'two_column' },
  { label: 'Three Column', value: 'three_column' },
  { label: 'Featured + Secondary', value: 'featured_plus_secondary' },
  { label: 'Split Info + Options', value: 'split_info_options' },
];

const sampleCalendars: CalendarType[] = [
  {
    id: 'sample-1', workspace_id: null, owner_id: null,
    name: 'General Consultation', description: 'A brief introductory meeting to discuss your needs.',
    slug: 'general', calendar_type: 'one_on_one', duration_minutes: 30, slot_interval_minutes: 30,
    location_type: 'synapse_meeting', location_url: null, color: '#E4A93C', timezone: 'UTC',
    status: 'active', capacity: 1, buffer_before_minutes: 0, buffer_after_minutes: 0,
    min_booking_notice_minutes: 120, max_booking_horizon_days: 30,
    max_bookings_per_day: null, max_bookings_per_week: null, max_bookings_per_month: null,
    cancellation_policy: '', booking_flow: 'calendar_first', form_mode: 'default',
    connected_form_id: null, custom_confirmation_message: null, custom_redirect_url: null,
    embed_config: { type: 'inline' }, round_robin_strategy: null,
    price: null, currency: 'USD', logo_url: null, cover_url: null,
    background_color: null, button_color: null, font_family: null,
    created_at: '', updated_at: '',
  },
  {
    id: 'sample-2', workspace_id: null, owner_id: null,
    name: 'Strategy Session', description: 'Deep-dive strategy session for teams and organizations.',
    slug: 'strategy', calendar_type: 'group', duration_minutes: 60, slot_interval_minutes: 60,
    location_type: 'in_person', location_url: null, color: '#3B82F6', timezone: 'UTC',
    status: 'active', capacity: 10, buffer_before_minutes: 15, buffer_after_minutes: 15,
    min_booking_notice_minutes: 1440, max_booking_horizon_days: 60,
    max_bookings_per_day: null, max_bookings_per_week: null, max_bookings_per_month: null,
    cancellation_policy: '', booking_flow: 'calendar_first', form_mode: 'default',
    connected_form_id: null, custom_confirmation_message: null, custom_redirect_url: null,
    embed_config: { type: 'inline' }, round_robin_strategy: null,
    price: 150, currency: 'USD', logo_url: null, cover_url: null,
    background_color: null, button_color: null, font_family: null,
    created_at: '', updated_at: '',
  },
  {
    id: 'sample-3', workspace_id: null, owner_id: null,
    name: 'Counselling', description: 'Private one-on-one counselling session.',
    slug: 'counselling', calendar_type: 'one_on_one', duration_minutes: 45, slot_interval_minutes: 45,
    location_type: 'phone', location_url: null, color: '#10B981', timezone: 'UTC',
    status: 'active', capacity: 1, buffer_before_minutes: 0, buffer_after_minutes: 0,
    min_booking_notice_minutes: 60, max_booking_horizon_days: 14,
    max_bookings_per_day: null, max_bookings_per_week: null, max_bookings_per_month: null,
    cancellation_policy: '', booking_flow: 'calendar_first', form_mode: 'default',
    connected_form_id: null, custom_confirmation_message: null, custom_redirect_url: null,
    embed_config: { type: 'inline' }, round_robin_strategy: null,
    price: null, currency: 'USD', logo_url: null, cover_url: null,
    background_color: null, button_color: null, font_family: null,
    created_at: '', updated_at: '',
  },
];
