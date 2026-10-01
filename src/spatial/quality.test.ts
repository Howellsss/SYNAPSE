import { describe, expect, it } from 'vitest';
import { autoQuality } from './quality';

describe('autoQuality', () => {
  it('picks low quality on small devices', () => {
    expect(autoQuality(4, 8)).toBe('low');
    expect(autoQuality(8, 4)).toBe('low');
    expect(autoQuality(8, 8)).toBe('high');
    expect(autoQuality(undefined, undefined)).toBe('high');
  });
});
