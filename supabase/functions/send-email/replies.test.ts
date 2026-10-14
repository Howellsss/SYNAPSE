import { describe, expect, it } from 'vitest';
import { newReplies, parseFrom, replyRow, replyText, stripQuoted, type GmailMessage } from './replies';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const msg = (id: string, from: string, text: string, labels: string[] = ['INBOX']): GmailMessage => ({
  id, threadId: 't1', internalDate: '1791999000000', labelIds: labels,
  payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: from }, { name: 'Subject', value: 'Re: Your quote' }], parts: [{ mimeType: 'text/plain', body: { data: b64(text) } }, { mimeType: 'text/html', body: { data: b64('<p>x</p>') } }] },
});

describe('email replies', () => {
  it('reads names and addresses', () => {
    expect(parseFrom('"Jane Doe" <Jane@X.com>')).toEqual({ name: 'Jane Doe', email: 'jane@x.com' });
    expect(parseFrom('jane@x.com')).toEqual({ name: null, email: 'jane@x.com' });
  });
  it('keeps only the new words of a reply', () => {
    expect(stripQuoted('Sounds good, see you Tuesday.\n\nOn Mon, 12 Oct 2026 at 10:00, Ama <ama@hl.com> wrote:\n> Shall we meet?')).toBe('Sounds good, see you Tuesday.');
    expect(stripQuoted('Yes\n> earlier\n> more')).toBe('Yes');
    expect(stripQuoted('Thanks\n-----Original Message-----\nFrom: x')).toBe('Thanks');
  });
  it('finds replies from others that are not saved yet', () => {
    const thread = [msg('a', 'Ama <ama@hl.com>', 'Our quote', ['SENT']), msg('b', 'Jane <jane@x.com>', 'Thanks!'), msg('c', 'Jane <jane@x.com>', 'One more thing')];
    expect(newReplies(thread, 'ama@hl.com', new Set(['b'])).map((m) => m.id)).toEqual(['c']);
  });
  it('makes an inbound message on the same contact', () => {
    const row = replyRow(msg('c', 'Jane <jane@x.com>', 'Thanks!\n\nOn Mon Ama wrote:\n> hi'), { workspace_id: 'ws', contact_id: 'ct', email_account_id: 'ea', subject: 'Your quote' }, 'ama@hl.com');
    expect(row).toMatchObject({ direction: 'inbound', contact_id: 'ct', body: 'Thanks!', from_email: 'jane@x.com', from_name: 'Jane', provider_message_id: 'c', provider_thread_id: 't1', subject: 'Re: Your quote' });
    expect(replyText(msg('d', 'x', 'plain'))).toBe('plain');
  });
});
