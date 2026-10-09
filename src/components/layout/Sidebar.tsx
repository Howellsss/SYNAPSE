import { useState } from 'react';
import { ChevronRight, Menu, X } from 'lucide-react';
import {
  ArrowRightStartOnRectangleIcon, BoltIcon, CubeIcon, CalendarDaysIcon, ChatBubbleLeftRightIcon, Cog6ToothIcon, DocumentTextIcon,
  FolderIcon, HomeIcon, MicrophoneIcon, PresentationChartBarIcon, SparklesIcon, Squares2X2Icon, TicketIcon, UserIcon, VideoCameraIcon,
} from '@heroicons/react/24/solid';
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
    { label: 'Dashboard', icon: HomeIcon, path: '/dashboard' },
    { label: 'Conversations', icon: ChatBubbleLeftRightIcon, path: '/conversations' },
    { label: 'Contacts', icon: UserIcon, path: '/contacts' },
    { label: 'Calendars', icon: CalendarDaysIcon, path: '/calendars' },
    { label: 'Meetings', icon: VideoCameraIcon, path: '/meetings' },
    { label: 'Workspaces', icon: Squares2X2Icon, path: '/workspace' },
    { label: 'Events', icon: TicketIcon, path: '/events' },
  ],
  [
    { label: 'Webinars', icon: PresentationChartBarIcon, path: '/webinars' },
    { label: 'Submissions', icon: DocumentTextIcon, path: '/forms' },
    { label: 'Workflows', icon: BoltIcon, path: '/workflows' },
    { label: 'Recordings', icon: MicrophoneIcon, path: '/recordings' },
    { label: 'Characters', icon: CubeIcon, path: '/characters' },
    { label: 'Media Library', icon: FolderIcon, path: '/media-library' },
    { label: 'AI Hub', icon: SparklesIcon, path: '/ai-hub' },
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
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-50 w-10 h-10 rounded-lg bg-white text-navy-800 border border-navy-100 flex items-center justify-center"
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
          'fixed left-0 top-0 bottom-0 w-[240px] bg-white border-r border-navy-100 z-40 flex flex-col overflow-y-auto transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
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
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center text-navy-700 hover:bg-navy-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 pt-3">
          {navGroups.map((group, i) => (
            <div key={i} className={cn('space-y-0.5', i > 0 && 'mt-3 border-t border-navy-100 pt-3')}>
              {group.map((n) => item(n.label, n.icon, n.path))}
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
