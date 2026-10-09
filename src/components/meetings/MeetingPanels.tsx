import { useEffect, useRef, useState } from 'react';
import { BarChart3, Copy, Hand, Mic, MicOff, Plus, Send, UserMinus, Video, VideoOff, X } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { MAX_CHAT } from '@/meetings/messages';
import { MAX_OPTION, MAX_OPTIONS, MAX_QUESTION, percent } from '@/meetings/polls';
import type { PollState, Polls } from '@/meetings/usePolls';
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

export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

export function ParticipantsPanel({ people, onClose, onCopyLink, host, top }: { people: PersonRow[]; onClose: () => void; onCopyLink: () => void; host?: HostActions; top?: React.ReactNode }) {
  // Raised hands first, then the order people joined.
  const sorted = [...people].sort((a, b) => Number(b.hand) - Number(a.hand));
  const others = people.filter((p) => !p.local);
  return (
    <Panel title={`Participants (${people.length})`} onClose={onClose}>
      {top}
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

export function PollsPanel({ polls, isHost, onClose }: { polls: Polls; isHost: boolean; onClose: () => void }) {
  const [creating, setCreating] = useState(isHost && !polls.list.length);
  return (
    <Panel title="Polls" onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {isHost && (creating
          ? <NewPoll onLaunch={(q, o, m) => { if (polls.launch(q, o, m)) setCreating(false); }} onCancel={polls.list.length ? () => setCreating(false) : undefined} />
          : <button type="button" onClick={() => setCreating(true)} className="btn-secondary w-full"><Plus className="h-4 w-4" /> New poll</button>)}
        {!isHost && !polls.list.length && (
          <div className="pt-10 text-center">
            <BarChart3 className="mx-auto h-8 w-8 text-ivory-500" />
            <p className="mt-3 text-sm text-ivory-700">No polls yet. When the host starts a poll, it appears here.</p>
          </div>
        )}
        {polls.list.map((s) => <PollCard key={s.poll.id} s={s} isHost={isHost} onVote={(p) => polls.vote(s.poll.id, p)} onEnd={() => polls.end(s.poll.id)} />)}
      </div>
    </Panel>
  );
}

function NewPoll({ onLaunch, onCancel }: { onLaunch: (q: string, options: string[], multi: boolean) => void; onCancel?: () => void }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const ready = q.trim() && options.filter((o) => o.trim()).length >= 2;
  return (
    <form
      aria-label="New poll"
      className="space-y-2.5 rounded-xl border border-navy-100 p-3"
      onSubmit={(e) => { e.preventDefault(); if (ready) onLaunch(q, options, multi); }}
    >
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-navy-800">Question</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={MAX_QUESTION} placeholder="Ask everyone something" className="input-field h-10 w-full text-sm" />
      </label>
      <div className="space-y-1.5">
        <span className="block text-xs font-semibold text-navy-800">Answers</span>
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={o}
              onChange={(e) => setOptions((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
              maxLength={MAX_OPTION}
              aria-label={`Answer ${i + 1}`}
              placeholder={`Answer ${i + 1}`}
              className="input-field h-9 min-w-0 flex-1 text-sm"
            />
            {options.length > 2 && <button type="button" onClick={() => setOptions((all) => all.filter((_, j) => j !== i))} aria-label={`Remove answer ${i + 1}`} className="rounded-md p-1.5 text-navy-500 hover:bg-navy-50"><X className="h-4 w-4" /></button>}
          </div>
        ))}
        {options.length < MAX_OPTIONS && <button type="button" onClick={() => setOptions((all) => [...all, ''])} className="inline-flex items-center gap-1 text-xs font-semibold text-gold-700 hover:text-gold-800"><Plus className="h-3.5 w-3.5" /> Add an answer</button>}
      </div>
      <label className="flex items-center gap-2 text-sm text-navy-800">
        <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="h-4 w-4 rounded border-navy-200 accent-navy-800" />
        Allow more than one answer
      </label>
      <div className="flex gap-2 pt-1">
        {onCancel && <button type="button" onClick={onCancel} className="btn-secondary flex-1">Cancel</button>}
        <button type="submit" disabled={!ready} className="btn-primary flex-1 disabled:opacity-50">Launch poll</button>
      </div>
    </form>
  );
}

function PollCard({ s, isHost, onVote, onEnd }: { s: PollState; isHost: boolean; onVote: (picks: number[]) => void; onEnd: () => void }) {
  const [picks, setPicks] = useState<number[]>([]);
  const answering = !s.closed && !s.mine && !isHost;
  const showResults = isHost || !!s.mine || s.closed;
  return (
    <article aria-label={`Poll: ${s.poll.q}`} className="rounded-xl border border-navy-100 p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy-900">{s.poll.q}</h3>
        <span className={cn('status-pill shrink-0', s.closed ? 'bg-navy-50 text-ivory-700' : 'bg-green-50 text-green-700')}>{s.closed ? 'Ended' : 'Open'}</span>
      </div>
      <p className="mt-0.5 text-xs text-ivory-700">{s.poll.multi ? 'Choose any that apply' : 'Choose one'}</p>
      {answering ? (
        <form className="mt-2 space-y-1" onSubmit={(e) => { e.preventDefault(); if (picks.length) onVote(picks); }}>
          {s.poll.options.map((o, i) => (
            <label key={i} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-navy-50">
              <input
                type={s.poll.multi ? 'checkbox' : 'radio'}
                name={`poll-${s.poll.id}`}
                checked={picks.includes(i)}
                onChange={(e) => setPicks((p) => (s.poll.multi ? (e.target.checked ? [...p, i] : p.filter((x) => x !== i)) : [i]))}
                className="h-4 w-4 accent-navy-800"
              />
              {o}
            </label>
          ))}
          <button type="submit" disabled={!picks.length} className="btn-primary mt-1.5 w-full disabled:opacity-50">Submit</button>
        </form>
      ) : showResults ? (
        <ul className="mt-2 space-y-2" aria-label="Results">
          {s.poll.options.map((o, i) => {
            const n = s.results?.counts[i] ?? 0;
            const pct = percent(n, s.results?.voters ?? 0);
            return (
              <li key={i}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className={cn('min-w-0 truncate', s.mine?.includes(i) && 'font-semibold')}>{o}{s.mine?.includes(i) ? ' (your answer)' : ''}</span>
                  <span className="shrink-0 tabular-nums text-ivory-700">{pct}% ({n})</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-navy-50"><div className="h-full rounded-full bg-gold-400 transition-all" style={{ width: `${pct}%` }} /></div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ivory-700">
        <span>{s.results ? `${s.results.voters} answered` : s.mine ? 'Answer sent' : ''}</span>
        {isHost && !s.closed && <button type="button" onClick={onEnd} className="rounded-md px-2.5 py-1 font-semibold text-burgundy-600 ring-1 ring-inset ring-navy-100 hover:bg-burgundy-50">End poll</button>}
      </div>
    </article>
  );
}
