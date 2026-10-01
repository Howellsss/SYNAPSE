import { useEffect, useRef } from 'react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Shown in tooltips. */
export const SHORTCUTS = { mic: isMac ? '⌘+Shift+A' : 'Ctrl+Shift+A', cam: isMac ? '⌘+Shift+V' : 'Ctrl+Shift+V' };

/** Which call shortcut a key press is, if any. */
export function callShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): 'mic' | 'cam' | null {
  if (!e.shiftKey || e.altKey || !(e.ctrlKey || e.metaKey)) return null;
  const k = e.code === 'KeyA' || e.key.toLowerCase() === 'a' ? 'a' : e.code === 'KeyV' || e.key.toLowerCase() === 'v' ? 'v' : null;
  return k === 'a' ? 'mic' : k === 'v' ? 'cam' : null;
}

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * Ctrl/Cmd+Shift+A toggles the mic, Ctrl/Cmd+Shift+V the camera.
 * Ignored while typing, so "paste as plain text" (Ctrl/Cmd+Shift+V) still works in text boxes.
 */
export function useCallShortcuts(actions: { mic: () => void; cam: () => void }) {
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const which = callShortcut(e);
      if (!which || e.repeat || isEditable(e.target)) return;
      e.preventDefault();
      ref.current[which]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
