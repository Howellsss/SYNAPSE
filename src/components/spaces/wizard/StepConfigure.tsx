import { useEffect, useState, type ReactNode } from 'react';
import { LayoutGrid, ShieldCheck, CalendarClock, Palette, CheckCircle2 } from 'lucide-react';
import { listCalendars, uploadSpaceLogo } from '@/lib/spaces';
import { generateGuestToken } from '@/spatial/access';
import { RoomsEditor } from '../config/RoomsEditor';
import { AccessEditor } from '../config/AccessEditor';
import { AvailabilityEditor } from '../config/AvailabilityEditor';
import { BrandingEditor } from '../config/BrandingEditor';
import { StepTitle } from './ui';
import { effectiveRooms, type WizardAction, type WizardState } from './state';

export function Section({ icon: Icon, title, hint, children }: { icon: typeof LayoutGrid; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-navy-50 pt-5 first:border-t-0 first:pt-0">
      <h2 className="flex items-center gap-2 text-base font-bold text-navy-800"><Icon className="h-4 w-4 text-gold-600" /> {title}</h2>
      {hint && <p className="mt-0.5 text-sm text-ivory-700">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function StepConfigure({ state, dispatch, workspaceId, userId }: {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
  workspaceId: string;
  userId: string;
}) {
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { listCalendars(workspaceId, userId).then(setCalendars); }, [workspaceId, userId]);

  // A guest-link space always needs a link to share.
  useEffect(() => {
    if (state.accessMode === 'guest_link' && !state.guestLinkToken) dispatch({ type: 'setGuestToken', token: generateGuestToken() });
  }, [state.accessMode, state.guestLinkToken, dispatch]);

  const rooms = effectiveRooms(state);

  return (
    <>
      <StepTitle title="Configure your workspace" subtitle="Shape the environment before you enter. You can change all of this later in Workspace settings." />
      <p className="-mt-3 mb-5 flex items-center gap-1.5 text-xs text-ivory-700"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Your configuration is saved as you go.</p>
      <div className="space-y-6">
        <Section icon={LayoutGrid} title="Rooms & zones" hint={`${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} · rename them, set capacity and door rules`}>
          <RoomsEditor
            rooms={rooms}
            onChange={(next) => dispatch({ type: 'setRooms', rooms: next })}
            onReset={state.rooms ? () => dispatch({ type: 'resetRooms' }) : undefined}
            resetLabel={state.typeChoice === 'import' ? 'Back to the imported rooms' : 'Back to the layout\'s rooms'}
          />
        </Section>
        <Section icon={ShieldCheck} title="Access" hint="Who can enter, and what each role can do inside.">
          <AccessEditor
            mode={state.accessMode}
            token={state.guestLinkToken}
            permissions={state.permissions}
            onMode={(mode) => dispatch({ type: 'setAccessMode', mode })}
            onNewToken={() => dispatch({ type: 'setGuestToken', token: generateGuestToken() })}
            onPermissions={(permissions) => dispatch({ type: 'setPermissions', permissions })}
          />
        </Section>
        <Section icon={CalendarClock} title="Availability">
          <AvailabilityEditor
            persistence={state.persistence}
            schedule={state.schedule}
            calendars={calendars}
            onPersistence={(persistence) => dispatch({ type: 'setPersistence', persistence })}
            onSchedule={(schedule) => dispatch({ type: 'setSchedule', schedule })}
          />
        </Section>
        <Section icon={Palette} title="Branding">
          <BrandingEditor
            branding={state.branding}
            onChange={(branding) => dispatch({ type: 'setBranding', branding })}
            upload={(file) => uploadSpaceLogo(workspaceId, file)}
          />
        </Section>
      </div>
    </>
  );
}
