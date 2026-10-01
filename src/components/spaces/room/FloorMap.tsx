import { DoorClosed, Lock, LockOpen, Hand, Users, X } from 'lucide-react';
import { roomTypeLabel } from '@/spatial/data/rooms';
import { zoneRule } from '@/spatial/media/proximity';
import type { PresenceMeta } from '@/spatial/net/protocol';
import type { SpaceRoom } from '@/types';

/** Floor map: rooms and zones, who's inside, and locking/knocking for lockable rooms. */
export function FloorMap({ spaceName, rooms, people, locked, myLocks, canLock, admitted, myZone, onToggleLock, onKnock, onClose }: {
  spaceName: string;
  rooms: SpaceRoom[];
  people: PresenceMeta[];
  locked: Set<string>;
  myLocks: string[];
  canLock: boolean;
  admitted: Set<string>;
  myZone: string | null;
  onToggleLock: (zoneId: string) => void;
  onKnock: (zoneId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-16 top-1/2 z-20 w-[min(20rem,calc(100%-6rem))] -translate-y-1/2 rounded-2xl bg-white/95 p-4 shadow-popover backdrop-blur sm:right-20" role="dialog" aria-label="Floor map">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-sm font-bold text-navy-800">{spaceName}</p>
        <button type="button" onClick={onClose} aria-label="Close floor map" className="rounded-lg p-1 text-ivory-700 hover:bg-ivory-50"><X className="h-4 w-4" /></button>
      </div>
      <p className="mb-2 flex items-center gap-1.5 text-xs text-ivory-700"><Users className="h-3.5 w-3.5" /> Main Floor · {people.length} online</p>
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {rooms.map((r) => {
          const inside = people.filter((p) => p.zoneId === r.id).length;
          const isLocked = locked.has(r.id);
          const lockable = r.lockable && zoneRule(r.type) === 'closed';
          return (
            <li key={r.id} className="rounded-lg px-2 py-1.5 text-sm hover:bg-ivory-50">
              <div className="flex items-center gap-2">
                <DoorClosed className="h-4 w-4 shrink-0 text-gold-600" />
                <span className="min-w-0 flex-1 truncate text-navy-800">{r.name}{inside > 0 && <span className="text-ivory-700"> · {inside} inside</span>}</span>
                {isLocked && <Lock className="h-3.5 w-3.5 shrink-0 text-burgundy-500" aria-label="Locked" />}
                {!isLocked && r.knock_to_enter && <Hand className="h-3.5 w-3.5 shrink-0 text-ivory-700" aria-label="Knock to enter" />}
              </div>
              <div className="mt-0.5 flex items-center gap-2 pl-6 text-xs text-ivory-700">
                <span className="flex-1">{roomTypeLabel(r.type)} · {r.capacity}</span>
                {lockable && canLock && (isLocked ? myLocks.includes(r.id) : true) && (
                  <button type="button" onClick={() => onToggleLock(r.id)} className="inline-flex items-center gap-1 font-semibold text-gold-700 hover:text-gold-600">
                    {isLocked ? <><LockOpen className="h-3.5 w-3.5" /> Unlock</> : <><Lock className="h-3.5 w-3.5" /> Lock</>}
                  </button>
                )}
                {isLocked && !canLock && myZone !== r.id && (
                  admitted.has(r.id)
                    ? <span className="font-semibold text-green-700">You can go in</span>
                    : <button type="button" onClick={() => onKnock(r.id)} className="inline-flex items-center gap-1 font-semibold text-gold-700 hover:text-gold-600"><Hand className="h-3.5 w-3.5" /> Knock</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
