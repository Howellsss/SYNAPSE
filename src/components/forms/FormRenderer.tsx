import type {
  FormDefinition, FormElement, FormSection, Viewport,
  FormTheme, ThemeButtonStyle,
} from '@/lib/form-builder-types';
import { RADIUS_MAP as RADIUS, SHADOW_MAP as SHADOW, WIDTH_MAP as WIDTH } from '@/lib/form-builder-types';
import { cn } from '@/lib/utils';

// ============================================================
// FORM RENDERER — shared by builder canvas, preview, published
// ============================================================

interface FormRendererProps {
  definition: FormDefinition;
  formName: string;
  formDescription?: string | null;
  viewport?: Viewport;
  currentPageIndex?: number;
  builderMode?: boolean;
  selectedElementId?: string | null;
  onSelectElement?: (id: string) => void;
  answers?: Record<string, string>;
  onAnswerChange?: (fieldId: string, value: string) => void;
  currentPage?: number;
  totalPages?: number;
  onSubmit?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
}

// Helper: resolve effective background CSS
function getBackgroundCSS(theme: FormTheme): React.CSSProperties {
  const bg = theme.background;
  if (bg.type === 'gradient') {
    return { background: `linear-gradient(${bg.gradientAngle}deg, ${bg.gradientFrom}, ${bg.gradientTo})` };
  }
  if (bg.type === 'image' && bg.imageUrl) {
    return {
      backgroundImage: `url(${bg.imageUrl})`,
      backgroundSize: bg.imageSize,
      backgroundPosition: bg.imagePosition,
    };
  }
  return { backgroundColor: bg.color };
}

// Helper: check if split layout is active and applicable
function isSplitLayout(theme: FormTheme, viewport: Viewport): boolean {
  return theme.layoutPreset === 'split' && viewport !== 'mobile';
}

export function FormRenderer({
  definition, formName, formDescription,
  viewport = 'desktop', currentPageIndex = 0,
  builderMode = false, selectedElementId, onSelectElement,
  answers = {}, onAnswerChange,
  currentPage = 0, totalPages = 1,
  onSubmit, onNext, onPrevious,
}: FormRendererProps) {
  const theme = definition.theme;
  const page = definition.pages[currentPageIndex];
  if (!page) return null;

  const bgStyle = getBackgroundCSS(theme);
  const showOverlay = theme.background.type === 'image' && theme.background.imageUrl && theme.background.overlayOpacity > 0;
  const split = isSplitLayout(theme, viewport);
  const layoutPreset = theme.layoutPreset;
  const maxFormWidth = WIDTH[theme.layout.formWidth] || theme.maxFormWidth || '640px';

  // Form container styles based on layout preset
  const containerClass = cn(
    layoutPreset === 'centered' && 'flex items-center justify-center min-h-full',
    layoutPreset === 'card' && 'shadow-lg',
    layoutPreset === 'full_width' && 'w-full',
  );

  const surfaceStyle: React.CSSProperties = {
    backgroundColor: theme.colors.surfaceBackground,
    borderRadius: layoutPreset === 'card' ? RADIUS[theme.layout.containerRadius] : undefined,
    boxShadow: layoutPreset === 'card' ? SHADOW[theme.layout.containerShadow] : undefined,
    fontFamily: theme.typography.primaryFont,
  };

  const paddingStyle: React.CSSProperties = {
    padding: `${theme.layout.pagePadding}px`,
  };

  // Render the form body (shared across layout presets)
  const formBody = (
    <>
      {definition.header.enabled && (
        <FormHeader definition={definition} formName={formName} formDescription={formDescription} currentPage={currentPage} totalPages={totalPages} />
      )}

      <div style={paddingStyle}>
        {page.sectionIds.map(sectionId => {
          const section = definition.sections[sectionId];
          if (!section || !section.visible) return null;
          return <RenderSection key={sectionId} section={section} definition={definition} builderMode={builderMode} selectedElementId={selectedElementId} onSelectElement={onSelectElement} answers={answers} onAnswerChange={onAnswerChange} viewport={viewport} />;
        })}

        {!builderMode && totalPages > 1 && (
          <div className="flex items-center justify-between mt-8 pt-6 border-t" style={{ borderColor: theme.colors.border }}>
            <div>{currentPage > 0 && <button onClick={onPrevious} style={getButtonStyle(theme, theme.buttonStyle, 'outline')}>Back</button>}</div>
            <div>{currentPage < totalPages - 1 ? <button onClick={onNext} style={getButtonStyle(theme, theme.buttonStyle)}>Next</button> : <button onClick={onSubmit} style={getButtonStyle(theme, theme.buttonStyle)}>Submit</button>}</div>
          </div>
        )}

        {!builderMode && totalPages === 1 && page.sectionIds.some(sid => { const sec = definition.sections[sid]; return sec?.elementIds.some(eid => definition.elements[eid]?.field); }) && (
          <div className="mt-8 pt-6 border-t" style={{ borderColor: theme.colors.border, textAlign: theme.buttonStyle.align }}>
            <button onClick={onSubmit} style={getButtonStyle(theme, theme.buttonStyle, undefined, theme.buttonStyle.width === 'full' ? '100%' : 'auto')}>Submit</button>
          </div>
        )}
      </div>

      {definition.footer.enabled && definition.footer.content && (
        <div style={{ padding: `${theme.layout.pagePadding}px`, textAlign: 'center', fontSize: '12px', color: theme.colors.mutedText, borderTop: `1px solid ${theme.colors.border}` }}>
          {definition.footer.content}
        </div>
      )}
    </>
  );

  // Split layout
  if (split) {
    const leftWidth = `${theme.split.leftWidth}%`;
    const rightWidth = `${theme.split.rightWidth}%`;
    return (
      <div className="w-full" style={{ ...bgStyle, fontFamily: theme.typography.primaryFont }}>
        {showOverlay && <div className="fixed inset-0 pointer-events-none" style={{ backgroundColor: theme.background.overlayColor, opacity: theme.background.overlayOpacity / 100 }} />}
        <div className="flex min-h-full relative" style={{ gap: `${theme.split.columnGap}px` }}>
          {/* Left panel */}
          <div className="relative flex flex-col justify-center" style={{ width: leftWidth, minHeight: '100vh' }}>
            {theme.split.backgroundImage && (
              <>
                <div className="absolute inset-0" style={{ backgroundImage: `url(${theme.split.backgroundImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                {theme.split.overlayOpacity > 0 && <div className="absolute inset-0" style={{ backgroundColor: theme.split.backgroundOverlay, opacity: theme.split.overlayOpacity / 100 }} />}
              </>
            )}
            <div className="relative" style={{ padding: `${theme.layout.pagePadding}px`, textAlign: theme.split.contentAlign, color: theme.split.backgroundImage ? '#ffffff' : theme.colors.heading }}>
              {definition.header.enabled && definition.header.showTitle && <h1 style={{ fontSize: theme.typography.headingSize, fontWeight: theme.typography.headingWeight, lineHeight: theme.typography.headingLineHeight, letterSpacing: theme.typography.headingLetterSpacing, color: theme.split.backgroundImage ? '#ffffff' : theme.colors.heading, fontFamily: theme.typography.headingFont }}>{formName}</h1>}
              {definition.header.enabled && definition.header.showDescription && formDescription && <p style={{ marginTop: '12px', fontSize: theme.typography.bodySize, color: theme.split.backgroundImage ? 'rgba(255,255,255,0.8)' : theme.colors.bodyText, lineHeight: theme.typography.bodyLineHeight }}>{formDescription}</p>}
            </div>
          </div>
          {/* Right panel — form */}
          <div className="flex flex-col justify-center" style={{ width: rightWidth, minHeight: '100vh', ...surfaceStyle }}>
            {formBody}
          </div>
        </div>
      </div>
    );
  }

  // Standard layouts
  const wrapperStyle: React.CSSProperties = layoutPreset === 'full_width' ? {} : { maxWidth: maxFormWidth, margin: '0 auto' };
  const centeredWrapper = layoutPreset === 'centered' ? { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' } : {};

  return (
    <div className="w-full transition-all duration-300" style={{ ...bgStyle, fontFamily: theme.typography.primaryFont, ...centeredWrapper }}>
      {showOverlay && <div className="fixed inset-0 pointer-events-none" style={{ backgroundColor: theme.background.overlayColor, opacity: theme.background.overlayOpacity / 100 }} />}
      <div className="relative" style={{ ...wrapperStyle }}>
        <div className={cn('overflow-hidden', containerClass)} style={surfaceStyle}>
          {formBody}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// BUTTON STYLE HELPER
// ============================================================

function getButtonStyle(theme: FormTheme, btn: ThemeButtonStyle, variantOverride?: 'filled' | 'outline' | 'text', widthOverride?: string): React.CSSProperties {
  const style = variantOverride || btn.style;
  const radius = RADIUS[btn.borderRadius];
  const base: React.CSSProperties = {
    height: `${btn.height}px`,
    padding: `0 ${btn.padding}px`,
    fontSize: theme.typography.buttonSize,
    fontWeight: theme.typography.buttonWeight,
    fontFamily: theme.typography.primaryFont,
    borderRadius: radius,
    width: widthOverride || (btn.width === 'full' ? '100%' : 'auto'),
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  };

  if (style === 'filled') {
    base.backgroundColor = btn.background;
    base.color = btn.textColor;
    base.border = `${theme.fieldStyle.borderWidth}px solid ${btn.border}`;
  } else if (style === 'outline') {
    base.backgroundColor = 'transparent';
    base.color = btn.background;
    base.border = `${theme.fieldStyle.borderWidth * 1.5}px solid ${btn.border}`;
  } else {
    base.backgroundColor = 'transparent';
    base.color = btn.background;
    base.border = 'none';
    base.padding = `0 ${btn.padding / 2}px`;
  }

  return base;
}

// ============================================================
// HEADER
// ============================================================

function FormHeader({ definition, formName, formDescription, currentPage, totalPages }: {
  definition: FormDefinition; formName: string; formDescription?: string | null; currentPage: number; totalPages: number;
}) {
  const { header, theme } = definition;
  const pad = theme.layout.pagePadding;
  return (
    <div style={{ padding: `${pad}px ${pad}px 0`, borderBottom: `1px solid ${theme.colors.border}` }}>
      {header.showLogo && (header.logoUrl || theme.branding.logoUrl) && (
        <div style={{ marginBottom: '16px' }}>
          <img src={header.logoUrl || theme.branding.logoUrl} alt="Logo" style={{ height: 'auto', maxWidth: `${theme.branding.logoWidth}px`, maxHeight: '48px' }} />
        </div>
      )}
      {header.showTitle && (
        <h1 style={{ fontSize: theme.typography.headingSize, fontWeight: theme.typography.headingWeight, lineHeight: theme.typography.headingLineHeight, letterSpacing: theme.typography.headingLetterSpacing, color: theme.colors.heading, fontFamily: theme.typography.headingFont, margin: 0 }}>{formName}</h1>
      )}
      {header.showDescription && formDescription && (
        <p style={{ marginTop: '6px', fontSize: theme.typography.bodySize, color: theme.colors.bodyText, lineHeight: theme.typography.bodyLineHeight, fontFamily: theme.typography.bodyFont }}>{formDescription}</p>
      )}
      {header.showProgress && theme.progress.show && totalPages > 1 && (
        <ProgressIndicator theme={theme} currentPage={currentPage} totalPages={totalPages} />
      )}
    </div>
  );
}

// ============================================================
// PROGRESS INDICATOR
// ============================================================

function ProgressIndicator({ theme, currentPage, totalPages }: { theme: FormTheme; currentPage: number; totalPages: number }) {
  const pct = Math.round(((currentPage + 1) / totalPages) * 100);
  if (theme.progress.style === 'percentage') {
    return <div style={{ marginTop: '16px', marginBottom: '8px', fontSize: '13px', color: theme.colors.mutedText }}>{pct}% complete</div>;
  }
  if (theme.progress.style === 'steps') {
    return (
      <div style={{ marginTop: '16px', marginBottom: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        {Array.from({ length: totalPages }, (_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600, backgroundColor: i <= currentPage ? theme.progress.color : theme.colors.border, color: i <= currentPage ? '#fff' : theme.colors.mutedText }}>{i + 1}</div>
            {theme.progress.showLabels && i < totalPages - 1 && <div style={{ width: '24px', height: '2px', backgroundColor: theme.colors.border }} />}
          </div>
        ))}
      </div>
    );
  }
  // Bar
  return (
    <div style={{ marginTop: `${theme.progress.spacing}px`, marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: theme.colors.mutedText, marginBottom: '6px' }}>
        <span>Page {currentPage + 1} of {totalPages}</span>
        {theme.progress.showLabels && <span>{pct}%</span>}
      </div>
      <div style={{ height: `${theme.progress.height}px`, borderRadius: '999px', overflow: 'hidden', backgroundColor: theme.colors.border }}>
        <div style={{ height: '100%', borderRadius: '999px', transition: 'width 0.3s', width: `${pct}%`, backgroundColor: theme.progress.color }} />
      </div>
    </div>
  );
}

// ============================================================
// SECTION RENDERER
// ============================================================

function RenderSection({ section, definition, builderMode, selectedElementId, onSelectElement, answers, onAnswerChange, viewport }: {
  section: FormSection; definition: FormDefinition; builderMode: boolean; selectedElementId?: string | null; onSelectElement?: (id: string) => void; answers: Record<string, string>; onAnswerChange?: (fieldId: string, value: string) => void; viewport: Viewport;
}) {
  const theme = definition.theme;
  const style = section.style;
  const effectiveColumnCount = viewport === 'mobile' ? 1 : section.columnCount;
  const columns: FormElement[][] = Array.from({ length: effectiveColumnCount }, () => []);
  for (const elId of section.elementIds) {
    const el = definition.elements[elId];
    if (!el) continue;
    const col = viewport === 'mobile' ? 0 : Math.min((el.column ?? 1) - 1, effectiveColumnCount - 1);
    columns[col].push(el);
  }

  const sectionStyle: React.CSSProperties = {
    backgroundColor: style?.backgroundColor,
    backgroundImage: style?.backgroundImage ? `url(${style.backgroundImage})` : undefined,
    backgroundSize: style?.backgroundSize,
    backgroundPosition: style?.backgroundPosition,
    borderRadius: style?.borderRadius,
    marginBottom: style?.marginBottom ?? `${theme.layout.sectionSpacing}px`,
    padding: style?.padding,
  };
  const showOverlay = style?.overlayColor && style?.overlayOpacity !== undefined && style?.backgroundImage;

  return (
    <div className="relative last:mb-0" style={sectionStyle}>
      {showOverlay && <div className="absolute inset-0" style={{ backgroundColor: style!.overlayColor, opacity: style!.overlayOpacity! / 100, borderRadius: style?.borderRadius, pointerEvents: 'none' }} />}
      <div className="relative">
        <div className={cn(effectiveColumnCount === 2 && 'grid grid-cols-1 sm:grid-cols-2', effectiveColumnCount === 3 && 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3', effectiveColumnCount === 1 && 'space-y-0')} style={{ gap: effectiveColumnCount > 1 ? `${theme.layout.columnGap}px` : undefined }}>
          {columns.map((colElements, colIdx) => (
            <div key={colIdx} style={{ display: 'flex', flexDirection: 'column', gap: `${theme.layout.fieldSpacing}px` }}>
              {colElements.map(el => <RenderElement key={el.id} element={el} definition={definition} builderMode={builderMode} selected={selectedElementId === el.id} onSelect={onSelectElement} answers={answers} onAnswerChange={onAnswerChange} viewport={viewport} />)}
              {colElements.length === 0 && builderMode && <div className="min-h-[60px] rounded-lg border-2 border-dashed flex items-center justify-center text-xs" style={{ borderColor: theme.colors.border, color: theme.colors.mutedText }}>Drop elements here</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ELEMENT RENDERER
// ============================================================

function RenderElement({ element, definition, builderMode, selected, onSelect, answers, onAnswerChange, viewport }: {
  element: FormElement; definition: FormDefinition; builderMode: boolean; selected: boolean; onSelect?: (id: string) => void; answers: Record<string, string>; onAnswerChange?: (fieldId: string, value: string) => void; viewport: Viewport;
}) {
  const theme = definition.theme;
  const style = element.style;
  const elementStyle: React.CSSProperties = {
    color: style?.textColor, fontSize: style?.fontSize, fontWeight: style?.fontWeight,
    textAlign: style?.textAlign, marginTop: style?.marginTop, marginBottom: style?.marginBottom,
    backgroundColor: style?.backgroundColor, borderRadius: style?.borderRadius, padding: style?.padding,
  };
  const handleClick = (e: React.MouseEvent) => { if (builderMode && onSelect) { e.stopPropagation(); onSelect(element.id); } };

  return (
    <div className={cn('relative transition-all', builderMode && 'cursor-pointer', builderMode && selected && 'ring-2 ring-gold-400 ring-offset-2 rounded-lg', builderMode && !selected && 'hover:ring-1 hover:ring-gray-300 rounded-lg')} style={elementStyle} onClick={handleClick}>
      {renderElementContent(element, definition, builderMode, answers, onAnswerChange)}
    </div>
  );
}

function renderElementContent(element: FormElement, definition: FormDefinition, builderMode: boolean, answers: Record<string, string>, onAnswerChange?: (fieldId: string, value: string) => void): React.ReactNode {
  const theme = definition.theme;
  const c = element.content;
  const f = element.field;

  switch (element.type) {
    case 'heading': {
      const level = c?.headingLevel ?? 'h2';
      const sizeMap: Record<string, string> = { h1: theme.typography.headingSize, h2: `${parseInt(theme.typography.headingSize) * 0.85}px`, h3: `${parseInt(theme.typography.headingSize) * 0.7}px`, h4: `${parseInt(theme.typography.headingSize) * 0.6}px` };
      const Tag = level as 'h1' | 'h2' | 'h3' | 'h4';
      return <Tag style={{ fontSize: sizeMap[level], fontWeight: theme.typography.headingWeight, lineHeight: theme.typography.headingLineHeight, letterSpacing: theme.typography.headingLetterSpacing, color: element.style?.textColor || theme.colors.heading, fontFamily: theme.typography.headingFont, margin: 0 }}>{c?.text || 'Heading'}</Tag>;
    }
    case 'text': return <p style={{ fontSize: theme.typography.bodySize, fontWeight: '500', color: element.style?.textColor || theme.colors.primary, fontFamily: theme.typography.bodyFont, margin: 0 }}>{c?.text || 'Text'}</p>;
    case 'paragraph': return <p style={{ fontSize: theme.typography.bodySize, lineHeight: theme.typography.bodyLineHeight, color: element.style?.textColor || theme.colors.bodyText, fontFamily: theme.typography.bodyFont, margin: 0 }}>{c?.text || 'Paragraph text.'}</p>;
    case 'image': {
      if (!c?.imageUrl) return <div className="rounded-lg border-2 border-dashed flex items-center justify-center py-12 text-sm" style={{ borderColor: theme.colors.border, color: theme.colors.mutedText, background: theme.colors.surfaceBackground }}>Upload an image</div>;
      return <img src={c.imageUrl} alt={c.altText || ''} className="w-full" style={{ borderRadius: element.style?.borderRadius, objectFit: element.style?.objectFit || 'cover', aspectRatio: element.style?.aspectRatio, maxHeight: element.style?.height }} />;
    }
    case 'logo': return c?.imageUrl ? <img src={c.imageUrl} alt="Logo" className="h-10 w-auto" style={{ maxWidth: `${theme.branding.logoWidth}px` }} /> : <div className="h-10 w-32 rounded flex items-center justify-center text-xs" style={{ background: theme.colors.border, color: theme.colors.mutedText }}>Logo</div>;
    case 'divider': return <hr style={{ borderStyle: c?.dividerStyle || 'solid', borderColor: theme.colors.border, borderWidth: '0 0 1px 0', margin: 0 }} />;
    case 'spacer': return <div style={{ height: `${c?.spacerHeight ?? 24}px` }} />;
    case 'button': return <div style={{ textAlign: element.style?.textAlign || theme.buttonStyle.align }}><button type="button" style={getButtonStyle(theme, theme.buttonStyle, undefined, element.style?.width === 'full' ? '100%' : 'auto')} onClick={e => e.preventDefault()}>{c?.buttonText || 'Button'}</button></div>;
    default:
      if (!f) return null;
      return <FieldRenderer element={element} definition={definition} builderMode={builderMode} value={answers[f.fieldId] ?? ''} onChange={val => onAnswerChange?.(f.fieldId, val)} />;
  }
}

// ============================================================
// FIELD RENDERER — uses theme.fieldStyle
// ============================================================

function FieldRenderer({ element, definition, builderMode, value, onChange }: {
  element: FormElement; definition: FormDefinition; builderMode: boolean; value: string; onChange: (val: string) => void;
}) {
  const theme = definition.theme;
  const fs = theme.fieldStyle;
  const f = element.field!;
  const radius = RADIUS[fs.borderRadius];
  const inputStyle: React.CSSProperties = {
    border: `${fs.borderWidth}px solid ${fs.border}`,
    borderRadius: radius,
    backgroundColor: fs.background,
    color: fs.textColor,
    height: `${fs.height}px`,
    padding: `0 ${fs.padding}px`,
    fontSize: theme.typography.bodySize,
    fontFamily: theme.typography.bodyFont,
    width: '100%',
    transition: 'border-color 0.2s',
    outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    color: fs.labelColor,
    fontSize: fs.labelSize,
    fontWeight: fs.labelWeight,
    fontFamily: theme.typography.bodyFont,
    marginBottom: `${fs.labelSpacing}px`,
    display: 'block',
  };
  const helpStyle: React.CSSProperties = {
    color: fs.helpTextColor,
    fontSize: fs.helpTextSize,
    fontFamily: theme.typography.bodyFont,
    marginBottom: `${fs.labelSpacing}px`,
  };
  const handleChange = (val: string) => { if (!builderMode) onChange(val); };
  const disabled = builderMode;

  return (
    <div>
      <label style={labelStyle}>{f.label}{f.required && <span style={{ color: theme.colors.error, marginLeft: '2px' }}>*</span>}</label>
      {f.description && <p style={helpStyle}>{f.description}</p>}
      {renderFieldInput(element, f, value, handleChange, inputStyle, theme, disabled)}
    </div>
  );
}

function renderFieldInput(element: FormElement, f: NonNullable<FormElement['field']>, value: string, onChange: (v: string) => void, inputStyle: React.CSSProperties, theme: FormTheme, disabled: boolean): React.ReactNode {
  const type = element.type;
  const fs = theme.fieldStyle;
  const baseClass = "w-full transition-colors focus:outline-none";
  const focusBorder = { onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { e.target.style.borderColor = fs.focusBorder; }, onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { e.target.style.borderColor = fs.border; } };
  const placeholderStyle = { color: fs.placeholderColor } as React.CSSProperties;

  if (type === 'text_field' || type === 'website') return <input type={type === 'website' ? 'url' : 'text'} className={baseClass} style={{ ...inputStyle, ...placeholderStyle }} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder} disabled={disabled} {...focusBorder} />;
  if (type === 'first_name' || type === 'last_name') return <input type="text" className={baseClass} style={{ ...inputStyle, ...placeholderStyle }} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder} disabled={disabled} {...focusBorder} />;
  if (type === 'email') return <input type="email" className={baseClass} style={{ ...inputStyle, ...placeholderStyle }} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder} disabled={disabled} {...focusBorder} />;
  if (type === 'phone') return <input type="tel" className={baseClass} style={{ ...inputStyle, ...placeholderStyle }} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder} disabled={disabled} {...focusBorder} />;
  if (type === 'number') return <input type="number" className={baseClass} style={inputStyle} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder} disabled={disabled} {...focusBorder} />;
  if (type === 'date') return <input type="date" className={baseClass} style={inputStyle} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} {...focusBorder} />;
  if (type === 'time') return <input type="time" className={baseClass} style={inputStyle} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} {...focusBorder} />;
  if (type === 'long_text' || type === 'address') return <textarea className={cn(baseClass, 'min-h-[100px] resize-y')} style={{ ...inputStyle, height: 'auto', padding: `${fs.padding}px`, ...placeholderStyle }} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder} disabled={disabled} {...focusBorder} />;

  if (type === 'radio' || type === 'yes_no') {
    const options = f.options || ['Yes', 'No'];
    return <div className="space-y-2">{options.map((opt, i) => <label key={i} className="flex items-center gap-2.5 text-sm cursor-pointer"><input type="radio" name={f.fieldId} value={opt} checked={value === opt} onChange={() => onChange(opt)} disabled={disabled} className="w-4 h-4" style={{ accentColor: theme.colors.primary }} /><span style={{ color: theme.colors.bodyText, fontFamily: theme.typography.bodyFont }}>{opt}</span></label>)}{f.allowOther && <div className="flex items-center gap-2.5"><input type="radio" name={f.fieldId} value="__other__" disabled={disabled} className="w-4 h-4" /><input type="text" placeholder="Other..." className="flex-1 px-3 py-1.5 text-sm border" style={inputStyle} disabled={disabled} onChange={e => onChange(e.target.value)} /></div>}</div>;
  }

  if (type === 'checkbox' || type === 'multi_select') {
    const options = f.options || [];
    const selected = value ? value.split(',').filter(Boolean) : [];
    return <div className="space-y-2">{options.map((opt, i) => <label key={i} className="flex items-center gap-2.5 text-sm cursor-pointer"><input type="checkbox" value={opt} checked={selected.includes(opt)} onChange={e => { if (disabled) return; const next = e.target.checked ? [...selected, opt] : selected.filter(s => s !== opt); onChange(next.join(',')); }} disabled={disabled} className="w-4 h-4" style={{ accentColor: theme.colors.primary }} /><span style={{ color: theme.colors.bodyText, fontFamily: theme.typography.bodyFont }}>{opt}</span></label>)}</div>;
  }

  if (type === 'dropdown') {
    const options = f.options || [];
    return <select className={baseClass} style={inputStyle} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} {...focusBorder}><option value="">Select...</option>{options.map((opt, i) => <option key={i} value={opt}>{opt}</option>)}</select>;
  }

  if (type === 'consent') return <label className="flex items-start gap-2.5 text-sm cursor-pointer"><input type="checkbox" checked={value === 'true'} onChange={e => onChange(e.target.checked ? 'true' : '')} disabled={disabled} className="w-4 h-4 mt-0.5" style={{ accentColor: theme.colors.primary }} /><span style={{ color: theme.colors.bodyText, fontFamily: theme.typography.bodyFont }}>{element.content?.text || 'I agree to be contacted regarding my submission.'}</span></label>;

  if (type === 'rating') {
    const max = element.content?.maxRating ?? 5;
    const Icon = element.content?.ratingSymbol === 'heart' ? '♥' : element.content?.ratingSymbol === 'circle' ? '●' : '★';
    return <div className="flex items-center gap-1.5">{Array.from({ length: max }, (_, i) => <button key={i} type="button" disabled={disabled} onClick={() => !disabled && onChange(String(i + 1))} className={cn('text-2xl transition-all', !disabled && 'hover:scale-110')} style={{ color: i < Number(value) ? '#f59e0b' : '#d1d5db', background: 'none', border: 'none', cursor: 'pointer' }}>{Icon}</button>)}</div>;
  }

  if (type === 'scale') {
    const min = element.content?.scaleMin ?? 1;
    const max = element.content?.scaleMax ?? 10;
    const numbers: number[] = [];
    for (let i = min; i <= max; i += element.content?.scaleStep ?? 1) numbers.push(i);
    return <div><div className="flex flex-wrap gap-2">{numbers.map(n => <button key={n} type="button" disabled={disabled} onClick={() => !disabled && onChange(String(n))} className="rounded-lg text-sm font-medium border transition-all" style={{ width: '40px', height: '40px', borderColor: Number(value) === n ? theme.colors.primary : theme.colors.border, backgroundColor: Number(value) === n ? theme.colors.primary : theme.colors.surfaceBackground, color: Number(value) === n ? '#fff' : theme.colors.bodyText, cursor: 'pointer' }}>{n}</button>)}</div><div className="flex items-center justify-between mt-2 text-xs" style={{ color: theme.colors.mutedText }}><span>{element.content?.scaleMinLabel}</span><span>{element.content?.scaleMaxLabel}</span></div></div>;
  }

  if (type === 'file_upload') return <div className="rounded-lg border-2 border-dashed py-8 px-4 text-center" style={{ borderColor: theme.colors.border, background: theme.colors.surfaceBackground }}><p className="text-sm" style={{ color: theme.colors.mutedText }}>Click to upload or drag and drop</p>{f.allowedFileTypes && <p className="text-xs mt-1" style={{ color: theme.colors.mutedText }}>{f.allowedFileTypes.join(', ')}</p>}</div>;
  if (type === 'signature') return <div className="rounded-lg border-2 border-dashed py-8 text-center" style={{ borderColor: theme.colors.border, background: theme.colors.surfaceBackground }}><p className="text-sm" style={{ color: theme.colors.mutedText }}>Signature pad</p></div>;
  if (type === 'hidden') return <input type="hidden" value={f.defaultValue || ''} />;

  return null;
}
