import { useEffect, useRef, useState } from 'react';
import { Copy, Hand, Mic, MicOff, Send, UserMinus, Video, VideoOff, X } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { MAX_CHAT } from '@/meetings/messages';
import { cn } from '@/lib/utils';

export interface ChatLine {
  id: string;
  from: string;
  name: string;
  text: string;
  at: number;
  mine: boolean;
}

export interface PersonRow {
  id: string;
  name: string;
  local: boolean;
  host: boolean;
  muted: boolean;
  camOff: boolean;
  hand: boolean;
  avatarUrl?: string | null;
}

/** What the host can do to others (each person's own app carries it out). */
export interface HostActions {
  onMute: (id: string) => void;
  onMuteAll: () => void;
  onRemove: (id: string) => void;
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside
      aria-label={title}
      className="absolute inset-0 z-40 flex flex-col bg-white text-navy-900 sm:static sm:inset-auto sm:w-80 sm:shrink-0 sm:rounded-xl sm:border sm:border-navy-100 sm:shadow-card"
    >
      <header className="flex items-center justify-between border-b border-sand px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`} className="rounded-lg p-1.5 text-navy-600 hover:bg-navy-50 hover:text-navy-900"><X className="h-4 w-4" /></button>
      </header>
      {children}
    </aside>
  );
}

export function ParticipantsPanel({ people, onClose, onCopyLink, host }: { people: PersonRow[]; onClose: () => void; onCopyLink: () => void; host?: HostActions }) {
  // Raised hands first, then the order people joined.
  const sorted = [...people].sort((a, b) => Number(b.hand) - Number(a.hand));
  const others = people.filter((p) => !p.local);
  return (
    <Panel title={`Participants (${people.length})`} onClose={onClose}>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {sorted.map((p) => {
          const [first, ...rest] = p.name.split(' ');
          return (
            <li key={p.id} className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-navy-50">
              <Avatar firstName={first} lastName={rest.join(' ')} src={p.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm">
                {p.name}
                <span className="text-ivory-700">{[p.local && ' (you)', p.host && ' (Host)'].filter(Boolean).join('')}</span>
              </span>
              {host && !p.local && (
                <span className="flex items-center gap-1">
                  {!p.muted && <button type="button" onClick={() => host.onMute(p.id)} aria-label={`Mute ${p.name}`} className="rounded-md px-2 py-1 text-xs font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 hover:bg-white">Mute</button>}
                  <button type="button" onClick={() => host.onRemove(p.id)} aria-label={`Remove ${p.name}`} title="Remove from meeting" className="rounded-md p-1 text-burgundy-600 hover:bg-burgundy-50"><UserMinus className="h-4 w-4" /></button>
                </span>
              )}
              {p.hand && <Hand className="h-4 w-4 text-gold-600" aria-label="Hand raised" />}
              {p.muted ? <MicOff className="h-4 w-4 text-burgundy-500" aria-label="Muted" /> : <Mic className="h-4 w-4 text-navy-500" aria-label="Mic on" />}
              {p.camOff ? <VideoOff className="h-4 w-4 text-burgundy-500" aria-label="Camera off" /> : <Video className="h-4 w-4 text-navy-500" aria-label="Camera on" />}
            </li>
          );
        })}
      </ul>
      <footer className="flex gap-2 border-t border-sand p-3">
        <button type="button" onClick={onCopyLink} className="btn-secondary flex-1"><Copy className="h-4 w-4" /> Invite</button>
        {host && others.length > 0 && <button type="button" onClick={host.onMuteAll} className="btn-secondary flex-1"><MicOff className="h-4 w-4" /> Mute all</button>}
      </footer>
    </Panel>
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function ChatPanel({ lines, onSend, onClose }: { lines: ChatLine[]; onSend: (text: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };
  return (
    <Panel title="Chat" onClose={onClose}>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {lines.length === 0 && <p className="pt-8 text-center text-sm text-ivory-700">Messages are visible to everyone in the meeting and aren't saved after it ends.</p>}
        {lines.map((l) => (
          <div key={l.id} className={cn('flex flex-col', l.mine && 'items-end')}>
            <span className="text-[11px] text-ivory-700">{l.mine ? 'You' : l.name} · {time(l.at)}</span>
            <p className={cn('mt-0.5 max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm', l.mine ? 'bg-navy-800 text-white' : 'bg-navy-50 text-navy-900')}>{l.text}</p>
          </div>
        ))}
      </div>
      <form className="flex items-end gap-2 border-t border-sand p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={1}
          maxLength={MAX_CHAT}
          aria-label="Message everyone"
          placeholder="Message everyone"
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-navy-100 bg-white px-3 py-2 text-sm text-navy-900 placeholder:text-ivory-600 focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/30"
        />
        <button type="submit" aria-label="Send" disabled={!draft.trim()} className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold-400 text-navy-900 hover:bg-gold-300 disabled:opacity-40"><Send className="h-4 w-4" /></button>
      </form>
    </Panel>
  );
}
