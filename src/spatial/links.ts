/** Public-facing form of a workspace link, as shown in the wizard. */
export function displaySpaceLink(slug: string): string {
  return `synapse.app/${slug}`;
}

/** Link that opens the workspace in this deployment of the app. */
export function spaceUrl(slug: string, origin = window.location.origin): string {
  return `${origin}/#/workspace/${slug}`;
}

/**
 * Reads what someone pasted into "Join with invite link": a team invite
 * (…/invite/<token>), an app workspace link (…#/workspace/<slug>) or synapse.app/<slug>.
 */
export function parseJoinLink(input: string): { token: string } | { slug: string } | null {
  const text = input.trim();
  const invite = text.match(/\/invite\/([A-Za-z0-9]+)/);
  if (invite) return { token: invite[1] };
  const space = text.match(/workspace\/([a-z0-9-]+)/);
  if (space && space[1] !== 'new') return { slug: space[1] };
  const bare = text.match(/^(?:https?:\/\/)?synapse\.app\/([a-z0-9-]+)\/?$/);
  if (bare) return { slug: bare[1] };
  return null;
}
