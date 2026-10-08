import { describe, expect, it } from 'vitest';
import { browserName, keepFullerList } from './continuity';

const cam = (deviceId: string, label: string) => ({ deviceId, kind: 'videoinput', label });

describe('keepFullerList', () => {
  const full = [cam('a', 'FaceTime HD Camera'), cam('b', 'iPhone Camera'), cam('c', 'iPhone Desk View Camera')];
  it('keeps the named list when the browser answers with a reduced one', () => {
    expect(keepFullerList(full, [cam('a', '')])).toBe(full);
    expect(keepFullerList(full, [])).toBe(full);
  });
  it('takes a fully named new list, so unplugged devices disappear', () => {
    const next = [cam('a', 'FaceTime HD Camera')];
    expect(keepFullerList(full, next)).toBe(next);
  });
  it('takes the first list it gets', () => {
    const next = [cam('a', '')];
    expect(keepFullerList([], next)).toBe(next);
  });
});

describe('browserName', () => {
  it('names the common Mac browsers', () => {
    expect(browserName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe('Safari');
    expect(browserName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe('Chrome');
    expect(browserName('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge');
    expect(browserName('Mozilla/5.0 (Macintosh; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox');
  });
});
