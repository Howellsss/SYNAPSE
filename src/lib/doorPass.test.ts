import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { forgetPass, passStatus, storePass, storedPass } from './doorPass';

describe('door passes', () => {
  it('a phone keeps its pass per event, and can forget it', () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } });
    expect(storedPass('ev1')).toBeNull();
    storePass('ev1', 'tok');
    expect(storedPass('ev1')).toBe('tok');
    expect(storedPass('ev2')).toBeNull();
    forgetPass('ev1');
    expect(storedPass('ev1')).toBeNull();
    vi.unstubAllGlobals();
  });
  it('says where each pass is', () => {
    expect(passStatus({ activated_at: null, last_used_at: null, revoked_at: null })).toBe('Not opened yet');
    expect(passStatus({ activated_at: '2026-12-05T14:00:00Z', last_used_at: null, revoked_at: null })).toBe('On a phone · no scans yet');
    expect(passStatus({ activated_at: '2026-12-05T14:00:00Z', last_used_at: '2026-12-05T15:10:00Z', revoked_at: null })).toMatch(/^On a phone · last scan /);
    expect(passStatus({ activated_at: '2026-12-05T14:00:00Z', last_used_at: null, revoked_at: '2026-12-05T16:00:00Z' })).toBe('Removed');
  });
});
