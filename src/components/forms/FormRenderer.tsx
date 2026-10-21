import type {
  FormDefinition, FormElement, FormSection, Viewport,
  FormTheme, ThemeButtonStyle, PaymentConfig,
} from '@/lib/form-builder-types';
import { RADIUS_MAP as RADIUS, SHADOW_MAP as SHADOW, WIDTH_MAP as WIDTH } from '@/lib/form-builder-types';
import { cn } from '@/lib/utils';
import { createContext, useContext, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { countryNames } from '@/lib/countries';
import { CAPTCHA_OK, CAPTCHA_WRONG, money, paymentFor, splitMulti } from '@/lib/form-engine';
import { FileUploadInput, SignatureInput } from './ResponseInputs';

/**
 * While someone fills the form in (the public page and the preview): what logic hides or
 * requires right now, mistakes to show, and how the buttons read. The builder canvas leaves it out.
 */
export interface FormRuntime {
  hidden: Set<string>;
  required: Set<string>;
  errors: Record<string, string>;
  /** The buttons: whether Back shows, and whether this is the last step. */
  canGoBack: boolean;
  isLast: boolean;
  busy?: boolean;
  submitLabel?: string;
  autoComplete?: 'on' | 'off';
  /** Slides that move on by themselves when a single choice is picked. */
  onPicked?: () => void;
  /** The form files are sent to (File Upload). Absent on the builder canvas. */
  formId?: string;
}
const RuntimeCtx = createContext<FormRuntime | null>(null);
/** What a Button element can do while the form is filled in. */
const ActionsCtx = createContext<{ submit?: () => void; next?: () => void; previous?: () => void; isLast: boolean } | null>(null);

/** "medium" / "semibold" as CSS weights. */
const WEIGHT: Record<string, number> = { normal: 400, medium: 500, semibold: 600, bold: 700 };
/** Element width inside its column. */
const WIDTH_PCT: Record<string, string> = { full: '100%', half: '50%', third: '33.333%' };

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
  runtime?: FormRuntime;
}

// Helper: resolve effective background CSS
export function getBackgroundCSS(theme: FormTheme): React.CSSProperties {
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
  onSubmit, onNext, onPrevious, runtime,
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

  const branding = theme.branding;
  const hasBrandFooter = !!(branding.companyName || branding.footerText || branding.privacyLink || branding.termsLink);
  const actions = { submit: onSubmit, next: onNext, previous: onPrevious, isLast: runtime ? runtime.isLast : currentPage >= totalPages - 1 };
  const navAlign = theme.buttonStyle.align === 'center' ? 'center' : theme.buttonStyle.align === 'right' ? 'flex-end' : 'flex-start';

  // Render the form body (shared across layout presets)
  const formBody = (
    <RuntimeCtx.Provider value={runtime ?? null}>
    <ActionsCtx.Provider value={builderMode ? null : actions}>
      {definition.header.enabled && (
        <FormHeader definition={definition} formName={formName} formDescription={formDescription} currentPage={currentPage} totalPages={totalPages} />
      )}

      <div style={paddingStyle}>
        {page.sectionIds.map(sectionId => {
          const section = definition.sections[sectionId];
          if (!section || !section.visible) return null;
          return <RenderSection key={sectionId} section={section} definition={definition} builderMode={builderMode} selectedElementId={selectedElementId} onSelectElement={onSelectElement} answers={answers} onAnswerChange={onAnswerChange} viewport={viewport} />;
        })}

        {!builderMode && runtime && (
          <div className="flex items-center gap-3 mt-8 pt-6 border-t" style={{ borderColor: theme.colors.border, justifyContent: runtime.canGoBack ? 'space-between' : navAlign }}>
            {runtime.canGoBack && <div><button type="button" onClick={onPrevious} disabled={runtime.busy} style={getButtonStyle(theme, theme.buttonStyle, 'outline')}>Back</button></div>}
            <div style={{ flex: theme.buttonStyle.width === 'full' && !runtime.canGoBack ? 1 : undefined }}>
              {runtime.isLast
                ? <button type="button" onClick={onSubmit} disabled={runtime.busy} style={{ ...getButtonStyle(theme, theme.buttonStyle, undefined, theme.buttonStyle.width === 'full' ? '100%' : 'auto'), opacity: runtime.busy ? 0.6 : 1 }}>{runtime.busy ? 'Sending…' : runtime.submitLabel || 'Submit'}</button>
                : <button type="button" onClick={onNext} disabled={runtime.busy} style={getButtonStyle(theme, theme.buttonStyle)}>Next</button>}
            </div>
          </div>
        )}

        {!builderMode && !runtime && totalPages > 1 && (
          <div className="flex items-center justify-between mt-8 pt-6 border-t" style={{ borderColor: theme.colors.border }}>
            <div>{currentPage > 0 && <button onClick={onPrevious} style={getButtonStyle(theme, theme.buttonStyle, 'outline')}>Back</button>}</div>
            <div>{currentPage < totalPages - 1 ? <button onClick={onNext} style={getButtonStyle(theme, theme.buttonStyle)}>Next</button> : <button onClick={onSubmit} style={getButtonStyle(theme, theme.buttonStyle)}>Submit</button>}</div>
          </div>
        )}

        {!builderMode && !runtime && totalPages === 1 && page.sectionIds.some(sid => { const sec = definition.sections[sid]; return sec?.elementIds.some(eid => definition.elements[eid]?.field); }) && (
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
      {hasBrandFooter && (
        <div style={{ padding: `14px ${theme.layout.pagePadding}px`, textAlign: 'center', fontSize: '12px', lineHeight: 1.6, color: theme.colors.mutedText, borderTop: `1px solid ${theme.colors.border}`, fontFamily: theme.typography.bodyFont }}>
          {(branding.companyName || branding.footerText) && <p style={{ margin: 0 }}>{[branding.companyName, branding.footerText].filter(Boolean).join(' · ')}</p>}
          {(branding.privacyLink || branding.termsLink) && (
            <p style={{ margin: '4px 0 0', display: 'flex', justifyContent: 'center', gap: '14px' }}>
              {branding.privacyLink && <a href={branding.privacyLink} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy</a>}
              {branding.termsLink && <a href={branding.termsLink} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Terms</a>}
            </p>
          )}
        </div>
      )}
    </ActionsCtx.Provider>
    </RuntimeCtx.Provider>
  );

  // Split layout
  if (split) {
    const leftWidth = `${theme.split.leftWidth}%`;
    const rightWidth = `${theme.split.rightWidth}%`;
    return (
      <div className="relative w-full" style={{ ...bgStyle, fontFamily: theme.typography.primaryFont }}>
        {showOverlay && <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: theme.background.overlayColor, opacity: theme.background.overlayOpacity / 100 }} />}
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
    <div className="relative w-full transition-all duration-300" style={{ ...bgStyle, fontFamily: theme.typography.primaryFont, ...centeredWrapper }}>
      {showOverlay && <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: theme.background.overlayColor, opacity: theme.background.overlayOpacity / 100 }} />}
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

export function getButtonStyle(theme: FormTheme, btn: ThemeButtonStyle, variantOverride?: 'filled' | 'outline' | 'text', widthOverride?: string): React.CSSProperties {
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

export function FormHeader({ definition, formName, formDescription, currentPage, totalPages }: {
  definition: FormDefinition; formName: string; formDescription?: string | null; currentPage: number; totalPages: number;
}) {
  const { header, theme } = definition;
  const pad = theme.layout.pagePadding;
  return (
    <div style={{ padding: `${pad}px ${pad}px 0`, borderBottom: `1px solid ${theme.colors.border}` }}>
      {((header.showLogo && header.logoUrl) || theme.branding.logoUrl) && (
        <div style={{ marginBottom: '16px', textAlign: theme.layout.contentAlign === 'center' ? 'center' : undefined }}>
          <img src={(header.showLogo && header.logoUrl) || theme.branding.logoUrl} alt={theme.branding.companyName || 'Logo'} style={{ height: 'auto', maxWidth: `${theme.branding.logoWidth}px`, maxHeight: '48px' }} />
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
        <span>Step {currentPage + 1} of {totalPages}</span>
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
  const runtime = useContext(RuntimeCtx);
  for (const elId of section.elementIds) {
    const el = definition.elements[elId];
    if (!el || runtime?.hidden.has(el.id)) continue;
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

/** One element as the builder canvas shows it: exactly as on the form, but not fillable. */
export function BuilderElement({ element, definition }: { element: FormElement; definition: FormDefinition }) {
  const style = element.style;
  return (
    <div style={{
      color: style?.textColor, textAlign: style?.textAlign, backgroundColor: style?.backgroundColor, borderRadius: style?.borderRadius, padding: style?.padding,
      marginTop: style?.marginTop, marginBottom: style?.marginBottom,
      width: style?.width && WIDTH_PCT[style.width] && element.type !== 'button' ? WIDTH_PCT[style.width] : undefined,
    }}>
      {renderElementContent(element, definition, true, {}, undefined)}
    </div>
  );
}

/** The card the form sits on, per the Design settings. */
export function surfaceOf(theme: FormTheme): React.CSSProperties {
  const card = theme.layoutPreset === 'card';
  return {
    backgroundColor: theme.colors.surfaceBackground,
    borderRadius: card ? RADIUS[theme.layout.containerRadius] : undefined,
    boxShadow: card ? SHADOW[theme.layout.containerShadow] : undefined,
    fontFamily: theme.typography.primaryFont,
  };
}
export const formWidthOf = (theme: FormTheme) => WIDTH[theme.layout.formWidth] || theme.maxFormWidth || '640px';

function RenderElement({ element, definition, builderMode, selected, onSelect, answers, onAnswerChange }: {
  element: FormElement; definition: FormDefinition; builderMode: boolean; selected: boolean; onSelect?: (id: string) => void; answers: Record<string, string>; onAnswerChange?: (fieldId: string, value: string) => void; viewport: Viewport;
}) {
  const style = element.style;
  const elementStyle: React.CSSProperties = {
    color: style?.textColor, fontSize: style?.fontSize, fontWeight: style?.fontWeight ? WEIGHT[style.fontWeight] : undefined,
    textAlign: style?.textAlign, marginTop: style?.marginTop, marginBottom: style?.marginBottom,
    width: style?.width && WIDTH_PCT[style.width] && element.type !== 'button' ? WIDTH_PCT[style.width] : undefined,
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
  const st = element.style;
  const own = { fontSize: st?.fontSize || undefined, fontWeight: st?.fontWeight ? WEIGHT[st.fontWeight] : undefined };

  switch (element.type) {
    case 'heading': {
      const level = c?.headingLevel ?? 'h2';
      const sizeMap: Record<string, string> = { h1: theme.typography.headingSize, h2: `${parseInt(theme.typography.headingSize) * 0.85}px`, h3: `${parseInt(theme.typography.headingSize) * 0.7}px`, h4: `${parseInt(theme.typography.headingSize) * 0.6}px` };
      const Tag = level as 'h1' | 'h2' | 'h3' | 'h4';
      return <Tag style={{ fontSize: own.fontSize || sizeMap[level], fontWeight: own.fontWeight ?? theme.typography.headingWeight, lineHeight: theme.typography.headingLineHeight, letterSpacing: theme.typography.headingLetterSpacing, color: st?.textColor || theme.colors.heading, fontFamily: theme.typography.headingFont, margin: 0 }}>{c?.text || 'Heading'}</Tag>;
    }
    case 'text': return <p style={{ fontSize: own.fontSize || theme.typography.bodySize, fontWeight: own.fontWeight ?? 500, color: st?.textColor || theme.colors.heading, fontFamily: theme.typography.bodyFont, margin: 0, whiteSpace: 'pre-wrap' }}>{c?.text || 'Text'}</p>;
    case 'paragraph': return <p style={{ fontSize: own.fontSize || theme.typography.bodySize, fontWeight: own.fontWeight, lineHeight: theme.typography.bodyLineHeight, color: st?.textColor || theme.colors.bodyText, fontFamily: theme.typography.bodyFont, margin: 0, whiteSpace: 'pre-wrap' }}>{c?.text || 'Paragraph text.'}</p>;
    case 'image': {
      if (!c?.imageUrl) return <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed py-10 text-sm" style={{ borderColor: theme.colors.border, color: theme.colors.mutedText, background: theme.colors.surfaceBackground }}><ImagePlus className="h-5 w-5" aria-hidden />{builderMode ? 'Add a picture in the panel on the right' : null}</div>;
      const img = <img src={c.imageUrl} alt={c.altText || ''} className="w-full" style={{ borderRadius: st?.borderRadius, objectFit: st?.objectFit || 'cover', aspectRatio: st?.aspectRatio, maxHeight: st?.height }} />;
      return c.linkUrl && !builderMode ? <a href={c.linkUrl} target="_blank" rel="noopener noreferrer">{img}</a> : img;
    }
    case 'logo': return c?.imageUrl
      ? <img src={c.imageUrl} alt={c.altText || theme.branding.companyName || 'Logo'} className="h-auto" style={{ maxWidth: `${theme.branding.logoWidth}px`, maxHeight: '64px', display: 'inline-block' }} />
      : <div className="inline-flex h-10 w-32 items-center justify-center rounded-lg text-xs" style={{ background: theme.colors.border, color: theme.colors.mutedText }}>Logo</div>;
    case 'divider': return <hr style={{ borderStyle: c?.dividerStyle || 'solid', borderColor: theme.colors.border, borderWidth: '0 0 1px 0', margin: 0 }} />;
    case 'spacer': return <div style={{ height: `${c?.spacerHeight ?? 24}px` }} />;
    case 'button': return <ButtonElement element={element} theme={theme} />;
    case 'section': case 'container': case 'columns': case 'card': return null;
    default:
      if (!f) return null;
      return <FieldRenderer element={element} definition={definition} builderMode={builderMode} value={answers[f.fieldId] ?? ''} onChange={val => onAnswerChange?.(f.fieldId, val)} />;
  }
}

/** A Button element: submit, next, back or open a link, while the form is being filled in. */
function ButtonElement({ element, theme }: { element: FormElement; theme: FormTheme }) {
  const actions = useContext(ActionsCtx);
  const c = element.content;
  const act = c?.buttonAction ?? 'submit';
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!actions) return;
    if (act === 'open_url') { if (c?.buttonUrl && /^https?:\/\//i.test(c.buttonUrl)) window.open(c.buttonUrl, '_blank', 'noopener'); return; }
    if (act === 'previous') { actions.previous?.(); return; }
    // Next on the last step, and Submit anywhere, both go through the checks first.
    if (act === 'next') { actions.next?.(); return; }
    actions.submit?.();
  };
  const full = element.style?.width === 'full';
  return (
    <div style={{ textAlign: element.style?.textAlign || theme.buttonStyle.align }}>
      <button type="button" style={getButtonStyle(theme, theme.buttonStyle, undefined, full ? '100%' : 'auto')} onClick={onClick}>{c?.buttonText || 'Button'}</button>
    </div>
  );
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
    transition: 'border-color 0.2s, box-shadow 0.2s',
    outline: 'none',
    ['--ph' as string]: fs.placeholderColor,
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
  const runtime = useContext(RuntimeCtx);
  const handleChange = (val: string) => {
    if (builderMode) return;
    onChange(val);
    // A single choice on a slide that moves on by itself.
    if (runtime?.onPicked && ['radio', 'yes_no', 'dropdown'].includes(element.type) && val) runtime.onPicked();
  };
  const disabled = builderMode;
  const required = runtime ? runtime.required.has(f.fieldId) : f.required;
  const error = runtime?.errors[f.fieldId];
  if (element.type === 'hidden' || element.type === 'source') return null;

  return (
    <div id={`field-${f.fieldId}`} data-invalid={error ? 'true' : undefined}>
      <label style={labelStyle}>{f.label}{required && <span style={{ color: theme.colors.error, marginLeft: '2px' }}>*</span>}</label>
      {f.description && <p style={helpStyle}>{f.description}</p>}
      <div style={error ? ({ ['--err' as string]: theme.colors.error } as React.CSSProperties) : undefined}
        className={cn('[&_input::placeholder]:text-[color:var(--ph)] [&_textarea::placeholder]:text-[color:var(--ph)]', error && '[&_input]:!border-[color:var(--err)] [&_select]:!border-[color:var(--err)] [&_textarea]:!border-[color:var(--err)]')}>
        {renderFieldInput(element, f, value, handleChange, inputStyle, theme, disabled, runtime?.formId)}
      </div>
      {error && <p role="alert" style={{ color: theme.colors.error, fontSize: theme.fieldStyle.errorSize, marginTop: `${theme.fieldStyle.errorSpacing}px`, fontFamily: theme.typography.bodyFont }}>{error}</p>}
    </div>
  );
}

const CURRENCY_SIGN = (cur: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (cur || 'usd').toUpperCase(), currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '$'; } catch { return '$'; }
};

function renderFieldInput(element: FormElement, f: NonNullable<FormElement['field']>, value: string, onChange: (v: string) => void, inputStyle: React.CSSProperties, theme: FormTheme, disabled: boolean, formId?: string): React.ReactNode {
  const type = element.type;
  if (type === 'payment') return <PaymentInput config={f.payment} value={value} onChange={onChange} theme={theme} inputStyle={inputStyle} disabled={disabled} />;
  const fs = theme.fieldStyle;
  const baseClass = "w-full transition-colors focus:outline-none";
  const focusBorder = {
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { e.target.style.borderColor = fs.focusBorder; e.target.style.boxShadow = `0 0 0 3px ${fs.focusBorder}22`; },
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { e.target.style.borderColor = fs.border; e.target.style.boxShadow = 'none'; },
  };
  const text = (inputType: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) =>
    <input type={inputType} className={baseClass} style={inputStyle} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder} disabled={disabled} {...focusBorder} {...extra} />;

  switch (type) {
    case 'text_field': case 'first_name': case 'last_name': case 'city': case 'state':
      return text('text', { autoComplete: ({ first_name: 'given-name', last_name: 'family-name', city: 'address-level2', state: 'address-level1' } as Record<string, string>)[type] });
    case 'full_name': return text('text', { autoComplete: 'name' });
    case 'company': return text('text', { autoComplete: 'organization' });
    case 'job_title': return text('text', { autoComplete: 'organization-title' });
    case 'postal_code': return text('text', { autoComplete: 'postal-code', inputMode: 'text' });
    case 'website': return text('url', { autoComplete: 'url', inputMode: 'url' });
    case 'email': return text('email', { autoComplete: 'email', inputMode: 'email' });
    case 'phone': return text('tel', { autoComplete: 'tel', inputMode: 'tel' });
    case 'number': return text('number', { inputMode: 'decimal' });
    case 'date': return text('date');
    case 'date_of_birth': return text('date', { autoComplete: 'bday', max: new Date().toISOString().slice(0, 10) });
    case 'time': return text('time');
    case 'monetary': {
      const sign = CURRENCY_SIGN(f.currency || 'usd');
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-0 top-0 flex h-full items-center" style={{ paddingLeft: `${fs.padding}px`, color: theme.colors.mutedText, fontSize: theme.typography.bodySize }}>{sign}</span>
          <input type="text" inputMode="decimal" className={baseClass} style={{ ...inputStyle, paddingLeft: `${fs.padding + sign.length * 9 + 6}px` }} value={value}
            onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={f.placeholder || '0.00'} disabled={disabled} {...focusBorder} />
        </div>
      );
    }
    case 'long_text': case 'address':
      return <textarea className={cn(baseClass, 'resize-y', type === 'address' ? 'min-h-[76px]' : 'min-h-[110px]')} style={{ ...inputStyle, height: 'auto', padding: `${Math.max(10, fs.padding - 2)}px ${fs.padding}px` }} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder} disabled={disabled} autoComplete={type === 'address' ? 'street-address' : undefined} {...focusBorder} />;
    case 'country':
      return (
        <select className={baseClass} style={{ ...inputStyle, color: value ? fs.textColor : fs.placeholderColor }} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} autoComplete="country-name" {...focusBorder}>
          <option value="">{f.placeholder || 'Choose a country'}</option>
          {countryNames().map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      );
    case 'radio': case 'yes_no': case 'checkbox': case 'multi_select': case 'dropdown':
      return <ChoiceInput type={type} field={f} value={value} onChange={onChange} theme={theme} inputStyle={inputStyle} disabled={disabled} focusBorder={focusBorder} />;
    case 'consent':
      return <label className="flex items-start gap-2.5 text-sm cursor-pointer"><input type="checkbox" checked={value === 'true'} onChange={e => onChange(e.target.checked ? 'true' : '')} disabled={disabled} className="w-4 h-4 mt-0.5 shrink-0" style={{ accentColor: theme.colors.primary }} /><span style={{ color: theme.colors.bodyText, fontFamily: theme.typography.bodyFont, lineHeight: 1.5 }}>{element.content?.text || 'I agree to be contacted regarding my submission.'}</span></label>;
    case 'rating': {
      const max = element.content?.maxRating ?? 5;
      const Icon = element.content?.ratingSymbol === 'heart' ? '♥' : element.content?.ratingSymbol === 'circle' ? '●' : '★';
      return <div className="flex items-center gap-1.5" role="radiogroup" aria-label={f.label}>{Array.from({ length: max }, (_, i) => <button key={i} type="button" role="radio" aria-checked={Number(value) === i + 1} aria-label={`${i + 1} of ${max}`} disabled={disabled} onClick={() => !disabled && onChange(String(i + 1))} className={cn('text-[28px] leading-none transition-transform', !disabled && 'hover:scale-110')} style={{ color: i < Number(value) ? '#F5A623' : '#D7DBE2', background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer' }}>{Icon}</button>)}</div>;
    }
    case 'scale': {
      const min = element.content?.scaleMin ?? 1;
      const max = element.content?.scaleMax ?? 10;
      const step = Math.max(element.content?.scaleStep ?? 1, 0.5);
      const numbers: number[] = [];
      for (let i = min; i <= max && numbers.length < 21; i += step) numbers.push(Math.round(i * 10) / 10);
      return <div><div className="flex flex-wrap gap-2" role="radiogroup" aria-label={f.label}>{numbers.map(n => { const on = value !== '' && Number(value) === n; return <button key={n} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => !disabled && onChange(String(n))} className="text-sm font-semibold transition-all" style={{ minWidth: '42px', height: '42px', padding: '0 8px', borderRadius: RADIUS[fs.borderRadius], border: `1px solid ${on ? theme.colors.primary : fs.border}`, backgroundColor: on ? theme.colors.primary : fs.background, color: on ? '#fff' : theme.colors.bodyText, cursor: disabled ? 'default' : 'pointer' }}>{n}</button>; })}</div><div className="flex items-center justify-between mt-2 text-xs" style={{ color: theme.colors.mutedText }}><span>{element.content?.scaleMinLabel}</span><span>{element.content?.scaleMaxLabel}</span></div></div>;
    }
    case 'file_upload': return <FileUploadInput field={f} value={value} onChange={onChange} theme={theme} formId={formId} disabled={disabled} />;
    case 'signature': return <SignatureInput value={value} onChange={onChange} theme={theme} disabled={disabled} />;
    case 'captcha': return <CaptchaInput fieldId={f.fieldId} value={value} onChange={onChange} theme={theme} inputStyle={inputStyle} disabled={disabled} />;
    default: return null;
  }
}

/** Radio, Yes/No, Checkbox, Multi-select and Dropdown, each with an optional "Other" answer. */
function ChoiceInput({ type, field: f, value, onChange, theme, inputStyle, disabled, focusBorder }: {
  type: string; field: NonNullable<FormElement['field']>; value: string; onChange: (v: string) => void; theme: FormTheme; inputStyle: React.CSSProperties; disabled: boolean;
  focusBorder: { onFocus: (e: React.FocusEvent<HTMLSelectElement | HTMLInputElement>) => void; onBlur: (e: React.FocusEvent<HTMLSelectElement | HTMLInputElement>) => void };
}) {
  const options = type === 'yes_no' ? (f.options?.length ? f.options : ['Yes', 'No']) : (f.options || []);
  const multi = type === 'checkbox' || type === 'multi_select';
  const other = !!f.allowOther && type !== 'yes_no';
  const picked = multi ? splitMulti(value) : (value ? [value] : []);
  const otherText = picked.find((p) => !options.includes(p)) ?? '';
  const [otherOn, setOtherOn] = useState(!!otherText);
  const known = picked.filter((p) => options.includes(p));
  const labelText = { color: theme.colors.bodyText, fontFamily: theme.typography.bodyFont, fontSize: theme.typography.bodySize };
  const accent = { accentColor: theme.colors.primary };
  const clean = (t: string) => t.replace(/,/g, ' ');

  const setMulti = (next: string[], txt = otherOn ? otherText : '') => onChange([...next, ...(txt ? [clean(txt)] : [])].join(','));
  const otherBox = (on: boolean) => on && (
    <input type="text" autoFocus={!otherText} placeholder="Type your answer" className="mt-2 w-full focus:outline-none" style={{ ...inputStyle, height: '40px' }} disabled={disabled}
      value={otherText} onChange={(e) => (multi ? setMulti(known, e.target.value) : onChange(clean(e.target.value)))} {...focusBorder} />
  );

  if (type === 'dropdown') {
    return (
      <>
        <select className="w-full transition-colors focus:outline-none" style={{ ...inputStyle, color: value || otherOn ? theme.fieldStyle.textColor : theme.fieldStyle.placeholderColor }} disabled={disabled}
          value={otherOn ? '__other__' : value} onChange={(e) => { if (e.target.value === '__other__') { setOtherOn(true); onChange(''); } else { setOtherOn(false); onChange(e.target.value); } }} {...focusBorder}>
          <option value="">{f.placeholder || 'Choose one'}</option>
          {options.map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
          {other && <option value="__other__">Other…</option>}
        </select>
        {otherBox(otherOn)}
      </>
    );
  }

  return (
    <div className="space-y-2.5">
      {options.map((opt, i) => {
        const on = multi ? known.includes(opt) : value === opt && !otherOn;
        return (
          <label key={i} className="flex items-center gap-2.5 cursor-pointer">
            <input type={multi ? 'checkbox' : 'radio'} name={f.fieldId} value={opt} checked={on} disabled={disabled} className="w-[18px] h-[18px] shrink-0" style={accent}
              onChange={(e) => { if (multi) setMulti(e.target.checked ? [...known, opt] : known.filter((k) => k !== opt)); else { setOtherOn(false); onChange(opt); } }} />
            <span style={labelText}>{opt}</span>
          </label>
        );
      })}
      {other && (
        <div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type={multi ? 'checkbox' : 'radio'} name={f.fieldId} checked={otherOn} disabled={disabled} className="w-[18px] h-[18px] shrink-0" style={accent}
              onChange={(e) => { const on = multi ? e.target.checked : true; setOtherOn(on); if (multi) setMulti(known, on ? otherText : ''); else onChange(otherText); }} />
            <span style={labelText}>Other</span>
          </label>
          {otherBox(otherOn)}
        </div>
      )}
    </div>
  );
}

/** Bot protection: a small sum people answer and most bots don't. */
function CaptchaInput({ fieldId, value, onChange, theme, inputStyle, disabled }: {
  fieldId: string; value: string; onChange: (v: string) => void; theme: FormTheme; inputStyle: React.CSSProperties; disabled: boolean;
}) {
  const [sum] = useState(() => { const a = 2 + Math.floor(Math.random() * 8); const b = 1 + Math.floor(Math.random() * 9); return { a, b }; });
  const [typed, setTyped] = useState(value === CAPTCHA_OK ? String(sum.a + sum.b) : '');
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold tabular-nums" style={{ background: `${theme.colors.primary}10`, color: theme.colors.heading, fontFamily: theme.typography.bodyFont }} aria-hidden>{sum.a} + {sum.b} =</span>
      <input id={`captcha-${fieldId}`} type="text" inputMode="numeric" aria-label={`What is ${sum.a} plus ${sum.b}?`} className="w-24 focus:outline-none" style={inputStyle} value={typed} disabled={disabled} autoComplete="off"
        onChange={(e) => { const t = e.target.value.replace(/\D/g, '').slice(0, 3); setTyped(t); onChange(!t ? '' : Number(t) === sum.a + sum.b ? CAPTCHA_OK : CAPTCHA_WRONG); }} />
      {value === CAPTCHA_OK && <span className="text-sm font-semibold" style={{ color: theme.colors.success }}>✓</span>}
    </div>
  );
}

// ============================================================
// PAYMENT — a set price, products to pick, or an amount they type
// ============================================================

function PaymentInput({ config, value, onChange, theme, inputStyle, disabled }: {
  config: PaymentConfig | undefined; value: string; onChange: (v: string) => void; theme: FormTheme; inputStyle: React.CSSProperties; disabled: boolean;
}) {
  if (!config) return null;
  const cur = config.currency || 'usd';
  const due = paymentFor(config, value);
  const box: React.CSSProperties = { border: `1px solid ${theme.colors.border}`, borderRadius: RADIUS[theme.fieldStyle.borderRadius], padding: '12px 14px', background: theme.colors.surfaceBackground, fontFamily: theme.typography.bodyFont };
  const text = { color: theme.colors.bodyText, fontSize: theme.typography.bodySize };
  const muted = { color: theme.colors.mutedText, fontSize: '13px' };
  const total = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${theme.colors.border}`, ...text }}>
      <span style={{ fontWeight: 600 }}>Total</span><span style={{ fontWeight: 700 }}>{money(due?.amount ?? 0, cur)}</span>
    </div>
  );

  if (config.mode === 'fixed') {
    return (
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', ...text }}>
          <span>{config.description || 'Amount due'}</span><span style={{ fontWeight: 700 }}>{money(Math.round((config.amount ?? 0) * 100), cur)}</span>
        </div>
        <p style={{ ...muted, marginTop: '6px' }}>You’ll pay securely by card after you submit.</p>
      </div>
    );
  }

  if (config.mode === 'custom') {
    const typed = value.replace(/[^0-9.]/g, '');
    return (
      <div style={box}>
        {config.description && <p style={{ ...text, marginBottom: '8px' }}>{config.description}</p>}
        {!!config.suggested?.length && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
            {config.suggested.map((n) => {
              const on = Number(typed) === n;
              return <button key={n} type="button" disabled={disabled} onClick={() => onChange(String(n))}
                style={{ padding: '8px 14px', borderRadius: '999px', border: `1px solid ${on ? theme.colors.primary : theme.colors.border}`, background: on ? theme.colors.primary : 'transparent', color: on ? '#fff' : theme.colors.bodyText, fontWeight: 600, cursor: 'pointer' }}>{money(n * 100, cur)}</button>;
            })}
          </div>
        )}
        <input type="text" inputMode="decimal" aria-label="Amount" placeholder={config.minAmount ? `${money(config.minAmount * 100, cur)} or more` : 'Amount'} value={typed} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
        <p style={{ ...muted, marginTop: '6px' }}>You’ll pay securely by card after you submit.</p>
      </div>
    );
  }

  // Products
  const chosen = new Map(value.split(',').filter(Boolean).map((p) => { const [id, q] = p.split(':'); return [id, Math.max(1, Number(q) || 1)] as const; }));
  const set = (next: Map<string, number>) => onChange([...next].map(([id, q]) => `${id}:${q}`).join(','));
  return (
    <div style={box}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {(config.products ?? []).map((p) => {
          const on = chosen.has(p.id);
          const toggle = () => {
            const next = new Map(config.multiple ? chosen : []);
            if (on) next.delete(p.id); else next.set(p.id, 1);
            set(next);
          };
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '10px', border: `1px solid ${on ? theme.colors.primary : theme.colors.border}` }}>
              <input type={config.multiple ? 'checkbox' : 'radio'} checked={on} disabled={disabled} onChange={toggle} aria-label={p.name} style={{ accentColor: theme.colors.primary, width: '16px', height: '16px' }} />
              <span style={{ flex: 1, ...text }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                {p.description && <span style={{ display: 'block', ...muted }}>{p.description}</span>}
              </span>
              {config.quantity && on && (
                <input type="number" min={1} max={99} aria-label={`How many ${p.name}`} value={chosen.get(p.id)} disabled={disabled}
                  onChange={(e) => { const next = new Map(chosen); next.set(p.id, Math.max(1, Math.min(99, Number(e.target.value) || 1))); set(next); }}
                  style={{ ...inputStyle, width: '64px', height: '34px', padding: '0 8px' }} />
              )}
              <span style={{ fontWeight: 700, ...text }}>{money(Math.round(p.price * 100), cur)}</span>
            </div>
          );
        })}
      </div>
      {total}
    </div>
  );
}
