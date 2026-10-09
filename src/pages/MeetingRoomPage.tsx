import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Check, ChevronDown, Copy, RefreshCw, Smartphone, Hand, Info, LayoutGrid, MessageSquare, Mic, MicOff, MonitorUp, MoreHorizontal, PenLine, PhoneOff,
  SearchX, Settings2, SmilePlus, Users, Video, VideoOff, Camera, X, Clock, LogOut, Maximize2, Minimize2, PictureInPicture2, Pin, PinOff, Shield, ShieldCheck, XCircle,
  Lock, DoorOpen, BarChart3, Presentation, Sparkles, Captions as CaptionsIcon, FileText, EyeOff, Eye, Split, Circle, Square, Download,
} from 'lucide-react';
import type { LocalTrack, RemoteTrack, Room, Track } from 'livekit-client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { endMeeting, getMeetingByCode, getMeetingByInvite, markRemoved, reopenMeeting, updateMeetingSettings, type Meeting } from '@/lib/meetings';
import { inviteUrl } from '@/meetings/codes';
import { REACTIONS, elapsed, isRefresh, isStopShare, newChatId, parseChat, parseControl, parseHostRequest, parseReact, type Reaction } from '@/meetings/messages';
import { TOPICS, useMeetingBus } from '@/meetings/useMeetingBus';
import { useActiveDevices, type DeviceKind } from '@/meetings/useActiveDevices';
import { normalizeMediaPrefs, problemText } from '@/spatial/media/devices';
import { useLiveKitRoom, type LiveKitRoom } from '@/spatial/media/useLiveKitRoom';
import { useMediaCheck } from '@/spatial/media/useMediaCheck';
import { deviceLabel, useDevices } from '@/spatial/media/useDevices';
import { iphoneStatus, isIphoneDevice, isMacDesktop } from '@/spatial/media/continuity';
import { IphoneCameraHelp } from '@/components/meetings/IphoneCameraHelp';
import { useCallShortcuts, SHORTCUTS } from '@/spatial/media/shortcuts';
import { DeviceCheckModal } from '@/components/spaces/DeviceCheck';
import { CallNotices } from '@/components/spaces/room/CallNotices';
import { Popover } from '@/components/spaces/room/Popover';
import { AnnotationLayer } from '@/components/meetings/AnnotationLayer';
import { AudioButton, ToolButton, VideoButton, darkItem, darkPanel } from '@/components/meetings/MeetingControls';
import { BackgroundsPanel, CaptionsOverlay, ChatPanel, ParticipantsPanel, PollsPanel, TranscriptPanel, type ChatLine } from '@/components/meetings/MeetingPanels';
import { useCaptions } from '@/meetings/useCaptions';
import { useRecorder } from '@/meetings/useRecorder';
import { transcriptText } from '@/meetings/captions';
import { BreakoutPanel } from '@/components/meetings/BreakoutPanel';
import { parseBreakout, roomOf, timeLeft } from '@/meetings/breakouts';
import type { BreakoutState } from '@/lib/meetings';
import { useBackground } from '@/meetings/useBackground';
import { usePolls } from '@/meetings/usePolls';
import { Whiteboard } from '@/components/meetings/Whiteboard';
import { useWhiteboard } from '@/meetings/useWhiteboard';
import { RefusedScreen, WaitingBanner, WaitingList, WaitingScreen } from '@/components/meetings/WaitingRoom';
import { useWaitingRoom } from '@/meetings/useWaitingRoom';
import { HowellsLogo } from '@/components/layout/Sidebar';
import { Avatar } from '@/components/ui/Avatar';
import { LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';

type Stage = 'prejoin' | 'call' | 'left' | 'ended';
interface JoinChoice { mic: boolean; cam: boolean }

/** Someone joining through an invite link without signing in: their typed name and the invite. */
interface GuestInfo { invite: string | null; name: string; setName: (n: string) => void; isGuest: boolean }
const GuestContext = createContext<GuestInfo>({ invite: null, name: '', setName: () => {}, isGuest: false });
const GUEST_NAME_KEY = 'synapse.guestName';
const readGuestName = () => { try { return localStorage.getItem(GUEST_NAME_KEY) ?? ''; } catch { return ''; } };

/**
 * /meetings/<code>: preview camera & mic, then the video call. Full screen.
 * With ?invite=<token> anyone can join: people without an account type their name and join as guests.
 */
export function MeetingRoomPage({ code, invite = null }: { code: string; invite?: string | null }) {
  const { user } = useAuth();
  const [guestName, setGuestNameState] = useState(readGuestName);
  const setGuestName = useCallback((n: string) => {
    setGuestNameState(n);
    try { localStorage.setItem(GUEST_NAME_KEY, n); } catch { /* private mode */ }
  }, []);
  return (
    <GuestContext.Provider value={{ invite, name: guestName, setName: setGuestName, isGuest: !user }}>
      <MeetingRoom code={code} invite={invite} />
    </GuestContext.Provider>
  );
}

function MeetingRoom({ code, invite }: { code: string; invite: string | null }) {
  const [, navigate] = useRouter();
  const { user } = useAuth();
  const guest = useContext(GuestContext);
  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  const [stage, setStage] = useState<Stage>('prejoin');
  const [endedBy, setEndedBy] = useState<'you' | 'host' | 'removed' | null>(null);
  const [join, setJoin] = useState<JoinChoice>({ mic: true, cam: true });

  useEffect(() => {
    let active = true;
    (async () => {
      // Members see their account's meetings; anyone else needs the invite link.
      let data = user ? (await getMeetingByCode(code.toUpperCase())).data : null;
      if (!data && invite) data = await getMeetingByInvite(code.toUpperCase(), invite);
      if (!active) return;
      setMeeting(data);
      if (data?.ended_at) setStage('ended');
    })();
    return () => { active = false; };
  }, [code, invite, user]);

  const home = () => navigate(user ? '/meetings' : '/');

  /** The meeting as the server has it now (members by code, guests through the invite). */
  const refresh = useCallback(async (): Promise<Meeting | null> => {
    let m = user ? (await getMeetingByCode(code.toUpperCase())).data : null;
    if (!m && invite) m = await getMeetingByInvite(code.toUpperCase(), invite);
    return m;
  }, [code, invite, user]);
  const hasEnded = useCallback(async () => !!(await refresh())?.ended_at, [refresh]);

  // After leaving, check before offering Rejoin: if the host has ended it, say so instead.
  const hostUser = !!user && !!meeting && user.id === meeting.host_id;
  useEffect(() => {
    // The host can always come back (Rejoin opens the meeting again).
    if (stage !== 'left' || hostUser) return;
    let alive = true;
    hasEnded().then((ended) => { if (alive && ended) { setEndedBy('host'); setStage('ended'); } });
    return () => { alive = false; };
  }, [stage, hasEnded, hostUser]);

  const rejoin = async () => {
    if (await hasEnded()) {
      if (hostUser && meeting) {
        const err = await reopenMeeting(meeting.id);
        if (!err) { setMeeting({ ...meeting, ended_at: null }); setStage('call'); return; }
      }
      setEndedBy('host'); setStage('ended'); return;
    }
    setStage('call');
  };

  if (meeting === undefined) return <div className="flex min-h-screen items-center justify-center bg-white"><LoadingSpinner className="h-10 w-10" /></div>;

  if (meeting === null) {
    return (
      <Center>
        <SearchX className="mx-auto h-10 w-10 text-navy-400" />
        <h1 className="mt-4 text-xl font-bold">Meeting not found</h1>
        <p className="mt-2 text-sm text-ivory-700">{invite ? 'This invite link isn\'t valid any more. Ask the host to send it again.' : 'Check the code, or ask the host for an invite link.'}</p>
        <button onClick={home} className="btn-primary mt-6"><ArrowLeft className="h-4 w-4" /> {user ? 'Back to meetings' : 'Go to SYNAPSE'}</button>
      </Center>
    );
  }

  if (stage === 'ended' || stage === 'left') {
    return (
      <Center>
        <h1 className="text-2xl font-bold">{stage === 'left' ? 'You left the meeting' : endedBy === 'removed' ? 'The host removed you from the meeting' : endedBy === 'host' ? 'The host ended the meeting' : 'This meeting has ended'}</h1>
        <p className="mt-2 text-sm text-ivory-700">{meeting.title} · Room {meeting.code}</p>
        <div className="mt-6 flex justify-center gap-3">
          {stage === 'left' && <button onClick={() => { void rejoin(); }} className="btn-secondary">Rejoin</button>}
          {user
            ? <button onClick={() => navigate('/meetings')} className="btn-primary">Back to meetings</button>
            : <button onClick={() => navigate('/signup')} className="btn-primary">Create your free SYNAPSE account</button>}
        </div>
        {!user && guest.isGuest && <p className="mt-4 text-sm text-ivory-700">Host your own meetings, calendars and contacts in one place.</p>}
      </Center>
    );
  }

  const isHost = !!user && user.id === meeting.host_id;
  if (stage === 'prejoin') {
    return <PreJoin meeting={meeting} isHost={isHost} onJoin={(c) => { setJoin(c); setStage('call'); }} onBack={home} />;
  }

  return (
    <InCall
      meeting={meeting}
      join={join}
      onLeave={() => setStage('left')}
      onEnded={(by) => { setEndedBy(by); setStage('ended'); }}
      onHome={home}
      refresh={refresh}
    />
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-white p-6 text-center text-navy-900">
      <div className="max-w-md">{children}</div>
    </div>
  );
}

function useCopyLink(meeting: Meeting) {
  const { toast } = useToast();
  const { code, invite_token: token } = meeting;
  return useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl({ code, invite_token: token }));
      toast(token ? 'Invite link copied. Anyone with it can join.' : 'Meeting link copied');
    } catch { toast('Could not copy the link', 'error'); }
  }, [code, token, toast]);
}

function useYou() {
  const { user, profile } = useAuth();
  const guest = useContext(GuestContext);
  const name = user
    ? [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user.email?.split('@')[0] || 'You'
    : `${guest.name.trim() || 'Guest'} (Guest)`;
  return { id: user?.id ?? 'me', name, firstName: profile?.first_name, lastName: profile?.last_name, avatarUrl: profile?.avatar_url ?? null };
}

// ---------------------------------------------------------------- before joining

function PreJoin({ meeting, isHost, onJoin, onBack }: { meeting: Meeting; isHost: boolean; onJoin: (c: JoinChoice) => void; onBack: () => void }) {
  const { profile } = useAuth();
  const guest = useContext(GuestContext);
  const needsName = guest.isGuest && !guest.name.trim();
  const nameRef = useRef<HTMLInputElement>(null);
  const [nameMissing, setNameMissing] = useState(false);
  // The camera preview starts on; the mic follows "join muted" so nobody is heard by surprise.
  const check = useMediaCheck(true, { mic: !normalizeMediaPrefs(profile?.media_prefs).join_muted });
  const you = useYou();
  const copy = useCopyLink(meeting);
  const videoRef = useRef<HTMLVideoElement>(null);
  const showVideo = check.cameraOn && !!check.video;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = check.video;
    if (check.video) el.play().catch(() => {});
  }, [check.video, showVideo]);

  const micLive = check.micOn && !check.micProblem;
  const camLive = check.cameraOn && !check.cameraProblem;
  const problem = (check.cameraOn && check.cameraProblem && problemText(check.cameraProblem, 'camera'))
    || (check.micOn && check.micProblem && problemText(check.micProblem, 'microphone'));
  const iphone = iphoneStatus(check.devices.cameras, check.devices.microphones);
  // On a Mac, look for an iPhone camera straight away (once), the way Google Meet finds it.
  const autoScanned = useRef(false);
  useEffect(() => {
    if (!check.ready || autoScanned.current || iphone === 'camera' || !isMacDesktop()) return;
    autoScanned.current = true;
    void check.rescanDevices();
  }, [check.ready, iphone, check]);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white text-navy-900">
      <header className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-8">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-800"><HowellsLogo className="h-[18px] w-[18px]" /></span>
          <span className="text-[13px] font-semibold tracking-[0.14em]">SYNAPSE</span>
        </div>
        <button type="button" onClick={onBack} className="rounded-lg px-4 py-2 text-sm font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">{guest.isGuest ? 'Go to SYNAPSE' : 'Back to meetings'}</button>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-6 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-700">Ready to join?</p>
        <h1 className="mt-1 break-words font-display text-[28px] font-semibold tracking-tight sm:text-[34px]">{meeting.title}</h1>
        <div className="mb-5 mt-1 flex flex-wrap items-center gap-3 text-sm text-ivory-700">
          <span>Room <strong className="font-mono text-navy-900">{meeting.code}</strong></span>
          {meeting.host_name && <span>Hosted by <strong className="text-navy-900">{meeting.host_name}</strong></span>}
          <button type="button" onClick={copy} className="inline-flex items-center gap-1 font-semibold text-gold-700 hover:text-gold-800"><Copy className="h-4 w-4" /> Copy link</button>
        </div>

        <div className="relative aspect-video overflow-hidden rounded-2xl bg-navy-800 shadow-[0_12px_40px_-12px_rgba(13,28,59,0.35)]">
          {showVideo ? (
            <video ref={videoRef} muted playsInline autoPlay aria-label="Your camera preview" className="h-full w-full -scale-x-100 object-cover" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3">
              <Avatar firstName={you.firstName} lastName={you.lastName} src={you.avatarUrl} size="xl" className="!h-20 !w-20 !text-2xl sm:!h-24 sm:!w-24" />
              <p className="text-xs text-ivory-300">{!check.ready ? 'Starting your camera…' : check.cameraOn ? (check.cameraProblem ? 'Camera unavailable' : 'Starting your camera…') : 'Your camera is off'}</p>
            </div>
          )}
          <span className="absolute left-3 top-3 max-w-[60%] truncate rounded-full bg-black/45 px-3 py-1 text-xs font-semibold text-white backdrop-blur">{you.name}</span>
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3">
            <PillToggle on={check.micOn} onClick={() => check.setMicOn(!check.micOn)} label="Audio" iconOn={Mic} iconOff={MicOff} />
            <PillToggle on={check.cameraOn} onClick={() => check.setCameraOn(!check.cameraOn)} label="Video" iconOn={Video} iconOff={VideoOff} />
          </div>
        </div>

        {guest.isGuest && (
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-semibold text-navy-800">Your name</span>
            <input
              value={guest.name}
              onChange={(e) => guest.setName(e.target.value.slice(0, 60))}
              placeholder="How should people see you?"
              autoComplete="name"
              ref={nameRef}
              aria-invalid={nameMissing && needsName}
              aria-describedby={nameMissing && needsName ? 'guest-name-hint' : undefined}
              aria-label="Your name"
              className={cn('h-12 w-full rounded-lg bg-white px-4 text-sm text-navy-900 ring-1 ring-inset placeholder:text-ivory-600 focus:outline-none focus:ring-2 focus:ring-gold-400', nameMissing && needsName ? 'ring-2 ring-burgundy-500' : 'ring-navy-100')}
            />
            {nameMissing && needsName && <span id="guest-name-hint" role="alert" className="mt-1.5 block text-sm font-medium text-burgundy-600">Type your name to join.</span>}
          </label>
        )}

        {problem && <p role="alert" className="mt-3 rounded-lg bg-burgundy-500/20 px-3 py-2 text-sm text-red-200">{problem} <button type="button" onClick={check.retry} className="font-semibold underline">Try again</button></p>}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <DevicePicker
            label="Microphone"
            icon={Mic}
            value={check.selected.microphone}
            devices={check.devices.microphones}
            fallback="Microphone"
            empty={check.micOn ? undefined : 'Turn on audio to choose'}
            onChange={check.selectMicrophone}
            onRescan={check.rescanDevices}
          />
          <DevicePicker
            label="Camera"
            icon={Camera}
            value={check.selected.camera}
            devices={check.devices.cameras}
            fallback="Camera"
            empty={check.cameraOn ? undefined : 'Turn on video to choose'}
            onChange={check.selectCamera}
            onRescan={check.rescanDevices}
          />
          <button
            type="button"
            onClick={() => {
              // Never a silent button: without a name, say so and put the cursor in the box.
              if (needsName) { setNameMissing(true); nameRef.current?.focus(); return; }
              onJoin({ mic: micLive, cam: camLive });
            }}
            className="h-12 shrink-0 rounded-full bg-gold-400 px-9 text-[15px] font-semibold text-navy-900 hover:bg-gold-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-200"
          >
            {isHost ? 'Start' : guest.isGuest ? 'Join as guest' : 'Join'}
          </button>
        </div>
        {check.ready && iphone !== 'camera' && (iphone === 'mic-only' || isMacDesktop()) && (
          <IphoneCameraHelp key={iphone} status={iphone} onLookAgain={check.rescanDevices} cameras={check.devices.cameras} className="mt-3" />
        )}
      </main>
    </div>
  );
}

function PillToggle({ on, onClick, label, iconOn: On, iconOff: Off }: { on: boolean; onClick: () => void; label: string; iconOn: typeof Mic; iconOff: typeof Mic }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={`${label} ${on ? 'on' : 'off'}`}
      title={`Turn ${label.toLowerCase()} ${on ? 'off' : 'on'}`}
      className={cn('flex h-12 w-12 items-center justify-center rounded-full text-white backdrop-blur transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400', on ? 'bg-white/20 hover:bg-white/30' : 'bg-[#C42B1C] hover:bg-[#A82316]')}
    >
      {on ? <On className="h-5 w-5" /> : <Off className="h-5 w-5" />}
    </button>
  );
}

/**
 * A device dropdown like Google Meet's: every camera or microphone the computer offers
 * (FaceTime HD Camera, iPhone Camera…), the chosen one ticked, and a way to look again.
 */
function DevicePicker({ label, icon: Icon, value, devices, fallback, empty, onChange, onRescan }: {
  label: string; icon: typeof Mic; value?: string; devices: MediaDeviceInfo[]; fallback: string; empty?: string;
  onChange: (id: string) => void; onRescan: () => Promise<void>;
}) {
  const [scanning, setScanning] = useState(false);
  const current = devices.find((d) => d.deviceId === value) ?? devices[0];
  const currentIndex = current ? devices.indexOf(current) : 0;
  const rescan = async () => {
    setScanning(true);
    try { await onRescan(); } finally { setScanning(false); }
  };
  return (
    <div className="min-w-0 flex-1">
      <span className="mb-1.5 block text-xs font-semibold text-navy-800">{label}</span>
      <Popover
        label={`${label} list`}
        panelClassName={cn('bottom-full left-0 mb-2 w-full min-w-[260px] p-1.5', darkPanel)}
        trigger={({ open, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={!devices.length}
            className="flex h-12 w-full items-center gap-2.5 rounded-lg bg-white pl-4 pr-3 text-left text-sm text-navy-900 ring-1 ring-inset ring-navy-100 hover:bg-navy-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 disabled:opacity-60"
          >
            {current && isIphoneDevice(current) ? <Smartphone className="h-4 w-4 shrink-0 text-gold-600" /> : <Icon className="h-4 w-4 shrink-0 text-navy-500" />}
            <span className="min-w-0 flex-1 truncate">{current ? deviceLabel(current, currentIndex, fallback) : empty ?? `No ${label.toLowerCase()} found`}</span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-navy-500 transition', open && 'rotate-180')} />
          </button>
        )}
      >
        {(close) => (
          <>
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ivory-700">{label}</p>
            {devices.map((d, i) => {
              const on = d.deviceId === current?.deviceId;
              const phone = isIphoneDevice(d);
              return (
                <button
                  key={d.deviceId}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() => { onChange(d.deviceId); close(); }}
                  className={cn(darkItem, on && 'font-semibold text-gold-700')}
                >
                  {phone ? <Smartphone className="h-4 w-4 shrink-0" /> : <Icon className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate text-left">{deviceLabel(d, i, fallback)}</span>
                  {on && <Check className="h-4 w-4 shrink-0" />}
                </button>
              );
            })}
            <div className="my-1 h-px bg-sand" />
            <button type="button" role="menuitem" disabled={scanning} onClick={() => { void rescan(); }} className={cn(darkItem, 'disabled:opacity-60')}>
              <RefreshCw className={cn('h-4 w-4 shrink-0', scanning && 'animate-spin')} />
              {scanning ? 'Looking…' : `Look for ${label === 'Camera' ? 'cameras' : 'microphones'}`}
            </button>
          </>
        )}
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------- in the call

interface TileInfo {
  id: string;
  name: string;
  local: boolean;
  video: Track | null;
  screen: Track | null;
  muted: boolean;
  camOff: boolean;
  speaking: boolean;
  avatarUrl?: string | null;
}

function tilesFrom(call: LiveKitRoom, me: { id: string; name: string; avatarUrl: string | null }): TileInfo[] {
  const room = call.room;
  const list: TileInfo[] = [{
    id: me.id, name: me.name, local: true,
    video: call.camOn ? call.localTracks.camera : null, screen: call.screenOn ? call.localTracks.screen : null,
    muted: !call.micOn, camOff: !call.camOn, speaking: call.activeSpeakers.includes(me.id), avatarUrl: me.avatarUrl,
  }];
  if (!room) return list;
  for (const p of room.remoteParticipants.values()) {
    let video: Track | null = null;
    let screen: Track | null = null;
    for (const pub of p.trackPublications.values()) {
      if (!pub.isSubscribed || !pub.track || pub.isMuted) continue;
      if (pub.source === 'camera') video = pub.track;
      if (pub.source === 'screen_share') screen = pub.track;
    }
    list.push({ id: p.identity, name: p.name || 'Guest', local: false, video, screen, muted: !p.isMicrophoneEnabled, camOff: !video, speaking: call.activeSpeakers.includes(p.identity) });
  }
  return list;
}

type SidePanel = 'people' | 'chat' | 'polls' | 'backgrounds' | 'transcript' | 'breakout' | null;
type Layout = 'gallery' | 'speaker';

function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
}

/** How often everyone re-reads the meeting (ended, locked, breakout rooms). */
const LIVE_POLL_MS = 5000;

function InCall({ meeting: initial, join, onLeave, onEnded, onHome, refresh }: {
  meeting: Meeting; join: JoinChoice; onLeave: () => void; onEnded: (by: 'you' | 'host' | 'removed') => void; onHome: () => void; refresh: () => Promise<Meeting | null>;
}) {
  const { workspace } = useAuth();
  // The meeting as it is now: the host can lock it, turn on the waiting room or open breakout rooms.
  const [meeting, setMeeting] = useState(initial);
  const { profile } = useAuth();
  const { toast } = useToast();
  const guestCtx = useContext(GuestContext);
  const account = useYou();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panel, setPanel] = useState<SidePanel>(null);
  const [layout, setLayout] = useState<Layout>('gallery');
  const [annotating, setAnnotating] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [shareVideo, setShareVideo] = useState<HTMLVideoElement | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [unread, setUnread] = useState(0);
  const [reactions, setReactions] = useState<Record<string, { e: Reaction; at: number }>>({});
  const [hands, setHands] = useState<Record<string, boolean>>({});
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  const [shareZoom, setShareZoom] = useState<'fit' | 1 | 1.5 | 2>('fit');
  const [pinned, setPinned] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => toast('Full screen isn’t available here.', 'info'));
  };
  // Started from "Share screen" on the Meetings page: offer to share once connected (needs a click).
  const [wantsShare, setWantsShare] = useState(() => new URLSearchParams(window.location.search || window.location.hash.split('?')[1] || '').get('share') === '1');

  const prefs = { ...normalizeMediaPrefs(profile?.media_prefs), join_muted: !join.mic, join_camera_off: !join.cam };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  // Who we are in the call. Kept while switching rooms, so the breakout plan keeps finding us.
  const [myId, setMyId] = useState(account.id);
  const plan = parseBreakout(meeting.breakout ?? null);
  const planKey = plan?.open ? `${plan.rooms.length}:${plan.ends_at ?? ''}:${Object.keys(plan.assign).length}` : '';
  const [hostRoom, setHostRoom] = useState(0);
  // A participant can step back to the main room until the host changes the rooms.
  const [optedOut, setOptedOut] = useState<string | null>(null);
  const hostHere = myId === meeting.host_id;
  const myRoom = hostHere ? (plan?.open ? hostRoom : 0) : optedOut === planKey ? 0 : roomOf(plan, myId);
  const call = useLiveKitRoom(meeting.id, {
    prefs,
    tokenBody: {
      ...(guestCtx.isGuest ? { meetingCode: meeting.code, invite: guestCtx.invite ?? '', guestName: guestCtx.name.trim() } : guestCtx.invite ? { meetingCode: meeting.code, invite: guestCtx.invite } : { meetingCode: meeting.code }),
      ...(myRoom ? { breakout: myRoom } : {}),
    },
    ticketKey: `synapse.ticket.${meeting.code}`,
    autoSubscribe: true,
    onNotice: (m, tone) => toast(m, tone ?? 'info'),
  });
  const room = call.room;
  // Guests get their identity from the server (guest_…), so "you" is whoever this room says we are.
  const liveId = room?.localParticipant?.identity;
  useEffect(() => { if (liveId) setMyId(liveId); }, [liveId]);
  const you = { ...account, id: liveId || myId };
  const bus = useMeetingBus(room);
  const devices = useDevices(true);
  const { active, choose } = useActiveDevices(room);
  useCallShortcuts({ mic: () => { void call.toggleMic(); }, cam: () => { void call.toggleCam(); } });
  useMeetingAudio(room);
  const copy = useCopyLink(meeting);
  const isHost = you.id === meeting.host_id;
  const now = useNow(startedAt !== null);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const handsRef = useRef(hands);
  handsRef.current = hands;

  useEffect(() => { if (call.state === 'connected' && startedAt === null) setStartedAt(Date.now()); }, [call.state, startedAt]);
  useEffect(() => {
    const top = call.activeSpeakers.find((id) => id !== you.id);
    if (top) setLastSpeaker(top);
  }, [call.activeSpeakers, you.id]);

  const tiles = tilesFrom(call, { id: you.id, name: you.name, avatarUrl: you.avatarUrl });
  const names: Record<string, string> = Object.fromEntries(tiles.map((t) => [t.id, t.name]));
  const namesRef = useRef(names);
  namesRef.current = names;
  const sharer = tiles.find((t) => t.screen);
  const count = tiles.length;

  // Only the host can end the meeting for everyone, or stop someone's screen share.
  const stopShareRef = useRef(call.stopScreenShare);
  stopShareRef.current = call.stopScreenShare;
  const micOnRef = useRef(call.micOn);
  micOnRef.current = call.micOn;
  const toggleMicRef = useRef(call.toggleMic);
  toggleMicRef.current = call.toggleMic;
  useEffect(() => bus.on(TOPICS.control, (raw, from) => {
    if (from !== meeting.host_id) return;
    if (isRefresh(raw)) { void refreshRef.current().then((m) => { if (m) setMeeting((cur) => ({ ...cur, ...m })); }); return; }
    if (isStopShare(raw)) { void stopShareRef.current(); toast('The host stopped your screen share.', 'info'); return; }
    const req = parseHostRequest(raw);
    if (req === 'mute' || req === 'muteAll') {
      if (micOnRef.current) { void toggleMicRef.current(); toast('The host muted you. Unmute when you want to speak.', 'info'); }
      return;
    }
    if (req === 'remove') { room?.disconnect(); onEnded('removed'); return; }
    if (parseControl(raw)) { room?.disconnect(); onEnded('host'); }
  }), [bus, room, meeting.host_id, onEnded, toast]);

  const seenChat = useRef(new Set<string>());
  useEffect(() => bus.on(TOPICS.chat, (raw, from) => {
    const msg = parseChat(raw);
    if (!msg || seenChat.current.has(`${from}:${msg.id}`)) return;
    seenChat.current.add(`${from}:${msg.id}`);
    setChat((c) => [...c, { id: `${from}:${msg.id}`, from, name: namesRef.current[from] ?? 'Guest', text: msg.text, at: Date.now(), mine: false }].slice(-500));
    if (panelRef.current !== 'chat') setUnread((n) => n + 1);
  }), [bus]);

  const showReaction = useCallback((who: string, e: Reaction) => {
    const at = Date.now();
    setReactions((r) => ({ ...r, [who]: { e, at } }));
    window.setTimeout(() => setReactions((r) => (r[who]?.at === at ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== who)) : r)), 4000);
  }, []);

  useEffect(() => bus.on(TOPICS.react, (raw, from) => {
    const msg = parseReact(raw);
    if (!msg) return;
    if (msg.t === 'emoji') showReaction(from, msg.e);
    else setHands((h) => ({ ...h, [from]: msg.up }));
  }), [bus, showReaction]);

  // Tell newcomers your hand is up; forget people who leave.
  useEffect(() => {
    if (!room) return;
    const onJoin = (p: { identity: string }) => { if (handsRef.current[you.id]) void bus.send(TOPICS.react, { t: 'hand', up: true }, { to: [p.identity] }); };
    const onGone = (p: { identity: string }) => setHands((h) => ({ ...h, [p.identity]: false }));
    room.on('participantConnected', onJoin).on('participantDisconnected', onGone);
    return () => { room.off('participantConnected', onJoin).off('participantDisconnected', onGone); };
  }, [room, bus, you.id]);

  const polls = usePolls({ bus, room, isHost, hostId: meeting.host_id, me: you.id });
  // A new poll from the host opens the Polls panel, as Zoom pops the poll up.
  const seenPolls = useRef(0);
  useEffect(() => {
    if (polls.unseen > seenPolls.current && !isHost) { setPanel('polls'); polls.markSeen(); }
    seenPolls.current = polls.unseen;
  }, [polls.unseen, isHost, polls]);

  const bg = useBackground(call.camOn ? call.localTracks.camera : null, (m) => toast(m, 'error'));
  const captions = useCaptions({ bus, room, me: you.id, myName: you.name, micOn: call.micOn, names });
  const recorder = useRecorder({
    bus, room, isHost, hostId: meeting.host_id, meetingId: meeting.id, meetingTitle: meeting.title,
    // Saved to the account that owns the meeting (the host is a member of it).
    workspaceId: workspace?.id === meeting.workspace_id ? meeting.workspace_id : null,
    micTrack: call.micOn ? call.localTracks.microphone?.mediaStreamTrack ?? null : null,
    transcript: () => (captions.transcript.length ? transcriptText(meeting.title, captions.transcript, startedAt ?? undefined) : ''),
    notice: (m, tone) => toast(m, tone ?? 'info'),
  });
  const [fileDismissed, setFileDismissed] = useState<string | null>(null);
  const board = useWhiteboard({ bus, room, me: you.id, hostId: meeting.host_id });
  const sharing = !!sharer;
  useEffect(() => { if (!sharing) setAnnotating(false); }, [sharing]);

  const sendChat = (text: string) => {
    const id = newChatId();
    void bus.send(TOPICS.chat, { t: 'msg', id, text });
    setChat((c) => [...c, { id, from: you.id, name: you.name, text, at: Date.now(), mine: true }].slice(-500));
  };
  const react = (e: Reaction) => { void bus.send(TOPICS.react, { t: 'emoji', e }); showReaction(you.id, e); };
  const toggleHand = () => {
    const up = !hands[you.id];
    void bus.send(TOPICS.react, { t: 'hand', up });
    setHands((h) => ({ ...h, [you.id]: up }));
  };
  const openPanel = (p: SidePanel) => {
    setPanel((cur) => (cur === p ? null : p));
    if (p === 'chat') setUnread(0);
  };

  const onChoose = async (kind: DeviceKind, d: MediaDeviceInfo) => {
    const label = deviceLabel(d, 0, kind === 'videoinput' ? 'camera' : kind === 'audioinput' ? 'microphone' : 'speaker');
    const ok = await choose(kind, d.deviceId);
    toast(ok ? `Switched to ${label}` : `Couldn't switch to ${label}. Another app may be using it.`, ok ? 'info' : 'error');
  };

  const leave = () => {
    // The host leaving an instant meeting nobody else is in: it's over, so it stops showing as live.
    if (isHost && meeting.kind === 'instant' && room && room.remoteParticipants.size === 0) void endMeeting(meeting.id);
    room?.disconnect();
    onLeave();
  };
  const endForAll = async () => {
    const err = await endMeeting(meeting.id);
    if (err) { toast(`Couldn't end the meeting. ${err}`, 'error'); return; }
    // Tell everyone straight away. Hanging up at once can cut the message off, so send it twice
    // and give it a moment to arrive. (Everyone also re-checks with the server every few seconds.)
    await bus.send(TOPICS.control, { t: 'ended' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    await bus.send(TOPICS.control, { t: 'ended' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    room?.disconnect();
    onEnded('you');
  };

  // The server is the source of truth: if the host ended the meeting and the message was lost,
  // this still takes everyone out within a few seconds. It also picks up lock / waiting room /
  // breakout changes.
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  useEffect(() => {
    if (call.state !== 'connected' && call.state !== 'reconnecting') return;
    const t = window.setInterval(async () => {
      const m = await refreshRef.current();
      if (!m) return;
      setMeeting((cur) => ({ ...cur, ...m }));
      if (m.ended_at) { room?.disconnect(); onEndedRef.current('host'); }
    }, LIVE_POLL_MS);
    return () => window.clearInterval(t);
  }, [call.state, room]);

  // Host: the waiting room, and the switches for it and the lock.
  const wr = useWaitingRoom(meeting.id, isHost && call.state === 'connected', (m) => toast(m, 'error'));
  const setSetting = async (patch: { waiting_room?: boolean; locked?: boolean }) => {
    const before = meeting;
    setMeeting((m) => ({ ...m, ...patch }));
    const err = await updateMeetingSettings(meeting.id, patch);
    if (err) { setMeeting(before); toast(err, 'error'); return; }
    if (patch.locked !== undefined) toast(patch.locked ? 'Meeting locked. Nobody new can join.' : 'Meeting unlocked.', 'info');
    if (patch.waiting_room !== undefined) {
      toast(patch.waiting_room ? 'Waiting room on. You’ll let each person in.' : 'Waiting room off. Everyone waiting was let in.', 'info');
      if (!patch.waiting_room) await wr.admit('all');
    }
  };

  // Breakout rooms. The host saves the plan on the meeting; everyone's app follows it.
  const savePlan = async (next: BreakoutState, done?: string) => {
    const before = meeting;
    setMeeting((m) => ({ ...m, breakout: next }));
    const err = await updateMeetingSettings(meeting.id, { breakout: next });
    if (err) { setMeeting(before); toast(err, 'error'); return false; }
    void bus.send(TOPICS.control, { t: 'refresh' });
    if (done) toast(done, 'info');
    return true;
  };
  const closeRooms = async () => {
    if (!plan) return;
    if (await savePlan({ ...plan, open: false }, 'Breakout rooms closed. Everyone is coming back.')) setHostRoom(0);
  };
  useEffect(() => { if (!plan?.open) setHostRoom(0); }, [plan?.open]);
  // Time's up: the host's app closes the rooms.
  const closeRoomsRef = useRef(closeRooms);
  closeRoomsRef.current = closeRooms;
  const endsAt = plan?.open ? plan.ends_at : null;
  useEffect(() => {
    if (!isHost || !endsAt) return;
    const ms = new Date(endsAt).getTime() - Date.now();
    const t = window.setTimeout(() => { void closeRoomsRef.current(); }, Math.max(0, ms));
    return () => window.clearTimeout(t);
  }, [isHost, endsAt]);
  // Tell people where they are as they move.
  const lastRoom = useRef(myRoom);
  useEffect(() => {
    const prev = lastRoom.current;
    lastRoom.current = myRoom;
    if (prev === myRoom) return;
    const name = plan?.rooms.find((r) => r.n === myRoom)?.name;
    if (myRoom) toast(`You're in ${name ?? `Room ${myRoom}`}.`, 'info');
    else if (prev) toast(plan?.open ? 'You’re back in the main room.' : 'Breakout rooms have closed. You’re back in the main room.', 'info');
  }, [myRoom, plan, toast]);
  // The host's message to all rooms.
  const lastMessage = useRef(plan?.message?.at ?? null);
  const messageAt = plan?.message?.at ?? null;
  useEffect(() => {
    if (!messageAt || messageAt === lastMessage.current) return;
    lastMessage.current = messageAt;
    if (!isHost && plan?.message) toast(`Message from the host: ${plan.message.text}`, 'info');
  }, [messageAt, isHost, plan?.message, toast]);
  const myRoomName = plan?.rooms.find((r) => r.n === myRoom)?.name ?? `Room ${myRoom}`;
  const assignedRoom = roomOf(plan, myId);

  const tileProps = (t: TileInfo) => ({
    tile: t, hand: !!hands[t.id], reaction: reactions[t.id]?.e, host: t.id === meeting.host_id,
    pinned: pinned === t.id, onPin: count > 1 ? () => setPinned((p) => (p === t.id ? null : t.id)) : undefined,
  });
  const pinnedTile = pinned ? tiles.find((t) => t.id === pinned) : undefined;
  // Host requests: each person's own app carries them out.
  const hostActions = isHost ? {
    onMute: (id: string) => { void bus.send(TOPICS.control, { t: 'mute' }, { to: [id] }); toast(`Asked ${names[id] ?? 'them'} to mute`, 'info'); },
    onMuteAll: () => { void bus.send(TOPICS.control, { t: 'muteAll' }); toast('Muted everyone else', 'info'); },
    onRemove: (id: string) => {
      void bus.send(TOPICS.control, { t: 'remove' }, { to: [id] });
      // Also on the server, so they can't come straight back with the same link.
      void markRemoved(meeting.id, id);
      toast(`Removed ${names[id] ?? 'them'} from the meeting`, 'info');
    },
  } : undefined;

  let stage: React.ReactNode;
  if (sharer) {
    const fit = shareZoom === 'fit';
    stage = (
      <div className="flex h-full flex-col gap-1.5 lg:flex-row">
        <div className={cn('relative min-h-0 flex-1 rounded-lg bg-navy-900', fit ? 'overflow-hidden' : 'overflow-auto')} data-share-stage>
          <TrackVideo
            track={sharer.screen}
            onVideo={setShareVideo}
            className={fit ? 'h-full w-full object-contain' : 'max-w-none'}
            style={fit || !shareVideo?.videoWidth ? undefined : { width: shareVideo.videoWidth * (shareZoom as number), height: 'auto' }}
          />
          {fit && (
            <AnnotationLayer
              bus={bus}
              me={you.id}
              roles={{ presenter: sharer.id, host: meeting.host_id }}
              video={shareVideo}
              open={annotating}
              onClose={() => setAnnotating(false)}
              names={names}
            />
          )}
        </div>
        <div className="flex shrink-0 gap-1.5 overflow-auto lg:w-60 lg:flex-col">
          {tiles.map((t) => <ParticipantTile key={t.id} {...tileProps(t)} className="aspect-video w-40 shrink-0 lg:w-full" />)}
        </div>
      </div>
    );
  } else if (board.owner) {
    stage = (
      <div className="flex h-full flex-col gap-1.5 lg:flex-row">
        <div className="relative min-h-0 flex-1"><Whiteboard bus={bus} me={you.id} hostId={meeting.host_id} board={board} names={names} /></div>
        <div className="flex shrink-0 gap-1.5 overflow-auto lg:w-60 lg:flex-col">
          {tiles.map((t) => <ParticipantTile key={t.id} {...tileProps(t)} className="aspect-video w-40 shrink-0 lg:w-full" />)}
        </div>
      </div>
    );
  } else if ((layout === 'speaker' || pinnedTile) && count > 1) {
    const main = pinnedTile ?? tiles.find((t) => t.id === lastSpeaker) ?? tiles.find((t) => !t.local) ?? tiles[0];
    stage = (
      <div className="flex h-full flex-col gap-1.5">
        <div className="flex h-20 shrink-0 justify-center gap-1.5 overflow-x-auto sm:h-28">
          {tiles.filter((t) => t !== main).map((t) => <ParticipantTile key={t.id} {...tileProps(t)} className="aspect-video h-full shrink-0" />)}
        </div>
        <ParticipantTile {...tileProps(main)} className="min-h-0 flex-1" big />
      </div>
    );
  } else {
    stage = (
      <div className={cn('grid h-full auto-rows-fr gap-1.5', count === 1 ? 'grid-cols-1' : count <= 4 ? 'grid-cols-1 sm:grid-cols-2' : count <= 9 ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
        {tiles.map((t) => <ParticipantTile key={t.id} {...tileProps(t)} big={count === 1} />)}
      </div>
    );
  }

  const popOut = async () => {
    try { await shareVideo?.requestPictureInPicture(); } catch { toast('Pop out isn’t available in this browser.', 'info'); }
  };
  const stopTheirShare = () => {
    if (!sharer) return;
    void bus.send(TOPICS.control, { t: 'stopShare' }, { to: [sharer.id] });
    toast(`Asked ${sharer.name} to stop sharing`, 'info');
  };

  if (call.state === 'waiting') return <WaitingScreen title={meeting.title} hostName={meeting.host_name} onLeave={leave} />;
  if (call.state === 'unavailable' && call.error && /\bhost\b/i.test(call.error)) {
    // Turned away, removed, or the meeting is locked: a clear screen, not a broken call.
    const locked = /locked/i.test(call.error);
    return <RefusedScreen message={call.error} locked={locked} onBack={onHome} backLabel={guestCtx.isGuest ? 'Go to SYNAPSE' : 'Back to meetings'} onRetry={locked ? call.retry : undefined} />;
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-white text-navy-900">
      {/* Top bar: meeting info on the left, what's on screen in the middle, time and view on the right */}
      <header className="relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-sand bg-white px-2 sm:px-3">
        <button type="button" onClick={() => setInfoOpen((v) => !v)} aria-label="Meeting information" title="Meeting information" className="flex h-8 w-8 items-center justify-center rounded-md text-navy-700 hover:bg-navy-50"><Info className="h-[18px] w-[18px]" /></button>
        <span className="flex h-8 w-8 items-center justify-center text-green-600" title="Audio, video and chat are encrypted in transit" aria-label="Encrypted"><ShieldCheck className="h-[18px] w-[18px]" /></span>
        <h1 className="min-w-0 truncate text-sm font-semibold">{meeting.title}</h1>
        <span className="hidden shrink-0 text-xs text-ivory-700 md:inline">· Room {meeting.code} · {count} {count === 1 ? 'person' : 'people'}</span>
        {myRoom > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold-50 py-0.5 pl-2 pr-1 text-[11px] font-semibold text-navy-900 ring-1 ring-inset ring-gold-200" data-breakout-pill>
            <Split className="h-3 w-3 text-gold-700" /> {myRoomName}{timeLeft(plan?.ends_at, now) ? ` · ${timeLeft(plan?.ends_at, now)}` : ''}
            {!isHost && <button type="button" onClick={() => setOptedOut(planKey)} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-navy-50">Leave room</button>}
          </span>
        )}
        {!isHost && myRoom === 0 && assignedRoom > 0 && (
          <button type="button" onClick={() => setOptedOut(null)} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-navy-800 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-navy-700"><Split className="h-3 w-3" /> Join {plan?.rooms.find((r) => r.n === assignedRoom)?.name ?? 'your room'}</button>
        )}
        {recorder.someoneRecording && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-burgundy-50 px-2 py-0.5 text-[11px] font-semibold text-burgundy-700 ring-1 ring-inset ring-burgundy-100" data-recording-pill>
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#C42B1C]" aria-hidden="true" /> Recording{recorder.startedAt ? ` ${elapsed(now - recorder.startedAt)}` : ''}
          </span>
        )}
        {meeting.locked && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-semibold text-navy-800 ring-1 ring-inset ring-navy-100" title="Nobody new can join"><Lock className="h-3 w-3" /> Locked</span>}

        {sharer && (
          <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-lg bg-navy-50 py-1 pl-3 pr-1 text-sm font-semibold text-navy-900 ring-1 ring-inset ring-navy-100 md:flex">
            <MonitorUp className="h-4 w-4 text-green-600" />
            <span className="max-w-[16rem] truncate">{sharer.local ? 'You are sharing your screen' : `${sharer.name}'s screen`}</span>
            <Popover
              label="Shared screen options"
              panelClassName={cn('left-0 top-full mt-2 w-64', darkPanel)}
              trigger={({ open, toggle }) => <button type="button" onClick={toggle} aria-label="Shared screen options" aria-haspopup="menu" aria-expanded={open} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white"><MoreHorizontal className="h-4 w-4" /></button>}
            >
              {(close) => (
                <>
                  {([['fit', 'Fit to window'], [1, '100% (Original size)'], [1.5, '150%'], [2, '200%']] as const).map(([z, label]) => (
                    <button key={String(z)} role="menuitemradio" aria-checked={shareZoom === z} className={darkItem} onClick={() => { close(); setShareZoom(z); if (z !== 'fit') setAnnotating(false); }}>
                      <Check className={cn('h-4 w-4', shareZoom === z ? 'text-gold-600' : 'invisible')} /> {label}
                    </button>
                  ))}
                  <div className="my-1 h-px bg-sand" />
                  <button role="menuitem" className={darkItem} onClick={() => { close(); setShareZoom('fit'); setAnnotating(true); }}><PenLine className="h-4 w-4" /> Annotate</button>
                  {isHost && !sharer.local && <button role="menuitem" className={cn(darkItem, '!text-burgundy-600')} onClick={() => { close(); stopTheirShare(); }}><X className="h-4 w-4" /> Stop participant’s sharing</button>}
                  {sharer.local && <button role="menuitem" className={cn(darkItem, '!text-burgundy-600')} onClick={() => { close(); void call.stopScreenShare(); }}><X className="h-4 w-4" /> Stop sharing</button>}
                  <div className="my-1 h-px bg-sand" />
                  <button role="menuitem" className={darkItem} onClick={() => { close(); void popOut(); }}><PictureInPicture2 className="h-4 w-4" /> Pop out</button>
                </>
              )}
            </Popover>
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {startedAt !== null && <span className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] tabular-nums text-navy-700" aria-label="Time in meeting"><Clock className="h-4 w-4" />{elapsed(now - startedAt)}</span>}
          {sharer && (
            <button type="button" onClick={() => setAnnotating((v) => !v)} aria-pressed={annotating} aria-label="Annotate" title="Annotate the shared screen" className={cn('flex h-8 w-8 items-center justify-center rounded-md', annotating ? 'bg-gold-400 text-navy-900' : 'text-navy-700 hover:bg-navy-50')}>
              <PenLine className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title={fullscreen ? 'Exit full screen' : 'Full screen'} className="hidden h-8 w-8 items-center justify-center rounded-md text-navy-700 hover:bg-navy-50 sm:flex">
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setLayout((l) => (l === 'gallery' ? 'speaker' : 'gallery'))}
            disabled={!!sharer || !!board.owner}
            aria-label={layout === 'gallery' ? 'Switch to speaker view' : 'Switch to gallery view'}
            title={layout === 'gallery' ? 'Speaker view' : 'Gallery view'}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-40"
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">View: {layout === 'gallery' ? 'Gallery' : 'Speaker'}</span>
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 gap-1.5 p-1.5">
        <main className="relative min-h-0 min-w-0 flex-1">
          {stage}
          {count === 1 && call.state === 'connected' && (
            <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-3">
              <p className="pointer-events-auto rounded-lg bg-white px-4 py-2 text-center text-sm text-navy-900 shadow-popover ring-1 ring-navy-100">You're the only one here. <button type="button" onClick={copy} className="font-semibold text-gold-700 hover:text-gold-800">Copy the invite link</button> to bring people in.</p>
            </div>
          )}
          {wantsShare && !call.screenOn && call.state === 'connected' && (
            <div className="absolute inset-x-0 bottom-4 flex justify-center px-3">
              <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-2.5 text-sm text-navy-900 shadow-popover ring-1 ring-navy-100">
                <MonitorUp className="h-4 w-4 text-green-600" /> Ready to share your screen?
                <button type="button" onClick={() => { setWantsShare(false); void call.startScreenShare(); }} className="rounded-md bg-green-600 px-3 py-1.5 font-semibold text-white hover:bg-green-500">Share screen</button>
                <button type="button" onClick={() => setWantsShare(false)} aria-label="Not now" className="rounded-md p-1 text-navy-500 hover:bg-navy-50"><X className="h-4 w-4" /></button>
              </div>
            </div>
          )}
          {isHost && panel !== 'people' && <WaitingBanner wr={wr} onSeeAll={() => openPanel('people')} />}
          <CaptionsOverlay captions={captions} />
          {recorder.state === 'saving' && (
            <div className="absolute bottom-4 left-4 z-30 rounded-xl bg-white px-4 py-2.5 text-sm text-navy-900 shadow-popover ring-1 ring-navy-100" role="status">Saving the recording…</div>
          )}
          {recorder.lastFile && recorder.state === 'idle' && fileDismissed !== recorder.lastFile.url && (
            <div className="absolute bottom-4 left-4 z-30 flex items-center gap-3 rounded-xl bg-white px-4 py-2.5 text-sm text-navy-900 shadow-popover ring-1 ring-navy-100" role="status" aria-label="Recording finished">
              Recording finished
              <a href={recorder.lastFile.url} download={recorder.lastFile.name} className="inline-flex items-center gap-1 font-semibold text-gold-700 hover:text-gold-800"><Download className="h-4 w-4" /> Download a copy</a>
              <button type="button" onClick={() => setFileDismissed(recorder.lastFile!.url)} aria-label="Dismiss" className="rounded-md p-1 text-navy-500 hover:bg-navy-50"><X className="h-4 w-4" /></button>
            </div>
          )}
          {infoOpen && <MeetingInfo meeting={meeting} hostName={names[meeting.host_id] ?? (isHost ? you.name : null)} onCopy={copy} onClose={() => setInfoOpen(false)} />}
          <CallNotices call={call} onOpenSettings={() => setSettingsOpen(true)} />
        </main>
        {panel === 'people' && (
          <ParticipantsPanel
            people={tiles.map((t) => ({ id: t.id, name: t.name, local: t.local, host: t.id === meeting.host_id, muted: t.muted, camOff: t.camOff, hand: !!hands[t.id], avatarUrl: t.avatarUrl }))}
            onClose={() => setPanel(null)}
            onCopyLink={copy}
            host={hostActions}
            top={isHost ? <WaitingList wr={wr} /> : undefined}
          />
        )}
        {panel === 'chat' && <ChatPanel lines={chat} onSend={sendChat} onClose={() => setPanel(null)} />}
        {panel === 'breakout' && isHost && (
          <BreakoutPanel
            plan={plan}
            people={tiles.filter((t) => !t.local && t.id !== meeting.host_id).map((t) => ({ id: t.id, name: t.name }))}
            hostRoom={hostRoom}
            now={now}
            onOpen={(p) => { void savePlan(p, `Opened ${p.rooms.length} breakout ${p.rooms.length === 1 ? 'room' : 'rooms'}.`); }}
            onCloseRooms={() => { void closeRooms(); }}
            onMessage={(text) => { if (plan) void savePlan({ ...plan, message: { text, at: new Date().toISOString() } }, 'Message sent to all rooms.'); }}
            onVisit={setHostRoom}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'transcript' && <TranscriptPanel captions={captions} title={meeting.title} startedAt={startedAt} onClose={() => setPanel(null)} />}
        {panel === 'backgrounds' && <BackgroundsPanel bg={bg} onClose={() => setPanel(null)} />}
        {panel === 'polls' && <PollsPanel polls={polls} isHost={isHost} onClose={() => setPanel(null)} />}
      </div>

      {/* Bottom bar, as in Zoom: your audio & video left, meeting tools centre, End right */}
      <footer role="toolbar" aria-label="Meeting controls" className="relative z-20 grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-1 border-t border-sand bg-white px-1.5 py-1 sm:px-3 sm:py-1.5">
        <div className="flex items-center gap-0.5 sm:gap-1">
          <AudioButton micOn={call.micOn} busy={call.pending.microphone} onToggle={() => { void call.toggleMic(); }} devices={devices} active={active} onChoose={onChoose} onSettings={() => setSettingsOpen(true)} shortcut={SHORTCUTS.mic} />
          <VideoButton onRefresh={devices.rescan} camOn={call.camOn} busy={call.pending.camera} onToggle={() => { void call.toggleCam(); }} devices={devices} active={active} onChoose={onChoose} onSettings={() => setSettingsOpen(true)} shortcut={SHORTCUTS.cam} onBackgrounds={() => openPanel('backgrounds')} />
        </div>

        <div className="flex min-w-0 items-center justify-center gap-0.5 sm:gap-1">
          <ToolButton label="Participants" icon={<Users className="h-[22px] w-[22px]" />} badge={count} pressed={panel === 'people'} onClick={() => openPanel('people')} />
          <ToolButton label="Chat" icon={<MessageSquare className="h-[22px] w-[22px]" />} badge={unread || undefined} pressed={panel === 'chat'} onClick={() => openPanel('chat')} />
          <Popover
            className="hidden sm:block"
            label="Reactions"
            panelClassName={cn('bottom-full left-1/2 mb-3 -translate-x-1/2 p-2', darkPanel)}
            trigger={({ open, toggle }) => <ToolButton label="React" icon={<SmilePlus className="h-[22px] w-[22px]" />} pressed={open} aria-expanded={open} aria-haspopup="menu" onClick={toggle} />}
          >
            {(close) => <ReactionPicker handUp={!!hands[you.id]} onReact={(e) => { react(e); close(); }} onHand={() => { toggleHand(); close(); }} />}
          </Popover>
          <ToolButton
            className="hidden sm:flex"
            label={call.screenOn ? 'Stop share' : 'Share'}
            icon={<MonitorUp className={cn('h-[22px] w-[22px]', !call.screenOn && 'text-green-600')} />}
            pressed={call.screenOn}
            busy={call.pending.screen}
            onClick={() => { void (call.screenOn ? call.stopScreenShare() : call.startScreenShare()); }}
          />
          {sharer && (
            <ToolButton
              className="hidden sm:flex"
              label="Annotate"
              icon={<PenLine className="h-[22px] w-[22px]" />}
              pressed={annotating}
              onClick={() => { setShareZoom('fit'); setAnnotating((v) => !v); }}
            />
          )}
          <ToolButton
            className="hidden md:flex"
            label="Polls"
            icon={<BarChart3 className="h-[22px] w-[22px]" />}
            badge={polls.active && !polls.active.mine && !isHost && panel !== 'polls' ? 1 : undefined}
            pressed={panel === 'polls'}
            onClick={() => openPanel('polls')}
          />
          {isHost && recorder.supported && (
            <ToolButton
              className="hidden lg:flex"
              label={recorder.state === 'recording' ? 'Stop recording' : 'Record'}
              icon={recorder.state === 'recording' ? <Square className="h-[20px] w-[20px] fill-[#C42B1C] text-[#C42B1C]" /> : <Circle className="h-[22px] w-[22px] text-[#C42B1C]" />}
              pressed={recorder.state === 'recording'}
              busy={recorder.state === 'starting' || recorder.state === 'saving'}
              onClick={() => { if (recorder.state === 'recording') recorder.stop(); else if (recorder.state === 'idle') void recorder.start(); }}
            />
          )}
          <Popover
            className="hidden lg:block"
            label="Captions"
            panelClassName={cn('bottom-full left-1/2 mb-3 w-64 -translate-x-1/2', darkPanel)}
            trigger={({ open, toggle }) => <ToolButton label="Captions" icon={<CaptionsIcon className="h-[22px] w-[22px]" />} pressed={captions.on} aria-expanded={open} aria-haspopup="menu" onClick={toggle} />}
          >
            {(close) => (
              <>
                {captions.on
                  ? <button role="menuitem" className={darkItem} onClick={() => { close(); captions.turnOff(); }}><CaptionsIcon className="h-4 w-4" /> Turn off captions for everyone</button>
                  : <button role="menuitem" className={darkItem} onClick={() => { close(); captions.turnOn(); }}><CaptionsIcon className="h-4 w-4" /> Turn on captions</button>}
                {captions.on && <button role="menuitem" className={darkItem} onClick={() => { close(); captions.setShown(!captions.shown); }}>{captions.shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {captions.shown ? 'Hide captions on my screen' : 'Show captions'}</button>}
                <button role="menuitem" className={darkItem} onClick={() => { close(); openPanel('transcript'); }}><FileText className="h-4 w-4" /> View full transcript</button>
              </>
            )}
          </Popover>
          <ToolButton
            className="hidden lg:flex"
            label="Whiteboard"
            icon={<Presentation className="h-[22px] w-[22px]" />}
            pressed={!!board.owner}
            disabled={!!board.owner && !board.canClose}
            onClick={() => (board.owner ? board.close() : board.open())}
          />
          {isHost && (
            <Popover
              className="hidden sm:block"
              label="Host tools"
              panelClassName={cn('bottom-full left-1/2 mb-3 w-60 -translate-x-1/2', darkPanel)}
              trigger={({ open, toggle }) => <ToolButton label="Host tools" icon={<Shield className="h-[22px] w-[22px]" />} pressed={open} aria-expanded={open} aria-haspopup="menu" onClick={toggle} />}
            >
              {(close) => (
                <>
                  <button role="menuitem" className={darkItem} onClick={() => { close(); void copy(); }}><Copy className="h-4 w-4" /> Copy invite link</button>
                  <button role="menuitem" className={darkItem} onClick={() => { close(); setInfoOpen(true); }}><Info className="h-4 w-4" /> Meeting info</button>
                  {sharer && !sharer.local && <button role="menuitem" className={darkItem} onClick={() => { close(); stopTheirShare(); }}><X className="h-4 w-4" /> Stop participant’s sharing</button>}
                  <div className="my-1 h-px bg-sand" />
                  <button role="menuitem" className={darkItem} onClick={() => { close(); openPanel('breakout'); }}><Split className="h-4 w-4" /> Breakout rooms{plan?.open ? ' (open)' : ''}</button>
                  <button role="menuitemcheckbox" aria-checked={!!meeting.waiting_room} className={darkItem} onClick={() => { close(); void setSetting({ waiting_room: !meeting.waiting_room }); }}>
                    <DoorOpen className="h-4 w-4" /> <span className="flex-1 text-left">Waiting room</span> <Toggle on={!!meeting.waiting_room} />
                  </button>
                  <button role="menuitemcheckbox" aria-checked={!!meeting.locked} className={darkItem} onClick={() => { close(); void setSetting({ locked: !meeting.locked }); }}>
                    <Lock className="h-4 w-4" /> <span className="flex-1 text-left">Lock meeting</span> <Toggle on={!!meeting.locked} />
                  </button>
                  <div className="my-1 h-px bg-sand" />
                  <button role="menuitem" className={cn(darkItem, '!text-burgundy-600')} onClick={() => { close(); void endForAll(); }}><XCircle className="h-4 w-4" /> End meeting for all</button>
                </>
              )}
            </Popover>
          )}
          <Popover
            label="More"
            panelClassName={cn('bottom-full right-0 mb-3 w-60 sm:left-1/2 sm:right-auto sm:-translate-x-1/2', darkPanel)}
            trigger={({ open, toggle }) => <ToolButton label="More" icon={<MoreHorizontal className="h-[22px] w-[22px]" />} pressed={open} aria-expanded={open} aria-haspopup="menu" onClick={toggle} />}
          >
            {(close) => (
              <>
                <div className="sm:hidden">
                  <ReactionPicker handUp={!!hands[you.id]} onReact={(e) => { react(e); close(); }} onHand={() => { toggleHand(); close(); }} />
                  <div className="my-1 h-px bg-sand" />
                </div>
                <button role="menuitem" className={cn(darkItem, 'md:hidden')} onClick={() => { close(); openPanel('polls'); }}><BarChart3 className="h-4 w-4" /> Polls</button>
                {isHost && <button role="menuitem" className={cn(darkItem, 'sm:hidden')} onClick={() => { close(); openPanel('breakout'); }}><Split className="h-4 w-4" /> Breakout rooms</button>}
                {isHost && (
                  <div className="sm:hidden">
                    <button role="menuitemcheckbox" aria-checked={!!meeting.waiting_room} className={darkItem} onClick={() => { close(); void setSetting({ waiting_room: !meeting.waiting_room }); }}>
                      <DoorOpen className="h-4 w-4" /> <span className="flex-1 text-left">Waiting room</span> <Toggle on={!!meeting.waiting_room} />
                    </button>
                    <button role="menuitemcheckbox" aria-checked={!!meeting.locked} className={darkItem} onClick={() => { close(); void setSetting({ locked: !meeting.locked }); }}>
                      <Lock className="h-4 w-4" /> <span className="flex-1 text-left">Lock meeting</span> <Toggle on={!!meeting.locked} />
                    </button>
                  </div>
                )}
                {isHost && recorder.supported && (
                  <button role="menuitem" className={cn(darkItem, 'lg:hidden')} onClick={() => { close(); if (recorder.state === 'recording') recorder.stop(); else if (recorder.state === 'idle') void recorder.start(); }}>
                    {recorder.state === 'recording' ? <Square className="h-4 w-4 text-[#C42B1C]" /> : <Circle className="h-4 w-4 text-[#C42B1C]" />} {recorder.state === 'recording' ? 'Stop recording' : 'Record'}
                  </button>
                )}
                <button role="menuitem" className={cn(darkItem, 'lg:hidden')} onClick={() => { close(); if (!captions.on) captions.turnOn(); openPanel('transcript'); }}><CaptionsIcon className="h-4 w-4" /> Captions &amp; transcript</button>
                <button role="menuitem" className={darkItem} onClick={() => { close(); openPanel('backgrounds'); }}><Sparkles className="h-4 w-4" /> Backgrounds &amp; blur</button>
                {!board.owner
                  ? <button role="menuitem" className={darkItem} onClick={() => { close(); board.open(); }}><Presentation className="h-4 w-4" /> Open whiteboard</button>
                  : board.canClose && <button role="menuitem" className={darkItem} onClick={() => { close(); board.close(); }}><Presentation className="h-4 w-4" /> Close whiteboard</button>}
                {sharer && <button role="menuitem" className={darkItem} onClick={() => { close(); setShareZoom('fit'); setAnnotating(true); }}><PenLine className="h-4 w-4" /> Annotate the shared screen</button>}
                {pinned && <button role="menuitem" className={darkItem} onClick={() => { close(); setPinned(null); }}><PinOff className="h-4 w-4" /> Unpin</button>}
                <button role="menuitem" className={darkItem} onClick={() => { close(); toggleFullscreen(); }}>{fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} {fullscreen ? 'Exit full screen' : 'Full screen'}</button>
                <button role="menuitem" className={darkItem} onClick={() => { close(); setInfoOpen(true); }}><Info className="h-4 w-4" /> Meeting info</button>
                <button role="menuitem" className={darkItem} onClick={() => { close(); void copy(); }}><Copy className="h-4 w-4" /> Copy invite link</button>
                <button role="menuitem" className={darkItem} onClick={() => { close(); setSettingsOpen(true); }}><Settings2 className="h-4 w-4" /> Settings</button>
              </>
            )}
          </Popover>
        </div>

        <Popover
          label="Leave options"
          panelClassName={cn('bottom-full right-0 mb-3 w-60 p-2', darkPanel)}
          trigger={({ open, toggle }) => (
            <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={isHost ? 'End' : 'Leave'} className="flex h-11 min-w-[44px] flex-col items-center justify-center gap-1 rounded-lg px-1.5 text-navy-800 hover:bg-navy-50 sm:h-[58px] sm:min-w-[64px] sm:px-2">
              {isHost
                ? <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#C42B1C] text-white"><X className="h-3.5 w-3.5" strokeWidth={3} /></span>
                : <LogOut className="h-[22px] w-[22px] text-burgundy-500" />}
              <span aria-hidden="true" className="hidden text-[11.5px] font-medium leading-none text-navy-700 sm:block">{isHost ? 'End' : 'Leave'}</span>
            </button>
          )}
        >
          {(close) => (
            <div className="flex flex-col gap-2">
              {isHost && <button role="menuitem" className="h-10 rounded-lg bg-burgundy-500 px-3 text-sm font-semibold text-white hover:bg-burgundy-600" onClick={() => { close(); void endForAll(); }}>End meeting for all</button>}
              <button role="menuitem" className="h-10 rounded-lg bg-navy-50 px-3 text-sm font-semibold text-navy-900 hover:bg-navy-100" onClick={() => { close(); leave(); }}><PhoneOff className="mr-1.5 inline h-4 w-4 align-[-3px]" />Leave meeting</button>
            </div>
          )}
        </Popover>
      </footer>
      <DeviceCheckModal open={settingsOpen} onClose={() => { setSettingsOpen(false); void call.applySavedDevices(); }} />
    </div>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className={cn('relative inline-flex h-5 w-9 shrink-0 rounded-full transition', on ? 'bg-gold-400' : 'bg-navy-100')}>
      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
    </span>
  );
}

function ReactionPicker({ handUp, onReact, onHand }: { handUp: boolean; onReact: (e: Reaction) => void; onHand: () => void }) {
  return (
    <div className="flex flex-col gap-2 p-1">
      <div className="flex gap-1">
        {REACTIONS.map((e) => (
          <button key={e} type="button" role="menuitem" aria-label={`React ${e}`} onClick={() => onReact(e)} className="flex h-10 w-10 items-center justify-center rounded-lg text-2xl hover:bg-navy-50">{e}</button>
        ))}
      </div>
      <button type="button" role="menuitem" onClick={onHand} className={cn(darkItem, 'justify-center bg-navy-50')}>
        <Hand className="h-4 w-4 text-gold-600" /> {handUp ? 'Lower hand' : 'Raise hand'}
      </button>
    </div>
  );
}

function MeetingInfo({ meeting, hostName, onCopy, onClose }: { meeting: Meeting; hostName: string | null; onCopy: () => void; onClose: () => void }) {
  return (
    <div role="dialog" aria-label="Meeting info" className="absolute left-2 top-2 z-30 w-[min(22rem,calc(100%-1rem))] rounded-xl bg-white p-4 text-sm text-navy-900 shadow-popover ring-1 ring-navy-100">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold">{meeting.title}</h2>
        <button type="button" onClick={onClose} aria-label="Close meeting info" className="rounded-lg p-1 text-navy-600 hover:bg-navy-50"><X className="h-4 w-4" /></button>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-ivory-700">
        <dt>Room</dt><dd className="font-mono text-navy-900">{meeting.code}</dd>
        {hostName && <><dt>Host</dt><dd className="text-navy-900">{hostName}</dd></>}
        <dt>Invite link</dt><dd className="break-all text-navy-900">{inviteUrl(meeting)}</dd>
        <dt>Security</dt><dd className="text-navy-900">Encrypted in transit. Members of this SYNAPSE account, and guests with the invite link, can join.{meeting.waiting_room ? ' The host lets each person in from the waiting room.' : ''}{meeting.locked ? ' The meeting is locked: nobody new can join.' : ''}</dd>
      </dl>
      <button type="button" onClick={onCopy} className="mt-4 inline-flex items-center gap-1.5 font-semibold text-gold-700 hover:text-gold-800"><Copy className="h-4 w-4" /> Copy link</button>
    </div>
  );
}

/** Plays everyone's microphone (meetings subscribe to all audio). */
function useMeetingAudio(room: Room | null) {
  useEffect(() => {
    if (!room) return;
    const box = document.createElement('div');
    box.dataset.meetingAudio = '';
    box.style.display = 'none';
    document.body.appendChild(box);
    const attach = (track: RemoteTrack) => { if (track.kind === 'audio') box.appendChild(track.attach()); };
    const detach = (track: RemoteTrack) => { if (track.kind === 'audio') track.detach().forEach((el) => el.remove()); };
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) if (pub.track && pub.kind === 'audio') attach(pub.track as RemoteTrack);
    }
    room.on('trackSubscribed', attach).on('trackUnsubscribed', detach);
    return () => { room.off('trackSubscribed', attach).off('trackUnsubscribed', detach); box.remove(); };
  }, [room]);
}

function TrackVideo({ track, mirror, className, style, onVideo }: { track: Track | null; mirror?: boolean; className?: string; style?: React.CSSProperties; onVideo?: (el: HTMLVideoElement | null) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    (track as LocalTrack | RemoteTrack).attach(el);
    onVideo?.(el);
    return () => { (track as LocalTrack | RemoteTrack).detach(el); onVideo?.(null); };
  }, [track, onVideo]);
  if (!track) return null;
  return <video ref={ref} autoPlay playsInline muted style={style} className={cn(className, mirror && '-scale-x-100')} />;
}

function ParticipantTile({ tile, hand, reaction, host, big, className, pinned, onPin }: {
  tile: TileInfo; hand: boolean; reaction?: Reaction; host: boolean; big?: boolean; className?: string; pinned?: boolean; onPin?: () => void;
}) {
  const [first, ...rest] = tile.name.split(' ');
  const label = `${tile.name}${tile.local ? ' (you)' : ''}`;
  return (
    <div
      className={cn('group relative min-h-0 overflow-hidden rounded-xl bg-navy-800 text-white transition', className)}
      data-speaking={tile.speaking || undefined}
      aria-label={`${label}${host ? ', host' : ''}${tile.muted ? ', muted' : ''}${tile.speaking ? ', speaking' : ''}${hand ? ', hand raised' : ''}`}
      role="group"
    >
      {tile.video ? (
        <TrackVideo track={tile.video} mirror={tile.local} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {tile.avatarUrl
            ? <Avatar firstName={first} lastName={rest.join(' ')} src={tile.avatarUrl} size="xl" className={big ? '!h-28 !w-28' : '!h-20 !w-20'} />
            : <span className={cn('flex items-center justify-center rounded-full bg-gold-400 font-display font-semibold tracking-[-0.02em] text-navy-900', big ? 'h-28 w-28 text-[38px]' : 'h-20 w-20 text-[28px]')}>{(first?.[0] ?? '') + (rest[rest.length - 1]?.[0] ?? '')}</span>}
        </div>
      )}
      {tile.speaking && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_0_3px_#E4A93C]" />}
      {onPin && (
        <button
          type="button"
          onClick={onPin}
          aria-label={pinned ? `Unpin ${tile.name}` : `Pin ${tile.name}`}
          title={pinned ? 'Unpin' : 'Pin for me'}
          className={cn('absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-navy-900 shadow transition focus:opacity-100 group-hover:opacity-100', pinned ? 'opacity-100' : 'opacity-0')}
        >
          {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </button>
      )}
      {(hand || reaction) && (
        <span className="absolute left-3.5 top-3.5 flex items-center gap-1">
          {hand && <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-gold-400 px-2.5 text-[13px] font-semibold text-navy-900" aria-hidden="true"><Hand className="h-3.5 w-3.5" /> Hand raised</span>}
          {reaction && <span className="animate-bounce text-3xl drop-shadow" aria-label={`Reacted ${reaction}`}>{reaction}</span>}
        </span>
      )}
      <span className="absolute bottom-1.5 left-1.5 flex h-6 max-w-[90%] items-center gap-1.5 truncate rounded bg-black/55 px-2 text-[12.5px] font-medium">
        {tile.muted ? <MicOff className="h-3.5 w-3.5 shrink-0 text-[#FF9C93]" /> : <Mic className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}
