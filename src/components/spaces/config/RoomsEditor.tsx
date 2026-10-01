import { useState } from 'react';
import { Plus, Trash2, Lock, Hand, RotateCcw } from 'lucide-react';
import type { RoomType, SpaceRoom } from '@/types';
import { ROOM_TYPES, MAX_ROOMS, MAX_ROOM_CAPACITY, newRoom } from '@/spatial/data/rooms';
import { cn } from '@/lib/utils';

/** Edit the rooms and zones of a space: rename, change type and capacity, door settings, add, remove. */
export function RoomsEditor({ rooms, onChange, onReset, resetLabel }: {
  rooms: SpaceRoom[];
  onChange: (rooms: SpaceRoom[]) => void;
  /** Shown when the list can go back to the template's rooms. */
  onReset?: () => void;
  resetLabel?: string;
}) {
  const [addType, setAddType] = useState<RoomType>('meeting_room');
  const update = (id: string, patch: Partial<SpaceRoom>) => onChange(rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div>
      <ul className="space-y-2.5">
        {rooms.map((room) => (
          <li key={room.id} className="rounded-xl border border-navy-100 bg-white p-3">
            <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_88px_auto]">
              <input
                className="input-field !py-2"
                value={room.name}
                maxLength={60}
                onChange={(e) => update(room.id, { name: e.target.value })}
                aria-label="Room name"
                aria-invalid={!room.name.trim()}
                placeholder="Room name"
              />
              <button
                type="button"
                onClick={() => onChange(rooms.filter((r) => r.id !== room.id))}
                className="rounded-lg p-2 text-ivory-700 hover:bg-red-50 hover:text-burgundy-600 sm:order-last"
                aria-label={`Remove ${room.name || 'room'}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <select
                className="input-field !py-2"
                value={room.type}
                onChange={(e) => update(room.id, { type: e.target.value as RoomType })}
                aria-label={`${room.name || 'Room'} type`}
              >
                {ROOM_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
              <label className="relative block">
                <span className="sr-only">{room.name || 'Room'} capacity</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_ROOM_CAPACITY}
                  inputMode="numeric"
                  className="input-field !py-2 !pr-8"
                  value={Number.isFinite(room.capacity) ? room.capacity : ''}
                  onChange={(e) => update(room.id, { capacity: Math.round(Number(e.target.value)) })}
                  aria-invalid={!(room.capacity >= 1 && room.capacity <= MAX_ROOM_CAPACITY)}
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ivory-600">ppl</span>
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              <Toggle checked={room.lockable} onChange={(v) => update(room.id, { lockable: v })} icon={Lock} label="Lockable" />
              <Toggle checked={room.knock_to_enter} onChange={(v) => update(room.id, { knock_to_enter: v })} icon={Hand} label="Knock to enter" />
            </div>
          </li>
        ))}
      </ul>
      {rooms.length === 0 && <p className="rounded-xl border border-dashed border-burgundy-400/40 px-4 py-5 text-center text-sm text-burgundy-600">Add at least one room or zone.</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className="input-field !w-auto !py-2" value={addType} onChange={(e) => setAddType(e.target.value as RoomType)} aria-label="Type of room to add">
          {ROOM_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
        <button type="button" disabled={rooms.length >= MAX_ROOMS} onClick={() => onChange([...rooms, newRoom(addType, rooms)])} className="btn-secondary !py-2">
          <Plus className="h-4 w-4" /> Add room
        </button>
        {onReset && (
          <button type="button" onClick={onReset} className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-ivory-700 hover:text-navy-800">
            <RotateCcw className="h-3.5 w-3.5" /> {resetLabel ?? 'Reset rooms'}
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, icon: Icon, label }: { checked: boolean; onChange: (v: boolean) => void; icon: typeof Lock; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-navy-700">
      <span className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition', checked ? 'bg-gold-400' : 'bg-navy-100')}>
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={cn('absolute h-4 w-4 rounded-full bg-white shadow transition', checked ? 'left-[18px]' : 'left-0.5')} />
        <span className="absolute inset-0 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-gold-400/60" />
      </span>
      <Icon className="h-3.5 w-3.5 text-ivory-700" /> {label}
    </label>
  );
}
