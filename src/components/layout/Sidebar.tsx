import { useState } from 'react';
import {
  Calendar, ChevronRight, FileText, FolderOpen, Home, Inbox, LayoutGrid, LogOut, Menu, Mic, MonitorPlay,
  SlidersHorizontal, Sparkles, Ticket, User, Video, Workflow, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { Avatar } from '@/components/ui/Avatar';

interface SidebarProps {
  currentPath: string;
  onNavigate: (to: string) => void;
}

// Everyday places first, then tools: the arrangement from the redesign.
const navGroups = [
  [
    { label: 'Dashboard', icon: Home, path: '/dashboard' },
    { label: 'Conversations', icon: Inbox, path: '/conversations' },
    { label: 'Contacts', icon: User, path: '/contacts' },
    { label: 'Calendars', icon: Calendar, path: '/calendars' },
    { label: 'Meetings', icon: Video, path: '/meetings' },
    { label: 'Workspaces', icon: LayoutGrid, path: '/workspace' },
    { label: 'Events', icon: Ticket, path: '/events' },
  ],
  [
    { label: 'Webinars', icon: MonitorPlay, path: '/webinars' },
    { label: 'Submissions', icon: FileText, path: '/forms' },
    { label: 'Workflows', icon: Workflow, path: '/workflows' },
    { label: 'Recordings', icon: Mic, path: '/recordings' },
    { label: 'Media Library', icon: FolderOpen, path: '/media-library' },
    { label: 'AI Hub', icon: Sparkles, path: '/ai-hub' },
  ],
];

export function Sidebar({ currentPath, onNavigate }: SidebarProps) {
  const { profile, signOut, role } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNavigate = (path: string) => {
    onNavigate(path);
    setMobileOpen(false);
  };

  const isActive = (path: string) =>
    currentPath === path || currentPath.startsWith(path + '/') || (path === '/dashboard' && currentPath === '/') || (path === '/workspace' && currentPath.startsWith('/workspaces'));

  const item = (label: string, Icon: typeof Home, path: string) => {
    const active = isActive(path);
    return (
      <button
        key={path}
        onClick={() => handleNavigate(path)}
        aria-current={active ? 'page' : undefined}
        className={cn('nav-item w-full', active && 'nav-item-active')}
      >
        <Icon className={cn('h-[18px] w-[18px] shrink-0 stroke-[1.8]', active ? 'text-gold-600' : 'text-ivory-700')} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3.5 left-3 z-50 w-10 h-10 rounded-full bg-white/90 text-navy-800 border border-sand flex items-center justify-center backdrop-blur"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-navy-900/40 z-40 animate-backdrop-in" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        aria-label="Main"
        className={cn(
          'fixed left-0 top-0 bottom-0 w-[240px] bg-paper border-r border-sand z-40 flex flex-col overflow-y-auto transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-6 pt-6 pb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[9px] bg-navy-800 flex items-center justify-center">
              <HowellsLogo className="w-[18px] h-[18px]" />
            </div>
            <span className="text-[13px] font-semibold tracking-[0.14em] text-navy-800">SYNAPSE</span>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="lg:hidden w-8 h-8 rounded-full flex items-center justify-center text-ivory-700 hover:bg-sand/60"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="px-3 flex-1 space-y-6">
          {navGroups.map((group, i) => (
            <div key={i} className="space-y-1">
              {group.map((n) => item(n.label, n.icon, n.path))}
            </div>
          ))}
        </nav>

        {/* Settings, then you */}
        <div className="px-3 pt-6 pb-4 space-y-1">
          {item('Settings', SlidersHorizontal, '/settings')}
          <div className="mt-3 flex items-center gap-3 border-t border-sand px-3 pt-4">
            <Avatar firstName={profile?.first_name} lastName={profile?.last_name} src={profile?.avatar_url} size="sm" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[13px] font-semibold text-navy-800 truncate">{profile?.first_name || 'User'} {profile?.last_name || ''}</p>
              <p className="text-xs text-ivory-700 capitalize">{role || 'Member'}</p>
            </div>
            <button
              onClick={() => signOut()}
              aria-label="Sign out"
              title="Sign out"
              className="w-8 h-8 rounded-full flex items-center justify-center text-ivory-700 hover:bg-sand/60 hover:text-burgundy-500"
            >
              <LogOut className="w-4 h-4" />
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
