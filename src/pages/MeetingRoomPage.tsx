import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Check, ChevronDown, Copy, RefreshCw, Smartphone, Hand, Info, LayoutGrid, MessageSquare, Mic, MicOff, MonitorUp, MoreHorizontal, PenLine, PhoneOff,
  Lock, SearchX, Settings2, SmilePlus, Square, Users, Video, VideoOff, Camera, X,
} from 'lucide-react';
import type { LocalTrack, RemoteTrack, Room, Track } from 'livekit-client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { endMeeting, getMeetingByCode, type Meeting } from '@/lib/meetings';
import { meetingUrl } from '@/meetings/codes';
import { REACTIONS, elapsed, newChatId, parseChat, parseControl, parseReact, type Reaction } from '@/meetings/messages';
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
import { ChatPanel, ParticipantsPanel, type ChatLine } from '@/components/meetings/MeetingPanels';
import { HowellsLogo } from '@/components/layout/Sidebar';
import { Avatar } from '@/components/ui/Avatar';
import { LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';

type Stage = 'prejoin' | 'call' | 'left' | 'ended';
interface JoinChoice { mic: boolean; cam: boolean }

/** /meetings/<code>: preview camera & mic, then the video call. Full screen. */
export function MeetingRoomPage({ code }: { code: string }) {
  const [, navigate] = useRouter();
  const { user } = useAuth();
  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  const [stage, setStage] = useState<Stage>('prejoin');
  const [endedBy, setEndedBy] = useState<'you' | 'host' | null>(null);
  const [join, setJoin] = useState<JoinChoice>({ mic: true, cam: true });

  useEffect(() => {
    let active = true;
    getMeetingByCode(code.toUpperCase()).then(({ data }) => {
      if (!active) return;
      setMeeting(data);
      if (data?.ended_at) setStage('ended');
    });
    return () => { active = false; };
  }, [code]);

  if (meeting === undefined) return <div className="flex min-h-screen items-center justify-center bg-navy-950"><LoadingSpinner className="h-10 w-10" /></div>;

  if (meeting === null) {
    return (
      <Center>
        <SearchX className="mx-auto h-10 w-10 text-ivory-400" />
        <h1 className="mt-4 text-xl font-bold">Meeting not found</h1>
        <p className="mt-2 text-sm text-ivory-400">Check the code, or ask the host for a new link. Meetings are open to people in the same SYNAPSE account.</p>
        <button onClick={() => navigate('/meetings')} className="btn-primary mt-6"><ArrowLeft className="h-4 w-4" /> Back to meetings</button>
      </Center>
    );
  }

  if (stage === 'ended' || stage === 'left') {
    return (
      <Center>
        <h1 className="text-2xl font-bold">{stage === 'left' ? 'You left the meeting' : endedBy === 'host' ? 'The host ended the meeting' : 'This meeting has ended'}</h1>
        <p className="mt-2 text-sm text-ivory-400">{meeting.title} · Room {meeting.code}</p>
        <div className="mt-6 flex justify-center gap-3">
          {stage === 'left' && <button onClick={() => setStage('call')} className="btn-secondary">Rejoin</button>}
          <button onClick={() => navigate('/meetings')} className="btn-primary">Back to meetings</button>
        </div>
      </Center>
    );
  }

  const isHost = user?.id === meeting.host_id;
  if (stage === 'prejoin') {
    return <PreJoin meeting={meeting} isHost={isHost} onJoin={(c) => { setJoin(c); setStage('call'); }} onBack={() => navigate('/meetings')} />;
  }

  return (
    <InCall
      meeting={meeting}
      join={join}
      onLeave={() => setStage('left')}
      onEnded={(by) => { setEndedBy(by); setStage('ended'); }}
    />
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-navy-950 p-6 text-center text-white">
      <div className="max-w-md">{children}</div>
    </div>
  );
}

function useCopyLink(code: string) {
  const { toast } = useToast();
  return useCallback(async () => {
    try { await navigator.clipboard.writeText(meetingUrl(code)); toast('Meeting link copied'); }
    catch { toast('Could not copy the link', 'error'); }
  }, [code, toast]);
}

function useYou() {
  const { user, profile } = useAuth();
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email?.split('@')[0] || 'You';
  return { id: user?.id ?? 'me', name, firstName: profile?.first_name, lastName: profile?.last_name, avatarUrl: profile?.avatar_url ?? null };
}

// ---------------------------------------------------------------- before joining

function PreJoin({ meeting, isHost, onJoin, onBack }: { meeting: Meeting; isHost: boolean; onJoin: (c: JoinChoice) => void; onBack: () => void }) {
  const { profile } = useAuth();
  // The camera preview starts on; the mic follows "join muted" so nobody is heard by surprise.
  const check = useMediaCheck(true, { mic: !normalizeMediaPrefs(profile?.media_prefs).join_muted });
  const you = useYou();
  const copy = useCopyLink(meeting.code);
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
    <div className="flex min-h-[100dvh] flex-col bg-[#081226] text-white">
      <header className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-8">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#1D3363]"><HowellsLogo className="h-[18px] w-[18px]" /></span>
          <span className="text-[13px] font-semibold tracking-[0.14em]">SYNAPSE</span>
        </div>
        <button type="button" onClick={onBack} className="rounded-full px-4 py-2 text-sm font-semibold text-ivory-300 ring-1 ring-inset ring-white/15 hover:bg-white/10 hover:text-white">Back to meetings</button>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-6 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-300">Ready to join?</p>
        <h1 className="mt-1 break-words font-display text-[28px] font-semibold tracking-tight sm:text-[34px]">{meeting.title}</h1>
        <div className="mb-5 mt-1 flex flex-wrap items-center gap-3 text-sm text-ivory-400">
          <span>Room <strong className="font-mono text-white">{meeting.code}</strong></span>
          <button type="button" onClick={copy} className="inline-flex items-center gap-1 font-semibold text-gold-300 hover:text-gold-200"><Copy className="h-4 w-4" /> Copy link</button>
        </div>

        <div className="relative aspect-video overflow-hidden rounded-[24px] bg-[#13244A] ring-1 ring-white/10">
          {showVideo ? (
            <video ref={videoRef} muted playsInline autoPlay aria-label="Your camera preview" className="h-full w-full -scale-x-100 object-cover" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3">
              <Avatar firstName={you.firstName} lastName={you.lastName} src={you.avatarUrl} size="xl" className="!h-20 !w-20 !text-2xl sm:!h-24 sm:!w-24" />
              <p className="text-xs text-ivory-500">{!check.ready ? 'Starting your camera…' : check.cameraOn ? (check.cameraProblem ? 'Camera unavailable' : 'Starting your camera…') : 'Your camera is off'}</p>
            </div>
          )}
          <span className="absolute left-3 top-3 max-w-[60%] truncate rounded-full bg-black/45 px-3 py-1 text-xs font-semibold backdrop-blur">{you.name}</span>
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3">
            <PillToggle on={check.micOn} onClick={() => check.setMicOn(!check.micOn)} label="Audio" iconOn={Mic} iconOff={MicOff} />
            <PillToggle on={check.cameraOn} onClick={() => check.setCameraOn(!check.cameraOn)} label="Video" iconOn={Video} iconOff={VideoOff} />
          </div>
        </div>

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
            onClick={() => onJoin({ mic: micLive, cam: camLive })}
            className="h-12 shrink-0 rounded-full bg-gold-400 px-9 text-[15px] font-semibold text-navy-900 hover:bg-gold-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-200"
          >
            {isHost ? 'Start' : 'Join'}
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
      <span className="mb-1.5 block text-xs font-semibold text-ivory-400">{label}</span>
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
            className="flex h-12 w-full items-center gap-2.5 rounded-full bg-[#13244A] pl-4 pr-3 text-left text-sm text-white ring-1 ring-inset ring-white/10 hover:bg-[#1A2F5C] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 disabled:opacity-60"
          >
            {current && isIphoneDevice(current) ? <Smartphone className="h-4 w-4 shrink-0 text-gold-300" /> : <Icon className="h-4 w-4 shrink-0 text-ivory-300" />}
            <span className="min-w-0 flex-1 truncate">{current ? deviceLabel(current, currentIndex, fallback) : empty ?? `No ${label.toLowerCase()} found`}</span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-ivory-400 transition', open && 'rotate-180')} />
          </button>
        )}
      >
        {(close) => (
          <>
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ivory-400">{label}</p>
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
                  className={cn(darkItem, on && 'text-gold-300')}
                >
                  {phone ? <Smartphone className="h-4 w-4 shrink-0" /> : <Icon className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate text-left">{deviceLabel(d, i, fallback)}</span>
                  {on && <Check className="h-4 w-4 shrink-0" />}
                </button>
              );
            })}
            <div className="my-1 h-px bg-white/10" />
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

type SidePanel = 'people' | 'chat' | null;
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

function InCall({ meeting, join, onLeave, onEnded }: { meeting: Meeting; join: JoinChoice; onLeave: () => void; onEnded: (by: 'you' | 'host') => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const you = useYou();
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

  const prefs = { ...normalizeMediaPrefs(profile?.media_prefs), join_muted: !join.mic, join_camera_off: !join.cam };
  const call = useLiveKitRoom(meeting.id, {
    prefs,
    tokenBody: { meetingCode: meeting.code },
    autoSubscribe: true,
    onNotice: (m, tone) => toast(m, tone ?? 'info'),
  });
  const room = call.room;
  const bus = useMeetingBus(room);
  const devices = useDevices(true);
  const { active, choose } = useActiveDevices(room);
  useCallShortcuts({ mic: () => { void call.toggleMic(); }, cam: () => { void call.toggleCam(); } });
  useMeetingAudio(room);
  const copy = useCopyLink(meeting.code);
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

  // Only the host can end the meeting for everyone.
  useEffect(() => bus.on(TOPICS.control, (raw, from) => {
    if (parseControl(raw) && from === meeting.host_id) { room?.disconnect(); onEnded('host'); }
  }), [bus, room, meeting.host_id, onEnded]);

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

  const leave = () => { room?.disconnect(); onLeave(); };
  const endForAll = async () => {
    const err = await endMeeting(meeting.id);
    if (err) { toast(`Couldn't end the meeting. ${err}`, 'error'); return; }
    // Everyone else's token stops working anyway; this just tells them straight away.
    await bus.send(TOPICS.control, { t: 'ended' }).catch(() => {});
    room?.disconnect();
    onEnded('you');
  };

  const tileProps = (t: TileInfo) => ({ tile: t, hand: !!hands[t.id], reaction: reactions[t.id]?.e, host: t.id === meeting.host_id });

  let stage: React.ReactNode;
  if (sharer) {
    stage = (
      <div className="flex h-full flex-col gap-2 lg:flex-row">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[22px] bg-black" data-share-stage>
          <TrackVideo track={sharer.screen} onVideo={setShareVideo} className="h-full w-full object-contain" />
          <AnnotationLayer
            bus={bus}
            me={you.id}
            roles={{ presenter: sharer.id, host: meeting.host_id }}
            video={shareVideo}
            open={annotating}
            onClose={() => setAnnotating(false)}
            names={names}
          />
          <span className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-xs font-semibold">{sharer.local ? 'You are sharing your screen' : `${sharer.name} is sharing`}</span>
        </div>
        <div className="flex shrink-0 gap-2 overflow-auto lg:w-56 lg:flex-col">
          {tiles.map((t) => <ParticipantTile key={t.id} {...tileProps(t)} className="aspect-video w-40 shrink-0 lg:w-full" />)}
        </div>
      </div>
    );
  } else if (layout === 'speaker' && count > 1) {
    const main = tiles.find((t) => t.id === lastSpeaker) ?? tiles.find((t) => !t.local) ?? tiles[0];
    stage = (
      <div className="flex h-full flex-col gap-2">
        <div className="flex h-20 shrink-0 justify-center gap-2 overflow-x-auto sm:h-28">
          {tiles.filter((t) => t !== main).map((t) => <ParticipantTile key={t.id} {...tileProps(t)} className="aspect-video h-full shrink-0" />)}
        </div>
        <ParticipantTile {...tileProps(main)} className="min-h-0 flex-1" big />
      </div>
    );
  } else {
    stage = (
      <div className={cn('grid h-full auto-rows-fr gap-3', count === 1 ? 'grid-cols-1' : count <= 4 ? 'grid-cols-1 sm:grid-cols-2' : count <= 9 ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
        {tiles.map((t) => <ParticipantTile key={t.id} {...tileProps(t)} big={count === 1} />)}
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[#081226] text-white">
      <header className="flex flex-wrap items-center gap-3 px-4 pb-3 pt-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[17px] font-semibold tracking-[-0.015em] sm:text-[19px]">{meeting.title}</h1>
          <p className="text-[13px] text-[#AEB8CC]">Room {meeting.code} · {count} {count === 1 ? 'person' : 'people'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span title="Audio, video and chat are encrypted in transit" aria-label="Encrypted" className="hidden h-8 items-center gap-1.5 rounded-full bg-[#13244A] px-3 text-[13px] text-[#AEB8CC] sm:inline-flex"><Lock className="h-3.5 w-3.5" /> Encrypted</span>
          {startedAt !== null && <span className="inline-flex h-8 items-center rounded-full bg-[#13244A] px-3 text-[13px] tabular-nums" aria-label="Time in meeting">{elapsed(now - startedAt)}</span>}
          {sharer && (
            <button type="button" onClick={() => setAnnotating((v) => !v)} aria-pressed={annotating} aria-label="Annotate" title="Annotate the shared screen" className={cn('flex h-10 w-10 items-center justify-center rounded-full', annotating ? 'bg-gold-400 text-navy-900' : 'bg-[#13244A] text-white hover:bg-[#1D3363]')}>
              <PenLine className="h-[18px] w-[18px]" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setLayout((l) => (l === 'gallery' ? 'speaker' : 'gallery'))}
            disabled={!!sharer}
            aria-label={layout === 'gallery' ? 'Switch to speaker view' : 'Switch to gallery view'}
            title={layout === 'gallery' ? 'Speaker view' : 'Gallery view'}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#13244A] text-white hover:bg-[#1D3363] disabled:opacity-40"
          >
            {layout === 'gallery' ? <Square className="h-[18px] w-[18px]" /> : <LayoutGrid className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 gap-3 px-3 pb-2 sm:px-6">
        <main className="relative min-h-0 min-w-0 flex-1">
          {stage}
          {count === 1 && call.state === 'connected' && (
            <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-3">
              <p className="pointer-events-auto rounded-full bg-[#102041]/95 px-4 py-2 text-center text-sm shadow-[0_10px_30px_rgba(0,0,0,0.35)]">You're the only one here. <button type="button" onClick={copy} className="font-semibold text-gold-300 hover:text-gold-200">Copy the link</button> to invite people.</p>
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
          />
        )}
        {panel === 'chat' && <ChatPanel lines={chat} onSend={sendChat} onClose={() => setPanel(null)} />}
      </div>

      <div className="flex justify-center px-2 pb-4 pt-2 sm:pb-6">
      <footer role="toolbar" aria-label="Meeting controls" className="flex max-w-full items-center gap-1 rounded-[32px] bg-[rgba(16,32,65,0.94)] p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur sm:gap-1.5 sm:p-2">
        <div className="flex items-center gap-1 sm:gap-1.5">
          <AudioButton micOn={call.micOn} busy={call.pending.microphone} onToggle={() => { void call.toggleMic(); }} devices={devices} active={active} onChoose={onChoose} onSettings={() => setSettingsOpen(true)} shortcut={SHORTCUTS.mic} />
          <VideoButton onRefresh={devices.rescan} camOn={call.camOn} busy={call.pending.camera} onToggle={() => { void call.toggleCam(); }} devices={devices} active={active} onChoose={onChoose} onSettings={() => setSettingsOpen(true)} shortcut={SHORTCUTS.cam} />
        </div>
        <span aria-hidden="true" className="mx-0.5 hidden h-7 w-px bg-white/15 sm:block" />

        <div className="flex items-center">
          <ToolButton label="Participants" icon={<Users className="h-5 w-5" />} badge={count} pressed={panel === 'people'} onClick={() => openPanel('people')} />
          <ToolButton label="Chat" icon={<MessageSquare className="h-5 w-5" />} badge={unread || undefined} pressed={panel === 'chat'} onClick={() => openPanel('chat')} />
          <Popover
            className="hidden sm:block"
            label="Reactions"
            panelClassName={cn('bottom-full left-1/2 mb-3 -translate-x-1/2 p-2', darkPanel)}
            trigger={({ open, toggle }) => <ToolButton label="React" icon={<SmilePlus className="h-5 w-5" />} pressed={open} aria-expanded={open} aria-haspopup="menu" onClick={toggle} />}
          >
            {(close) => <ReactionPicker handUp={!!hands[you.id]} onReact={(e) => { react(e); close(); }} onHand={() => { toggleHand(); close(); }} />}
          </Popover>
          <ToolButton
            className="hidden sm:flex"
            label={call.screenOn ? 'Stop share' : 'Share'}
            icon={<MonitorUp className={cn('h-5 w-5', !call.screenOn && 'text-green-400')} />}
            pressed={call.screenOn}
            busy={call.pending.screen}
            onClick={() => { void (call.screenOn ? call.stopScreenShare() : call.startScreenShare()); }}
          />
          {sharer && <ToolButton label="Annotate" icon={<PenLine className="h-5 w-5" />} pressed={annotating} onClick={() => setAnnotating((v) => !v)} />}
          <Popover
            label="More"
            panelClassName={cn('bottom-full right-0 mb-3 w-60', darkPanel)}
            trigger={({ open, toggle }) => <ToolButton label="More" icon={<MoreHorizontal className="h-5 w-5" />} pressed={open} aria-expanded={open} aria-haspopup="menu" onClick={toggle} />}
          >
            {(close) => (
              <>
                <div className="sm:hidden">
                  <ReactionPicker handUp={!!hands[you.id]} onReact={(e) => { react(e); close(); }} onHand={() => { toggleHand(); close(); }} />
                  <div className="my-1 h-px bg-white/10" />
                </div>
                <button role="menuitem" className={darkItem} onClick={() => { close(); setInfoOpen(true); }}><Info className="h-4 w-4" /> Meeting info</button>
                <button role="menuitem" className={darkItem} onClick={() => { close(); void copy(); }}><Copy className="h-4 w-4" /> Copy invite link</button>
                <button role="menuitem" className={darkItem} onClick={() => { close(); setSettingsOpen(true); }}><Settings2 className="h-4 w-4" /> Settings</button>
              </>
            )}
          </Popover>
        </div>
        <span aria-hidden="true" className="mx-0.5 hidden h-7 w-px bg-white/15 sm:block" />

        <Popover
          label="Leave options"
          panelClassName={cn('bottom-full right-0 mb-3 w-60 p-2', darkPanel)}
          trigger={({ open, toggle }) => (
            <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label="Leave" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#C42B1C] text-[15px] font-semibold text-white hover:bg-[#A82316] sm:h-[52px] sm:w-auto sm:px-6">
              <PhoneOff className="h-5 w-5 sm:hidden" aria-hidden="true" /><span className="hidden sm:inline">Leave</span>
            </button>
          )}
        >
          {(close) => (
            <div className="flex flex-col gap-2">
              {isHost && <button role="menuitem" className="h-10 rounded-lg bg-burgundy-500 px-3 text-sm font-semibold text-white hover:bg-burgundy-600" onClick={() => { close(); void endForAll(); }}>End meeting for all</button>}
              <button role="menuitem" className="h-10 rounded-lg bg-white/10 px-3 text-sm font-semibold text-white hover:bg-white/15" onClick={() => { close(); leave(); }}><PhoneOff className="mr-1.5 inline h-4 w-4 align-[-3px]" />Leave meeting</button>
            </div>
          )}
        </Popover>
      </footer>
      </div>
      <DeviceCheckModal open={settingsOpen} onClose={() => { setSettingsOpen(false); void call.applySavedDevices(); }} />
    </div>
  );
}

function ReactionPicker({ handUp, onReact, onHand }: { handUp: boolean; onReact: (e: Reaction) => void; onHand: () => void }) {
  return (
    <div className="flex flex-col gap-2 p-1">
      <div className="flex gap-1">
        {REACTIONS.map((e) => (
          <button key={e} type="button" role="menuitem" aria-label={`React ${e}`} onClick={() => onReact(e)} className="flex h-10 w-10 items-center justify-center rounded-lg text-2xl hover:bg-white/10">{e}</button>
        ))}
      </div>
      <button type="button" role="menuitem" onClick={onHand} className={cn(darkItem, 'justify-center bg-white/5')}>
        <Hand className="h-4 w-4 text-gold-300" /> {handUp ? 'Lower hand' : 'Raise hand'}
      </button>
    </div>
  );
}

function MeetingInfo({ meeting, hostName, onCopy, onClose }: { meeting: Meeting; hostName: string | null; onCopy: () => void; onClose: () => void }) {
  return (
    <div role="dialog" aria-label="Meeting info" className="absolute left-2 top-2 z-30 w-[min(22rem,calc(100%-1rem))] rounded-2xl bg-navy-900 p-4 text-sm shadow-popover ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold">{meeting.title}</h2>
        <button type="button" onClick={onClose} aria-label="Close meeting info" className="rounded-lg p-1 text-ivory-300 hover:bg-white/10"><X className="h-4 w-4" /></button>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-ivory-300">
        <dt>Room</dt><dd className="font-mono text-white">{meeting.code}</dd>
        {hostName && <><dt>Host</dt><dd className="text-white">{hostName}</dd></>}
        <dt>Link</dt><dd className="break-all text-white">{meetingUrl(meeting.code)}</dd>
        <dt>Security</dt><dd className="text-white">Encrypted in transit. Only people in this SYNAPSE account can join.</dd>
      </dl>
      <button type="button" onClick={onCopy} className="mt-4 inline-flex items-center gap-1.5 font-semibold text-gold-300 hover:text-gold-200"><Copy className="h-4 w-4" /> Copy link</button>
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

function TrackVideo({ track, mirror, className, onVideo }: { track: Track | null; mirror?: boolean; className?: string; onVideo?: (el: HTMLVideoElement | null) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    (track as LocalTrack | RemoteTrack).attach(el);
    onVideo?.(el);
    return () => { (track as LocalTrack | RemoteTrack).detach(el); onVideo?.(null); };
  }, [track, onVideo]);
  if (!track) return null;
  return <video ref={ref} autoPlay playsInline muted className={cn(className, mirror && '-scale-x-100')} />;
}

function ParticipantTile({ tile, hand, reaction, host, big, className }: { tile: TileInfo; hand: boolean; reaction?: Reaction; host: boolean; big?: boolean; className?: string }) {
  const [first, ...rest] = tile.name.split(' ');
  const label = `${tile.name}${tile.local ? ' (you)' : ''}`;
  return (
    <div
      className={cn('relative min-h-0 overflow-hidden rounded-[22px] bg-[#13244A] transition', className)}
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
            : <span className={cn('flex items-center justify-center rounded-full bg-[#2A4377] font-display font-semibold tracking-[-0.02em]', big ? 'h-28 w-28 text-[38px]' : 'h-20 w-20 text-[28px]')}>{(first?.[0] ?? '') + (rest[rest.length - 1]?.[0] ?? '')}</span>}
        </div>
      )}
      {tile.speaking && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[22px] shadow-[inset_0_0_0_3px_#E4A93C]" />}
      {(hand || reaction) && (
        <span className="absolute left-3.5 top-3.5 flex items-center gap-1">
          {hand && <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-gold-400 px-2.5 text-[13px] font-semibold text-navy-900" aria-hidden="true"><Hand className="h-3.5 w-3.5" /> Hand raised</span>}
          {reaction && <span className="animate-bounce text-3xl drop-shadow" aria-label={`Reacted ${reaction}`}>{reaction}</span>}
        </span>
      )}
      <span className="absolute bottom-3.5 left-3.5 flex h-7 max-w-[90%] items-center gap-1.5 truncate rounded-full bg-black/45 px-2.5 text-[13px] font-medium">
        {tile.muted ? <MicOff className="h-3.5 w-3.5 shrink-0 text-[#FF8A80]" /> : <Mic className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}
