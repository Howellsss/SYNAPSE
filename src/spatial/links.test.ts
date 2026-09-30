import { describe, it, expect } from 'vitest';
import { parseJoinLink, spaceUrl, displaySpaceLink } from './links';

describe('workspace links', () => {
  it('builds display and app links', () => {
    expect(displaySpaceLink('howells-hq')).toBe('synapse.app/howells-hq');
    expect(spaceUrl('howells-hq', 'https://synapse-dj3a.vercel.app')).toBe('https://synapse-dj3a.vercel.app/#/workspace/howells-hq');
  });

  it('reads team invite links', () => {
    expect(parseJoinLink('https://synapse-dj3a.vercel.app/invite/abc123DEF')).toEqual({ token: 'abc123DEF' });
  });

  it('reads workspace links in both forms', () => {
    expect(parseJoinLink('https://synapse-dj3a.vercel.app/#/workspace/howells-hq')).toEqual({ slug: 'howells-hq' });
    expect(parseJoinLink('synapse.app/howells-hq')).toEqual({ slug: 'howells-hq' });
    expect(parseJoinLink('  https://synapse.app/howells-hq/ ')).toEqual({ slug: 'howells-hq' });
  });

  it('rejects anything else', () => {
    expect(parseJoinLink('hello')).toBeNull();
    expect(parseJoinLink('https://example.com/other')).toBeNull();
    expect(parseJoinLink('https://x.app/#/workspace/new')).toBeNull();
  });
});
