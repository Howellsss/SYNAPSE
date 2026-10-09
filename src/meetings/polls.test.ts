import { describe, expect, it } from 'vitest';
import { cleanPicks, makePoll, parsePollMsg, percent, tally } from './polls';

describe('polls', () => {
  const poll = makePoll('p1', '  Which day?  ', ['Mon', ' ', 'Tue', 'Wed'], false)!;

  it('tidies the question and drops empty options; needs two options', () => {
    expect(poll).toEqual({ id: 'p1', q: 'Which day?', options: ['Mon', 'Tue', 'Wed'], multi: false });
    expect(makePoll('p', 'Q', ['only one', ''], false)).toBeNull();
    expect(makePoll('p', ' ', ['a', 'b'], false)).toBeNull();
  });

  it('counts one vote per person, latest answer wins; single choice keeps one pick', () => {
    const r = tally(poll, { a: [0], b: [2, 1], c: [9], d: [1] });
    expect(r).toEqual({ id: 'p1', counts: [1, 2, 0], voters: 3, closed: false });
    expect(cleanPicks(poll, [2, 1])).toEqual([1]);
    const multi = { ...poll, multi: true };
    expect(tally(multi, { a: [0, 1], b: [1, 1] }).counts).toEqual([1, 2, 0]);
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBe(0);
  });

  it('accepts only well-formed messages', () => {
    expect(parsePollMsg({ t: 'poll', poll })).toEqual({ t: 'poll', poll });
    expect(parsePollMsg({ t: 'poll', poll: { ...poll, id: 'bad id!' } })).toBeNull();
    expect(parsePollMsg({ t: 'vote', id: 'p1', picks: [1, 1, 'x', -1, 2.5] })).toEqual({ t: 'vote', id: 'p1', picks: [1] });
    expect(parsePollMsg({ t: 'vote', id: 'p1', picks: [] })).toBeNull();
    expect(parsePollMsg({ t: 'results', results: { id: 'p1', counts: [1, 2], voters: 2, closed: true } })).toEqual({ t: 'results', results: { id: 'p1', counts: [1, 2], voters: 2, closed: true } });
    expect(parsePollMsg({ t: 'results', results: { id: 'p1', counts: [-1], voters: 2 } })).toBeNull();
    expect(parsePollMsg({ t: 'end', id: 'p1' })).toEqual({ t: 'end', id: 'p1' });
    expect(parsePollMsg('nope')).toBeNull();
  });
});
