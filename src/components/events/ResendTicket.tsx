import { useState } from 'react';
import { Mail } from 'lucide-react';
import { resendTicket } from '@/lib/events';
import { cn } from '@/lib/utils';

/**
 * "Lost your ticket?": email it again. The answer is the same whether or not the email
 * registered, so it never tells anyone who's coming.
 */
export function ResendTicket({ slug, initialEmail = '', className }: { slug: string; initialEmail?: string; className?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const send = async () => {
    if (!valid) return;
    setState('sending');
    const { error } = await resendTicket(slug, email);
    setState(error ? 'error' : 'sent');
  };
  if (state === 'sent') {
    return (
      <p role="status" className={cn('rounded-2xl bg-green-50 px-4 py-3 text-sm text-green-800', className)}>
        If <b>{email.trim()}</b> has a ticket for this event, it’s on its way. Check your inbox (and spam) in a few minutes.
      </p>
    );
  }
  return (
    <form className={cn('flex flex-col gap-2 sm:flex-row', className)} onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <label className="sr-only" htmlFor={`resend-${slug}`}>Your email</label>
      <input id={`resend-${slug}`} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="The email you registered with"
        className="h-12 w-full min-w-0 rounded-full sm:flex-1 border border-navy-100 px-4 text-[16px] text-navy-900 outline-none focus:border-gold-400 focus:ring-4 focus:ring-gold-400/20" />
      <button type="submit" disabled={!valid || state === 'sending'} className="flex h-12 items-center justify-center gap-2 rounded-full bg-navy-800 px-5 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-50">
        <Mail className="h-4 w-4" /> {state === 'sending' ? 'Sending…' : 'Email my ticket'}
      </button>
      {state === 'error' && <p role="alert" className="text-sm text-burgundy-700 sm:basis-full">Something went wrong. Please try again.</p>}
    </form>
  );
}
