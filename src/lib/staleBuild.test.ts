import { describe, expect, it } from 'vitest';
import { isStaleBuildError } from './staleBuild';

describe('stale build after an update', () => {
  it('recognises the browsers’ messages for a page file that no longer exists', () => {
    expect(isStaleBuildError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/SettingsPage-DKyh1_Wz.js'))).toBe(true);
    expect(isStaleBuildError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleBuildError(new Error('error loading dynamically imported module'))).toBe(true);
  });
  it('leaves real errors alone', () => {
    expect(isStaleBuildError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});
