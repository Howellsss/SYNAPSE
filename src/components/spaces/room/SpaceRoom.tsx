import { useEffect, useMemo, useState } from 'react';
import { Clock, X, DoorClosed, Lock, Hand, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/lib/router';
import { listSpaces } from '@/lib/spaces';
import { spaceTypeInfo } from '@/spatial/data/spaceTypes';
import { templateInfo } from '@/spatial/data/templates';
import { buildRooms, roomTypeLabel } from '@/spatial/data/rooms';
import { can } from '@/spatial/access';
import { loadStatus, saveStatus, useSpacePresence, type PresenceStatus } from '@/spatial/presence';
import { loadQuality, saveQuality, type GraphicsQuality } from '@/spatial/quality';
import { normalizeMediaPrefs } from '@/spatial/media/devices';
import { TypeArt } from '@/components/spaces/TypeArt';
import { SpaceSettingsDrawer } from '@/components/spaces/SpaceSettingsDrawer';
import { DeviceCheckModal } from '@/components/spaces/DeviceCheck';
import { PeoplePanel, PeopleCountButton } from './PeoplePanel';
import { ConnectionPill, ControlBar, WorldToolbar } from './Overlay';
import { InviteToSpace } from './InviteToSpace';
import type { Space } from '@/types';

/**
 * Inside a space: people panel on the left, the world on the right with floating controls.
 * The world itself (SpaceScene) arrives with the 3D art kit; until then the area shows the
 * workspace's picture so everything around it can be used.
 */
export function SpaceRoom({ space, closedNote, onSpaceChange }: { space: Space; closedNote: string | null; onSpaceChange: (s: Space) => void }) {
  const { user, profile, role, workspace } = useAuth();
  const [, navigate] = useRouter();
  const [status, setStatus] = useState<PresenceStatus>(loadStatus);
  const [quality, setQuality] = useState<GraphicsQuality>(loadQuality);
  const [otherSpaces, setOtherSpaces] = useState<Space[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email?.split('@')[0] || 'You';
  const me = useMemo(() => (user ? {
    user_id: user.id, name, avatar_url: profile?.avatar_url ?? null, status, zone: null, conversation: [] as string[],
  } : null), [user, name, profile?.avatar_url, status]);
  const { people, connection } = useSpacePresence(space.id, me);
  // Always list yourself, even before (or without) the presence channel answering.
  const shown = useMemo(
    () => (!me || people.some((p) => p.user_id === me.user_id) ? people : [...people, { ...me, joined_at: '' }].sort((a, b) => a.name.localeCompare(b.name))),
    [people, me],
  );

  useEffect(() => {
    if (!workspace) return;
    listSpaces(workspace.id).then(({ data }) => setOtherSpaces(data.filter((s) => s.id !== space.id)));
  }, [workspace, space.id]);

  const media = normalizeMediaPrefs(profile?.media_prefs);
  const canInvite = can(space.permissions, 'invite', role);
  const canEdit = can(space.permissions, 'edit_office', role);
  const info = spaceTypeInfo(space.space_type);
  const template = templateInfo(space.template_key);
  const rooms = space.config?.rooms?.length ? space.config.rooms : buildRooms(space.template_key, space.size_band);

  const changeStatus = (s: PresenceStatus) => { setStatus(s); saveStatus(s); };
  const changeQuality = (q: GraphicsQuality) => { setQuality(q); saveQuality(q); };

  const panel = (className?: string) => (
    <PeoplePanel
      className={className}
      space={space}
      otherSpaces={otherSpaces}
      people={shown}
      meId={user?.id ?? ''}
      status={status}
      onStatus={changeStatus}
      onOpenSpace={(slug) => navigate(`/workspace/${slug}`)}
      onAllSpaces={() => navigate('/workspace')}
      canInvite={canInvite}
      onInvite={() => { setSheetOpen(false); setInviteOpen(true); }}
    />
  );

  return (
    <div className="flex h-[100dvh] min-h-0 w-full overflow-hidden">
      <aside className="hidden w-[262px] shrink-0 border-r border-navy-50 lg:flex" aria-label="People">{panel('w-full')}</aside>

      <section className="relative min-w-0 flex-1 overflow-hidden bg-navy-900" aria-label={`${space.name} office`}>
        {/* The world */}
        <div className="absolute inset-0" data-quality={quality}>
          <TypeArt info={info} eager className="scale-105 opacity-60 blur-[2px]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(13,28,59,0.35),rgba(13,28,59,0.92))]" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center py-6 pb-28 pl-4 pr-16 sm:px-20">
          <div className="max-w-sm rounded-3xl bg-navy-900/70 p-6 text-center text-white ring-1 ring-white/10 backdrop-blur">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold-400">{info.name}{template ? ` · ${template.name}` : ''}</p>
            <h1 className="mt-2 break-words text-2xl font-bold">{space.name}</h1>
            <p className="mt-2 text-sm text-ivory-300">The walkable 3D office is coming soon. You can already see who's here, set your status and invite people.</p>
          </div>
        </div>

        {/* Video strip (filled by proximity video) */}
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-16" data-slot="video-strip" />

        {closedNote && (
          <div className="absolute inset-x-0 top-3 flex justify-center px-16">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-navy-900/85 px-3 py-1.5 text-xs font-semibold text-gold-300 backdrop-blur">
              <Clock className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Closed to members · {closedNote} · you're in as an admin</span>
            </p>
          </div>
        )}

        <div className="absolute right-3 top-1/2 -translate-y-1/2 sm:right-4">
          <WorldToolbar
            quality={quality}
            onQuality={changeQuality}
            canEdit={canEdit}
            onCenter={() => {}}
            onZoomIn={() => {}}
            onZoomOut={() => {}}
            mapOpen={mapOpen}
            onToggleMap={() => setMapOpen((v) => !v)}
            onEdit={() => setEditOpen(true)}
          />
        </div>

        {mapOpen && <FloorMap spaceName={space.name} rooms={rooms} people={shown.length} onClose={() => setMapOpen(false)} />}

        <div className="absolute bottom-24 left-3 flex flex-col items-start gap-2 sm:bottom-4 sm:left-4">
          <div className="lg:hidden"><PeopleCountButton count={shown.length} onClick={() => setSheetOpen(true)} /></div>
          <ConnectionPill state={connection} />
        </div>

        <div className="absolute inset-x-0 bottom-4 flex justify-center px-3">
          <ControlBar
            initialMicOn={!media.join_muted}
            initialCameraOn={!media.join_camera_off}
            onLeave={() => navigate('/workspace')}
            onSettings={() => setDevicesOpen(true)}
          />
        </div>
      </section>

      {/* Phones: the people panel slides up as a sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="People">
          <div className="absolute inset-0 bg-navy-900/40 animate-backdrop-in" onClick={() => setSheetOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-popover">
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="mx-auto h-1.5 w-10 rounded-full bg-navy-100" aria-hidden="true" />
            </div>
            <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close people" className="absolute right-3 top-3 rounded-lg p-1.5 text-ivory-700 hover:bg-ivory-50">
              <X className="h-5 w-5" />
            </button>
            {panel('min-h-0 flex-1')}
          </div>
        </div>
      )}

      <InviteToSpace space={space} open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <DeviceCheckModal open={devicesOpen} onClose={() => setDevicesOpen(false)} />
      {editOpen && (
        <SpaceSettingsDrawer
          space={space}
          onClose={() => setEditOpen(false)}
          onSaved={(s) => { onSpaceChange(s); setEditOpen(false); }}
        />
      )}
    </div>
  );
}

/** Floor map: the rooms and zones in this space, until the 2D map of the 3D office exists. */
function FloorMap({ spaceName, rooms, people, onClose }: { spaceName: string; rooms: ReturnType<typeof buildRooms>; people: number; onClose: () => void }) {
  return (
    <div className="absolute right-16 top-1/2 w-[min(18rem,calc(100%-6rem))] -translate-y-1/2 rounded-2xl bg-white/95 p-4 shadow-popover backdrop-blur sm:right-20" role="dialog" aria-label="Floor map">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-sm font-bold text-navy-800">{spaceName}</p>
        <button type="button" onClick={onClose} aria-label="Close floor map" className="rounded-lg p-1 text-ivory-700 hover:bg-ivory-50"><X className="h-4 w-4" /></button>
      </div>
      <p className="mb-2 flex items-center gap-1.5 text-xs text-ivory-700"><Users className="h-3.5 w-3.5" /> Main Floor · {people} online</p>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {rooms.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ivory-50">
            <DoorClosed className="h-4 w-4 shrink-0 text-gold-600" />
            <span className="min-w-0 flex-1 truncate text-navy-800">{r.name}</span>
            <span className="shrink-0 text-xs text-ivory-700">{roomTypeLabel(r.type)} · {r.capacity}</span>
            {r.lockable && <Lock className="h-3.5 w-3.5 shrink-0 text-ivory-700" aria-label="Lockable" />}
            {r.knock_to_enter && <Hand className="h-3.5 w-3.5 shrink-0 text-ivory-700" aria-label="Knock to enter" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
