import { useState, useEffect, useCallback } from 'react';
import { publicEventsPath } from './eventPaths';

function getCurrentPath(): string {
  const hash = window.location.hash.slice(1);
  if (hash) return hash;
  const path = window.location.pathname;
  if (path && path !== '/') return path;
  return '/dashboard';
}

export function useRouter(): [string, (to: string) => void] {
  const [path, setPath] = useState(getCurrentPath);

  useEffect(() => {
    const handler = () => setPath(getCurrentPath());
    window.addEventListener('hashchange', handler);
    window.addEventListener('popstate', handler);
    return () => {
      window.removeEventListener('hashchange', handler);
      window.removeEventListener('popstate', handler);
    };
  }, []);

  const navigate = useCallback((to: string) => {
    if (to.startsWith('/book/') || to.startsWith('/group/') || to.startsWith('/invite/') || to.startsWith('/join/')) {
      window.location.href = to;
      return;
    }
    // Event pages get a clean address (synapseconnector.com/unscathed), not a #… one.
    if (publicEventsPath(to)) {
      window.history.pushState(null, '', to);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    window.location.hash = to;
  }, []);

  return [path, navigate];
}
