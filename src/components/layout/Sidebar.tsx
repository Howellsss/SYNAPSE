import { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Workflow,
  Mic,
  Sparkles,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Video,
  Building2,
  CalendarHeart,
  MonitorPlay,
  MessagesSquare,
  FolderOpen,
  Calendar,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { Avatar } from '@/components/ui/Avatar';

interface SidebarProps {
  currentPath: string;
  onNavigate: (to: string) => void;
}

// The everyday places first; tools after a gap, the way Apple groups a sidebar.
const navGroups = [
  [
    { label: 'Today', icon: LayoutDashboard, path: '/dashboard' },
    { label: 'Conversations', icon: MessagesSquare, path: '/conversations' },
    { label: 'Contacts', icon: Users, path: '/contacts' },
    { label: 'Calendars', icon: Calendar, path: '/calendars' },
    { label: 'Meetings', icon: Video, path: '/meetings' },
    { label: 'Workspaces', icon: Building2, path: '/workspace' },
    { label: 'Events', icon: CalendarHeart, path: '/events' },
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

  const item = (label: string, Icon: typeof Users, path: string) => {
    const active = isActive(path);
    return (
      <button
        key={path}
        onClick={() => handleNavigate(path)}
        aria-current={active ? 'page' : undefined}
        className={cn('nav-item w-full', active && 'nav-item-active')}
      >
        <Icon className={cn('h-[18px] w-[18px] shrink-0 stroke-[1.8]', active ? 'text-gold-400' : 'text-navy-500')} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-2.5 left-3 z-50 w-9 h-9 rounded-full bg-white/90 text-navy-800 border border-navy-100 flex items-center justify-center backdrop-blur"
        aria-label="Open menu"
      >
        <Menu className="w-[18px] h-[18px]" />
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/30 z-40 animate-backdrop-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        aria-label="Main"
        className={cn(
          'fixed left-0 top-0 bottom-0 w-[224px] bg-ivory-50 border-r border-navy-100/80 z-40 flex flex-col overflow-y-auto transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 pt-5 pb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-navy-800 text-white flex items-center justify-center">
              <HowellsLogo className="w-4 h-4" />
            </div>
            <span className="text-[13px] font-semibold tracking-[0.12em] text-navy-800">SYNAPSE</span>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="lg:hidden w-8 h-8 rounded-full flex items-center justify-center text-navy-500 hover:bg-navy-100/60"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="px-3 flex-1 space-y-5">
          {navGroups.map((group, i) => (
            <div key={i} className="space-y-0.5">
              {group.map((n) => item(n.label, n.icon, n.path))}
            </div>
          ))}
        </nav>

        {/* Bottom: Settings + you */}
        <div className="px-3 pt-4 pb-4 mt-6 space-y-0.5">
          {item('Settings', Settings, '/settings')}
          <div className="mt-3 flex items-center gap-2.5 border-t border-navy-100/80 px-2 pt-3">
            <Avatar
              firstName={profile?.first_name}
              lastName={profile?.last_name}
              src={profile?.avatar_url}
              size="sm"
            />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[13px] font-semibold text-navy-800 truncate">
                {profile?.first_name || 'User'} {profile?.last_name || ''}
              </p>
              <p className="text-xs text-ivory-600 capitalize">{role || 'Member'}</p>
            </div>
            <button
              onClick={() => signOut()}
              aria-label="Sign out"
              title="Sign out"
              className="w-8 h-8 rounded-full flex items-center justify-center text-navy-500 hover:bg-navy-100/60 hover:text-burgundy-500"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export function HowellsLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 7c0-1.1.9-2 2-2h2c1.1 0 2 .9 2 2v3M19 7c0-1.1-.9-2-2-2h-2c-1.1 0-2 .9-2 2v3M11 10v4c0 1.1.9 2 2 2s2-.9 2-2v-4M5 12c0 2.2 1.8 4 4 4M19 12c0 2.2-1.8 4-4 4M9 16c0 2 1.3 3 3 3s3-1 3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export { ChevronRight };
