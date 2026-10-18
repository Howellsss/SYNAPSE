import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowLeft, AtSign, Bell, Bold, Check, ChevronDown, MoreVertical, PanelRight, Send, Code, Copy, ExternalLink, FileText, Hash, House, Italic, Link2, List, ListOrdered, Lock, Mail,
  MessageCircle, MessageSquare, CornerUpLeft, Pencil, Plus, Plug, Quote, Search, Smile, SquareCode, SquarePen, Star, Strikethrough,
  Trash2, UserPlus, X,
} from 'lucide-react';
import { HowellsLogo } from '@/components/layout/Sidebar';
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

type Selection = { kind: 'channel'; id: string } | { kind: 'email' } | { kind: 'threads' } | { kind: 'channels' } | null;
/** The rail on the far left: it picks what the list beside it shows. */
type Rail = 'home' | 'dms' | 'activity' | 'files';

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

/** Message text without the formatting marks, for one-line previews. */
const plain = (body: string) => body.replace(/[*_~`>]/g, '').split('\n')[0];
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** A count on a list row: quiet grey, or gold when someone needs you. */
function Count({ n, loud }: { n: number; loud?: boolean }) {
  return <span className={cn('min-w-[20px] shrink-0 rounded-full px-1.5 text-center text-[11px] font-extrabold leading-[18px]', loud ? 'bg-gold-400 text-navy-900' : 'bg-white/[0.16] text-white')}>{n > 99 ? '99+' : n}</span>;
}

const STARRED_KEY = 'synapse.starredChannels';
const GLANCE_KEY = 'synapse.atAGlance';
const loadStarred = (): string[] => { try { return JSON.parse(localStorage.getItem(STARRED_KEY) ?? '[]') as string[]; } catch { return []; } };

/**
 * Conversations: channels, direct messages, activity and email replies in one place, with every
 * action written out (no hidden menus or icon-only buttons). The list on the left holds
 * everything: what needs you (Activity), your channels, the people you talk to, and replies from
 * outside. Inside a channel the tabs are Channels · Messages · Threads · Files & links; replying to
 * one message splits the screen, with the replies beside the channel.
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
  const [find, setFind] = useState('');
  const [modal, setModal] = useState<'channel' | 'dm' | null>(null);
  const [starred, setStarred] = useState<string[]>(loadStarred);
  const [openThread, setOpenThread] = useState<string | null>(null);
  // A message to scroll to and light up (picked from Activity or Files).
  const [focus, setFocus] = useState<string | null>(null);
  const [railOn, setRail] = useState<Rail>('home');
  const [actFilter, setActFilter] = useState<'all' | 'mentions' | 'replies'>('all');
  const [folded, setFolded] = useState<Set<string>>(new Set());
  // The channel the tabs go back to from the Channels tab.
  const [lastChannel, setLastChannel] = useState<string | null>(null);
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
  const named = mine.filter((c) => c.kind === 'channel')
    .sort((a, b) => Number(starred.includes(b.id)) - Number(starred.includes(a.id)) || (a.name ?? '').localeCompare(b.name ?? ''));
  const dms = mine.filter((c) => c.kind === 'dm').sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at));
  const joinable = channels.filter((c) => c.kind === 'channel' && !c.is_private && !c.members.some((m) => m.user_id === me));
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
  useEffect(() => { if (!sel && !loading && named[0] && window.innerWidth >= 640) setSel({ kind: 'channel', id: named[0].id }); }, [sel, loading, named]);
  useEffect(() => { if (sel?.kind === 'channel') setLastChannel(sel.id); }, [sel]);

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

  const open = (id: string, thread: string | null = null, focusOn: string | null = null) => { setSel({ kind: 'channel', id }); setOpenThread(thread); setFocus(focusOn); setUnread((u) => ({ ...u, [id]: 0 })); };
  const title = (c: Channel) => (c.kind === 'dm' ? dmPeople(c, me).map((id) => (byId.get(id) ? memberName(byId.get(id)!) : 'Someone')).join(', ') || 'Just you' : c.name ?? '');
  const toggleStar = (id: string) => setStarred((s) => {
    const next = s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
    try { localStorage.setItem(STARRED_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  const join = async (c: Channel) => {
    const { error: err } = await joinChannel(c, me);
    if (err) { toast(err, 'error'); return; }
    await load();
    open(c.id);
  };
  const q = find.trim().toLowerCase();
  const match = (c: Channel) => !q || title(c).toLowerCase().includes(q);

  if (loading) return <div className="flex h-[60vh] items-center justify-center"><LoadingSpinner className="h-8 w-8 text-ivory-600" /></div>;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const isActive = (c: Channel) => sel?.kind === 'channel' && sel.id === c.id;
  const channelTabs = { channels: named.length + joinable.length, onChannels: () => setSel({ kind: 'channels' }) };
  const back = lastChannel && byChannel.get(lastChannel) ? lastChannel : named[0]?.id ?? null;
  const where = (c: Channel | undefined) => (c ? (c.kind === 'dm' ? title(c) : `# ${c.name}`) : 'a conversation');
  const sender = (m: ChatMessage) => {
    const p = m.user_id ? byId.get(m.user_id) : undefined;
    return m.source === 'webhook' ? m.sender_name ?? 'App' : p ? memberName(p) : 'Someone';
  };
  const dmOther = (c: Channel) => dmPeople(c, me).map((id) => byId.get(id)).find((p): p is DirectoryMember => !!p);
  const face = (p: DirectoryMember | undefined, size: string) => p
    ? <Avatar firstName={p.first_name} lastName={p.last_name} src={p.avatar_url} size="sm" className={cn('shrink-0 !rounded-[7px]', size)} />
    : <span className={cn('flex shrink-0 items-center justify-center rounded-[7px] bg-white/10', size)}><AtSign className="h-3.5 w-3.5" /></span>;
  // Channels where someone needs you (a mention) show their count in gold, the rest in quiet grey.
  const mentioned = new Set(activity.map((m) => m.channel_id));
  const channelUnread = named.reduce((n, c) => n + (unread[c.id] ?? 0), 0);
  const dmUnread = dms.reduce((n, c) => n + (unread[c.id] ?? 0), 0);
  const threadsAll = recent.filter((m) => !m.parent_id && m.reply_count > 0 && !m.deleted_at && byChannel.has(m.channel_id))
    .sort((x, y) => (y.last_reply_at ?? y.created_at).localeCompare(x.last_reply_at ?? x.created_at));
  const allLinks = linksIn(recent.filter((m) => byChannel.has(m.channel_id)));
  const shownActivity = actFilter === 'mentions' ? activity.filter((m) => !m.parent_id) : actFilter === 'replies' ? activity.filter((m) => m.parent_id) : activity;
  const toggle = (k: string) => setFolded((f) => { const n = new Set(f); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const rowCls = (on: boolean, bold = false) => cn('flex h-8 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[15px] transition',
    on ? 'bg-gradient-to-r from-gold-400/25 to-gold-400/[0.08] font-bold text-white shadow-[inset_0_0_0_1px_rgba(228,169,60,0.3)]'
      : bold ? 'font-bold text-white hover:bg-white/[0.07]' : 'text-white/70 hover:bg-white/[0.07] hover:text-white');
  const cardCls = (on: boolean) => cn('flex w-full gap-2.5 rounded-xl p-2.5 text-left transition',
    on ? 'bg-gradient-to-r from-gold-400/25 to-gold-400/[0.08] shadow-[inset_0_0_0_1px_rgba(228,169,60,0.3)]' : 'hover:bg-white/[0.07]');
  const section = (key: string, label: string, add?: { label: string; onClick: () => void }) => (
    <div className="mt-3 flex h-7 items-center gap-1.5 px-2.5 text-[13px] font-semibold text-white/50">
      <button type="button" onClick={() => toggle(key)} aria-expanded={!folded.has(key)} className="flex flex-1 items-center gap-1.5 text-left hover:text-white/80">
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', folded.has(key) && '-rotate-90')} /> <h2>{label}</h2>
      </button>
      {add && <button type="button" onClick={add.onClick} aria-label={add.label} title={add.label} className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/10 hover:text-white"><Plus className="h-3.5 w-3.5" /></button>}
    </div>
  );
  const channelRow = (c: Channel) => (
    <button key={c.id} type="button" onClick={() => open(c.id)} aria-current={isActive(c) ? 'page' : undefined} className={rowCls(isActive(c), unread[c.id] > 0)}>
      <span className="flex w-[18px] justify-center opacity-85">{c.is_private ? <Lock className="h-3.5 w-3.5" aria-label="Private" /> : <Hash className="h-4 w-4" />}</span>
      <span className="min-w-0 flex-1 truncate">{c.name}</span>
      {unread[c.id] > 0 && !isActive(c) && <Count n={unread[c.id]} loud={mentioned.has(c.id)} />}
    </button>
  );
  const search = (placeholder: string) => (
    <label className="mx-0.5 mb-3 flex h-[34px] shrink-0 items-center gap-2 rounded-[10px] bg-white/[0.08] px-2.5 text-sm text-white/55 focus-within:bg-white/[0.12]">
      <Search className="h-[15px] w-[15px] shrink-0" />
      <span className="sr-only">{placeholder}</span>
      <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 border-0 bg-transparent text-white outline-none placeholder:text-white/55" />
      {find && <button type="button" onClick={() => setFind('')} aria-label="Clear search" className="rounded p-0.5 hover:bg-white/10"><X className="h-4 w-4" /></button>}
    </label>
  );
  const listHead = (label: ReactNode, heading = true) => (
    <div className="flex items-center gap-2 px-1.5 pb-3 pt-0.5">
      {heading ? <h2 className="flex-1 truncate text-[19px] font-extrabold tracking-[-0.02em] text-white">{label}</h2> : <span className="flex-1 truncate text-[19px] font-extrabold tracking-[-0.02em] text-white">{label}</span>}
      <button type="button" onClick={() => setModal('dm')} aria-label="Message someone" title="New message" className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white/10 text-white hover:bg-white/[0.16]"><SquarePen className="h-4 w-4" /></button>
    </div>
  );
  const segment = <T extends string>(value: T, options: { v: T; label: string }[], onPick: (v: T) => void) => (
    <div role="tablist" aria-label="Show" className="mx-0.5 mb-3 flex rounded-[10px] bg-white/[0.08] p-0.5">
      {options.map((o) => (
        <button key={o.v} type="button" role="tab" aria-selected={value === o.v} onClick={() => onPick(o.v)}
          className={cn('h-8 flex-1 rounded-lg text-[13px] transition', value === o.v ? 'bg-white/[0.18] font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]' : 'font-medium text-white/65 hover:text-white')}>{o.label}</button>
      ))}
    </div>
  );

  const rail: { key: Rail; label: string; icon: ReactNode; count: number }[] = [
    { key: 'home', label: 'Home', icon: <House className="h-5 w-5" />, count: channelUnread },
    { key: 'dms', label: 'DMs', icon: <MessageCircle className="h-5 w-5" />, count: dmUnread },
    { key: 'activity', label: 'Activity', icon: <Bell className="h-5 w-5" />, count: activity.length },
    { key: 'files', label: 'Files', icon: <FileText className="h-5 w-5" />, count: 0 },
  ];

  return (
    // The whole screen above the feature dock (and below the top bar when the menu is open).
    <div className="-mx-4 -mt-5 -mb-[calc(var(--dock-h,0px)+24px)] flex h-[calc(100dvh-var(--dock-h,0px)-var(--top-h,0px))] min-h-[480px] overflow-hidden bg-[radial-gradient(120%_80%_at_0%_0%,#13254A_0%,#091530_45%,#050C1E_100%)] lg:-mx-6 lg:-mt-6">
      <div className={cn('min-w-0 shrink-0 text-white sm:flex', sel ? 'hidden' : 'flex w-full sm:w-auto')}>
        {/* The rail: where you are. Home, DMs, Activity, Files. */}
        <nav aria-label="Conversations" className="flex w-[68px] shrink-0 flex-col items-center gap-4 overflow-y-auto py-4 sm:w-[76px]">
          <span title="SYNAPSE" className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#13254A] to-[#0B1733] shadow-[inset_0_0_0_1px_rgba(228,169,60,0.35),0_6px_18px_rgba(0,0,0,0.35)]">
            <HowellsLogo className="h-[22px] w-[22px]" />
          </span>
          <span className="h-1" />
          {rail.map((r) => (
            <button key={r.key} type="button" onClick={() => { setRail(r.key); setFind(''); }} aria-pressed={railOn === r.key}
              className={cn('flex flex-col items-center gap-1 text-[11px]', railOn === r.key ? 'font-bold text-white' : 'font-medium text-white/70 hover:text-white')}>
              <span className={cn('relative flex h-10 w-10 items-center justify-center rounded-xl transition', railOn === r.key ? 'bg-white/[0.14] text-gold-400 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]' : 'text-white/80 hover:bg-white/[0.08]')}>
                {r.icon}
                {r.count > 0 && <span className="absolute -right-1.5 -top-1 min-w-[18px] rounded-full border-2 border-[#091530] bg-gold-400 px-1 text-center text-[10px] font-extrabold leading-[14px] text-navy-900">{r.count > 99 ? '99+' : r.count}</span>}
              </span>
              {r.label}
            </button>
          ))}
          <span className="flex-1" />
          <button type="button" onClick={() => setModal('channel')} aria-label="New channel" title="New channel" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/[0.16]"><Plus className="h-[18px] w-[18px]" /></button>
          <Avatar firstName={profile?.first_name ?? null} lastName={profile?.last_name ?? null} src={profile?.avatar_url ?? null} size="sm" className="!h-9 !w-9 shrink-0 !rounded-[10px]" />
        </nav>

        {/* The list: changes with the rail. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-2.5 py-4 sm:w-[280px] sm:flex-none">
          {railOn === 'home' && (
            <>
              {listHead(<span className="inline-flex items-center gap-1.5">{workspace?.name ?? 'Your company'}</span>, false)}
              {search('Find a channel or person')}
              <button type="button" onClick={() => setSel({ kind: 'threads' })} aria-current={sel?.kind === 'threads' ? 'page' : undefined} className={rowCls(sel?.kind === 'threads')}>
                <span className="flex w-[18px] justify-center"><CornerUpLeft className="h-4 w-4" /></span><span className="flex-1">Threads</span>
                {threadsAll.length > 0 && <Count n={threadsAll.length} />}
              </button>
              <button type="button" onClick={() => setSel({ kind: 'email' })} aria-current={sel?.kind === 'email' ? 'page' : undefined} className={rowCls(sel?.kind === 'email')}>
                <span className="flex w-[18px] justify-center"><Mail className="h-4 w-4" /></span><span className="flex-1">Email replies</span>
              </button>
              {named.some((c) => starred.includes(c.id)) && (
                <>
                  {section('starred', 'Starred')}
                  {!folded.has('starred') && named.filter((c) => starred.includes(c.id) && match(c)).map(channelRow)}
                </>
              )}
              {section('channels', 'Channels', { label: 'New channel', onClick: () => setModal('channel') })}
              {!folded.has('channels') && (
                <>
                  {named.filter((c) => !starred.includes(c.id) && match(c)).map(channelRow)}
                  {named.length === 0 && <p className="px-2.5 py-1.5 text-xs text-white/55">No channels yet. Create one for a team or a topic.</p>}
                  <button type="button" onClick={() => setSel({ kind: 'channels' })} aria-current={sel?.kind === 'channels' ? 'page' : undefined} className={rowCls(sel?.kind === 'channels')}>
                    <span className="flex w-[18px] justify-center"><List className="h-4 w-4" /></span><span className="flex-1 text-sm">Browse all channels · {named.length + joinable.length}</span>
                  </button>
                </>
              )}
              {section('people', 'People', { label: 'Message someone', onClick: () => setModal('dm') })}
              {!folded.has('people') && (
                <>
                  {dms.filter(match).slice(0, 8).map((c) => (
                    <button key={c.id} type="button" onClick={() => open(c.id)} aria-current={isActive(c) ? 'page' : undefined} className={rowCls(isActive(c), unread[c.id] > 0)}>
                      {face(dmOther(c), '!h-[22px] !w-[22px] !text-[9px]')}
                      <span className="min-w-0 flex-1 truncate">{title(c)}</span>
                      {unread[c.id] > 0 && !isActive(c) && <Count n={unread[c.id]} loud />}
                    </button>
                  ))}
                  {dms.length === 0 && <p className="px-2.5 py-1.5 text-xs text-white/55">Message anyone in your team.</p>}
                </>
              )}
            </>
          )}

          {railOn === 'dms' && (
            <>
              {listHead('Direct messages')}
              {search('Find a person')}
              <div className="flex flex-col gap-0.5">
                {dms.filter(match).map((c) => {
                  const last = latest.get(c.id);
                  const u = unread[c.id] > 0 && !isActive(c);
                  return (
                    <button key={c.id} type="button" onClick={() => open(c.id)} aria-current={isActive(c) ? 'page' : undefined} className={cardCls(isActive(c))}>
                      {face(dmOther(c), '!h-[38px] !w-[38px] !rounded-[11px] !text-[13px]')}
                      <span className="min-w-0 flex-1">
                        <span className={cn('flex gap-2 text-[15px] text-white', u ? 'font-bold' : 'font-medium')}><span className="min-w-0 flex-1 truncate">{title(c)}</span>{last && <span className="shrink-0 text-xs font-normal text-white/50">{ago(last.created_at)}</span>}</span>
                        <span className={cn('block truncate text-[13px]', u ? 'text-white/85' : 'text-white/55')}>{last ? `${last.user_id === me ? 'You: ' : ''}${plain(last.body)}` : 'No messages yet'}</span>
                      </span>
                      {u && <Count n={unread[c.id]} loud />}
                    </button>
                  );
                })}
                {dms.length === 0 && <p className="px-2.5 py-2 text-sm text-white/60">No direct messages yet. Use the pencil above to message anyone in your team.</p>}
              </div>
            </>
          )}

          {railOn === 'activity' && (
            <>
              {listHead('Activity')}
              {segment(actFilter, [{ v: 'all', label: 'All' }, { v: 'mentions', label: 'Mentions' }, { v: 'replies', label: 'Replies' }], setActFilter)}
              <div className="flex flex-col gap-0.5">
                {shownActivity.slice(0, 80).map((m) => {
                  const p = m.user_id ? byId.get(m.user_id) : undefined;
                  const on = focus === m.id || (!!m.parent_id && openThread === m.parent_id && sel?.kind === 'channel');
                  return (
                    <button key={m.id} type="button" onClick={() => open(m.channel_id, m.parent_id ?? null, m.parent_id ? null : m.id)} className={cardCls(on)}>
                      {face(p, '!h-[34px] !w-[34px] !rounded-[10px] !text-[12px]')}
                      <span className="min-w-0 flex-1">
                        <span className="flex gap-2 text-sm"><strong className="min-w-0 flex-1 truncate font-bold text-white">{sender(m)}</strong><span className="shrink-0 text-xs text-white/50">{ago(m.created_at)}</span></span>
                        <span className="block truncate text-xs text-white/60">{m.parent_id ? 'Replied to you' : 'Mentioned you'} · {where(byChannel.get(m.channel_id))}</span>
                        <span className="mt-0.5 block truncate text-sm text-white/[0.88]">{plain(m.body)}</span>
                      </span>
                    </button>
                  );
                })}
                {shownActivity.length === 0 && <p className="px-2.5 py-2 text-sm text-white/60">Nothing here yet. When someone @mentions you or replies to your message, it shows here.</p>}
              </div>
            </>
          )}

          {railOn === 'files' && (
            <>
              {listHead('Files & links')}
              <div className="flex flex-col gap-0.5">
                {allLinks.slice(0, 80).map((l) => {
                  const on = focus === l.message.id;
                  return (
                    <div key={l.url + l.message.id} className={cn(cardCls(on), 'items-center')}>
                      <button type="button" onClick={() => open(l.message.channel_id, l.message.parent_id ?? null, l.message.parent_id ? null : l.message.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                        <span className="flex h-[38px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-[#24375E] text-[9px] font-extrabold text-white">LINK</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-white">{hostOf(l.url)}</span>
                          <span className="block truncate text-xs text-white/55">{sender(l.message)} · {where(byChannel.get(l.message.channel_id))}</span>
                        </span>
                      </button>
                      <a href={l.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${hostOf(l.url)}`} title="Open" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"><ExternalLink className="h-4 w-4" /></a>
                    </div>
                  );
                })}
                {allLinks.length === 0 && <p className="px-2.5 py-2 text-sm text-white/60">Links shared in any channel collect here by themselves, newest first.</p>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* The white card: whatever you pick opens here. */}
      <section className={cn('min-w-0 flex-1 flex-col overflow-hidden bg-white sm:my-2 sm:mr-2 sm:rounded-2xl sm:shadow-[0_20px_60px_rgba(0,0,0,0.35),0_0_0_1px_rgba(255,255,255,0.06)]', sel ? 'flex' : 'hidden sm:flex')}>
        {sel?.kind === 'email' ? (
          <EmailReplies onBack={() => setSel(null)} />
        ) : sel?.kind === 'threads' ? (
          <ThreadsView items={threadsAll} byId={byId} byChannel={byChannel} where={where} onOpen={(m) => open(m.channel_id, m.id)} onBack={() => setSel(null)} />
        ) : sel?.kind === 'channels' ? (
          <ChannelsDirectory
            mine={named} joinable={joinable} unread={unread} latest={latest} starred={starred} byId={byId}
            onOpen={(c) => open(c.id)} onJoin={join} onNew={() => setModal('channel')} onBack={() => setSel(null)}
            backTo={back ? () => open(back) : null}
          />
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
            focusId={focus}
            canManage={current.kind === 'channel' && (canManageTeam || current.members.some((m) => m.user_id === me && m.role === 'owner'))}
            tabs={channelTabs}
            onBack={() => setSel(null)}
            onChanged={load}
            onLeft={() => { setSel(null); load(); }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState icon={<MessageSquare className="h-6 w-6" />} title="No conversation open" description="Pick a channel or a person on the left, or start something new." />
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
          title="Message someone"
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
    </div>
  );
}

/** The tab row inside a conversation: Channels (every channel) beside this one's Messages, Threads, Files & links. */
type ChannelTab = 'channels' | 'messages' | 'threads' | 'files';
function Tabs({ active, counts, onPick, showChannels = true }: { active: ChannelTab; counts: Partial<Record<ChannelTab, number>>; onPick: (t: ChannelTab) => void; showChannels?: boolean }) {
  const label: Record<ChannelTab, string> = { channels: 'Channels', messages: 'Messages', threads: 'Threads', files: 'Files & links' };
  const icon: Record<ChannelTab, ReactNode> = {
    messages: <MessageCircle className="h-[15px] w-[15px]" />, threads: <CornerUpLeft className="h-[15px] w-[15px]" />,
    files: <Link2 className="h-[15px] w-[15px]" />, channels: <Hash className="h-[15px] w-[15px]" />,
  };
  const tabs: ChannelTab[] = showChannels ? ['messages', 'threads', 'files', 'channels'] : ['messages', 'threads', 'files'];
  return (
    <div role="tablist" aria-label="In this conversation" className="flex max-w-full gap-0.5 overflow-x-auto">
      {tabs.map((t) => (
        <button key={t} type="button" role="tab" aria-selected={active === t} onClick={() => onPick(t)}
          className={cn('inline-flex h-[38px] shrink-0 items-center gap-1.5 px-2.5 text-sm transition', active === t ? 'font-bold text-navy-900 shadow-[inset_0_-2px_0_#E4A93C]' : 'font-medium text-[#5A6476] hover:text-navy-900')}>
          {icon[t]}{label[t]}{counts[t] ? <span className="font-medium text-[#8A93A5]">{counts[t]}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** The Channels tab: your channels as cards, and the ones you can join. */
function ChannelsDirectory({ mine, joinable, unread, latest, starred, byId, onOpen, onJoin, onNew, onBack, backTo }: {
  mine: Channel[]; joinable: Channel[]; unread: Record<string, number>; latest: Map<string, ChatMessage>; starred: string[]; byId: Map<string, DirectoryMember>;
  onOpen: (c: Channel) => void; onJoin: (c: Channel) => Promise<void>; onNew: () => void; onBack: () => void; backTo: (() => void) | null;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const hit = (c: Channel) => !needle || `${c.name} ${c.description ?? ''}`.toLowerCase().includes(needle);
  const lastLine = (c: Channel) => {
    const m = latest.get(c.id);
    if (!m) return 'No messages yet';
    const p = m.user_id ? byId.get(m.user_id) : undefined;
    const who = m.source === 'webhook' ? m.sender_name ?? 'App' : p ? p.first_name ?? memberName(p) : 'Someone';
    return `${who}: ${m.body.split('\n')[0]}`;
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 px-4 pt-4 sm:px-6">
        <button type="button" onClick={onBack} aria-label="Back to conversations" className="rounded-md p-1 text-navy-700 hover:bg-ivory-100 sm:hidden"><ArrowLeft className="h-5 w-5" /></button>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy-900">Channels</h1>
      </header>
      <div className="border-b border-[#E8EBF0] px-3 pt-1 sm:px-4"><Tabs active="channels" counts={{ channels: mine.length + joinable.length }} onPick={(t) => { if (t !== 'channels') backTo?.(); }} /></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex h-11 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-ivory-300 px-3">
            <Search className="h-4 w-4 text-ivory-600" />
            <span className="sr-only">Find a channel</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a channel" className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-navy-900 outline-none" />
          </label>
          <button type="button" onClick={onNew} className="h-11 rounded-xl bg-gold-400 px-4 text-sm font-bold text-navy-900 hover:bg-gold-300">+ New channel</button>
        </div>

        <h2 className="mt-6 text-xs font-bold uppercase tracking-[0.1em] text-ivory-700">Your channels · {mine.length}</h2>
        {mine.length === 0 && <p className="mt-2 text-sm text-ivory-700">You're not in any channel yet. Join one below, or create one.</p>}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {mine.filter(hit).map((c) => (
            <button key={c.id} type="button" onClick={() => onOpen(c)} className="flex flex-col gap-1.5 rounded-2xl border border-ivory-300 bg-white p-4 text-left transition hover:border-gold-400 hover:shadow-sm">
              <span className="flex items-center gap-2">
                {starred.includes(c.id) && <Star className="h-4 w-4 fill-gold-400 text-gold-500" aria-label="Starred" />}
                {c.is_private ? <Lock className="h-4 w-4 text-navy-700" aria-label="Private" /> : <Hash className="h-4 w-4 text-navy-700" />}
                <span className="min-w-0 flex-1 truncate text-base font-extrabold text-navy-900">{c.name}</span>
                {unread[c.id] > 0 && <span className="rounded-full bg-gold-400 px-2 text-xs font-extrabold leading-6 text-navy-900">{unread[c.id]} new</span>}
              </span>
              <span className="text-sm text-navy-700">{c.description || (c.is_private ? 'Private channel' : 'Public channel')}</span>
              <span className="truncate text-[13px] text-ivory-700">{lastLine(c)}</span>
              <span className="text-xs font-semibold text-ivory-700">{c.members.length} {c.members.length === 1 ? 'member' : 'members'}</span>
            </button>
          ))}
        </div>

        <h2 className="mt-8 text-xs font-bold uppercase tracking-[0.1em] text-ivory-700">You can join · {joinable.length}</h2>
        {joinable.length === 0 && <p className="mt-2 text-sm text-ivory-700">You're in every public channel.</p>}
        <ul className="mt-3 space-y-2.5">
          {joinable.filter(hit).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-ivory-300 px-4 py-3">
              <span className="min-w-[200px] flex-1">
                <span className="block text-[15px] font-bold text-navy-900"># {c.name}</span>
                <span className="block text-[13px] text-ivory-700">{c.description ? `${c.description} · ` : ''}{c.members.length} {c.members.length === 1 ? 'member' : 'members'}</span>
              </span>
              <button type="button" onClick={() => onOpen(c)} className="h-10 rounded-xl border border-ivory-300 px-3.5 text-sm font-semibold text-navy-900 hover:bg-ivory-50">Have a look</button>
              <button type="button" onClick={() => void onJoin(c)} className="h-10 rounded-xl bg-navy-900 px-4 text-sm font-bold text-white hover:bg-navy-800">Join</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Every thread across your channels, newest reply first. */
function ThreadsView({ items, byId, byChannel, where, onOpen, onBack }: {
  items: ChatMessage[]; byId: Map<string, DirectoryMember>; byChannel: Map<string, Channel>; where: (c: Channel | undefined) => string;
  onOpen: (m: ChatMessage) => void; onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-[58px] shrink-0 items-center gap-2 border-b border-[#E8EBF0] px-5">
        <button type="button" onClick={onBack} aria-label="Back to conversations" className="rounded-md p-1 text-navy-700 hover:bg-ivory-100 sm:hidden"><ArrowLeft className="h-5 w-5" /></button>
        <h1 className="text-[19px] font-extrabold tracking-[-0.02em] text-navy-900">Threads</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {items.length === 0 ? <p className="py-10 text-center text-sm text-ivory-700">No threads yet. Point at any message and choose Reply to start one.</p> : (
          <ul className="mx-auto flex max-w-3xl flex-col gap-2.5">
            {items.map((m) => {
              const p = m.user_id ? byId.get(m.user_id) : undefined;
              const name = m.source === 'webhook' ? m.sender_name ?? 'App' : p ? memberName(p) : 'Someone';
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => onOpen(m)} className="flex w-full gap-3 rounded-2xl bg-white p-4 text-left shadow-[0_1px_3px_rgba(9,21,48,0.06),0_0_0_1px_#E8EBF0] transition hover:shadow-[0_6px_20px_rgba(9,21,48,0.1),0_0_0_1px_#E4A93C]">
                    <Avatar firstName={p?.first_name ?? null} lastName={p?.last_name ?? null} src={p?.avatar_url ?? null} size="sm" className="!h-9 !w-9 shrink-0 !rounded-[10px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-ivory-700"><strong className="text-navy-900">{name}</strong> · {where(byChannel.get(m.channel_id))}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[15px] text-navy-900">{plain(m.body)}</span>
                      <span className="mt-1 block text-[13px]"><strong className="text-[#0B63C4]">{m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}</strong>{m.last_reply_at && <span className="text-ivory-700"> · last {ago(m.last_reply_at)}</span>}</span>
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

function ChannelView({ channel, title, me, people, byId, starred, onStar, initialThread, focusId, canManage, tabs, onBack, onChanged, onLeft }: {
  channel: Channel; title: string; me: string; people: DirectoryMember[]; byId: Map<string, DirectoryMember>; starred: boolean; onStar: () => void;
  initialThread: string | null; focusId: string | null; canManage: boolean; tabs: { channels: number; onChannels: () => void }; onBack: () => void; onChanged: () => void; onLeft: () => void;
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [thread, setThread] = useState<ChatMessage | null>(null);
  const [panel, setPanel] = useState<'add' | 'integrations' | null>(null);
  const [tab, setTab] = useState<'messages' | 'threads' | 'files'>('messages');
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState(false);
  const [glance, setGlance] = useState(() => { try { return localStorage.getItem(GLANCE_KEY) === '1'; } catch { return false; } });
  const listRef = useRef<HTMLDivElement>(null);
  const member = channel.members.some((m) => m.user_id === me);
  const showGlance = (on: boolean) => { setGlance(on); try { localStorage.setItem(GLANCE_KEY, on ? '1' : '0'); } catch { /* private mode */ } };

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

  // Opened from Activity or Files on one message: bring it into view.
  useEffect(() => {
    if (!focusId || loading) return;
    requestAnimationFrame(() => document.getElementById(`msg-${focusId}`)?.scrollIntoView({ block: 'center' }));
  }, [focusId, loading]);

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
  const threads = useMemo(() => messages.filter((m) => m.reply_count > 0 && !m.deleted_at)
    .sort((x, y) => (y.last_reply_at ?? y.created_at).localeCompare(x.last_reply_at ?? x.created_at)), [messages]);
  const placeholder = channel.kind === 'dm' ? `Message ${title}` : `Message #${channel.name}`;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-10 border-b border-[#E8EBF0] bg-white/90 backdrop-blur-xl backdrop-saturate-150">
          <div className="flex min-h-[58px] items-center gap-2 px-3 sm:px-5">
            <button type="button" onClick={onBack} aria-label="Back to conversations" className="rounded-md p-1 text-navy-700 hover:bg-ivory-100 sm:hidden"><ArrowLeft className="h-5 w-5" /></button>
            {channel.kind === 'channel' && (
              <button type="button" onClick={onStar} aria-pressed={starred} aria-label={starred ? 'Starred: click to unstar' : 'Star: keeps it at the top of your list'} title={starred ? 'Unstar' : 'Star (keeps it at the top of your list)'}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8A93A5] hover:bg-[#F0F2F6]">
                <Star className={cn('h-[18px] w-[18px]', starred && 'fill-gold-400 text-gold-400')} />
              </button>
            )}
            <h1 className="flex min-w-0 shrink items-center gap-1 text-[19px] font-extrabold tracking-[-0.02em] text-navy-900">
              {channel.kind === 'channel' ? (channel.is_private ? <Lock className="h-4 w-4 shrink-0" aria-label="Private" /> : <Hash className="h-[18px] w-[18px] shrink-0" />) : null}
              <span className="truncate">{title}</span>
            </h1>
            <span className="hidden min-w-0 flex-1 truncate text-[13px] text-[#6B7486] md:block">{channel.kind === 'dm' ? 'Direct message' : channel.description ?? (channel.is_private ? 'Private channel' : 'Public channel')}</span>
            <span className="flex-1 md:hidden" />
            <span title={`${channel.members.length} ${channel.members.length === 1 ? 'member' : 'members'}`} className="hidden h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-[#F0F2F6] pl-1 pr-2.5 text-[13px] font-semibold text-[#3A4357] sm:inline-flex">
              <span className="flex">
                {channel.members.slice(0, 3).map((mb, i) => {
                  const p = byId.get(mb.user_id);
                  return <Avatar key={mb.user_id} firstName={p?.first_name ?? null} lastName={p?.last_name ?? null} src={p?.avatar_url ?? null} size="sm" className={cn('!h-[22px] !w-[22px] !rounded-[7px] ring-2 ring-[#F0F2F6] !text-[8px]', i > 0 && '-ml-1.5')} />;
                })}
              </span>
              {channel.members.length}<span className="sr-only"> {channel.members.length === 1 ? 'member' : 'members'}</span>
            </span>
            <div role="toolbar" aria-label={channel.kind === 'dm' ? 'Conversation' : 'Channel'} className="flex shrink-0 items-center gap-0.5">
              <button type="button" onClick={() => { setSearching((v) => !v); setQ(''); setTab('messages'); }} aria-pressed={searching}
                aria-label={`Search in this ${channel.kind === 'dm' ? 'conversation' : 'channel'}`} title={`Search in this ${channel.kind === 'dm' ? 'conversation' : 'channel'}`}
                className={cn('flex h-[34px] w-[34px] items-center justify-center rounded-[10px]', searching ? 'bg-navy-900 text-white' : 'text-[#3A4357] hover:bg-[#F0F2F6]')}>
                <Search className="h-[18px] w-[18px]" />
              </button>
              {channel.kind === 'channel' && (
                <button type="button" onClick={() => showGlance(!glance)} aria-pressed={glance} aria-label="At a glance: members, threads and links" title="At a glance: members, threads and links"
                  className={cn('hidden h-[34px] w-[34px] items-center justify-center rounded-[10px] xl:flex', glance ? 'bg-[#ECEEF2] text-navy-900' : 'text-[#3A4357] hover:bg-[#F0F2F6]')}>
                  <PanelRight className="h-[18px] w-[18px]" />
                </button>
              )}
              {(canManage || (channel.kind === 'channel' && member)) && (
                <div className="relative">
                  <button type="button" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-label="Channel settings" title="Channel settings" className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-[#3A4357] hover:bg-[#F0F2F6]">
                    <MoreVertical className="h-[18px] w-[18px]" />
                  </button>
                  {menu && (
                    <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-2xl bg-white/95 py-1 shadow-[0_12px_36px_rgba(9,21,48,0.18),0_0_0_0.5px_rgba(9,21,48,0.1)] backdrop-blur-xl">
                      {canManage && <button role="menuitem" type="button" onClick={() => { setMenu(false); setPanel('add'); }} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm hover:bg-[#EEF1F5]"><UserPlus className="h-4 w-4" /> Add people</button>}
                      {canManage && <button role="menuitem" type="button" onClick={() => { setMenu(false); setPanel('integrations'); }} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm hover:bg-[#EEF1F5]"><Plug className="h-4 w-4" /> Connect an app (Zapier, Airtable…)</button>}
                      {channel.kind === 'channel' && member && <button role="menuitem" type="button" onClick={leave} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm text-burgundy-600 hover:bg-burgundy-50"><ArrowLeft className="h-4 w-4" /> Leave channel</button>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="px-2 sm:px-3">
            <Tabs active={tab} counts={{ channels: tabs.channels, threads: threads.length, files: links.length }} showChannels={channel.kind === 'channel'}
              onPick={(t) => { if (t === 'channels') tabs.onChannels(); else { setTab(t); if (t !== 'messages') { setSearching(false); setQ(''); } } }} />
          </div>
        </header>
        {searching && (
          <div className="flex items-center gap-2 border-b border-ivory-200 px-4 py-2">
            <Search className="h-4 w-4 text-ivory-600" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${channel.kind === 'dm' ? 'this conversation' : `#${channel.name}`}`} autoFocus aria-label="Search messages" className="min-w-0 flex-1 border-0 bg-transparent text-sm text-navy-800 outline-none" />
            {needle && <span className="text-xs text-ivory-700">{shown.length} found</span>}
            <button type="button" onClick={() => { setSearching(false); setQ(''); }} aria-label="Close search" className="rounded p-1 text-ivory-700 hover:bg-ivory-100"><X className="h-4 w-4" /></button>
          </div>
        )}

        {tab === 'files' ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {links.length === 0 ? <p className="py-10 text-center text-sm text-ivory-700">Links shared in this {channel.kind === 'dm' ? 'conversation' : 'channel'} collect here by themselves, newest first.</p> : (
              <ul className="space-y-2.5">
                {links.map((l) => (
                  <li key={l.url} className="flex flex-wrap items-center gap-3 rounded-2xl border border-ivory-300 px-4 py-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-[11px] font-extrabold text-navy-800">LINK</span>
                    <span className="min-w-[200px] flex-1">
                      <a href={l.url} target="_blank" rel="noreferrer noopener" className="block truncate text-[15px] font-bold text-navy-900 hover:underline">{l.url.replace(/^https?:\/\//, '')}</a>
                      <span className="block truncate text-[13px] text-ivory-700">Shared by {l.message.sender_name ?? (l.message.user_id && byId.get(l.message.user_id) ? memberName(byId.get(l.message.user_id)!) : 'someone')} · {dayLabel(l.message.created_at)}</span>
                    </span>
                    <button type="button" onClick={() => { setTab('messages'); requestAnimationFrame(() => document.getElementById(`msg-${l.message.parent_id ?? l.message.id}`)?.scrollIntoView({ block: 'center' })); }} className="h-10 rounded-xl border border-ivory-300 px-3 text-[13px] font-semibold text-navy-900 hover:bg-ivory-50">Show the message</button>
                    <a href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex h-10 items-center rounded-xl bg-navy-900 px-4 text-[13px] font-bold text-white hover:bg-navy-800">Open</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : tab === 'threads' ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {threads.length === 0 ? <p className="py-10 text-center text-sm text-ivory-700">No threads yet. Use “Reply to this message” under any message to start one.</p> : (
              <ul className="space-y-3">
                {threads.map((m) => {
                  const p = m.user_id ? byId.get(m.user_id) : undefined;
                  const name = m.source === 'webhook' ? m.sender_name ?? 'App' : p ? memberName(p) : 'Someone';
                  return (
                    <li key={m.id}>
                      <button type="button" onClick={() => setThread(m)} className={cn('flex w-full flex-col gap-1.5 rounded-2xl border bg-white p-4 text-left transition hover:border-gold-400', thread?.id === m.id ? 'border-2 border-gold-400' : 'border-ivory-300')}>
                        <span className="text-[13px] text-ivory-700"><strong className="text-navy-900">{name}</strong> · {dayLabel(m.created_at)}, {time(m.created_at)}</span>
                        <span className="line-clamp-2 text-[15px] text-navy-900">{m.body}</span>
                        <span className="text-[13px] font-bold text-gold-800">{m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}{m.last_reply_at ? ` · last ${ago(m.last_reply_at)}` : ''} · Open replies</span>
                      </button>
                    </li>
                  );
                })}
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
                        onThread={member ? () => setThread(m) : (m.reply_count > 0 ? () => setThread(m) : undefined)} picked={thread?.id === m.id} focused={focusId === m.id} />
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {member ? (
          <Composer placeholder={placeholder} people={people} onSend={send} hint={channel.kind === 'dm' ? undefined : '@ to mention someone, @here for everyone in the channel'} />
        ) : (
          <div className="m-3 flex items-center justify-between gap-3 rounded-xl border border-ivory-200 bg-ivory-50 px-4 py-3 text-sm">
            <span className="text-navy-700">You're reading <strong>#{channel.name}</strong>.</span>
            <button type="button" onClick={join} className="btn-primary !py-1.5">Join channel</button>
          </div>
        )}
      </div>

      {/* At a glance: who is in it, the open threads and the latest links, without leaving the messages. */}
      {!thread && glance && channel.kind === 'channel' && (
        <aside aria-label="At a glance" className="hidden w-[320px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-[#E8EBF0] px-4 pb-5 xl:flex">
          <div className="-mx-4 flex h-[58px] shrink-0 items-center border-b border-[#E8EBF0] px-4">
            <h2 className="flex-1 text-[17px] font-extrabold text-navy-900">At a glance</h2>
            <button type="button" onClick={() => showGlance(false)} aria-label="Close At a glance" className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#F0F2F6] text-[#3A4357] hover:bg-[#E6E9EF]"><X className="h-4 w-4" /></button>
          </div>
          <section className="flex flex-col gap-1.5">
            <p className="flex items-center px-1 text-[13px] font-semibold text-ivory-700"><span className="flex-1">{channel.members.length} {channel.members.length === 1 ? 'member' : 'members'}</span>
              {canManage && <button type="button" onClick={() => setPanel('add')} className="font-semibold text-[#0A6ACF] hover:underline">+ Add</button>}</p>
            <ul className="overflow-hidden rounded-2xl bg-[#EEF1F5]">
              {channel.members.slice(0, 6).map((mb) => {
                const p = byId.get(mb.user_id);
                return (
                  <li key={mb.user_id} className="flex items-center gap-2.5 border-b border-navy-900/[0.06] px-3 py-2 last:border-0">
                    <Avatar firstName={p?.first_name ?? null} lastName={p?.last_name ?? null} src={p?.avatar_url ?? null} size="sm" className="!h-7 !w-7 !rounded-full !text-[10px]" />
                    <span className="min-w-0 flex-1 truncate text-sm text-navy-900">{p ? memberName(p) : 'Former member'}{mb.user_id === me ? ' (you)' : ''}</span>
                    {mb.role === 'owner' && <span className="text-[11px] font-semibold text-ivory-700">Owner</span>}
                  </li>
                );
              })}
              {channel.members.length > 6 && <li className="px-3 py-2 text-[13px] text-ivory-700">and {channel.members.length - 6} more</li>}
            </ul>
          </section>
          <section className="flex flex-col gap-1.5">
            <p className="flex items-center px-1 text-[13px] font-semibold text-ivory-700"><span className="flex-1">Threads</span>
              {threads.length > 3 && <button type="button" onClick={() => setTab('threads')} className="font-semibold text-[#0A6ACF] hover:underline">See all {threads.length}</button>}</p>
            {threads.length === 0 ? <p className="rounded-2xl bg-[#EEF1F5] px-3 py-3 text-[13px] text-ivory-700">No threads yet.</p> : (
              <ul className="overflow-hidden rounded-2xl bg-[#EEF1F5]">
                {threads.slice(0, 3).map((m) => (
                  <li key={m.id} className="border-b border-navy-900/[0.06] last:border-0">
                    <button type="button" onClick={() => setThread(m)} className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-navy-900/[0.04]">
                      <span className="line-clamp-2 text-sm text-navy-900">{m.body.replace(/[*_~`]/g, '')}</span>
                      <span className="text-xs font-semibold text-gold-800">{m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}{m.last_reply_at ? ` · ${ago(m.last_reply_at)}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-1.5">
            <p className="flex items-center px-1 text-[13px] font-semibold text-ivory-700"><span className="flex-1">Latest links</span>
              {links.length > 0 && <button type="button" onClick={() => setTab('files')} className="font-semibold text-[#0A6ACF] hover:underline">See all {links.length}</button>}</p>
            {links.length === 0 ? <p className="rounded-2xl bg-[#EEF1F5] px-3 py-3 text-[13px] text-ivory-700">Links shared here show up here.</p> : (
              <ul className="grid grid-cols-2 gap-2">
                {links.slice(0, 4).map((l) => {
                  let host = l.url;
                  try { host = new URL(l.url).hostname.replace(/^www\./, ''); } catch { /* keep the raw text */ }
                  return (
                    <li key={l.url}>
                      <a href={l.url} target="_blank" rel="noreferrer noopener" title={l.url} className="flex flex-col gap-1.5 rounded-xl bg-[#EEF1F5] p-2.5 hover:bg-[#E6E9EF]">
                        <span className="flex h-12 items-center justify-center rounded-lg bg-[#DCE3EE] text-[11px] font-extrabold text-navy-800">LINK</span>
                        <span className="truncate text-xs font-semibold text-navy-900">{host}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      )}
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
    <div className="sticky top-0 z-[1] my-2.5 flex items-center">
      <span className="h-px flex-1 bg-[#ECEEF2]" />
      <span className="flex h-[26px] items-center rounded-full bg-white px-3.5 text-xs font-bold text-[#3A4357] shadow-[0_1px_4px_rgba(9,21,48,0.1),0_0_0_1px_#ECEEF2]">{dayLabel(iso)}</span>
      <span className="h-px flex-1 bg-[#ECEEF2]" />
    </div>
  );
}

function SenderAvatar({ m, byId }: { m: ChatMessage; byId: Map<string, DirectoryMember> }) {
  const p = m.user_id ? byId.get(m.user_id) : undefined;
  if (m.source === 'webhook') {
    return <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] bg-gradient-to-br from-[#24375E] to-[#13254A] text-gold-400"><Plug className="h-[18px] w-[18px]" /></span>;
  }
  return <Avatar firstName={p?.first_name ?? null} lastName={p?.last_name ?? null} src={p?.avatar_url ?? null} size="sm" className="!h-[38px] !w-[38px] !rounded-[11px]" />;
}

function MessageItem({ message: m, first, me, byId, canModerate, onThread, inThread, picked, focused }: {
  message: ChatMessage; first: boolean; me: string; byId: Map<string, DirectoryMember>; canModerate: boolean; onThread?: () => void; inThread?: boolean;
  /** The message whose replies are open beside the channel. */
  picked?: boolean;
  /** The message opened from Activity or Files. */
  focused?: boolean;
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
    <div id={inThread ? undefined : `msg-${m.id}`} className={cn('group relative flex gap-3 px-4 py-0.5 transition-colors sm:px-5', first ? 'mt-1.5 pt-2' : '',
      picked || focused ? 'bg-gradient-to-r from-gold-50 to-gold-50/40 shadow-[inset_3px_0_0_#E4A93C]' : 'hover:bg-[#F5F7FA]')}>
      <div className="w-[38px] shrink-0">
        {first ? <SenderAvatar m={m} byId={byId} /> : <time className="hidden pt-1 text-right text-[10px] text-[#8A93A5] group-hover:block" dateTime={m.created_at}>{time(m.created_at)}</time>}
      </div>
      <div className="min-w-0 flex-1 pb-1">
        {first && (
          <p className="flex flex-wrap items-baseline gap-x-[7px]">
            <span className="text-[15px] font-bold text-navy-900">{name}</span>
            {m.source === 'webhook' && <span className="rounded bg-[#ECEEF2] px-[5px] py-px text-[10px] font-bold uppercase text-[#5A6476]">App{typeof m.meta?.via === 'string' && m.meta.via !== name ? ` · ${m.meta.via}` : ''}</span>}
            {p?.title && m.source === 'user' && <span className="text-xs text-[#8A93A5]">{p.title}</span>}
            <time className="text-xs text-[#8A93A5]" dateTime={m.created_at}>{time(m.created_at)}</time>
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
            {m.edited_at && <span className="text-[11px] text-[#8A93A5]">(edited)</span>}
          </>
        )}
        {picked && <p className="mt-1 text-xs font-bold text-gold-800">Replying to this message →</p>}
        {focused && !picked && <p className="mt-1 text-xs font-bold text-gold-800">Opened from your list</p>}
        {!inThread && onThread && !deleted && !editing && m.reply_count > 0 && (
          <button type="button" onClick={onThread}
            className="mb-1 mt-1.5 inline-flex items-center gap-2 rounded-[10px] bg-[#F5F7FA] py-1 pl-1 pr-2.5 text-[13px] shadow-[inset_0_0_0_1px_#E8EBF0] transition hover:bg-white hover:shadow-[inset_0_0_0_1px_#E4A93C]">
            <MessageSquare className="ml-1 h-3.5 w-3.5 text-[#0B63C4]" />
            <strong className="text-[#0B63C4]">{m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}</strong>
            {m.last_reply_at && <span className="text-[#8A93A5]">Last reply {ago(m.last_reply_at)}</span>}
          </button>
        )}
      </div>
      {!deleted && !editing && (
        <div role="toolbar" aria-label="Message actions" className="absolute -top-[18px] right-4 z-[2] hidden items-center gap-0.5 rounded-xl bg-white/[0.92] p-[3px] text-[#3A4357] shadow-[0_8px_24px_rgba(9,21,48,0.14),0_0_0_1px_rgba(9,21,48,0.06)] backdrop-blur-xl group-hover:flex group-focus-within:flex [@media(hover:none)]:flex">
          {!inThread && onThread && <button type="button" onClick={onThread} aria-label="Reply" title="Reply in a thread" className="flex h-8 items-center gap-1.5 rounded-[9px] px-2 text-xs font-semibold hover:bg-[#ECEEF2]"><CornerUpLeft className="h-[17px] w-[17px]" /><span className="hidden sm:inline">Reply</span></button>}
          {mine && <button type="button" onClick={() => { setDraft(m.body); setEditing(true); }} aria-label="Edit" title="Edit your message" className="flex h-8 w-8 items-center justify-center rounded-[9px] hover:bg-[#ECEEF2]"><Pencil className="h-4 w-4" /></button>}
          {(mine || canModerate) && (menu
            ? <span className="inline-flex items-center gap-1 pl-1 text-xs text-navy-900">Delete it?
                <button type="button" onClick={remove} className="h-8 rounded-[9px] bg-burgundy-500 px-3 text-xs font-bold text-white hover:bg-burgundy-600">Delete</button>
                <button type="button" onClick={() => setMenu(false)} className="h-8 rounded-[9px] px-3 text-xs font-semibold hover:bg-[#ECEEF2]">Keep</button>
              </span>
            : <button type="button" onClick={() => setMenu(true)} aria-label="Delete" title="Delete the message" className="flex h-8 w-8 items-center justify-center rounded-[9px] text-burgundy-600 hover:bg-burgundy-50"><Trash2 className="h-4 w-4" /></button>)}
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
function Composer({ placeholder, people, onSend, compact, label, hint }: {
  placeholder: string; people: DirectoryMember[]; onSend: (text: string) => Promise<boolean>; compact?: boolean;
  /** Written above the box (the reply panel: whose message this answers). */
  label?: string;
  hint?: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
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
  const tool = 'flex h-[30px] min-w-[30px] items-center justify-center rounded-lg text-[#5A6476] hover:bg-[#F0F2F6] hover:text-navy-900';
  return (
    <div className="relative px-3 pb-3 pt-1 sm:px-5 sm:pb-[18px]">
      {label && <p className="mb-1.5 text-xs font-bold text-gold-800">{label}</p>}
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
      <div className={cn('rounded-2xl bg-white transition-shadow', label ? 'shadow-[0_10px_30px_rgba(9,21,48,0.08),0_0_0_2px_#E4A93C]' : 'shadow-[0_10px_30px_rgba(9,21,48,0.08),0_0_0_1px_#DCE1E8] focus-within:shadow-[0_10px_30px_rgba(9,21,48,0.1),0_0_0_2px_#091530]')}>
        <textarea ref={ref} value={text} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} rows={compact ? 1 : 2} maxLength={8000} placeholder={placeholder} aria-label={placeholder}
          className="block max-h-48 min-h-[44px] w-full resize-none rounded-t-2xl border-0 bg-transparent px-4 pb-1.5 pt-3 text-[15px] text-navy-900 outline-none placeholder:text-[#8A93A5] focus:ring-0" />
        <div className="relative flex flex-wrap items-center gap-0.5 px-2 pb-2 pt-1" role="toolbar" aria-label="Formatting">
          {
            <>
              <button type="button" onClick={() => wrap('**')} aria-label="Bold" title="Bold (Ctrl+B)" className={tool}><Bold className="h-4 w-4" /></button>
              <button type="button" onClick={() => wrap('_')} aria-label="Italic" title="Italic (Ctrl+I)" className={tool}><Italic className="h-4 w-4" /></button>
              <button type="button" onClick={() => wrap('~')} aria-label="Strikethrough" title="Strikethrough" className={tool}><Strikethrough className="h-4 w-4" /></button>
              <button type="button" onClick={() => wrap('', ' (https://)', 'link text')} aria-label="Link" title="Link" className={tool}><Link2 className="h-4 w-4" /></button>
              <button type="button" onClick={() => prefix((i) => `${i + 1}. `)} aria-label="Numbered list" title="Numbered list" className={tool}><ListOrdered className="h-4 w-4" /></button>
              <button type="button" onClick={() => prefix(() => '• ')} aria-label="Bulleted list" title="Bulleted list" className={tool}><List className="h-4 w-4" /></button>
              <button type="button" onClick={() => prefix(() => '> ')} aria-label="Quote" title="Quote" className={tool}><Quote className="h-4 w-4" /></button>
              <button type="button" onClick={() => wrap('`')} aria-label="Code" title="Code" className={tool}><Code className="h-4 w-4" /></button>
              <button type="button" onClick={() => wrap('```\n', '\n```', 'code')} aria-label="Code block" title="Code block" className={tool}><SquareCode className="h-4 w-4" /></button>
              <span className="mx-1.5 h-[18px] w-px bg-[#E3E6EC]" />
            </>
          }
          <button type="button" onClick={() => setEmoji((v) => !v)} aria-expanded={emoji} aria-label="Emoji" title="Emoji" className={tool}><Smile className="h-[18px] w-[18px]" /></button>
          <button type="button" onClick={() => { insert('@'); setMention({ q: '', at: (ref.current?.selectionStart ?? text.length) }); }} aria-label="Mention someone" title="Mention someone" className={tool}><AtSign className="h-[18px] w-[18px]" /></button>
          {emoji && (
            <div className="absolute bottom-full left-8 z-20 mb-1 grid w-64 grid-cols-8 gap-0.5 rounded-xl bg-white p-1.5 shadow-[0_12px_36px_rgba(9,21,48,0.18),0_0_0_1px_rgba(9,21,48,0.08)]">
              {EMOJI.map((e) => <button key={e} type="button" onClick={() => { insert(e); setEmoji(false); }} className="rounded p-1 text-lg hover:bg-[#F0F2F6]" aria-label={e}>{e}</button>)}
            </div>
          )}
          <span className="ml-2 hidden min-w-0 flex-1 truncate text-xs text-[#8A93A5] lg:inline">Enter sends · Shift + Enter for a new line{hint ? ` · ${hint}` : ''}</span>
          <button type="button" onClick={submit} disabled={!text.trim() || busy} aria-label="Send" title="Send (Enter)"
            className={cn('ml-auto flex h-8 w-9 items-center justify-center rounded-[10px] transition', text.trim() ? 'bg-navy-900 text-gold-400 hover:bg-navy-800' : 'bg-[#F0F2F6] text-[#8A93A5]')}><Send className="h-4 w-4" /></button>
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

  const p = parent.user_id ? byId.get(parent.user_id) : undefined;
  const who = parent.source === 'webhook' ? parent.sender_name ?? 'the app' : parent.user_id === me ? 'your' : `${p ? p.first_name ?? memberName(p) : 'their'}’s`;
  const heading = who === 'your' ? 'Replies to your message' : `Replies to ${who} message`;
  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-white sm:static sm:z-auto sm:w-[400px] sm:shrink-0 sm:border-l sm:border-[#E8EBF0]" aria-label={heading}>
      <header className="flex min-h-[58px] items-center gap-3 border-b border-[#E8EBF0] px-4 py-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-extrabold text-navy-900">{heading}</h3>
          <p className="truncate text-[13px] text-[#6B7486]">in {channel.kind === 'dm' ? title : `# ${channel.name}`} · {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close replies" title="Close" className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#F0F2F6] text-[#3A4357] hover:bg-[#E6E9EF]"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <div className="bg-gradient-to-r from-gold-50 to-gold-50/40 py-1"><MessageItem message={parent} first me={me} byId={byId} canModerate={canModerate} inThread /></div>
        <div className="my-2 flex items-center gap-2.5 px-5 text-xs font-semibold text-[#8A93A5]"><span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span><span className="h-px flex-1 bg-[#ECEEF2]" /></div>
        {replies.map((r, i) => <MessageItem key={r.id} message={r} first={startsGroup(replies[i - 1], r)} me={me} byId={byId} canModerate={canModerate} inThread />)}
        <div ref={endRef} />
      </div>
      {member && <Composer placeholder="Write your reply…" label={heading.replace('Replies to', 'Reply to')} people={people} onSend={send} compact />}
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
