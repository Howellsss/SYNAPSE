import type {
  FormDefinition, FormElement, FormSection, Viewport,
  FormTheme, ThemeButtonStyle, PaymentConfig,
} from '@/lib/form-builder-types';
import { RADIUS_MAP as RADIUS, WIDTH_MAP as WIDTH } from '@/lib/form-builder-types';
import { cn } from '@/lib/utils';
import { createContext, useContext, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, ImagePlus, Loader2 } from 'lucide-react';
import { countryNames } from '@/lib/countries';
import { DIAL, dialCountries, flagOf, joinPhone, splitPhone } from '@/lib/phone';
import { CAPTCHA_OK, CAPTCHA_WRONG, money, paymentFor, splitMulti } from '@/lib/form-engine';
import { FileUploadInput, SignatureInput } from './ResponseInputs';
import './form-look.css';
import { themeVars } from './formLook';

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
  /** Someone left a field: check it there and then. */
  onFieldBlur?: (fieldId: string) => void;
  /** After a try to go on with mistakes: listed at the top, each a link to its field. */
  summary?: { fieldId: string; label: string; message: string }[];
}
const RuntimeCtx = createContext<FormRuntime | null>(null);
/** What a Button element can do while the form is filled in. */
const ActionsCtx = createContext<{ submit?: () => void; next?: () => void; previous?: () => void; isLast: boolean } | null>(null);

/** "medium" / "semibold" as CSS weights. */
const WEIGHT: Record<string, number> = { normal: 400, medium: 500, semibold: 600, bold: 700 };
/** Element width inside its column. */
const WIDTH_PCT: Record<string, string> = { full: '100%', half: '50%', third: '33.333%' };
/** The card's corners and depth: the Design settings, drawn with more care than the raw values. */
const CARD_RADIUS: Record<string, string> = { none: '0px', small: '12px', medium: '20px', large: '28px', pill: '32px' };
const CARD_SHADOW: Record<string, string> = {
  none: '0 0 0 1px rgba(16,24,40,0.06)',
  subtle: '0 0 0 1px rgba(16,24,40,0.04), 0 2px 4px rgba(16,24,40,0.03), 0 24px 48px -16px rgba(16,24,40,0.14)',
  medium: '0 0 0 1px rgba(16,24,40,0.04), 0 4px 8px rgba(16,24,40,0.04), 0 32px 64px -20px rgba(16,24,40,0.22)',
  strong: '0 0 0 1px rgba(16,24,40,0.05), 0 8px 16px rgba(16,24,40,0.06), 0 48px 96px -24px rgba(16,24,40,0.32)',
};

/** Corners for tiles and inputs: the field setting, but a pill is too round for a tile. */
const tileRadius = (theme: FormTheme) => (theme.fieldStyle.borderRadius === 'pill' ? '16px' : RADIUS[theme.fieldStyle.borderRadius]);

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
  /** Fill the box it sits in (the builder's preview) instead of keeping to the form's width. */
  fill?: boolean;
  /** The form is the page (its public link and the builder preview): drawn on a raised card. */
  stage?: boolean;
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
  onSubmit, onNext, onPrevious, runtime, fill = false, stage = false,
}: FormRendererProps) {
  const theme = definition.theme;
  const page = definition.pages[currentPageIndex];
  if (!page) return null;

  const bgStyle = getBackgroundCSS(theme);
  const showOverlay = theme.background.type === 'image' && theme.background.imageUrl && theme.background.overlayOpacity > 0;
  const split = isSplitLayout(theme, viewport);
  const layoutPreset = theme.layoutPreset;
  const setWidth = WIDTH[theme.layout.formWidth] || theme.maxFormWidth || '640px';
  // On a page of its own the card is never a thin strip: at least 720px wide on bigger screens.
  const page_ = stage && !fill && !builderMode;
  const phone = viewport === 'mobile';
  const maxFormWidth = page_ && setWidth !== '100%' ? `max(720px, ${setWidth})` : setWidth;
  const pad = page_ ? (phone ? 20 : Math.max(theme.layout.pagePadding, 40)) : theme.layout.pagePadding;

  // As a page of its own, every layout but full width sits on a raised card; inside another page
  // (a booking page) only the Card layout does.
  const carded = stage ? layoutPreset !== 'full_width' : layoutPreset === 'card';
  const containerClass = cn(carded && stage && 'sf-card', layoutPreset === 'full_width' && 'w-full');

  // On a phone the form is the page: edge to edge, no floating card.
  const edge = page_ && phone;
  const surfaceStyle: React.CSSProperties = {
    backgroundColor: theme.colors.surfaceBackground,
    borderRadius: carded && !edge ? CARD_RADIUS[theme.layout.containerRadius] : undefined,
    boxShadow: carded && !edge ? CARD_SHADOW[theme.layout.containerShadow] : undefined,
    fontFamily: theme.typography.primaryFont,
  };

  const paddingStyle: React.CSSProperties = {
    padding: `${pad}px`,
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
        <FormHeader definition={definition} formName={formName} formDescription={formDescription} currentPage={currentPage} totalPages={totalPages} pad={pad} />
      )}

      <div style={paddingStyle}>
        {!builderMode && !!runtime?.summary?.length && <ErrorSummary items={runtime.summary} theme={theme} />}
        {page.sectionIds.map(sectionId => {
          const section = definition.sections[sectionId];
          if (!section || !section.visible) return null;
          return <RenderSection key={sectionId} section={section} definition={definition} builderMode={builderMode} selectedElementId={selectedElementId} onSelectElement={onSelectElement} answers={answers} onAnswerChange={onAnswerChange} viewport={viewport} />;
        })}

        {!builderMode && runtime && (
          <div className={cn('mt-9 flex flex-wrap items-center gap-3', edge && 'sf-nav-sticky')}
            style={{ justifyContent: runtime.canGoBack ? 'space-between' : navAlign, ...(edge ? { marginLeft: `-${pad}px`, marginRight: `-${pad}px`, paddingLeft: `${pad}px`, paddingRight: `${pad}px` } : {}) }}>
            {runtime.canGoBack && (
              <button type="button" onClick={onPrevious} disabled={runtime.busy} className="sf-btn" style={getButtonStyle(theme, theme.buttonStyle, 'outline')}>
                <ArrowLeft className="sf-arrow sf-arrow-back h-4 w-4" aria-hidden /> Back
              </button>
            )}
            <div className="flex items-center gap-4" style={{ flex: (theme.buttonStyle.width === 'full' || edge) && !runtime.canGoBack ? 1 : undefined, flexDirection: navAlign === 'flex-end' ? 'row-reverse' : undefined }}>
              <button type="button" onClick={runtime.isLast ? onSubmit : onNext} disabled={runtime.busy} aria-busy={runtime.busy || undefined}
                className="sf-btn sf-btn-primary"
                style={{ ...getButtonStyle(theme, theme.buttonStyle, undefined, theme.buttonStyle.width === 'full' || edge ? '100%' : 'auto'), opacity: runtime.busy ? 0.75 : 1 }}>
                {runtime.busy
                  ? <><Loader2 className="sf-spin h-4 w-4" aria-hidden /> Sending…</>
                  : <>{runtime.isLast ? runtime.submitLabel || 'Submit' : 'Next'} <ArrowRight className="sf-arrow h-4 w-4" aria-hidden /></>}
              </button>
              {viewport !== 'mobile' && theme.buttonStyle.width !== 'full' && !runtime.busy && (
                <span className="sf-hint" aria-hidden>or press <kbd>Enter ↵</kbd></span>
              )}
            </div>
          </div>
        )}

        {!builderMode && !runtime && totalPages > 1 && (
          <div className="flex items-center justify-between mt-8 pt-6 border-t" style={{ borderColor: theme.colors.border }}>
            <div>{currentPage > 0 && <button onClick={onPrevious} className="sf-btn" style={getButtonStyle(theme, theme.buttonStyle, 'outline')}>Back</button>}</div>
            <div>{currentPage < totalPages - 1 ? <button onClick={onNext} className="sf-btn sf-btn-primary" style={getButtonStyle(theme, theme.buttonStyle)}>Next</button> : <button onClick={onSubmit} className="sf-btn sf-btn-primary" style={getButtonStyle(theme, theme.buttonStyle)}>Submit</button>}</div>
          </div>
        )}

        {!builderMode && !runtime && totalPages === 1 && page.sectionIds.some(sid => { const sec = definition.sections[sid]; return sec?.elementIds.some(eid => definition.elements[eid]?.field); }) && (
          <div className="mt-8 pt-6 border-t" style={{ borderColor: theme.colors.border, textAlign: theme.buttonStyle.align }}>
            <button onClick={onSubmit} className="sf-btn sf-btn-primary" style={getButtonStyle(theme, theme.buttonStyle, undefined, theme.buttonStyle.width === 'full' ? '100%' : 'auto')}>Submit</button>
          </div>
        )}
      </div>

      {definition.footer.enabled && definition.footer.content && (
        <div style={{ padding: `${pad}px`, textAlign: 'center', fontSize: '12px', color: theme.colors.mutedText, borderTop: `1px solid ${theme.colors.border}` }}>
          {definition.footer.content}
        </div>
      )}
      {hasBrandFooter && (
        <div style={{ padding: `14px ${pad}px`, textAlign: 'center', fontSize: '12px', lineHeight: 1.6, color: theme.colors.mutedText, borderTop: `1px solid ${theme.colors.border}`, fontFamily: theme.typography.bodyFont }}>
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
      <div className="sf relative w-full" style={{ ...bgStyle, ...themeVars(theme), fontFamily: theme.typography.primaryFont }}>
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
          <div className="flex flex-col justify-center" style={{ width: rightWidth, minHeight: '100vh', ...surfaceStyle, borderRadius: undefined, boxShadow: undefined }}>
            {formBody}
          </div>
        </div>
      </div>
    );
  }

  // Standard layouts
  const wrapperStyle: React.CSSProperties = layoutPreset === 'full_width' || fill ? {} : { maxWidth: maxFormWidth, margin: '0 auto' };
  const centeredWrapper = layoutPreset === 'centered' ? { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' } : {};
  // Room around the card so it floats, and a soft glow of the form's colours behind it.
  // On its own page the page paints the colour (and the glow), so the card floats over it.
  const floating = stage && carded && !fill && !builderMode;
  const floatPad = floating && layoutPreset !== 'centered' ? { padding: edge ? '0' : viewport === 'tablet' ? '24px 0 48px' : '32px 0 56px' } : {};

  return (
    <div className="sf relative w-full transition-all duration-300" style={{ ...(stage && carded && theme.background.type === 'solid' ? {} : bgStyle), ...themeVars(theme), fontFamily: theme.typography.primaryFont, ...centeredWrapper, ...floatPad }}>
      {showOverlay && <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: theme.background.overlayColor, opacity: theme.background.overlayOpacity / 100 }} />}
      <div className="relative" style={{ ...wrapperStyle, width: layoutPreset === 'centered' ? '100%' : undefined }}>
        <div className={cn(edge ? 'sf-edge' : 'overflow-hidden', containerClass)} style={surfaceStyle}>
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
    height: `${Math.max(btn.height, 48)}px`,
    padding: `0 ${Math.max(btn.padding, 22)}px`,
    fontSize: theme.typography.buttonSize,
    fontWeight: theme.typography.buttonWeight,
    fontFamily: theme.typography.primaryFont,
    borderRadius: radius,
    width: widthOverride || (btn.width === 'full' ? '100%' : 'auto'),
    border: 'none',
    cursor: 'pointer',
    letterSpacing: '0.005em',
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
// MISTAKES, LISTED AT THE TOP
// ============================================================

/** After a try to go on: what needs fixing, each a link that takes you to the field. */
function ErrorSummary({ items, theme }: { items: { fieldId: string; label: string; message: string }[]; theme: FormTheme }) {
  const go = (fieldId: string) => {
    const box = document.getElementById(`field-${fieldId}`);
    box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    (box?.querySelector('input:not([type=hidden]), select, textarea, button') as HTMLElement | null)?.focus({ preventScroll: true });
  };
  return (
    <div role="alert" className="sf-summary" style={{ fontFamily: theme.typography.bodyFont, marginBottom: '28px' }}>
      <p className="sf-summary-title"><AlertCircle className="h-4 w-4 shrink-0" aria-hidden /> {items.length === 1 ? 'One thing needs your attention' : `${items.length} things need your attention`}</p>
      <ul>
        {items.map((it) => (
          <li key={it.fieldId}><button type="button" onClick={() => go(it.fieldId)}><span>{it.label}</span>: {it.message}</button></li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================
// HEADER
// ============================================================

export function FormHeader({ definition, formName, formDescription, currentPage, totalPages, pad: padIn }: {
  definition: FormDefinition; formName: string; formDescription?: string | null; currentPage: number; totalPages: number; pad?: number;
}) {
  const { header, theme } = definition;
  const pad = padIn ?? theme.layout.pagePadding;
  const centered = theme.layout.contentAlign === 'center';
  return (
    <div style={{ padding: `${pad + 8}px ${pad}px ${Math.round(pad * 0.25)}px`, textAlign: centered ? 'center' : undefined }}>
      {theme.branding.companyName && <div className="sf-eyebrow" style={{ marginBottom: '14px', fontFamily: theme.typography.bodyFont }}>{theme.branding.companyName}</div>}
      {((header.showLogo && header.logoUrl) || theme.branding.logoUrl) && (
        <div style={{ marginBottom: '16px', textAlign: theme.layout.contentAlign === 'center' ? 'center' : undefined }}>
          <img src={(header.showLogo && header.logoUrl) || theme.branding.logoUrl} alt={theme.branding.companyName || 'Logo'} style={{ height: 'auto', maxWidth: `${theme.branding.logoWidth}px`, maxHeight: '48px' }} />
        </div>
      )}
      {header.showTitle && (
        <h1 style={{ fontSize: `max(${theme.typography.headingSize}, 28px)`, fontWeight: theme.typography.headingWeight, lineHeight: theme.typography.headingLineHeight, letterSpacing: theme.typography.headingLetterSpacing, color: theme.colors.heading, fontFamily: theme.typography.headingFont, margin: 0 }}>{formName}</h1>
      )}
      {header.showDescription && formDescription && (
        <p style={{ marginTop: '10px', fontSize: `max(${theme.typography.bodySize}, 15px)`, color: theme.colors.bodyText, opacity: 0.82, lineHeight: 1.6, fontFamily: theme.typography.bodyFont, maxWidth: centered ? undefined : '58ch', marginLeft: centered ? 'auto' : undefined, marginRight: centered ? 'auto' : undefined }}>{formDescription}</p>
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
    <div style={{ marginTop: `${Math.max(theme.progress.spacing, 20)}px`, marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, letterSpacing: '0.02em', color: theme.colors.mutedText, marginBottom: '8px' }}>
        <span>Step {currentPage + 1} of {totalPages}</span>
        {theme.progress.showLabels && <span>{pct}%</span>}
      </div>
      <div className="sf-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progress">
        <span style={{ width: `${pct}%` }} />
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
    const col = viewport === 'mobile' ? 0 : Math.max(0, Math.min((el.column ?? 1) - 1, effectiveColumnCount - 1));
    columns[col].push(el);
  }
  // People filling it in never see an empty column: the fields take the full width.
  const shown = builderMode ? columns : columns.filter((c) => c.length > 0);
  const cols = Math.max(shown.length, 1);
  // One column: fields set to half (or a third) width sit side by side; on a phone, one per row.
  const flow = cols === 1 && !builderMode;
  const span = (el: FormElement) => (viewport === 'mobile' || el.type === 'button' ? 6 : el.style?.width === 'half' ? 3 : el.style?.width === 'third' ? 2 : 6);

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
        {section.title && !builderMode && (
          <div className="sf-section-head" style={{ marginBottom: `${Math.max(theme.layout.fieldSpacing, 16)}px` }}>
            <h2 style={{ margin: 0, fontFamily: theme.typography.headingFont, color: theme.colors.heading, fontSize: '18px', fontWeight: 700, letterSpacing: '-0.01em' }}>{section.title}</h2>
            {section.description && <p style={{ margin: '4px 0 0', fontFamily: theme.typography.bodyFont, color: theme.colors.mutedText, fontSize: '14px', lineHeight: 1.55 }}>{section.description}</p>}
          </div>
        )}
        {flow ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', columnGap: `${Math.max(theme.layout.columnGap, 16)}px`, rowGap: `${theme.layout.fieldSpacing}px` }}>
            {shown[0]?.map((el, i) => (
              <div key={el.id} style={{ gridColumn: `span ${span(el)}`, minWidth: 0 }}>
                <RenderElement index={i} element={el} definition={definition} builderMode={builderMode} selected={selectedElementId === el.id} onSelect={onSelectElement} answers={answers} onAnswerChange={onAnswerChange} viewport={viewport} inGrid />
              </div>
            ))}
          </div>
        ) : (
        <div className={cn(cols === 2 && 'grid grid-cols-1 sm:grid-cols-2', cols === 3 && 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3', cols === 1 && 'space-y-0')} style={{ gap: cols > 1 ? `${theme.layout.columnGap}px` : undefined }}>
          {shown.map((colElements, colIdx) => (
            <div key={colIdx} style={{ display: 'flex', flexDirection: 'column', gap: `${theme.layout.fieldSpacing}px` }}>
              {colElements.map((el, i) => <RenderElement key={el.id} index={i * cols + colIdx} element={el} definition={definition} builderMode={builderMode} selected={selectedElementId === el.id} onSelect={onSelectElement} answers={answers} onAnswerChange={onAnswerChange} viewport={viewport} />)}
              {colElements.length === 0 && builderMode && <div className="min-h-[60px] rounded-lg border-2 border-dashed flex items-center justify-center text-xs" style={{ borderColor: theme.colors.border, color: theme.colors.mutedText }}>Drop elements here</div>}
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ELEMENT RENDERER
// ============================================================

/** One element as the builder canvas shows it: exactly as on the form, but not fillable. */
export function BuilderElement({ element, definition, inGrid = false }: { element: FormElement; definition: FormDefinition; inGrid?: boolean }) {
  const style = element.style;
  return (
    <div style={{
      color: style?.textColor, textAlign: style?.textAlign, backgroundColor: style?.backgroundColor, borderRadius: style?.borderRadius, padding: style?.padding,
      marginTop: style?.marginTop, marginBottom: style?.marginBottom,
      width: !inGrid && style?.width && WIDTH_PCT[style.width] && element.type !== 'button' ? WIDTH_PCT[style.width] : undefined,
    }}>
      {renderElementContent(element, definition, true, {}, undefined)}
    </div>
  );
}

/** The card the form sits on, per the Design settings. */
export function surfaceOf(theme: FormTheme): React.CSSProperties {
  const card = theme.layoutPreset !== 'full_width';
  return {
    ...themeVars(theme),
    backgroundColor: theme.colors.surfaceBackground,
    borderRadius: card ? CARD_RADIUS[theme.layout.containerRadius] : undefined,
    boxShadow: card ? CARD_SHADOW[theme.layout.containerShadow] : undefined,
    fontFamily: theme.typography.primaryFont,
  };
}
export const formWidthOf = (theme: FormTheme) => WIDTH[theme.layout.formWidth] || theme.maxFormWidth || '640px';

function RenderElement({ element, index = 0, definition, builderMode, selected, onSelect, answers, onAnswerChange, inGrid = false }: {
  element: FormElement; index?: number; definition: FormDefinition; builderMode: boolean; selected: boolean; onSelect?: (id: string) => void; answers: Record<string, string>; onAnswerChange?: (fieldId: string, value: string) => void; viewport: Viewport;
  /** Placed in the section's grid, which already gives it its width. */
  inGrid?: boolean;
}) {
  const style = element.style;
  const elementStyle: React.CSSProperties = {
    color: style?.textColor, fontSize: style?.fontSize, fontWeight: style?.fontWeight ? WEIGHT[style.fontWeight] : undefined,
    textAlign: style?.textAlign, marginTop: style?.marginTop, marginBottom: style?.marginBottom,
    width: !inGrid && style?.width && WIDTH_PCT[style.width] && element.type !== 'button' ? WIDTH_PCT[style.width] : undefined,
    backgroundColor: style?.backgroundColor, borderRadius: style?.borderRadius, padding: style?.padding,
    ['--sf-i' as string]: index,
  };
  const handleClick = (e: React.MouseEvent) => { if (builderMode && onSelect) { e.stopPropagation(); onSelect(element.id); } };

  return (
    <div className={cn('relative transition-all', !builderMode && 'sf-item', builderMode && 'cursor-pointer', builderMode && selected && 'ring-2 ring-gold-400 ring-offset-2 rounded-lg', builderMode && !selected && 'hover:ring-1 hover:ring-gray-300 rounded-lg')} style={elementStyle} onClick={handleClick}>
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
      <button type="button" className="sf-btn sf-btn-primary" style={getButtonStyle(theme, theme.buttonStyle, undefined, full ? '100%' : 'auto')} onClick={onClick}>{c?.buttonText || 'Button'}</button>
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
    border: `${fs.borderWidth === 1 ? 1.5 : fs.borderWidth}px solid ${fs.border}`,
    borderRadius: radius,
    backgroundColor: fs.background,
    color: fs.textColor,
    height: `${Math.max(fs.height, 48)}px`,
    padding: `0 ${Math.max(fs.padding, 14)}px`,
    // 16px at least: smaller text makes iPhones zoom in when the field is tapped.
    fontSize: `max(${theme.typography.bodySize}, 16px)`,
    fontFamily: theme.typography.bodyFont,
  };
  const labelStyle: React.CSSProperties = {
    color: fs.labelColor,
    fontSize: fs.labelSize,
    fontWeight: Math.max(Number(fs.labelWeight) || 500, 600),
    fontFamily: theme.typography.bodyFont,
    marginBottom: `${Math.max(fs.labelSpacing, 8)}px`,
    letterSpacing: '-0.005em',
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
  if (element.type === 'hidden' || element.type === 'source' || element.type === 'payment') return null;

  // The label, its help line and any mistake are tied to the input, so screen readers read them out.
  const ids = fieldIds(f.fieldId);
  const describedBy = [f.description ? ids.help : '', error ? ids.error : ''].filter(Boolean).join(' ') || undefined;
  const a11y: A11y = { id: ids.input, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, 'aria-required': required || undefined };
  const labelled = LABELLED_INPUT.has(element.type);
  const LabelTag = labelled ? 'label' : 'span';

  return (
    <div id={`field-${f.fieldId}`} data-invalid={error ? 'true' : undefined} className={cn('sf-field', error && 'sf-invalid')}
      onBlur={runtime?.onFieldBlur ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) runtime.onFieldBlur!(f.fieldId); } : undefined}>
      <LabelTag id={ids.label} htmlFor={labelled ? ids.input : undefined} className="sf-label" style={labelStyle}>
        <span>{f.label}</span>
        {required
          ? <><span className="sf-req" aria-hidden>*</span><span className="sf-sr">(required)</span></>
          : <span className="sf-optional">(optional)</span>}
      </LabelTag>
      {f.description && <p id={ids.help} style={helpStyle}>{f.description}</p>}
      <div>
        {renderFieldInput(element, f, value, handleChange, inputStyle, theme, disabled, runtime?.formId, a11y)}
      </div>
      {error && (
        <p id={ids.error} role="alert" className="sf-error" style={{ color: theme.colors.error, fontSize: theme.fieldStyle.errorSize, fontWeight: 500, marginTop: `${Math.max(theme.fieldStyle.errorSpacing, 8)}px`, fontFamily: theme.typography.bodyFont }}>
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

/** The ids that tie a field's label, help and mistake to its input. */
const fieldIds = (fieldId: string) => ({ input: `sf-in-${fieldId}`, label: `sf-label-${fieldId}`, help: `sf-help-${fieldId}`, error: `sf-err-${fieldId}` });
type A11y = { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean };
/** Fields with one input the label can point at (the rest are groups, named by their label). */
const LABELLED_INPUT = new Set(['text_field', 'first_name', 'last_name', 'city', 'state', 'full_name', 'company', 'job_title', 'postal_code', 'website', 'email', 'phone',
  'number', 'date', 'date_of_birth', 'time', 'monetary', 'long_text', 'address', 'country', 'dropdown']);

const CURRENCY_SIGN = (cur: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (cur || 'usd').toUpperCase(), currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '$'; } catch { return '$'; }
};

function renderFieldInput(element: FormElement, f: NonNullable<FormElement['field']>, value: string, onChange: (v: string) => void, inputStyle: React.CSSProperties, theme: FormTheme, disabled: boolean, formId?: string, a11y?: A11y): React.ReactNode {
  const type = element.type;
  if (type === 'payment') return <PaymentInput config={f.payment} value={value} onChange={onChange} theme={theme} inputStyle={inputStyle} disabled={disabled} />;
  const fs = theme.fieldStyle;
  const baseClass = 'sf-input';
  const text = (inputType: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) =>
    <input type={inputType} className={baseClass} style={inputStyle} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder} disabled={disabled} {...a11y} {...extra} />;

  switch (type) {
    case 'text_field': case 'first_name': case 'last_name': case 'city': case 'state':
      return text('text', { autoComplete: ({ first_name: 'given-name', last_name: 'family-name', city: 'address-level2', state: 'address-level1' } as Record<string, string>)[type] });
    case 'full_name': return text('text', { autoComplete: 'name' });
    case 'company': return text('text', { autoComplete: 'organization' });
    case 'job_title': return text('text', { autoComplete: 'organization-title' });
    case 'postal_code': return text('text', { autoComplete: 'postal-code', inputMode: 'text' });
    case 'website': return text('url', { autoComplete: 'url', inputMode: 'url' });
    case 'email': return text('email', { autoComplete: 'email', inputMode: 'email' });
    case 'phone':
      return f.phoneCountry
        ? <PhoneInput country={f.phoneCountry} value={value} onChange={onChange} inputStyle={inputStyle} theme={theme} placeholder={f.placeholder} disabled={disabled} a11y={a11y} />
        : text('tel', { autoComplete: 'tel', inputMode: 'tel' });
    case 'number': return text('number', { inputMode: 'decimal' });
    case 'date': return text('date');
    case 'date_of_birth': return text('date', { autoComplete: 'bday', max: new Date().toISOString().slice(0, 10) });
    case 'time': return text('time');
    case 'monetary': {
      const sign = CURRENCY_SIGN(f.currency || 'usd');
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-0 top-0 z-[1] flex h-full items-center font-semibold" style={{ paddingLeft: `${Math.max(fs.padding, 14)}px`, color: theme.colors.mutedText, fontSize: `max(${theme.typography.bodySize}, 15px)` }}>{sign}</span>
          <input type="text" inputMode="decimal" {...a11y} className={baseClass} style={{ ...inputStyle, paddingLeft: `${Math.max(fs.padding, 14) + sign.length * 10 + 8}px` }} value={value}
            onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={f.placeholder || '0.00'} disabled={disabled} />
        </div>
      );
    }
    case 'long_text': case 'address':
      return <textarea {...a11y} className={cn(baseClass, 'resize-y', type === 'address' ? 'min-h-[88px]' : 'min-h-[128px]')} style={{ ...inputStyle, height: 'auto', padding: `12px ${Math.max(fs.padding, 14)}px` }} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder} disabled={disabled} autoComplete={type === 'address' ? 'street-address' : undefined} />;
    case 'country':
      return (
        <select {...a11y} className={baseClass} style={{ ...inputStyle, color: value ? fs.textColor : fs.placeholderColor }} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} autoComplete="country-name">
          <option value="">{f.placeholder || 'Choose a country'}</option>
          {countryNames().map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      );
    case 'radio': case 'yes_no': case 'checkbox': case 'multi_select': case 'dropdown':
      return <ChoiceInput type={type} field={f} value={value} onChange={onChange} theme={theme} inputStyle={inputStyle} disabled={disabled} a11y={a11y} />;
    case 'consent': {
      const on = value === 'true';
      return (
        <label className="sf-consent" data-on={on} style={{ borderRadius: tileRadius(theme) }}>
          <input type="checkbox" className="sf-sr" checked={on} onChange={e => onChange(e.target.checked ? 'true' : '')} disabled={disabled} aria-describedby={a11y?.['aria-describedby']} aria-invalid={a11y?.['aria-invalid']} aria-required={a11y?.['aria-required']} />
          <span className="sf-mark" style={{ borderRadius: '6px' }} aria-hidden><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
          <span style={{ color: theme.colors.bodyText, fontFamily: theme.typography.bodyFont, fontSize: `max(${theme.typography.bodySize}, 14px)`, lineHeight: 1.55 }}>
            {element.content?.text || 'I agree to be contacted regarding my submission.'}
            {element.content?.consentLinkUrl && /^https?:\/\//i.test(element.content.consentLinkUrl) && (
              <> <a href={element.content.consentLinkUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: theme.colors.primary, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: '3px' }}>{element.content.consentLinkText || 'Read the privacy notice'}</a></>
            )}
          </span>
        </label>
      );
    }
    case 'rating':
      return <RatingInput label={f.label} max={element.content?.maxRating ?? 5} symbol={element.content?.ratingSymbol} value={value} onChange={onChange} disabled={disabled} />;
    case 'scale': {
      const min = element.content?.scaleMin ?? 1;
      const max = element.content?.scaleMax ?? 10;
      const step = Math.max(element.content?.scaleStep ?? 1, 0.5);
      const numbers: number[] = [];
      for (let i = min; i <= max && numbers.length < 21; i += step) numbers.push(Math.round(i * 10) / 10);
      return (
        <div>
          <div className="sf-scale" role="radiogroup" aria-label={f.label}>
            {numbers.map(n => {
              const on = value !== '' && Number(value) === n;
              return <button key={n} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => !disabled && onChange(String(n))} style={{ borderRadius: tileRadius(theme), cursor: disabled ? 'default' : 'pointer', fontFamily: theme.typography.bodyFont }}>{n}</button>;
            })}
          </div>
          {(element.content?.scaleMinLabel || element.content?.scaleMaxLabel) && (
            <div className="mt-2.5 flex items-center justify-between text-xs font-medium" style={{ color: theme.colors.mutedText }}><span>{element.content?.scaleMinLabel}</span><span>{element.content?.scaleMaxLabel}</span></div>
          )}
        </div>
      );
    }
    case 'file_upload': return <FileUploadInput field={f} value={value} onChange={onChange} theme={theme} formId={formId} disabled={disabled} />;
    case 'signature': return <SignatureInput value={value} onChange={onChange} theme={theme} disabled={disabled} />;
    case 'captcha': return <CaptchaInput fieldId={f.fieldId} value={value} onChange={onChange} theme={theme} inputStyle={inputStyle} disabled={disabled} />;
    default: return null;
  }
}

/** A phone number with its country: the flag and code to pick, then the number. */
function PhoneInput({ country, value, onChange, inputStyle, theme, placeholder, disabled, a11y }: {
  country: string; value: string; onChange: (v: string) => void; inputStyle: React.CSSProperties; theme: FormTheme; placeholder?: string; disabled: boolean; a11y?: A11y;
}) {
  const parsed = splitPhone(value, country);
  const [iso, setIso] = useState(parsed.iso);
  const [typed, setTyped] = useState(parsed.number);
  const set = (nextIso: string, nextTyped: string) => { setIso(nextIso); setTyped(nextTyped); onChange(joinPhone(nextIso, nextTyped)); };
  return (
    <div className="sf-phone">
      <label className="sf-phone-code" style={{ ...inputStyle, width: 'auto', padding: 0 }}>
        <span className="sf-sr">Country code</span>
        <span aria-hidden className="sf-phone-show">{flagOf(iso)} +{DIAL[iso]}</span>
        <select value={iso} disabled={disabled} onChange={(e) => set(e.target.value, typed)} aria-describedby={a11y?.['aria-describedby']} style={{ fontFamily: theme.typography.bodyFont }}>
          {dialCountries().map((c) => <option key={c.iso} value={c.iso}>{c.name} (+{c.dial})</option>)}
        </select>
      </label>
      <input type="tel" className="sf-input" style={inputStyle} value={typed} onChange={(e) => set(iso, e.target.value)} placeholder={placeholder} disabled={disabled}
        autoComplete="tel-national" inputMode="tel" {...a11y} />
    </div>
  );
}

/** Radio, Yes/No, Checkbox, Multi-select and Dropdown, each with an optional "Other" answer. */
function ChoiceInput({ type: asked, field: f, value, onChange, theme, inputStyle, disabled, a11y }: {
  type: string; field: NonNullable<FormElement['field']>; value: string; onChange: (v: string) => void; theme: FormTheme; inputStyle: React.CSSProperties; disabled: boolean; a11y?: A11y;
}) {
  // A single choice of more than six options is easier as a list to pick from.
  const type = asked === 'radio' && (f.options?.length ?? 0) > 6 ? 'dropdown' : asked;
  const options = type === 'yes_no' ? (f.options?.length ? f.options : ['Yes', 'No']) : (f.options || []);
  const multi = type === 'checkbox' || type === 'multi_select';
  const other = !!f.allowOther && type !== 'yes_no';
  const picked = multi ? splitMulti(value) : (value ? [value] : []);
  const otherText = picked.find((p) => !options.includes(p)) ?? '';
  const [otherOn, setOtherOn] = useState(!!otherText);
  const known = picked.filter((p) => options.includes(p));
  const clean = (t: string) => t.replace(/,/g, ' ');

  const setMulti = (next: string[], txt = otherOn ? otherText : '') => onChange([...next, ...(txt ? [clean(txt)] : [])].join(','));
  const otherBox = (on: boolean) => on && (
    <input type="text" autoFocus={!otherText} placeholder="Type your answer" className="sf-input mt-2.5" style={inputStyle} disabled={disabled}
      value={otherText} onChange={(e) => (multi ? setMulti(known, e.target.value) : onChange(clean(e.target.value)))} />
  );

  if (type === 'dropdown') {
    return (
      <>
        <select {...a11y} aria-labelledby={fieldIds(f.fieldId).label} className="sf-input" style={{ ...inputStyle, color: value || otherOn ? theme.fieldStyle.textColor : theme.fieldStyle.placeholderColor }} disabled={disabled}
          value={otherOn ? '__other__' : value} onChange={(e) => { if (e.target.value === '__other__') { setOtherOn(true); onChange(''); } else { setOtherOn(false); onChange(e.target.value); } }}>
          <option value="">{f.placeholder || 'Choose one'}</option>
          {options.map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
          {other && <option value="__other__">Other…</option>}
        </select>
        {otherBox(otherOn)}
      </>
    );
  }

  const radius = tileRadius(theme);
  const text: React.CSSProperties = { fontFamily: theme.typography.bodyFont, fontSize: `max(${theme.typography.bodySize}, 15px)`, lineHeight: 1.4 };
  const toggle = (opt: string) => {
    if (disabled) return;
    if (multi) { setMulti(known.includes(opt) ? known.filter((k) => k !== opt) : [...known, opt]); return; }
    setOtherOn(false); onChange(opt);
  };
  const toggleOther = () => {
    if (disabled) return;
    const on = multi ? !otherOn : true;
    setOtherOn(on);
    if (multi) setMulti(known, on ? otherText : ''); else onChange(otherText);
  };
  // Press A, B, C… to pick, like the letter keys on each tile.
  const all = [...options, ...(other ? ['__other__'] : [])];
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLInputElement).type === 'text') return;
    const i = e.key.length === 1 ? e.key.toUpperCase().charCodeAt(0) - 65 : -1;
    if (i < 0 || i >= all.length || all.length > 26) return;
    e.preventDefault();
    if (all[i] === '__other__') toggleOther(); else toggle(all[i]);
  };
  const mark = <span className="sf-mark" style={{ borderRadius: multi ? '7px' : '50%' }} aria-hidden><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>;
  const tile = (key: string, label: string, on: boolean, onPick: () => void, i: number) => (
    <label key={key} className="sf-tile" data-on={on} aria-disabled={disabled || undefined} style={{ borderRadius: radius }}>
      <input type={multi ? 'checkbox' : 'radio'} name={f.fieldId} className="sf-sr" checked={on} disabled={disabled} onChange={onPick} />
      {type !== 'yes_no' && all.length <= 26 && <span className="sf-key" aria-hidden>{String.fromCharCode(65 + i)}</span>}
      <span style={text}>{label}</span>
      {mark}
    </label>
  );
  const twoUp = type !== 'yes_no' && options.length >= 4 && options.every((o) => o.length <= 28);

  return (
    <div role={multi ? 'group' : 'radiogroup'} aria-labelledby={fieldIds(f.fieldId).label} aria-describedby={a11y?.['aria-describedby']} aria-invalid={a11y?.['aria-invalid']} aria-required={a11y?.['aria-required']} onKeyDown={onKeyDown}>
      <div className={type === 'yes_no' ? 'sf-yesno' : cn('sf-tiles', twoUp && 'sf-tiles-2')}>
        {options.map((opt, i) => tile(String(i), opt, multi ? known.includes(opt) : value === opt && !otherOn, () => toggle(opt), i))}
        {other && tile('__other__', 'Other', otherOn, toggleOther, options.length)}
      </div>
      {otherBox(otherOn)}
    </div>
  );
}

/** Stars (or hearts, or dots) that light up as you move across them. */
function RatingInput({ label, max, symbol, value, onChange, disabled }: {
  label: string; max: number; symbol?: string; value: string; onChange: (v: string) => void; disabled: boolean;
}) {
  const [hover, setHover] = useState(0);
  const Icon = symbol === 'heart' ? '♥' : symbol === 'circle' ? '●' : '★';
  const shown = hover || Number(value) || 0;
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(0)}>
      {Array.from({ length: max }, (_, i) => (
        <button key={i} type="button" role="radio" aria-checked={Number(value) === i + 1} aria-label={`${i + 1} of ${max}`} disabled={disabled}
          data-lit={i < shown} className="sf-star text-[34px]"
          onMouseEnter={() => !disabled && setHover(i + 1)} onClick={() => !disabled && onChange(String(i + 1))}
          style={{ color: i < shown ? '#F5A623' : '#D7DBE2', cursor: disabled ? 'default' : 'pointer' }}>{Icon}</button>
      ))}
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
      <input id={`captcha-${fieldId}`} type="text" inputMode="numeric" aria-label={`What is ${sum.a} plus ${sum.b}?`} className="sf-input" style={{ ...inputStyle, width: '96px' }} value={typed} disabled={disabled} autoComplete="off"
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
        <input type="text" inputMode="decimal" aria-label="Amount" className="sf-input" placeholder={config.minAmount ? `${money(config.minAmount * 100, cur)} or more` : 'Amount'} value={typed} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
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
            <label key={p.id} className="sf-tile" data-on={on} style={{ borderRadius: tileRadius(theme) }}>
              <input type={config.multiple ? 'checkbox' : 'radio'} className="sf-sr" checked={on} disabled={disabled} onChange={toggle} aria-label={p.name} />
              <span className="sf-mark" style={{ borderRadius: config.multiple ? '7px' : '50%', marginLeft: 0 }} aria-hidden><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
              <span style={{ flex: 1, ...text }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                {p.description && <span style={{ display: 'block', ...muted }}>{p.description}</span>}
              </span>
              {config.quantity && on && (
                <input type="number" min={1} max={99} aria-label={`How many ${p.name}`} value={chosen.get(p.id)} disabled={disabled}
                  onChange={(e) => { const next = new Map(chosen); next.set(p.id, Math.max(1, Math.min(99, Number(e.target.value) || 1))); set(next); }}
                  className="sf-input" style={{ ...inputStyle, width: '64px', height: '36px', padding: '0 8px' }} />
              )}
              <span style={{ fontWeight: 700, ...text }}>{money(Math.round(p.price * 100), cur)}</span>
            </label>
          );
        })}
      </div>
      {total}
    </div>
  );
}
