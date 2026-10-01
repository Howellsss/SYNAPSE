import { useEffect, useRef, useState } from 'react';
import { MicOff, X, Maximize2 } from 'lucide-react';
import type { Room } from 'livekit-client';
import { Avatar } from '@/components/ui/Avatar';
import { cameraOf, type InRangePerson } from '@/spatial/media/useProximity';
import { cn } from '@/lib/utils';
import type { PresenceMeta } from '@/spatial/net/protocol';

const split = (name: string) => { const [first, ...rest] = name.split(' '); return { first, last: rest.join(' ') }; };

/** Video tiles for the people you're talking to, top center. */
export function VideoStrip({ room, inRange, people, activeSpeakers, tick }: {
  room: Room | null;
  inRange: InRangePerson[];
  people: PresenceMeta[];
  activeSpeakers: string[];
  /** Changes when LiveKit tracks change, so tiles re-check their camera. */
  tick?: unknown;
}) {
  const [enlarged, setEnlarged] = useState<string | null>(null);
  // As many tiles as fit in the space we have (leaving room for "+N"), at most 8.
  const boxRef = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(4);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const tile = window.innerWidth < 640 ? 104 : 136;
      const gap = 8;
      const fit = Math.floor((el.clientWidth + gap) / (tile + gap));
      setMax(Math.max(1, Math.min(8, fit)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (enlarged && !inRange.some((p) => p.id === enlarged)) setEnlarged(null);
  }, [enlarged, inRange]);

  const shown = inRange.length > max ? inRange.slice(0, Math.max(1, max - 1)) : inRange;
  const extra = inRange.length - shown.length;
  const nameOf = (id: string) => people.find((p) => p.userId === id)?.name ?? room?.remoteParticipants.get(id)?.name ?? 'Guest';

  return (
    <div ref={boxRef} className="flex w-full justify-center">
      {inRange.length > 0 && (
      <ul className="flex max-w-full items-start gap-2 px-1 pb-1" aria-label="People you're talking to">
        {shown.map((p) => (
          <li key={p.id}>
            <Tile
              room={room}
              person={p}
              name={nameOf(p.id)}
              avatarUrl={people.find((x) => x.userId === p.id)?.avatarUrl ?? null}
              speaking={activeSpeakers.includes(p.id)}
              onEnlarge={() => setEnlarged(p.id)}
              tick={tick}
            />
          </li>
        ))}
        {extra > 0 && (
          <li className="flex h-[72px] w-14 shrink-0 items-center justify-center rounded-xl bg-navy-900/85 text-sm font-bold text-white sm:h-[90px] sm:w-16" aria-label={`${extra} more`}>
            +{extra}
          </li>
        )}
      </ul>
      )}
      {enlarged && inRange.some((p) => p.id === enlarged) && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-navy-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={nameOf(enlarged)} onClick={() => setEnlarged(null)}>
          <div className="relative w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <Tile
              room={room}
              person={inRange.find((p) => p.id === enlarged)!}
              name={nameOf(enlarged)}
              avatarUrl={people.find((x) => x.userId === enlarged)?.avatarUrl ?? null}
              speaking={activeSpeakers.includes(enlarged)}
              large
              tick={tick}
            />
            <button type="button" onClick={() => setEnlarged(null)} aria-label="Close" className="absolute right-3 top-3 rounded-full bg-navy-900/80 p-2 text-white hover:bg-navy-900"><X className="h-5 w-5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ room, person, name, avatarUrl, speaking, onEnlarge, large, tick }: {
  room: Room | null;
  person: InRangePerson;
  name: string;
  avatarUrl: string | null;
  speaking: boolean;
  onEnlarge?: () => void;
  large?: boolean;
  tick?: unknown;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pub = person.video ? cameraOf(room, person.id) : null;
  const track = pub && !pub.isMuted ? pub.track : null;
  const participant = room?.remoteParticipants.get(person.id);
  const muted = participant ? !participant.isMicrophoneEnabled : true;
  const { first, last } = split(name);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track, tick]);

  const body = (
    <div
      className={cn(
        'relative overflow-hidden bg-navy-800 ring-2 transition',
        large ? 'aspect-video w-full rounded-3xl' : 'h-[72px] w-[104px] rounded-xl sm:h-[90px] sm:w-[136px]',
        speaking ? 'ring-gold-400 shadow-[0_0_0_4px_rgba(228,169,60,0.25)]' : 'ring-white/10',
      )}
      data-speaking={speaking || undefined}
    >
      {track ? (
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(228,169,60,0.18),transparent_65%)]">
          <Avatar firstName={first} lastName={last} src={avatarUrl} size={large ? 'xl' : 'lg'} className={cn(large && '!h-28 !w-28 !text-3xl', !large && 'max-sm:!h-9 max-sm:!w-9 max-sm:!text-sm')} />
        </div>
      )}
      <span className="absolute bottom-1 left-1 right-1 flex items-center gap-1 truncate rounded-md bg-navy-900/75 px-1.5 py-0.5 text-[11px] font-semibold text-white">
        {muted && <MicOff className="h-3 w-3 shrink-0 text-red-300" aria-label="Muted" />}
        <span className="truncate">{name}</span>
      </span>
      {!large && <Maximize2 className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-white/0 transition group-hover:text-white/80" aria-hidden="true" />}
    </div>
  );
  if (large) return body;
  return (
    <button type="button" onClick={onEnlarge} className="group block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400" aria-label={`${name}${speaking ? ', speaking' : ''}${muted ? ', muted' : ''}. Enlarge`}>
      {body}
    </button>
  );
}
