import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowLeft, AtSign, Bell, Bold, Check, ChevronDown, Code, Copy, Hash, Home, Italic, Link2, List, ListOrdered, Lock, Mail, MessageSquare,
  MoreHorizontal, MessagesSquare, PenSquare, Pencil, Plug, Plus, Quote, Search, SendHorizontal, Smile, SquareCode, Star, Strikethrough,
  Trash2, Type, UserPlus, Users, X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useRouter } from '@/lib/router';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, LoadingSpinner } from '@/components/ui/States';
import { cn } from '@/lib/utils';
import { loadDepartments, loadDirectory, memberName, type Department, type DirectoryMember } from '@/lib/team';
import {
  addMembers, createChannel, createWebhook, deleteMessage, dmPeople, editMessage, formatRuns, joinChannel, leaveChannel, linksIn, listChannels,
  listEmailReplies, listMessages, listRecent, listThread, listWebhooks, markRead, mentions, myMessagesAmong, openDm, revokeWebhook, sendMessage,
  startsGroup, subscribeMessages, unreadCounts, webhookUrl, type Channel, type ChatMessage, type EmailReply, type Webhook,
} from '@/lib/chat';

type Selection = { kind: 'channel'; id: string } | { kind: 'email' } | null;
/** The rail on the far left, as in Slack: your channels, direct messages, activity, email. */
type View = 'home' | 'dms' | 'activity';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return `${d.toLocaleDateString(undefined, { weekday: 'long' })}, ${d.toLocaleDateString(undefined, { month: 'long' })} ${ordinal(d.getDate())}`;
};
/** "18 mins", "8:54 PM", "Yesterday", "Monday": how long ago, for lists. */
const ago = (iso: string) => {
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60 * 60_000) return `${Math.max(1, Math.round(ms / 60_000))} min${ms >= 90_000 ? 's' : ''}`;
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return time(iso);
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (ms < 6 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const STARRED_KEY = 'synapse.starredChannels';
const loadStarred = (): string[] => { try { return JSON.parse(localStorage.getItem(STARRED_KEY) ?? '[]') as string[]; } catch { return []; } };

/**
 * Conversations, laid out like Slack: a rail (Home, DMs, Activity, Email), the conversation list,
 * and the open channel or direct message filling the rest, with threads alongside. Channels and
 * direct messages for the team, posts from Zapier, Airtable or Modal, and replies to emails sent
 * from SYNAPSE.
 */
export function ConversationsPage() {
  const { workspace, user, profile, canManageTeam } = useAuth();
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [people, setPeople] = useState<DirectoryMember[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<ChatMessage[]>([]);
  const [mineIds, setMineIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [view, setView] = useState<View>('home');
  const [find, setFind] = useState('');
  const [modal, setModal] = useState<'channel' | 'dm' | 'browse' | null>(null);
  const [starred, setStarred] = useState<string[]>(loadStarred);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const me = user?.id ?? '';
  const myName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');

  const load = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    const [c, p, d, u, r] = await Promise.all([listChannels(workspace.id), loadDirectory(workspace.id), loadDepartments(workspace.id), unreadCounts(workspace.id), listRecent(workspace.id)]);
    setError(c.error);
    setChannels(c.data);
    setPeople(p.data);
    setDepartments(d.data);
    setUnread(u);
    setRecent(r);
    setMineIds(await myMessagesAmong([...new Set(r.filter((m) => m.parent_id).map((m) => m.parent_id!))], me));
    setLoading(false);
  }, [workspace, me]);
  useEffect(() => { load(); }, [load]);

  const mine = channels.filter((c) => c.members.some((m) => m.user_id === me));
  const named = mine.filter((c) => c.kind === 'channel');
  const dms = mine.filter((c) => c.kind === 'dm').sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at));
  const byId = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  const byChannel = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const current = sel?.kind === 'channel' ? byChannel.get(sel.id) ?? null : null;
  const latest = useMemo(() => {
    const out = new Map<string, ChatMessage>();
    for (const m of recent) if (!m.parent_id && !out.has(m.channel_id)) out.set(m.channel_id, m);
    return out;
  }, [recent]);
  // Activity: mentions of you, and replies in threads you started (not your own messages).
  const activity = useMemo(() => recent.filter((m) => m.user_id !== me && (mentions(m.body, myName) || (m.parent_id && mineIds.has(m.parent_id)))), [recent, me, myName, mineIds]);

  // First visit: open the first channel.
  useEffect(() => { if (!sel && !loading && named[0]) setSel({ kind: 'channel', id: named[0].id }); }, [sel, loading, named]);

  // New messages elsewhere raise the unread count, and show in the lists.
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    if (!workspace) return;
    return subscribeMessages(workspace.id, (m, kind) => {
      if (kind !== 'INSERT') return;
      setRecent((r) => (r.some((x) => x.id === m.id) ? r : [m, ...r].slice(0, 400)));
      if (m.user_id === me) return;
      const s = selRef.current;
      setChannels((cs) => cs.map((c) => (c.id === m.channel_id ? { ...c, last_message_at: m.created_at } : c)));
      if (s?.kind === 'channel' && s.id === m.channel_id) return;
      setUnread((u) => ({ ...u, [m.channel_id]: (u[m.channel_id] ?? 0) + 1 }));
    });
  }, [workspace, me]);

  const open = (id: string, thread: string | null = null) => { setSel({ kind: 'channel', id }); setOpenThread(thread); setUnread((u) => ({ ...u, [id]: 0 })); };
  const title = (c: Channel) => (c.kind === 'dm' ? dmPeople(c, me).map((id) => (byId.get(id) ? memberName(byId.get(id)!) : 'Someone')).join(', ') || 'Just you' : c.name ?? '');
  const toggleStar = (id: string) => setStarred((s) => {
    const next = s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
    try { localStorage.setItem(STARRED_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  const q = find.trim().toLowerCase();
  const match = (c: Channel) => !q || title(c).toLowerCase().includes(q);
  const dmTotal = dms.reduce((n, c) => n + (unread[c.id] ?? 0), 0);

  if (loading) return <div className="flex h-[60vh] items-center justify-center"><LoadingSpinner className="h-8 w-8 text-ivory-600" /></div>;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const dmIcon = (c: Channel) => {
    const other = dmPeople(c, me).map((id) => byId.get(id)).find((p): p is DirectoryMember => !!p);
    return other ? <Avatar firstName={other.first_name} lastName={other.last_name} src={other.avatar_url} size="sm" className="!h-5 !w-5 !rounded-md !text-[9px]" /> : <AtSign className="h-3.5 w-3.5" />;
  };
  const channelIcon = (c: Channel) => (c.kind === 'dm' ? dmIcon(c) : c.is_private ? <Lock className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" />);
  const isActive = (c: Channel) => sel?.kind === 'channel' && sel.id === c.id;

  return (
    // The whole screen above the feature dock (and below the top bar when the menu is open).
    <div className="-mx-4 -mt-5 -mb-[84px] flex h-[calc(100dvh-60px-var(--top-h,0px))] min-h-[480px] overflow-hidden bg-[#141C2E] lg:-mx-6 lg:-mt-6">
      {/* The rail */}
      <nav aria-label="Conversation views" className="hidden w-[72px] shrink-0 flex-col items-center gap-1 bg-[#0B1120] py-3 sm:flex">
        <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-gold-400 text-sm font-bold text-navy-900" title={workspace?.name ?? ''}>
          {(workspace?.name ?? 'S').trim().slice(0, 1).toUpperCase()}
        </span>
        <RailButton label="Home" active={view === 'home'} onClick={() => setView('home')}><Home className="h-5 w-5" /></RailButton>
        <RailButton label="DMs" active={view === 'dms'} badge={dmTotal} onClick={() => setView('dms')}><MessagesSquare className="h-5 w-5" /></RailButton>
        <RailButton label="Activity" active={view === 'activity'} badge={activity.length} dot onClick={() => setView('activity')}><Bell className="h-5 w-5" /></RailButton>
        <RailButton label="Email" active={sel?.kind === 'email'} onClick={() => setSel({ kind: 'email' })}><Mail className="h-5 w-5" /></RailButton>
        <div className="flex-1" />
        <button type="button" onClick={() => setModal('dm')} aria-label="New message" title="New message" className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"><Plus className="h-5 w-5" /></button>
        <Avatar firstName={profile?.first_name} lastName={profile?.last_name} src={profile?.avatar_url} size="sm" className="!rounded-lg" />
      </nav>

      {/* The list */}
      <aside className={cn('w-full shrink-0 flex-col border-r border-white/10 bg-[#141C2E] text-white sm:flex sm:w-[280px]', sel ? 'hidden' : 'flex')} aria-label="Conversations">
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">
            {view === 'dms' ? 'Direct messages' : view === 'activity' ? 'Activity' : workspace?.name ?? 'Conversations'}
          </h1>
          {/* Phones: no rail, so switch views here. */}
          <select value={view} onChange={(e) => setView(e.target.value as View)} aria-label="View" className="rounded-md border-0 bg-white/10 px-2 py-1 text-xs text-white sm:hidden">
            <option value="home">Home</option><option value="dms">DMs</option><option value="activity">Activity</option>
          </select>
          <button type="button" onClick={() => setModal('dm')} aria-label="New message" title="New message" className="rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white"><PenSquare className="h-4 w-4" /></button>
        </div>
        {view !== 'activity' && (
          <label className="relative mx-3 mb-2 block">
            <span className="sr-only">Find a conversation</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={view === 'dms' ? 'Find a DM…' : 'Find a conversation…'}
              className="h-8 w-full rounded-md border border-white/15 bg-white/5 pl-8 pr-2 text-sm text-white placeholder:text-white/45 focus:border-gold-400 focus:outline-none" />
          </label>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {view === 'home' && (
            <>
              {starred.length > 0 && (
                <Section label="Starred">
                  {mine.filter((c) => starred.includes(c.id) && match(c)).map((c) => (
                    <SideItem key={c.id} active={isActive(c)} unread={unread[c.id] ?? 0} onClick={() => open(c.id)} icon={channelIcon(c)} label={title(c)} />
                  ))}
                </Section>
              )}
              <Section label="Channels" onAdd={() => setModal('channel')} addLabel="Create a channel">
                {named.filter((c) => !starred.includes(c.id) && match(c)).map((c) => (
                  <SideItem key={c.id} active={isActive(c)} unread={unread[c.id] ?? 0} onClick={() => open(c.id)} icon={channelIcon(c)} label={c.name ?? ''} />
                ))}
                <button type="button" onClick={() => setModal('browse')} className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-white/60 hover:bg-white/10 hover:text-white">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-white/10"><Plus className="h-3 w-3" /></span> Browse channels
                </button>
              </Section>
              <Section label="Direct messages" onAdd={() => setModal('dm')} addLabel="New direct message">
                {dms.filter((c) => !starred.includes(c.id) && match(c)).map((c) => (
                  <SideItem key={c.id} active={isActive(c)} unread={unread[c.id] ?? 0} onClick={() => open(c.id)} icon={dmIcon(c)} label={title(c)} />
                ))}
                {dms.length === 0 && <p className="px-2 py-1 text-xs text-white/55">Message anyone in your team.</p>}
              </Section>
              <Section label="Email">
                <SideItem active={sel?.kind === 'email'} unread={0} onClick={() => setSel({ kind: 'email' })} icon={<Mail className="h-3.5 w-3.5" />} label="Email replies" />
              </Section>
            </>
          )}

          {view === 'dms' && (
            <ul className="-mx-2 divide-y divide-white/10 border-t border-white/10">
              {dms.filter(match).map((c) => {
                const last = latest.get(c.id);
                const who = last?.user_id === me ? 'You: ' : '';
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => open(c.id)} className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-white/5', isActive(c) && 'bg-white/10')}>
                      <span className="mt-0.5 shrink-0">{dmIcon(c)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={cn('min-w-0 flex-1 truncate text-sm', unread[c.id] ? 'font-bold text-white' : 'font-semibold text-white/90')}>{title(c)}</span>
                          <span className="shrink-0 text-xs text-white/50">{ago(last?.created_at ?? c.last_message_at ?? c.created_at)}</span>
                        </span>
                        <span className="line-clamp-2 text-sm text-white/60">{last ? `${who}${last.body}` : 'No messages yet'}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {dms.length === 0 && <li className="px-4 py-6 text-sm text-white/55">No direct messages yet. Start one with the pencil above.</li>}
            </ul>
          )}

          {view === 'activity' && (
            <ul className="space-y-2 pt-1">
              {activity.length === 0 && <li className="px-2 py-6 text-sm text-white/55">Nothing yet. When someone @mentions you or replies to your thread, it shows here.</li>}
              {activity.slice(0, 80).map((m) => {
                const c = byChannel.get(m.channel_id);
                const p = m.user_id ? byId.get(m.user_id) : undefined;
                const name = m.source === 'webhook' ? m.sender_name ?? 'Integration' : p ? memberName(p) : 'Someone';
                const kind = m.parent_id ? 'Thread reply' : 'Mention';
                return (
                  <li key={m.id}>
                    <button type="button" onClick={() => open(m.channel_id, m.parent_id)} className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-left hover:border-gold-400/60 hover:bg-white/10">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{name}</span>
                        <span className="shrink-0 text-xs text-white/50">{ago(m.created_at)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-white/55">{kind} in {c ? (c.kind === 'dm' ? title(c) : `#${c.name}`) : 'a conversation'}</span>
                      <span className="mt-1 line-clamp-2 text-sm text-white/80"><Body text={m.body} dark /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* The open conversation */}
      <section className={cn('min-w-0 flex-1 flex-col bg-white', sel ? 'flex' : 'hidden sm:flex')}>
        {sel?.kind === 'email' ? (
          <EmailReplies onBack={() => setSel(null)} />
        ) : current ? (
          <ChannelView
            key={current.id}
            channel={current}
            title={title(current)}
            me={me}
            people={people}
            byId={byId}
            starred={starred.includes(current.id)}
            onStar={() => toggleStar(current.id)}
            initialThread={openThread}
            canManage={current.kind === 'channel' && (canManageTeam || current.members.some((m) => m.user_id === me && m.role === 'owner'))}
            onBack={() => setSel(null)}
            onChanged={load}
            onLeft={() => { setSel(null); load(); }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState icon={<MessageSquare className="h-6 w-6" />} title="No conversation open" description="Create a channel for a team or topic, or message someone directly." />
          </div>
        )}
      </section>

      {modal === 'channel' && workspace && (
        <CreateChannelModal
          departments={departments}
          onClose={() => setModal(null)}
          onCreate={async (input) => {
            const { id, error: err } = await createChannel(workspace.id, input);
            if (err || !id) { toast(err ?? 'Could not create the channel.', 'error'); return; }
            setModal(null);
            await load();
            open(id);
          }}
        />
      )}
      {modal === 'dm' && workspace && (
        <PeoplePicker
          title="New direct message"
          action="Start conversation"
          people={people.filter((p) => p.user_id !== me && p.status === 'active')}
          max={8}
          onClose={() => setModal(null)}
          onPick={async (ids) => {
            const { id, error: err } = await openDm(workspace.id, ids);
            if (err || !id) { toast(err ?? 'Could not open the conversation.', 'error'); return; }
            setModal(null);
            await load();
            open(id);
          }}
        />
      )}
      {modal === 'browse' && (
        <BrowseChannels
          channels={channels.filter((c) => c.kind === 'channel' && !c.is_private)}
          me={me}
          onClose={() => setModal(null)}
          onOpen={async (c) => {
            if (!c.members.some((m) => m.user_id === me)) {
              const { error: err } = await joinChannel(c, me);
              if (err) { toast(err, 'error'); return; }
              await load();
            }
            setModal(null);
            open(c.id);
          }}
        />
      )}
    </div>
  );
}

function RailButton({ label, active, badge = 0, dot, onClick, children }: { label: string; active: boolean; badge?: number; dot?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className="group flex w-full flex-col items-center gap-0.5 py-1 text-[11px] font-semibold text-white/80">
      <span className={cn('relative flex h-9 w-9 items-center justify-center rounded-xl transition', active ? 'bg-white/20 text-white' : 'group-hover:bg-white/10')}>
        {children}
        {badge > 0 && (dot
          ? <span className="absolute -right-1 -top-1 rounded-full bg-burgundy-500 px-1 text-[10px] font-bold leading-4 text-white">{badge > 99 ? '99+' : badge}</span>
          : <span className="absolute -right-1 -top-1 rounded-full bg-gold-400 px-1 text-[10px] font-bold leading-4 text-navy-900">{badge > 99 ? '99+' : badge}</span>)}
      </span>
      <span className={active ? 'text-white' : 'text-white/70'}>{label}</span>
    </button>
  );
}

function Section({ label, onAdd, addLabel, children }: { label: string; onAdd?: () => void; addLabel?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-3">
      <div className="group flex items-center gap-1 px-1 pb-0.5">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-sm font-medium text-white/70 hover:bg-white/10">
          <ChevronDown className={cn('h-3.5 w-3.5 transition', !open && '-rotate-90')} /> {label}
        </button>
        {onAdd && <button type="button" onClick={onAdd} aria-label={addLabel} title={addLabel} className="rounded p-0.5 text-white/60 hover:bg-white/10 hover:text-white"><Plus className="h-4 w-4" /></button>}
      </div>
      {open && <div className="space-y-px">{children}</div>}
    </div>
  );
}

function SideItem({ active, unread, onClick, icon, label }: { active: boolean; unread: number; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[15px] transition', active ? 'bg-gold-400 text-navy-900' : unread ? 'font-bold text-white hover:bg-white/10' : 'text-white/75 hover:bg-white/10 hover:text-white')}>
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center', active ? 'text-navy-900' : 'text-white/70')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {unread > 0 && !active && <span className="rounded-full bg-burgundy-500 px-1.5 text-[11px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

function Body({ text, dark }: { text: string; dark?: boolean }) {
  // Lines starting "> " are quotes; the rest keeps its line breaks.
  const lines = text.split('\n');
  const runs = (t: string) => formatRuns(t).map((r, i) => {
    switch (r.t) {
      case 'bold': return <strong key={i}>{r.v}</strong>;
      case 'italic': return <em key={i}>{r.v}</em>;
      case 'strike': return <s key={i}>{r.v}</s>;
      case 'code': return <code key={i} className={cn('rounded px-1 py-0.5 font-mono text-[0.85em]', dark ? 'bg-white/10 text-gold-200' : 'bg-burgundy-50 text-burgundy-700')}>{r.v}</code>;
      case 'link': return <a key={i} href={r.v} target="_blank" rel="noreferrer noopener" className={dark ? 'text-gold-300 underline' : 'text-[#1D6FB8] hover:underline'}>{r.v}</a>;
      case 'mention': return <span key={i} className={cn('rounded px-0.5 font-medium', dark ? 'bg-gold-400/25 text-gold-200' : 'bg-gold-100 text-gold-800')}>{r.v}</span>;
      default: return <span key={i}>{r.v}</span>;
    }
  });
  // ``` fences make a code block.
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim().startsWith('```')) {
      const end = lines.findIndex((x, k) => k > i && x.trim().startsWith('```'));
      if (end > i) {
        out.push(<code key={i} className={cn('my-1 block overflow-x-auto rounded-md border px-3 py-2 font-mono text-[13px]', dark ? 'border-white/15 bg-white/5' : 'border-ivory-200 bg-[#F6F7FA] text-navy-900')}>{lines.slice(i + 1, end).join('\n')}</code>);
        i = end;
        continue;
      }
    }
    out.push(l.startsWith('> ')
      ? <span key={i} className={cn('my-0.5 block border-l-4 pl-3', dark ? 'border-white/30' : 'border-ivory-300 text-navy-700')}>{runs(l.slice(2))}</span>
      : <span key={i}>{runs(l)}{i < lines.length - 1 ? '\n' : ''}</span>);
  }
  return <span className={cn('block whitespace-pre-wrap break-words text-[15px] leading-relaxed', dark ? '' : 'text-navy-900')}>{out}</span>;
}

function ChannelView({ channel, title, me, people, byId, starred, onStar, initialThread, canManage, onBack, onChanged, onLeft }: {
  channel: Channel; title: string; me: string; people: DirectoryMember[]; byId: Map<string, DirectoryMember>; starred: boolean; onStar: () => void;
  initialThread: string | null; canManage: boolean; onBack: () => void; onChanged: () => void; onLeft: () => void;
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [thread, setThread] = useState<ChatMessage | null>(null);
  const [panel, setPanel] = useState<'add' | 'integrations' | null>(null);
  const [tab, setTab] = useState<'messages' | 'links'>('messages');
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const member = channel.members.some((m) => m.user_id === me);

  const scrollDown = () => requestAnimationFrame(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; });

  useEffect(() => {
    let alive = true;
    listMessages(channel.id).then((r) => {
      if (!alive) return;
      if (r.error) toast(r.error, 'error');
      setMessages(r.data);
      setMore(r.more);
      setLoading(false);
      scrollDown();
    });
    if (member) void markRead(channel.id, me);
    return () => { alive = false; };
  }, [channel.id, member, me, toast]);

  // Opened from Activity on a thread reply: open that thread.
  useEffect(() => {
    if (!initialThread || thread?.id === initialThread) return;
    const parent = messages.find((m) => m.id === initialThread);
    if (parent) setThread(parent);
  }, [initialThread, messages, thread]);

  // Live: new and changed messages in this channel.
  useEffect(() => subscribeMessages(channel.workspace_id, (m, kind) => {
    if (m.channel_id !== channel.id) return;
    if (kind === 'INSERT' && !m.parent_id) {
      const el = listRef.current;
      const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
      if (nearBottom) scrollDown();
      if (member) void markRead(channel.id, me);
    } else if (kind === 'UPDATE') {
      setMessages((list) => list.map((x) => (x.id === m.id ? m : x)));
      setThread((t) => (t && t.id === m.id ? m : t));
    }
  }), [channel.id, channel.workspace_id, member, me]);

  const older = async () => {
    const first = messages[0];
    if (!first) return;
    const el = listRef.current;
    const before = el?.scrollHeight ?? 0;
    const r = await listMessages(channel.id, first.created_at);
    setMessages((list) => [...r.data, ...list]);
    setMore(r.more);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
  };

  const send = async (text: string) => {
    const { data, error } = await sendMessage(channel.id, me, text);
    if (error) { toast(error, 'error'); return false; }
    if (data) setMessages((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]));
    scrollDown();
    return true;
  };

  const join = async () => {
    const { error } = await joinChannel(channel, me);
    if (error) { toast(error, 'error'); return; }
    onChanged();
  };

  const leave = async () => {
    setMenu(false);
    const { error } = await leaveChannel(channel.id, me);
    if (error) { toast(error, 'error'); return; }
    toast(`You left #${channel.name}`);
    onLeft();
  };

  const needle = q.trim().toLowerCase();
  const shown = needle ? messages.filter((m) => m.body.toLowerCase().includes(needle)) : messages;
  const links = useMemo(() => linksIn(messages), [messages]);
  const placeholder = channel.kind === 'dm' ? `Message ${title}` : `Message #${channel.name}`;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 px-4 pt-3">
          <button type="button" onClick={onBack} aria-label="Back to conversations" className="rounded-md p-1 text-navy-700 hover:bg-ivory-100 sm:hidden"><ArrowLeft className="h-5 w-5" /></button>
          <button type="button" onClick={onStar} aria-pressed={starred} aria-label={starred ? 'Unstar' : 'Star'} title={starred ? 'Unstar' : 'Star (keeps it at the top of your list)'} className="rounded-md p-1 text-navy-700 hover:bg-ivory-100">
            <Star className={cn('h-4 w-4', starred && 'fill-gold-400 text-gold-500')} />
          </button>
          <h2 className="flex min-w-0 items-center gap-1 text-lg font-bold text-navy-900">
            {channel.kind === 'channel' ? (channel.is_private ? <Lock className="h-4 w-4 shrink-0" /> : <Hash className="h-4 w-4 shrink-0" />) : null}
            <span className="truncate">{title}</span>
          </h2>
          {channel.description && <p className="ml-2 hidden min-w-0 flex-1 truncate text-sm text-ivory-700 lg:block">{channel.description}</p>}
          <div className="ml-auto flex items-center gap-1">
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-navy-700" title="Members"><Users className="h-4 w-4" /> {channel.members.length}</span>
            <button type="button" onClick={() => { setSearching((v) => !v); setQ(''); }} aria-label="Search this conversation" aria-pressed={searching} className="rounded-md p-1.5 text-navy-700 hover:bg-ivory-100"><Search className="h-4 w-4" /></button>
            <div className="relative">
              <button type="button" onClick={() => setMenu((v) => !v)} aria-label="Conversation options" aria-expanded={menu} className="rounded-md p-1.5 text-navy-700 hover:bg-ivory-100"><MoreHorizontal className="h-4 w-4" /></button>
              {menu && (
                <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-ivory-200 bg-white py-1 shadow-popover">
                  {canManage && <button role="menuitem" type="button" onClick={() => { setMenu(false); setPanel('add'); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ivory-50"><UserPlus className="h-4 w-4" /> Add people</button>}
                  {canManage && <button role="menuitem" type="button" onClick={() => { setMenu(false); setPanel('integrations'); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ivory-50"><Plug className="h-4 w-4" /> Integrations</button>}
                  {channel.kind === 'channel' && member && <button role="menuitem" type="button" onClick={leave} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-burgundy-600 hover:bg-burgundy-50"><ArrowLeft className="h-4 w-4" /> Leave channel</button>}
                  {!canManage && !(channel.kind === 'channel' && member) && <p className="px-3 py-1.5 text-sm text-ivory-700">Nothing to change here.</p>}
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="flex items-center gap-1 border-b border-ivory-200 px-3" role="tablist" aria-label="Conversation">
          {(['messages', 'links'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cn('-mb-px inline-flex items-center gap-1.5 border-b-2 px-2 py-2 text-sm font-semibold', tab === t ? 'border-navy-900 text-navy-900' : 'border-transparent text-ivory-700 hover:text-navy-800')}>
              {t === 'messages' ? <><MessageSquare className="h-4 w-4" /> Messages</> : <><Link2 className="h-4 w-4" /> Links{links.length ? ` · ${links.length}` : ''}</>}
            </button>
          ))}
        </div>
        {searching && (
          <div className="flex items-center gap-2 border-b border-ivory-200 px-4 py-2">
            <Search className="h-4 w-4 text-ivory-600" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${channel.kind === 'dm' ? 'this conversation' : `#${channel.name}`}`} autoFocus aria-label="Search messages" className="min-w-0 flex-1 border-0 bg-transparent text-sm text-navy-800 outline-none" />
            {needle && <span className="text-xs text-ivory-700">{shown.length} found</span>}
            <button type="button" onClick={() => { setSearching(false); setQ(''); }} aria-label="Close search" className="rounded p-1 text-ivory-700 hover:bg-ivory-100"><X className="h-4 w-4" /></button>
          </div>
        )}

        {tab === 'links' ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {links.length === 0 ? <p className="py-10 text-center text-sm text-ivory-700">Links shared here show up in this tab.</p> : (
              <ul className="divide-y divide-ivory-200 rounded-lg border border-ivory-200">
                {links.map((l) => (
                  <li key={l.url} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700"><Link2 className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <a href={l.url} target="_blank" rel="noreferrer noopener" className="block truncate text-sm font-medium text-[#1D6FB8] hover:underline">{l.url}</a>
                      <span className="block truncate text-xs text-ivory-700">{l.message.sender_name ?? (l.message.user_id && byId.get(l.message.user_id) ? memberName(byId.get(l.message.user_id)!) : 'Someone')} · {dayLabel(l.message.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-3" aria-live="polite">
            {more && !needle && <div className="my-3 text-center"><button type="button" onClick={older} className="btn-ghost !py-1 text-xs">Show older messages</button></div>}
            {loading ? <LoadingSpinner className="mx-auto mt-6 h-6 w-6 text-ivory-600" /> : shown.length === 0 ? (
              <div className="px-6 py-10">
                {needle ? <p className="text-center text-sm text-ivory-700">Nothing matches "{q}".</p> : (
                  <>
                    <p className="text-2xl font-bold text-navy-900">{channel.kind === 'dm' ? title : `#${channel.name}`}</p>
                    <p className="mt-1 text-sm text-ivory-700">{channel.kind === 'dm' ? 'This is the start of your conversation.' : `This is the very beginning of #${channel.name}.${channel.description ? ` ${channel.description}` : ''}`}</p>
                  </>
                )}
              </div>
            ) : (
              <ol>
                {shown.map((m, i) => {
                  const prev = shown[i - 1];
                  const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
                  return (
                    <li key={m.id}>
                      {newDay && <DayDivider iso={m.created_at} />}
                      <MessageItem message={m} first={newDay || startsGroup(prev, m)} me={me} byId={byId} canModerate={canManage}
                        onThread={() => setThread(m)} />
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {member ? (
          <Composer placeholder={placeholder} people={people} onSend={send} />
        ) : (
          <div className="m-3 flex items-center justify-between gap-3 rounded-xl border border-ivory-200 bg-ivory-50 px-4 py-3 text-sm">
            <span className="text-navy-700">You're reading <strong>#{channel.name}</strong>.</span>
            <button type="button" onClick={join} className="btn-primary !py-1.5">Join channel</button>
          </div>
        )}
      </div>

      {thread && (
        <ThreadPanel parent={thread} channel={channel} title={title} me={me} people={people} byId={byId} member={member} canModerate={canManage} onClose={() => setThread(null)} />
      )}
      {panel === 'add' && (
        <PeoplePicker
          title={`Add people to #${channel.name}`}
          action="Add"
          people={people.filter((p) => p.status === 'active' && !channel.members.some((m) => m.user_id === p.user_id))}
          max={200}
          onClose={() => setPanel(null)}
          onPick={async (ids) => {
            const { error } = await addMembers(channel, ids);
            if (error) { toast(error, 'error'); return; }
            toast(`Added ${ids.length} ${ids.length === 1 ? 'person' : 'people'}`);
            setPanel(null);
            onChanged();
          }}
        />
      )}
      {panel === 'integrations' && <IntegrationsModal channel={channel} me={me} onClose={() => setPanel(null)} />}
    </div>
  );
}

/** A date across the conversation, as a pill on a line. */
function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="sticky top-0 z-[1] my-2 flex items-center gap-0 px-4">
      <span className="h-px flex-1 bg-ivory-200" />
      <span className="rounded-full border border-ivory-200 bg-white px-3 py-1 text-xs font-bold text-navy-800 shadow-sm">{dayLabel(iso)}</span>
      <span className="h-px flex-1 bg-ivory-200" />
    </div>
  );
}

function SenderAvatar({ m, byId }: { m: ChatMessage; byId: Map<string, DirectoryMember> }) {
  const p = m.user_id ? byId.get(m.user_id) : undefined;
  if (m.source === 'webhook') {
    return <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold-100 text-gold-800"><Plug className="h-4 w-4" /></span>;
  }
  return <Avatar firstName={p?.first_name ?? null} lastName={p?.last_name ?? null} src={p?.avatar_url ?? null} size="sm" className="!h-9 !w-9 !rounded-lg" />;
}

function MessageItem({ message: m, first, me, byId, canModerate, onThread, inThread }: {
  message: ChatMessage; first: boolean; me: string; byId: Map<string, DirectoryMember>; canModerate: boolean; onThread?: () => void; inThread?: boolean;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [menu, setMenu] = useState(false);
  const p = m.user_id ? byId.get(m.user_id) : undefined;
  const name = m.source === 'webhook' ? m.sender_name ?? 'Integration' : p ? memberName(p) : 'Former member';
  const mine = m.user_id === me && m.source === 'user';
  const deleted = !!m.deleted_at;

  const saveEdit = async () => {
    if (!draft.trim() || draft === m.body) { setEditing(false); return; }
    const { error } = await editMessage(m.id, draft);
    if (error) toast(error, 'error'); else setEditing(false);
  };
  const remove = async () => {
    setMenu(false);
    const { error } = await deleteMessage(m.id);
    if (error) toast(error, 'error');
  };

  return (
    <div className={cn('group relative flex gap-2.5 px-4 hover:bg-[#F6F7FA]', first ? 'mt-2 pt-1.5' : '')}>
      <div className="w-9 shrink-0">
        {first ? <SenderAvatar m={m} byId={byId} /> : <time className="hidden pt-1 text-right text-[10px] text-ivory-600 group-hover:block" dateTime={m.created_at}>{time(m.created_at)}</time>}
      </div>
      <div className="min-w-0 flex-1 pb-1">
        {first && (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[15px] font-bold text-navy-900">{name}</span>
            {m.source === 'webhook' && <span className="rounded bg-ivory-200 px-1 text-[10px] font-bold uppercase tracking-wide text-navy-700">App{typeof m.meta?.via === 'string' && m.meta.via !== name ? ` · ${m.meta.via}` : ''}</span>}
            {p?.title && m.source === 'user' && <span className="text-xs text-ivory-700">{p.title}</span>}
            <time className="text-xs text-ivory-700" dateTime={m.created_at}>{time(m.created_at)}</time>
          </p>
        )}
        {editing ? (
          <div className="mt-1">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="input-field text-sm" aria-label="Edit message"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveEdit(); } if (e.key === 'Escape') setEditing(false); }} autoFocus />
            <div className="mt-1 flex gap-2 text-xs"><button type="button" onClick={saveEdit} className="btn-primary !px-2 !py-1">Save</button><button type="button" onClick={() => setEditing(false)} className="btn-ghost !px-2 !py-1">Cancel</button></div>
          </div>
        ) : deleted ? (
          <p className="text-sm italic text-ivory-700">This message was deleted.</p>
        ) : (
          <>
            <Body text={m.body} />
            {m.edited_at && <span className="text-[11px] text-ivory-700">(edited)</span>}
          </>
        )}
        {!inThread && m.reply_count > 0 && onThread && (
          <button type="button" onClick={onThread} className="mt-1 inline-flex items-center gap-2 rounded-md border border-transparent px-1 py-0.5 text-sm hover:border-ivory-200 hover:bg-white">
            <span className="font-bold text-[#1D6FB8]">{m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}</span>
            {m.last_reply_at && <span className="text-xs text-ivory-700">Last reply {ago(m.last_reply_at)}</span>}
          </button>
        )}
      </div>
      {!deleted && !editing && (
        <div className="absolute -top-3 right-4 hidden items-center gap-0.5 rounded-lg border border-ivory-200 bg-white p-0.5 shadow-sm group-hover:flex group-focus-within:flex">
          {!inThread && onThread && <button type="button" onClick={onThread} aria-label="Reply in thread" title="Reply in thread" className="rounded p-1 text-navy-700 hover:bg-ivory-100"><MessageSquare className="h-4 w-4" /></button>}
          {(mine || canModerate) && (
            <div className="relative">
              <button type="button" onClick={() => setMenu((v) => !v)} aria-label="More actions" aria-expanded={menu} className="rounded p-1 text-navy-700 hover:bg-ivory-100"><MoreHorizontal className="h-4 w-4" /></button>
              {menu && (
                <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-ivory-200 bg-white py-1 shadow-popover">
                  {mine && <button role="menuitem" type="button" onClick={() => { setMenu(false); setDraft(m.body); setEditing(true); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ivory-50"><Pencil className="h-4 w-4" /> Edit</button>}
                  <button role="menuitem" type="button" onClick={remove} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-burgundy-600 hover:bg-burgundy-50"><Trash2 className="h-4 w-4" /> Delete</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const EMOJI = ['👍', '🙏', '🙌', '🔥', '🎉', '✅', '👀', '😂', '❤️', '😊', '🤔', '💯', '👏', '🚀', '☕', '📌'];

/**
 * The message box, like Slack's: a formatting bar (bold, italic, strike, link, lists, quote,
 * code), the text, and a row for emoji and @mentions, with Send. Formatting is written as
 * **bold**, _italic_, ~strike~, `code`, which the messages show styled.
 */
function Composer({ placeholder, people, onSend, compact }: { placeholder: string; people: DirectoryMember[]; onSend: (text: string) => Promise<boolean>; compact?: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState(!compact);
  const [emoji, setEmoji] = useState(false);
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const ok = await onSend(text);
    setBusy(false);
    if (ok) { setText(''); setMention(null); }
  };
  /** Put `before`/`after` round the selection (or a placeholder word). */
  const wrap = (before: string, after = before, word = 'text') => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const picked = text.slice(a, b) || word;
    const next = text.slice(0, a) + before + picked + after + text.slice(b);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + before.length, a + before.length + picked.length); });
  };
  /** Start the current line(s) with a marker (lists, quotes). */
  const prefix = (marker: (i: number) => string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const start = text.lastIndexOf('\n', a - 1) + 1;
    const block = text.slice(start, b).split('\n').map((l, i) => marker(i) + l).join('\n');
    setText(text.slice(0, start) + block + text.slice(b));
    requestAnimationFrame(() => el.focus());
  };
  const insert = (s: string) => {
    const el = ref.current;
    const a = el?.selectionStart ?? text.length;
    const b = el?.selectionEnd ?? text.length;
    setText(text.slice(0, a) + s + text.slice(b));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + s.length, a + s.length); });
  };
  const onChange = (v: string) => {
    setText(v);
    const caret = ref.current?.selectionStart ?? v.length;
    const m = /(^|\s)@([\w.'-]{0,30})$/.exec(v.slice(0, caret));
    setMention(m ? { q: m[2].toLowerCase(), at: caret - m[2].length - 1 } : null);
  };
  const candidates = mention ? [{ id: '@here', label: 'here', note: 'Everyone here' }, { id: '@channel', label: 'channel', note: 'Everyone in the channel' },
    ...people.filter((p) => p.status === 'active').map((p) => ({ id: p.user_id, label: memberName(p), note: p.title ?? '' }))]
    .filter((c) => c.label.toLowerCase().includes(mention.q)).slice(0, 6) : [];
  const pick = (label: string) => {
    if (!mention) return;
    const handle = label.split(' ')[0];
    const caret = ref.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.at)}@${handle} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => { const p = mention.at + handle.length + 2; ref.current?.focus(); ref.current?.setSelectionRange(p, p); });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && candidates.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(candidates[0].label); return; }
    if (e.key === 'Escape') { setMention(null); setEmoji(false); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**'); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('_'); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
  };
  const tool = 'rounded p-1.5 text-ivory-700 hover:bg-ivory-100 hover:text-navy-800';
  return (
    <div className="relative px-4 pb-4 pt-1">
      {mention && candidates.length > 0 && (
        <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-4 z-20 mb-1 w-72 overflow-hidden rounded-lg border border-ivory-200 bg-white py-1 shadow-popover">
          {candidates.map((c, i) => (
            <li key={c.id}>
              <button type="button" role="option" aria-selected={i === 0} onMouseDown={(e) => { e.preventDefault(); pick(c.label); }} className={cn('flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-ivory-50', i === 0 && 'bg-ivory-50')}>
                <span className="font-semibold text-navy-900">@{c.label}</span><span className="truncate text-xs text-ivory-700">{c.note}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-xl border border-ivory-300 bg-white focus-within:border-navy-500 focus-within:shadow-[0_0_0_1px] focus-within:shadow-navy-500">
        {tools && (
          <div className="flex flex-wrap items-center gap-0.5 rounded-t-xl bg-[#F6F7FA] px-1.5 py-1" role="toolbar" aria-label="Formatting">
            <button type="button" onClick={() => wrap('**')} aria-label="Bold" title="Bold (Ctrl+B)" className={tool}><Bold className="h-4 w-4" /></button>
            <button type="button" onClick={() => wrap('_')} aria-label="Italic" title="Italic (Ctrl+I)" className={tool}><Italic className="h-4 w-4" /></button>
            <button type="button" onClick={() => wrap('~')} aria-label="Strikethrough" title="Strikethrough" className={tool}><Strikethrough className="h-4 w-4" /></button>
            <span className="mx-1 h-4 w-px bg-ivory-300" />
            <button type="button" onClick={() => wrap('', ' (https://)', 'link text')} aria-label="Link" title="Link" className={tool}><Link2 className="h-4 w-4" /></button>
            <button type="button" onClick={() => prefix((i) => `${i + 1}. `)} aria-label="Numbered list" title="Numbered list" className={tool}><ListOrdered className="h-4 w-4" /></button>
            <button type="button" onClick={() => prefix(() => '• ')} aria-label="Bulleted list" title="Bulleted list" className={tool}><List className="h-4 w-4" /></button>
            <span className="mx-1 h-4 w-px bg-ivory-300" />
            <button type="button" onClick={() => prefix(() => '> ')} aria-label="Quote" title="Quote" className={tool}><Quote className="h-4 w-4" /></button>
            <button type="button" onClick={() => wrap('`')} aria-label="Code" title="Code" className={tool}><Code className="h-4 w-4" /></button>
            <button type="button" onClick={() => wrap('```\n', '\n```', 'code')} aria-label="Code block" title="Code block" className={tool}><SquareCode className="h-4 w-4" /></button>
          </div>
        )}
        <textarea ref={ref} value={text} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} rows={compact ? 1 : 2} maxLength={8000} placeholder={placeholder} aria-label={placeholder}
          className="block max-h-48 min-h-[44px] w-full resize-none border-0 bg-transparent px-3 py-2.5 text-[15px] text-navy-900 outline-none placeholder:text-ivory-600 focus:ring-0" />
        <div className="relative flex items-center gap-0.5 px-1.5 pb-1.5">
          <button type="button" onClick={() => setTools((v) => !v)} aria-pressed={tools} aria-label="Show formatting" title="Show formatting" className={cn(tool, tools && 'text-navy-800')}><Type className="h-4 w-4" /></button>
          <button type="button" onClick={() => setEmoji((v) => !v)} aria-expanded={emoji} aria-label="Emoji" title="Emoji" className={tool}><Smile className="h-4 w-4" /></button>
          <button type="button" onClick={() => { insert('@'); setMention({ q: '', at: (ref.current?.selectionStart ?? text.length) }); }} aria-label="Mention someone" title="Mention someone" className={tool}><AtSign className="h-4 w-4" /></button>
          {emoji && (
            <div className="absolute bottom-full left-8 z-20 mb-1 grid w-64 grid-cols-8 gap-0.5 rounded-lg border border-ivory-200 bg-white p-1.5 shadow-popover">
              {EMOJI.map((e) => <button key={e} type="button" onClick={() => { insert(e); setEmoji(false); }} className="rounded p-1 text-lg hover:bg-ivory-100" aria-label={e}>{e}</button>)}
            </div>
          )}
          <span className="ml-auto hidden text-[11px] text-ivory-600 md:inline">Shift + Enter for a new line</span>
          <button type="button" onClick={submit} disabled={!text.trim() || busy} aria-label="Send" title="Send (Enter)"
            className={cn('ml-2 rounded-md p-1.5 transition', text.trim() ? 'bg-[#1F7A4D] text-white hover:bg-[#19663F]' : 'text-ivory-500')}><SendHorizontal className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}

function ThreadPanel({ parent, channel, title, me, people, byId, member, canModerate, onClose }: {
  parent: ChatMessage; channel: Channel; title: string; me: string; people: DirectoryMember[]; byId: Map<string, DirectoryMember>; member: boolean; canModerate: boolean; onClose: () => void;
}) {
  const { toast } = useToast();
  const [replies, setReplies] = useState<ChatMessage[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listThread(parent.id).then((r) => { setReplies(r); requestAnimationFrame(() => endRef.current?.scrollIntoView()); }); }, [parent.id]);
  useEffect(() => subscribeMessages(channel.workspace_id, (m, kind) => {
    if (m.parent_id !== parent.id) return;
    setReplies((list) => (kind === 'INSERT' ? (list.some((x) => x.id === m.id) ? list : [...list, m]) : list.map((x) => (x.id === m.id ? m : x))));
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }), [parent.id, channel.workspace_id]);

  const send = async (text: string) => {
    const { data, error } = await sendMessage(channel.id, me, text, parent.id);
    if (error) { toast(error, 'error'); return false; }
    if (data) setReplies((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]));
    return true;
  };

  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-white sm:static sm:z-auto sm:w-[380px] sm:shrink-0 sm:border-l sm:border-ivory-200" aria-label="Thread">
      <header className="flex items-center gap-2 border-b border-ivory-200 px-4 py-3">
        <h3 className="text-base font-bold text-navy-900">Thread</h3>
        <span className="min-w-0 flex-1 truncate text-sm text-ivory-700">{channel.kind === 'dm' ? title : `# ${channel.name}`}</span>
        <button type="button" onClick={onClose} aria-label="Close thread" className="rounded-md p-1 text-ivory-700 hover:bg-ivory-100"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <MessageItem message={parent} first me={me} byId={byId} canModerate={canModerate} inThread />
        <div className="my-2 flex items-center gap-2 px-4 text-xs text-ivory-700"><span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span><span className="h-px flex-1 bg-ivory-200" /></div>
        {replies.map((r, i) => <MessageItem key={r.id} message={r} first={startsGroup(replies[i - 1], r)} me={me} byId={byId} canModerate={canModerate} inThread />)}
        <div ref={endRef} />
      </div>
      {member && <Composer placeholder="Reply…" people={people} onSend={send} compact />}
    </aside>
  );
}

function CreateChannelModal({ departments, onClose, onCreate }: { departments: Department[]; onClose: () => void; onCreate: (i: { name: string; description: string; isPrivate: boolean; departmentId: string | null }) => Promise<void> }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Create a channel" description="Channels are where a team or topic talks. Anyone in the account can join a public one."
      footer={<><button type="button" onClick={onClose} className="btn-ghost">Cancel</button><button type="button" disabled={!name.trim() || busy} onClick={async () => { setBusy(true); await onCreate({ name, description, isPrivate, departmentId }); setBusy(false); }} className="btn-primary">{busy ? 'Creating…' : 'Create'}</button></>}>
      <div className="grid gap-4">
        <label className="grid gap-1.5 text-sm font-medium text-navy-800">Name
          <span className="relative"><Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" /><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="video-team" className="input-field !pl-9" autoFocus /></span>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-navy-800">What it's about <span className="text-xs font-normal text-ivory-700">(optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} className="input-field" placeholder="Client video sessions and handovers" />
        </label>
        {departments.length > 0 && (
          <label className="grid gap-1.5 text-sm font-medium text-navy-800">Department <span className="text-xs font-normal text-ivory-700">(optional)</span>
            <select value={departmentId ?? ''} onChange={(e) => setDepartmentId(e.target.value || null)} className="input-field">
              <option value="">None</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
        <label className="flex items-start gap-2 text-sm text-navy-800">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} className="mt-0.5" />
          <span>Private <span className="block text-xs text-ivory-700">Only people you add can see and join it.</span></span>
        </label>
      </div>
    </Modal>
  );
}

function PeoplePicker({ title, action, people, max, onClose, onPick }: { title: string; action: string; people: DirectoryMember[]; max: number; onClose: () => void; onPick: (ids: string[]) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const shown = people.filter((p) => !q.trim() || `${memberName(p)} ${p.title ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 200);
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= max ? x : [...x, id]));
  return (
    <Modal open onClose={onClose} title={title}
      footer={<><button type="button" onClick={onClose} className="btn-ghost">Cancel</button><button type="button" disabled={!picked.length || busy} onClick={async () => { setBusy(true); await onPick(picked); setBusy(false); }} className="btn-primary">{action}{picked.length ? ` (${picked.length})` : ''}</button></>}>
      <label className="relative block">
        <span className="sr-only">Search people</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="input-field !pl-9" autoFocus />
      </label>
      <ul className="mt-2 max-h-72 divide-y divide-ivory-200 overflow-y-auto rounded-lg border border-ivory-200">
        {shown.length === 0 && <li className="px-3 py-3 text-sm text-ivory-700">Nobody matches.</li>}
        {shown.map((p) => {
          const on = picked.includes(p.user_id);
          return (
            <li key={p.user_id}>
              <button type="button" onClick={() => toggle(p.user_id)} aria-pressed={on} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-ivory-50">
                <Avatar firstName={p.first_name} lastName={p.last_name} src={p.avatar_url} size="sm" />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium text-navy-800">{memberName(p)}</span>{p.title && <span className="block truncate text-xs text-ivory-700">{p.title}</span>}</span>
                <span className={cn('flex h-5 w-5 items-center justify-center rounded border', on ? 'border-navy-800 bg-navy-800 text-white' : 'border-ivory-400')}>{on && <Check className="h-3.5 w-3.5" />}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function BrowseChannels({ channels, me, onClose, onOpen }: { channels: Channel[]; me: string; onClose: () => void; onOpen: (c: Channel) => void }) {
  const [q, setQ] = useState('');
  const shown = channels.filter((c) => !q.trim() || `${c.name} ${c.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal open onClose={onClose} title="Browse channels" description="Public channels in your account.">
      <label className="relative block">
        <span className="sr-only">Search channels</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory-600" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels" className="input-field !pl-9" autoFocus />
      </label>
      <ul className="mt-2 max-h-80 divide-y divide-ivory-200 overflow-y-auto rounded-lg border border-ivory-200">
        {shown.length === 0 && <li className="px-3 py-3 text-sm text-ivory-700">No channels yet. Create the first one.</li>}
        {shown.map((c) => {
          const joined = c.members.some((m) => m.user_id === me);
          return (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <Hash className="h-4 w-4 shrink-0 text-ivory-700" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-navy-800">{c.name}</span><span className="block truncate text-xs text-ivory-700">{c.members.length} members{c.description ? ` · ${c.description}` : ''}</span></span>
              <button type="button" onClick={() => onOpen(c)} className={joined ? 'btn-ghost !py-1' : 'btn-primary !py-1'}>{joined ? 'Open' : 'Join'}</button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

const PRESETS = ['Zapier', 'Airtable', 'Modal', 'Other'] as const;

function IntegrationsModal({ channel, me, onClose }: { channel: Channel; me: string; onClose: () => void }) {
  const { toast } = useToast();
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [name, setName] = useState<string>('Zapier');
  const [custom, setCustom] = useState('');
  const [guide, setGuide] = useState<(typeof PRESETS)[number]>('Zapier');
  const load = useCallback(() => listWebhooks(channel.id).then(setHooks), [channel.id]);
  useEffect(() => { load(); }, [load]);
  const copy = async (text: string) => { await navigator.clipboard.writeText(text); toast('Copied'); };
  const add = async () => {
    const label = name === 'Other' ? custom.trim() || 'Webhook' : name;
    const { data, error } = await createWebhook(channel, label, me);
    if (error || !data) { toast(error ?? 'Could not create the link.', 'error'); return; }
    toast(`${label} link created`);
    setGuide(PRESETS.includes(label as (typeof PRESETS)[number]) ? (label as (typeof PRESETS)[number]) : 'Other');
    load();
  };
  const revoke = async (h: Webhook) => {
    const { error } = await revokeWebhook(h.id);
    if (error) { toast(error, 'error'); return; }
    toast(`${h.name} link turned off`);
    load();
  };
  const sample = hooks?.[0] ? webhookUrl(hooks[0].token) : webhookUrl('YOUR-LINK-TOKEN');

  return (
    <Modal open onClose={onClose} size="lg" title={`Integrations for #${channel.name}`} description="Give Zapier, Airtable, Modal (or anything that can send a web request) a private link that posts into this channel.">
      <div className="grid min-w-0 gap-5 [&>*]:min-w-0">
        <div>
          <p className="text-sm font-semibold text-navy-800">Links</p>
          {hooks === null ? <LoadingSpinner className="mt-2 h-5 w-5 text-ivory-600" /> : hooks.length === 0 ? (
            <p className="mt-1 text-sm text-ivory-700">No links yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-ivory-200 rounded-lg border border-ivory-200">
              {hooks.map((h) => (
                <li key={h.id} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-navy-800">{h.name}</span>
                    <span className="text-xs text-ivory-700">{h.last_used_at ? `last post ${new Date(h.last_used_at).toLocaleString()}` : 'not used yet'}</span>
                    <button type="button" onClick={() => revoke(h)} className="ml-auto text-xs font-semibold text-burgundy-600 hover:underline">Turn off</button>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <input readOnly value={webhookUrl(h.token)} aria-label={`${h.name} link`} onFocus={(e) => e.currentTarget.select()} className="input-field min-w-0 flex-1 font-mono text-[11px]" />
                    <button type="button" onClick={() => copy(webhookUrl(h.token))} className="btn-secondary !px-2.5 !py-1.5"><Copy className="h-4 w-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs font-medium text-navy-800">New link for
              <select value={name} onChange={(e) => setName(e.target.value)} className="input-field !w-40">{PRESETS.map((p) => <option key={p}>{p}</option>)}</select>
            </label>
            {name === 'Other' && <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={80} placeholder="Name (e.g. Stripe)" className="input-field !w-44" aria-label="Integration name" />}
            <button type="button" onClick={add} className="btn-primary"><Plus className="h-4 w-4" /> Create link</button>
          </div>
          <p className="mt-2 text-xs text-ivory-700">Keep links private: anyone with one can post here. Turn a link off any time.</p>
        </div>

        <div>
          <p className="text-sm font-semibold text-navy-800">How to send</p>
          <div role="tablist" className="mt-2 inline-flex rounded-lg bg-ivory-100 p-1">
            {PRESETS.map((p) => (
              <button key={p} role="tab" aria-selected={guide === p} type="button" onClick={() => setGuide(p)} className={cn('rounded-md px-3 py-1 text-xs font-semibold', guide === p ? 'bg-white text-navy-800 shadow-sm' : 'text-ivory-700')}>{p === 'Other' ? 'Any app' : p}</button>
            ))}
          </div>
          <div className="mt-3 min-w-0 overflow-hidden rounded-lg bg-ivory-50 p-3 text-sm text-navy-800">
            {guide === 'Zapier' && (
              <ol className="list-decimal space-y-1 pl-5">
                <li>In your Zap, add the action <strong>Webhooks by Zapier</strong> → <strong>POST</strong>.</li>
                <li><strong>URL</strong>: paste the Zapier link above. <strong>Payload Type</strong>: json.</li>
                <li><strong>Data</strong>: add <code>text</code> with the message (map fields from earlier steps), and optionally <code>username</code>.</li>
                <li>Test the step: the message appears in this channel.</li>
              </ol>
            )}
            {guide === 'Airtable' && (
              <ol className="min-w-0 list-decimal space-y-1 pl-5 [&>li]:min-w-0">
                <li>In your base: <strong>Automations</strong> → a trigger (e.g. "When a record is created") → action <strong>Run a script</strong>.</li>
                <li>Add an input variable <code>name</code> mapped to a field, then paste:</li>
                <li className="list-none"><CodeBlock code={`const { name } = input.config();\nawait fetch("${sample}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ text: \`New record: \${name}\`, username: "Airtable" }),\n});`} onCopy={copy} /></li>
              </ol>
            )}
            {guide === 'Modal' && (
              <>
                <p>From your Modal function (Python):</p>
                <CodeBlock code={`import requests\n\nrequests.post(\n    "${sample}",\n    json={"text": "Job finished: 42 files processed", "username": "Modal"},\n    timeout=10,\n)`} onCopy={copy} />
              </>
            )}
            {guide === 'Other' && (
              <>
                <p>Send a POST with JSON (or form fields, or plain text):</p>
                <CodeBlock code={`curl -X POST "${sample}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"text": "Hello from my app", "username": "My app"}'`} onCopy={copy} />
                <p className="mt-2 text-xs text-ivory-700">Also accepted: <code>message</code>/<code>content</code> for the text, <code>title</code> for a bold heading. JSON without a text field is shown as one line per field. Up to 30 posts a minute per link.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CodeBlock({ code, onCopy }: { code: string; onCopy: (t: string) => void }) {
  return (
    <div className="relative mt-2 min-w-0 max-w-full">
      <pre className="max-w-full overflow-x-auto rounded-lg bg-navy-900 p-3 pr-12 text-[12px] leading-relaxed text-ivory-100"><code>{code}</code></pre>
      <button type="button" onClick={() => onCopy(code)} aria-label="Copy code" className="absolute right-2 top-2 rounded-md bg-white/10 p-1.5 text-white hover:bg-white/20"><Copy className="h-4 w-4" /></button>
    </div>
  );
}

function EmailReplies({ onBack }: { onBack: () => void }) {
  const { workspace } = useAuth();
  const [, navigate] = useRouter();
  const [rows, setRows] = useState<EmailReply[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (workspace) listEmailReplies(workspace.id).then((r) => { setRows(r.data); setError(r.error); }); }, [workspace]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-ivory-200 px-4 py-3">
        <button type="button" onClick={onBack} aria-label="Back to conversations" className="rounded-md p-1 text-navy-700 hover:bg-ivory-100 sm:hidden"><ArrowLeft className="h-5 w-5" /></button>
        <div>
          <h2 className="text-base font-semibold text-navy-800">Email replies</h2>
          <p className="text-xs text-ivory-700">Replies to emails sent from SYNAPSE, brought back from your connected Gmail every few minutes.</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows === null ? <LoadingSpinner className="m-6 h-6 w-6 text-ivory-600" /> : error ? <p className="p-6 text-sm text-burgundy-600">{error}</p> : rows.length === 0 ? (
          <EmptyState icon={<Mail className="h-6 w-6" />} title="No replies yet" description="When someone answers an email you sent from SYNAPSE, it shows up here and on their contact. Gmail accounts connected before this update need to be reconnected once (Settings → Email) to allow reading replies." />
        ) : (
          <ul className="divide-y divide-ivory-200">
            {rows.map((r) => {
              const who = [r.contacts?.first_name, r.contacts?.last_name].filter(Boolean).join(' ') || r.from_name || r.from_email || 'Unknown sender';
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => r.contact_id && navigate(`/contacts/${r.contact_id}`)} disabled={!r.contact_id} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-ivory-50 disabled:cursor-default">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-700"><Mail className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2"><span className="truncate text-sm font-semibold text-navy-800">{who}</span><time className="ml-auto shrink-0 text-xs text-ivory-700">{new Date(r.sent_at ?? r.created_at).toLocaleString()}</time></span>
                      {r.subject && <span className="block truncate text-sm text-navy-700">{r.subject}</span>}
                      <span className="line-clamp-2 text-sm text-ivory-700">{r.body}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
