import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, SearchX, Clock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from '@/lib/router';
import { getSpaceBySlug, hasEntered, markEntered } from '@/lib/spaces';
import { opensLabel, describeSchedule } from '@/spatial/schedule';
import { GetReadyScreen } from '@/components/spaces/DeviceCheck';
import { SpaceRoom } from '@/components/spaces/room/SpaceRoom';
import { ErrorState, LoadingSpinner } from '@/components/ui/States';
import type { Space } from '@/types';

/** /workspace/<slug>: checks the person may enter, shows "Get ready" on a first visit, then the room. */
export function SpacePage({ slug }: { slug: string }) {
  const { user, canManageTeam } = useAuth();
  const [, navigate] = useRouter();
  const [space, setSpace] = useState<Space | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // undefined while checking; false shows "Get ready" before the first visit.
  const [entered, setEntered] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setSpace(undefined);
    setError(null);
    setEntered(undefined);
    getSpaceBySlug(slug).then(async ({ data, error: err }) => {
      if (!active) return;
      if (err) { setError(err); return; }
      setSpace(data);
      // Only check (and later count) a visit when the person is actually let in.
      const closed = data ? opensLabel(data.schedule, data.persistence) : null;
      if (!data || !user || (closed && !canManageTeam)) { setEntered(true); return; }
      const before = await hasEntered(data.id, user.id);
      if (!active) return;
      if (before === null) {
        // Couldn't check: let them in rather than block, and record the visit as before.
        markEntered(data.id, user.id);
        setEntered(true);
        return;
      }
      setEntered(before);
    });
    return () => { active = false; };
  }, [slug, user, attempt, canManageTeam]);

  if (error) return <Padded><ErrorState message={`Couldn't open this workspace. ${error}`} onRetry={() => setAttempt((n) => n + 1)} /></Padded>;
  if (space === undefined || (space && entered === undefined)) return <div className="flex h-full items-center justify-center py-20"><LoadingSpinner className="h-8 w-8" /></div>;

  if (space === null) {
    return (
      <Padded>
        <SearchX className="mx-auto h-10 w-10 text-ivory-600" />
        <h1 className="mt-4 text-xl font-bold text-navy-800">Workspace not found</h1>
        <p className="mt-2 text-sm text-ivory-700">It may have been removed, or it belongs to a team you're not part of yet. Ask for an invite link.</p>
        <button onClick={() => navigate('/workspace')} className="btn-primary mt-6"><ArrowLeft className="h-4 w-4" /> Back to workspaces</button>
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
        <button onClick={() => navigate('/workspace')} className="btn-primary mt-6"><ArrowLeft className="h-4 w-4" /> Back to workspaces</button>
      </Padded>
    );
  }

  if (entered === false && user) {
    return (
      <GetReadyScreen
        spaceName={space.name}
        onBack={() => navigate('/workspace')}
        onEnter={async () => { await markEntered(space.id, user.id); setEntered(true); }}
      />
    );
  }

  return <SpaceRoom space={space} closedNote={opens} onSpaceChange={setSpace} />;
}

function Padded({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-md px-4 py-16 text-center">{children}</div>;
}
