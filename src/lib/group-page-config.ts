// ============================================================
// GROUP CALENDAR PUBLIC PAGE CONFIG
// Reusable presentation system for group calendar booking pages.
// Separates presentation config from calendar data/availability.
// ============================================================

export type PageLayout =
  | 'split'          // two-panel: left branding, right form/booking (DEFAULT)
  | 'centered'
  | 'wide_editorial'
  | 'compact'
  | 'full_width'
  | 'card_grid';

export type CardStyle =
  | 'classic_cards'
  | 'editorial_list'
  | 'compact_list'
  | 'two_column'
  | 'three_column'
  | 'featured_plus_secondary'
  | 'split_info_options';

export type HeadingFont = 'Georgia' | 'Playfair Display' | 'Cormorant Garamond' | 'serif' | 'Inter' | 'system-ui';
export type BodyFont = 'Inter' | 'system-ui' | 'Georgia' | 'Arial' | 'Helvetica';
export type HeadingWeight = 400 | 500 | 600 | 700;
export type Alignment = 'left' | 'center';

export interface NavItem {
  id: string;
  label: string;
  icon: string | null;
  type: 'calendar' | 'section' | 'external' | 'booking_flow';
  target: string | null; // calendar_id when type === 'calendar'
  visible: boolean;
  sort_order: number;
}

// Per-child-calendar presentation content shown in the left panel
export interface ChildCalendarPresentation {
  calendarId: string;
  navLabel: string | null;     // overrides calendar name in nav
  navIcon: string | null;
  heading: string | null;       // left panel heading
  description: string | null;   // left panel description
  label: string | null;          // small label/number e.g. "01"
  image: string | null;         // optional image in left panel
  backgroundImage: string | null; // optional bg image for left panel
  leftPanelColor: string | null;  // optional override of left panel bg color
}

export interface GroupPageHeader {
  visible: boolean;
  alignment: Alignment;
  showLogo: boolean;
  title: string | null;
  description: string | null;
  introText: string | null;
  coverImage: string | null;
  coverHeight: 'none' | 'short' | 'medium' | 'tall';
  showAccentBar: boolean;
}

export interface GroupPageFooter {
  visible: boolean;
  text: string | null;
  showPoweredBy: boolean;
}

export interface GroupPageBranding {
  logoUrl: string | null;
  organizationName: string | null;
  primaryAccent: string;
  secondaryAccent: string;
  buttonColor: string;
  textColor: string;
  backgroundColor: string;     // page background
  backgroundImage: string | null;
  backgroundOverlay: number;    // 0-100 opacity
  backgroundPosition: 'center' | 'top' | 'bottom';
  leftPanelColor: string;      // left panel background color (split layout)
}

export interface GroupPageTypography {
  headingFont: HeadingFont;
  bodyFont: BodyFont;
  headingSize: 'small' | 'medium' | 'large' | 'xl';
  bodySize: 'small' | 'medium' | 'large';
  headingWeight: HeadingWeight;
  letterSpacing: 'tight' | 'normal' | 'wide';
  lineHeight: 'compact' | 'normal' | 'relaxed';
}

export interface GroupPageLayout {
  layout: PageLayout;
  cardStyle: CardStyle;
  maxContentWidth: 'narrow' | 'standard' | 'wide' | 'full';
  pageSpacing: 'compact' | 'normal' | 'spacious';
  showSearch: boolean;
  showCategoryFilter: boolean;
  leftPanelWidth: 'narrow' | 'standard' | 'wide';  // split layout only
  rightPanelWidth: 'narrow' | 'standard' | 'wide';
}

export interface GroupPageConfig {
  branding: GroupPageBranding;
  typography: GroupPageTypography;
  layout: GroupPageLayout;
  header: GroupPageHeader;
  footer: GroupPageFooter;
  navigation: NavItem[];
  childPresentations: ChildCalendarPresentation[];
}

export const DEFAULT_GROUP_PAGE_CONFIG: GroupPageConfig = {
  branding: {
    logoUrl: null,
    organizationName: null,
    primaryAccent: '#E4A93C',
    secondaryAccent: '#C9A961',
    buttonColor: '#E4A93C',
    textColor: '#1a1a1a',
    backgroundColor: '#09132b',
    backgroundImage: null,
    backgroundOverlay: 0,
    backgroundPosition: 'center',
    leftPanelColor: '#5C1A2B', // deep burgundy/wine default
  },
  typography: {
    headingFont: 'Playfair Display',
    bodyFont: 'Inter',
    headingSize: 'large',
    bodySize: 'medium',
    headingWeight: 700,
    letterSpacing: 'normal',
    lineHeight: 'normal',
  },
  layout: {
    layout: 'split',
    cardStyle: 'classic_cards',
    maxContentWidth: 'wide',
    pageSpacing: 'normal',
    showSearch: false,
    showCategoryFilter: false,
    leftPanelWidth: 'standard',
    rightPanelWidth: 'standard',
  },
  header: {
    visible: true,
    alignment: 'left',
    showLogo: true,
    title: null,
    description: null,
    introText: null,
    coverImage: null,
    coverHeight: 'medium',
    showAccentBar: true,
  },
  footer: {
    visible: true,
    text: null,
    showPoweredBy: true,
  },
  navigation: [],
  childPresentations: [],
};

export function mergeGroupPageConfig(partial: unknown): GroupPageConfig {
  if (!partial || typeof partial !== 'object') return { ...DEFAULT_GROUP_PAGE_CONFIG };
  const p = partial as Partial<GroupPageConfig>;
  return {
    branding: { ...DEFAULT_GROUP_PAGE_CONFIG.branding, ...(p.branding ?? {}) },
    typography: { ...DEFAULT_GROUP_PAGE_CONFIG.typography, ...(p.typography ?? {}) },
    layout: { ...DEFAULT_GROUP_PAGE_CONFIG.layout, ...(p.layout ?? {}) },
    header: { ...DEFAULT_GROUP_PAGE_CONFIG.header, ...(p.header ?? {}) },
    footer: { ...DEFAULT_GROUP_PAGE_CONFIG.footer, ...(p.footer ?? {}) },
    navigation: p.navigation ?? DEFAULT_GROUP_PAGE_CONFIG.navigation,
    childPresentations: p.childPresentations ?? DEFAULT_GROUP_PAGE_CONFIG.childPresentations,
  };
}

// ============================================================
// HELPERS
// ============================================================

export function headingSizePx(size: GroupPageTypography['headingSize']): string {
  switch (size) {
    case 'small': return 'text-2xl sm:text-3xl';
    case 'medium': return 'text-3xl sm:text-4xl';
    case 'large': return 'text-4xl sm:text-5xl';
    case 'xl': return 'text-5xl sm:text-6xl';
  }
}

export function bodySizePx(size: GroupPageTypography['bodySize']): string {
  switch (size) {
    case 'small': return 'text-sm';
    case 'medium': return 'text-base';
    case 'large': return 'text-lg';
  }
}

export function letterSpacingCss(ls: GroupPageTypography['letterSpacing']): string {
  switch (ls) {
    case 'tight': return '-0.02em';
    case 'normal': return '0';
    case 'wide': return '0.04em';
  }
}

export function lineHeightCss(lh: GroupPageTypography['lineHeight']): string {
  switch (lh) {
    case 'compact': return '1.3';
    case 'normal': return '1.5';
    case 'relaxed': return '1.7';
  }
}

export function maxContentWidthCss(w: GroupPageLayout['maxContentWidth']): string {
  switch (w) {
    case 'narrow': return 'max-w-2xl';
    case 'standard': return 'max-w-4xl';
    case 'wide': return 'max-w-6xl';
    case 'full': return 'max-w-full';
  }
}

export function pageSpacingPx(s: GroupPageLayout['pageSpacing']): string {
  switch (s) {
    case 'compact': return 'py-6 sm:py-8';
    case 'normal': return 'py-10 sm:py-14';
    case 'spacious': return 'py-16 sm:py-24';
  }
}

export function coverHeightPx(h: GroupPageHeader['coverHeight']): string {
  switch (h) {
    case 'none': return 'h-0';
    case 'short': return 'h-32 sm:h-40';
    case 'medium': return 'h-48 sm:h-64';
    case 'tall': return 'h-64 sm:h-96';
  }
}

export function leftPanelWidthCss(w: GroupPageLayout['leftPanelWidth']): string {
  switch (w) {
    case 'narrow': return 'lg:w-[320px]';
    case 'standard': return 'lg:w-[400px]';
    case 'wide': return 'lg:w-[480px]';
  }
}

export function fontStack(font: HeadingFont | BodyFont): string {
  switch (font) {
    case 'Georgia': return 'Georgia, "Times New Roman", serif';
    case 'Playfair Display': return '"Playfair Display", Georgia, serif';
    case 'Cormorant Garamond': return '"Cormorant Garamond", Georgia, serif';
    case 'serif': return 'Georgia, "Times New Roman", serif';
    case 'Inter': return 'Inter, system-ui, sans-serif';
    case 'system-ui': return 'system-ui, sans-serif';
    case 'Arial': return 'Arial, Helvetica, sans-serif';
    case 'Helvetica': return 'Helvetica, Arial, sans-serif';
  }
}

export function isLightColor(color: string): boolean {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return true;
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 160;
}

// Get presentation for a specific child calendar, or a default
export function getChildPresentation(config: GroupPageConfig, calendarId: string): ChildCalendarPresentation | null {
  return config.childPresentations.find(cp => cp.calendarId === calendarId) ?? null;
}
