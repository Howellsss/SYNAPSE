import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { LocalTrack, RemoteTrack, Track } from 'livekit-client';
import { MessageSquare, Send, Smile } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STREAM_REACTIONS, type StreamChatLine } from '@/lib/streams';
import type { FloatingReaction } from './useStream';

export function TrackVideo({ track, mirror, className }: { track: Track | null | undefined; mirror?: boolean; className?: string }) {
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

/**
 * What viewers see: the shared screen big with the camera in a corner, or the camera alone.
 * `camera`/`screen` are the host's tracks (local in the studio, remote for viewers).
 */
export function StreamStage({ camera, screen, mirror, placeholder }: { camera: Track | null | undefined; screen: Track | null | undefined; mirror?: boolean; placeholder: React.ReactNode }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-navy-950">
      {screen ? (
        <>
          <TrackVideo track={screen} className="h-full w-full object-contain" />
          {camera && <TrackVideo track={camera} mirror={mirror} className="absolute bottom-3 right-3 aspect-video w-1/4 min-w-[120px] rounded-lg object-cover shadow-lg ring-2 ring-white/20" />}
        </>
      ) : camera ? (
        <TrackVideo track={camera} mirror={mirror} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-6 text-center text-ivory-300">{placeholder}</div>
      )}
    </div>
  );
}

export function FloatingReactions({ items }: { items: FloatingReaction[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {items.map((r) => (
        <span key={r.id} className="absolute bottom-4 animate-[float-up_2.6s_ease-out_forwards] text-3xl" style={{ left: `${r.left}%` }}>{r.e}</span>
      ))}
    </div>
  );
}

export function ReactionBar({ onReact }: { onReact: (e: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1" role="group" aria-label="React">
      <Smile className="mr-1 h-4 w-4 text-ivory-300" aria-hidden="true" />
      {STREAM_REACTIONS.map((e) => (
        <button key={e} type="button" onClick={() => onReact(e)} aria-label={`React ${e}`} className="rounded-full px-1.5 py-0.5 text-lg transition hover:scale-125 hover:bg-white/10">{e}</button>
      ))}
    </div>
  );
}

export function StreamChat({ lines, onSend, disabled, className }: { lines: StreamChatLine[]; onSend: (t: string) => boolean; disabled?: string | null; className?: string }) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [lines.length]);
  const submit = (e: FormEvent) => { e.preventDefault(); if (onSend(text)) setText(''); };
  return (
    <aside className={cn('flex min-h-0 flex-col bg-white', className)} aria-label="Live chat">
      <header className="flex items-center gap-2 border-b border-ivory-200 px-4 py-3 text-sm font-semibold text-navy-800"><MessageSquare className="h-4 w-4" /> Live chat</header>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
        {lines.length === 0 && <li className="text-ivory-700">Say hello 👋</li>}
        {lines.map((l) => (
          <li key={l.id} className="break-words">
            <span className={cn('font-semibold', l.host ? 'text-gold-700' : 'text-navy-800')}>{l.name}{l.host ? ' · Host' : ''}</span>{' '}
            <span className="text-navy-700">{l.text}</span>
          </li>
        ))}
        <div ref={endRef} />
      </ol>
      {disabled ? (
        <p className="border-t border-ivory-200 px-4 py-3 text-xs text-ivory-700">{disabled}</p>
      ) : (
        <form onSubmit={submit} className="flex items-center gap-2 border-t border-ivory-200 p-3">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Say something" aria-label="Chat message" className="input-field min-w-0 flex-1" />
          <button type="submit" disabled={!text.trim()} aria-label="Send" className="rounded-lg bg-navy-800 p-2 text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
        </form>
      )}
    </aside>
  );
}
