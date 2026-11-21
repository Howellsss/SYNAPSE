/*
  Event pages live at the top of the site: synapseconnector.com/<event> (and /<event>/<type> for a
  registration type's form). Older links with /e/ in front still open, and are tidied to the short
  address. Words the app itself uses (dashboard, events, signin, …) can never be an event's address.
*/

/** First parts of an address that belong to the app, never to an event. */
export const RESERVED_SLUGS = new Set([
  'e', 'api', 'assets', 'events', 'landing',
  'dashboard', 'signin', 'signup', 'reset-password', 'contacts', 'calendars', 'forms', 'f', 'workflows',
  'recordings', 'characters', 'ai-hub', 'settings', 'rooms', 'streams', 'meetings', 'webinars',
  'conversations', 'media-library', 'workspace', 'workspaces', 'book', 'group', 'invite', 'join', 'live',
  'check-in', 'ticket', 'door', 'new', 'admin', 'about', 'help', 'login', 'logout', 'register',
]);

export const isReservedSlug = (slug: string) => RESERVED_SLUGS.has(slug.toLowerCase());

/**
 * "/unscathed" → "/e/unscathed", "/unscathed/register?x" → "/e/unscathed/register?x";
 * anything that isn't an event address → null.
 */
export function eventRootPath(path: string): string | null {
  const [p, q] = path.split('?');
  const m = p.match(/^\/([A-Za-z0-9-]+)(?:\/([A-Za-z0-9-]+))?\/?$/);
  if (!m || isReservedSlug(m[1])) return null;
  return `/e/${m[1]}${m[2] ? `/${m[2]}` : ''}${q !== undefined ? `?${q}` : ''}`;
}

/** The events-section path for any address the public events pages answer, else null. */
export function publicEventsPath(path: string): string | null {
  if (path === '/e' || path.startsWith('/e/') || path.startsWith('/e?')) return path;
  return eventRootPath(path);
}

/** "/e/unscathed[/register]" → "/unscathed[/register]" (tickets and door passes keep /e/). */
export function shortEventPath(path: string): string | null {
  const [p, q] = path.split('?');
  const m = p.match(/^\/e\/([A-Za-z0-9-]+)(?:\/([A-Za-z0-9-]+))?\/?$/);
  if (!m || isReservedSlug(m[1])) return null;
  return `/${m[1]}${m[2] ? `/${m[2]}` : ''}${q !== undefined ? `?${q}` : ''}`;
}
