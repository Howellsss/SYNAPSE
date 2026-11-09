import { describe, expect, it } from 'vitest';
import { DIAL, dialCountries, flagOf, joinPhone, splitPhone } from './phone';

describe('phone numbers with a country code', () => {
  it('knows the common codes', () => {
    expect(DIAL.NG).toBe('234');
    expect(DIAL.GB).toBe('44');
    expect(DIAL.US).toBe('1');
    expect(DIAL.GH).toBe('233');
    expect(dialCountries().find((c) => c.iso === 'NG')?.dial).toBe('234');
  });
  it('saves the code with the number, dropping the leading 0', () => {
    expect(joinPhone('NG', '0803 123 4567')).toBe('+234 803 123 4567');
    expect(joinPhone('GB', '7700 900123')).toBe('+44 7700 900123');
    expect(joinPhone('NG', '+44 7700 900123')).toBe('+44 7700 900123');
    expect(joinPhone('NG', '  ')).toBe('');
  });
  it('reads a saved answer back', () => {
    expect(splitPhone('+234 803 123 4567', 'NG')).toEqual({ iso: 'NG', number: '803 123 4567' });
    expect(splitPhone('+44 7700 900123', 'NG')).toEqual({ iso: 'GB', number: '7700 900123' });
    expect(splitPhone('+1 202 555 0100', 'CA')).toEqual({ iso: 'CA', number: '202 555 0100' });
    expect(splitPhone('0803', 'NG')).toEqual({ iso: 'NG', number: '0803' });
  });
  it('draws flags', () => { expect(flagOf('ng')).toBe('🇳🇬'); });
});
