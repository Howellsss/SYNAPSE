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
  | 'rating' | 'scale' | 'file_upload' | 'signature' | 'consent' | 'hidden' | 'payment'
  | 'full_name' | 'date_of_birth' | 'company' | 'job_title'
  | 'city' | 'state' | 'postal_code' | 'country'
  | 'monetary' | 'source' | 'captcha';

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

export type ContactFieldKey = 'first_name' | 'last_name' | 'full_name' | 'email' | 'phone' | 'company' | 'job_title' | 'date_of_birth';
export const CONTACT_FIELD_LABELS: Record<ContactFieldKey, string> = {
  first_name: 'First name', last_name: 'Last name', full_name: 'Full name (first and last)', email: 'Email', phone: 'Phone',
  company: 'Company', job_title: 'Job title', date_of_birth: 'Date of birth',
};

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
  /** The contact field the answer is saved to. A full name fills first and last name. */
  mappedContactField?: ContactFieldKey | null;
  /** Monetary: the currency shown beside the amount (ISO code, e.g. usd). */
  currency?: string;
  validation?: FieldValidation;
  visible?: boolean;
  allowedFileTypes?: string[];
  maxFileSizeMB?: number;
  /** File Upload: more than one file (the answer is one link per line). */
  allowMultipleFiles?: boolean;
  /** URL parameter that fills this field (?key=value). Defaults to the field id, its contact field or type. */
  queryKey?: string;
  /** Quiz: points for each option picked. */
  optionScores?: Record<string, number>;
  /** Quiz: the right answer(s); getting it right earns `points` (default 1). */
  correctOptions?: string[];
  points?: number;
  /** Quiz: which category this question counts towards. */
  quizCategory?: string;
  /** Payment element only. */
  payment?: PaymentConfig;
}

/** A payment taken with the submission (Stripe Checkout). Amounts are in major units (e.g. 25 = $25.00). */
export interface PaymentConfig {
  /** fixed: one set price · products: pick from a list · custom: they type the amount (donations). */
  mode: 'fixed' | 'products' | 'custom';
  currency: string;
  amount?: number;
  description?: string;
  products?: PaymentProduct[];
  /** products: allow more than one product. */
  multiple?: boolean;
  /** products: let them choose how many of each. */
  quantity?: boolean;
  /** custom: smallest amount accepted, and amounts to suggest as buttons. */
  minAmount?: number;
  suggested?: number[];
}
export interface PaymentProduct { id: string; name: string; price: number; description?: string }

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

export type LogicOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty' | 'greater_than' | 'less_than' | 'starts_with';
export interface LogicCondition { fieldId: string; operator: LogicOperator; value: string }

/**
 * When the conditions are met (all of them, or any one), do the action:
 * show / hide / require an element, set a field's value, jump to a page or slide ('navigate'),
 * disqualify (end the form with a message or a link), or send them to a link when they submit.
 * Older rules have a single trigger (triggerFieldId / operator / triggerValue).
 */
export interface FormLogicRule {
  id: string;
  targetElementId: string;
  action: 'show' | 'hide' | 'require' | 'navigate' | 'set_value' | 'disqualify' | 'redirect';
  triggerFieldId: string;
  operator: LogicOperator;
  triggerValue: string;
  targetPageId?: string;
  conditions?: LogicCondition[];
  match?: 'all' | 'any';
  /** set_value: the value; disqualify: the message shown. */
  value?: string;
  message?: string;
  /** redirect, and disqualify when it should send them somewhere. */
  redirectUrl?: string;
}

/** A quiz: questions score points; the total (or the top category) picks the result shown. */
export interface QuizSettings {
  enabled: boolean;
  showScore: 'percent' | 'points' | 'out_of_10' | 'none';
  scoring: 'total' | 'top_category';
  categories: string[];
  results: QuizResult[];
  /** After submitting, show which answers were right. */
  showAnswers?: boolean;
}
export interface QuizResult {
  id: string;
  heading: string;
  message: string;
  /** total: the score range (in %) this result covers. */
  minPercent?: number;
  maxPercent?: number;
  /** top_category: the category this result is for. */
  category?: string;
  redirectUrl?: string;
}

export interface FormSettings {
  createContact: boolean;
  updateContact: boolean;
  autoTags: string[];
  successMessage: string;
  redirectUrl: string | null;
  showProgressBar: boolean;
  allowBackNavigation: boolean;
  /**
   * How it is shown. auto: a form is one long page (or its pages, if it has several); a survey goes
   * slide by slide. one_page · pages · one_question (each question its own slide).
   */
  presentation?: 'auto' | 'one_page' | 'pages' | 'one_question';
  /** Slides: move on as soon as a single choice is picked. */
  autoAdvance?: boolean;
  /** Fill fields from the link (?email=…&first_name=…). On unless turned off. */
  prefillFromUrl?: boolean;
  /** Remember the person on this device and fill their details next time. */
  rememberRespondent?: boolean;
  disableAutofill?: boolean;
  /** Stop taking responses after this time, or after this many. */
  closeAt?: string | null;
  maxResponses?: number | null;
  closedMessage?: string;
  /** A hidden trap field bots fill in; on unless turned off. */
  spamProtection?: boolean;
  /** Redirect: open the link in a new tab. */
  redirectNewTab?: boolean;
  /** The connected email account notifications are sent from. */
  senderAccountId?: string | null;
  quiz?: QuizSettings;
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

export type ElementGroup = 'personal' | 'contact' | 'address' | 'text' | 'choice' | 'rating' | 'other' | 'payments' | 'content' | 'layout';

export interface ElementLibraryItem {
  type: ElementType;
  category: ElementCategory;
  /** Where it sits in the builder's panel. */
  group: ElementGroup;
  label: string;
  icon: string;
  isContainer?: boolean;
  isField?: boolean;
  /** Layout items: how many columns the new section has. */
  columns?: ColumnCount;
  /** A word or two for the search box. */
  keywords?: string;
}

export const ELEMENT_LIBRARY: ElementLibraryItem[] = [
  { type: 'full_name', category: 'fields', group: 'personal', label: 'Full Name', icon: 'IdCard', isField: true, keywords: 'name' },
  { type: 'first_name', category: 'fields', group: 'personal', label: 'First Name', icon: 'User', isField: true, keywords: 'name' },
  { type: 'last_name', category: 'fields', group: 'personal', label: 'Last Name', icon: 'User', isField: true, keywords: 'name surname' },
  { type: 'date_of_birth', category: 'fields', group: 'personal', label: 'Date of Birth', icon: 'Cake', isField: true, keywords: 'birthday dob' },
  { type: 'email', category: 'fields', group: 'contact', label: 'Email', icon: 'Mail', isField: true },
  { type: 'phone', category: 'fields', group: 'contact', label: 'Phone', icon: 'Phone', isField: true, keywords: 'mobile' },
  { type: 'company', category: 'fields', group: 'contact', label: 'Organization', icon: 'Building2', isField: true, keywords: 'company business' },
  { type: 'job_title', category: 'fields', group: 'contact', label: 'Job Title', icon: 'BriefcaseBusiness', isField: true, keywords: 'role position' },
  { type: 'website', category: 'fields', group: 'contact', label: 'Website', icon: 'Globe', isField: true, keywords: 'url link' },
  { type: 'address', category: 'fields', group: 'address', label: 'Address', icon: 'MapPin', isField: true, keywords: 'street' },
  { type: 'city', category: 'fields', group: 'address', label: 'City', icon: 'Building', isField: true, keywords: 'town' },
  { type: 'state', category: 'fields', group: 'address', label: 'State', icon: 'Map', isField: true, keywords: 'region province county' },
  { type: 'postal_code', category: 'fields', group: 'address', label: 'Postal Code', icon: 'Mailbox', isField: true, keywords: 'zip postcode' },
  { type: 'country', category: 'fields', group: 'address', label: 'Country', icon: 'Flag', isField: true },
  { type: 'text_field', category: 'fields', group: 'text', label: 'Single Line', icon: 'TextCursorInput', isField: true, keywords: 'text short answer' },
  { type: 'long_text', category: 'fields', group: 'text', label: 'Multi Line', icon: 'AlignLeft', isField: true, keywords: 'text paragraph long answer textarea' },
  { type: 'number', category: 'fields', group: 'text', label: 'Number', icon: 'Hash', isField: true },
  { type: 'monetary', category: 'fields', group: 'text', label: 'Monetary', icon: 'DollarSign', isField: true, keywords: 'money amount price budget' },
  { type: 'date', category: 'fields', group: 'text', label: 'Date Picker', icon: 'Calendar', isField: true, keywords: 'day' },
  { type: 'time', category: 'fields', group: 'text', label: 'Time', icon: 'Clock', isField: true, keywords: 'hour' },
  { type: 'dropdown', category: 'choice', group: 'choice', label: 'Single Dropdown', icon: 'ChevronsUpDown', isField: true, keywords: 'select list' },
  { type: 'multi_select', category: 'choice', group: 'choice', label: 'Multi Dropdown', icon: 'ListChecks', isField: true, keywords: 'select multiple' },
  { type: 'checkbox', category: 'choice', group: 'choice', label: 'Checkbox', icon: 'SquareCheck', isField: true, keywords: 'tick multiple' },
  { type: 'radio', category: 'choice', group: 'choice', label: 'Radio', icon: 'CircleDot', isField: true, keywords: 'single choice' },
  { type: 'yes_no', category: 'choice', group: 'choice', label: 'Yes / No', icon: 'ToggleLeft', isField: true },
  { type: 'rating', category: 'advanced', group: 'rating', label: 'Rating', icon: 'Star', isField: true, keywords: 'stars' },
  { type: 'scale', category: 'advanced', group: 'rating', label: 'Scale / NPS', icon: 'Gauge', isField: true, keywords: 'nps score' },
  { type: 'file_upload', category: 'advanced', group: 'other', label: 'File Upload', icon: 'CloudUpload', isField: true, keywords: 'attachment document' },
  { type: 'signature', category: 'advanced', group: 'other', label: 'Signature', icon: 'PenTool', isField: true, keywords: 'sign' },
  { type: 'consent', category: 'advanced', group: 'other', label: 'T & C', icon: 'ShieldCheck', isField: true, keywords: 'terms consent agree gdpr' },
  { type: 'captcha', category: 'advanced', group: 'other', label: 'Bot Protection', icon: 'Bot', isField: true, keywords: 'captcha spam' },
  { type: 'source', category: 'advanced', group: 'other', label: 'Source', icon: 'Link2', isField: true, keywords: 'utm tracking campaign' },
  { type: 'hidden', category: 'advanced', group: 'other', label: 'Hidden Field', icon: 'EyeOff', isField: true, keywords: 'tracking' },
  { type: 'heading', category: 'content', group: 'content', label: 'Heading', icon: 'Heading1', keywords: 'title' },
  { type: 'text', category: 'content', group: 'content', label: 'Text', icon: 'Type' },
  { type: 'paragraph', category: 'content', group: 'content', label: 'Paragraph', icon: 'Pilcrow' },
  { type: 'image', category: 'content', group: 'content', label: 'Image', icon: 'Image', keywords: 'picture photo' },
  { type: 'logo', category: 'content', group: 'content', label: 'Logo', icon: 'ImagePlus', keywords: 'brand' },
  { type: 'divider', category: 'content', group: 'content', label: 'Divider', icon: 'SeparatorHorizontal', keywords: 'line' },
  { type: 'spacer', category: 'content', group: 'content', label: 'Spacer', icon: 'MoveVertical', keywords: 'gap space' },
  { type: 'button', category: 'content', group: 'content', label: 'Button', icon: 'MousePointerClick', keywords: 'submit next link' },
  { type: 'section', category: 'layout', group: 'layout', label: 'One Column', icon: 'Square', isContainer: true, columns: 1, keywords: 'section' },
  { type: 'columns', category: 'layout', group: 'layout', label: 'Two Columns', icon: 'Columns2', isContainer: true, columns: 2, keywords: 'section side by side' },
  { type: 'container', category: 'layout', group: 'layout', label: 'Three Columns', icon: 'Columns3', isContainer: true, columns: 3, keywords: 'section' },
  { type: 'card', category: 'layout', group: 'layout', label: 'Card', icon: 'PanelTop', isContainer: true, columns: 1, keywords: 'section box' },
];

export const ELEMENT_GROUPS: { label: string; group: ElementGroup; tab: 'fields' | 'layout' }[] = [
  { label: 'Personal info', group: 'personal', tab: 'fields' },
  { label: 'Contact', group: 'contact', tab: 'fields' },
  { label: 'Address', group: 'address', tab: 'fields' },
  { label: 'Text & numbers', group: 'text', tab: 'fields' },
  { label: 'Choices', group: 'choice', tab: 'fields' },
  { label: 'Rating', group: 'rating', tab: 'fields' },
  { label: 'More', group: 'other', tab: 'fields' },
  { label: 'Content', group: 'content', tab: 'layout' },
  { label: 'Layout', group: 'layout', tab: 'layout' },
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

  layoutPreset: 'card',
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
    pagePadding: 24,
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
    width: 'full',
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
