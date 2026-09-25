import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CalendarDays, Check, ChevronUp, ChevronDown, Copy, ExternalLink,
  Eye, EyeOff, GripVertical, Link2, Loader2, Palette, Plus, Save, Trash2,
  UsersRound, X, BarChart3,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { slugify } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { GroupPageDesigner } from '@/components/calendar/GroupPageDesigner';
import { mergeGroupPageConfig, type GroupPageConfig } from '@/lib/group-page-config';
import type { Calendar as CalendarType, CalendarGroup } from '@/types';

const CALENDAR_TYPE_LABELS: Record<string, string> = {
  one_on_one: 'Personal',
  group: 'Group',
  round_robin: 'Round Robin',
  collective: 'Collective',
  event: 'Event',
  service: 'Service',
};

interface GroupWithMembers extends CalendarGroup {
  calendar_group_members: { calendar_id: string; sort_order: number; calendars: CalendarType | null }[];
}

interface AnalyticsSummary {
  page_views: number;
  calendar_selections: number;
  booking_starts: number;
  booking_completions: number;
  perCalendar: { calendar_id: string; name: string; selections: number; completions: number }[];
}

export function GroupCalendarSettingsPage({ groupId, onBack }: { groupId: string; onBack: () => void }) {
  const { workspace } = useAuth();
  const { toast } = useToast();
  const [group, setGroup] = useState<GroupWithMembers | null>(null);
  const [calendars, setCalendars] = useState<CalendarType[]>([]);
  const [allAvailableCalendars, setAllAvailableCalendars] = useState<CalendarType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddCalendars, setShowAddCalendars] = useState(false);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'members' | 'appearance' | 'link' | 'analytics'>('general');

  // Editable form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#E4A93C');
  const [backgroundColor, setBackgroundColor] = useState('#09132b');
  const [buttonColor, setButtonColor] = useState('#E4A93C');
  const [fontFamily, setFontFamily] = useState('Inter');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [isActive, setIsActive] = useState(true);
  const [pageConfig, setPageConfig] = useState<GroupPageConfig>(mergeGroupPageConfig(null));

  useEffect(() => {
    loadGroup();
  }, [groupId]);

  async function loadGroup() {
    setLoading(true);
    const { data } = await supabase
      .from('calendar_groups')
      .select('*, calendar_group_members(calendar_id, sort_order, calendars(*))')
      .eq('id', groupId)
      .maybeSingle();

    if (!data) {
      setLoading(false);
      return;
    }

    const g = data as unknown as GroupWithMembers;
    setGroup(g);
    setName(g.name);
    setDescription(g.description ?? '');
    setSlug(g.slug);
    setLogoUrl(g.logo_url ?? '');
    setCoverUrl(g.cover_url ?? '');
    setPrimaryColor(g.primary_color ?? '#E4A93C');
    setBackgroundColor(g.background_color ?? '#09132b');
    setButtonColor((g as unknown as { button_color?: string }).button_color ?? '#E4A93C');
    setFontFamily(g.font_family ?? 'Inter');
    setLayout(g.layout ?? 'grid');
    setIsActive(g.is_active ?? true);
    setPageConfig(mergeGroupPageConfig((g as unknown as { page_config?: unknown }).page_config));

    const members = (g.calendar_group_members ?? [])
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const memberCals = members.map(m => m.calendars).filter(Boolean) as CalendarType[];
    setCalendars(memberCals);

    // Load all available calendars
    let calQuery = supabase.from('calendars').select('*').eq('status', 'active').order('name');
    if (workspace?.id) calQuery = calQuery.eq('workspace_id', workspace.id);
    const { data: allCals } = await calQuery;
    setAllAvailableCalendars((allCals ?? []) as CalendarType[]);

    // Load analytics
    const { data: events } = await supabase
      .from('calendar_group_analytics')
      .select('event_type, calendar_id')
      .eq('group_id', groupId);

    if (events) {
      const summary: AnalyticsSummary = {
        page_views: events.filter(e => e.event_type === 'page_view').length,
        calendar_selections: events.filter(e => e.event_type === 'calendar_selected').length,
        booking_starts: events.filter(e => e.event_type === 'booking_started').length,
        booking_completions: events.filter(e => e.event_type === 'booking_completed').length,
        perCalendar: memberCals.map(cal => ({
          calendar_id: cal.id,
          name: cal.name,
          selections: events.filter(e => e.event_type === 'calendar_selected' && e.calendar_id === cal.id).length,
          completions: events.filter(e => e.event_type === 'booking_completed' && e.calendar_id === cal.id).length,
        })),
      };
      setAnalytics(summary);
    }

    setLoading(false);
  }

  const availableToAdd = useMemo(
    () => allAvailableCalendars.filter(c => !calendars.some(mc => mc.id === c.id)),
    [allAvailableCalendars, calendars],
  );

  async function saveSettings() {
    if (!name.trim()) {
      toast('Group name is required.', 'error');
      return;
    }
    setSaving(true);
    const updates = {
      name: name.trim(),
      description: description.trim() || null,
      slug: slug.trim() || slugify(name.trim()),
      logo_url: logoUrl.trim() || null,
      cover_url: coverUrl.trim() || null,
      primary_color: primaryColor,
      background_color: backgroundColor,
      button_color: buttonColor,
      font_family: fontFamily,
      layout,
      is_active: isActive,
      page_config: pageConfig,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('calendar_groups').update(updates).eq('id', groupId);
    setSaving(false);
    if (error) {
      toast(error.message, 'error');
      return;
    }
    toast('Group settings saved.', 'success');
    loadGroup();
  }

  async function addCalendar(calId: string) {
    const sortOrder = calendars.length;
    const { error } = await supabase.from('calendar_group_members').insert({
      group_id: groupId,
      calendar_id: calId,
      sort_order: sortOrder,
    });
    if (error) {
      toast('Could not add calendar to group.', 'error');
      return;
    }
    toast('Calendar added to group.', 'success');
    loadGroup();
  }

  async function removeCalendar(calId: string) {
    const { error } = await supabase.from('calendar_group_members').delete()
      .eq('group_id', groupId).eq('calendar_id', calId);
    if (error) {
      toast('Could not remove calendar.', 'error');
      return;
    }
    toast('Calendar removed from group.', 'success');
    loadGroup();
  }

  async function reorderCalendar(calId: string, direction: 'up' | 'down') {
    const current = [...calendars];
    const idx = current.findIndex(c => c.id === calId);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= current.length) return;

    // Swap
    [current[idx], current[swapIdx]] = [current[swapIdx], current[idx]];

    // Update sort_order for all
    const { error } = await supabase.from('calendar_group_members')
      .upsert(
        current.map((cal, i) => ({
          group_id: groupId,
          calendar_id: cal.id,
          sort_order: i,
        })),
        { onConflict: 'group_id,calendar_id' },
      );
    if (error) {
      toast('Could not reorder calendars.', 'error');
      return;
    }
    setCalendars(current);
  }

  function copyEmbedCode() {
    const embedCode = `<iframe src="${window.location.origin}/group/${slug}" width="100%" height="600" frameborder="0" style="border-radius:16px"></iframe>`;
    navigator.clipboard.writeText(embedCode);
    toast('Embed code copied to clipboard.', 'success');
  }

  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/group/${slug}`);
    toast('Group link copied.', 'success');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-gold-500 animate-spin" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-ivory-600">Group calendar not found.</p>
        <button onClick={onBack} className="mt-4 text-sm font-semibold text-navy-700 hover:text-navy-900">Go back</button>
      </div>
    );
  }

  const tabs = [
    { id: 'general' as const, label: 'General', icon: UsersRound },
    { id: 'members' as const, label: 'Calendars', icon: CalendarDays },
    { id: 'appearance' as const, label: 'Appearance', icon: Palette },
    { id: 'link' as const, label: 'Share & Embed', icon: Link2 },
    { id: 'analytics' as const, label: 'Analytics', icon: BarChart3 },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button onClick={onBack} className="flex h-10 w-10 items-center justify-center rounded-xl border border-navy-100 text-navy-600 hover:bg-ivory-50 transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-navy-800">{group.name}</h1>
          <p className="text-sm text-ivory-500">Group calendar settings</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsActive(!isActive)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${isActive ? 'border-green-200 bg-green-50 text-green-700' : 'border-navy-100 text-ivory-500 hover:bg-ivory-50'}`}
          >
            {isActive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {isActive ? 'Active' : 'Hidden'}
          </button>
          <a href={`/group/${slug}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-lg border border-navy-100 px-3 py-2 text-xs font-semibold text-navy-700 hover:bg-ivory-50 transition">
            <ExternalLink className="w-3.5 h-3.5" /> Preview
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-navy-100 overflow-x-auto">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition whitespace-nowrap ${activeTab === tab.id ? 'border-navy-800 text-navy-800' : 'border-transparent text-ivory-500 hover:text-navy-700'}`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* General tab */}
      {activeTab === 'general' && (
        <div className="space-y-5">
          <label className="block">
            <span className="text-sm font-medium text-navy-700">Group name</span>
            <input value={name} onChange={e => setName(e.target.value)} className="mt-1.5 w-full rounded-lg border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-navy-700">Description</span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Choose the right appointment type for your needs" className="mt-1.5 w-full resize-none rounded-lg border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-navy-700">URL slug</span>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-sm text-ivory-400">/group/</span>
              <input value={slug} onChange={e => setSlug(e.target.value)} className="flex-1 rounded-lg border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500" />
            </div>
          </label>
          <div className="flex justify-end">
            <button onClick={saveSettings} disabled={saving} className="flex items-center gap-2 rounded-lg bg-navy-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-navy-900 transition disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      {/* Members tab */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-navy-800">Calendars in this group</h3>
              <p className="text-xs text-ivory-500 mt-0.5">The order determines how they appear on the public page.</p>
            </div>
            <button onClick={() => setShowAddCalendars(!showAddCalendars)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
              <Plus className="w-3.5 h-3.5" /> Add calendar
            </button>
          </div>

          {showAddCalendars && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <p className="text-xs font-medium text-navy-700 mb-3">Available calendars</p>
              {availableToAdd.length === 0 ? (
                <p className="text-xs text-ivory-500">All your active calendars are already in this group.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {availableToAdd.map(cal => (
                    <button key={cal.id} onClick={() => addCalendar(cal.id)} className="flex items-center gap-3 rounded-lg border border-navy-100 bg-white p-3 text-left hover:border-blue-400 hover:bg-blue-50 transition">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${cal.color}18` }}>
                        <CalendarDays className="h-4 w-4" style={{ color: cal.color }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-navy-800">{cal.name}</p>
                        <p className="text-xs text-ivory-500">{CALENDAR_TYPE_LABELS[cal.calendar_type] ?? cal.calendar_type} · {cal.duration_minutes}m</p>
                      </div>
                      <Plus className="w-4 h-4 text-blue-500" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {calendars.length === 0 ? (
            <div className="rounded-xl border border-dashed border-navy-200 p-8 text-center">
              <CalendarDays className="mx-auto h-8 w-8 text-ivory-400" />
              <p className="mt-3 text-sm font-medium text-navy-700">No calendars in this group yet</p>
              <p className="mt-1 text-xs text-ivory-500">Add calendars to create your group booking page.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {calendars.map((cal, idx) => (
                <div key={cal.id} className="flex items-center gap-3 rounded-xl border border-navy-100 bg-white p-4">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => reorderCalendar(cal.id, 'up')} disabled={idx === 0} className="text-ivory-400 hover:text-navy-700 disabled:opacity-30">
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button onClick={() => reorderCalendar(cal.id, 'down')} disabled={idx === calendars.length - 1} className="text-ivory-400 hover:text-navy-700 disabled:opacity-30">
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${cal.color}18` }}>
                    <CalendarDays className="h-5 w-5" style={{ color: cal.color }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy-800">{cal.name}</p>
                    <p className="text-xs text-ivory-500">{CALENDAR_TYPE_LABELS[cal.calendar_type] ?? cal.calendar_type} · {cal.duration_minutes} min</p>
                  </div>
                  <span className="text-xs text-ivory-400">#{idx + 1}</span>
                  <button onClick={() => removeCalendar(cal.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Appearance tab */}
      {activeTab === 'appearance' && (
        <div className="space-y-5">
          <GroupPageDesigner
            config={pageConfig}
            groupName={name || group.name}
            groupDescription={description || group.description}
            calendars={calendars}
            onChange={setPageConfig}
          />
          <div className="flex justify-end">
            <button onClick={saveSettings} disabled={saving} className="flex items-center gap-2 rounded-lg bg-navy-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-navy-900 transition disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save appearance'}
            </button>
          </div>
        </div>
      )}

      {/* Link & Embed tab */}
      {activeTab === 'link' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-semibold text-navy-800 mb-1">Public group link</h3>
            <p className="text-sm text-ivory-500 mb-3">Share this link with clients. They'll see all calendars in this group.</p>
            <div className="flex items-center gap-2 rounded-xl border border-navy-200 bg-ivory-50 p-3">
              <Link2 className="w-4 h-4 text-ivory-400 shrink-0" />
              <span className="flex-1 truncate text-sm text-navy-700">{window.location.origin}/group/{slug}</span>
              <button onClick={copyLink} className="flex items-center gap-1.5 rounded-lg bg-navy-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-900">
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-base font-semibold text-navy-800 mb-1">Embed code</h3>
            <p className="text-sm text-ivory-500 mb-3">Embed the group booking page on your website.</p>
            <div className="rounded-xl border border-navy-200 bg-navy-50 p-4 overflow-x-auto">
              <code className="text-xs text-navy-700 whitespace-pre">{`<iframe src="${window.location.origin}/group/${slug}" width="100%" height="600" frameborder="0" style="border-radius:16px"></iframe>`}</code>
            </div>
            <button onClick={copyEmbedCode} className="mt-3 flex items-center gap-1.5 rounded-lg border border-navy-200 px-3 py-2 text-xs font-semibold text-navy-700 hover:bg-ivory-50">
              <Copy className="w-3.5 h-3.5" /> Copy embed code
            </button>
          </div>
        </div>
      )}

      {/* Analytics tab */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Page views', value: analytics?.page_views ?? 0, color: 'text-blue-600' },
              { label: 'Calendar selections', value: analytics?.calendar_selections ?? 0, color: 'text-gold-600' },
              { label: 'Booking starts', value: analytics?.booking_starts ?? 0, color: 'text-purple-600' },
              { label: 'Completed', value: analytics?.booking_completions ?? 0, color: 'text-green-600' },
            ].map(stat => (
              <div key={stat.label} className="rounded-xl border border-navy-100 bg-white p-4">
                <p className="text-2xl font-bold text-navy-800">{stat.value}</p>
                <p className="text-xs text-ivory-500 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          {analytics && analytics.perCalendar.length > 0 && (
            <div>
              <h3 className="text-base font-semibold text-navy-800 mb-3">Per calendar</h3>
              <div className="space-y-2">
                {analytics.perCalendar.map(cal => (
                  <div key={cal.calendar_id} className="flex items-center gap-4 rounded-xl border border-navy-100 bg-white p-4">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-navy-800">{cal.name}</p>
                      <div className="mt-1.5 flex items-center gap-4 text-xs">
                        <span className="text-ivory-500">Selections: <span className="font-semibold text-navy-700">{cal.selections}</span></span>
                        <span className="text-ivory-500">Completions: <span className="font-semibold text-navy-700">{cal.completions}</span></span>
                        {cal.selections > 0 && (
                          <span className="text-ivory-500">Conversion: <span className="font-semibold text-green-600">{Math.round((cal.completions / cal.selections) * 100)}%</span></span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!analytics || analytics.page_views === 0) && (
            <div className="rounded-xl border border-dashed border-navy-200 p-8 text-center">
              <BarChart3 className="mx-auto h-8 w-8 text-ivory-400" />
              <p className="mt-3 text-sm font-medium text-navy-700">No analytics yet</p>
              <p className="mt-1 text-xs text-ivory-500">Analytics will appear once people visit your group booking page.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
