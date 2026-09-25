// ============================================================
// VISUAL FORM BUILDER — DATA MODEL
// Separates Content, Layout, Style, Behaviour, and Data Field Definition
// ============================================================

export type ElementType =
  | 'heading' | 'text' | 'paragraph' | 'image' | 'logo' | 'divider' | 'spacer' | 'button'
  | 'section' | 'container' | 'columns' | 'card'
  | 'first_name' | 'last_name' | 'text_field' | 'long_text' | 'phone' | 'email'
  | 'number' | 'date' | 'time' | 'website' | 'address'
  | 'radio' | 'checkbox' | 'dropdown' | 'multi_select' | 'yes_no'
  | 'rating' | 'scale' | 'file_upload' | 'signature' | 'consent' | 'hidden';

export type ElementCategory = 'content' | 'layout' | 'fields' | 'choice' | 'advanced';
export type ColumnCount = 1 | 2 | 3;
export type Viewport = 'desktop' | 'tablet' | 'mobile';
export type TextAlign = 'left' | 'center' | 'right';
export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4';

export interface ElementStyle {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold';
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: TextAlign;
  textColor?: string;
  padding?: string;
  marginTop?: string;
  marginBottom?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: 'cover' | 'contain' | 'auto';
  backgroundPosition?: string;
  overlayColor?: string;
  overlayOpacity?: number;
  borderColor?: string;
  borderWidth?: string;
  borderRadius?: string;
  boxShadow?: 'none' | 'sm' | 'md' | 'lg';
  width?: 'full' | 'half' | 'third' | 'auto';
  height?: string;
  aspectRatio?: string;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none';
}

export interface ElementContent {
  text?: string;
  headingLevel?: HeadingLevel;
  imageUrl?: string;
  altText?: string;
  linkUrl?: string;
  buttonText?: string;
  buttonAction?: 'submit' | 'next' | 'previous' | 'open_url' | 'navigate_page';
  buttonUrl?: string;
  buttonTargetPageId?: string;
  dividerStyle?: 'solid' | 'dashed' | 'dotted';
  spacerHeight?: number;
  maxRating?: number;
  ratingSymbol?: 'star' | 'heart' | 'circle';
  scaleMin?: number;
  scaleMax?: number;
  scaleStep?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
}

export interface FieldDefinition {
  fieldId: string;
  label: string;
  description?: string;
  placeholder?: string;
  required: boolean;
  defaultValue?: string;
  options?: string[];
  allowOther?: boolean;
  defaultOption?: string;
  mappedContactField?: 'first_name' | 'last_name' | 'email' | 'phone' | 'company' | 'job_title' | null;
  validation?: FieldValidation;
  visible?: boolean;
  allowedFileTypes?: string[];
  maxFileSizeMB?: number;
}

export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  pattern?: string;
  patternMessage?: string;
}

export interface FormElement {
  id: string;
  type: ElementType;
  category: ElementCategory;
  displayLabel: string;
  sortOrder: number;
  column?: number;
  style?: ElementStyle;
  content?: ElementContent;
  field?: FieldDefinition;
}

export interface FormSection {
  id: string;
  name: string;
  visible: boolean;
  columnCount: ColumnCount;
  style?: ElementStyle;
  elementIds: string[];
}

export interface FormPage {
  id: string;
  name: string;
  sectionIds: string[];
  visible: boolean;
}

export interface FormHeader {
  enabled: boolean;
  showLogo: boolean;
  logoUrl?: string;
  showTitle: boolean;
  showDescription: boolean;
  showProgress: boolean;
}

export interface FormFooter {
  enabled: boolean;
  content: string;
}

export type FormLayoutPreset = 'plain' | 'card' | 'split' | 'centered' | 'full_width';
export type ButtonStyle = 'filled' | 'outline' | 'text';
export type ContentAlign = 'left' | 'center' | 'right';
export type FormWidthPreset = 'compact' | 'standard' | 'wide' | 'full';
export type ShadowPreset = 'none' | 'subtle' | 'medium' | 'strong';
export type RadiusPreset = 'none' | 'small' | 'medium' | 'large' | 'pill';

export interface ThemeColors {
  pageBackground: string;
  surfaceBackground: string;
  primary: string;
  secondary: string;
  heading: string;
  bodyText: string;
  mutedText: string;
  border: string;
  inputBackground: string;
  inputText: string;
  buttonBg: string;
  buttonText: string;
  error: string;
  success: string;
  focusRing: string;
}

export interface ThemeTypography {
  primaryFont: string;
  headingFont: string;
  bodyFont: string;
  headingSize: string;
  headingWeight: string;
  headingLineHeight: string;
  headingLetterSpacing: string;
  bodySize: string;
  bodyWeight: string;
  bodyLineHeight: string;
  labelSize: string;
  labelWeight: string;
  buttonSize: string;
  buttonWeight: string;
}

export interface ThemeLayout {
  formWidth: FormWidthPreset;
  contentAlign: ContentAlign;
  sectionSpacing: number;
  fieldSpacing: number;
  pagePadding: number;
  columnGap: number;
  containerRadius: RadiusPreset;
  containerShadow: ShadowPreset;
}

export interface ThemeFieldStyle {
  background: string;
  textColor: string;
  border: string;
  borderWidth: number;
  borderRadius: RadiusPreset;
  focusBorder: string;
  placeholderColor: string;
  height: number;
  padding: number;
  labelColor: string;
  labelSize: string;
  labelWeight: string;
  labelSpacing: number;
  errorColor: string;
  errorSize: string;
  errorSpacing: number;
  helpTextColor: string;
  helpTextSize: string;
}

export interface ThemeButtonStyle {
  background: string;
  textColor: string;
  border: string;
  borderRadius: RadiusPreset;
  height: number;
  width: 'auto' | 'full';
  padding: number;
  font: string;
  weight: string;
  align: ContentAlign;
  style: ButtonStyle;
}

export interface ThemeBackground {
  type: 'solid' | 'gradient' | 'image';
  color: string;
  gradientFrom: string;
  gradientTo: string;
  gradientAngle: number;
  imageUrl: string;
  imagePosition: string;
  imageSize: 'cover' | 'contain' | 'auto';
  overlayColor: string;
  overlayOpacity: number;
}

export interface ThemeSplitLayout {
  enabled: boolean;
  leftWidth: number;
  rightWidth: number;
  columnGap: number;
  backgroundImage: string;
  backgroundOverlay: string;
  overlayOpacity: number;
  contentAlign: ContentAlign;
}

export interface ThemeBranding {
  logoUrl: string;
  logoWidth: number;
  companyName: string;
  footerText: string;
  privacyLink: string;
  termsLink: string;
}

export interface ThemeProgress {
  show: boolean;
  style: 'bar' | 'steps' | 'percentage';
  color: string;
  height: number;
  spacing: number;
  showLabels: boolean;
}

export interface FormTheme {
  // Original flat properties (kept for backward compat)
  primaryColor: string;
  backgroundColor: string;
  fontFamily: string;
  borderRadius: string;
  buttonColor: string;
  buttonTextColor: string;
  inputBorderColor: string;
  inputBorderRadius: string;
  maxFormWidth: string;

  // Extended design studio properties
  layoutPreset: FormLayoutPreset;
  colors: ThemeColors;
  typography: ThemeTypography;
  layout: ThemeLayout;
  fieldStyle: ThemeFieldStyle;
  buttonStyle: ThemeButtonStyle;
  background: ThemeBackground;
  split: ThemeSplitLayout;
  branding: ThemeBranding;
  progress: ThemeProgress;
}

export interface FormLogicRule {
  id: string;
  targetElementId: string;
  action: 'show' | 'hide' | 'require' | 'navigate' | 'set_value';
  triggerFieldId: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'is_empty' | 'is_not_empty';
  triggerValue: string;
  targetPageId?: string;
}

export interface FormSettings {
  createContact: boolean;
  updateContact: boolean;
  autoTags: string[];
  successMessage: string;
  redirectUrl: string | null;
  showProgressBar: boolean;
  allowBackNavigation: boolean;
}

// ============================================================
// NOTIFICATION & POST-SUBMISSION CONFIG
// ============================================================

export type PostSubmissionType = 'thank_you' | 'redirect' | 'custom_message';

export interface InternalNotification {
  enabled: boolean;
  recipients: string[];
  channel: 'email' | 'in_app' | 'both';
  subject: string;
  message: string;
  includeFields: string[];
  includeAllFields: boolean;
}

export interface RespondentNotification {
  enabled: boolean;
  emailFieldId: string | null;
  subject: string;
  senderName: string;
  replyTo: string;
  message: string;
  includeAnswers: 'none' | 'selected' | 'all';
  includedFields: string[];
}

export interface ThankYouPage {
  heading: string;
  message: string;
  imageUrl: string | null;
  buttonText: string | null;
  buttonLink: string | null;
}

export interface PostSubmissionConfig {
  type: PostSubmissionType;
  thankYouPage: ThankYouPage;
  redirectUrl: string | null;
  customMessage: string;
}

export interface FormNotifications {
  internal: InternalNotification;
  respondent: RespondentNotification;
  postSubmission: PostSubmissionConfig;
}

export interface FormDefinition {
  version: number;
  pages: FormPage[];
  sections: Record<string, FormSection>;
  elements: Record<string, FormElement>;
  header: FormHeader;
  footer: FormFooter;
  theme: FormTheme;
  logic: FormLogicRule[];
  settings: FormSettings;
  notifications: FormNotifications;
}

// ============================================================
// ELEMENT LIBRARY METADATA
// ============================================================

export interface ElementLibraryItem {
  type: ElementType;
  category: ElementCategory;
  label: string;
  icon: string;
  isContainer?: boolean;
  isField?: boolean;
}

export const ELEMENT_LIBRARY: ElementLibraryItem[] = [
  { type: 'heading', category: 'content', label: 'Heading', icon: 'Heading' },
  { type: 'text', category: 'content', label: 'Text', icon: 'Type' },
  { type: 'paragraph', category: 'content', label: 'Paragraph', icon: 'AlignLeft' },
  { type: 'image', category: 'content', label: 'Image', icon: 'Image' },
  { type: 'logo', category: 'content', label: 'Logo', icon: 'ImagePlus' },
  { type: 'divider', category: 'content', label: 'Divider', icon: 'Minus' },
  { type: 'spacer', category: 'content', label: 'Spacer', icon: 'MoveVertical' },
  { type: 'button', category: 'content', label: 'Button', icon: 'MousePointerClick' },
  { type: 'section', category: 'layout', label: 'Section', icon: 'SquareStack', isContainer: true },
  { type: 'container', category: 'layout', label: 'Container', icon: 'Box', isContainer: true },
  { type: 'columns', category: 'layout', label: 'Columns', icon: 'Columns3', isContainer: true },
  { type: 'card', category: 'layout', label: 'Card', icon: 'LayoutPanelTop', isContainer: true },
  { type: 'first_name', category: 'fields', label: 'First Name', icon: 'User', isField: true },
  { type: 'last_name', category: 'fields', label: 'Last Name', icon: 'User', isField: true },
  { type: 'text_field', category: 'fields', label: 'Single Line Text', icon: 'Type', isField: true },
  { type: 'long_text', category: 'fields', label: 'Multi-Line Text', icon: 'AlignLeft', isField: true },
  { type: 'phone', category: 'fields', label: 'Phone', icon: 'Phone', isField: true },
  { type: 'email', category: 'fields', label: 'Email', icon: 'Mail', isField: true },
  { type: 'number', category: 'fields', label: 'Number', icon: 'Hash', isField: true },
  { type: 'date', category: 'fields', label: 'Date', icon: 'Calendar', isField: true },
  { type: 'time', category: 'fields', label: 'Time', icon: 'Clock', isField: true },
  { type: 'website', category: 'fields', label: 'Website', icon: 'Globe', isField: true },
  { type: 'address', category: 'fields', label: 'Address', icon: 'MapPin', isField: true },
  { type: 'radio', category: 'choice', label: 'Radio', icon: 'CircleDot', isField: true },
  { type: 'checkbox', category: 'choice', label: 'Checkbox', icon: 'CheckSquare', isField: true },
  { type: 'dropdown', category: 'choice', label: 'Dropdown', icon: 'ChevronDown', isField: true },
  { type: 'multi_select', category: 'choice', label: 'Multi-select', icon: 'ListChecks', isField: true },
  { type: 'yes_no', category: 'choice', label: 'Yes / No', icon: 'ToggleLeft', isField: true },
  { type: 'rating', category: 'advanced', label: 'Rating', icon: 'Star', isField: true },
  { type: 'scale', category: 'advanced', label: 'Scale', icon: 'SlidersHorizontal', isField: true },
  { type: 'file_upload', category: 'advanced', label: 'File Upload', icon: 'Upload', isField: true },
  { type: 'signature', category: 'advanced', label: 'Signature', icon: 'PenTool', isField: true },
  { type: 'consent', category: 'advanced', label: 'Consent', icon: 'ShieldCheck', isField: true },
  { type: 'hidden', category: 'advanced', label: 'Hidden Field', icon: 'EyeOff', isField: true },
];

export const ELEMENT_GROUPS: { label: string; category: ElementCategory }[] = [
  { label: 'Content', category: 'content' },
  { label: 'Layout', category: 'layout' },
  { label: 'Form Fields', category: 'fields' },
  { label: 'Choice', category: 'choice' },
  { label: 'Advanced', category: 'advanced' },
];

export const DEFAULT_THEME: FormTheme = {
  primaryColor: '#0a1628',
  backgroundColor: '#ffffff',
  fontFamily: 'Inter, system-ui, sans-serif',
  borderRadius: '12px',
  buttonColor: '#0a1628',
  buttonTextColor: '#ffffff',
  inputBorderColor: '#e2e8f0',
  inputBorderRadius: '8px',
  maxFormWidth: '640px',

  layoutPreset: 'plain',
  colors: {
    pageBackground: '#ffffff',
    surfaceBackground: '#ffffff',
    primary: '#0a1628',
    secondary: '#c8a96a',
    heading: '#0a1628',
    bodyText: '#334155',
    mutedText: '#94a3b8',
    border: '#e2e8f0',
    inputBackground: '#ffffff',
    inputText: '#0f172a',
    buttonBg: '#0a1628',
    buttonText: '#ffffff',
    error: '#ef4444',
    success: '#22c55e',
    focusRing: '#c8a96a',
  },
  typography: {
    primaryFont: 'Inter, system-ui, sans-serif',
    headingFont: 'Inter, system-ui, sans-serif',
    bodyFont: 'Inter, system-ui, sans-serif',
    headingSize: '24px',
    headingWeight: '700',
    headingLineHeight: '1.2',
    headingLetterSpacing: '-0.02em',
    bodySize: '14px',
    bodyWeight: '400',
    bodyLineHeight: '1.5',
    labelSize: '14px',
    labelWeight: '500',
    buttonSize: '14px',
    buttonWeight: '600',
  },
  layout: {
    formWidth: 'standard',
    contentAlign: 'left',
    sectionSpacing: 24,
    fieldSpacing: 16,
    pagePadding: 32,
    columnGap: 16,
    containerRadius: 'medium',
    containerShadow: 'subtle',
  },
  fieldStyle: {
    background: '#ffffff',
    textColor: '#0f172a',
    border: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 'medium',
    focusBorder: '#c8a96a',
    placeholderColor: '#94a3b8',
    height: 42,
    padding: 12,
    labelColor: '#334155',
    labelSize: '14px',
    labelWeight: '500',
    labelSpacing: 6,
    errorColor: '#ef4444',
    errorSize: '12px',
    errorSpacing: 4,
    helpTextColor: '#64748b',
    helpTextSize: '12px',
  },
  buttonStyle: {
    background: '#0a1628',
    textColor: '#ffffff',
    border: '#0a1628',
    borderRadius: 'medium',
    height: 44,
    width: 'auto',
    padding: 16,
    font: 'Inter, system-ui, sans-serif',
    weight: '600',
    align: 'left',
    style: 'filled',
  },
  background: {
    type: 'solid',
    color: '#ffffff',
    gradientFrom: '#0a1628',
    gradientTo: '#1e3a5f',
    gradientAngle: 135,
    imageUrl: '',
    imagePosition: 'center',
    imageSize: 'cover',
    overlayColor: '#000000',
    overlayOpacity: 0,
  },
  split: {
    enabled: false,
    leftWidth: 40,
    rightWidth: 60,
    columnGap: 0,
    backgroundImage: '',
    backgroundOverlay: '#000000',
    overlayOpacity: 40,
    contentAlign: 'left',
  },
  branding: {
    logoUrl: '',
    logoWidth: 120,
    companyName: '',
    footerText: '',
    privacyLink: '',
    termsLink: '',
  },
  progress: {
    show: false,
    style: 'bar',
    color: '#0a1628',
    height: 4,
    spacing: 16,
    showLabels: true,
  },
};

// ============================================================
// FONT LIBRARY — curated, safe fonts
// ============================================================

export const FONT_LIBRARY: { label: string; value: string; category: string }[] = [
  { label: 'Inter', value: 'Inter, system-ui, sans-serif', category: 'Sans Serif' },
  { label: 'System UI', value: 'system-ui, sans-serif', category: 'Sans Serif' },
  { label: 'Arial', value: 'Arial, sans-serif', category: 'Sans Serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif', category: 'Sans Serif' },
  { label: 'Georgia', value: 'Georgia, serif', category: 'Serif' },
  { label: 'Times New Roman', value: "'Times New Roman', serif", category: 'Serif' },
  { label: 'Garamond', value: "Garamond, 'Times New Roman', serif", category: 'Serif' },
  { label: 'Courier New', value: "'Courier New', monospace", category: 'Monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif', category: 'Sans Serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif', category: 'Sans Serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif", category: 'Sans Serif' },
];

// ============================================================
// RADIUS / SHADOW MAPS
// ============================================================

export const RADIUS_MAP: Record<RadiusPreset, string> = {
  none: '0px',
  small: '4px',
  medium: '8px',
  large: '16px',
  pill: '9999px',
};

export const SHADOW_MAP: Record<ShadowPreset, string> = {
  none: 'none',
  subtle: '0 1px 3px rgba(0,0,0,0.08)',
  medium: '0 4px 12px rgba(0,0,0,0.1)',
  strong: '0 8px 24px rgba(0,0,0,0.15)',
};

export const WIDTH_MAP: Record<FormWidthPreset, string> = {
  compact: '480px',
  standard: '640px',
  wide: '800px',
  full: '100%',
};

export function generateElementId(): string {
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
export function generateFieldId(): string {
  return `fld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
export function generateSectionId(): string {
  return `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
export function generatePageId(): string {
  return `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
