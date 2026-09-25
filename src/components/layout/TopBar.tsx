import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Search, Bell, ChevronDown, Plus, HelpCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Avatar } from '@/components/ui/Avatar';
import { useRouter } from '@/lib/router';
import { cn } from '@/lib/utils';

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
  const [, navigate] = useRouter();

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
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-navy-100 h-[68px] flex items-center px-4 lg:px-8 gap-4">
      {/* Search */}
      <div className="flex-1 max-w-xl relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-ivory-600 pointer-events-none" />
        <input
          type="text"
          value={searchQuery ?? ''}
          onChange={(e) => onSearchChange?.(e.target.value)}
          placeholder="Search contacts, appointments, forms..."
          className="w-full pl-10 pr-4 py-2.5 bg-white text-sm text-navy-700 rounded-xl border border-navy-100 transition-all placeholder:text-ivory-600 focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 outline-none"
        />
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
            className="btn-primary btn-sm hidden sm:inline-flex"
          >
            <Plus className="w-4 h-4" />
            Create
          </button>
        )}

        {/* Help */}
        <button className="w-9 h-9 rounded-xl text-ivory-600 hover:bg-white hover:text-navy-700 transition-all flex items-center justify-center hidden md:flex">
          <HelpCircle className="w-[18px] h-[18px]" />
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className="w-9 h-9 rounded-xl text-ivory-600 hover:bg-white hover:text-navy-700 transition-all flex items-center justify-center relative"
          >
            <Bell className="w-[18px] h-[18px]" />
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-gold-400" />
          </button>
          {notifOpen && (
            <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl border border-navy-100 shadow-popover animate-scale-in overflow-hidden">
              <div className="px-4 py-3 border-b border-navy-100">
                <h3 className="text-sm font-semibold text-navy-800">Notifications</h3>
              </div>
              <div className="max-h-80 overflow-y-auto">
                <NotifItem
                  title="New appointment booked"
                  desc="Sarah Johnson booked a consultation"
                  time="5m ago"
                />
                <NotifItem
                  title="Form submitted"
                  desc="Michael Williams submitted Application Form"
                  time="1h ago"
                />
                <NotifItem
                  title="Workflow completed"
                  desc="Follow-up email sent to 3 contacts"
                  time="3h ago"
                />
              </div>
              <div className="px-4 py-2.5 border-t border-navy-100 text-center">
                <button className="text-xs font-medium text-navy-600 hover:text-navy-800">
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
            className="flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-xl hover:bg-white transition-all"
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

function NotifItem({ title, desc, time }: { title: string; desc: string; time: string }) {
  return (
    <div className="px-4 py-3 hover:bg-ivory-50 transition-colors border-b border-navy-50 last:border-0">
      <div className="flex items-start gap-2">
        <div className="w-2 h-2 rounded-full bg-gold-400 mt-1.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-navy-700">{title}</p>
          <p className="text-xs text-ivory-600 mt-0.5">{desc}</p>
          <p className="text-xs text-ivory-500 mt-1">{time}</p>
        </div>
      </div>
    </div>
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
        danger ? 'text-burgundy-600 hover:bg-burgundy-400/10' : 'text-navy-600 hover:bg-ivory-100'
      )}
    >
      {label}
    </button>
  );
}
