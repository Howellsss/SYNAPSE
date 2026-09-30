import type {
  FormDefinition, FormElement, FormSection, ElementType,
  ElementCategory, FieldDefinition, ElementStyle, ElementContent,
  FormTheme, FormSettings, FormHeader, FormFooter,
  FormNotifications,
} from './form-builder-types';
import {
  generateElementId, generateFieldId, generateSectionId, generatePageId,
  DEFAULT_THEME,
} from './form-builder-types';

// ============================================================
// CATEGORY / LABEL MAPS
// ============================================================

const ELEMENT_CATEGORY_MAP: Record<ElementType, ElementCategory> = {
  heading: 'content', text: 'content', paragraph: 'content', image: 'content',
  logo: 'content', divider: 'content', spacer: 'content', button: 'content',
  section: 'layout', container: 'layout', columns: 'layout', card: 'layout',
  first_name: 'fields', last_name: 'fields', text_field: 'fields', long_text: 'fields',
  phone: 'fields', email: 'fields', number: 'fields', date: 'fields', time: 'fields',
  website: 'fields', address: 'fields',
  radio: 'choice', checkbox: 'choice', dropdown: 'choice', multi_select: 'choice', yes_no: 'choice',
  rating: 'advanced', scale: 'advanced', file_upload: 'advanced', signature: 'advanced',
  consent: 'advanced', hidden: 'advanced',
};

const ELEMENT_LABELS: Record<ElementType, string> = {
  heading: 'Heading', text: 'Text', paragraph: 'Paragraph', image: 'Image',
  logo: 'Logo', divider: 'Divider', spacer: 'Spacer', button: 'Button',
  section: 'Section', container: 'Container', columns: 'Columns', card: 'Card',
  first_name: 'First Name', last_name: 'Last Name', text_field: 'Single Line Text',
  long_text: 'Multi-Line Text', phone: 'Phone', email: 'Email', number: 'Number',
  date: 'Date', time: 'Time', website: 'Website', address: 'Address',
  radio: 'Radio', checkbox: 'Checkbox', dropdown: 'Dropdown', multi_select: 'Multi-select',
  yes_no: 'Yes / No',
  rating: 'Rating', scale: 'Scale', file_upload: 'File Upload', signature: 'Signature',
  consent: 'Consent', hidden: 'Hidden Field',
};

const FIELD_TYPES = new Set<ElementType>([
  'first_name', 'last_name', 'text_field', 'long_text', 'phone', 'email',
  'number', 'date', 'time', 'website', 'address',
  'radio', 'checkbox', 'dropdown', 'multi_select', 'yes_no',
  'rating', 'scale', 'file_upload', 'signature', 'consent', 'hidden',
]);

const CHOICE_TYPES = new Set<ElementType>(['radio', 'checkbox', 'dropdown', 'multi_select']);

// ============================================================
// CREATE DEFAULT DEFINITION
// ============================================================

export function createDefaultDefinition(formName: string, description?: string | null): FormDefinition {
  const pageId = generatePageId();
  const sectionId = generateSectionId();

  const makeField = (type: ElementType, label: string, sortOrder: number, overrides?: Partial<FieldDefinition>): FormElement => {
    const field: FieldDefinition = {
      fieldId: generateFieldId(),
      label,
      required: false,
      visible: true,
      mappedContactField: null,
      ...overrides,
    };
    return { id: generateElementId(), type, category: ELEMENT_CATEGORY_MAP[type], displayLabel: label, sortOrder, field };
  };

  const firstName = makeField('first_name', 'First Name', 0, { required: true, placeholder: 'John', mappedContactField: 'first_name' });
  const lastName = makeField('last_name', 'Last Name', 1, { required: true, placeholder: 'Doe', mappedContactField: 'last_name' });
  const phone = makeField('phone', 'Phone Number', 2, { placeholder: '+1 (555) 000-0000', mappedContactField: 'phone' });
  const email = makeField('email', 'Email Address', 3, { required: true, placeholder: 'john@example.com', mappedContactField: 'email' });
  const consent = makeField('consent', 'Consent', 4, { required: true });
  consent.content = { text: 'I agree to be contacted regarding my submission.' };

  const elements: Record<string, FormElement> = {};
  [firstName, lastName, phone, email, consent].forEach(el => { elements[el.id] = el; });

  return {
    version: 1,
    pages: [{ id: pageId, name: 'Page 1', sectionIds: [sectionId], visible: true }],
    sections: { [sectionId]: { id: sectionId, name: 'Section 1', visible: true, columnCount: 2, elementIds: [firstName.id, lastName.id, phone.id, email.id, consent.id] } },
    elements,
    header: { enabled: true, showLogo: false, showTitle: true, showDescription: !!description, showProgress: false },
    footer: { enabled: false, content: '' },
    theme: { ...DEFAULT_THEME },
    logic: [],
    settings: {
      createContact: true, updateContact: true, autoTags: [],
      successMessage: 'Thank you for your submission.', redirectUrl: null,
      showProgressBar: false, allowBackNavigation: true,
    },
    notifications: {
      internal: {
        enabled: false,
        recipients: [],
        channel: 'email',
        subject: 'New Form Submission',
        message: 'A new form submission has been received.',
        includeFields: [],
        includeAllFields: true,
      },
      respondent: {
        enabled: false,
        emailFieldId: null,
        subject: 'Thank you for your submission',
        senderName: '',
        replyTo: '',
        message: 'We have received your information and will be in touch shortly.',
        includeAnswers: 'none',
        includedFields: [],
      },
      postSubmission: {
        type: 'thank_you',
        thankYouPage: {
          heading: 'Thank You!',
          message: 'Your submission has been received. We will be in touch with you shortly.',
          imageUrl: null,
          buttonText: null,
          buttonLink: null,
        },
        redirectUrl: null,
        customMessage: '',
      },
    },
  };
}

// ============================================================
// CREATE ELEMENT
// ============================================================

export function createElement(type: ElementType, sortOrder: number, overrides?: Partial<Pick<FormElement, 'content' | 'field' | 'style' | 'column'>>): FormElement {
  const category = ELEMENT_CATEGORY_MAP[type];
  const isField = FIELD_TYPES.has(type);
  const element: FormElement = {
    id: generateElementId(), type, category,
    displayLabel: ELEMENT_LABELS[type], sortOrder, ...overrides,
  };

  if (isField && !element.field) element.field = createDefaultField(type);
  if (type === 'heading' && !element.content) element.content = { text: 'Section Heading', headingLevel: 'h2' };
  if (type === 'text' && !element.content) element.content = { text: 'Enter your text here.' };
  if (type === 'paragraph' && !element.content) element.content = { text: 'Enter your paragraph text here.' };
  if (type === 'button' && !element.content) element.content = { buttonText: 'Submit', buttonAction: 'submit' };
  if (type === 'divider' && !element.content) element.content = { dividerStyle: 'solid' };
  if (type === 'spacer' && !element.content) element.content = { spacerHeight: 24 };
  if (type === 'rating' && !element.content) element.content = { maxRating: 5, ratingSymbol: 'star' };
  if (type === 'scale' && !element.content) element.content = { scaleMin: 1, scaleMax: 10, scaleStep: 1, scaleMinLabel: 'Low', scaleMaxLabel: 'High' };
  return element;
}

function createDefaultField(type: ElementType): FieldDefinition {
  const base: FieldDefinition = { fieldId: generateFieldId(), label: ELEMENT_LABELS[type], required: false, visible: true, mappedContactField: null };

  if (type === 'first_name') { base.label = 'First Name'; base.required = true; base.placeholder = 'John'; base.mappedContactField = 'first_name'; }
  if (type === 'last_name') { base.label = 'Last Name'; base.required = true; base.placeholder = 'Doe'; base.mappedContactField = 'last_name'; }
  if (type === 'email') { base.label = 'Email Address'; base.required = true; base.placeholder = 'john@example.com'; base.mappedContactField = 'email'; }
  if (type === 'phone') { base.label = 'Phone Number'; base.placeholder = '+1 (555) 000-0000'; base.mappedContactField = 'phone'; }
  if (type === 'text_field') { base.label = 'Short Answer'; base.placeholder = 'Enter your answer'; }
  if (type === 'long_text') { base.label = 'Long Answer'; base.placeholder = 'Enter your answer'; }
  if (type === 'number') { base.label = 'Number'; base.placeholder = '0'; }
  if (type === 'date') base.label = 'Date';
  if (type === 'time') base.label = 'Time';
  if (type === 'website') { base.label = 'Website'; base.placeholder = 'https://'; }
  if (type === 'address') { base.label = 'Address'; base.placeholder = 'Enter your address'; }
  if (type === 'yes_no') { base.label = 'Yes or No?'; base.options = ['Yes', 'No']; }
  if (type === 'consent') { base.label = 'Consent'; base.required = true; }
  if (type === 'hidden') { base.label = 'Hidden Field'; base.visible = false; }

  if (CHOICE_TYPES.has(type)) {
    base.options = ['Option 1', 'Option 2', 'Option 3'];
    if (type === 'radio') base.label = 'Multiple Choice';
    if (type === 'checkbox') base.label = 'Checkboxes';
    if (type === 'dropdown') base.label = 'Dropdown';
    if (type === 'multi_select') base.label = 'Multi-Select';
  }
  return base;
}

// ============================================================
// DEFINITION OPERATIONS (immutable updates)
// ============================================================

export function addElementToSection(def: FormDefinition, sectionId: string, element: FormElement, columnIndex?: number): FormDefinition {
  const section = def.sections[sectionId];
  if (!section) return def;
  const col = columnIndex ?? 1;
  const newElement = { ...element, column: col, sortOrder: section.elementIds.length };
  return {
    ...def,
    elements: { ...def.elements, [newElement.id]: newElement },
    sections: { ...def.sections, [sectionId]: { ...section, elementIds: [...section.elementIds, newElement.id] } },
  };
}

export function removeElement(def: FormDefinition, elementId: string): FormDefinition {
  const element = def.elements[elementId];
  if (!element) return def;
  const newElements = { ...def.elements };
  delete newElements[elementId];
  const newSections = { ...def.sections };
  for (const [secId, sec] of Object.entries(newSections)) {
    if (sec.elementIds.includes(elementId)) {
      newSections[secId] = { ...sec, elementIds: sec.elementIds.filter(id => id !== elementId) };
    }
  }
  return { ...def, elements: newElements, sections: newSections };
}

export function updateElement(def: FormDefinition, elementId: string, updates: Partial<FormElement>): FormDefinition {
  const element = def.elements[elementId];
  if (!element) return def;
  return { ...def, elements: { ...def.elements, [elementId]: { ...element, ...updates } } };
}

export function updateElementField(def: FormDefinition, elementId: string, fieldUpdates: Partial<FieldDefinition>): FormDefinition {
  const element = def.elements[elementId];
  if (!element?.field) return def;
  return updateElement(def, elementId, { field: { ...element.field, ...fieldUpdates } });
}

export function updateElementContent(def: FormDefinition, elementId: string, contentUpdates: Partial<ElementContent>): FormDefinition {
  const element = def.elements[elementId];
  if (!element) return def;
  return updateElement(def, elementId, { content: { ...element.content, ...contentUpdates } });
}

export function updateElementStyle(def: FormDefinition, elementId: string, styleUpdates: Partial<ElementStyle>): FormDefinition {
  const element = def.elements[elementId];
  if (!element) return def;
  return updateElement(def, elementId, { style: { ...element.style, ...styleUpdates } });
}

export function moveElement(def: FormDefinition, elementId: string, toSectionId: string, toIndex: number, toColumn?: number): FormDefinition {
  const element = def.elements[elementId];
  if (!element) return def;
  const newSections = { ...def.sections };
  for (const [secId, sec] of Object.entries(newSections)) {
    if (sec.elementIds.includes(elementId)) {
      newSections[secId] = { ...sec, elementIds: sec.elementIds.filter(id => id !== elementId) };
    }
  }
  const targetSection = newSections[toSectionId];
  if (!targetSection) return def;
  const newElementIds = [...targetSection.elementIds];
  newElementIds.splice(Math.min(toIndex, newElementIds.length), 0, elementId);
  newSections[toSectionId] = { ...targetSection, elementIds: newElementIds };
  return { ...def, sections: newSections, elements: { ...def.elements, [elementId]: { ...element, column: toColumn ?? element.column ?? 1 } } };
}

export function duplicateElement(def: FormDefinition, elementId: string): FormDefinition {
  const element = def.elements[elementId];
  if (!element) return def;
  const newId = generateElementId();
  const newElement: FormElement = {
    ...element, id: newId,
    field: element.field ? { ...element.field, fieldId: generateFieldId() } : undefined,
    content: element.content ? { ...element.content } : undefined,
    style: element.style ? { ...element.style } : undefined,
  };
  const newSections = { ...def.sections };
  for (const [secId, sec] of Object.entries(newSections)) {
    const idx = sec.elementIds.indexOf(elementId);
    if (idx !== -1) {
      newSections[secId] = { ...sec, elementIds: [...sec.elementIds.slice(0, idx + 1), newId, ...sec.elementIds.slice(idx + 1)] };
      break;
    }
  }
  return { ...def, elements: { ...def.elements, [newId]: newElement }, sections: newSections };
}

// ============================================================
// SECTION OPERATIONS
// ============================================================

export function addSection(def: FormDefinition, pageId: string, name?: string): FormDefinition {
  const sectionId = generateSectionId();
  const section: FormSection = { id: sectionId, name: name || `Section ${Object.keys(def.sections).length + 1}`, visible: true, columnCount: 1, elementIds: [] };
  const page = def.pages.find(p => p.id === pageId);
  if (!page) return def;
  return {
    ...def,
    sections: { ...def.sections, [sectionId]: section },
    pages: def.pages.map(p => p.id === pageId ? { ...p, sectionIds: [...p.sectionIds, sectionId] } : p),
  };
}

export function updateSection(def: FormDefinition, sectionId: string, updates: Partial<FormSection>): FormDefinition {
  const section = def.sections[sectionId];
  if (!section) return def;
  return { ...def, sections: { ...def.sections, [sectionId]: { ...section, ...updates } } };
}

export function removeSection(def: FormDefinition, sectionId: string): FormDefinition {
  const section = def.sections[sectionId];
  if (!section) return def;
  const newElements = { ...def.elements };
  for (const elId of section.elementIds) delete newElements[elId];
  const newSections = { ...def.sections };
  delete newSections[sectionId];
  return { ...def, sections: newSections, elements: newElements, pages: def.pages.map(p => ({ ...p, sectionIds: p.sectionIds.filter(id => id !== sectionId) })) };
}

// ============================================================
// PAGE OPERATIONS
// ============================================================

export function addPage(def: FormDefinition, name?: string): FormDefinition {
  const pageId = generatePageId();
  return { ...def, pages: [...def.pages, { id: pageId, name: name || `Page ${def.pages.length + 1}`, sectionIds: [], visible: true }] };
}

export function removePage(def: FormDefinition, pageId: string): FormDefinition {
  const page = def.pages.find(p => p.id === pageId);
  if (!page || def.pages.length <= 1) return def;
  const newSections = { ...def.sections };
  const newElements = { ...def.elements };
  for (const secId of page.sectionIds) {
    const sec = newSections[secId];
    if (sec) { for (const elId of sec.elementIds) delete newElements[elId]; delete newSections[secId]; }
  }
  return { ...def, sections: newSections, elements: newElements, pages: def.pages.filter(p => p.id !== pageId) };
}

export function renamePage(def: FormDefinition, pageId: string, name: string): FormDefinition {
  return { ...def, pages: def.pages.map(p => p.id === pageId ? { ...p, name } : p) };
}

// ============================================================
// THEME / SETTINGS / HEADER / FOOTER
// ============================================================

export function updateTheme(def: FormDefinition, updates: Partial<FormTheme>): FormDefinition {
  return { ...def, theme: { ...def.theme, ...updates } };
}
export function updateSettings(def: FormDefinition, updates: Partial<FormSettings>): FormDefinition {
  return { ...def, settings: { ...def.settings, ...updates } };
}
export function updateHeader(def: FormDefinition, updates: Partial<FormHeader>): FormDefinition {
  return { ...def, header: { ...def.header, ...updates } };
}
export function updateFooter(def: FormDefinition, updates: Partial<FormFooter>): FormDefinition {
  return { ...def, footer: { ...def.footer, ...updates } };
}
export function updateNotifications(def: FormDefinition, updates: Partial<FormNotifications>): FormDefinition {
  return { ...def, notifications: { ...def.notifications, ...updates } };
}

// ============================================================
// UNDO / REDO HISTORY
// ============================================================

export class HistoryManager<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private maxStack: number;
  constructor(maxStack = 50) { this.maxStack = maxStack; }
  push(state: T) {
    this.undoStack.push(JSON.parse(JSON.stringify(state)));
    if (this.undoStack.length > this.maxStack) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(current: T): T | null {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push(JSON.parse(JSON.stringify(current)));
    return this.undoStack.pop()!;
  }
  redo(current: T): T | null {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push(JSON.parse(JSON.stringify(current)));
    return this.redoStack.pop()!;
  }
  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  reset() { this.undoStack = []; this.redoStack = []; }
}

// ============================================================
// SERIALIZATION
// ============================================================

export function serializeDefinition(def: FormDefinition): string { return JSON.stringify(def); }

export function deserializeDefinition(json: string): FormDefinition | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed && parsed.pages && parsed.sections && parsed.elements) {
      if (!parsed.notifications) {
        parsed.notifications = createDefaultDefinition('').notifications;
      }
      return parsed as FormDefinition;
    }
    return null;
  } catch { return null; }
}

// ============================================================
// MIGRATION — convert legacy form_fields to definition
// ============================================================

export function migrateLegacyFields(
  def: FormDefinition,
  legacyFields: Array<{
    id: string; label: string; field_type: string; required: boolean;
    placeholder: string | null; help_text: string | null; default_value: string | null;
    options: string[] | null; sort_order: number; mapped_field: string | null;
  }>,
): FormDefinition {
  if (legacyFields.length === 0) return def;
  if (Object.keys(def.elements).length > 0) return def;
  const sectionId = def.pages[0]?.sectionIds[0];
  if (!sectionId) return def;

  const typeMap: Record<string, ElementType> = {
    first_name: 'first_name', last_name: 'last_name', text: 'text_field',
    long_text: 'long_text', phone: 'phone', email: 'email', number: 'number',
    radio: 'radio', checkbox: 'checkbox', multi_select: 'multi_select',
    dropdown: 'dropdown', date: 'date', time: 'time', file_upload: 'file_upload',
    consent: 'consent', hidden: 'hidden',
  };

  const newElements: Record<string, FormElement> = {};
  const elementIds: string[] = [];

  for (const lf of legacyFields) {
    const elType = typeMap[lf.field_type] || 'text_field';
    const el = createElement(elType, lf.sort_order, {
      field: {
        fieldId: generateFieldId(), label: lf.label, required: lf.required,
        placeholder: lf.placeholder ?? undefined, description: lf.help_text ?? undefined,
        defaultValue: lf.default_value ?? undefined, options: lf.options ?? undefined,
        mappedContactField: lf.mapped_field as FieldDefinition['mappedContactField'],
        visible: true,
      },
    });
    newElements[el.id] = el;
    elementIds.push(el.id);
  }

  return {
    ...def, elements: newElements,
    sections: { ...def.sections, [sectionId]: { ...def.sections[sectionId], elementIds } },
  };
}
