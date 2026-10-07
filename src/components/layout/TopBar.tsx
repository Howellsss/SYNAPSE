import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Search, Bell, ChevronDown, Plus } from 'lucide-react';
import { BellIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/solid';
import { useAuth } from '@/context/AuthContext';
import { Avatar } from '@/components/ui/Avatar';
import { useRouter } from '@/lib/router';
import { cn, timeAgo } from '@/lib/utils';
import { recentActivity, type ActivityItem } from '@/lib/activity';

interface TopBarProps {
  onQuickCreate?: () => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  searchResults?: ReactNode;
}

export function TopBar({ onQuickCreate, searchQuery, onSearchChange, searchResults }: TopBarProps) {
  const { profile, signOut, workspace } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K jumps to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [, navigate] = useRouter();
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);

  // Real notifications: new bookings and form submissions, loaded when the bell opens.
  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    recentActivity(workspace.id, 6).then((items) => { if (alive) setActivity(items); }).catch(() => { if (alive) setActivity([]); });
    return () => { alive = false; };
  }, [notifOpen, workspace]); // reloads each time the bell opens

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-navy-100 h-16 flex items-center pl-16 pr-4 lg:px-6 gap-4">
      {/* Search */}
      <div className="flex-1 max-w-xl relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-navy-500 pointer-events-none" />
        <input
          ref={searchRef}
          type="text"
          value={searchQuery ?? ''}
          onChange={(e) => onSearchChange?.(e.target.value)}
          placeholder="Search contacts, appointments, forms..."
          aria-label="Search contacts, appointments and forms"
          className="w-full h-10 pl-10 pr-12 bg-white text-sm text-navy-800 rounded-lg border border-navy-100 transition-all placeholder:text-ivory-700 focus:bg-white focus:border-gold-400 focus:ring-4 focus:ring-gold-400/20 outline-none"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden text-xs text-ivory-700 sm:block">⌘K</kbd>
        {searchQuery && searchQuery.length > 0 && searchResults && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl border border-navy-100 shadow-popover max-h-96 overflow-y-auto animate-scale-in">
            {searchResults}
          </div>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Quick create */}
        {onQuickCreate && (
          <button
            onClick={onQuickCreate}
            className="hidden sm:inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-navy-800 text-white text-sm font-semibold transition-colors hover:bg-navy-700"
          >
            <Plus className="w-4 h-4" />
            Create
          </button>
        )}

        {/* Help */}
        <button aria-label="Help" className="w-9 h-9 rounded-lg text-navy-700 hover:bg-navy-50 hover:text-navy-800 transition-colors items-center justify-center hidden md:flex">
          <QuestionMarkCircleIcon className="w-5 h-5" />
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            aria-label="Notifications"
            aria-expanded={notifOpen}
            className="w-9 h-9 rounded-lg text-navy-700 hover:bg-navy-50 hover:text-navy-800 transition-colors flex items-center justify-center relative"
          >
            <BellIcon className="w-5 h-5" />
            {activity && activity.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-gold-400" />}
          </button>
          {notifOpen && (
            <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl border border-navy-100 shadow-popover animate-scale-in overflow-hidden">
              <div className="px-4 py-3 border-b border-navy-100">
                <h3 className="text-sm font-semibold text-navy-800">Notifications</h3>
              </div>
              {activity && activity.length > 0 ? (
                <ul className="max-h-80 overflow-y-auto divide-y divide-navy-100">
                  {activity.map((n) => (
                    <li key={n.id} className="px-4 py-3">
                      <p className="text-sm font-medium text-navy-800">{n.title}</p>
                      <p className="mt-0.5 text-xs text-ivory-600">{n.detail}</p>
                      <p className="mt-1 text-xs text-ivory-500">{timeAgo(n.at)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-4 py-10 text-center">
                  <Bell className="mx-auto h-6 w-6 text-ivory-400" />
                  <p className="mt-2 text-sm font-medium text-navy-800">{activity ? "You're all caught up" : 'Loading…'}</p>
                  <p className="mt-0.5 text-xs text-ivory-600">New bookings and form submissions show here.</p>
                </div>
              )}
              <div className="px-4 py-2.5 border-t border-navy-100 text-center">
                <button
                  onClick={() => { navigate('/conversations'); setNotifOpen(false); }}
                  className="text-sm font-medium text-gold-700 hover:underline"
                >
                  View all notifications
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-navy-50 transition-colors"
          >
            <Avatar
              firstName={profile?.first_name}
              lastName={profile?.last_name}
              src={profile?.avatar_url}
              size="sm"
            />
            <div className="hidden md:block text-left">
              <p className="text-sm font-semibold text-navy-700 leading-tight">
                {profile?.first_name} {profile?.last_name}
              </p>
              <p className="text-xs text-ivory-600 leading-tight">{workspace?.name}</p>
            </div>
            <ChevronDown className="w-4 h-4 text-ivory-600 hidden md:block" />
          </button>
          {dropdownOpen && (
            <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-xl border border-navy-100 shadow-popover animate-scale-in overflow-hidden">
              <div className="px-4 py-3 border-b border-navy-100">
                <p className="text-sm font-semibold text-navy-800">
                  {profile?.first_name} {profile?.last_name}
                </p>
                <p className="text-xs text-ivory-600">{workspace?.name}</p>
              </div>
              <div className="py-1">
                <DropdownItem
                  label="Profile Settings"
                  onClick={() => {
                    navigate('/settings');
                    setDropdownOpen(false);
                  }}
                />
                <DropdownItem
                  label="Calendars & Integrations"
                  onClick={() => {
                    navigate('/settings/integrations');
                    setDropdownOpen(false);
                  }}
                />
              </div>
              <div className="py-1 border-t border-navy-100">
                <DropdownItem
                  label="Sign Out"
                  onClick={() => {
                    signOut();
                    setDropdownOpen(false);
                  }}
                  danger
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function DropdownItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full px-4 py-2 text-left text-sm font-medium transition-colors',
        danger ? 'text-burgundy-600 hover:bg-burgundy-400/10' : 'text-navy-600 hover:bg-navy-50'
      )}
    >
      {label}
    </button>
  );
}
