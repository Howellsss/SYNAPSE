import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { createDefaultDefinition, createElement, addElementToSection, removeElement, duplicateElementWithId, migrateLegacyFields, syncThemeColors, updateTheme } from './form-definition';
import { CAPTCHA_OK, fieldError, finalAnswers, prefillAnswers, runLogic, splitMulti } from './form-engine';
import { acceptAttr, fileProblem } from './form-files';
import type { FieldDefinition, FormDefinition, FormElement } from './form-builder-types';

const withElement = (type: Parameters<typeof createElement>[0]): [FormDefinition, FormElement & { field: FieldDefinition }] => {
  const def = createDefaultDefinition('Test');
  const sid = def.pages[0].sectionIds[0];
  const el = createElement(type, 0);
  return [addElementToSection(def, sid, el), el as FormElement & { field: FieldDefinition }];
};

describe('new elements', () => {
  it('Full Name and Date of Birth save to the contact', () => {
    expect(createElement('full_name', 0).field?.mappedContactField).toBe('full_name');
    expect(createElement('date_of_birth', 0).field?.mappedContactField).toBe('date_of_birth');
    expect(createElement('company', 0).field?.mappedContactField).toBe('company');
  });

  it('Bot protection needs the right sum, and is never sent', () => {
    const [def, el] = withElement('captcha');
    expect(fieldError(el, '', true)).toMatch(/quick check/i);
    expect(fieldError(el, 'wrong', true)).toMatch(/not right/i);
    expect(fieldError(el, CAPTCHA_OK, true)).toBeNull();
    const state = runLogic(def, { [el.field.fieldId]: CAPTCHA_OK });
    expect(finalAnswers(def, { [el.field.fieldId]: CAPTCHA_OK }, state)).not.toHaveProperty(el.field.fieldId);
  });

  it('Monetary takes amounts only', () => {
    const [, el] = withElement('monetary');
    expect(fieldError(el, 'abc', false)).toMatch(/amount/i);
    expect(fieldError(el, '25.50', false)).toBeNull();
  });

  it('a Date of Birth can’t be in the future', () => {
    const [, el] = withElement('date_of_birth');
    expect(fieldError(el, '2999-01-01', false)).toMatch(/future/i);
    expect(fieldError(el, '1990-05-04', false)).toBeNull();
  });

  it('Source is filled from the link and sent, though nobody sees it', () => {
    const [def, el] = withElement('source');
    const answers = prefillAnswers(def, new URLSearchParams('utm_source=facebook'));
    expect(answers[el.field.fieldId]).toBe('facebook');
    expect(finalAnswers(def, answers, runLogic(def, answers))[el.field.fieldId]).toBe('facebook');
  });

  it('a pre-filled answer shows for visible fields too, and the link wins', () => {
    const [def0, el] = withElement('text_field');
    const def = { ...def0, elements: { ...def0.elements, [el.id]: { ...el, field: { ...el.field, defaultValue: 'Hello' } } } };
    expect(prefillAnswers(def, new URLSearchParams())[el.field.fieldId]).toBe('Hello');
    expect(prefillAnswers(def, new URLSearchParams(`${el.field.fieldId}=Hi`))[el.field.fieldId]).toBe('Hi');
  });

  it('multi answers split cleanly', () => {
    expect(splitMulti('A, B,,C ')).toEqual(['A', 'B', 'C']);
  });
});

describe('builder operations', () => {
  it('Duplicate gives back the copy’s id', () => {
    const def = createDefaultDefinition('Test');
    const first = Object.keys(def.elements)[0];
    const [next, id] = duplicateElementWithId(def, first);
    expect(id).toBeTruthy();
    expect(id).not.toBe(first);
    expect(next.elements[id!].type).toBe(def.elements[first].type);
  });

  it('removing a field removes the logic rules and email settings that pointed at it', () => {
    const def = createDefaultDefinition('Test');
    const [emailId, email] = Object.entries(def.elements).find(([, e]) => e.type === 'email')!;
    const other = Object.keys(def.elements).find((id) => id !== emailId)!;
    const withRules: FormDefinition = {
      ...def,
      logic: [
        { id: 'r1', action: 'hide', targetElementId: emailId, triggerFieldId: '', operator: 'equals', triggerValue: '' } as never,
        { id: 'r2', action: 'show', targetElementId: other, triggerFieldId: email.field!.fieldId, operator: 'equals', triggerValue: 'x' } as never,
      ],
      notifications: { ...def.notifications, respondent: { ...def.notifications.respondent, emailFieldId: email.field!.fieldId } },
    };
    const after = removeElement(withRules, emailId);
    expect(after.logic).toHaveLength(0);
    expect(after.notifications.respondent.emailFieldId).toBeNull();
  });

  it('template fields named “Full name”, “Company” or “Phone number” save to the contact', () => {
    const def = migrateLegacyFields(createDefaultDefinition('T'), [
      { id: '1', label: 'Full Name', field_type: 'text', required: true, placeholder: null, help_text: null, default_value: null, options: null, sort_order: 0, mapped_field: null },
      { id: '2', label: 'Company', field_type: 'text', required: false, placeholder: null, help_text: null, default_value: null, options: null, sort_order: 1, mapped_field: null },
      { id: '3', label: 'Phone Number', field_type: 'text', required: false, placeholder: null, help_text: null, default_value: null, options: null, sort_order: 2, mapped_field: null },
      { id: '4', label: 'Consent', field_type: 'consent', required: true, placeholder: null, help_text: 'I agree to the terms.', default_value: null, options: null, sort_order: 3, mapped_field: null },
    ] as never);
    const els = Object.values(def.elements);
    expect(els.map((e) => e.field?.mappedContactField)).toEqual(['full_name', 'company', 'phone', null]);
    expect(els[3].content?.text).toBe('I agree to the terms.');
  });

  it('palette colours reach the buttons and inputs', () => {
    const def = createDefaultDefinition('T');
    const next = updateTheme(def, { colors: { ...def.theme.colors, buttonBg: '#dc2626', buttonText: '#ffeeee', inputBackground: '#111111', focusRing: '#00ff00' } });
    expect(next.theme.buttonStyle.background).toBe('#dc2626');
    expect(next.theme.buttonStyle.textColor).toBe('#ffeeee');
    expect(next.theme.fieldStyle.background).toBe('#111111');
    expect(next.theme.fieldStyle.focusBorder).toBe('#00ff00');
    // Nothing else changes when the palette doesn't.
    expect(syncThemeColors(def.theme, { ...def.theme, layoutPreset: 'card' }).buttonStyle).toEqual(def.theme.buttonStyle);
  });
});

describe('file checks', () => {
  it('allows the types the field allows, in any spelling', () => {
    expect(fileProblem({ name: 'cv.PDF', size: 1000, type: 'application/pdf' }, ['pdf'], 5)).toBeNull();
    expect(fileProblem({ name: 'me.jpeg', size: 1000, type: 'image/jpeg' }, ['.jpg'], 5)).toBeNull();
    expect(fileProblem({ name: 'me.png', size: 1000, type: 'image/png' }, ['image/*'], 5)).toBeNull();
    expect(fileProblem({ name: 'x.exe', size: 1000, type: 'application/octet-stream' }, ['pdf', 'png'], 5)).toMatch(/PDF, PNG/);
  });
  it('stops files over the limit (never more than 10 MB)', () => {
    expect(fileProblem({ name: 'a.pdf', size: 6 * 1024 * 1024, type: 'application/pdf' }, [], 5)).toMatch(/limit is 5 MB/);
    expect(fileProblem({ name: 'a.pdf', size: 11 * 1024 * 1024, type: 'application/pdf' }, [], 50)).toMatch(/limit is 10 MB/);
  });
  it('builds the picker’s accept list', () => {
    expect(acceptAttr(['pdf', '.png', 'image/*'])).toBe('.pdf,.png,image/*');
    expect(acceptAttr([])).toBeUndefined();
  });
});
