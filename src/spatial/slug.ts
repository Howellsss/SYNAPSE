/** Links look like synapse.app/<slug>, so slugs share one namespace with the app's own pages. */
export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

/** Words a space can't use as its link because the app (or common pages) already use them. */
export const RESERVED_SLUGS = new Set([
  'admin', 'ai-hub', 'api', 'app', 'auth', 'book', 'calendars', 'contacts', 'conversations',
  'dashboard', 'events', 'forms', 'group', 'help', 'invite', 'login', 'logout', 'media-library',
  'meetings', 'new', 'recordings', 'reset-password', 'settings', 'signin', 'signup', 'support',
  'synapse', 'webinars', 'workflows', 'workspace', 'workspaces', 'www',
]);

/**
 * Turn a workspace name into a link-safe slug: lowercase ASCII letters, digits and
 * single hyphens. Accents are dropped ("Café" → "cafe"), other symbols removed.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

export type SlugProblem = 'empty' | 'too_short' | 'too_long' | 'format' | 'reserved';

/** Why a slug can't be used, or null if its shape is fine (availability is checked separately). */
export function slugProblem(slug: string): SlugProblem | null {
  if (!slug) return 'empty';
  if (slug.length < SLUG_MIN) return 'too_short';
  if (slug.length > SLUG_MAX) return 'too_long';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return 'format';
  if (RESERVED_SLUGS.has(slug)) return 'reserved';
  return null;
}

export const SLUG_PROBLEM_TEXT: Record<SlugProblem, string> = {
  empty: 'Add a link for your workspace.',
  too_short: `Use at least ${SLUG_MIN} characters.`,
  too_long: `Use ${SLUG_MAX} characters or fewer.`,
  format: 'Use lowercase letters, numbers and single hyphens.',
  reserved: 'That word is reserved. Try another.',
};
