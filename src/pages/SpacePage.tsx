import { useEffect, useState } from 'react';
import { ArrowLeft, Copy, SearchX, Clock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { getSpaceBySlug, markEntered } from '@/lib/spaces';
import { spaceTypeInfo } from '@/spatial/data/spaceTypes';
import { templateInfo } from '@/spatial/data/templates';
import { displaySpaceLink, spaceUrl } from '@/spatial/links';
import { opensLabel, describeSchedule } from '@/spatial/schedule';
import { SpacePreview } from '@/components/spaces/SpacePreview';
import { ErrorState, LoadingSpinner } from '@/components/ui/States';
import type { Space } from '@/types';

/** Stand-in for the walkable office until it is built. */
export function SpacePage({ slug }: { slug: string }) {
  const { user, canManageTeam } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [space, setSpace] = useState<Space | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setSpace(undefined);
    setError(null);
    getSpaceBySlug(slug).then(({ data, error: err }) => {
      if (!active) return;
      if (err) { setError(err); return; }
      setSpace(data);
      // Only count a visit when the person is actually let in.
      const closed = data ? opensLabel(data.schedule, data.persistence) : null;
      if (data && user && (!closed || canManageTeam)) markEntered(data.id, user.id);
    });
    return () => { active = false; };
  }, [slug, user, attempt, canManageTeam]);

  if (error) return <ErrorState message={`Couldn't open this workspace. ${error}`} onRetry={() => setAttempt((n) => n + 1)} />;
  if (space === undefined) return <div className="flex justify-center py-20"><LoadingSpinner className="h-8 w-8" /></div>;

  if (space === null) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <SearchX className="mx-auto h-10 w-10 text-ivory-600" />
        <h1 className="mt-4 text-xl font-bold text-navy-800">Workspace not found</h1>
        <p className="mt-2 text-sm text-ivory-700">It may have been removed, or it belongs to a team you're not part of yet. Ask for an invite link.</p>
        <button onClick={() => navigate('/workspace')} className="btn-primary mt-6"><ArrowLeft className="h-4 w-4" /> Back to workspaces</button>
      </div>
    );
  }

  const opens = opensLabel(space.schedule, space.persistence);
  if (opens && !canManageTeam) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <Clock className="mx-auto h-10 w-10 text-gold-600" />
        <h1 className="mt-4 text-xl font-bold text-navy-800">{space.name} is closed right now</h1>
        <p className="mt-2 text-sm text-ivory-700">{opens}. {space.schedule ? describeSchedule(space.schedule) : ''}</p>
        <button onClick={() => navigate('/workspace')} className="btn-primary mt-6"><ArrowLeft className="h-4 w-4" /> Back to workspaces</button>
      </div>
    );
  }

  const type = spaceTypeInfo(space.space_type);
  const template = templateInfo(space.template_key);
  const copy = async () => {
    try { await navigator.clipboard.writeText(spaceUrl(space.slug)); toast('Link copied'); }
    catch { toast('Could not copy the link', 'error'); }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <button onClick={() => navigate('/workspace')} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ivory-700 hover:text-navy-800">
        <ArrowLeft className="h-4 w-4" /> All workspaces
      </button>
      <section className="overflow-hidden rounded-3xl bg-navy-800 p-6 text-white sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">You're in</p>
        <h1 className="mt-2 break-words text-3xl font-bold sm:text-4xl">{space.name}</h1>
        <p className="mt-2 text-sm text-ivory-500">{type.name}{template ? ` · ${template.name}` : ''}</p>
        {opens && <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gold-400/15 px-3 py-1 text-xs font-semibold text-gold-300"><Clock className="h-3.5 w-3.5" /> Closed to members · {opens} · you can enter as an admin</p>}
        <SpacePreview title={template?.name ?? type.name} subtitle="The walkable office opens here soon" icon={type.icon} size="lg" className="mt-6 !aspect-[16/9]" />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="rounded-xl bg-white/10 px-3 py-2 font-mono text-sm text-ivory-200">{displaySpaceLink(space.slug)}</span>
          <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 px-3 py-2 text-sm font-semibold hover:bg-white/10"><Copy className="h-4 w-4" /> Copy link</button>
        </div>
      </section>
    </div>
  );
}
