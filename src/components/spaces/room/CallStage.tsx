import { useEffect, useRef } from 'react';
import { Maximize2, Mic, MicOff, Minimize2 } from 'lucide-react';
import type { Room, Track } from 'livekit-client';
import { Avatar } from '@/components/ui/Avatar';
import { cameraOf, type InRangePerson } from '@/spatial/media/useProximity';
import { cn } from '@/lib/utils';
import type { PresenceMeta } from '@/spatial/net/protocol';

interface StageTile {
  id: string;
  name: string;
  avatarUrl: string | null;
  video: Track | null;
  muted: boolean;
  speaking: boolean;
  local: boolean;
}

function TileVideo({ track, mirror }: { track: Track; mirror: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={cn('h-full w-full object-cover', mirror && '-scale-x-100')} />;
}

/** One person's picture: their camera, or their initials when it's off; name and mic at the bottom. */
function Tile({ tile, big }: { tile: StageTile; big?: boolean }) {
  const [first, ...rest] = tile.name.split(' ');
  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-xl bg-navy-800 text-white" data-speaking={tile.speaking || undefined}>
      {tile.video ? (
        <TileVideo track={tile.video} mirror={tile.local} />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {tile.avatarUrl
            ? <Avatar firstName={first} lastName={rest.join(' ')} src={tile.avatarUrl} size="xl" className={big ? '!h-24 !w-24' : '!h-12 !w-12'} />
            : <span className={cn('flex items-center justify-center rounded-full bg-gold-400 font-semibold text-navy-900', big ? 'h-24 w-24 text-[32px]' : 'h-12 w-12 text-lg')}>{(first?.[0] ?? '') + (rest[rest.length - 1]?.[0] ?? '')}</span>}
        </div>
      )}
      {tile.speaking && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-xl shadow-[inset_0_0_0_3px_#E4A93C]" />}
      <span className="absolute bottom-1.5 left-1.5 flex h-6 max-w-[90%] items-center gap-1.5 truncate rounded bg-black/55 px-2 text-[12.5px] font-medium">
        {tile.muted ? <MicOff className="h-3.5 w-3.5 shrink-0 text-[#FF9C93]" /> : <Mic className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{tile.name}{tile.local ? ' (you)' : ''}</span>
      </span>
    </div>
  );
}

interface StageProps {
  room: Room | null;
  me: { id: string; name: string; avatarUrl: string | null; micOn: boolean; camera: Track | null };
  inRange: InRangePerson[];
  people: PresenceMeta[];
  activeSpeakers: string[];
}

function tilesFor({ room, me, inRange, people, activeSpeakers }: StageProps): StageTile[] {
  const mine: StageTile = { id: me.id, name: me.name, avatarUrl: me.avatarUrl, video: me.camera, muted: !me.micOn, speaking: activeSpeakers.includes(me.id), local: true };
  const others = inRange.map((p): StageTile => {
    const pub = p.video ? cameraOf(room, p.id) : null;
    const participant = room?.remoteParticipants.get(p.id);
    return {
      id: p.id,
      name: people.find((x) => x.userId === p.id)?.name ?? participant?.name ?? 'Guest',
      avatarUrl: people.find((x) => x.userId === p.id)?.avatarUrl ?? null,
      video: pub && !pub.isMuted ? pub.track ?? null : null,
      muted: participant ? !participant.isMicrophoneEnabled : true,
      speaking: activeSpeakers.includes(p.id),
      local: false,
    };
  });
  return [mine, ...others];
}

/** Your own camera, small, in the bottom-left corner of the space; the corner button opens the meeting view. */
export function SelfView({ onExpand, ...props }: StageProps & { onExpand: () => void }) {
  const tile = tilesFor({ ...props, inRange: [] })[0];
  return (
    <div className="group relative h-[84px] w-[150px] overflow-hidden rounded-xl shadow-popover ring-2 ring-white/80 sm:h-[112px] sm:w-[200px] lg:h-[135px] lg:w-[240px]">
      <Tile tile={tile} />
      <button
        type="button"
        onClick={onExpand}
        aria-label="Open the meeting view"
        title="Meeting view"
        className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-navy-900/70 text-white backdrop-blur transition hover:bg-navy-900/90"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  );
}

/** The meeting view: you and everyone you're talking to, laid out like a SYNAPSE meeting. */
export function CallStage({ onClose, ...props }: StageProps & { onClose: () => void }) {
  const tiles = tilesFor(props);
  const count = tiles.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-[20] flex flex-col bg-white px-2 pb-24 pt-14 sm:px-4 lg:pb-24 lg:pt-16" role="region" aria-label="Meeting view">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-navy-800 px-4 text-sm font-semibold text-white shadow-popover hover:bg-navy-700"
      >
        <Minimize2 className="h-4 w-4" /> Back to the space
      </button>
      {count === 1 && <p className="mb-2 text-center text-sm text-ivory-700">Walk up to someone in the space to talk; they'll appear here.</p>}
      <div className={cn('grid min-h-0 flex-1 auto-rows-fr gap-1.5', count === 1 ? 'grid-cols-1' : count <= 4 ? 'grid-cols-1 sm:grid-cols-2' : count <= 9 ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
        {tiles.map((t) => <Tile key={t.id} tile={t} big={count <= 2} />)}
      </div>
    </div>
  );
}
