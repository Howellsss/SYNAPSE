import { Armchair, DoorClosed, Sofa, Users, MicOff, VideoOff, Link2, Lock, Hand, ShieldCheck, CalendarClock, FileJson } from 'lucide-react';
import { spaceTypeInfo, typeChoiceInfo } from '@/spatial/data/spaceTypes';
import { templateInfo } from '@/spatial/data/templates';
import { SIZE_OPTIONS, setupSummary } from '@/spatial/data/sizing';
import { buildRooms, roomTypeLabel } from '@/spatial/data/rooms';
import { displaySpaceLink } from '@/spatial/links';
import { describeSchedule } from '@/spatial/schedule';
import { getInitials } from '@/lib/utils';
import { SpacePreview } from '../SpacePreview';
import { GlancePanel } from './GlancePanel';
import { effectiveRooms, effectiveTemplateKey, effectiveType, type WizardState } from './state';
import type { SpaceRoom } from '@/types';

const SETUP_ICONS = { desks: Armchair, rooms: DoorClosed, lounges: Sofa, capacity: Users } as const;
const ACCESS_TEXT = { members: 'Members of this account', invite_only: 'Invite only', guest_link: 'Anyone with a guest link' } as const;

/** Right-hand panel of the wizard; mirrors the choices made so far. */
export function LivePreview({ state, userName }: { state: WizardState; userName: string }) {
  if (state.step === 'type') return <GlancePanel info={typeChoiceInfo(state.typeChoice)} />;

  const spaceType = effectiveType(state);
  const type = spaceTypeInfo(spaceType);
  const template = templateInfo(effectiveTemplateKey(state));
  const name = state.name.trim() || 'Your workspace';
  const size = SIZE_OPTIONS.find((o) => o.band === state.sizeBand);
  const afterLayout = ['layout', 'import', 'configure', 'invite', 'avatar', 'media'].includes(state.step);

  return (
    <div className="flex h-full flex-col text-white">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold-400">Live preview</p>

      <div className="mt-5">
        <SpacePreview
          title={afterLayout && template ? template.name : name}
          subtitle={afterLayout ? name : `${type.name}${state.step === 'size' && size ? ` · ${size.people}` : ''}`}
          icon={type.icon}
          size="lg"
          wallScreen={state.step === 'configure' ? { logoUrl: state.branding.logo_url, accent: state.branding.accent } : undefined}
        />
      </div>

      <div className="mt-6 min-h-0 flex-1">
        {state.step === 'name' && (
          <div className="space-y-3">
            <p className="break-words text-2xl font-bold">{name}</p>
            {state.slug && <p className="flex items-center gap-2 font-mono text-sm text-gold-300"><Link2 className="h-4 w-4 shrink-0" /> {displaySpaceLink(state.slug)}</p>}
            {state.description.trim() && <p className="text-sm leading-relaxed text-ivory-500">{state.description.trim()}</p>}
          </div>
        )}

        {state.step === 'size' && (
          <ul className="grid gap-3">
            {setupSummary(state.sizeBand, spaceType).map((item) => {
              const Icon = SETUP_ICONS[item.key as keyof typeof SETUP_ICONS];
              return (
                <li key={item.key} className="flex items-center gap-3 text-sm text-ivory-200">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-gold-400"><Icon className="h-4 w-4" /></span>
                  {item.text}
                </li>
              );
            })}
          </ul>
        )}

        {state.step === 'layout' && <RoomList title="Rooms & zones" rooms={buildRooms(state.templateKey, state.sizeBand)} />}

        {state.step === 'import' && (
          state.importedLayout
            ? <RoomList title={`From ${state.importFileName ?? 'your file'}`} rooms={state.importedLayout.config.rooms} />
            : <p className="flex items-center gap-2 text-sm text-ivory-500"><FileJson className="h-4 w-4" /> Upload a layout to see its rooms here.</p>
        )}

        {state.step === 'configure' && (
          <div className="space-y-4">
            <RoomList title="Rooms & zones" rooms={effectiveRooms(state)} detailed />
            <div className="space-y-1.5 border-t border-white/10 pt-4 text-sm text-ivory-200">
              <p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-gold-400" /> {ACCESS_TEXT[state.accessMode]}</p>
              <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-gold-400" /> {state.persistence === 'scheduled' ? describeSchedule(state.schedule) : 'Always on'}</p>
            </div>
          </div>
        )}

        {state.step === 'invite' && (
          <div>
            <p className="text-sm font-semibold text-ivory-200">
              {state.invites.length ? `${state.invites.length} ${state.invites.length === 1 ? 'person' : 'people'} invited as ${state.inviteRole}s` : 'Just you for now'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Initials label={userName} you />
              {state.invites.slice(0, 11).map((email) => <Initials key={email} label={email} />)}
              {state.invites.length > 11 && <span className="flex h-9 items-center px-1 text-sm text-ivory-500">+{state.invites.length - 11}</span>}
            </div>
          </div>
        )}

        {(state.step === 'avatar' || state.step === 'media') && (
          <div className="space-y-3">
            <p className="break-words text-xl font-bold">{name}</p>
            <div className="flex items-center gap-3">
              <Initials label={userName} you />
              <div className="text-sm">
                <p className="font-semibold">{userName}</p>
                <p className="flex items-center gap-2 text-ivory-500"><MicOff className="h-3.5 w-3.5" /> Muted <VideoOff className="ml-1 h-3.5 w-3.5" /> Camera off</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RoomList({ title, rooms, detailed }: { title: string; rooms: SpaceRoom[]; detailed?: boolean }) {
  return (
    <div>
      <p className="text-sm font-semibold text-ivory-200">{title} <span className="font-normal text-ivory-500">· {rooms.length}</span></p>
      <ul className="mt-3 space-y-1.5">
        {rooms.slice(0, 14).map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-sm text-ivory-200">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400" />
            <span className="min-w-0 flex-1 truncate">{r.name || 'Unnamed room'}</span>
            {detailed && <span className="shrink-0 text-xs text-ivory-500">{roomTypeLabel(r.type)} · {r.capacity}</span>}
            {detailed && r.lockable && <Lock className="h-3.5 w-3.5 shrink-0 text-ivory-500" aria-label="Lockable" />}
            {detailed && r.knock_to_enter && <Hand className="h-3.5 w-3.5 shrink-0 text-ivory-500" aria-label="Knock to enter" />}
          </li>
        ))}
        {rooms.length > 14 && <li className="text-xs text-ivory-500">+{rooms.length - 14} more</li>}
      </ul>
    </div>
  );
}

function Initials({ label, you }: { label: string; you?: boolean }) {
  const parts = label.includes('@') ? [label.split('@')[0], ''] : label.split(' ');
  return (
    <span
      title={you ? `${label} (you)` : label}
      className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${you ? 'bg-gold-400 text-white' : 'bg-white/10 text-ivory-100 ring-1 ring-white/15'}`}
    >
      {getInitials(parts[0], parts[1]) || '?'}
    </span>
  );
}
