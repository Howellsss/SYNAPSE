import { describe, expect, it } from 'vitest';
import { PRODUCTION_URL, movedAddress, publicOrigin } from './publicUrl';

describe('publicOrigin', () => {
  it('never shares a Vercel deployment address (those ask guests to log into Vercel)', () => {
    expect(publicOrigin('https://synapse-dj3a-k2j3h4g5-howellsss-projects.vercel.app', '')).toBe(PRODUCTION_URL);
    expect(publicOrigin('https://synapse-dj3a-git-main-howellsss-projects.vercel.app', '')).toBe(PRODUCTION_URL);
  });
  it('keeps the production address, custom domains and local development', () => {
    expect(publicOrigin('https://synapse-dj3a.vercel.app', '')).toBe('https://synapseconnector.com');
    expect(publicOrigin('https://synapseconnector.com', '')).toBe('https://synapseconnector.com');
    expect(publicOrigin('https://app.example.com', '')).toBe('https://app.example.com');
    expect(publicOrigin('http://localhost:5173', '')).toBe('http://localhost:5173');
  });
  it('uses the configured public address when set', () => {
    expect(publicOrigin('https://synapse-dj3a-x.vercel.app', 'https://meet.example.com/')).toBe('https://meet.example.com');
    expect(publicOrigin('https://synapse-dj3a-x.vercel.app', 'not a url')).toBe(PRODUCTION_URL);
  });
});

describe('movedAddress', () => {
  it('sends the old address to the same page on the domain, keeping the ticket signature and route', () => {
    expect(movedAddress('https://synapse-dj3a.vercel.app/e/ticket/6f1c2b0a-1111-4222-8333-944455556666?v=0123456789abcdef'))
      .toBe('https://synapseconnector.com/e/ticket/6f1c2b0a-1111-4222-8333-944455556666?v=0123456789abcdef');
    expect(movedAddress('https://synapse-dj3a.vercel.app/#/events/abc')).toBe('https://synapseconnector.com/#/events/abc');
  });
  it('leaves the domain, previews and local development alone', () => {
    expect(movedAddress('https://synapseconnector.com/e/unscathed')).toBeNull();
    expect(movedAddress('https://synapse-dj3a-git-main-howellsss-projects.vercel.app/')).toBeNull();
    expect(movedAddress('http://localhost:5173/')).toBeNull();
  });
});
