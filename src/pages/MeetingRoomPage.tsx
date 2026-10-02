import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Copy, Mic, MicOff, MonitorUp, PhoneOff, SearchX, Settings2, Users, Video, VideoOff, Clock, ChevronUp,
} from 'lucide-react';
import type { LocalTrack, RemoteTrack, Room, Track } from 'livekit-client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { endMeeting, getMeetingByCode, type Meeting } from '@/lib/meetings';
import { meetingUrl } from '@/meetings/codes';
import { normalizeMediaPrefs } from '@/spatial/media/devices';
import { useLiveKitRoom, type LiveKitRoom } from '@/spatial/media/useLiveKitRoom';
import { useCallShortcuts, SHORTCUTS } from '@/spatial/media/shortcuts';
import { DeviceCheck, DeviceCheckModal } from '@/components/spaces/DeviceCheck';
import { CallNotices } from '@/components/spaces/room/CallNotices';
import { ConnectionPill } from '@/components/spaces/room/Overlay';
import { Popover } from '@/components/spaces/room/Popover';
import { menuItem } from '@/components/spaces/room/styles';
import { HowellsLogo } from '@/components/layout/Sidebar';
import { Avatar } from '@/components/ui/Avatar';
import { LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';

type Stage = 'prejoin' | 'call' | 'left' | 'ended';

/** /meetings/<code>: check camera & mic, then the video call. Full screen. */
export function MeetingRoomPage({ code }: { code: string }) {
  const [, navigate] = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  const [stage, setStage] = useState<Stage>('prejoin');
  const [endedBy, setEndedBy] = useState<'you' | 'host' | null>(null);

  useEffect(() => {
    let active = true;
    getMeetingByCode(code.toUpperCase()).then(({ data }) => {
      if (!active) return;
      setMeeting(data);
      if (data?.ended_at) setStage('ended');
    });
    return () => { active = false; };
  }, [code]);

  if (meeting === undefined) return <div className="flex min-h-screen items-center justify-center bg-navy-900"><LoadingSpinner className="h-10 w-10" /></div>;

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

  if (stage === 'prejoin') return <PreJoin meeting={meeting} onJoin={() => setStage('call')} onBack={() => navigate('/meetings')} />;

  return (
    <InCall
      meeting={meeting}
      onLeave={() => setStage('left')}
      onEnded={(by) => { setEndedBy(by); setStage('ended'); }}
    />
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-navy-900 p-6 text-center text-white">
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

function PreJoin({ meeting, onJoin, onBack }: { meeting: Meeting; onJoin: () => void; onBack: () => void }) {
  const copy = useCopyLink(meeting.code);
  return (
    <div className="flex min-h-[100dvh] flex-col bg-white">
      <header className="flex items-center justify-between gap-3 px-4 pt-5 sm:px-8">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-800"><HowellsLogo className="h-5 w-5" /></span>
          <span className="text-lg font-bold tracking-wide text-navy-800">SYNAPSE</span>
        </div>
        <button type="button" onClick={onBack} className="btn-ghost !px-3 !py-2">Back to meetings</button>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-6 pt-6 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-ivory-700">Ready to join?</p>
        <h1 className="mt-2 break-words text-2xl font-bold text-navy-800 sm:text-[28px]">{meeting.title}</h1>
        <div className="mb-6 mt-2 flex flex-wrap items-center gap-3 text-sm text-ivory-700">
          <span>Room <strong className="font-mono text-navy-800">{meeting.code}</strong></span>
          <button type="button" onClick={copy} className="inline-flex items-center gap-1 font-semibold text-gold-700 hover:text-gold-600"><Copy className="h-4 w-4" /> Copy link</button>
        </div>
        <DeviceCheck />
      </main>
      <footer className="sticky bottom-0 border-t border-navy-50 bg-white/95 px-4 py-3 backdrop-blur sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl justify-end">
          <button type="button" onClick={onJoin} className="btn-primary !px-6"><Video className="h-4 w-4" /> Join now</button>
        </div>
      </footer>
    </div>
  );
}

interface TileInfo {
  id: string;
  name: string;
  local: boolean;
  video: Track | null;
  screen: Track | null;
  muted: boolean;
  speaking: boolean;
  avatarUrl?: string | null;
}

function tilesFrom(call: LiveKitRoom, me: { id: string; name: string; avatarUrl: string | null }): TileInfo[] {
  const room = call.room;
  const list: TileInfo[] = [{
    id: me.id, name: `${me.name} (you)`, local: true,
    video: call.camOn ? call.localTracks.camera : null, screen: call.screenOn ? call.localTracks.screen : null,
    muted: !call.micOn, speaking: call.activeSpeakers.includes(me.id), avatarUrl: me.avatarUrl,
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
    list.push({ id: p.identity, name: p.name || 'Guest', local: false, video, screen, muted: !p.isMicrophoneEnabled, speaking: call.activeSpeakers.includes(p.identity) });
  }
  return list;
}

function InCall({ meeting, onLeave, onEnded }: { meeting: Meeting; onLeave: () => void; onEnded: (by: 'you' | 'host') => void }) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [devicesOpen, setDevicesOpen] = useState(false);
  const prefs = normalizeMediaPrefs(profile?.media_prefs);
  const call = useLiveKitRoom(meeting.id, {
    prefs,
    tokenBody: { meetingCode: meeting.code },
    autoSubscribe: true,
    onNotice: (m, tone) => toast(m, tone ?? 'info'),
  });
  useCallShortcuts({ mic: () => { void call.toggleMic(); }, cam: () => { void call.toggleCam(); } });
  const copy = useCopyLink(meeting.code);
  const isHost = user?.id === meeting.host_id;
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email?.split('@')[0] || 'You';

  useMeetingAudio(call.room);

  // The host ending the meeting tells everyone over LiveKit's data channel.
  useEffect(() => {
    const room = call.room;
    if (!room) return;
    const onData = (payload: Uint8Array) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        if (msg?.type === 'meeting-ended') { room.disconnect(); onEnded('host'); }
      } catch { /* not ours */ }
    };
    room.on('dataReceived', onData);
    return () => { room.off('dataReceived', onData); };
  }, [call.room, onEnded]);

  const endForAll = async () => {
    const err = await endMeeting(meeting.id);
    if (err) { toast(`Couldn't end the meeting. ${err}`, 'error'); return; }
    try {
      await call.room?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'meeting-ended' })), { reliable: true });
    } catch { /* everyone else's token stops working anyway */ }
    call.room?.disconnect();
    onEnded('you');
  };

  const tiles = tilesFrom(call, { id: user?.id ?? 'me', name, avatarUrl: profile?.avatar_url ?? null });
  const sharer = tiles.find((t) => t.screen);
  const count = tiles.length;

  return (
    <div className="flex h-[100dvh] flex-col bg-navy-950 text-white">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold sm:text-lg">{meeting.title}</h1>
          <p className="flex items-center gap-2 text-xs text-ivory-400">
            <span className="font-mono">{meeting.code}</span>
            <button type="button" onClick={copy} className="inline-flex items-center gap-1 font-semibold text-gold-300 hover:text-gold-200"><Copy className="h-3.5 w-3.5" /> Copy link</button>
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold"><Users className="h-3.5 w-3.5" /> {count}</span>
        <ConnectionPill state="connected" call={call.state} quality={call.connectionQuality} />
      </header>

      <main className="relative min-h-0 flex-1 px-3 pb-3 sm:px-6">
        {sharer ? (
          <div className="flex h-full flex-col gap-3 lg:flex-row">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-black">
              <TrackVideo track={sharer.screen} className="h-full w-full object-contain" />
              <span className="absolute bottom-3 left-3 rounded-md bg-navy-900/80 px-2 py-1 text-xs font-semibold">{sharer.local ? 'You are presenting' : `${sharer.name} is presenting`}</span>
            </div>
            <div className="flex gap-3 overflow-auto lg:w-60 lg:flex-col">
              {tiles.map((t) => <ParticipantTile key={t.id} tile={t} className="aspect-video w-48 shrink-0 lg:w-full" />)}
            </div>
          </div>
        ) : (
          <div className={cn('grid h-full auto-rows-fr gap-3', count === 1 ? 'grid-cols-1' : count <= 4 ? 'grid-cols-1 sm:grid-cols-2' : count <= 9 ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
            {tiles.map((t) => <ParticipantTile key={t.id} tile={t} />)}
          </div>
        )}
        {count === 1 && call.state === 'connected' && (
          <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
            <p className="pointer-events-auto rounded-full bg-navy-900/85 px-4 py-2 text-sm">You're the only one here. <button type="button" onClick={copy} className="font-semibold text-gold-300 hover:text-gold-200">Copy the link</button> to invite people.</p>
          </div>
        )}
        <CallNotices call={call} onOpenSettings={() => setDevicesOpen(true)} />
      </main>

      <footer className="flex justify-center px-3 pb-4">
        <div role="toolbar" aria-label="Call controls" className="flex items-center gap-1 rounded-full bg-navy-900 p-1.5 shadow-popover ring-1 ring-white/10">
          <RoundBtn label={call.micOn ? 'Mute microphone' : 'Unmute microphone'} shortcut={SHORTCUTS.mic} off={!call.micOn} busy={call.pending.microphone} onClick={() => { void call.toggleMic(); }}>
            {call.micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          </RoundBtn>
          <RoundBtn label={call.camOn ? 'Turn camera off' : 'Turn camera on'} shortcut={SHORTCUTS.cam} off={!call.camOn} busy={call.pending.camera} onClick={() => { void call.toggleCam(); }}>
            {call.camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </RoundBtn>
          <RoundBtn label={call.screenOn ? 'Stop sharing' : 'Share screen'} pressed={call.screenOn} busy={call.pending.screen} onClick={() => { void (call.screenOn ? call.stopScreenShare() : call.startScreenShare()); }} className="hidden sm:flex">
            <MonitorUp className="h-5 w-5" />
          </RoundBtn>
          <RoundBtn label="Camera & mic settings" onClick={() => setDevicesOpen(true)}><Settings2 className="h-5 w-5" /></RoundBtn>
          <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
          {isHost ? (
            <Popover
              label="Leave options"
              panelClassName="bottom-full right-0 mb-2 w-56"
              trigger={({ open, toggle }) => (
                <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-burgundy-500 px-4 text-sm font-semibold text-white hover:bg-burgundy-600">
                  <PhoneOff className="h-5 w-5" /> <span className="hidden sm:inline">Leave</span> <ChevronUp className="h-4 w-4" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <button role="menuitem" className={menuItem} onClick={() => { close(); call.room?.disconnect(); onLeave(); }}><PhoneOff className="h-4 w-4 text-navy-500" /> Leave meeting</button>
                  <button role="menuitem" className={cn(menuItem, 'text-burgundy-600')} onClick={() => { close(); void endForAll(); }}><Clock className="h-4 w-4" /> End meeting for everyone</button>
                </>
              )}
            </Popover>
          ) : (
            <button type="button" onClick={() => { call.room?.disconnect(); onLeave(); }} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-burgundy-500 px-4 text-sm font-semibold text-white hover:bg-burgundy-600">
              <PhoneOff className="h-5 w-5" /> <span className="hidden sm:inline">Leave</span>
            </button>
          )}
        </div>
      </footer>
      <DeviceCheckModal open={devicesOpen} onClose={() => { setDevicesOpen(false); void call.applySavedDevices(); }} />
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

function TrackVideo({ track, mirror, className }: { track: Track | null; mirror?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    (track as LocalTrack | RemoteTrack).attach(el);
    return () => { (track as LocalTrack | RemoteTrack).detach(el); };
  }, [track]);
  if (!track) return null;
  return <video ref={ref} autoPlay playsInline muted className={cn(className, mirror && '-scale-x-100')} />;
}

function ParticipantTile({ tile, className }: { tile: TileInfo; className?: string }) {
  const [first, ...rest] = tile.name.replace(' (you)', '').split(' ');
  const label = useMemo(() => tile.name, [tile.name]);
  return (
    <div
      className={cn('relative min-h-0 overflow-hidden rounded-2xl bg-navy-800 ring-2 transition', tile.speaking ? 'ring-gold-400' : 'ring-transparent', className)}
      data-speaking={tile.speaking || undefined}
      aria-label={`${label}${tile.muted ? ', muted' : ''}${tile.speaking ? ', speaking' : ''}`}
      role="group"
    >
      {tile.video ? (
        <TrackVideo track={tile.video} mirror={tile.local} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(228,169,60,0.16),transparent_60%)]">
          <Avatar firstName={first} lastName={rest.join(' ')} src={tile.avatarUrl} size="xl" className="!h-20 !w-20 !text-2xl" />
        </div>
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1.5 truncate rounded-md bg-navy-900/80 px-2 py-1 text-xs font-semibold">
        {tile.muted ? <MicOff className="h-3.5 w-3.5 shrink-0 text-red-300" /> : <Mic className="h-3.5 w-3.5 shrink-0 text-gold-300" />}
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}

function RoundBtn({ label, shortcut, off, pressed, busy, onClick, children, className }: {
  label: string; shortcut?: string; off?: boolean; pressed?: boolean; busy?: boolean; onClick: () => void; children: React.ReactNode; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={pressed}
      aria-busy={busy}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400',
        off ? 'bg-burgundy-500 text-white hover:bg-burgundy-600' : pressed ? 'bg-gold-400 text-navy-900 hover:bg-gold-300' : 'text-white hover:bg-white/10',
        busy && 'cursor-wait opacity-70',
        className,
      )}
    >
      {children}
    </button>
  );
}
