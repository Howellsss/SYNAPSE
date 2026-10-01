import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Plus, Link2, ArrowRight, MicOff, VideoOff, Mic, Video, UserRound, Camera, DoorOpen, Users, Footprints,
  Building2, PencilLine, Clock, Lock, MoreVertical, Settings2, Download,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { supabase } from '@/lib/supabase';
import { listSpaces, type SpaceWithMembers } from '@/lib/spaces';
import { spaceTypeInfo } from '@/spatial/data/spaceTypes';
import { templateInfo } from '@/spatial/data/templates';
import { buildRooms } from '@/spatial/data/rooms';
import { readDraft, hasMeaningfulDraft, clearDraft, type WizardState } from '@/components/spaces/wizard/state';
import { SpacePreview } from '@/components/spaces/SpacePreview';
import { parseJoinLink } from '@/spatial/links';
import { opensLabel } from '@/spatial/schedule';
import { exportLayout, layoutFileName } from '@/spatial/layoutFile';
import { SpaceSettingsDrawer } from '@/components/spaces/SpaceSettingsDrawer';
import { DeviceCheckModal } from '@/components/spaces/DeviceCheck';
import { normalizeMediaPrefs } from '@/spatial/media/devices';
import { usePresenceCounts } from '@/spatial/net/usePresenceCounts';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { cn } from '@/lib/utils';
import type { Profile } from '@/types';

type MemberProfile = Pick<Profile, 'user_id' | 'first_name' | 'last_name' | 'avatar_url'>;

export function WorkspacesPage() {
  const { workspace, profile, canManageTeam } = useAuth();
  const [, navigate] = useRouter();
  const { toast } = useToast();
  const [spaces, setSpaces] = useState<SpaceWithMembers[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Record<string, MemberProfile>>({});
  const [draft, setDraft] = useState<WizardState | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [settingsFor, setSettingsFor] = useState<SpaceWithMembers | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const online = usePresenceCounts(spaces?.map((s) => s.id) ?? []);

  const load = useCallback(async () => {
    if (!workspace) return;
    setError(null);
    const { data, error: err } = await listSpaces(workspace.id);
    if (err) { setError(err); setSpaces([]); return; }
    setSpaces(data);
    const ids = [...new Set(data.flatMap((s) => s.memberIds))];
    if (ids.length) {
      // Only profiles this user may read come back; others show as a count.
      const { data: profs } = await supabase.from('profiles').select('user_id, first_name, last_name, avatar_url').in('user_id', ids);
      setPeople(Object.fromEntries(((profs ?? []) as MemberProfile[]).map((p) => [p.user_id, p])));
    }
  }, [workspace]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!workspace) return;
    const d = readDraft(workspace.id);
    setDraft(hasMeaningfulDraft(d) ? d : null);
  }, [workspace]);

  if (!workspace) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <Building2 className="mx-auto h-10 w-10 text-ivory-600" />
        <h1 className="mt-4 text-xl font-bold text-navy-800">No account workspace yet</h1>
        <p className="mt-2 text-sm text-ivory-700">Your SYNAPSE account is still being set up. Refresh the page in a moment.</p>
      </div>
    );
  }

  const createNew = () => navigate('/workspace/new');
  const media = normalizeMediaPrefs(profile?.media_prefs);
  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'you';
  const comingNext = (what: string) => toast(`${what} is coming next.`, 'info');

  return (
    <div className="mx-auto max-w-6xl pb-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-navy-800 sm:text-[28px]">Workspaces</h1>
          <p className="mt-1 text-sm text-ivory-700">Virtual offices where your team can walk over and talk.</p>
        </div>
        {spaces && spaces.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setJoinOpen(true)} className="btn-secondary"><Link2 className="h-4 w-4" /> Join with link</button>
            {canManageTeam && <button onClick={createNew} className="btn-primary"><Plus className="h-4 w-4" /> Create workspace</button>}
          </div>
        )}
      </div>

      {draft && canManageTeam && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-gold-200 bg-gold-50 px-4 py-3">
          <PencilLine className="h-5 w-5 shrink-0 text-gold-700" />
          <p className="min-w-0 flex-1 text-sm text-navy-800">
            You have an unfinished workspace{draft.name.trim() ? <> — <strong>{draft.name.trim()}</strong></> : ''}.
          </p>
          <button onClick={() => { clearDraft(workspace.id); setDraft(null); }} className="text-sm font-medium text-ivory-700 hover:text-navy-800">Discard</button>
          <button onClick={createNew} className="btn-primary !py-2">Continue setup</button>
        </div>
      )}

      {spaces === null ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
        </div>
      ) : error ? (
        <ErrorState message={`Couldn't load workspaces. ${error}`} onRetry={() => { setSpaces(null); load(); }} />
      ) : spaces.length === 0 ? (
        <FirstVisit canCreate={canManageTeam} onCreate={createNew} onJoin={() => setJoinOpen(true)} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {spaces.map((space) => (
            <SpaceCard
              key={space.id}
              space={space}
              online={online[space.id] ?? 0}
              people={people}
              canManage={canManageTeam}
              onEnter={() => navigate(`/workspace/${space.slug}`)}
              onSettings={() => setSettingsFor(space)}
              onExport={() => downloadLayout(space)}
            />
          ))}
          {canManageTeam && (
            <button
              onClick={createNew}
              className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-navy-100 p-6 text-center transition hover:border-gold-400 hover:bg-gold-50/40"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-50 text-gold-600"><Plus className="h-6 w-6" /></span>
              <span className="font-semibold text-navy-800">Create another workspace</span>
              <span className="text-sm text-ivory-700">A classroom, event hall, studio or hub</span>
            </button>
          )}
        </div>
      )}

      {spaces && spaces.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-navy-100 bg-white px-4 py-3 shadow-card">
          <Avatar firstName={profile?.first_name} lastName={profile?.last_name} src={profile?.avatar_url} size="sm" />
          <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-navy-700">
            <span>Joining as <strong className="text-navy-800">{displayName}</strong></span>
            <span className="text-ivory-500">·</span>
            <span className="inline-flex items-center gap-1">{media.join_muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}{media.join_muted ? 'Mic muted' : 'Mic on'}</span>
            <span className="text-ivory-500">·</span>
            <span className="inline-flex items-center gap-1">{media.join_camera_off ? <VideoOff className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}{media.join_camera_off ? 'Camera off' : 'Camera on'}</span>
            {media.data_saver && <><span className="text-ivory-500">·</span><span>Data saver</span></>}
          </p>
          <div className="flex gap-4 text-sm font-semibold">
            <button onClick={() => comingNext('The avatar builder')} className="inline-flex items-center gap-1.5 text-gold-700 hover:text-gold-600"><UserRound className="h-4 w-4" /> Edit avatar</button>
            <button onClick={() => setDevicesOpen(true)} className="inline-flex items-center gap-1.5 text-gold-700 hover:text-gold-600"><Camera className="h-4 w-4" /> Check camera & mic</button>
          </div>
        </div>
      )}

      {settingsFor && (
        <SpaceSettingsDrawer
          space={settingsFor}
          onClose={() => setSettingsFor(null)}
          onSaved={(updated) => {
            setSpaces((list) => list?.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)) ?? list);
            setSettingsFor(null);
          }}
        />
      )}

      <DeviceCheckModal open={devicesOpen} onClose={() => setDevicesOpen(false)} />
      <JoinModal open={joinOpen} onClose={() => setJoinOpen(false)} onSlug={(slug) => navigate(`/workspace/${slug}`)} />
    </div>
  );
}

function FirstVisit({ canCreate, onCreate, onJoin }: { canCreate: boolean; onCreate: () => void; onJoin: () => void }) {
  const steps = [
    { icon: DoorOpen, title: 'Create your space', text: 'Pick an office, classroom, event hall, studio or hub.' },
    { icon: Users, title: 'Invite your team', text: 'Teammates join with their SYNAPSE login. No new account.' },
    { icon: Footprints, title: 'Walk over to talk', text: 'Move your avatar next to someone to start a conversation.' },
  ];
  return (
    <>
      <section className="overflow-hidden rounded-3xl bg-navy-800 text-white shadow-card">
        <div className="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[1.05fr_1fr]">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-400/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gold-300">New</span>
            <h2 className="mt-4 text-2xl font-bold leading-tight sm:text-4xl">Your team's office, <span className="text-gold-400">online</span></h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-ivory-500 sm:text-base">
              See who's around, walk over for a quick chat, and meet in rooms. It feels like being together, wherever you are.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              {canCreate && (
                <button onClick={onCreate} className="btn-primary !px-5 !py-3 !text-base">
                  <Plus className="h-5 w-5" /> Create a workspace
                </button>
              )}
              <button onClick={onJoin} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10">
                <Link2 className="h-5 w-5" /> Join with invite link
              </button>
            </div>
            {!canCreate && <p className="mt-4 text-sm text-ivory-500">Ask a workspace owner or admin to create one, or join with a link.</p>}
          </div>
          <SpacePreview title="Open plan studio" subtitle="Office · desks, rooms and a lounge" icon={Building2} size="lg" className="shadow-2xl shadow-black/30" />
        </div>
      </section>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="card flex gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold-50 text-sm font-bold text-gold-700">{i + 1}</span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-semibold text-navy-800"><s.icon className="h-4 w-4 text-gold-600" /> {s.title}</p>
              <p className="mt-1 text-sm text-ivory-700">{s.text}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function SpaceCard({ space, online, people, canManage, onEnter, onSettings, onExport }: {
  space: SpaceWithMembers;
  online: number;
  people: Record<string, MemberProfile>;
  canManage: boolean;
  onEnter: () => void;
  onSettings: () => void;
  onExport: () => void;
}) {
  const type = spaceTypeInfo(space.space_type);
  const template = templateInfo(space.template_key);
  const known = space.memberIds.map((id) => people[id]).filter(Boolean);
  const shown = known.slice(0, 4);
  const extra = space.memberIds.length - shown.length;
  const opens = opensLabel(space.schedule, space.persistence);
  // Outside opening hours only admins can go in.
  const blocked = !!opens && !canManage;
  return (
    <div className="card card-hover flex flex-col overflow-hidden">
      <div className="relative p-3 pb-0">
        <button onClick={onEnter} disabled={blocked} className="block w-full text-left disabled:cursor-not-allowed" aria-label={`Enter ${space.name}`}>
          <SpacePreview title={template?.name ?? type.name} subtitle={type.name} icon={type.icon} size="sm" />
        </button>
        {canManage && <CardMenu name={space.name} onSettings={onSettings} onExport={onExport} />}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-navy-800">{space.name}</h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ivory-700"><type.icon className="h-3.5 w-3.5" /> {type.name}</p>
          </div>
          {opens ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gold-50 px-2 py-0.5 text-xs font-semibold text-gold-800">
              <Clock className="h-3 w-3" /> {opens}
            </span>
          ) : (
            <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', online ? 'bg-green-50 text-green-800' : 'bg-ivory-200/60 text-ivory-800')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', online ? 'bg-green-500' : 'bg-ivory-600')} /> {online} online
            </span>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center">
            {shown.map((p, i) => (
              <Avatar key={p.user_id} firstName={p.first_name} lastName={p.last_name} src={p.avatar_url} size="sm" className={cn('ring-2 ring-white', i > 0 && '-ml-2')} />
            ))}
            {extra > 0 && (
              <span className={cn('flex h-7 min-w-7 items-center justify-center rounded-full bg-navy-50 px-1.5 text-[11px] font-semibold text-navy-700 ring-2 ring-white', shown.length > 0 && '-ml-2')}>
                +{extra}
              </span>
            )}
            <span className="ml-2 truncate text-xs text-ivory-700">{space.memberIds.length} {space.memberIds.length === 1 ? 'member' : 'members'}</span>
          </div>
          <button onClick={onEnter} disabled={blocked} className="btn-primary shrink-0 !px-3.5 !py-2" title={blocked ? opens ?? undefined : undefined}>
            {blocked ? <><Lock className="h-4 w-4" /> Closed</> : <>Enter <ArrowRight className="h-4 w-4" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}

function CardMenu({ name, onSettings, onExport }: { name: string; onSettings: () => void; onExport: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const item = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-navy-800 hover:bg-ivory-50';
  return (
    <div ref={ref} className="absolute right-5 top-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More options for ${name}`}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-950/60 text-white backdrop-blur hover:bg-navy-950/80"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border border-navy-100 bg-white p-1 shadow-popover">
          <button role="menuitem" className={item} onClick={() => { setOpen(false); onSettings(); }}><Settings2 className="h-4 w-4 text-gold-600" /> Workspace settings</button>
          <button role="menuitem" className={item} onClick={() => { setOpen(false); onExport(); }}><Download className="h-4 w-4 text-gold-600" /> Export layout</button>
        </div>
      )}
    </div>
  );
}

/** Saves the space's layout as a .synapse-space.json file others can import. */
function downloadLayout(space: SpaceWithMembers) {
  // Spaces created before rooms were configurable export their template's rooms.
  const rooms = space.config?.rooms?.length ? space.config.rooms : buildRooms(space.template_key, space.size_band);
  const blob = new Blob([JSON.stringify(exportLayout({ ...space, config: { ...space.config, rooms } }), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = layoutFileName(space.slug);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function JoinModal({ open, onClose, onSlug }: { open: boolean; onClose: () => void; onSlug: (slug: string) => void }) {
  const [link, setLink] = useState('');
  const [bad, setBad] = useState(false);
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const parsed = parseJoinLink(link);
    if (!parsed) { setBad(true); return; }
    if ('token' in parsed) window.location.href = `/invite/${parsed.token}`;
    else { onClose(); onSlug(parsed.slug); }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Join with invite link"
      description="Paste the link someone shared with you."
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={() => submit()} disabled={!link.trim()} className="btn-primary">Join</button>
      </>}
    >
      <form onSubmit={submit}>
        <input
          autoFocus
          className={cn('input-field', bad && 'border-burgundy-500')}
          value={link}
          onChange={(e) => { setLink(e.target.value); setBad(false); }}
          placeholder="https://…/invite/… or synapse.app/your-team"
          aria-invalid={bad}
          aria-label="Invite link"
        />
        {bad && <p className="mt-2 text-sm text-burgundy-600">That doesn't look like a SYNAPSE invite or workspace link.</p>}
      </form>
    </Modal>
  );
}
