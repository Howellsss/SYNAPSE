import { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, Radio, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';
import { createStream, deleteStream, listStreams, watchUrl, type Stream } from '@/lib/streams';

const when = (s: Stream) => {
  if (s.status === 'live' && s.started_at) return `Live since ${new Date(s.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (s.status === 'ended' && s.ended_at) return `Ended ${new Date(s.ended_at).toLocaleString()}${s.peak_viewers ? ` · ${s.peak_viewers} watching at most` : ''}`;
  if (s.scheduled_at) return `Starts ${new Date(s.scheduled_at).toLocaleString()}`;
  return 'Not started';
};

/** Streams: go live to an audience (camera, mic, screen) with a watch link anyone can open. */
export function StreamsPage() {
  const { workspace, user, canManageTeam } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useRouter();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Stream | null>(null);

  const load = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    const r = await listStreams(workspace.id);
    setStreams(r.data);
    setError(r.error);
    setLoading(false);
  }, [workspace]);
  useEffect(() => { load(); }, [load]);

  const copy = async (s: Stream) => { await navigator.clipboard.writeText(watchUrl(s)); toast('Watch link copied'); };
  const groups: [string, Stream[]][] = [
    ['Live now', streams.filter((s) => s.status === 'live')],
    ['Upcoming', streams.filter((s) => s.status === 'scheduled')],
    ['Past', streams.filter((s) => s.status === 'ended')],
  ];

  return (
    <div className="page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-navy-800">Streams</h1>
          <p className="mt-1 max-w-2xl text-sm text-ivory-700">Go live to any number of people with your camera, microphone or screen. Viewers open the watch link (no account needed), chat and react.</p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="btn-primary"><Plus className="h-4 w-4" /> New stream</button>
      </div>

      <div className="mt-6 page-fill">
        {loading ? <div className="card flex flex-1 items-center justify-center p-6"><LoadingSpinner className="h-8 w-8 text-ivory-600" /></div>
          : error ? <ErrorState message={error} onRetry={load} />
            : streams.length === 0 ? (
              <div className="card flex flex-1 flex-col justify-center"><EmptyState icon={<Radio className="h-6 w-6" />} title="No streams yet" description="Create a stream, get it ready in the studio, then go live and share the watch link." /></div>
            ) : <div className="card flex-1 space-y-6 p-5">{groups.filter(([, list]) => list.length).map(([label, list]) => (
              <section key={label}>
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-ivory-700">{label}</h2>
                <ul className="mt-2 divide-y divide-ivory-200 rounded-xl border border-ivory-200 bg-white">
                  {list.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', s.status === 'live' ? 'bg-[#C42B1C] text-white' : 'bg-navy-50 text-navy-700')}><Radio className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-navy-800">{s.title}</span>
                        <span className="block truncate text-xs text-ivory-700">{when(s)} · {s.code}</span>
                      </span>
                      {s.status !== 'ended' && <button type="button" onClick={() => copy(s)} className="btn-ghost !px-2.5 !py-1.5"><Copy className="h-4 w-4" /> Watch link</button>}
                      {s.status !== 'ended' && (s.host_id === user?.id
                        ? <button type="button" onClick={() => navigate(`/streams/${s.code}`)} className="btn-primary !py-1.5">{s.status === 'live' ? 'Back to studio' : 'Open studio'}</button>
                        : s.status === 'live' && <button type="button" onClick={() => navigate(`/live/${s.code}`)} className="btn-primary !py-1.5">Watch</button>)}
                      {(s.host_id === user?.id || canManageTeam) && s.status !== 'live' && (
                        <button type="button" onClick={() => setDeleting(s)} aria-label={`Delete ${s.title}`} className="rounded-lg p-2 text-burgundy-600 hover:bg-burgundy-50"><Trash2 className="h-4 w-4" /></button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}</div>}
      </div>

      {creating && workspace && user && (
        <NewStreamModal
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            const { data, error: err } = await createStream({ workspaceId: workspace.id, hostId: user.id, ...input });
            if (err || !data) { toast(err ?? 'Could not create the stream.', 'error'); return; }
            navigate(`/streams/${data.code}`);
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { if (!deleting) return; const { error: err } = await deleteStream(deleting.id); if (err) toast(err, 'error'); setDeleting(null); load(); }}
        title={`Delete ${deleting?.title ?? 'stream'}?`}
        message="Its watch link stops working."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function NewStreamModal({ onClose, onCreate }: { onClose: () => void; onCreate: (i: { title: string; description: string; scheduledAt: Date | null }) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New stream" description="You get a studio to set up your camera, microphone and screen before going live."
      footer={<><button type="button" onClick={onClose} className="btn-ghost">Cancel</button><button type="button" disabled={!title.trim() || busy} onClick={async () => { setBusy(true); await onCreate({ title, description, scheduledAt: when ? new Date(when) : null }); setBusy(false); }} className="btn-primary">{busy ? 'Creating…' : 'Create and open studio'}</button></>}>
      <div className="grid gap-4">
        <label className="grid gap-1.5 text-sm font-medium text-navy-800">Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. HL Pro Tools product launch" className="input-field" autoFocus />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-navy-800">Description <span className="text-xs font-normal text-ivory-700">(optional, shown to viewers)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} className="input-field" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-navy-800">Planned start <span className="text-xs font-normal text-ivory-700">(optional, shown on the watch page)</span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="input-field" />
        </label>
      </div>
    </Modal>
  );
}
