import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import { supabase } from '@/lib/supabase';
import { OfflineError, checkIn, invalidText, isNetworkError, resultColour, untilAnswered } from '@/lib/checkin';

describe('check-in results', () => {
  it('green only for a real check-in', () => {
    expect(resultColour({ result: 'success', reason: null })).toBe('green');
    expect(resultColour({ result: 'already_checked_in', reason: null })).toBe('amber');
    expect(resultColour({ result: 'not_eligible', reason: 'unpaid' })).toBe('amber');
    expect(resultColour({ result: 'not_eligible', reason: 'declined' })).toBe('red');
    expect(resultColour({ result: 'invalid', reason: 'other_event' })).toBe('red');
  });
  it('says why a ticket is refused', () => {
    expect(invalidText('other_event')).toMatch(/different event/);
    expect(invalidText('applied')).toMatch(/hasn’t been selected/);
    expect(invalidText(null)).toMatch(/Not a ticket/);
  });
  it('tells a dropped connection from a real answer', () => {
    expect(isNetworkError('TypeError: Failed to fetch')).toBe(true);
    expect(isNetworkError('Load failed')).toBe(true);
    expect(isNetworkError('not_allowed')).toBe(false);
  });
});

describe('with no connection', () => {
  it('retries until the server answers, saying it is waiting', async () => {
    vi.useFakeTimers();
    const rpc = vi.mocked(supabase.rpc);
    rpc.mockReset();
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } } as never)
      .mockResolvedValueOnce({ data: { result: 'success', reason: null, person: null }, error: null } as never);
    const waits: boolean[] = [];
    const p = untilAnswered(() => checkIn('e1', { scan: 'x' }), (w) => waits.push(w));
    await vi.runAllTimersAsync();
    await expect(p).resolves.toMatchObject({ result: 'success' });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([true, true, false]);
    vi.useRealTimers();
  });
  it('never turns a refusal into a retry', async () => {
    const rpc = vi.mocked(supabase.rpc);
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'not_allowed' } } as never);
    await expect(untilAnswered(() => checkIn('e1', { scan: 'x' }), () => {})).rejects.toThrow(/check-in team/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('is an OfflineError when the phone says it is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await expect(checkIn('e1', { scan: 'x' })).rejects.toBeInstanceOf(OfflineError);
    vi.unstubAllGlobals();
  });
});
