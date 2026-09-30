import { Armchair, DoorClosed, Sofa, Users, MapPin, MicOff, VideoOff, Link2 } from 'lucide-react';
import { spaceTypeInfo } from '@/spatial/data/spaceTypes';
import { templateInfo } from '@/spatial/data/templates';
import { SIZE_OPTIONS, setupSummary } from '@/spatial/data/sizing';
import { displaySpaceLink } from '@/spatial/links';
import { getInitials } from '@/lib/utils';
import { SpacePreview } from '../SpacePreview';
import type { WizardState } from './state';

const SETUP_ICONS = { desks: Armchair, rooms: DoorClosed, lounges: Sofa, capacity: Users } as const;

function Chip({ children }: { children: string }) {
  return <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-ivory-200">{children}</span>;
}

/** Right-hand panel of the wizard; mirrors the choices made so far. */
export function LivePreview({ state, userName }: { state: WizardState; userName: string }) {
  const type = spaceTypeInfo(state.spaceType);
  const template = templateInfo(state.templateKey);
  const name = state.name.trim() || 'Your workspace';
  const size = SIZE_OPTIONS.find((o) => o.band === state.sizeBand);

  return (
    <div className="flex h-full flex-col text-white">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold-400">Live preview</p>

      <div className="mt-5">
        {state.step === 2 ? (
          <SpacePreview title={type.name} subtitle={type.description} icon={type.icon} size="lg" />
        ) : (
          <SpacePreview
            title={state.step >= 4 && template ? template.name : name}
            subtitle={state.step >= 4 ? name : `${type.name}${state.step >= 3 && size ? ` · ${size.people}` : ''}`}
            icon={type.icon}
            size="lg"
          />
        )}
      </div>

      <div className="mt-6 min-h-0 flex-1">
        {state.step === 1 && (
          <div className="space-y-3">
            <p className="break-words text-2xl font-bold">{name}</p>
            {state.slug && <p className="flex items-center gap-2 font-mono text-sm text-gold-300"><Link2 className="h-4 w-4 shrink-0" /> {displaySpaceLink(state.slug)}</p>}
            {state.description.trim() && <p className="text-sm leading-relaxed text-ivory-500">{state.description.trim()}</p>}
          </div>
        )}

        {state.step === 2 && (
          <div>
            <p className="text-xl font-bold">{type.name}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {type.features.map((f) => <Chip key={f}>{f}</Chip>)}
            </div>
          </div>
        )}

        {state.step === 3 && (
          <ul className="grid gap-3">
            {setupSummary(state.sizeBand, state.spaceType).map((item) => {
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

        {state.step === 4 && template && (
          <div>
            <p className="text-sm font-semibold text-ivory-200">Rooms & zones</p>
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {template.rooms.map((room) => (
                <li key={room} className="flex items-center gap-2 text-sm text-ivory-200">
                  <MapPin className="h-4 w-4 shrink-0 text-gold-400" /> {room}
                </li>
              ))}
            </ul>
          </div>
        )}

        {state.step === 5 && (
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

        {state.step >= 6 && (
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

function Initials({ label, you }: { label: string; you?: boolean }) {
  const parts = label.includes('@') ? [label.split('@')[0], ''] : label.split(' ');
  return (
    <span
      title={you ? `${label} (you)` : label}
      className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${you ? 'bg-gold-400 text-navy-900' : 'bg-white/10 text-ivory-100 ring-1 ring-white/15'}`}
    >
      {getInitials(parts[0], parts[1]) || '?'}
    </span>
  );
}
