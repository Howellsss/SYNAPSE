import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { Cog6ToothIcon } from '@heroicons/react/24/solid';
import { cn } from '@/lib/utils';
import { usePlatformAdmin } from '@/lib/platformAdmin';
import { isNavActive, navGroups } from './nav';

/** Height of the strip the dock sits in (the page or workspace stops above it). */
export const DOCK_STRIP = 'h-[60px]';

/**
 * Every feature, as small icons along the bottom of the screen, so whatever you're in fills the
 * screen above. The arrow at the start opens the full menu from the left.
 */
export function FeatureDock({ currentPath, onNavigate, onOpenMenu, dark = false }: {
  currentPath: string;
  onNavigate: (to: string) => void;
  onOpenMenu: () => void;
  /** Under a workspace: navy, like the world's controls. */
  dark?: boolean;
}) {
  const isPlatformAdmin = usePlatformAdmin() === true;
  const groups = [...navGroups.map((g) => g.filter((n) => n.path !== '/characters' || isPlatformAdmin)), [{ label: 'Settings', icon: Cog6ToothIcon, path: '/settings' }]];
  const btn = (active: boolean) => cn(
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400',
    active
      ? 'bg-gold-400 text-navy-900'
      : dark ? 'text-white/75 hover:bg-white/10 hover:text-white' : 'text-navy-700 hover:bg-navy-50',
  );
  return (
    <nav
      aria-label="Features"
      className={cn(
        'flex max-w-[calc(100vw-16px)] items-center gap-0.5 overflow-x-auto rounded-2xl p-1 shadow-popover [scrollbar-width:none]',
        dark ? 'bg-navy-900/95 ring-1 ring-white/10' : 'bg-white ring-1 ring-navy-100',
      )}
    >
      <button type="button" onClick={onOpenMenu} aria-label="Open menu" title="Open menu" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-800 text-gold-300 hover:bg-navy-700">
        <ChevronRight className="h-4 w-4" />
      </button>
      {groups.map((g, i) => (
        <Fragment key={i}>
          <span aria-hidden="true" className={cn('mx-1 h-5 w-px shrink-0', dark ? 'bg-white/15' : 'bg-navy-100')} />
          {g.map(({ label, icon: Icon, path }) => {
            const active = isNavActive(currentPath, path);
            return (
              <button key={path} type="button" onClick={() => onNavigate(path)} aria-label={label} title={label} aria-current={active ? 'page' : undefined} className={btn(active)}>
                <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
              </button>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}
