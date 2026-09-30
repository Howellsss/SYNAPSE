import { useEffect, useState, useCallback, useRef } from 'react';
import { Mic, Search, Play, Pause, Sparkles, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { formatDate, formatDuration, timeAgo, getFullName, cn } from '@/lib/utils';
import type { Recording, Appointment, Contact, ActionItem } from '@/types';

export function RecordingsPage() {
  const { workspace } = useAuth();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Recording | null>(null);
  const [apptMap, setApptMap] = useState<Record<string, { appt: Appointment; contact: Contact | null }>>({});

  const loadRecordings = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('recordings')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    const recs = (data ?? []) as Recording[];
    setRecordings(recs);

    // Load related appointments and contacts
    const apptIds = recs.map(r => r.appointment_id).filter(Boolean) as string[];
    if (apptIds.length > 0) {
      const { data: appts } = await supabase
        .from('appointments')
        .select('*, contacts(*)')
        .in('id', apptIds);
      const map: Record<string, { appt: Appointment; contact: Contact | null }> = {};
      for (const a of (appts ?? []) as (Appointment & { contacts: Contact | null })[]) {
        map[a.id] = { appt: a, contact: a.contacts };
      }
      setApptMap(map);
    }
    setLoading(false);
  }, [workspace]);

  useEffect(() => { loadRecordings(); }, [loadRecordings]);

  const filtered = recordings.filter(r =>
    !search || r.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-navy-800">Recordings</h1>
        <p className="text-sm text-ivory-600 mt-0.5">Meeting recordings with transcripts and AI summaries</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-ivory-600" />
        <input className="input-field pl-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recordings..." />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Mic className="w-7 h-7" />}
            title="No recordings yet"
            description="Meeting recordings will appear here after appointments with recording enabled."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(rec => {
            const related = rec.appointment_id ? apptMap[rec.appointment_id] : null;
            return (
              <div key={rec.id} className="card card-hover p-5 cursor-pointer" onClick={() => setSelected(rec)}>
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-navy-800 flex items-center justify-center shrink-0">
                    <Mic className="w-6 h-6 text-gold-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-navy-800 truncate">{rec.title}</h3>
                    <p className="text-xs text-ivory-600 mt-0.5">
                      {related ? getFullName(related.contact ?? { first_name: null, last_name: null }) : 'No contact'}
                      {rec.duration_seconds > 0 && ` · ${formatDuration(rec.duration_seconds)}`}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={cn(
                        'status-pill',
                        rec.status === 'ready' ? 'bg-green-50 text-green-700' :
                        rec.status === 'processing' ? 'bg-amber-50 text-amber-700' :
                        'bg-red-50 text-red-700'
                      )}>
                        {rec.status}
                      </span>
                      {rec.ai_summary && (
                        <span className="status-pill bg-gold-50 text-gold-700">
                          <Sparkles className="w-3 h-3" />
                          AI Summary
                        </span>
                      )}
                      <span className="text-xs text-ivory-500 ml-auto">{timeAgo(rec.created_at)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <RecordingDetailDrawer recording={selected} onClose={() => setSelected(null)} related={selected.appointment_id ? apptMap[selected.appointment_id] : null} />
      )}
    </div>
  );
}

function RecordingDetailDrawer({
  recording,
  onClose,
  related,
}: {
  recording: Recording;
  onClose: () => void;
  related: { appt: Appointment; contact: Contact | null } | null;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'summary' | 'transcript' | 'actions'>('summary');
  const [actionItems, setActionItems] = useState<ActionItem[]>(recording.action_items ?? []);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const toggleActionItem = useCallback(async (index: number) => {
    const updated = actionItems.map((item, i) =>
      i === index ? { ...item, done: !item.done } : item
    );
    setActionItems(updated);
    const { error } = await supabase
      .from('recordings')
      .update({ action_items: updated })
      .eq('id', recording.id);
    if (error) {
      setActionItems(actionItems);
      toast('Failed to update action item', 'error');
    }
  }, [actionItems, recording.id, toast]);

  return (
    <Drawer open onClose={onClose} title={recording.title} width="xl">
      <div className="p-6 space-y-4">
        {/* Audio player */}
        {recording.audio_url ? (
          <div className="bg-navy-800 rounded-xl p-6">
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                className="w-14 h-14 rounded-full bg-gold-400 flex items-center justify-center shrink-0 hover:bg-gold-300 transition-colors"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6 text-navy-800" />
                ) : (
                  <Play className="w-6 h-6 text-navy-800 ml-0.5" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <audio
                  ref={audioRef}
                  src={recording.audio_url}
                  controls
                  className="w-full"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />
              </div>
            </div>
            <p className="text-sm text-ivory-400 mt-3 text-center">{formatDuration(recording.duration_seconds)}</p>
          </div>
        ) : (
          <div className="bg-navy-800 rounded-xl p-6 flex items-center justify-center">
            <p className="text-sm text-ivory-400">No audio available</p>
          </div>
        )}

        {/* Info */}
        <div className="flex items-center gap-4 text-sm text-ivory-600">
          {related && (
            <>
              <span>{getFullName(related.contact ?? { first_name: null, last_name: null })}</span>
              <span>·</span>
              <span>{formatDate(related.appt.start_time)}</span>
            </>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-navy-100">
          {(['summary', 'transcript', 'actions'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-2 text-sm font-medium capitalize transition-all border-b-2 -mb-px',
                tab === t ? 'text-gold-700 border-gold-400' : 'text-ivory-600 border-transparent hover:text-navy-700'
              )}
            >
              {t === 'actions' ? 'Action Items' : t}
            </button>
          ))}
        </div>

        {tab === 'summary' && (
          <div className="space-y-4">
            {recording.ai_summary ? (
              <div className="p-4 rounded-xl bg-gold-50/30 border border-gold-100">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-gold-700" />
                  <span className="text-sm font-semibold text-navy-700">AI Summary</span>
                </div>
                <p className="text-sm text-navy-700 leading-relaxed">{recording.ai_summary}</p>
              </div>
            ) : (
              <p className="text-sm text-ivory-500">No AI summary available yet.</p>
            )}

            {recording.key_points && recording.key_points.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-navy-700 mb-2">Key Points</h4>
                <ul className="space-y-1.5">
                  {recording.key_points.map((point, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-navy-700">
                      <CheckCircle2 className="w-4 h-4 text-gold-500 mt-0.5 shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === 'transcript' && (
          <div>
            {recording.transcript ? (
              <div className="p-4 rounded-xl bg-ivory-50 border border-navy-50 max-h-96 overflow-y-auto">
                <p className="text-sm text-navy-700 leading-relaxed whitespace-pre-wrap">{recording.transcript}</p>
              </div>
            ) : (
              <p className="text-sm text-ivory-500">No transcript available yet.</p>
            )}
          </div>
        )}

        {tab === 'actions' && (
          <div>
            {actionItems.length > 0 ? (
              <ul className="space-y-2">
                {actionItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 p-3 rounded-xl border border-navy-100">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleActionItem(i)}
                      className="rounded text-gold-500 mt-0.5"
                    />
                    <span className={cn('text-sm text-navy-700', item.done && 'line-through text-ivory-400')}>{item.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ivory-500">No action items extracted.</p>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
