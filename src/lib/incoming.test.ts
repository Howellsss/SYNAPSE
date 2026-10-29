import { describe, expect, it } from 'vitest';
import { curlExample, incomingUrl, parseTags } from './incoming';

describe('incoming links', () => {
  it('builds the link on the project address', () => {
    expect(incomingUrl('abc123', 'https://p.supabase.co/')).toBe('https://p.supabase.co/functions/v1/api/incoming/abc123');
  });
  it('reads tags typed as "a, b"', () => {
    expect(parseTags(' VIP, Lead ,, vip ,')).toEqual(['VIP', 'Lead']);
    expect(parseTags('')).toEqual([]);
  });
  it('gives a runnable example for the link', () => {
    expect(curlExample('https://x/y')).toContain("curl -X POST 'https://x/y'");
  });
});
