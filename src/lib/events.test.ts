import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import {
  calendarLinks, countdown, formatPrice, inDateWindow, placeLine, priceFrom, registerErrorText,
  registrationsCsv, slugify, tokenFromScan, zonedToIso, isoToZoned, type Registration,
} from './events';

describe('slugify', () => {
  it('makes a web address from a title', () => {
    expect(slugify('Lagos Jazz & Wine Night 2026!')).toBe('lagos-jazz-and-wine-night-2026');
    expect(slugify('Café Rêve')).toBe('cafe-reve');
  });
  it('never returns something too short', () => {
    expect(slugify('!!')).toBe('event-new');
    expect(slugify('Hi')).toBe('event-hi');
  });
  it('stays within 60 characters without a trailing dash', () => {
    const s = slugify('a'.repeat(59) + ' b c');
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('prices', () => {
  it('formats naira and free', () => {
    expect(formatPrice(0)).toBe('Free');
    expect(formatPrice(500000, 'NGN')).toMatch(/5,000/);
  });
  it('shows the lowest price', () => {
    expect(priceFrom([])).toBe('Free');
    expect(priceFrom([{ price_minor: 0, currency: 'NGN' }, { price_minor: 100, currency: 'NGN' }])).toBe('Free');
    expect(priceFrom([{ price_minor: 900000, currency: 'NGN' }, { price_minor: 300000, currency: 'NGN' }])).toMatch(/^From .*3,000/);
    expect(priceFrom([{ price_minor: 300000, currency: 'NGN' }])).not.toMatch(/From/);
  });
});

describe('inDateWindow', () => {
  const wed = new Date('2026-10-07T10:00:00'); // a Wednesday
  const at = (iso: string, hours = 2) => [new Date(iso).toISOString(), new Date(new Date(iso).getTime() + hours * 3600000).toISOString()] as const;
  it('today', () => {
    expect(inDateWindow(...at('2026-10-07T18:00:00'), 'today', wed)).toBe(true);
    expect(inDateWindow(...at('2026-10-08T18:00:00'), 'today', wed)).toBe(false);
  });
  it('this weekend', () => {
    expect(inDateWindow(...at('2026-10-10T12:00:00'), 'weekend', wed)).toBe(true);
    expect(inDateWindow(...at('2026-10-11T20:00:00'), 'weekend', wed)).toBe(true);
    expect(inDateWindow(...at('2026-10-12T09:00:00'), 'weekend', wed)).toBe(false);
    expect(inDateWindow(...at('2026-10-08T09:00:00'), 'weekend', wed)).toBe(false);
  });
  it('this month and any time', () => {
    expect(inDateWindow(...at('2026-10-30T09:00:00'), 'month', wed)).toBe(true);
    expect(inDateWindow(...at('2026-11-02T09:00:00'), 'month', wed)).toBe(false);
    expect(inDateWindow(...at('2030-01-01T09:00:00'), 'any', wed)).toBe(true);
  });
});

describe('countdown', () => {
  it('splits the time left', () => {
    const now = Date.parse('2026-10-01T00:00:00Z');
    expect(countdown('2026-10-02T03:04:05Z', now)).toEqual({ done: false, days: 1, hours: 3, minutes: 4, seconds: 5 });
    expect(countdown('2026-09-01T00:00:00Z', now).done).toBe(true);
  });
});

describe('tokenFromScan', () => {
  it('reads the token from a ticket link or bare token', () => {
    const t = '3f2b1c4d-1111-4abc-9def-0123456789ab';
    expect(tokenFromScan(`https://synapse.app/e/ticket/${t}`)).toBe(t);
    expect(tokenFromScan(t.toUpperCase())).toBe(t);
    expect(tokenFromScan('hello')).toBeNull();
  });
});

describe('placeLine', () => {
  it('describes where', () => {
    expect(placeLine({ mode: 'online', venue_name: 'X', city: 'Y' })).toBe('Online');
    expect(placeLine({ mode: 'in_person', venue_name: 'Muri Okunola Park', city: 'Lagos' })).toBe('Muri Okunola Park, Lagos');
    expect(placeLine({ mode: 'hybrid', venue_name: '', city: 'Abuja' })).toBe('Abuja + online');
    expect(placeLine({ mode: 'in_person', venue_name: '', city: '' })).toBe('Venue to be announced');
  });
});

describe('calendarLinks', () => {
  it('builds Google and .ics', () => {
    const { google, ics } = calendarLinks({
      title: 'Jazz, Wine; Night', summary: 'Live band', slug: 'jazz', mode: 'in_person', venue_name: 'Hall', address: '1 Road', city: 'Lagos',
      starts_at: '2026-10-10T18:00:00Z', ends_at: '2026-10-10T21:00:00Z',
    }, 'https://x.app');
    expect(google).toContain('dates=20261010T180000Z/20261010T210000Z');
    expect(ics).toContain('SUMMARY:Jazz\\, Wine\\; Night');
    expect(ics).toContain('URL:https://x.app/e/jazz');
    expect(ics).toContain('LOCATION:Hall\\, 1 Road\\, Lagos');
  });
});

describe('registrationsCsv', () => {
  it('exports attendees with answers and guards formulas', () => {
    const reg: Registration = {
      id: 'r', event_id: 'e', ticket_id: 't', contact_id: null, first_name: '=HYPERLINK("x")', last_name: 'Doe, Jr', email: 'a@b.co', phone: '',
      answers: { q1: 'Vegan', q2: true }, pin: '012345', qr_token: 'tok', status: 'confirmed', payment_status: 'free', amount_minor: 0,
      checked_in_at: null, created_at: '2026-10-01T00:00:00Z',
    };
    const csv = registrationsCsv([reg], [{ id: 't', name: 'VIP', description: '', price_minor: 0, currency: 'NGN', capacity: null }],
      [{ id: 'q1', label: 'Diet', type: 'text', required: false }, { id: 'q2', label: 'Newsletter', type: 'checkbox', required: false }]);
    const [head, row] = csv.split('\n');
    expect(head).toBe('First name,Last name,Email,Phone,Ticket,Payment,PIN,Checked in,Registered,Diet,Newsletter');
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain('"Doe, Jr"');
    expect(row).toContain('VIP,free,012345');
    expect(row.endsWith('Vegan,Yes')).toBe(true);
  });
});

describe('registerErrorText', () => {
  it('turns database errors into plain words', () => {
    expect(registerErrorText('sold_out')).toMatch(/sold out/);
    expect(registerErrorText('already_registered')).toMatch(/already registered/);
    expect(registerErrorText('weird')).toMatch(/try again/);
  });
});

describe('time zones', () => {
  it('turns wall time in a zone into an instant and back', () => {
    expect(zonedToIso('2026-10-10T18:00', 'Africa/Lagos')).toBe('2026-10-10T17:00:00.000Z');
    expect(zonedToIso('2026-07-01T09:30', 'America/New_York')).toBe('2026-07-01T13:30:00.000Z');
    expect(zonedToIso('2026-01-15T09:30', 'America/New_York')).toBe('2026-01-15T14:30:00.000Z');
    expect(isoToZoned('2026-10-10T17:00:00.000Z', 'Africa/Lagos')).toBe('2026-10-10T18:00');
    expect(isoToZoned('2026-07-01T13:30:00Z', 'America/New_York')).toBe('2026-07-01T09:30');
    expect(zonedToIso('nope', 'UTC')).toBe('');
  });
});
