import { useMemo, useState } from 'react';
import { Search, ChevronDown, Check, Lock, UserPlus, LayoutGrid, Users2, MessageCircle, Footprints, Hand, Route } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { TypeArt } from '@/components/spaces/TypeArt';
import { spaceTypeInfo } from '@/spatial/data/spaceTypes';
import { STATUS_OPTIONS, shownStatus, statusInfo, type PresenceStatus } from '@/spatial/net/status';
import type { PresenceMeta } from '@/spatial/net/protocol';
import { cn } from '@/lib/utils';
import { Popover } from './Popover';
import { menuItem } from './styles';
import type { Space, SpaceRoom } from '@/types';

interface PeoplePanelProps {
  space: Space;
  otherSpaces: Pick<Space, 'id' | 'name' | 'slug' | 'space_type'>[];
  people: PresenceMeta[];
  meId: string;
  status: PresenceStatus;
  onStatus: (s: PresenceStatus) => void;
  onOpenSpace: (slug: string) => void;
  onAllSpaces: () => void;
  canInvite: boolean;
  onInvite: () => void;
  /** People with a raised hand. */
  raisedHands: Set<string>;
  /** My conversation group from proximity (falls back to my presence). */
  conversation?: string[];
  onWave: (userId: string) => void;
  /** Walk to someone in the 3D world. */
  onWalkTo?: (userId: string) => void;
  className?: string;
}

const splitName = (name: string) => {
  const [first, ...rest] = name.split(' ');
  return { first, last: rest.join(' ') };
};

/** Left panel inside a space: switcher, search, your status, and who's where. */
export function PeoplePanel({
  space, otherSpaces, people, meId, status, onStatus, onOpenSpace, onAllSpaces, canInvite, onInvite, raisedHands, onWave, onWalkTo, conversation, className,
}: PeoplePanelProps) {
  const [query, setQuery] = useState('');
  const rooms = useMemo(() => new Map((space.config?.rooms ?? []).map((r) => [r.id, r])), [space.config]);
  const me = people.find((p) => p.userId === meId);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
  }, [people, query]);

  const conversationIds = new Set(conversation ?? me?.conversation ?? []);
  const inConversation = visible.filter((p) => p.userId === meId ? conversationIds.size > 0 : conversationIds.has(p.userId));
  const rest = visible.filter((p) => !inConversation.includes(p));
  const zoneGroups = new Map<string, PresenceMeta[]>();
  const around: PresenceMeta[] = [];
  for (const p of rest) {
    if (p.zoneId && rooms.has(p.zoneId)) zoneGroups.set(p.zoneId, [...(zoneGroups.get(p.zoneId) ?? []), p]);
    else around.push(p);
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-white', className)}>
      <div className="space-y-3 border-b border-navy-50 p-4">
        <SpaceSwitcher space={space} online={people.length} otherSpaces={otherSpaces} onOpenSpace={onOpenSpace} onAllSpaces={onAllSpaces} />
        <label className="relative block">
          <span className="sr-only">Find someone</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find someone"
            className="w-full rounded-xl border border-navy-100 bg-ivory-50/60 py-2 pl-9 pr-3 text-sm text-navy-800 placeholder:text-ivory-600 focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/30"
          />
        </label>
        <StatusSelect status={status} onStatus={onStatus} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {inConversation.length > 0 && (
          <Section title="In your conversation" count={inConversation.length} icon={<MessageCircle className="h-3.5 w-3.5 text-gold-600" />}>
            {inConversation.map((p) => <PersonRow key={p.userId} person={p} me={p.userId === meId} hand={raisedHands.has(p.userId)} onWave={onWave} onWalkTo={onWalkTo} />)}
          </Section>
        )}
        {[...zoneGroups.entries()].map(([zoneId, list]) => {
          const room = rooms.get(zoneId) as SpaceRoom;
          return (
            <Section key={zoneId} title={room.name} count={list.length} icon={room.lockable ? <Lock className="h-3.5 w-3.5 text-ivory-700" aria-label="Lockable room" /> : null}>
              {list.map((p) => <PersonRow key={p.userId} person={p} me={p.userId === meId} hand={raisedHands.has(p.userId)} onWave={onWave} onWalkTo={onWalkTo} />)}
            </Section>
          );
        })}
        <Section title="Around the office" count={around.length}>
          {around.length === 0 ? (
            <p className="px-2 py-1 text-xs text-ivory-700">{query ? 'No one matches that name.' : 'No one else is here right now.'}</p>
          ) : (
            around.map((p) => <PersonRow key={p.userId} person={p} me={p.userId === meId} hand={raisedHands.has(p.userId)} onWave={onWave} onWalkTo={onWalkTo} where={p.zoneId ? 'Elsewhere' : 'Main floor'} />)
          )}
        </Section>
        {/* AI agents appear here once they can join a space. */}
      </div>

      {canInvite && (
        <div className="border-t border-navy-50 p-3">
          <button type="button" onClick={onInvite} className="btn-secondary w-full !py-2">
            <UserPlus className="h-4 w-4" /> Invite people
          </button>
        </div>
      )}
    </div>
  );
}

function SpaceSwitcher({ space, online, otherSpaces, onOpenSpace, onAllSpaces }: {
  space: Space;
  online: number;
  otherSpaces: PeoplePanelProps['otherSpaces'];
  onOpenSpace: (slug: string) => void;
  onAllSpaces: () => void;
}) {
  const info = spaceTypeInfo(space.space_type);
  return (
    <Popover
      label="Switch workspace"
      panelClassName="left-0 right-0 top-full mt-1"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${space.name}, switch workspace`}
          className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition hover:bg-ivory-50"
        >
          <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-navy-800"><TypeArt info={info} eager /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-navy-800">{space.name}</span>
            <span className="flex items-center gap-1.5 text-xs text-ivory-700">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Main Floor · {online} online
            </span>
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-ivory-700 transition', open && 'rotate-180')} />
        </button>
      )}
    >
      {(close) => (
        <>
          {otherSpaces.map((s) => (
            <button key={s.id} role="menuitem" className={menuItem} onClick={() => { close(); onOpenSpace(s.slug); }}>
              <span className="h-6 w-6 shrink-0 overflow-hidden rounded-md bg-navy-800"><TypeArt info={spaceTypeInfo(s.space_type)} /></span>
              <span className="truncate">{s.name}</span>
            </button>
          ))}
          {otherSpaces.length > 0 && <div className="my-1 border-t border-navy-50" />}
          <button role="menuitem" className={menuItem} onClick={() => { close(); onAllSpaces(); }}>
            <LayoutGrid className="h-4 w-4 text-gold-600" /> All workspaces
          </button>
        </>
      )}
    </Popover>
  );
}

function StatusSelect({ status, onStatus }: { status: PresenceStatus; onStatus: (s: PresenceStatus) => void }) {
  const current = statusInfo(status);
  return (
    <Popover
      label="Set your status"
      panelClassName="left-0 right-0 top-full mt-1"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Your status: ${current.label}`}
          className="flex w-full items-center gap-2 rounded-xl border border-navy-100 px-3 py-2 text-sm font-medium text-navy-800 transition hover:border-navy-200"
        >
          <span className={cn('h-2.5 w-2.5 rounded-full', current.dot)} />
          <span className="flex-1 text-left">{current.label}</span>
          <ChevronDown className={cn('h-4 w-4 text-ivory-700 transition', open && 'rotate-180')} />
        </button>
      )}
    >
      {(close) => STATUS_OPTIONS.map((o) => (
        <button key={o.value} role="menuitemradio" aria-checked={o.value === status} className={menuItem} onClick={() => { onStatus(o.value); close(); }}>
          <span className={cn('h-2.5 w-2.5 rounded-full', o.dot)} />
          <span className="flex-1">{o.label}</span>
          {o.value === status && <Check className="h-4 w-4 text-gold-600" />}
        </button>
      ))}
    </Popover>
  );
}

function Section({ title, count, icon, children }: { title: string; count: number; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-bold uppercase tracking-wider text-ivory-700">
        {icon}
        <span className="truncate">{title}</span>
        <span className="font-semibold text-ivory-600">· {count}</span>
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

function PersonRow({ person, me, where, hand, onWave, onWalkTo }: { person: PresenceMeta; me: boolean; where?: string; hand: boolean; onWave: (userId: string) => void; onWalkTo?: (userId: string) => void }) {
  const { first, last } = splitName(person.name);
  const st = shownStatus(person);
  const row = (
    <>
      <span className="relative shrink-0">
        <Avatar firstName={first} lastName={last} src={person.avatarUrl} size="md" />
        <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white', st.dot)} title={st.label} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-navy-800">{person.name}{me && <span className="font-normal text-ivory-700"> (you)</span>}</span>
        <span className="block truncate text-xs text-ivory-700">{where ? `${st.label} · ${where}` : st.label}</span>
      </span>
      {hand && <Hand className="h-4 w-4 shrink-0 text-gold-600" aria-label="Hand raised" />}
    </>
  );
  if (me) return <li className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">{row}</li>;
  return (
    <li>
      <Popover
        label={`Actions for ${person.name}`}
        panelClassName="left-2 right-2 top-full mt-1"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-haspopup="menu"
            aria-expanded={open}
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-ivory-50 focus:bg-ivory-50 focus:outline-none"
          >
            {row}
          </button>
        )}
      >
        {(close) => (
          <>
            {onWalkTo ? (
              <button role="menuitem" className={menuItem} onClick={() => { onWalkTo(person.userId); close(); }}><Footprints className="h-4 w-4 text-gold-600" /> Walk to</button>
            ) : (
              <button role="menuitem" className={menuItem} disabled title="Available with the 3D office"><Footprints className="h-4 w-4 text-ivory-600" /> <span className="flex-1 text-ivory-600">Walk to</span><span className="text-[11px] text-ivory-600">Soon</span></button>
            )}
            <button role="menuitem" className={menuItem} onClick={() => { onWave(person.userId); close(); }}><span aria-hidden="true">👋</span> Wave</button>
            <button role="menuitem" className={menuItem} disabled title="Available with the 3D office"><Route className="h-4 w-4 text-ivory-600" /> <span className="flex-1 text-ivory-600">Follow</span><span className="text-[11px] text-ivory-600">Soon</span></button>
          </>
        )}
      </Popover>
    </li>
  );
}

export function PeopleCountButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-sm font-semibold text-navy-800 shadow-popover backdrop-blur">
      <Users2 className="h-4 w-4 text-gold-600" /> People · {count}
    </button>
  );
}
