import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, Play, Radio, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { LoadingSpinner } from '@/components/ui/States';
import { HowellsLogo } from '@/components/layout/Sidebar';
import { normalizeMediaPrefs } from '@/spatial/media/devices';
import { useLiveKitRoom } from '@/spatial/media/useLiveKitRoom';
import { FloatingReactions, ReactionBar, StreamChat, StreamStage } from '@/components/streams/StreamParts';
import { useStreamAudio, useStreamChat } from '@/components/streams/useStream';
import { STREAM_TOPICS, getStream, getWatchInfo, viewersLabel, type WatchInfo } from '@/lib/streams';

const POLL_MS = 10_000;

/**
 * /live/CODE?watch=TOKEN: watch a stream. Anyone with the link (asked for a name), or people in
 * the account without it. Shows "starting soon" until the host goes live.
 */
export function WatchPage({ code, watch }: { code: string; watch: string }) {
  const { user, profile } = useAuth();
  const [info, setInfo] = useState<WatchInfo | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [endedLive, setEndedLive] = useState(false);

  const load = useCallback(async () => {
    if (watch) { const r = await getWatchInfo(code, watch); setInfo(r.data); return; }
    if (!user) { setInfo(null); return; }
    const r = await getStream(code);
    const s = r.data;
    setInfo(s ? { id: s.id, title: s.title, description: s.description, code: s.code, status: s.status, scheduled_at: s.scheduled_at, started_at: s.started_at, chat_enabled: s.chat_enabled, host_id: s.host_id, host_name: '', workspace_name: null } : null);
  }, [code, watch, user]);
  useEffect(() => { load(); }, [load]);
  // Until it's live, look again every few seconds.
  useEffect(() => {
    if (!info || info.status !== 'scheduled') return;
    const t = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(t);
  }, [info, load]);

  const myName = user ? [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Viewer' : name.trim();

  if (info === undefined) return <Shell><LoadingSpinner className="h-8 w-8 text-ivory-300" /></Shell>;
  if (info === null) return <Shell><Message icon={<Radio className="h-10 w-10 text-gold-400" />} title="This watch link isn't valid" text="Ask the host for a new link." /></Shell>;
  if (info.status === 'ended' || endedLive) return <Shell><Message icon={<Radio className="h-10 w-10 text-gold-400" />} title={`${info.title} has ended`} text="Thanks for watching." /></Shell>;
  if (info.status === 'scheduled') {
    return (
      <Shell>
        <Message
          icon={<CalendarClock className="h-10 w-10 text-gold-400" />}
          title={info.title}
          text={`${info.host_name ? `${info.host_name} will be live soon.` : 'Starting soon.'}${info.scheduled_at ? ` Planned for ${new Date(info.scheduled_at).toLocaleString()}.` : ''} This page starts playing by itself.`}
        />
        {info.description && <p className="mx-auto mt-3 max-w-lg text-center text-sm text-ivory-300">{info.description}</p>}
      </Shell>
    );
  }
  if (!joined) {
    const submit = (e: FormEvent) => { e.preventDefault(); if (user || name.trim()) setJoined(true); };
    return (
      <Shell>
        <form onSubmit={submit} className="mx-auto w-full max-w-sm rounded-2xl bg-white p-6 text-navy-800 shadow-popover">
          <p className="inline-flex items-center gap-1.5 rounded-md bg-[#C42B1C] px-2 py-0.5 text-xs font-bold uppercase text-white"><span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Live</p>
          <h1 className="mt-3 text-xl font-semibold">{info.title}</h1>
          {info.host_name && <p className="text-sm text-ivory-700">with {info.host_name}</p>}
          {!user && (
            <label className="mt-4 grid gap-1.5 text-sm font-medium">Your name <span className="text-xs font-normal text-ivory-700">(shown in the chat)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="input-field" autoFocus placeholder="e.g. Jane" />
            </label>
          )}
          <button type="submit" disabled={!user && !name.trim()} className="btn-primary mt-4 w-full justify-center"><Play className="h-4 w-4" /> Watch now</button>
        </form>
      </Shell>
    );
  }
  return <Watching info={info} watch={watch} myName={myName} meId={user?.id ?? null} onEnded={() => setEndedLive(true)} />;
}

function Watching({ info, watch, myName, meId, onEnded }: { info: WatchInfo; watch: string; myName: string; meId: string | null; onEnded: () => void }) {
  const prefs = useMemo(() => ({ ...normalizeMediaPrefs(null), join_muted: true, join_camera_off: true }), []);
  const call = useLiveKitRoom(info.id, {
    prefs,
    tokenBody: watch ? { streamCode: info.code, watch, guestName: myName } : { streamCode: info.code },
    autoSubscribe: true,
  });
  useStreamAudio(call.room);
  const identity = call.room?.localParticipant?.identity ?? meId ?? '';
  const chat = useStreamChat(call.room, { id: identity, name: meId ? myName : `${myName} (Guest)` }, info.host_id);
  useEffect(() => chat.bus.on(STREAM_TOPICS.state, (raw, from) => {
    if (from === info.host_id && raw && typeof raw === 'object' && (raw as { ended?: unknown }).ended === true) onEnded();
  }), [chat.bus, info.host_id, onEnded]);
  // The host left for good (the room emptied of them) after ending: same screen.
  useEffect(() => {
    const room = call.room;
    if (!room) return;
    const gone = (p: { identity: string }) => { if (p.identity === info.host_id) void getWatchInfoAgain(); };
    const getWatchInfoAgain = async () => { if (watch) { const r = await getWatchInfo(info.code, watch); if (r.data?.status === 'ended') onEnded(); } };
    room.on('participantDisconnected', gone);
    return () => { room.off('participantDisconnected', gone); };
  }, [call.room, info.host_id, info.code, watch, onEnded]);

  const host = call.room?.remoteParticipants.get(info.host_id);
  const cam = host ? [...host.trackPublications.values()].find((p) => p.source === 'camera')?.track ?? null : null;
  const screen = host ? [...host.trackPublications.values()].find((p) => p.source === 'screen_share')?.track ?? null : null;
  const viewers = Math.max(1, call.remoteParticipants.length + (host ? 0 : 1));

  return (
    <div className="flex h-[100dvh] flex-col bg-navy-950 text-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10"><HowellsLogo className="h-4 w-4" /></span>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{info.title}{info.host_name ? <span className="font-normal text-ivory-300"> · {info.host_name}</span> : null}</h1>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-[#C42B1C] px-2 py-1 text-xs font-bold uppercase"><span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Live</span>
        <span className="inline-flex items-center gap-1.5 text-sm text-ivory-300"><Users className="h-4 w-4" /> {viewersLabel(viewers)}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="relative flex min-h-0 flex-1 flex-col p-3">
          <div className="relative min-h-0 flex-1">
            <StreamStage camera={cam} screen={screen} placeholder={call.state === 'connected' ? (host ? 'The host has their camera off.' : 'Waiting for the host…') : call.error ?? 'Connecting…'} />
            <FloatingReactions items={chat.floating} />
          </div>
          <div className="mt-3 flex justify-center"><ReactionBar onReact={chat.react} /></div>
        </main>
        <StreamChat lines={chat.lines} onSend={chat.send} disabled={info.chat_enabled ? null : 'The host turned chat off.'} className="h-72 border-t border-white/10 lg:h-auto lg:w-80 lg:border-l lg:border-t-0" />
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-navy-950 p-6 text-white">{children}</div>;
}

function Message({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="mx-auto max-w-md text-center">
      <div className="flex justify-center">{icon}</div>
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-ivory-300">{text}</p>
    </div>
  );
}
