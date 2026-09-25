import { useState } from 'react';
import {
  ChevronDown, ChevronRight, Palette, Type, Layout, FormInput,
  MousePointerClick, Image as ImageIcon, Layers, Building2,
  Smartphone, Monitor, Tablet, Eye, AlertTriangle,
  AlignLeft, AlignCenter, AlignRight, Columns2, CreditCard,
  AlignCenterVertical, Maximize, RotateCcw,
} from 'lucide-react';
import type {
  FormDefinition, FormTheme, ThemeColors, ThemeTypography, ThemeLayout,
  ThemeFieldStyle, ThemeButtonStyle, ThemeBackground, ThemeSplitLayout,
  ThemeBranding, ThemeProgress, FormLayoutPreset, Viewport,
  RadiusPreset, ShadowPreset, FormWidthPreset, ContentAlign, ButtonStyle,
} from '@/lib/form-builder-types';
import { FONT_LIBRARY, DEFAULT_THEME } from '@/lib/form-builder-types';
import { THEME_PRESETS, LAYOUT_PRESETS } from '@/lib/theme-presets';
import { FormRenderer } from '@/components/forms/FormRenderer';
import { cn } from '@/lib/utils';

interface DesignStudioProps {
  definition: FormDefinition;
  formName: string;
  formDescription?: string | null;
  onUpdateTheme: (updates: Partial<FormTheme>) => void;
}

// ============================================================
// MAIN DESIGN STUDIO
// ============================================================

export function DesignStudio({ definition, formName, formDescription, onUpdateTheme }: DesignStudioProps) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['theme']));

  const toggleSection = (id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const theme = definition.theme;

  const updateColors = (updates: Partial<ThemeColors>) => onUpdateTheme({ colors: { ...theme.colors, ...updates } });
  const updateTypography = (updates: Partial<ThemeTypography>) => onUpdateTheme({ typography: { ...theme.typography, ...updates } });
  const updateLayout = (updates: Partial<ThemeLayout>) => onUpdateTheme({ layout: { ...theme.layout, ...updates } });
  const updateFieldStyle = (updates: Partial<ThemeFieldStyle>) => onUpdateTheme({ fieldStyle: { ...theme.fieldStyle, ...updates } });
  const updateButtonStyle = (updates: Partial<ThemeButtonStyle>) => onUpdateTheme({ buttonStyle: { ...theme.buttonStyle, ...updates } });
  const updateBackground = (updates: Partial<ThemeBackground>) => onUpdateTheme({ background: { ...theme.background, ...updates } });
  const updateSplit = (updates: Partial<ThemeSplitLayout>) => onUpdateTheme({ split: { ...theme.split, ...updates } });
  const updateBranding = (updates: Partial<ThemeBranding>) => onUpdateTheme({ branding: { ...theme.branding, ...updates } });
  const updateProgress = (updates: Partial<ThemeProgress>) => onUpdateTheme({ progress: { ...theme.progress, ...updates } });

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* LEFT — Design Controls */}
      <div className="w-[400px] shrink-0 border-r border-navy-100 bg-white overflow-y-auto">
        <div className="px-4 py-3 border-b border-navy-100 sticky top-0 bg-white z-10">
          <h2 className="text-sm font-bold text-navy-800">Design Studio</h2>
          <p className="text-xs text-ivory-600 mt-0.5">Customize the visual appearance of your form</p>
        </div>

        <div className="px-3 py-3 space-y-1">
          <Section id="theme" label="Theme" icon={Palette} open={openSections.has('theme')} onToggle={toggleSection}>
            <ThemePresetsGrid currentTheme={theme} onApply={(preset) => onUpdateTheme(preset)} />
          </Section>

          <Section id="layout-preset" label="Form Style" icon={Layers} open={openSections.has('layout-preset')} onToggle={toggleSection}>
            <LayoutPresetsGrid currentPreset={theme.layoutPreset} onApply={(preset) => onUpdateTheme({ layoutPreset: preset })} />
          </Section>

          <Section id="colors" label="Colors" icon={Palette} open={openSections.has('colors')} onToggle={toggleSection}>
            <ColorsPanel colors={theme.colors} onUpdate={updateColors} />
          </Section>

          <Section id="typography" label="Typography" icon={Type} open={openSections.has('typography')} onToggle={toggleSection}>
            <TypographyPanel typography={theme.typography} onUpdate={updateTypography} />
          </Section>

          <Section id="layout" label="Layout" icon={Layout} open={openSections.has('layout')} onToggle={toggleSection}>
            <LayoutPanel layout={theme.layout} onUpdate={updateLayout} />
          </Section>

          <Section id="fields" label="Fields" icon={FormInput} open={openSections.has('fields')} onToggle={toggleSection}>
            <FieldsPanel fieldStyle={theme.fieldStyle} typography={theme.typography} onUpdate={updateFieldStyle} />
          </Section>

          <Section id="buttons" label="Buttons" icon={MousePointerClick} open={openSections.has('buttons')} onToggle={toggleSection}>
            <ButtonsPanel buttonStyle={theme.buttonStyle} typography={theme.typography} onUpdate={updateButtonStyle} />
          </Section>

          <Section id="background" label="Background" icon={ImageIcon} open={openSections.has('background')} onToggle={toggleSection}>
            <BackgroundPanel background={theme.background} onUpdate={updateBackground} />
          </Section>

          {theme.layoutPreset === 'split' && (
            <Section id="split" label="Split Layout" icon={Columns2} open={openSections.has('split')} onToggle={toggleSection}>
              <SplitPanel split={theme.split} onUpdate={updateSplit} />
            </Section>
          )}

          <Section id="branding" label="Branding" icon={Building2} open={openSections.has('branding')} onToggle={toggleSection}>
            <BrandingPanel branding={theme.branding} onUpdate={updateBranding} />
          </Section>

          <Section id="progress" label="Progress Indicator" icon={Eye} open={openSections.has('progress')} onToggle={toggleSection}>
            <ProgressPanel progress={theme.progress} onUpdate={updateProgress} />
          </Section>

          <Section id="responsive" label="Responsive" icon={Smartphone} open={openSections.has('responsive')} onToggle={toggleSection}>
            <ResponsivePanel viewport={viewport} onViewportChange={setViewport} />
          </Section>

          <div className="pt-4 pb-6">
            <button onClick={() => onUpdateTheme({ ...getResetTheme() })} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-navy-100 text-ivory-600 hover:text-navy-800 hover:bg-ivory-50 transition-all text-sm font-medium">
              <RotateCcw className="w-4 h-4" /> Reset to defaults
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT — Live Preview */}
      <div className="flex-1 flex flex-col overflow-hidden bg-ivory-50/30">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-navy-100 bg-white">
          <p className="text-xs font-semibold text-navy-700">Live Preview</p>
          <div className="flex items-center gap-1 rounded-lg border border-navy-100 overflow-hidden">
            {(['desktop', 'tablet', 'mobile'] as Viewport[]).map(vp => {
              const Icon = vp === 'desktop' ? Monitor : vp === 'tablet' ? Tablet : Smartphone;
              return <button key={vp} onClick={() => setViewport(vp)} className={cn('p-2 transition-colors', viewport === vp ? 'bg-navy-800 text-ivory-100' : 'text-ivory-600 hover:bg-ivory-50')}><Icon className="w-4 h-4" /></button>;
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 flex justify-center">
          <div className="w-full transition-all duration-300" style={{ maxWidth: viewport === 'mobile' ? '375px' : viewport === 'tablet' ? '768px' : '100%' }}>
            <div className="bg-white rounded-xl overflow-hidden border border-navy-100" style={{ minHeight: '500px' }}>
              <FormRenderer
                definition={definition}
                formName={formName}
                formDescription={formDescription}
                viewport={viewport}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// COLLAPSIBLE SECTION WRAPPER
// ============================================================

function Section({ id, label, icon: Icon, open, onToggle, children }: {
  id: string; label: string; icon: typeof Palette; open: boolean; onToggle: (id: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg overflow-hidden border border-navy-50">
      <button onClick={() => onToggle(id)} className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-white hover:bg-ivory-50/50 transition-colors">
        <Icon className="w-4 h-4 text-navy-600 shrink-0" />
        <span className="text-sm font-semibold text-navy-700 flex-1 text-left">{label}</span>
        {open ? <ChevronDown className="w-4 h-4 text-ivory-400" /> : <ChevronRight className="w-4 h-4 text-ivory-400" />}
      </button>
      {open && <div className="px-3 pb-4 pt-1 space-y-3 bg-white border-t border-navy-50">{children}</div>}
    </div>
  );
}

// ============================================================
// THEME PRESETS GRID
// ============================================================

function ThemePresetsGrid({ currentTheme, onApply }: { currentTheme: FormTheme; onApply: (theme: Partial<FormTheme>) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {THEME_PRESETS.map(preset => (
        <button key={preset.id} onClick={() => onApply(preset.apply(currentTheme))} className="group rounded-lg border border-navy-100 overflow-hidden hover:border-gold-400 transition-all">
          <div className="h-16 p-2 flex flex-col justify-between" style={{ background: preset.preview.bg }}>
            <div className="h-2 w-8 rounded" style={{ background: preset.preview.accent }} />
            <div className="space-y-1">
              <div className="h-1.5 w-full rounded" style={{ background: preset.preview.text, opacity: 0.6 }} />
              <div className="h-1.5 w-2/3 rounded" style={{ background: preset.preview.text, opacity: 0.3 }} />
            </div>
            <div className="h-3 w-12 rounded" style={{ background: preset.preview.accent }} />
          </div>
          <div className="px-2 py-1.5 bg-white">
            <p className="text-[11px] font-semibold text-navy-700">{preset.name}</p>
            <p className="text-[9px] text-ivory-500 leading-tight">{preset.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

// ============================================================
// LAYOUT PRESETS GRID
// ============================================================

function LayoutPresetsGrid({ currentPreset, onApply }: { currentPreset: FormLayoutPreset; onApply: (preset: FormLayoutPreset) => void }) {
  const ICONS: Record<string, typeof AlignLeft> = { AlignLeft, CreditCard, Columns2, AlignCenterVertical, Maximize };
  return (
    <div className="grid grid-cols-3 gap-2">
      {LAYOUT_PRESETS.map(preset => {
        const Icon = ICONS[preset.icon] || AlignLeft;
        const isActive = currentPreset === preset.id;
        return (
          <button key={preset.id} onClick={() => onApply(preset.id)} className={cn('rounded-lg border p-2.5 flex flex-col items-center gap-1.5 transition-all', isActive ? 'border-gold-400 bg-gold-50/40' : 'border-navy-100 hover:border-navy-200')}>
            <Icon className={cn('w-5 h-5', isActive ? 'text-gold-700' : 'text-ivory-600')} />
            <span className={cn('text-[11px] font-semibold', isActive ? 'text-gold-700' : 'text-navy-700')}>{preset.name}</span>
            <span className="text-[9px] text-ivory-500 text-center leading-tight">{preset.description}</span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// COLORS PANEL
// ============================================================

function ColorsPanel({ colors, onUpdate }: { colors: ThemeColors; onUpdate: (u: Partial<ThemeColors>) => void }) {
  const items: { label: string; key: keyof ThemeColors }[] = [
    { label: 'Page background', key: 'pageBackground' },
    { label: 'Surface background', key: 'surfaceBackground' },
    { label: 'Primary', key: 'primary' },
    { label: 'Secondary', key: 'secondary' },
    { label: 'Heading', key: 'heading' },
    { label: 'Body text', key: 'bodyText' },
    { label: 'Muted text', key: 'mutedText' },
    { label: 'Border', key: 'border' },
    { label: 'Input background', key: 'inputBackground' },
    { label: 'Input text', key: 'inputText' },
    { label: 'Button background', key: 'buttonBg' },
    { label: 'Button text', key: 'buttonText' },
    { label: 'Error', key: 'error' },
    { label: 'Success', key: 'success' },
    { label: 'Focus ring', key: 'focusRing' },
  ];
  return (
    <div className="space-y-2">
      {items.map(item => <ColorRow key={item.key} label={item.label} value={colors[item.key]} onChange={v => onUpdate({ [item.key]: v } as Partial<ThemeColors>)} />)}
      <ContrastWarning colors={colors} />
    </div>
  );
}

function ContrastWarning({ colors }: { colors: ThemeColors }) {
  const hasLowContrast = (fg: string, bg: string): boolean => {
    const lum = (hex: string) => {
      const c = hex.replace('#', ''); const r = parseInt(c.slice(0,2),16)/255; const g = parseInt(c.slice(2,4),16)/255; const b = parseInt(c.slice(4,6),16)/255;
      return 0.299*r + 0.587*g + 0.114*b;
    };
    return Math.abs(lum(fg) - lum(bg)) < 0.2;
  };
  const warnings: string[] = [];
  if (hasLowContrast(colors.bodyText, colors.pageBackground)) warnings.push('Body text may be hard to read on the page background');
  if (hasLowContrast(colors.buttonText, colors.buttonBg)) warnings.push('Button text may be hard to read');
  if (hasLowContrast(colors.inputText, colors.inputBackground)) warnings.push('Input text may be hard to read');
  if (warnings.length === 0) return null;
  return (
    <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          {warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-800 leading-tight">{w}</p>)}
        </div>
      </div>
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value || '#ffffff'} onChange={e => onChange(e.target.value)} className="w-7 h-7 rounded border border-navy-100 cursor-pointer shrink-0" />
      <input type="text" value={value} onChange={e => onChange(e.target.value)} className="input-field flex-1 text-xs py-1.5" />
      <span className="text-xs text-ivory-600 w-24 shrink-0 text-right">{label}</span>
    </div>
  );
}

// ============================================================
// TYPOGRAPHY PANEL
// ============================================================

function TypographyPanel({ typography, onUpdate }: { typography: ThemeTypography; onUpdate: (u: Partial<ThemeTypography>) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Primary font</Label>
        <FontSelect value={typography.primaryFont} onChange={v => onUpdate({ primaryFont: v, headingFont: v, bodyFont: v })} />
      </div>
      <div className="border-t border-navy-50 pt-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-500 mb-2">Headings</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Size</Label><input className="input-field text-xs py-1.5" value={typography.headingSize} onChange={e => onUpdate({ headingSize: e.target.value })} /></div>
          <div><Label>Weight</Label><WeightSelect value={typography.headingWeight} onChange={v => onUpdate({ headingWeight: v })} /></div>
          <div><Label>Line height</Label><input className="input-field text-xs py-1.5" value={typography.headingLineHeight} onChange={e => onUpdate({ headingLineHeight: e.target.value })} /></div>
          <div><Label>Letter spacing</Label><input className="input-field text-xs py-1.5" value={typography.headingLetterSpacing} onChange={e => onUpdate({ headingLetterSpacing: e.target.value })} /></div>
        </div>
      </div>
      <div className="border-t border-navy-50 pt-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-500 mb-2">Body</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Size</Label><input className="input-field text-xs py-1.5" value={typography.bodySize} onChange={e => onUpdate({ bodySize: e.target.value })} /></div>
          <div><Label>Weight</Label><WeightSelect value={typography.bodyWeight} onChange={v => onUpdate({ bodyWeight: v })} /></div>
          <div><Label>Line height</Label><input className="input-field text-xs py-1.5" value={typography.bodyLineHeight} onChange={e => onUpdate({ bodyLineHeight: e.target.value })} /></div>
        </div>
      </div>
      <div className="border-t border-navy-50 pt-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-500 mb-2">Labels</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Size</Label><input className="input-field text-xs py-1.5" value={typography.labelSize} onChange={e => onUpdate({ labelSize: e.target.value })} /></div>
          <div><Label>Weight</Label><WeightSelect value={typography.labelWeight} onChange={v => onUpdate({ labelWeight: v })} /></div>
        </div>
      </div>
      <div className="border-t border-navy-50 pt-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-500 mb-2">Buttons</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Size</Label><input className="input-field text-xs py-1.5" value={typography.buttonSize} onChange={e => onUpdate({ buttonSize: e.target.value })} /></div>
          <div><Label>Weight</Label><WeightSelect value={typography.buttonWeight} onChange={v => onUpdate({ buttonWeight: v })} /></div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LAYOUT PANEL
// ============================================================

function LayoutPanel({ layout, onUpdate }: { layout: ThemeLayout; onUpdate: (u: Partial<ThemeLayout>) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Form width</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {(['compact', 'standard', 'wide', 'full'] as FormWidthPreset[]).map(w => (
            <button key={w} onClick={() => onUpdate({ formWidth: w })} className={cn('py-1.5 rounded-md text-[11px] font-medium border transition-all capitalize', layout.formWidth === w ? 'bg-navy-800 text-ivory-100 border-navy-800' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}>{w}</button>
          ))}
        </div>
      </div>
      <div>
        <Label>Content alignment</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {(['left', 'center', 'right'] as ContentAlign[]).map(a => {
            const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight;
            return <button key={a} onClick={() => onUpdate({ contentAlign: a })} className={cn('py-1.5 rounded-md border flex items-center justify-center gap-1.5 transition-all', layout.contentAlign === a ? 'bg-navy-800 text-ivory-100 border-navy-800' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}><Icon className="w-3 h-3" /><span className="text-[11px] capitalize">{a}</span></button>;
          })}
        </div>
      </div>
      <SliderRow label="Section spacing" value={layout.sectionSpacing} min={0} max={64} onChange={v => onUpdate({ sectionSpacing: v })} />
      <SliderRow label="Field spacing" value={layout.fieldSpacing} min={0} max={48} onChange={v => onUpdate({ fieldSpacing: v })} />
      <SliderRow label="Page padding" value={layout.pagePadding} min={0} max={64} onChange={v => onUpdate({ pagePadding: v })} />
      <SliderRow label="Column gap" value={layout.columnGap} min={0} max={48} onChange={v => onUpdate({ columnGap: v })} />
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Container radius</Label><RadiusSelect value={layout.containerRadius} onChange={v => onUpdate({ containerRadius: v })} /></div>
        <div><Label>Container shadow</Label><ShadowSelect value={layout.containerShadow} onChange={v => onUpdate({ containerShadow: v })} /></div>
      </div>
    </div>
  );
}

// ============================================================
// FIELDS PANEL
// ============================================================

function FieldsPanel({ fieldStyle, typography, onUpdate }: { fieldStyle: ThemeFieldStyle; typography: ThemeTypography; onUpdate: (u: Partial<ThemeFieldStyle>) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Background</Label><MiniColor value={fieldStyle.background} onChange={v => onUpdate({ background: v })} /></div>
        <div><Label>Text color</Label><MiniColor value={fieldStyle.textColor} onChange={v => onUpdate({ textColor: v })} /></div>
        <div><Label>Border</Label><MiniColor value={fieldStyle.border} onChange={v => onUpdate({ border: v })} /></div>
        <div><Label>Focus border</Label><MiniColor value={fieldStyle.focusBorder} onChange={v => onUpdate({ focusBorder: v })} /></div>
        <div><Label>Placeholder</Label><MiniColor value={fieldStyle.placeholderColor} onChange={v => onUpdate({ placeholderColor: v })} /></div>
        <div><Label>Label color</Label><MiniColor value={fieldStyle.labelColor} onChange={v => onUpdate({ labelColor: v })} /></div>
      </div>
      <SliderRow label="Border width" value={fieldStyle.borderWidth} min={0} max={4} onChange={v => onUpdate({ borderWidth: v })} />
      <SliderRow label="Input height" value={fieldStyle.height} min={32} max={64} onChange={v => onUpdate({ height: v })} />
      <SliderRow label="Input padding" value={fieldStyle.padding} min={4} max={24} onChange={v => onUpdate({ padding: v })} />
      <SliderRow label="Label spacing" value={fieldStyle.labelSpacing} min={0} max={16} onChange={v => onUpdate({ labelSpacing: v })} />
      <div><Label>Border radius</Label><RadiusSelect value={fieldStyle.borderRadius} onChange={v => onUpdate({ borderRadius: v })} /></div>
      <div className="border-t border-navy-50 pt-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-500 mb-2">Help & Error Text</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Help text color</Label><MiniColor value={fieldStyle.helpTextColor} onChange={v => onUpdate({ helpTextColor: v })} /></div>
          <div><Label>Error color</Label><MiniColor value={fieldStyle.errorColor} onChange={v => onUpdate({ errorColor: v })} /></div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// BUTTONS PANEL
// ============================================================

function ButtonsPanel({ buttonStyle, typography, onUpdate }: { buttonStyle: ThemeButtonStyle; typography: ThemeTypography; onUpdate: (u: Partial<ThemeButtonStyle>) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Button style</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {(['filled', 'outline', 'text'] as ButtonStyle[]).map(s => (
            <button key={s} onClick={() => onUpdate({ style: s })} className={cn('py-1.5 rounded-md text-[11px] font-medium border capitalize transition-all', buttonStyle.style === s ? 'bg-navy-800 text-ivory-100 border-navy-800' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}>{s}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Background</Label><MiniColor value={buttonStyle.background} onChange={v => onUpdate({ background: v })} /></div>
        <div><Label>Text color</Label><MiniColor value={buttonStyle.textColor} onChange={v => onUpdate({ textColor: v })} /></div>
        <div><Label>Border</Label><MiniColor value={buttonStyle.border} onChange={v => onUpdate({ border: v })} /></div>
      </div>
      <SliderRow label="Height" value={buttonStyle.height} min={32} max={56} onChange={v => onUpdate({ height: v })} />
      <SliderRow label="Padding" value={buttonStyle.padding} min={8} max={48} onChange={v => onUpdate({ padding: v })} />
      <div><Label>Border radius</Label><RadiusSelect value={buttonStyle.borderRadius} onChange={v => onUpdate({ borderRadius: v })} /></div>
      <div>
        <Label>Width</Label>
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={() => onUpdate({ width: 'auto' })} className={cn('py-1.5 rounded-md text-[11px] font-medium border transition-all', buttonStyle.width === 'auto' ? 'bg-navy-800 text-ivory-100 border-navy-800' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}>Auto</button>
          <button onClick={() => onUpdate({ width: 'full' })} className={cn('py-1.5 rounded-md text-[11px] font-medium border transition-all', buttonStyle.width === 'full' ? 'bg-navy-800 text-ivory-100 border-navy-800' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}>Full width</button>
        </div>
      </div>
      <div>
        <Label>Alignment</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {(['left', 'center', 'right'] as ContentAlign[]).map(a => {
            const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight;
            return <button key={a} onClick={() => onUpdate({ align: a })} className={cn('py-1.5 rounded-md border flex items-center justify-center transition-all', buttonStyle.align === a ? 'bg-navy-800 text-ivory-100 border-navy-800' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}><Icon className="w-3 h-3" /></button>;
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// BACKGROUND PANEL
// ============================================================

function BackgroundPanel({ background, onUpdate }: { background: ThemeBackground; onUpdate: (u: Partial<ThemeBackground>) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Type</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {(['solid', 'gradient', 'image'] as const).map(t => (
            <button key={t} onClick={() => onUpdate({ type: t })} className={cn('py-1.5 rounded-md text-[11px] font-medium border capitalize transition-all', background.type === t ? 'bg-navy-800 text-ivory-100 border-navy-800' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}>{t}</button>
          ))}
        </div>
      </div>
      {background.type === 'solid' && <div><Label>Color</Label><ColorRow label="" value={background.color} onChange={v => onUpdate({ color: v })} /></div>}
      {background.type === 'gradient' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>From</Label><MiniColor value={background.gradientFrom} onChange={v => onUpdate({ gradientFrom: v })} /></div>
            <div><Label>To</Label><MiniColor value={background.gradientTo} onChange={v => onUpdate({ gradientTo: v })} /></div>
          </div>
          <SliderRow label="Angle" value={background.gradientAngle} min={0} max={360} onChange={v => onUpdate({ gradientAngle: v })} />
        </>
      )}
      {background.type === 'image' && (
        <>
          <div><Label>Image URL</Label><input className="input-field text-xs py-1.5" value={background.imageUrl} onChange={e => onUpdate({ imageUrl: e.target.value })} placeholder="https://" /></div>
          <div><Label>Size</Label><div className="grid grid-cols-3 gap-1.5">{(['cover', 'contain', 'auto'] as const).map(s => <button key={s} onClick={() => onUpdate({ imageSize: s })} className={cn('py-1.5 rounded-md text-[11px] font-medium border capitalize transition-all', background.imageSize === s ? 'bg-navy-800 text-ivory-100 border-navy-800' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}>{s}</button>)}</div></div>
          <div><Label>Position</Label><input className="input-field text-xs py-1.5" value={background.imagePosition} onChange={e => onUpdate({ imagePosition: e.target.value })} placeholder="center" /></div>
          <SliderRow label="Overlay opacity" value={background.overlayOpacity} min={0} max={100} onChange={v => onUpdate({ overlayOpacity: v })} />
          <div><Label>Overlay color</Label><MiniColor value={background.overlayColor} onChange={v => onUpdate({ overlayColor: v })} /></div>
        </>
      )}
    </div>
  );
}

// ============================================================
// SPLIT PANEL
// ============================================================

function SplitPanel({ split, onUpdate }: { split: ThemeSplitLayout; onUpdate: (u: Partial<ThemeSplitLayout>) => void }) {
  return (
    <div className="space-y-3">
      <SliderRow label="Left width" value={split.leftWidth} min={20} max={60} onChange={v => onUpdate({ leftWidth: v, rightWidth: 100 - v })} />
      <SliderRow label="Column gap" value={split.columnGap} min={0} max={48} onChange={v => onUpdate({ columnGap: v })} />
      <div><Label>Background image URL</Label><input className="input-field text-xs py-1.5" value={split.backgroundImage} onChange={e => onUpdate({ backgroundImage: e.target.value })} placeholder="https://" /></div>
      <SliderRow label="Overlay opacity" value={split.overlayOpacity} min={0} max={100} onChange={v => onUpdate({ overlayOpacity: v })} />
      <div><Label>Overlay color</Label><MiniColor value={split.backgroundOverlay} onChange={v => onUpdate({ backgroundOverlay: v })} /></div>
      <div>
        <Label>Content alignment</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {(['left', 'center', 'right'] as ContentAlign[]).map(a => {
            const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight;
            return <button key={a} onClick={() => onUpdate({ contentAlign: a })} className={cn('py-1.5 rounded-md border flex items-center justify-center transition-all', split.contentAlign === a ? 'bg-navy-800 text-ivory-100 border-navy-800' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}><Icon className="w-3 h-3" /></button>;
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// BRANDING PANEL
// ============================================================

function BrandingPanel({ branding, onUpdate }: { branding: ThemeBranding; onUpdate: (u: Partial<ThemeBranding>) => void }) {
  return (
    <div className="space-y-3">
      <div><Label>Logo URL</Label><input className="input-field text-xs py-1.5" value={branding.logoUrl} onChange={e => onUpdate({ logoUrl: e.target.value })} placeholder="https://" /></div>
      <SliderRow label="Logo width" value={branding.logoWidth} min={60} max={300} onChange={v => onUpdate({ logoWidth: v })} />
      <div><Label>Company name</Label><input className="input-field text-xs py-1.5" value={branding.companyName} onChange={e => onUpdate({ companyName: e.target.value })} /></div>
      <div><Label>Footer text</Label><input className="input-field text-xs py-1.5" value={branding.footerText} onChange={e => onUpdate({ footerText: e.target.value })} placeholder="© 2026 Your Company" /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Privacy link</Label><input className="input-field text-xs py-1.5" value={branding.privacyLink} onChange={e => onUpdate({ privacyLink: e.target.value })} placeholder="https://" /></div>
        <div><Label>Terms link</Label><input className="input-field text-xs py-1.5" value={branding.termsLink} onChange={e => onUpdate({ termsLink: e.target.value })} placeholder="https://" /></div>
      </div>
    </div>
  );
}

// ============================================================
// PROGRESS PANEL
// ============================================================

function ProgressPanel({ progress, onUpdate }: { progress: ThemeProgress; onUpdate: (u: Partial<ThemeProgress>) => void }) {
  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between cursor-pointer"><span className="text-xs font-medium text-navy-600">Show progress</span><Toggle checked={progress.show} onChange={v => onUpdate({ show: v })} /></label>
      {progress.show && (
        <>
          <div>
            <Label>Style</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['bar', 'steps', 'percentage'] as const).map(s => <button key={s} onClick={() => onUpdate({ style: s })} className={cn('py-1.5 rounded-md text-[11px] font-medium border capitalize transition-all', progress.style === s ? 'bg-navy-800 text-ivory-100 border-navy-800' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}>{s}</button>)}
            </div>
          </div>
          <div><Label>Color</Label><MiniColor value={progress.color} onChange={v => onUpdate({ color: v })} /></div>
          <SliderRow label="Height" value={progress.height} min={2} max={12} onChange={v => onUpdate({ height: v })} />
          <SliderRow label="Spacing" value={progress.spacing} min={0} max={32} onChange={v => onUpdate({ spacing: v })} />
          <label className="flex items-center justify-between cursor-pointer"><span className="text-xs font-medium text-navy-600">Show labels</span><Toggle checked={progress.showLabels} onChange={v => onUpdate({ showLabels: v })} /></label>
        </>
      )}
    </div>
  );
}

// ============================================================
// RESPONSIVE PANEL
// ============================================================

function ResponsivePanel({ viewport, onViewportChange }: { viewport: Viewport; onViewportChange: (v: Viewport) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-ivory-600">Preview your form on different screen sizes. On mobile, multi-column layouts automatically stack into a single column.</p>
      <div className="grid grid-cols-3 gap-1.5">
        {(['desktop', 'tablet', 'mobile'] as Viewport[]).map(vp => {
          const Icon = vp === 'desktop' ? Monitor : vp === 'tablet' ? Tablet : Smartphone;
          return <button key={vp} onClick={() => onViewportChange(vp)} className={cn('py-2 rounded-md border flex flex-col items-center gap-1 transition-all', viewport === vp ? 'bg-navy-800 text-ivory-100 border-navy-800' : 'border-navy-100 text-ivory-600 hover:bg-ivory-50')}><Icon className="w-4 h-4" /><span className="text-[10px] capitalize">{vp}</span></button>;
        })}
      </div>
      <div className="p-2.5 rounded-lg bg-ivory-50 border border-navy-50">
        <p className="text-[11px] text-ivory-600 leading-relaxed">Responsive behavior is automatic. Columns stack on mobile, images resize, and spacing is reduced for smaller screens.</p>
      </div>
    </div>
  );
}

// ============================================================
// SHARED UI PRIMITIVES
// ============================================================

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium text-navy-600 mb-1">{children}</label>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <button onClick={() => onChange(!checked)} className={cn('relative w-9 h-5 rounded-full transition-colors', checked ? 'bg-gold-500' : 'bg-ivory-200')}><span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} /></button>;
}

function MiniColor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <div className="flex items-center gap-1.5"><input type="color" value={value || '#ffffff'} onChange={e => onChange(e.target.value)} className="w-7 h-7 rounded border border-navy-100 cursor-pointer shrink-0" /><input type="text" value={value} onChange={e => onChange(e.target.value)} className="input-field text-xs py-1.5 flex-1" /></div>;
}

function SliderRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return <div><div className="flex items-center justify-between mb-1"><Label>{label}</Label><span className="text-[10px] text-ivory-500 font-mono">{value}px</span></div><input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-gold-500" /></div>;
}

function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <select className="input-field text-xs py-1.5" value={value} onChange={e => onChange(e.target.value)}>{FONT_LIBRARY.map(f => <option key={f.value} value={f.value}>{f.label} ({f.category})</option>)}</select>;
}

function WeightSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <select className="input-field text-xs py-1.5" value={value} onChange={e => onChange(e.target.value)}><option value="400">Regular (400)</option><option value="500">Medium (500)</option><option value="600">Semibold (600)</option><option value="700">Bold (700)</option><option value="800">Extrabold (800)</option></select>;
}

function RadiusSelect({ value, onChange }: { value: RadiusPreset; onChange: (v: RadiusPreset) => void }) {
  return <select className="input-field text-xs py-1.5" value={value} onChange={e => onChange(e.target.value as RadiusPreset)}><option value="none">None</option><option value="small">Small (4px)</option><option value="medium">Medium (8px)</option><option value="large">Large (16px)</option><option value="pill">Pill</option></select>;
}

function ShadowSelect({ value, onChange }: { value: ShadowPreset; onChange: (v: ShadowPreset) => void }) {
  return <select className="input-field text-xs py-1.5" value={value} onChange={e => onChange(e.target.value as ShadowPreset)}><option value="none">None</option><option value="subtle">Subtle</option><option value="medium">Medium</option><option value="strong">Strong</option></select>;
}

// ============================================================
// RESET THEME
// ============================================================

function getResetTheme(): Partial<FormTheme> {
  return JSON.parse(JSON.stringify(DEFAULT_THEME));
}
