import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { answerLink, answerText, formAnswerFields, labelledAnswers, registrationsCsv, type Registration } from '@/lib/events';
import type { FormDefinition } from '@/lib/form-builder-types';

const def = {
  pages: [{ id: 'p1', name: '', sectionIds: ['s1'], visible: true }],
  sections: { s1: { id: 's1', name: '', elementIds: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'] } },
  elements: {
    e1: { id: 'e1', type: 'full_name', field: { fieldId: 'name', label: 'Full name', mappedContactField: 'full_name' } },
    e2: { id: 'e2', type: 'email', field: { fieldId: 'email', label: 'Email', mappedContactField: 'email' } },
    e3: { id: 'e3', type: 'short_text', field: { fieldId: 'stage', label: 'Stage name' } },
    e4: { id: 'e4', type: 'website', field: { fieldId: 'sample', label: 'Work sample link' } },
    e5: { id: 'e5', type: 'checkboxes', field: { fieldId: 'art', label: 'Art form' } },
    e6: { id: 'e6', type: 'consent', field: { fieldId: 'ok', label: 'I agree' } },
  },
} as unknown as FormDefinition;

describe('answers on the dashboard', () => {
  it('lists a form’s questions in order, without the consent box, marking name/email', () => {
    const f = formAnswerFields(def);
    expect(f.map((x) => x.id)).toEqual(['name', 'email', 'stage', 'sample', 'art']);
    expect(f.filter((x) => x.contact).map((x) => x.id)).toEqual(['name', 'email']);
  });
  it('labels a registration’s answers and skips the empty ones', () => {
    const r = { answers: { name: 'Ada Obi', email: 'ada@example.com', stage: 'Ada the Poet', sample: '', art: 'Spoken word, Music' } } as unknown as Registration;
    expect(labelledAnswers(r, formAnswerFields(def), { withContact: false })).toEqual([
      expect.objectContaining({ label: 'Stage name', value: 'Ada the Poet' }),
      expect.objectContaining({ label: 'Art form', value: 'Spoken word, Music' }),
    ]);
  });
  it('only http(s) and www links become links', () => {
    expect(answerLink('https://youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(answerLink('www.example.com/work')).toBe('https://www.example.com/work');
    expect(answerLink('javascript:alert(1)')).toBeNull();
    expect(answerLink('@ada_poet')).toBeNull();
    expect(answerText(['a', 'b'])).toBe('a, b');
    expect(answerText(true)).toBe('Yes');
  });
  it('the CSV gets a column per form question', () => {
    const r = { first_name: 'Ada', last_name: 'Obi', email: 'a@x.com', phone: '', ticket_id: null, status: 'applied', ticket_code: null, payment_status: 'free', pin: '123456', checked_in_at: null, created_at: '2026-11-01T10:00:00Z', answers: { stage: 'Ada the Poet' } } as unknown as Registration;
    const csv = registrationsCsv([r], [], [], [{ id: 'stage', label: 'Stage name', type: 'short_text', contact: false }]);
    const [head, row] = csv.split('\n');
    expect(head.endsWith(',Stage name')).toBe(true);
    expect(row.endsWith(',Ada the Poet')).toBe(true);
  });
});

describe('privacy and reminders', () => {
  it('a standard privacy notice in the organiser’s name says what, why, who and how long', async () => {
    const { defaultPrivacyNotice, EMAIL_KINDS } = await import('@/lib/events');
    const t = defaultPrivacyNotice('Dera Speaks');
    expect(t).toMatch(/^Dera Speaks collects your name, email/);
    expect(t).toMatch(/Only Dera Speaks’s team/);
    expect(t).toMatch(/ask Dera Speaks to delete them/);
    expect(defaultPrivacyNotice('  ')).toMatch(/^The organiser collects/);
    expect(EMAIL_KINDS.find((k) => k.kind === 'reminder')?.subject).toBe('Tomorrow: {{event}}');
  });
});
