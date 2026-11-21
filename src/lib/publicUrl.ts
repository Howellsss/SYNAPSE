/**
 * The address to put in links people share (meeting invites, booking pages, forms, events…).
 *
 * Vercel protects its per-deployment addresses (synapse-dj3a-abc123-team.vercel.app,
 * synapse-dj3a-git-branch-team.vercel.app) behind a Vercel login, so a link built from one of
 * those makes guests "log in to Vercel". Shared links always use the public address instead:
 * VITE_PUBLIC_APP_URL when it's set, otherwise the production address: synapseconnector.com
 * (the old synapse-dj3a.vercel.app forwards there, so links sent before the move keep working).
 */
export const PRODUCTION_URL = 'https://synapseconnector.com';

export function publicOrigin(
  current = typeof window !== 'undefined' ? window.location.origin : '',
  configured: string | undefined = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined,
): string {
  const set = (configured ?? '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[^/\s]+$/i.test(set)) return set;
  let host = '';
  try { host = new URL(current).hostname; } catch { return PRODUCTION_URL; }
  // Every *.vercel.app address is either a deployment preview (which asks visitors to log into Vercel)
  // or the old address that now forwards to the domain: shared links use the domain.
  if (host.endsWith('.vercel.app')) return PRODUCTION_URL;
  return current || PRODUCTION_URL;
}
