import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { canUse, DEFAULT_USER_ACCESS, featureForPath, homePath } from './access';

describe('who sees what', () => {
  it('lets the owner and admins see everything', () => {
    expect(canUse('owner', [], 'workflows')).toBe(true);
    expect(canUse('admin', null, 'contacts')).toBe(true);
  });
  it('gives users Conversations, Workspaces, Meetings and Calendars unless an admin chose', () => {
    expect(DEFAULT_USER_ACCESS).toEqual(['conversations', 'workspaces', 'meetings', 'calendars']);
    expect(canUse('member', null, 'meetings')).toBe(true);
    expect(canUse('member', null, 'contacts')).toBe(false);
    expect(canUse('member', ['conversations', 'contacts'], 'contacts')).toBe(true);
    expect(canUse('member', ['conversations'], 'meetings')).toBe(false);
  });
  it('knows the section of each page', () => {
    expect(featureForPath('/dashboard')).toBe('dashboard');
    expect(featureForPath('/')).toBe('dashboard');
    expect(featureForPath('/contacts/abc')).toBe('contacts');
    expect(featureForPath('/rooms')).toBe('meetings');
    expect(featureForPath('/workspace/main-office')).toBe('workspaces');
    expect(featureForPath('/workspaces')).toBe('workspaces');
    expect(featureForPath('/forms/x/edit')).toBe('forms');
    expect(featureForPath('/settings?tab=team')).toBeNull();
  });
  it('sends users to their first section and admins to the dashboard', () => {
    expect(homePath('admin', null)).toBe('/dashboard');
    expect(homePath('member', null)).toBe('/conversations');
    expect(homePath('member', ['meetings'])).toBe('/meetings');
    expect(homePath('member', [])).toBe('/settings');
  });
});
