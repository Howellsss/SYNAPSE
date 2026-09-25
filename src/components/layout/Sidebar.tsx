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
import { useRouter } from '@/lib/router';

interface SidebarProps {
  currentPath: string;
  onNavigate: (to: string) => void;
}

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Meetings', icon: Video, path: '/meetings' },
  { label: 'Workspaces', icon: Building2, path: '/workspace' },
  { label: 'Contacts', icon: Users, path: '/contacts' },
  { label: 'Conversations', icon: MessagesSquare, path: '/conversations' },
  { label: 'Events', icon: CalendarHeart, path: '/events' },
  { label: 'Webinars', icon: MonitorPlay, path: '/webinars' },
  { label: 'Calendars', icon: Calendar, path: '/calendars' },
  { label: 'Submissions', icon: FileText, path: '/forms' },
  { label: 'Workflows', icon: Workflow, path: '/workflows' },
  { label: 'Recordings', icon: Mic, path: '/recordings' },
  { label: 'Media Library', icon: FolderOpen, path: '/media-library' },
  { label: 'AI Hub', icon: Sparkles, path: '/ai-hub' },
];

export function Sidebar({ currentPath, onNavigate }: SidebarProps) {
  const { profile, signOut, role } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNavigate = (path: string) => {
    onNavigate(path);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 w-10 h-10 rounded-xl bg-navy-800 text-ivory-100 flex items-center justify-center shadow-sidebar"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-navy-900/50 z-40 animate-backdrop-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 bottom-0 w-[168px] bg-navy-800 z-40 flex flex-col sidebar-scroll overflow-y-auto transition-transform duration-300 lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-3 pt-6 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-navy-700 border border-navy-600 flex items-center justify-center">
              <HowellsLogo className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-wide text-ivory-100">SYNAPSE</span>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden text-ivory-500 hover:text-ivory-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Profile */}
        <div className="px-3 py-4 mt-2">
          <div className="flex items-center gap-2 px-2 py-2 rounded-xl bg-navy-700/50">
            <Avatar
              firstName={profile?.first_name}
              lastName={profile?.last_name}
              src={profile?.avatar_url}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ivory-100 truncate">
                {profile?.first_name || 'User'} {profile?.last_name || ''}
              </p>
              <p className="text-xs text-ivory-600 capitalize">{role || 'Member'}</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="px-2 flex-1">
          <div className="space-y-0.5">
            {navItems.map((item) => {
              const isActive = currentPath === item.path || currentPath.startsWith(item.path + '/');
              const Icon = item.icon;
              return (
                <button
                  key={item.path}
                  onClick={() => handleNavigate(item.path)}
                  className={cn('nav-item w-full', isActive && 'nav-item-active')}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-full bg-gold-400" />
                  )}
                  <Icon className={cn('w-[18px] h-[18px] shrink-0', isActive ? 'text-gold-400' : '')} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Bottom: Settings + Sign Out */}
        <div className="px-2 py-4 mt-auto border-t border-navy-700/50">
          <div className="space-y-0.5">
            <button
              onClick={() => handleNavigate('/settings')}
              className={cn(
                'nav-item w-full',
                currentPath === '/settings' && 'nav-item-active'
              )}
            >
              {currentPath === '/settings' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-full bg-gold-400" />
              )}
              <Settings
                className={cn(
                  'w-[18px] h-[18px] shrink-0',
                  currentPath === '/settings' ? 'text-gold-400' : ''
                )}
              />
              <span>Settings</span>
            </button>
            <button
              onClick={() => signOut()}
              className="nav-item w-full hover:text-burgundy-400"
            >
              <LogOut className="w-[18px] h-[18px] shrink-0" />
              <span>Sign Out</span>
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
      <path d="M5 7c0-1.1.9-2 2-2h2c1.1 0 2 .9 2 2v3M19 7c0-1.1-.9-2-2-2h-2c-1.1 0-2 .9-2 2v3M11 10v4c0 1.1.9 2 2 2s2-.9 2-2v-4M5 12c0 2.2 1.8 4 4 4M19 12c0 2.2-1.8 4-4 4M9 16c0 2 1.3 3 3 3s3-1 3-3" stroke="#E4A93C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export { ChevronRight };
