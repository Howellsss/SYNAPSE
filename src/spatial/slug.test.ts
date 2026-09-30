import { describe, it, expect } from 'vitest';
import { slugify, slugProblem, SLUG_MAX } from './slug';

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugify('Howells HQ')).toBe('howells-hq');
  });

  it('drops accents and symbols', () => {
    expect(slugify('Café Lagos!')).toBe('cafe-lagos');
    expect(slugify('Ọ̀rẹ́ Studio')).toBe('ore-studio');
  });

  it('turns & into "and"', () => {
    expect(slugify('Design & Build')).toBe('design-and-build');
  });

  it('collapses repeated separators and trims hyphens', () => {
    expect(slugify('  --Team   __ Space--  ')).toBe('team-space');
  });

  it('keeps digits', () => {
    expect(slugify('Cohort 2026')).toBe('cohort-2026');
  });

  it('returns an empty string when nothing usable is left', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });

  it(`caps the length at ${SLUG_MAX} without a trailing hyphen`, () => {
    const slug = slugify('a'.repeat(39) + ' bcd');
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('slugProblem', () => {
  it('accepts a normal slug', () => {
    expect(slugProblem('howells-hq')).toBeNull();
  });

  it('flags empty, short, long and badly formed slugs', () => {
    expect(slugProblem('')).toBe('empty');
    expect(slugProblem('ab')).toBe('too_short');
    expect(slugProblem('a'.repeat(SLUG_MAX + 1))).toBe('too_long');
    expect(slugProblem('Has-Caps')).toBe('format');
    expect(slugProblem('double--hyphen')).toBe('format');
    expect(slugProblem('-leading')).toBe('format');
  });

  it('rejects words the app uses for its own pages', () => {
    expect(slugProblem('settings')).toBe('reserved');
    expect(slugProblem('book')).toBe('reserved');
    expect(slugProblem('workspace')).toBe('reserved');
  });
});
