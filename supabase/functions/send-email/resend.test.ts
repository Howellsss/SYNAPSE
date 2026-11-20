import { describe, expect, it } from 'vitest';
import { resendBody, resendSend } from './resend';

const mail = { from: 'tickets@deraspeaks.com', fromName: 'Deraspeaks · Ample Room', to: ['ada@example.com'], cc: [], bcc: [], subject: "You're in: UNSCATHED", text: 'Hi Ada', html: '<p>Hi Ada</p>', replyTo: 'hello@deraspeaks.com' };

describe('sending from your own domain (Resend)', () => {
  it('sends the From name with the address, the reply-to, and only what is there', () => {
    expect(resendBody(mail)).toEqual({
      from: 'Deraspeaks · Ample Room <tickets@deraspeaks.com>', to: ['ada@example.com'],
      subject: "You're in: UNSCATHED", text: 'Hi Ada', html: '<p>Hi Ada</p>', reply_to: 'hello@deraspeaks.com',
    });
    expect(resendBody({ ...mail, fromName: 'Bad "<name>"\r\nX', replyTo: null, text: ' ' }).from).toBe('Bad name X <tickets@deraspeaks.com>');
    expect(resendBody({ ...mail, replyTo: null })).not.toHaveProperty('reply_to');
  });
  it('posts to Resend with the key and returns its id', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ id: 're_123' }), { status: 200 }); }) as unknown as typeof fetch;
    await expect(resendSend('re_key', mail, fake)).resolves.toBe('re_123');
    expect(seen!.url).toBe('https://api.resend.com/emails');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer re_key');
  });
  it('says why when it fails, and when the key is missing', async () => {
    const fake = (async () => new Response(JSON.stringify({ message: 'The deraspeaks.com domain is not verified.' }), { status: 403 })) as unknown as typeof fetch;
    await expect(resendSend('re_key', mail, fake)).rejects.toThrow('Resend: The deraspeaks.com domain is not verified.');
    await expect(resendSend(undefined, mail, fake)).rejects.toThrow(/RESEND_API_KEY/);
  });
});
