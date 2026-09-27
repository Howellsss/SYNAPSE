import { useState, useEffect, useCallback } from 'react';
import {
  User, Building2, Users, Mail, MessageSquare, Bell,
  Palette, Shield, Code, Webhook, CreditCard, Upload, UserPlus,
  MoreVertical, Trash2, Ban, Pencil, Mail as MailIcon,
  Clock,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types';
import { useEmailAccounts, connectGmail, disconnectEmailAccount, type EmailAccount } from '@/lib/email-accounts';

const SETTINGS_SECTIONS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'workspace', label: 'Workspace', icon: Building2 },
  { id: 'team', label: 'Team Members', icon: Users },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'sms', label: 'SMS', icon: MessageSquare },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'api', label: 'API', icon: Code },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook },
  { id: 'billing', label: 'Billing', icon: CreditCard },
];

const COMMON_TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Oslo', 'Europe/Zurich',
  'Europe/Dublin', 'Europe/Lisbon', 'Europe/Rome', 'Asia/Tokyo', 'Asia/Singapore',
  'Asia/Hong_Kong', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Seoul',
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Pacific/Auckland',
  'America/Toronto', 'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo',
  'America/Buenos_Aires', 'Africa/Cairo', 'Africa/Johannesburg', 'Atlantic/Reykjavik',
];

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'no', label: 'Norwegian' },
  { code: 'sv', label: 'Swedish' },
  { code: 'da', label: 'Danish' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Arabic' },
];

// ============================================================
// Helper: load/save workspace settings by category
// ============================================================
function useWorkspaceSettings(category: string) {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('workspace_settings')
      .select('settings')
      .eq('workspace_id', workspace.id)
      .eq('category', category)
      .maybeSingle();
    setSettings((data?.settings as Record<string, unknown>) ?? {});
    setLoading(false);
  }, [workspace, category]);

  useEffect(() => { load(); }, [load]);

  const save = async (newSettings: Record<string, unknown>) => {
    if (!workspace) return;
    const { error } = await supabase
      .from('workspace_settings')
      .upsert(
        { workspace_id: workspace.id, category, settings: newSettings, updated_at: new Date().toISOString() },
        { onConflict: 'workspace_id,category' }
      );
    if (error) { toast(error.message, 'error'); return; }
    toast('Settings saved');
    setSettings(newSettings);
  };

  return { settings, loading, save };
}

// ============================================================
// Main page
// ============================================================
function initialSection() {
  const tab = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tab');
  return SETTINGS_SECTIONS.some((s) => s.id === tab) ? (tab as string) : 'profile';
}

export function SettingsPage() {
  const [section, setSection] = useState(initialSection);

  return (
    <div className="flex flex-col md:flex-row gap-0 md:gap-6 max-w-5xl">
      <div className="w-56 shrink-0 hidden md:block">
        <h2 className="text-lg font-semibold text-navy-800 mb-3">Settings</h2>
        <nav className="space-y-0.5">
          {SETTINGS_SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium transition-all',
                section === s.id ? 'bg-navy-800 text-ivory-100' : 'text-ivory-600 hover:bg-ivory-100 hover:text-navy-700'
              )}
            >
              <s.icon className="w-4 h-4 shrink-0" />
              {s.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="md:hidden w-full">
        <select className="input-field mb-4" value={section} onChange={(e) => setSection(e.target.value)}>
          {SETTINGS_SECTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      <div className="flex-1 min-w-0">
        {section === 'profile' && <ProfileSettings />}
        {section === 'workspace' && <WorkspaceSettings />}
        {section === 'team' && <TeamSettings />}
        {section === 'email' && <EmailSettings />}
        {section === 'sms' && <SMSSettings />}
        {section === 'notifications' && <NotificationSettings />}
        {section === 'branding' && <BrandingSettings />}
        {section === 'security' && <SecuritySettings />}
        {section === 'api' && <APISettings />}
        {section === 'webhooks' && <WebhooksSettings />}
        {section === 'billing' && <BillingSettings />}
      </div>
    </div>
  );
}

// ============================================================
// Profile Settings
// ============================================================
function ProfileSettings() {
  const { profile, user, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({
    first_name: profile?.first_name ?? '',
    last_name: profile?.last_name ?? '',
    phone: profile?.phone ?? '',
    timezone: profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    language: profile?.language ?? 'en',
    avatar_url: profile?.avatar_url ?? '',
  });
  const [uploading, setUploading] = useState(false);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `avatars/${user.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      setForm(f => ({ ...f, avatar_url: publicUrl }));
      const { error: dbErr } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
      if (dbErr) throw dbErr;
      toast('Avatar updated');
      refreshProfile();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    const { error } = await supabase.from('profiles').update({
      first_name: form.first_name,
      last_name: form.last_name,
      phone: form.phone,
      timezone: form.timezone,
      language: form.language,
      updated_at: new Date().toISOString(),
    }).eq('user_id', user.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Profile updated');
    refreshProfile();
  };

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-navy-800 mb-4">Profile</h3>
      <div className="flex items-center gap-4 mb-6">
        <div className="relative">
          <Avatar firstName={form.first_name} lastName={form.last_name} src={form.avatar_url || null} size="xl" />
          <label
            className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-navy-800 text-ivory-100 flex items-center justify-center cursor-pointer hover:bg-navy-700 transition-colors shadow-card"
            title="Upload avatar"
          >
            {uploading ? (
              <span className="w-3 h-3 border-2 border-ivory-100/30 border-t-ivory-100 rounded-full animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={uploading} />
          </label>
        </div>
        <div>
          <p className="text-sm font-semibold text-navy-700">{form.first_name} {form.last_name}</p>
          <p className="text-xs text-ivory-600">{user?.email}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">First Name</label>
          <input className="input-field" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Last Name</label>
          <input className="input-field" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Phone</label>
          <input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Language</label>
          <select className="input-field" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Timezone</label>
          <select className="input-field" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
            {COMMON_TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
          </select>
          <p className="text-xs text-ivory-500 mt-1">Your timezone affects how appointment times are displayed to you.</p>
        </div>
      </div>
      <div className="flex justify-end mt-6">
        <button onClick={handleSave} className="btn-primary">Save Changes</button>
      </div>
    </div>
  );
}

// ============================================================
// Workspace Settings
// ============================================================
function WorkspaceSettings() {
  const { workspace, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: workspace?.name ?? '',
    logo_url: workspace?.logo_url ?? '',
    timezone: workspace?.timezone ?? 'UTC',
    default_duration: (workspace?.default_booking_settings as Record<string, unknown>)?.default_duration as number ?? 30,
    default_location: (workspace?.default_booking_settings as Record<string, unknown>)?.default_location as string ?? 'synapse_meeting',
    default_buffer_before: (workspace?.default_booking_settings as Record<string, unknown>)?.default_buffer_before as number ?? 0,
    default_buffer_after: (workspace?.default_booking_settings as Record<string, unknown>)?.default_buffer_after as number ?? 0,
  });
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (workspace) {
      const dbs = (workspace.default_booking_settings ?? {}) as Record<string, unknown>;
      setForm({
        name: workspace.name,
        logo_url: workspace.logo_url ?? '',
        timezone: workspace.timezone ?? 'UTC',
        default_duration: (dbs.default_duration as number) ?? 30,
        default_location: (dbs.default_location as string) ?? 'synapse_meeting',
        default_buffer_before: (dbs.default_buffer_before as number) ?? 0,
        default_buffer_after: (dbs.default_buffer_after as number) ?? 0,
      });
    }
  }, [workspace]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspace) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `logos/${workspace.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('workspace-logos')
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('workspace-logos').getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      setForm(f => ({ ...f, logo_url: publicUrl }));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!workspace) return;
    const { error } = await supabase.from('workspaces').update({
      name: form.name,
      logo_url: form.logo_url,
      timezone: form.timezone,
      default_booking_settings: {
        default_duration: form.default_duration,
        default_location: form.default_location,
        default_buffer_before: form.default_buffer_before,
        default_buffer_after: form.default_buffer_after,
      },
      updated_at: new Date().toISOString(),
    }).eq('id', workspace.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Workspace updated');
    refreshProfile();
  };

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-navy-800 mb-4">Workspace</h3>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            {form.logo_url ? (
              <img src={form.logo_url} alt="Logo" className="w-16 h-16 rounded-2xl object-cover border border-navy-100" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-ivory-100 flex items-center justify-center border border-navy-100">
                <Building2 className="w-7 h-7 text-ivory-600" />
              </div>
            )}
            <label
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-navy-800 text-ivory-100 flex items-center justify-center cursor-pointer hover:bg-navy-700 transition-colors shadow-card"
              title="Upload logo"
            >
              {uploading ? (
                <span className="w-3 h-3 border-2 border-ivory-100/30 border-t-ivory-100 rounded-full animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploading} />
            </label>
          </div>
          <div>
            <p className="text-sm font-semibold text-navy-700">Workspace Logo</p>
            <p className="text-xs text-ivory-600">Shown on booking pages and emails</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Workspace Name</label>
          <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Workspace Slug</label>
          <input className="input-field" value={workspace?.slug ?? ''} disabled />
          <p className="text-xs text-ivory-500 mt-1">This is used in your booking URLs.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Default Timezone</label>
          <select className="input-field" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
            {COMMON_TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
          </select>
          <p className="text-xs text-ivory-500 mt-1">Used as the default for new calendars and booking pages.</p>
        </div>
      </div>

      {/* Default Booking Settings */}
      <div className="mt-6 pt-6 border-t border-navy-100">
        <h4 className="text-sm font-semibold text-navy-700 mb-3">Default Booking Settings</h4>
        <p className="text-xs text-ivory-600 mb-4">These defaults are applied when creating new calendars. Individual calendars can override these values.</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Default Duration</label>
            <select className="input-field" value={form.default_duration} onChange={(e) => setForm({ ...form, default_duration: parseInt(e.target.value) })}>
              {[15, 30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} min</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Default Location</label>
            <select className="input-field" value={form.default_location} onChange={(e) => setForm({ ...form, default_location: e.target.value })}>
              <option value="synapse_meeting">SYNAPSE Meeting</option>
              <option value="phone">Phone</option>
              <option value="in_person">In Person</option>
              <option value="none">No Location</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Default Buffer Before (min)</label>
            <input type="number" className="input-field" value={form.default_buffer_before} onChange={(e) => setForm({ ...form, default_buffer_before: parseInt(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Default Buffer After (min)</label>
            <input type="number" className="input-field" value={form.default_buffer_after} onChange={(e) => setForm({ ...form, default_buffer_after: parseInt(e.target.value) || 0 })} />
          </div>
        </div>
      </div>
      <div className="flex justify-end mt-6">
        <button onClick={handleSave} className="btn-primary">Save Changes</button>
      </div>
    </div>
  );
}

// ============================================================
// Team Members
// ============================================================
interface TeamMemberRow {
  id: string;
  user_id: string;
  role: UserRole;
  status: string;
  created_at: string;
  profiles: { first_name: string | null; last_name: string | null; avatar_url: string | null } | null;
}

interface InvitationRow {
  id: string;
  email: string;
  role: UserRole;
  status: string;
  created_at: string;
  expires_at: string;
}

function TeamSettings() {
  const { workspace, user, canManageTeam } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editMember, setEditMember] = useState<TeamMemberRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TeamMemberRow | null>(null);
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    setLoading(true);
    const [membersRes, invRes, calRes] = await Promise.all([
      supabase
        .from('workspace_members')
        .select('id, user_id, role, status, created_at, profiles(first_name, last_name, avatar_url)')
        .eq('workspace_id', workspace.id),
      supabase
        .from('team_invitations')
        .select('id, email, role, status, created_at, expires_at')
        .eq('workspace_id', workspace.id)
        .eq('status', 'pending'),
      supabase
        .from('calendars')
        .select('id, name')
        .eq('workspace_id', workspace.id),
    ]);
    setMembers((membersRes.data ?? []) as unknown as TeamMemberRow[]);
    setInvitations((invRes.data ?? []) as unknown as InvitationRow[]);
    setCalendars((calRes.data ?? []) as { id: string; name: string }[]);
    setLoading(false);
  }, [workspace]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSuspend = async (member: TeamMemberRow) => {
    if (!workspace) return;
    const { error } = await supabase
      .from('workspace_members')
      .update({ status: member.status === 'suspended' ? 'active' : 'suspended' })
      .eq('id', member.id);
    if (error) { toast(error.message, 'error'); return; }
    toast(member.status === 'suspended' ? 'Member reactivated' : 'Member suspended');
    setActionMenu(null);
    loadData();
  };

  const handleRemove = async () => {
    if (!removeTarget || !workspace) return;
    const { error } = await supabase
      .from('workspace_members')
      .delete()
      .eq('id', removeTarget.id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Member removed');
    setRemoveTarget(null);
    loadData();
  };

  const handleRevokeInvite = async (id: string) => {
    const { error } = await supabase
      .from('team_invitations')
      .update({ status: 'revoked' })
      .eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
    toast('Invitation revoked');
    loadData();
  };

  if (loading) {
    return (
      <div className="card p-6">
        <LoadingSpinner className="w-8 h-8 text-ivory-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-navy-800">Team Members</h3>
            <p className="text-sm text-ivory-600 mt-0.5">Manage who has access to this workspace</p>
          </div>
          {canManageTeam && (
            <button onClick={() => setInviteOpen(true)} className="btn-primary btn-sm">
              <UserPlus className="w-4 h-4" />
              Invite
            </button>
          )}
        </div>

        {/* Active members */}
        <div className="space-y-2">
          {members.map(m => (
            <div key={m.user_id} className="flex items-center gap-3 p-3 rounded-xl border border-navy-100 hover:border-navy-200 transition-colors">
              <Avatar
                firstName={m.profiles?.first_name}
                lastName={m.profiles?.last_name}
                src={m.profiles?.avatar_url}
                size="md"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-navy-700">
                  {m.profiles?.first_name ?? 'Unknown'} {m.profiles?.last_name ?? ''}
                  {m.user_id === user?.id && <span className="text-xs text-ivory-500 ml-2">(You)</span>}
                </p>
                <p className="text-xs text-ivory-600">{m.role === 'owner' ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member'}</p>
              </div>
              <MemberStatusBadge status={m.status} />
              {canManageTeam && m.role !== 'owner' && (
                <div className="relative">
                  <button
                    onClick={() => setActionMenu(actionMenu === m.id ? null : m.id)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-ivory-600 hover:bg-ivory-100 transition-colors"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {actionMenu === m.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setActionMenu(null)} />
                      <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl border border-navy-100 shadow-popover z-20 animate-scale-in overflow-hidden">
                        <button
                          onClick={() => { setEditMember(m); setActionMenu(null); }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-navy-600 hover:bg-ivory-50 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit Role
                        </button>
                        <button
                          onClick={() => handleSuspend(m)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-navy-600 hover:bg-ivory-50 transition-colors"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          {m.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                        </button>
                        <button
                          onClick={() => { setRemoveTarget(m); setActionMenu(null); }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-burgundy-600 hover:bg-burgundy-400/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pending invitations */}
        {invitations.length > 0 && (
          <div className="mt-6">
            <p className="text-sm font-semibold text-navy-700 mb-2">Pending Invitations</p>
            <div className="space-y-2">
              {invitations.map(inv => (
                <div key={inv.id} className="flex items-center gap-3 p-3 rounded-xl border border-navy-100 bg-ivory-50/50">
                  <div className="w-9 h-9 rounded-full bg-ivory-100 flex items-center justify-center">
                    <MailIcon className="w-4 h-4 text-ivory-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-navy-700">{inv.email}</p>
                    <p className="text-xs text-ivory-600">
                      {inv.role === 'admin' ? 'Admin' : 'Member'} · Invited {new Date(inv.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="status-pill bg-amber-50 text-amber-700">
                    <Clock className="w-3 h-3" />
                    Pending
                  </span>
                  {canManageTeam && (
                    <button
                      onClick={() => handleRevokeInvite(inv.id)}
                      className="text-ivory-500 hover:text-burgundy-600 text-sm transition-colors"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {members.length === 0 && invitations.length === 0 && (
          <EmptyState
            icon={<Users className="w-7 h-7" />}
            title="No team members yet"
            description="Invite team members to collaborate on calendars, contacts, and appointments."
          />
        )}
      </div>

      {/* Invite modal */}
      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onInvited={() => { setInviteOpen(false); loadData(); }}
          calendars={calendars}
        />
      )}

      {/* Edit role modal */}
      {editMember && (
        <EditRoleModal
          member={editMember}
          calendars={calendars}
          onClose={() => setEditMember(null)}
          onSaved={() => { setEditMember(null); loadData(); }}
        />
      )}

      {/* Remove confirm */}
      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
        title="Remove team member"
        message={`Are you sure you want to remove ${removeTarget?.profiles?.first_name ?? 'this member'} from the workspace? They will lose access immediately.`}
        confirmLabel="Remove"
        danger
      />
    </div>
  );
}

function MemberStatusBadge({ status }: { status: string }) {
  if (status === 'active') {
    return (
      <span className="status-pill bg-green-50 text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Active
      </span>
    );
  }
  if (status === 'suspended') {
    return (
      <span className="status-pill bg-red-50 text-red-700">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        Suspended
      </span>
    );
  }
  return (
    <span className="status-pill bg-amber-50 text-amber-700">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      Invited
    </span>
  );
}

// ============================================================
// Invite Modal
// ============================================================
function InviteModal({
  onClose,
  onInvited,
  calendars,
}: {
  onClose: () => void;
  onInvited: () => void;
  calendars: { id: string; name: string }[];
}) {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [assignedCalendars, setAssignedCalendars] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleInvite = async () => {
    if (!workspace || !email.trim()) return;
    setLoading(true);
    const { error } = await supabase.from('team_invitations').insert({
      workspace_id: workspace.id,
      email: email.trim().toLowerCase(),
      role,
      assigned_calendar_ids: assignedCalendars,
      invited_by: (await supabase.auth.getUser()).data.user?.id,
    });
    if (error) {
      toast(error.message, 'error');
      setLoading(false);
      return;
    }
    toast(`Invitation sent to ${email}`);
    onInvited();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite Team Member"
      description="Send an invitation to join your workspace."
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleInvite} disabled={loading || !email.trim()} className="btn-primary">
            {loading ? 'Sending...' : 'Send Invitation'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Email Address</label>
          <input
            type="email"
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@company.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Role</label>
          <select className="input-field" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="member">Member — Access to permitted resources</option>
            <option value="admin">Admin — Workspace and operational management</option>
          </select>
        </div>
        {calendars.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Assigned Calendars</label>
            <p className="text-xs text-ivory-600 mb-2">Select which calendars this member can manage.</p>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {calendars.map(cal => (
                <label key={cal.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-ivory-50 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={assignedCalendars.includes(cal.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setAssignedCalendars([...assignedCalendars, cal.id]);
                      } else {
                        setAssignedCalendars(assignedCalendars.filter(c => c !== cal.id));
                      }
                    }}
                    className="w-4 h-4 rounded border-navy-200 text-gold-500 focus:ring-gold-400/20"
                  />
                  <span className="text-sm text-navy-700">{cal.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ============================================================
// Edit Role Modal
// ============================================================
function EditRoleModal({
  member,
  calendars,
  onClose,
  onSaved,
}: {
  member: TeamMemberRow;
  calendars: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [role, setRole] = useState<UserRole>(member.role);
  const [assignedCalendars, setAssignedCalendars] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase
      .from('calendar_hosts')
      .select('calendar_id')
      .eq('user_id', member.user_id)
      .then(({ data }) => {
        setAssignedCalendars((data ?? []).map((r: { calendar_id: string }) => r.calendar_id));
      });
  }, [member.user_id]);

  const handleSave = async () => {
    setLoading(true);
    const { error: roleErr } = await supabase
      .from('workspace_members')
      .update({ role })
      .eq('id', member.id);
    if (roleErr) { toast(roleErr.message, 'error'); setLoading(false); return; }

    // Update calendar assignments
    const { error: delErr } = await supabase
      .from('calendar_hosts')
      .delete()
      .eq('user_id', member.user_id);
    if (delErr) { toast(delErr.message, 'error'); setLoading(false); return; }

    if (assignedCalendars.length > 0) {
      const rows = assignedCalendars.map(calendar_id => ({
        calendar_id,
        user_id: member.user_id,
      }));
      const { error: insErr } = await supabase.from('calendar_hosts').insert(rows);
      if (insErr) { toast(insErr.message, 'error'); setLoading(false); return; }
    }

    toast('Member updated');
    onSaved();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${member.profiles?.first_name ?? 'Member'}`}
      description="Change role and calendar assignments."
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="btn-primary">
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Role</label>
          <select className="input-field" value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={member.role === 'owner'}>
            <option value="member">Member — Access to permitted resources</option>
            <option value="admin">Admin — Workspace and operational management</option>
          </select>
          {member.role === 'owner' && (
            <p className="text-xs text-ivory-500 mt-1">Owner role cannot be changed.</p>
          )}
        </div>
        {calendars.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Assigned Calendars</label>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {calendars.map(cal => (
                <label key={cal.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-ivory-50 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={assignedCalendars.includes(cal.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setAssignedCalendars([...assignedCalendars, cal.id]);
                      } else {
                        setAssignedCalendars(assignedCalendars.filter(c => c !== cal.id));
                      }
                    }}
                    className="w-4 h-4 rounded border-navy-200 text-gold-500 focus:ring-gold-400/20"
                  />
                  <span className="text-sm text-navy-700">{cal.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ============================================================
// Email Settings
// ============================================================
function EmailSettings() {
  const { settings, loading, save } = useWorkspaceSettings('email');
  const { toast } = useToast();
  const [form, setForm] = useState({
    sender_name: '',
    sender_email: '',
    reply_to: '',
    provider: 'default',
  });

  useEffect(() => {
    if (!loading && settings) {
      setForm({
        sender_name: (settings.sender_name as string) || '',
        sender_email: (settings.sender_email as string) || '',
        reply_to: (settings.reply_to as string) || '',
        provider: (settings.provider as string) || 'default',
      });
    }
  }, [loading, settings]);

  const handleSave = () => save(form);

  return (
    <div className="space-y-6">
    <ConnectedEmailAccounts />
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-navy-800 mb-4">Email Settings</h3>
      <p className="text-sm text-ivory-600 mb-4">Configure how outgoing emails appear to your contacts. These settings apply to booking confirmations, reminders, and workflow emails.</p>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Sender Name</label>
          <input className="input-field" value={form.sender_name} onChange={(e) => setForm({ ...form, sender_name: e.target.value })} placeholder="SYNAPSE Appointments" />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Sender Email</label>
          <input type="email" className="input-field" value={form.sender_email} onChange={(e) => setForm({ ...form, sender_email: e.target.value })} placeholder="noreply@yourdomain.com" />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Reply-To Email</label>
          <input type="email" className="input-field" value={form.reply_to} onChange={(e) => setForm({ ...form, reply_to: e.target.value })} placeholder="support@yourdomain.com" />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Email Provider</label>
          <select className="input-field" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
            <option value="default">Default (SYNAPSE)</option>
            <option value="smtp">Custom SMTP</option>
            <option value="sendgrid">SendGrid</option>
            <option value="ses">Amazon SES</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-6">
        <button onClick={handleSave} className="btn-primary">Save Changes</button>
        <button onClick={() => toast('Test email sent')} className="btn-secondary">Send Test Email</button>
      </div>
    </div>
    </div>
  );
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function ConnectedEmailAccounts() {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const { accounts, loading, ready, reload } = useEmailAccounts();
  const [connecting, setConnecting] = useState(false);
  const [removing, setRemoving] = useState<EmailAccount | null>(null);

  const connect = async () => {
    if (!workspace) return;
    setConnecting(true);
    const err = await connectGmail(workspace.id, '/settings?tab=email');
    if (err) { toast(err, 'error'); setConnecting(false); }
  };

  const disconnect = async () => {
    if (!removing) return;
    const err = await disconnectEmailAccount(removing.id);
    setRemoving(null);
    if (err) { toast(err, 'error'); return; }
    toast('Gmail disconnected');
    reload();
  };

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-navy-800">Connected email accounts</h3>
          <p className="mt-1 text-sm text-ivory-600">Send emails to contacts from your own Gmail. Replies go straight to your inbox, and sent emails appear in your Gmail “Sent” folder.</p>
        </div>
        <button onClick={connect} disabled={connecting || !ready} className="btn-secondary inline-flex items-center gap-2">
          <GoogleMark className="h-4 w-4" />
          {connecting ? 'Opening Google…' : accounts.length ? 'Connect another Gmail' : 'Connect Gmail'}
        </button>
      </div>

      {!ready && (
        <p className="mt-4 rounded-lg bg-gold-50 px-3 py-2 text-sm text-gold-800">Run the latest database update (connected email accounts) to turn this on.</p>
      )}

      {ready && (
        <div className="mt-4">
          {loading ? (
            <LoadingSpinner className="h-5 w-5" />
          ) : accounts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-navy-200 px-4 py-6 text-center text-sm text-ivory-600">
              No email connected yet. Emails you send are only saved in SYNAPSE until you connect one.
            </div>
          ) : (
            <ul className="divide-y divide-navy-50 rounded-xl border border-navy-100">
              {accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ivory-50 ring-1 ring-navy-100"><GoogleMark className="h-4 w-4" /></span>
                  <div className="min-w-[11rem] flex-1">
                    <p className="truncate text-sm font-semibold text-navy-800">{a.email}</p>
                    <p className="truncate text-xs text-ivory-600">
                      {a.status === 'active' ? `Gmail · connected ${new Date(a.created_at).toLocaleDateString()}` : a.last_error || 'Needs reconnecting'}
                    </p>
                  </div>
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-semibold',
                    a.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-burgundy-600',
                  )}>
                    {a.status === 'active' ? 'Active' : 'Reconnect'}
                  </span>
                  {a.status !== 'active' && (
                    <button onClick={connect} className="text-sm font-medium text-gold-700 hover:underline">Reconnect</button>
                  )}
                  <button onClick={() => setRemoving(a)} className="text-sm font-medium text-ivory-600 hover:text-burgundy-600">Disconnect</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={disconnect}
        title="Disconnect Gmail?"
        message={`SYNAPSE will stop sending from ${removing?.email ?? 'this account'} and Google access will be removed. Past emails stay on your contacts.`}
        confirmLabel="Disconnect"
        danger
      />
    </div>
  );
}

// ============================================================
// SMS Settings
// ============================================================
function SMSSettings() {
  const { settings, loading, save } = useWorkspaceSettings('sms');
  const [form, setForm] = useState({
    sender_id: '',
    provider: 'default',
    enabled: false,
  });

  useEffect(() => {
    if (!loading && settings) {
      setForm({
        sender_id: (settings.sender_id as string) || '',
        provider: (settings.provider as string) || 'default',
        enabled: (settings.enabled as boolean) ?? false,
      });
    }
  }, [loading, settings]);

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-navy-800 mb-4">SMS Settings</h3>
      <p className="text-sm text-ivory-600 mb-4">Configure SMS messaging for appointment reminders and workflow notifications. SMS consent is tracked per contact.</p>
      <div className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded-xl bg-ivory-50 border border-navy-50">
          <div>
            <p className="text-sm font-medium text-navy-700">Enable SMS</p>
            <p className="text-xs text-ivory-600">Turn on SMS notifications for reminders and workflows</p>
          </div>
          <button
            onClick={() => setForm({ ...form, enabled: !form.enabled })}
            className={cn('relative w-11 h-6 rounded-full transition-colors', form.enabled ? 'bg-gold-400' : 'bg-navy-200')}
          >
            <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform')} style={{ transform: form.enabled ? 'translateX(20px)' : 'translateX(0)' }} />
          </button>
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Sender ID</label>
          <input className="input-field" value={form.sender_id} onChange={(e) => setForm({ ...form, sender_id: e.target.value })} placeholder="SYNAPSE" maxLength={11} />
          <p className="text-xs text-ivory-500 mt-1">Alphanumeric sender ID (max 11 characters). Not all carriers support alphanumeric senders.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">SMS Provider</label>
          <select className="input-field" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
            <option value="default">Default (SYNAPSE)</option>
            <option value="twilio">Twilio</option>
            <option value="messagebird">MessageBird</option>
            <option value="vonage">Vonage</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end mt-6">
        <button onClick={() => save(form)} className="btn-primary">Save Changes</button>
      </div>
    </div>
  );
}

// ============================================================
// Notification Settings
// ============================================================
function NotificationSettings() {
  const { settings, loading, save } = useWorkspaceSettings('notifications');
  const [toggles, setToggles] = useState({
    reminder_email: true,
    reminder_sms: false,
    followup_email: true,
    followup_sms: false,
    daily_summary: true,
    workflow_notifications: true,
  });

  useEffect(() => {
    if (!loading && settings) {
      setToggles({
        reminder_email: (settings.reminder_email as boolean) ?? true,
        reminder_sms: (settings.reminder_sms as boolean) ?? false,
        followup_email: (settings.followup_email as boolean) ?? true,
        followup_sms: (settings.followup_sms as boolean) ?? false,
        daily_summary: (settings.daily_summary as boolean) ?? true,
        workflow_notifications: (settings.workflow_notifications as boolean) ?? true,
      });
    }
  }, [loading, settings]);

  const items: { key: keyof typeof toggles; label: string; desc: string }[] = [
    { key: 'reminder_email', label: 'Email Reminders', desc: 'Send email reminders before appointments' },
    { key: 'reminder_sms', label: 'SMS Reminders', desc: 'Send SMS reminders before appointments' },
    { key: 'followup_email', label: 'Follow-up Emails', desc: 'Send follow-up emails after appointments' },
    { key: 'followup_sms', label: 'Follow-up SMS', desc: 'Send follow-up SMS after appointments' },
    { key: 'daily_summary', label: 'Daily Summary', desc: 'Receive a daily summary of your appointments' },
    { key: 'workflow_notifications', label: 'Workflow Notifications', desc: 'Get notified when workflows fail or complete' },
  ];

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-navy-800 mb-4">Notification Settings</h3>
      <p className="text-sm text-ivory-600 mb-4">Control which notifications are sent to you and your contacts.</p>
      <div className="space-y-3">
        {items.map(item => (
          <div key={item.key} className="flex items-center justify-between p-3 rounded-xl bg-ivory-50 border border-navy-50">
            <div>
              <p className="text-sm font-medium text-navy-700">{item.label}</p>
              <p className="text-xs text-ivory-600">{item.desc}</p>
            </div>
            <button
              onClick={() => setToggles({ ...toggles, [item.key]: !toggles[item.key] })}
              className={cn('relative w-11 h-6 rounded-full transition-colors', toggles[item.key] ? 'bg-gold-400' : 'bg-navy-200')}
            >
              <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: toggles[item.key] ? 'translateX(20px)' : 'translateX(0)' }} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-6">
        <button onClick={() => save(toggles)} className="btn-primary">Save Changes</button>
      </div>
    </div>
  );
}

// ============================================================
// Branding Settings
// ============================================================
function BrandingSettings() {
  const { settings, loading, save } = useWorkspaceSettings('branding');
  const [form, setForm] = useState({
    primary_color: '#1e293b',
    accent_color: '#c4a042',
    logo_url: '',
    custom_domain: '',
  });

  useEffect(() => {
    if (!loading && settings) {
      setForm({
        primary_color: (settings.primary_color as string) || '#1e293b',
        accent_color: (settings.accent_color as string) || '#c4a042',
        logo_url: (settings.logo_url as string) || '',
        custom_domain: (settings.custom_domain as string) || '',
      });
    }
  }, [loading, settings]);

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-navy-800 mb-4">Branding</h3>
      <p className="text-sm text-ivory-600 mb-4">Customize the appearance of your booking pages and emails.</p>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Primary Color</label>
            <div className="flex items-center gap-2">
              <input type="color" className="w-10 h-10 rounded-lg border border-navy-100 cursor-pointer" value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} />
              <input className="input-field flex-1" value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Accent Color</label>
            <div className="flex items-center gap-2">
              <input type="color" className="w-10 h-10 rounded-lg border border-navy-100 cursor-pointer" value={form.accent_color} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} />
              <input className="input-field flex-1" value={form.accent_color} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} />
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Logo URL</label>
          <input className="input-field" value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="https://yourdomain.com/logo.png" />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Custom Domain</label>
          <input className="input-field" value={form.custom_domain} onChange={(e) => setForm({ ...form, custom_domain: e.target.value })} placeholder="book.yourdomain.com" />
          <p className="text-xs text-ivory-500 mt-1">Add a CNAME record pointing to synapse.app to use your custom domain.</p>
        </div>
      </div>
      <div className="flex justify-end mt-6">
        <button onClick={() => save(form)} className="btn-primary">Save Changes</button>
      </div>
    </div>
  );
}

// ============================================================
// Security Settings
// ============================================================
function SecuritySettings() {
  const { settings, loading, save } = useWorkspaceSettings('security');
  const [form, setForm] = useState({
    require_2fa: false,
    session_timeout: '30',
    ip_allowlist: '',
  });

  useEffect(() => {
    if (!loading && settings) {
      setForm({
        require_2fa: (settings.require_2fa as boolean) ?? false,
        session_timeout: (settings.session_timeout as string) || '30',
        ip_allowlist: (settings.ip_allowlist as string) || '',
      });
    }
  }, [loading, settings]);

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-navy-800 mb-4">Security</h3>
      <p className="text-sm text-ivory-600 mb-4">Manage authentication and access controls for your workspace.</p>
      <div className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded-xl bg-ivory-50 border border-navy-50">
          <div>
            <p className="text-sm font-medium text-navy-700">Require Two-Factor Authentication</p>
            <p className="text-xs text-ivory-600">All team members must enable 2FA to access the workspace</p>
          </div>
          <button
            onClick={() => setForm({ ...form, require_2fa: !form.require_2fa })}
            className={cn('relative w-11 h-6 rounded-full transition-colors', form.require_2fa ? 'bg-gold-400' : 'bg-navy-200')}
          >
            <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: form.require_2fa ? 'translateX(20px)' : 'translateX(0)' }} />
          </button>
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Session Timeout</label>
          <select className="input-field" value={form.session_timeout} onChange={(e) => setForm({ ...form, session_timeout: e.target.value })}>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="240">4 hours</option>
            <option value="480">8 hours</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">IP Allowlist</label>
          <textarea className="input-field min-h-[80px]" value={form.ip_allowlist} onChange={(e) => setForm({ ...form, ip_allowlist: e.target.value })} placeholder="192.168.1.0/24&#10;10.0.0.1" />
          <p className="text-xs text-ivory-500 mt-1">One IP or CIDR per line. Leave empty to allow all IPs.</p>
        </div>
      </div>
      <div className="flex justify-end mt-6">
        <button onClick={() => save(form)} className="btn-primary">Save Changes</button>
      </div>
    </div>
  );
}

// ============================================================
// API Settings
// ============================================================
function APISettings() {
  const { settings, loading, save } = useWorkspaceSettings('api');
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');

  useEffect(() => {
    if (!loading && settings) {
      setApiKey((settings.api_key as string) || '');
      setWebhookSecret((settings.webhook_secret as string) || '');
    }
  }, [loading, settings]);

  const generateApiKey = () => {
    const key = 'hk_live_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
    setApiKey(key);
    toast('API key generated');
  };

  const generateSecret = () => {
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    setWebhookSecret(secret);
    toast('Webhook secret generated');
  };

  const handleSave = () => save({ api_key: apiKey, webhook_secret: webhookSecret });

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-navy-800 mb-4">API</h3>
      <p className="text-sm text-ivory-600 mb-4">Use API keys to access SYNAPSE resources programmatically. Keep your keys secure.</p>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">API Key</label>
          <div className="flex gap-2">
            <input className="input-field font-mono text-sm" value={apiKey} readOnly placeholder="No API key generated" />
            <button onClick={generateApiKey} className="btn-secondary shrink-0">Regenerate</button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Webhook Signing Secret</label>
          <div className="flex gap-2">
            <input className="input-field font-mono text-sm" value={webhookSecret} readOnly placeholder="No secret generated" />
            <button onClick={generateSecret} className="btn-secondary shrink-0">Regenerate</button>
          </div>
          <p className="text-xs text-ivory-500 mt-1">Used to verify that incoming webhooks are from SYNAPSE.</p>
        </div>
      </div>
      <div className="flex justify-end mt-6">
        <button onClick={handleSave} className="btn-primary">Save Changes</button>
      </div>
    </div>
  );
}

// ============================================================
// Webhooks
// ============================================================
function WebhooksSettings() {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [webhooks, setWebhooks] = useState<{ id: string; url: string; events: string[]; is_active: boolean }[]>([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);

  const WEBHOOK_EVENTS = [
    'contact.created', 'contact.updated', 'form.submitted',
    'appointment.created', 'appointment.cancelled', 'appointment.rescheduled',
    'appointment.completed', 'workflow.completed',
  ];

  useEffect(() => {
    if (!workspace) return;
    supabase.from('webhooks').select('*').eq('workspace_id', workspace.id).then(({ data }) => {
      setWebhooks((data ?? []) as typeof webhooks);
    });
  }, [workspace]);

  const handleCreate = async () => {
    if (!workspace || !url.trim()) return;
    const { data, error } = await supabase.from('webhooks').insert({
      workspace_id: workspace.id,
      url: url.trim(),
      events,
      is_active: true,
    }).select().single();
    if (error) { toast(error.message, 'error'); return; }
    setWebhooks([...webhooks, data as typeof webhooks[0]]);
    setUrl('');
    setEvents([]);
    toast('Webhook created');
  };

  const handleDelete = async (id: string) => {
    await supabase.from('webhooks').delete().eq('id', id);
    setWebhooks(webhooks.filter(w => w.id !== id));
    toast('Webhook deleted');
  };

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-navy-800 mb-4">Webhooks</h3>
      <div className="space-y-3 mb-6">
        {webhooks.map(w => (
          <div key={w.id} className="flex items-center gap-3 p-3 rounded-xl border border-navy-100">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-navy-700 truncate">{w.url}</p>
              <p className="text-xs text-ivory-600">{w.events.join(', ') || 'No events'}</p>
            </div>
            <span className={cn('status-pill', w.is_active ? 'bg-green-50 text-green-700' : 'bg-ivory-100 text-ivory-700')}>
              {w.is_active ? 'Active' : 'Inactive'}
            </span>
            <button onClick={() => handleDelete(w.id)} className="text-ivory-500 hover:text-burgundy-600 text-sm">Delete</button>
          </div>
        ))}
      </div>
      <div className="border-t border-navy-100 pt-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Webhook URL</label>
          <input className="input-field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-app.com/webhook" />
        </div>
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1.5">Events</label>
          <div className="flex flex-wrap gap-2">
            {WEBHOOK_EVENTS.map(ev => (
              <button
                key={ev}
                onClick={() => setEvents(events.includes(ev) ? events.filter(e => e !== ev) : [...events, ev])}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                  events.includes(ev) ? 'bg-navy-800 text-ivory-100' : 'bg-ivory-50 text-navy-600 border border-navy-100'
                )}
              >
                {ev}
              </button>
            ))}
          </div>
        </div>
        <button onClick={handleCreate} className="btn-primary" disabled={!url.trim()}>Add Webhook</button>
      </div>
    </div>
  );
}

// ============================================================
// Billing Settings
// ============================================================
function BillingSettings() {
  const { workspace } = useAuth();
  const [counts, setCounts] = useState({ contacts: 0, appointments: 0, forms: 0 });
  const [plan, setPlan] = useState('free');

  useEffect(() => {
    if (!workspace) return;
    Promise.all([
      supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
      supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
      supabase.from('forms').select('*', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
    ]).then(([c, a, f]) => {
      setCounts({ contacts: c.count ?? 0, appointments: a.count ?? 0, forms: f.count ?? 0 });
    });
  }, [workspace]);

  const plans = [
    { id: 'free', name: 'Free', price: '$0', limits: '100 contacts, 1 calendar' },
    { id: 'pro', name: 'Pro', price: '$29/mo', limits: '10,000 contacts, unlimited calendars' },
    { id: 'enterprise', name: 'Enterprise', price: 'Custom', limits: 'Unlimited everything, SSO, priority support' },
  ];

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-navy-800 mb-4">Billing</h3>
      <div className="mb-6 p-4 rounded-xl bg-ivory-50 border border-navy-50">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-navy-700">Current Plan</span>
          <span className="text-sm font-bold text-gold-700 capitalize">{plan}</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-2xl font-bold text-navy-800">{counts.contacts}</p>
            <p className="text-xs text-ivory-600">Contacts</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-navy-800">{counts.appointments}</p>
            <p className="text-xs text-ivory-600">Appointments</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-navy-800">{counts.forms}</p>
            <p className="text-xs text-ivory-600">Forms</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {plans.map(p => (
          <div key={p.id} className={cn('p-4 rounded-xl border-2 transition-all', plan === p.id ? 'border-gold-400 bg-gold-50/30' : 'border-navy-100')}>
            <p className="text-sm font-bold text-navy-800">{p.name}</p>
            <p className="text-lg font-bold text-navy-700 mt-1">{p.price}</p>
            <p className="text-xs text-ivory-600 mt-1">{p.limits}</p>
            {plan !== p.id && (
              <button onClick={() => setPlan(p.id)} className="btn-secondary btn-sm w-full mt-3">
                {p.id === 'free' ? 'Downgrade' : 'Upgrade'}
              </button>
            )}
            {plan === p.id && (
              <p className="text-xs text-gold-700 font-medium text-center mt-3">Current Plan</p>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-ivory-500 mt-4">Usage counts update in real time. Upgrade to unlock more contacts, calendars, and features.</p>
    </div>
  );
}
