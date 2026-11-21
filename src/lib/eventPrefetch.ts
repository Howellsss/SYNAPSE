/*
  Event links open faster: as soon as the first script runs, the event's details (and then its
  poster) start downloading, side by side with the rest of the page's code, instead of after it.
  The page then picks up the answer that's already on its way. Kept free of the Supabase library
  so it runs before that has loaded. Any problem: the page fetches the usual way.
*/

type Kind = 'public_event' | 'public_event_registration';
const pending = new Map<string, Promise<unknown>>();
const keyOf = (kind: Kind, slug: string, type?: string) => `${kind}:${slug}:${type ?? ''}`;

function preloadImage(src: unknown) {
  if (typeof src !== 'string' || !src) return;
  const img = new Image();
  img.decoding = 'async';
  (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'high';
  img.src = src;
}

/** Starts loading the event (or one registration type's page) for a /e/<slug>[/<type>] address. */
export function prefetchEventFor(path: string, url: string, key: string) {
  const m = path.split('?')[0].match(/^\/e\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!m || !url || !key) return;
  const slug = decodeURIComponent(m[1]).toLowerCase();
  if (slug === 'ticket' || slug === 'door') return;
  const type = m[2] ? decodeURIComponent(m[2]).toLowerCase() : undefined;
  const kind: Kind = type ? 'public_event_registration' : 'public_event';
  const body = type ? { p_slug: slug, p_type: type } : { p_slug: slug };
  const p = fetch(`${url}/rest/v1/rpc/${kind}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const d = data as { cover_url?: string; event?: { cover_url?: string } } | null;
      preloadImage(d?.cover_url ?? d?.event?.cover_url);
      return data;
    })
    .catch(() => null);
  pending.set(keyOf(kind, slug, type), p);
}

/** The prefetched answer for this event, once (null when there's none or it failed). */
export async function takePrefetched<T>(kind: Kind, slug: string, type?: string): Promise<T | null> {
  const k = keyOf(kind, slug.toLowerCase(), type?.toLowerCase());
  const p = pending.get(k);
  if (!p) return null;
  pending.delete(k);
  return ((await p) ?? null) as T | null;
}
