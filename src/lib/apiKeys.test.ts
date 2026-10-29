import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { ENDPOINTS, apiBase, curlMe } from './apiKeys';

describe('API keys', () => {
  it('puts the API on the project address', () => {
    expect(apiBase('https://p.supabase.co/')).toBe('https://p.supabase.co/functions/v1/api/v1');
  });
  it('gives a first call with the key as a Bearer token', () => {
    expect(curlMe('https://x/v1', 'syn_abc')).toBe("curl 'https://x/v1/me' \\\n  -H 'Authorization: Bearer syn_abc'");
  });
  it('lists every route the database answers', () => {
    expect(ENDPOINTS.map((e) => `${e.method} ${e.path}`)).toContain('DELETE /contacts/{id}/tags/{tag}');
    expect(ENDPOINTS).toHaveLength(11);
  });
});
