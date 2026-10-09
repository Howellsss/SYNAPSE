import { describe, expect, it } from 'vitest';
import { PRODUCTION_URL, publicOrigin } from './publicUrl';

describe('publicOrigin', () => {
  it('never shares a Vercel deployment address (those ask guests to log into Vercel)', () => {
    expect(publicOrigin('https://synapse-dj3a-k2j3h4g5-howellsss-projects.vercel.app', '')).toBe(PRODUCTION_URL);
    expect(publicOrigin('https://synapse-dj3a-git-main-howellsss-projects.vercel.app', '')).toBe(PRODUCTION_URL);
  });
  it('keeps the production address, custom domains and local development', () => {
    expect(publicOrigin('https://synapse-dj3a.vercel.app', '')).toBe('https://synapse-dj3a.vercel.app');
    expect(publicOrigin('https://app.example.com', '')).toBe('https://app.example.com');
    expect(publicOrigin('http://localhost:5173', '')).toBe('http://localhost:5173');
  });
  it('uses the configured public address when set', () => {
    expect(publicOrigin('https://synapse-dj3a-x.vercel.app', 'https://meet.example.com/')).toBe('https://meet.example.com');
    expect(publicOrigin('https://synapse-dj3a-x.vercel.app', 'not a url')).toBe(PRODUCTION_URL);
  });
});
