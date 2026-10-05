import { useEffect, useState } from 'react';
import { ShieldCheck, Clock, LinkIcon } from 'lucide-react';
import { joinSpaceAsGuest, type GuestSpaceInfo } from '@/lib/spaces';
import { spaceTypeInfo } from '@/spatial/data/spaceTypes';
import { templateInfo } from '@/spatial/data/templates';
import { opensLabel, describeSchedule } from '@/spatial/schedule';
import { HowellsLogo } from '@/components/layout/Sidebar';
import { SpacePreview } from '@/components/spaces/SpacePreview';
import { ErrorState, LoadingSpinner } from '@/components/ui/States';

/** Public page for "Anyone with a guest link". Guests only ever see this one space. */
export function GuestJoinPage({ token }: { token: string }) {
  const [info, setInfo] = useState<GuestSpaceInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setInfo(undefined);
    setError(null);
    joinSpaceAsGuest(token).then(({ data, error: err }) => {
      if (!active) return;
      if (err) setError(err); else setInfo(data);
    });
    return () => { active = false; };
  }, [token, attempt]);

  return (
    <div className="min-h-screen bg-ivory-200/30">
      <header className="flex items-center gap-2 px-4 py-5 sm:px-8">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-800 text-white"><HowellsLogo className="h-5 w-5" /></span>
        <span className="text-lg font-bold tracking-wide text-navy-800">SYNAPSE</span>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-12 sm:px-8">
        {error ? (
          <ErrorState message={`Couldn't open this link. ${error}`} onRetry={() => setAttempt((n) => n + 1)} />
        ) : info === undefined ? (
          <div className="flex justify-center py-20"><LoadingSpinner className="h-8 w-8" /></div>
        ) : info === null ? (
          <div className="card mx-auto max-w-md p-8 text-center">
            <LinkIcon className="mx-auto h-10 w-10 text-ivory-600" />
            <h1 className="mt-4 text-xl font-bold text-navy-800">This guest link doesn't work</h1>
            <p className="mt-2 text-sm text-ivory-700">It may have been replaced or switched off. Ask the person who shared it for a new link.</p>
          </div>
        ) : (
          <GuestCard info={info} />
        )}
      </main>
    </div>
  );
}

function GuestCard({ info }: { info: GuestSpaceInfo }) {
  const type = spaceTypeInfo(info.space_type);
  const template = templateInfo(info.template_key);
  const opens = opensLabel(info.schedule, info.persistence);
  return (
    <section className="overflow-hidden rounded-3xl bg-navy-800 p-6 text-white sm:p-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">You're invited as a guest</p>
      <div className="mt-3 flex items-center gap-3">
        {info.branding?.logo_url && <img src={info.branding.logo_url} alt="" className="h-12 w-12 rounded-xl bg-white/10 object-contain p-1" />}
        <h1 className="min-w-0 break-words text-3xl font-bold">{info.name}</h1>
      </div>
      <p className="mt-2 text-sm text-ivory-500">{type.name}{template ? ` · ${template.name}` : ''}</p>
      {info.description && <p className="mt-3 text-sm leading-relaxed text-ivory-200">{info.description}</p>}
      <SpacePreview
        title={template?.name ?? type.name}
        subtitle="The walkable space opens here soon"
        icon={type.icon}
        size="lg"
        className="mt-6 !aspect-[16/9]"
        wallScreen={info.branding?.logo_url ? { logoUrl: info.branding.logo_url, accent: info.branding.accent } : undefined}
      />
      <p className="mt-5 flex items-center gap-2 text-sm text-ivory-200"><ShieldCheck className="h-4 w-4 text-green-400" /> Guests can only enter this workspace.</p>
      {opens && info.schedule && (
        <p className="mt-2 flex items-center gap-2 text-sm text-gold-300"><Clock className="h-4 w-4" /> {opens} · {describeSchedule(info.schedule)}</p>
      )}
    </section>
  );
}
