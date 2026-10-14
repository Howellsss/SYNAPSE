import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, Mic, MicOff, MonitorUp, Radio, Square, Users, Video, VideoOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { LoadingSpinner } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/utils';
import { elapsed } from '@/meetings/messages';
import { normalizeMediaPrefs } from '@/spatial/media/devices';
import { useLiveKitRoom } from '@/spatial/media/useLiveKitRoom';
import { FloatingReactions, ReactionBar, StreamChat, StreamStage } from '@/components/streams/StreamParts';
import { useStreamChat } from '@/components/streams/useStream';
import { STREAM_TOPICS, getStream, recordPeak, setStreamStatus, viewersLabel, watchUrl, type Stream } from '@/lib/streams';

/** /streams/CODE: the host's studio. Get ready in private, go live, end. */
export function StreamStudioPage({ code }: { code: string }) {
  const { user } = useAuth();
  const [, navigate] = useRouter();
  const [stream, setStream] = useState<Stream | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getStream(code).then((r) => { setStream(r.data); setError(r.error); }); }, [code]);

  if (stream === undefined) return <div className="flex h-[100dvh] items-center justify-center bg-navy-950"><LoadingSpinner className="h-8 w-8 text-ivory-300" /></div>;
  if (!stream || stream.host_id !== user?.id || stream.status === 'ended') {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-navy-950 p-6 text-center text-white">
        <Radio className="h-10 w-10 text-gold-400" />
        <p className="max-w-md text-lg font-semibold">{error ?? (!stream ? 'Stream not found.' : stream.status === 'ended' ? 'This stream has ended.' : 'Only the host can open the studio.')}</p>
        <button type="button" onClick={() => navigate('/streams')} className="btn-primary"><ArrowLeft className="h-4 w-4" /> Back to streams</button>
      </div>
    );
  }
  return <Studio stream={stream} onChange={setStream} />;
}

function Studio({ stream, onChange }: { stream: Stream; onChange: (s: Stream) => void }) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const prefs = useMemo(() => ({ ...normalizeMediaPrefs(profile?.media_prefs), join_muted: false, join_camera_off: false }), [profile?.media_prefs]);
  const call = useLiveKitRoom(stream.id, { prefs, tokenBody: { streamCode: stream.code }, autoSubscribe: true, onNotice: (m, tone) => toast(m, tone ?? 'info') });
  const myName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Host';
  const chat = useStreamChat(call.room, { id: user?.id ?? '', name: myName }, stream.host_id);
  const [now, setNow] = useState(Date.now());
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);

  const viewers = call.remoteParticipants.length;
  const live = stream.status === 'live';
  // Keep the biggest audience for the record.
  useEffect(() => { if (live && viewers > stream.peak_viewers) { void recordPeak(stream.id, viewers); onChange({ ...stream, peak_viewers: viewers }); } }, [live, viewers, stream, onChange]);

  const goLive = async () => {
    setBusy(true);
    const { data, error } = await setStreamStatus(stream.id, 'live');
    setBusy(false);
    if (error || !data) { toast(error ?? 'Could not go live.', 'error'); return; }
    onChange(data);
    toast('You are live. Share the watch link.');
  };
  const end = async () => {
    setConfirmEnd(false);
    void chat.bus.send(STREAM_TOPICS.state, { ended: true });
    const { error } = await setStreamStatus(stream.id, 'ended');
    if (error) { toast(error, 'error'); return; }
    toast('Stream ended');
    navigate('/streams');
  };
  const copy = async () => { await navigator.clipboard.writeText(watchUrl(stream)); toast('Watch link copied'); };

  const btn = 'flex h-11 w-11 items-center justify-center rounded-full transition disabled:opacity-50';
  return (
    <div className="flex h-[100dvh] flex-col bg-navy-950 text-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <button type="button" onClick={() => navigate('/streams')} aria-label="Back to streams" className="rounded-md p-1.5 hover:bg-white/10"><ArrowLeft className="h-5 w-5" /></button>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{stream.title}</h1>
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#C42B1C] px-2 py-1 text-xs font-bold uppercase tracking-wide"><span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Live {stream.started_at ? elapsed(now - Date.parse(stream.started_at)) : ''}</span>
        ) : (
          <span className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold">Not live: only you can see this</span>
        )}
        <span className="inline-flex items-center gap-1.5 text-sm text-ivory-300"><Users className="h-4 w-4" /> {viewersLabel(viewers)}</span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20"><Copy className="h-4 w-4" /> Watch link</button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="relative flex min-h-0 flex-1 flex-col p-3">
          <div className="relative min-h-0 flex-1">
            <StreamStage
              camera={call.localTracks.camera}
              screen={call.localTracks.screen}
              mirror
              placeholder={call.state === 'connected' ? 'Turn on your camera or share your screen to show something.' : call.error ?? 'Connecting…'}
            />
            <FloatingReactions items={chat.floating} />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2" role="toolbar" aria-label="Studio controls">
            <button type="button" onClick={() => void call.toggleMic()} aria-pressed={call.micOn} aria-label={call.micOn ? 'Mute microphone' : 'Unmute microphone'} className={cn(btn, call.micOn ? 'bg-white/10 hover:bg-white/20' : 'bg-burgundy-500')}>{call.micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}</button>
            <button type="button" onClick={() => void call.toggleCam()} aria-pressed={call.camOn} aria-label={call.camOn ? 'Turn camera off' : 'Turn camera on'} className={cn(btn, call.camOn ? 'bg-white/10 hover:bg-white/20' : 'bg-burgundy-500')}>{call.camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}</button>
            <button type="button" onClick={() => void (call.screenOn ? call.stopScreenShare() : call.startScreenShare())} aria-pressed={call.screenOn} aria-label={call.screenOn ? 'Stop sharing screen' : 'Share screen'} className={cn(btn, call.screenOn ? 'bg-green-600' : 'bg-white/10 hover:bg-white/20')}><MonitorUp className="h-5 w-5" /></button>
            {live ? (
              <button type="button" onClick={() => setConfirmEnd(true)} className="ml-2 inline-flex h-11 items-center gap-2 rounded-full bg-[#C42B1C] px-5 font-semibold hover:bg-[#A82518]"><Square className="h-4 w-4" /> End stream</button>
            ) : (
              <button type="button" onClick={goLive} disabled={busy || call.state !== 'connected'} className="ml-2 inline-flex h-11 items-center gap-2 rounded-full bg-gold-400 px-5 font-semibold text-navy-900 hover:bg-gold-300 disabled:opacity-50"><Radio className="h-4 w-4" /> Go live</button>
            )}
            <ReactionBar onReact={chat.react} />
          </div>
        </main>
        <StreamChat lines={chat.lines} onSend={chat.send} className="h-72 border-t border-white/10 lg:h-auto lg:w-80 lg:border-l lg:border-t-0" />
      </div>
      <ConfirmDialog open={confirmEnd} onClose={() => setConfirmEnd(false)} onConfirm={end} title="End the stream?" message="Everyone watching sees that it has ended, and the watch link stops working." confirmLabel="End stream" danger />
    </div>
  );
}
