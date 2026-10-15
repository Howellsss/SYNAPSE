import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ArrowRightStartOnRectangleIcon, Cog6ToothIcon, HomeIcon } from '@heroicons/react/24/solid';
import { isNavActive, navGroups } from './nav';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { usePlatformAdmin } from '@/lib/platformAdmin';
import { Avatar } from '@/components/ui/Avatar';

interface SidebarProps {
  currentPath: string;
  onNavigate: (to: string) => void;
  /** Shown (slid in from the left), or tucked away with the features in the bottom dock. */
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ currentPath, onNavigate, open, onClose }: SidebarProps) {
  const { profile, signOut, role } = useAuth();
  // The character library is managed by SYNAPSE admins only.
  const isPlatformAdmin = usePlatformAdmin() === true;

  const handleNavigate = (path: string) => {
    onNavigate(path);
    // On a phone the menu covers the page: close it once you've picked somewhere.
    if (window.matchMedia('(max-width: 1023px)').matches) onClose();
  };

  const isActive = (path: string) => isNavActive(currentPath, path);

  const item = (label: string, Icon: typeof HomeIcon, path: string) => {
    const active = isActive(path);
    return (
      <button
        key={path}
        onClick={() => handleNavigate(path)}
        aria-current={active ? 'page' : undefined}
        className={cn('nav-item w-full', active && 'nav-item-active')}
      >
        <Icon aria-hidden="true" className={cn('h-5 w-5 shrink-0', active ? 'text-gold-400' : 'text-navy-700')} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <>
      {/* On a phone the menu covers the page: tap outside to close it. */}
      {open && (
        <div className="lg:hidden fixed inset-0 bg-navy-900/40 z-[55] animate-backdrop-in" onClick={onClose} />
      )}

      <aside
        aria-label="Main"
        aria-hidden={!open}
        className={cn(
          'fixed left-0 top-0 bottom-0 w-[240px] bg-white border-r border-navy-100 z-[60] flex flex-col overflow-y-auto transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
          open ? 'translate-x-0 shadow-popover lg:shadow-none' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-navy-100 px-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-navy-800 flex items-center justify-center">
              <HowellsLogo className="w-[18px] h-[18px]" />
            </div>
            <span className="text-[14px] font-bold tracking-[0.12em] text-navy-800">SYNAPSE</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            title="Close menu (features stay in the bar at the bottom)"
            className="w-8 h-8 rounded-full flex items-center justify-center bg-navy-800 text-gold-300 hover:bg-navy-700"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 pt-3">
          {navGroups.map((group, i) => (
            <div key={i} className={cn('space-y-0.5', i > 0 && 'mt-3 border-t border-navy-100 pt-3')}>
              {group.filter((n) => n.path !== '/characters' || isPlatformAdmin).map((n) => item(n.label, n.icon, n.path))}
            </div>
          ))}
        </nav>

        {/* Settings, then you */}
        <div className="px-3 pt-3 pb-3 space-y-0.5 border-t border-navy-100">
          {item('Settings', Cog6ToothIcon, '/settings')}
          <div className="mt-2 flex items-center gap-3 border-t border-navy-100 px-2 pt-3">
            <Avatar firstName={profile?.first_name} lastName={profile?.last_name} src={profile?.avatar_url} size="sm" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[13px] font-semibold text-navy-800 truncate">{profile?.first_name || 'User'} {profile?.last_name || ''}</p>
              <p className="text-xs font-medium text-ivory-700 capitalize">{role || 'Member'}</p>
            </div>
            <button
              onClick={() => signOut()}
              aria-label="Sign out"
              title="Sign out"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-navy-700 hover:bg-navy-50 hover:text-burgundy-500"
            >
              <ArrowRightStartOnRectangleIcon className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

/** The SYNAPSE mark: three connected nodes, like a synapse. Gold, for a navy tile. */
export function HowellsLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="#E4A93C" strokeWidth="2.2" strokeLinecap="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.3 11 15.7 7M8.3 13l7.4 4" />
    </svg>
  );
}

export { ChevronRight };
