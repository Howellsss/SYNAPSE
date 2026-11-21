import { describe, expect, it } from 'vitest';
import { eventRootPath, publicEventsPath, shortEventPath, isReservedSlug } from './eventPaths';

describe('event addresses', () => {
  it('opens an event from the top of the site', () => {
    expect(eventRootPath('/unscathed')).toBe('/e/unscathed');
    expect(eventRootPath('/unscathed/register')).toBe('/e/unscathed/register');
    expect(eventRootPath('/unscathed?v=1')).toBe('/e/unscathed?v=1');
  });
  it('never takes the app’s own pages', () => {
    for (const p of ['/', '/dashboard', '/events', '/signin', '/contacts/abc', '/e', '/check-in', '/forms', '/workspace']) {
      expect(eventRootPath(p)).toBeNull();
    }
    expect(isReservedSlug('Dashboard')).toBe(true);
  });
  it('still answers the older /e/ links and keeps tickets and door passes there', () => {
    expect(publicEventsPath('/e/unscathed')).toBe('/e/unscathed');
    expect(publicEventsPath('/e')).toBe('/e');
    expect(shortEventPath('/e/unscathed')).toBe('/unscathed');
    expect(shortEventPath('/e/unscathed/register?v=2')).toBe('/unscathed/register?v=2');
    expect(shortEventPath('/e/ticket/abc')).toBeNull();
    expect(shortEventPath('/e/door/abc')).toBeNull();
    expect(shortEventPath('/e')).toBeNull();
  });
});
