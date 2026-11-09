import { useEffect, useState } from 'react';
import type { Viewport } from '@/lib/form-builder-types';

/** Phone under 768px, tablet up to 1023px, desktop beyond; kept up to date as the window changes. */
export function useViewport(): Viewport {
  const pick = (): Viewport => (window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop');
  const [v, setV] = useState<Viewport>(pick);
  useEffect(() => {
    const on = () => setV(pick());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}
