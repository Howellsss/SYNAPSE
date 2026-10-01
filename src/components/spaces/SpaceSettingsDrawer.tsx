import { useEffect, useState } from 'react';
import { LayoutGrid, ShieldCheck, CalendarClock, Palette, Loader2 } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { listCalendars, updateSpace, uploadSpaceLogo } from '@/lib/spaces';
import { generateGuestToken } from '@/spatial/access';
import { DEFAULT_SCHEDULE, scheduleProblem } from '@/spatial/schedule';
import { buildRooms } from '@/spatial/data/rooms';
import { roomsProblem } from './wizard/state';
import { RoomsEditor } from './config/RoomsEditor';
import { AccessEditor } from './config/AccessEditor';
import { AvailabilityEditor } from './config/AvailabilityEditor';
import { BrandingEditor } from './config/BrandingEditor';
import { cn } from '@/lib/utils';
import type { Space, SpaceSchedule } from '@/types';

type Tab = 'rooms' | 'access' | 'availability' | 'branding';
const TABS: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'rooms', label: 'Rooms', icon: LayoutGrid },
  { id: 'access', label: 'Access', icon: ShieldCheck },
  { id: 'availability', label: 'Availability', icon: CalendarClock },
  { id: 'branding', label: 'Branding', icon: Palette },
];

const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/** "Workspace settings": the Configure step's editors, for a space that already exists. */
export function SpaceSettingsDrawer({ space, onClose, onSaved }: { space: Space; onClose: () => void; onSaved: (s: Space) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('rooms');
  const [rooms, setRooms] = useState(() => space.config?.rooms?.length ? space.config.rooms : buildRooms(space.template_key, space.size_band));
  const [accessMode, setAccessMode] = useState(space.access_mode ?? 'members');
  const [token, setToken] = useState<string | null>(space.guest_link_token ?? null);
  const [permissions, setPermissions] = useState(space.permissions);
  const [persistence, setPersistence] = useState(space.persistence ?? 'always_on');
  const [schedule, setSchedule] = useState<SpaceSchedule>(space.schedule ?? DEFAULT_SCHEDULE(browserTz()));
  const [branding, setBranding] = useState(space.branding ?? {});
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (user) listCalendars(space.workspace_id, user.id).then(setCalendars); }, [space.workspace_id, user]);
  useEffect(() => { if (accessMode === 'guest_link' && !token) setToken(generateGuestToken()); }, [accessMode, token]);

  const problem = roomsProblem(rooms) ?? (persistence === 'scheduled' ? scheduleProblem(schedule) : null);

  const save = async () => {
    if (problem) { toast(problem, 'error'); return; }
    setSaving(true);
    const { data, error } = await updateSpace(space.id, {
      config: { ...space.config, rooms },
      access_mode: accessMode,
      guest_link_token: accessMode === 'guest_link' ? token : null,
      permissions,
      persistence,
      schedule: persistence === 'scheduled' ? schedule : null,
      branding,
    });
    setSaving(false);
    if (error || !data) { toast(error ?? 'Could not save.', 'error'); return; }
    toast('Workspace settings saved');
    onSaved(data);
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title="Workspace settings"
      description={space.name}
      width="xl"
      footer={
        <>
          {problem && <p className="mr-auto text-sm text-burgundy-600">{problem}</p>}
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving || !!problem} className="btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
          </button>
        </>
      }
    >
      <div role="tablist" aria-label="Settings sections" className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-navy-50/60 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition', tab === t.id ? 'bg-white text-navy-800 shadow-card' : 'text-navy-500 hover:text-navy-800')}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'rooms' && <RoomsEditor rooms={rooms} onChange={setRooms} />}
      {tab === 'access' && (
        <AccessEditor
          mode={accessMode}
          token={token}
          permissions={permissions}
          onMode={setAccessMode}
          onNewToken={() => setToken(generateGuestToken())}
          onPermissions={setPermissions}
        />
      )}
      {tab === 'availability' && (
        <AvailabilityEditor persistence={persistence} schedule={schedule} calendars={calendars} onPersistence={setPersistence} onSchedule={setSchedule} />
      )}
      {tab === 'branding' && (
        <BrandingEditor branding={branding} onChange={setBranding} upload={(file) => uploadSpaceLogo(space.workspace_id, file)} />
      )}
    </Drawer>
  );
}
