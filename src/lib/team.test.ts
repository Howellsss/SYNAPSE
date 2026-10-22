import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { invitationLinksCsv, matchDepartment, memberName, parseInvites, splitCsvLine } from './team';

const defaults = { role: 'member' as const, department: '' };

describe('splitCsvLine', () => {
  it('splits on commas, semicolons and tabs', () => {
    expect(splitCsvLine('a, b;c\td')).toEqual(['a', 'b', 'c', 'd']);
  });
  it('keeps commas and escaped quotes inside quotes', () => {
    expect(splitCsvLine('"Smith, Jane","say ""hi""",x')).toEqual(['Smith, Jane', 'say "hi"', 'x']);
  });
});

describe('parseInvites', () => {
  it('reads a plain list of emails in any separator', () => {
    const r = parseInvites('a@x.com, b@x.com\n<c@x.com>; d@x.com', defaults);
    expect(r.rows.map((x) => x.email)).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
    expect(r.rows.every((x) => x.role === 'member')).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it('reads a CSV with a header in any order and synonym columns', () => {
    const csv = [
      'Job Title,Team,E-mail,Role',
      'Video Editor,Video,jane@x.com,expert',
      '"Lead, Tech",Tech,sam@x.com,Manager',
      ',,ada@x.com,administrator',
      'Writer,,bo@x.com,whatever',
    ].join('\r\n');
    const r = parseInvites(csv, { role: 'member', department: 'General' });
    expect(r.rows).toEqual([
      { email: 'jane@x.com', role: 'member', department: 'Video', title: 'Video Editor' },
      { email: 'sam@x.com', role: 'member', department: 'Tech', title: 'Lead, Tech' },
      { email: 'ada@x.com', role: 'admin', department: 'General', title: '' },
      { email: 'bo@x.com', role: 'member', department: 'General', title: 'Writer' },
    ]);
  });

  it('drops duplicates (case-insensitive) and reports invalid emails with line numbers', () => {
    const r = parseInvites('email\nA@x.com\na@x.com\nnot-an-email\n\n', defaults);
    expect(r.rows.map((x) => x.email)).toEqual(['a@x.com']);
    expect(r.problems).toEqual([
      { line: 3, text: 'a@x.com', reason: 'Listed twice' },
      { line: 4, text: 'not-an-email', reason: 'Not a valid email address' },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseInvites('  \n ', defaults)).toEqual({ rows: [], problems: [] });
  });
});

describe('matchDepartment', () => {
  const depts = [{ id: '1', name: 'Video Team' }, { id: '2', name: 'Tech' }];
  it('ignores case and extra spaces', () => {
    expect(matchDepartment(depts, '  video   team ')).toBe('1');
    expect(matchDepartment(depts, 'TECH')).toBe('2');
  });
  it('returns null when missing or blank', () => {
    expect(matchDepartment(depts, 'Sales')).toBeNull();
    expect(matchDepartment(depts, ' ')).toBeNull();
  });
});

describe('memberName and invitationLinksCsv', () => {
  it('falls back to email then a placeholder', () => {
    expect(memberName({ first_name: 'Ada', last_name: null, email: 'a@x.com' })).toBe('Ada');
    expect(memberName({ first_name: null, last_name: null, email: 'a@x.com' })).toBe('a@x.com');
    expect(memberName({ first_name: null, last_name: null, email: null })).toBe('Unnamed member');
  });
  it('quotes values that need it', () => {
    expect(invitationLinksCsv([{ email: 'a@x.com', role: 'member', link: 'https://s/a?x=1,2' }]))
      .toBe('email,role,invite link\na@x.com,member,"https://s/a?x=1,2"');
  });
});
