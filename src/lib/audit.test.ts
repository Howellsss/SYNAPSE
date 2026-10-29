import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({}) }));

import { auditCsv, categoryOf, dayLabel, describeAudit } from './audit';

const d = (action: string, details: Record<string, unknown>) => describeAudit({ action, details: { actor: 'Ada Admin', ...details } });

describe('describeAudit', () => {
  it('says who changed roles and what someone can see', () => {
    expect(d('role_changed', { name: 'Sam', from: 'member', to: 'admin' })).toEqual({ actor: 'Ada Admin', text: 'changed Sam’s role from User to Admin' });
    expect(d('access_changed', { name: 'Sam', from: ['conversations', 'meetings'], to: ['conversations', 'contacts', 'forms'] }).text)
      .toBe('changed what Sam can see: turned on Contacts and Forms and surveys; turned off Meetings');
  });
  it('tells joining apart from being added', () => {
    expect(d('member_joined', { name: 'Ada Admin', role: 'member' }).text).toBe('joined as User');
    expect(d('member_joined', { name: 'Sam', role: 'admin' }).text).toBe('added Sam as Admin');
  });
  it('includes the hand-over when someone is removed', () => {
    expect(d('member_removed', { name: 'Sam', handed_to_name: 'Bo', moved: { contacts: 3, tasks: 1 } }).text)
      .toBe('removed Sam, handing 3 contacts and 1 open task to Bo');
    expect(d('member_suspended', { name: 'Sam' }).text).toBe('suspended Sam');
  });
  it('names deleted, created and renamed things', () => {
    expect(d('contact_deleted', { name: 'Jo Bloggs' }).text).toBe('deleted the contact “Jo Bloggs”');
    expect(d('department_renamed', { from: 'Sales', name: 'Sales EMEA' }).text).toBe('renamed the department “Sales” to “Sales EMEA”');
    expect(d('settings_changed', { area: 'company', fields: ['name', 'logo_url'] }).text).toBe('changed the company name and logo');
  });
  it('names API keys made and revoked', () => {
    expect(d('api_key_created', { name: 'Zapier', access: 'read only' }).text).toBe('made the API key “Zapier” (read only)');
    expect(d('api_key_revoked', { name: 'Zapier' }).text).toBe('revoked the API key “Zapier”');
    expect(categoryOf('api_key_revoked')).toBe('settings');
  });
  it('falls back to the action words', () => {
    expect(describeAudit({ action: 'calendar_shared', details: null })).toEqual({ actor: 'Someone', text: 'calendar shared' });
  });
});

describe('categories, days and export', () => {
  it('groups actions', () => {
    expect(categoryOf('role_changed')).toBe('people');
    expect(categoryOf('form_deleted')).toBe('deletions');
    expect(categoryOf('workflow_published')).toBe('publishing');
    expect(categoryOf('department_created')).toBe('settings');
    expect(categoryOf('appointment_booked')).toBe('other');
  });
  it('labels days', () => {
    const now = new Date(2026, 9, 29, 15);
    expect(dayLabel(new Date(2026, 9, 29, 9).toISOString(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 28, 23).toISOString(), now)).toBe('Yesterday');
  });
  it('exports a CSV with quoted cells', () => {
    const csv = auditCsv([{ id: '1', user_id: null, action: 'contact_deleted', entity_type: 'contact', entity_id: null, details: { actor: 'Ada', name: 'Smith, Jo' }, created_at: '2026-10-29T10:00:00Z' }]);
    expect(csv.split('\n')[1]).toBe('2026-10-29T10:00:00.000Z,Ada,"Ada deleted the contact “Smith, Jo”",deletions,contact_deleted');
  });
});
