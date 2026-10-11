import { useEffect, useState } from 'react';
import { LayoutGrid, ShieldCheck, CalendarClock, Palette, Loader2, Building2, Check } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { listCalendars, updateSpace, uploadSpaceLogo } from '@/lib/spaces';
import { generateGuestToken } from '@/spatial/access';
import { DEFAULT_SCHEDULE, scheduleProblem } from '@/spatial/schedule';
import { buildRooms } from '@/spatial/data/rooms';
import { OFFICES, officeFor } from '@/spatial/scene/offices';
import { roomsProblem } from './wizard/state';
import { RoomsEditor } from './config/RoomsEditor';
import { AccessEditor } from './config/AccessEditor';
import { AvailabilityEditor } from './config/AvailabilityEditor';
import { BrandingEditor } from './config/BrandingEditor';
import { cn } from '@/lib/utils';
import type { Space, SpaceSchedule } from '@/types';

type Tab = 'rooms' | 'office' | 'access' | 'availability' | 'branding';
const TABS: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'rooms', label: 'Rooms', icon: LayoutGrid },
  { id: 'office', label: '3D office', icon: Building2 },
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
  const [sceneId, setSceneId] = useState<string | null>(officeFor(space.config?.scene)?.id ?? null);
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (user) listCalendars(space.workspace_id, user.id).then(setCalendars); }, [space.workspace_id, user]);
  useEffect(() => { if (accessMode === 'guest_link' && !token) setToken(generateGuestToken()); }, [accessMode, token]);

  const problem = roomsProblem(rooms) ?? (persistence === 'scheduled' ? scheduleProblem(schedule) : null);

  const save = async () => {
    if (problem) { toast(problem, 'error'); return; }
    setSaving(true);
    const { data, error } = await updateSpace(space.id, {
      config: { ...space.config, rooms, scene: sceneId },
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
      {tab === 'office' && <OfficePicker value={sceneId} onChange={setSceneId} />}
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

/** Which 3D world people walk around in: the open floor or a built office. */
function OfficePicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const options = [
    { id: null, name: 'Open floor', text: 'A plain floor sized to your team. Nothing to walk around.' },
    ...Object.values(OFFICES).map((o) => ({ id: o.id as string | null, name: o.name, text: `Preview. A furnished ${o.floor.width} × ${o.floor.depth} m office: work area, glass meeting room, lounge and café. You walk around the furniture.` })),
  ];
  return (
    <div role="radiogroup" aria-label="3D office" className="space-y-3">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button key={o.id ?? 'open'} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.id)}
            className={cn('flex w-full items-start gap-3 rounded-xl p-4 text-left ring-1 ring-inset transition', on ? 'bg-gold-50 ring-gold-400' : 'bg-white ring-navy-100 hover:bg-navy-50')}>
            <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset', on ? 'bg-navy-800 text-white ring-navy-800' : 'ring-navy-200')}>{on && <Check className="h-3 w-3" strokeWidth={3} />}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-navy-800">{o.name}</span>
              <span className="mt-0.5 block text-sm text-ivory-700">{o.text}</span>
            </span>
          </button>
        );
      })}
      <p className="text-xs text-ivory-700">Everyone in this space sees the same office. People already inside see the change the next time they enter.</p>
    </div>
  );
}
