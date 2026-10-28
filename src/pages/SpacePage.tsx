import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, SearchX, Clock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSpaceDock } from '@/context/SpaceDockContext';
import { getSpaceBySlug, hasEntered, markEntered } from '@/lib/spaces';
import { officeFor } from '@/spatial/scene/offices';
import { fetchAsset } from '@/spatial/assetFetch';
import { opensLabel, describeSchedule } from '@/spatial/schedule';
import { GetReadyScreen } from '@/components/spaces/DeviceCheck';
import { SpaceRoom } from '@/components/spaces/room/SpaceRoom';
import { ErrorState, LoadingSpinner } from '@/components/ui/States';
import type { Space } from '@/types';

/** /workspace/<slug>: checks the person may enter, shows "Get ready" on a first visit, then the room. */
export function SpacePage({ slug }: { slug: string }) {
  const { user, canManageTeam } = useAuth();
  // Going back closes the space (it isn't kept open on the side).
  const { leave } = useSpaceDock();
  const [space, setSpace] = useState<Space | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // undefined while checking; false shows "Get ready" before the first visit.
  const [entered, setEntered] = useState<boolean | undefined>(undefined);

  // Keyed on who you are, not the session object: it changes every time the login is refreshed
  // (about hourly), and reloading the space then would drop you out of the call.
  const userId = user?.id ?? null;
  useEffect(() => {
    let active = true;
    setSpace(undefined);
    setError(null);
    setEntered(undefined);
    getSpaceBySlug(slug).then(async ({ data, error: err }) => {
      if (!active) return;
      if (err) { setError(err); return; }
      setSpace(data);
      // Start the office's 3D file now, while the 3D code is still on its way.
      const officeUrl = data ? officeFor(data.config?.scene)?.url : null;
      if (officeUrl) void fetchAsset(officeUrl, -1).catch(() => undefined);
      // Only check (and later count) a visit when the person is actually let in.
      const closed = data ? opensLabel(data.schedule, data.persistence) : null;
      if (!data || !userId || (closed && !canManageTeam)) { setEntered(true); return; }
      const before = await hasEntered(data.id, userId);
      if (!active) return;
      if (before === null) {
        // Couldn't check: let them in rather than block, and record the visit as before.
        markEntered(data.id, userId);
        setEntered(true);
        return;
      }
      setEntered(before);
    });
    return () => { active = false; };
  }, [slug, userId, attempt, canManageTeam]);

  if (error) return <Padded><ErrorState message={`Couldn't open this workspace. ${error}`} onRetry={() => setAttempt((n) => n + 1)} /></Padded>;
  if (space === undefined || (space && entered === undefined)) return <div className="flex h-full items-center justify-center py-20"><LoadingSpinner className="h-8 w-8" /></div>;

  if (space === null) {
    return (
      <Padded>
        <SearchX className="mx-auto h-10 w-10 text-ivory-600" />
        <h1 className="mt-4 text-xl font-bold text-navy-800">Workspace not found</h1>
        <p className="mt-2 text-sm text-ivory-700">It may have been removed, or it belongs to a team you're not part of yet. Ask for an invite link.</p>
        <button onClick={() => leave()} className="btn-primary mt-6"><ArrowLeft className="h-4 w-4" /> Back to workspaces</button>
      </Padded>
    );
  }

  const opens = opensLabel(space.schedule, space.persistence);
  if (opens && !canManageTeam) {
    return (
      <Padded>
        <Clock className="mx-auto h-10 w-10 text-gold-600" />
        <h1 className="mt-4 text-xl font-bold text-navy-800">{space.name} is closed right now</h1>
        <p className="mt-2 text-sm text-ivory-700">{opens}. {space.schedule ? describeSchedule(space.schedule) : ''}</p>
        <button onClick={() => leave()} className="btn-primary mt-6"><ArrowLeft className="h-4 w-4" /> Back to workspaces</button>
      </Padded>
    );
  }

  if (entered === false && user) {
    return (
      <GetReadyScreen
        spaceName={space.name}
        onBack={() => leave()}
        onEnter={async () => { await markEntered(space.id, user.id); setEntered(true); }}
      />
    );
  }

  return <SpaceRoom space={space} closedNote={opens} onSpaceChange={setSpace} />;
}

function Padded({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-md px-4 py-16 text-center">{children}</div>;
}
