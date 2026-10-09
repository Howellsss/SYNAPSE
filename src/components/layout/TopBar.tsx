import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Search, Bell, ChevronDown, Plus } from 'lucide-react';
import { BellIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/solid';
import { useAuth } from '@/context/AuthContext';
import { Avatar } from '@/components/ui/Avatar';
import { useRouter } from '@/lib/router';
import { cn, timeAgo } from '@/lib/utils';
import { recentActivity, type ActivityItem } from '@/lib/activity';
import { supabase } from '@/lib/supabase';

interface TeamNote { id: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }

interface TopBarProps {
  onQuickCreate?: () => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  searchResults?: ReactNode;
}

export function TopBar({ onQuickCreate, searchQuery, onSearchChange, searchResults }: TopBarProps) {
  const { profile, signOut, workspace, user } = useAuth();
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

  // Alerts sent to me by workflows ("Send internal notification"). Missing table = nothing to show.
  const [notes, setNotes] = useState<TeamNote[]>([]);
  useEffect(() => {
    if (!workspace || !user) return;
    let alive = true;
    void supabase.from('team_notifications').select('id, title, body, link, created_at, read_at')
      .eq('workspace_id', workspace.id).eq('user_id', user.id).order('created_at', { ascending: false }).limit(10)
      .then(({ data, error }) => { if (alive) setNotes(error ? [] : ((data ?? []) as TeamNote[])); });
    return () => { alive = false; };
  }, [notifOpen, workspace, user]);
  const unread = notes.filter((n) => !n.read_at);
  const openNote = (n: TeamNote) => {
    if (!n.read_at) {
      const read_at = new Date().toISOString();
      setNotes((all) => all.map((x) => (x.id === n.id ? { ...x, read_at } : x)));
      void supabase.from('team_notifications').update({ read_at }).eq('id', n.id);
    }
    if (n.link) navigate(n.link);
    setNotifOpen(false);
  };

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
            {(unread.length > 0 || (activity && activity.length > 0)) && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-gold-400" />}
          </button>
          {notifOpen && (
            <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl border border-navy-100 shadow-popover animate-scale-in overflow-hidden">
              <div className="px-4 py-3 border-b border-navy-100">
                <h3 className="text-sm font-semibold text-navy-800">Notifications</h3>
              </div>
              {notes.length > 0 && (
                <ul aria-label="Workflow alerts" className="max-h-60 overflow-y-auto divide-y divide-navy-100 border-b border-navy-100">
                  {notes.map((n) => (
                    <li key={n.id}>
                      <button type="button" onClick={() => openNote(n)} className="flex w-full gap-2.5 px-4 py-3 text-left hover:bg-navy-50">
                        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-[#5B5BD6]')} />
                        <span className="min-w-0 flex-1">
                          <span className={cn('block text-sm text-navy-800', !n.read_at && 'font-semibold')}>{n.title}</span>
                          {n.body && <span className="mt-0.5 block text-xs text-ivory-600 line-clamp-2">{n.body}</span>}
                          <span className="mt-1 block text-xs text-ivory-500">Workflow · {timeAgo(n.created_at)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
              ) : notes.length > 0 ? null : (
                <div className="px-4 py-10 text-center">
                  <Bell className="mx-auto h-6 w-6 text-ivory-400" />
                  <p className="mt-2 text-sm font-medium text-navy-800">{activity ? "You're all caught up" : 'Loading…'}</p>
                  <p className="mt-0.5 text-xs text-ivory-600">New bookings, form submissions and workflow alerts show here.</p>
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
