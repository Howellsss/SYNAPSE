import { useEffect, useState } from 'react';
import { AWAY_AFTER_MS } from './protocol';

const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/** True after `after` ms with the tab hidden or no keyboard/mouse/touch activity. */
export function useAway(after = AWAY_AFTER_MS): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    let timer = 0;
    let last = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAway(true), after);
    };
    const active = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - last < 1000) return; // pointermove fires a lot
      last = now;
      setAway(false);
      arm();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') { last = 0; active(); } else arm(); };
    ACTIVITY.forEach((e) => window.addEventListener(e, active, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    arm();
    return () => {
      window.clearTimeout(timer);
      ACTIVITY.forEach((e) => window.removeEventListener(e, active));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [after]);
  return away;
}
