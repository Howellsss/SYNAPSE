import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, X, Loader2, WifiOff, Gauge, Footprints } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/lib/router';
import { listSpaces } from '@/lib/spaces';
import { characterFileUrls, listCharacters, saveMyCharacter } from '@/lib/characters';
import { usePlatformAdmin } from '@/lib/platformAdmin';
import { spaceTypeInfo } from '@/spatial/data/spaceTypes';
import { templateInfo } from '@/spatial/data/templates';
import { buildRooms } from '@/spatial/data/rooms';
import { can } from '@/spatial/access';
import { loadStatus, saveStatus, type PresenceStatus } from '@/spatial/net/status';
import { useSpaceChannel, type MeInput } from '@/spatial/net/useSpaceChannel';
import { useAway } from '@/spatial/net/useAway';
import { EMOTE_EMOJI } from '@/spatial/net/emotes';
import type { EmoteKind, EmoteMsg, PresenceMeta } from '@/spatial/net/protocol';
import type { LocalState } from '@/spatial/net/moveSender';
import { characterFor, chosenCharacterId, pickSpaceCharacter, resolveSpaceClips } from '@/spatial/scene/avatarClips';
import { floorFor } from '@/spatial/scene/floor';
import type { SceneCharacter, SceneControls } from '@/components/spaces/scene/SpaceScene';
import { CharacterPicker } from '@/components/spaces/CharacterPicker';
import { loadQuality, saveQuality, type GraphicsQuality } from '@/spatial/quality';
import { normalizeMediaPrefs } from '@/spatial/media/devices';
import { TypeArt } from '@/components/spaces/TypeArt';
import { SpaceSettingsDrawer } from '@/components/spaces/SpaceSettingsDrawer';
import { DeviceCheckModal } from '@/components/spaces/DeviceCheck';
import { useLiveKitRoom } from '@/spatial/media/useLiveKitRoom';
import { useCallShortcuts } from '@/spatial/media/shortcuts';
import { useProximity } from '@/spatial/media/useProximity';
import { useMediaPrefs } from '@/spatial/media/useMediaPrefs';
import { CallNotices } from './CallNotices';
import { VideoStrip } from './VideoStrip';
import { FloorMap } from './FloorMap';
import { PeoplePanel, PeopleCountButton } from './PeoplePanel';
import { ConnectionPill, ControlBar, WorldToolbar } from './Overlay';
import { InviteToSpace } from './InviteToSpace';
import type { Character, Space } from '@/types';

// three.js is large; load the 3D world only inside a space.
const SpaceScene = lazy(() => import('@/components/spaces/scene/SpaceScene'));

/** Shown once per browser session to people who haven't chosen a character yet. */
const PICKER_PROMPTED_KEY = 'synapse.characterPickerPrompted';
/** Share my position with proximity (React state) only when I've moved this far, not every frame. */
const POS_STEP = 0.25;

/**
 * Inside a space: people panel on the left, the 3D world on the right with floating controls.
 * The world is an open floor sized to the team where everyone appears as the workspace's
 * character (Characters page), until the art kit brings rooms and furniture.
 */
export function SpaceRoom({ space, closedNote, onSpaceChange }: { space: Space; closedNote: string | null; onSpaceChange: (s: Space) => void }) {
  const { user, profile, role, workspace, refreshProfile } = useAuth();
  const [, navigate] = useRouter();
  const [status, setStatus] = useState<PresenceStatus>(loadStatus);
  const [quality, setQuality] = useState<GraphicsQuality>(loadQuality);
  const [otherSpaces, setOtherSpaces] = useState<Space[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);

  const { toast } = useToast();
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email?.split('@')[0] || 'You';
  const away = useAway();
  // Where I am (set by the 3D scene as I walk).
  const [myPos, setMyPos] = useState<{ x: number; z: number } | null>(null);
  const [myZone] = useState<string | null>(null);
  const [myGroup, setMyGroup] = useState<string[]>([]);
  const [myLocks, setMyLocks] = useState<string[]>([]);
  const me = useMemo<MeInput | null>(() => (user ? {
    userId: user.id, name, avatarUrl: profile?.avatar_url ?? null, avatarHash: null, status,
    zoneId: myZone, deskId: null, conversation: myGroup, locks: myLocks, characterId: chosenCharacterId(profile?.avatar_config),
  } : null), [user, name, profile?.avatar_url, profile?.avatar_config, status, myZone, myGroup, myLocks]);
  const { people, connection, remotes, updateLocal, startPath, endPath, sendEmote, onEmote, sendKnock, sendAdmit, onRoomSignal } = useSpaceChannel(space.id, me, away);

  // The scene reports where I am every frame: the network sender decides what to send, and
  // proximity hears about it when I've moved a little.
  const lastPos = useRef<{ x: number; z: number } | null>(null);
  const onLocal = useCallback((state: LocalState) => {
    updateLocal(state);
    const prev = lastPos.current;
    if (!prev || Math.hypot(prev.x - state.x, prev.z - state.z) >= POS_STEP) {
      lastPos.current = { x: state.x, z: state.z };
      setMyPos({ x: state.x, z: state.z });
    }
  }, [updateLocal]);

  // The SYNAPSE character library: everyone appears as the character they chose, else the default.
  const [library, setLibrary] = useState<{ list: Character[]; urls: Record<string, string>; loaded: boolean }>({ list: [], urls: {}, loaded: false });
  useEffect(() => {
    if (!user) { setLibrary({ list: [], urls: {}, loaded: true }); return; }
    let alive = true;
    (async () => {
      const { data } = await listCharacters();
      const urls = await characterFileUrls(data);
      if (alive) setLibrary({ list: data, urls, loaded: true });
    })();
    return () => { alive = false; };
  }, [user]);
  const sceneLibrary = useMemo<SceneCharacter[]>(
    () => library.list.filter((c) => library.urls[c.id]).map((c) => ({ id: c.id, url: library.urls[c.id], clips: resolveSpaceClips(c) })),
    [library],
  );
  const defaultCharacterId = useMemo(() => pickSpaceCharacter(library.list)?.id ?? null, [library.list]);
  const myChoice = chosenCharacterId(profile?.avatar_config);
  const myCharacterId = library.list.some((c) => c.id === myChoice) ? myChoice : null;
  const isPlatformAdmin = usePlatformAdmin() === true;
  const [pickerOpen, setPickerOpen] = useState(false);
  // First visit without a choice: offer the picker once per session.
  useEffect(() => {
    if (!library.loaded || !library.list.length || myChoice) return;
    try {
      if (sessionStorage.getItem(PICKER_PROMPTED_KEY)) return;
      sessionStorage.setItem(PICKER_PROMPTED_KEY, '1');
    } catch { /* private mode: still show it */ }
    setPickerOpen(true);
  }, [library.loaded, library.list.length, myChoice]);
  const chooseCharacter = useCallback(async (characterId: string) => {
    if (!user) return false;
    const { error } = await saveMyCharacter(user.id, profile?.avatar_config ?? null, characterId);
    if (error) { toast(`Couldn't save your character. ${error}`, 'error'); return false; }
    await refreshProfile();
    toast(`You now appear as ${library.list.find((c) => c.id === characterId)?.name ?? 'your new character'}.`);
    return true;
  }, [user, profile?.avatar_config, refreshProfile, toast, library.list]);
  const sceneControls = useRef<SceneControls | null>(null);
  const [localEmote, setLocalEmote] = useState<{ kind: EmoteKind; id: number } | null>(null);
  const [hintOpen, setHintOpen] = useState(true);
  const floor = floorFor(space.size_band);
  // Always list yourself, even before (or without) the presence channel answering.
  const shown = useMemo<PresenceMeta[]>(
    () => (!me || people.some((p) => p.userId === me.userId) ? people : [...people, { ...me, away, joinedAt: '' }].sort((a, b) => a.name.localeCompare(b.name))),
    [people, me, away],
  );
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [bubbles, setBubbles] = useState<{ id: number; text: string }[]>([]);

  // Emotes from others: a bubble over the world, a toast for a wave aimed at you, and hands.
  useEffect(() => onEmote((e: EmoteMsg) => {
    const who = people.find((p) => p.userId === e.userId)?.name ?? 'Someone';
    if (e.kind === 'raise_hand' || e.kind === 'lower_hand') {
      setRaisedHands((s) => {
        const next = new Set(s);
        if (e.kind === 'raise_hand') next.add(e.userId); else next.delete(e.userId);
        return next;
      });
      if (e.kind === 'raise_hand') toast(`${who} raised their hand ✋`, 'info');
      return;
    }
    if (e.to) { toast(`${who} waved at you 👋`, 'info'); return; }
    const id = Date.now() + Math.random();
    setBubbles((b) => [...b.slice(-4), { id, text: `${who} ${EMOTE_EMOJI[e.kind]}` }]);
    window.setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), 3500);
  }), [onEmote, people, toast]);

  // Forget hands of people who left.
  useEffect(() => {
    setRaisedHands((s) => {
      const ids = new Set(people.map((p) => p.userId));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [people]);

  const react = useCallback((kind: 'wave' | 'cheer' | 'heart') => {
    sendEmote(kind);
    setLocalEmote({ kind, id: Date.now() });
    const id = Date.now() + Math.random();
    setBubbles((b) => [...b.slice(-4), { id, text: `You ${EMOTE_EMOJI[kind]}` }]);
    window.setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), 3500);
  }, [sendEmote]);
  const raiseHand = (raised: boolean) => {
    setHandRaised(raised);
    sendEmote(raised ? 'raise_hand' : 'lower_hand');
  };
  // Re-announce a raised hand after reconnecting, so people who joined meanwhile see it.
  useEffect(() => { if (connection === 'connected' && handRaised) sendEmote('raise_hand'); }, [connection]); // eslint-disable-line react-hooks/exhaustive-deps
  const hands = useMemo(() => {
    const s = new Set(raisedHands);
    if (handRaised && user) s.add(user.id);
    return s;
  }, [raisedHands, handRaised, user]);

  useEffect(() => {
    if (!workspace) return;
    listSpaces(workspace.id).then(({ data }) => setOtherSpaces(data.filter((s) => s.id !== space.id)));
  }, [workspace, space.id]);

  const media = normalizeMediaPrefs(profile?.media_prefs);
  const [, updatePrefs] = useMediaPrefs();
  const call = useLiveKitRoom(space.id, { prefs: media, onNotice: (m, tone) => toast(m, tone ?? 'info') });
  useCallShortcuts({ mic: () => { void call.toggleMic(); }, cam: () => { void call.toggleCam(); } });
  const canInvite = can(space.permissions, 'invite', role);
  const canEdit = can(space.permissions, 'edit_office', role);
  const info = spaceTypeInfo(space.space_type);
  const template = templateInfo(space.template_key);
  const rooms = useMemo(() => (space.config?.rooms?.length ? space.config.rooms : buildRooms(space.template_key, space.size_band)), [space.config, space.template_key, space.size_band]);
  const canLock = can(space.permissions, 'lock_rooms', role);

  const proximity = useProximity({
    room: call.room, meId: user?.id ?? null, myPos, myZone, people: shown, remotes, rooms, dataSaver: media.data_saver,
  });
  useEffect(() => { setMyGroup((g) => (g.join() === proximity.myGroup.join() ? g : proximity.myGroup)); }, [proximity.myGroup]);

  // Locked rooms: locked while whoever locked them is here.
  const locked = useMemo(() => new Set([...people.flatMap((p) => p.locks), ...myLocks]), [people, myLocks]);
  const [admitted, setAdmitted] = useState<Set<string>>(new Set());
  const [knocks, setKnocks] = useState<{ userId: string; zoneId: string }[]>([]);
  const roomName = useCallback((id: string) => rooms.find((r) => r.id === id)?.name ?? 'the room', [rooms]);
  useEffect(() => onRoomSignal(({ knock, admit }) => {
    if (knock && knock.zoneId === myZone) {
      setKnocks((k) => (k.some((x) => x.userId === knock.userId && x.zoneId === knock.zoneId) ? k : [...k, knock]));
    }
    if (admit) {
      setAdmitted((s) => new Set(s).add(admit.zoneId));
      toast(`${people.find((p) => p.userId === admit.userId)?.name ?? 'Someone'} let you into ${roomName(admit.zoneId)}`, 'info');
    }
  }), [onRoomSignal, myZone, people, roomName, toast]);
  const toggleLock = (zoneId: string) => setMyLocks((l) => (l.includes(zoneId) ? l.filter((z) => z !== zoneId) : [...l, zoneId]));
  const knock = (zoneId: string) => { sendKnock(zoneId); toast(`You knocked on ${roomName(zoneId)}`); };

  // Suggest data saver when the connection has been poor for a while.
  const [saverDismissed, setSaverDismissed] = useState(false);
  const [suggestSaver, setSuggestSaver] = useState(false);
  useEffect(() => {
    if (call.connectionQuality !== 'poor' || media.data_saver || saverDismissed) { setSuggestSaver(false); return; }
    const t = window.setTimeout(() => setSuggestSaver(true), 8000);
    return () => window.clearTimeout(t);
  }, [call.connectionQuality, media.data_saver, saverDismissed]);

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
      raisedHands={hands}
      conversation={proximity.myGroup}
      onWave={(id) => { sendEmote('wave', id); toast(`You waved at ${people.find((p) => p.userId === id)?.name ?? 'them'} 👋`); }}
      onWalkTo={(id) => {
        setSheetOpen(false);
        if (!sceneControls.current?.walkTo(id)) toast("They haven't appeared on the floor yet.", 'info');
      }}
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
          {user && library.loaded && (
            <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-ivory-300" /></div>}>
              <SpaceScene
                library={sceneLibrary}
                defaultCharacterId={defaultCharacterId}
                myCharacterId={myCharacterId}
                floor={floor}
                quality={quality}
                meId={user.id}
                people={shown}
                raisedHands={hands}
                remotes={remotes}
                groups={proximity.groups}
                onLocal={onLocal}
                startPath={startPath}
                endPath={endPath}
                onEmote={onEmote}
                localEmote={localEmote}
                controls={sceneControls}
                onCharacterError={(m) => toast(m, 'error')}
              />
            </Suspense>
          )}
        </div>
        <h1 className="sr-only">{space.name} · {info.name}{template ? ` · ${template.name}` : ''}</h1>

        {hintOpen && (
          <div className="absolute inset-x-0 bottom-36 z-10 flex justify-center px-3 lg:bottom-24">
            <p className="flex max-w-md items-center gap-2 rounded-2xl bg-white/95 px-4 py-2 text-sm text-navy-800 shadow-popover backdrop-blur">
              <Footprints className="h-4 w-4 shrink-0 text-gold-600" />
              <span className="min-w-0 flex-1">
                Click or tap the floor to walk, or use the arrow keys or WASD.
                {library.loaded && library.list.length > 0 && <> <button type="button" className="font-semibold text-gold-700 underline" onClick={() => setPickerOpen(true)}>Choose your character</button>.</>}
                {library.loaded && !library.list.length && (isPlatformAdmin
                  ? <> Everyone shows as a simple figure until a character is added on the <button type="button" className="font-semibold text-gold-700 underline" onClick={() => navigate('/characters')}>Characters</button> page.</>
                  : <> Everyone shows as a simple figure for now.</>)}
              </span>
              <button type="button" onClick={() => setHintOpen(false)} aria-label="Hide tip" className="rounded-lg p-1 text-ivory-700 hover:bg-ivory-50"><X className="h-4 w-4" /></button>
            </p>
          </div>
        )}

        {/* Video strip (filled by proximity video) */}
        <div className="absolute inset-x-0 top-3 z-10 flex justify-center pl-16 pr-3 sm:px-16 lg:left-64 lg:right-4 lg:px-0">
          <VideoStrip room={call.room} inRange={proximity.inRange} people={shown} activeSpeakers={call.activeSpeakers} />
        </div>

        {knocks.length > 0 && (
          <div className="absolute right-16 top-28 z-10 flex w-72 flex-col gap-2 sm:right-20">
            {knocks.map((k) => (
              <div key={k.userId + k.zoneId} role="alert" className="rounded-2xl bg-white p-3 text-sm text-navy-800 shadow-popover">
                <p><strong>{people.find((p) => p.userId === k.userId)?.name ?? 'Someone'}</strong> is knocking on {roomName(k.zoneId)}.</p>
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" className="btn-ghost !px-3 !py-1.5" onClick={() => setKnocks((x) => x.filter((y) => y !== k))}>Ignore</button>
                  <button type="button" className="btn-primary !px-3 !py-1.5" onClick={() => { sendAdmit(k.userId, k.zoneId); setKnocks((x) => x.filter((y) => y !== k)); }}>Let in</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {suggestSaver && (
          <div className="absolute inset-x-0 bottom-[17rem] z-10 flex justify-center px-3 lg:bottom-40">
            <div role="alert" className="flex max-w-md items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-navy-800 shadow-popover">
              <Gauge className="h-5 w-5 shrink-0 text-gold-600" />
              <p className="min-w-0 flex-1"><strong>Your connection is weak.</strong> Turn on Data saver? Audio first, at most 2 small videos.</p>
              <button type="button" className="btn-ghost !px-2 !py-1.5" onClick={() => setSaverDismissed(true)}>Not now</button>
              <button type="button" className="btn-primary !px-3 !py-1.5" onClick={() => { void updatePrefs({ data_saver: true }); setSaverDismissed(true); toast('Data saver is on'); }}>Turn on</button>
            </div>
          </div>
        )}

        {(connection === 'reconnecting' || connection === 'offline') && (
          <div className="absolute inset-x-0 top-14 z-10 flex justify-center px-16">
            <p role="alert" className="inline-flex items-center gap-2 rounded-full bg-gold-400 px-4 py-2 text-sm font-semibold text-navy-900 shadow-popover">
              {connection === 'offline' ? <WifiOff className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
              {connection === 'offline' ? "You're offline. We'll reconnect when you're back." : 'Reconnecting…'}
            </p>
          </div>
        )}

        {bubbles.length > 0 && (
          <ul className="pointer-events-none absolute left-1/2 top-24 flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
            {bubbles.map((b) => (
              <li key={b.id} className="animate-scale-in rounded-full bg-white/95 px-4 py-1.5 text-sm font-semibold text-navy-800 shadow-popover">{b.text}</li>
            ))}
          </ul>
        )}

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
            onCenter={() => sceneControls.current?.center()}
            onZoomIn={() => sceneControls.current?.zoomIn()}
            onZoomOut={() => sceneControls.current?.zoomOut()}
            mapOpen={mapOpen}
            onToggleMap={() => setMapOpen((v) => !v)}
            onEdit={() => setEditOpen(true)}
            onCharacter={library.list.length ? () => setPickerOpen(true) : undefined}
          />
        </div>

        {mapOpen && (
          <FloorMap
            spaceName={space.name}
            rooms={rooms}
            people={shown}
            locked={locked}
            myLocks={myLocks}
            canLock={canLock}
            admitted={admitted}
            myZone={myZone}
            onToggleLock={toggleLock}
            onKnock={knock}
            onClose={() => setMapOpen(false)}
          />
        )}

        <div className="absolute bottom-24 left-3 flex flex-col items-start gap-2 sm:left-4 lg:bottom-auto lg:top-4">
          <div className="lg:hidden"><PeopleCountButton count={shown.length} onClick={() => setSheetOpen(true)} /></div>
          <ConnectionPill state={connection} call={call.state} quality={call.connectionQuality} />
        </div>

        <CallNotices call={call} onOpenSettings={() => setDevicesOpen(true)} />

        <div className="absolute inset-x-0 bottom-4 flex justify-center px-3">
          <ControlBar
            call={call}
            onLeave={() => navigate('/workspace')}
            onSettings={() => setDevicesOpen(true)}
            onReact={react}
            handRaised={handRaised}
            onHand={raiseHand}
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
      <CharacterPicker
        open={pickerOpen}
        library={library.list}
        urls={library.urls}
        currentId={characterFor(library.list, myChoice)?.id ?? null}
        onClose={() => setPickerOpen(false)}
        onChoose={chooseCharacter}
      />
      <DeviceCheckModal open={devicesOpen} onClose={() => { setDevicesOpen(false); void call.applySavedDevices(); }} />
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
