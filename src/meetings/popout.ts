/**
 * A small window that stays on top of every tab (Chrome and Edge's Document Picture-in-Picture),
 * so a presenter can keep annotating their shared screen while they work in the tab they share.
 */

interface DocumentPip {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

export function documentPip(): DocumentPip | null {
  return (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture ?? null;
}

/** Open the always-on-top window with this page's styles, or null where browsers can't. */
export async function openPopout(width = 720, height = 450): Promise<Window | null> {
  const pip = documentPip();
  if (!pip) return null;
  pip.window?.close();
  const w = await pip.requestWindow({ width, height });
  for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
    const copy = node.cloneNode(true) as HTMLElement;
    // Full addresses: the new window has no page address of its own to resolve against.
    if (node instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = node.href;
    w.document.head.appendChild(copy);
  }
  w.document.title = 'Annotate — SYNAPSE';
  w.document.documentElement.style.height = '100%';
  Object.assign(w.document.body.style, { margin: '0', height: '100%', background: '#0D1C3B', overflow: 'hidden' });
  return w;
}
