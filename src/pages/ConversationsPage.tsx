import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowLeft, AtSign, Check, Copy, Hash, Lock, Mail, MessageSquare, MoreHorizontal, Pencil, Plug, Plus, Search, Send, Trash2, UserPlus, X,
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
  addMembers, createChannel, createWebhook, deleteMessage, dmPeople, editMessage, formatRuns, joinChannel, leaveChannel, listChannels,
  listEmailReplies, listMessages, listThread, listWebhooks, markRead, openDm, revokeWebhook, sendMessage, startsGroup, subscribeMessages,
  unreadCounts, webhookUrl, type Channel, type ChatMessage, type EmailReply, type Webhook,
} from '@/lib/chat';

type Selection = { kind: 'channel'; id: string } | { kind: 'email' } | null;

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
};

/**
 * Conversations: channels and direct messages for the team (Slack-style, with threads), posts
 * from Zapier, Airtable or Modal into a channel, and replies to emails sent from SYNAPSE.
 */
export function ConversationsPage() {
  const { workspace, user, canManageTeam } = useAuth();
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [people, setPeople] = useState<DirectoryMember[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [modal, setModal] = useState<'channel' | 'dm' | 'browse' | null>(null);
  const me = user?.id ?? '';

  const load = useCallback(async () => {
    if (!workspace) { setLoading(false); return; }
    const [c, p, d, u] = await Promise.all([listChannels(workspace.id), loadDirectory(workspace.id), loadDepartments(workspace.id), unreadCounts(workspace.id)]);
    setError(c.error);
    setChannels(c.data);
    setPeople(p.data);
    setDepartments(d.data);
    setUnread(u);
    setLoading(false);
  }, [workspace]);
  useEffect(() => { load(); }, [load]);

  const mine = channels.filter((c) => c.members.some((m) => m.user_id === me));
  const named = mine.filter((c) => c.kind === 'channel');
  const dms = mine.filter((c) => c.kind === 'dm').sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at));
  const byId = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  const current = sel?.kind === 'channel' ? channels.find((c) => c.id === sel.id) ?? null : null;

  // First visit: open the first channel.
  useEffect(() => { if (!sel && !loading && named[0]) setSel({ kind: 'channel', id: named[0].id }); }, [sel, loading, named]);

  // New messages elsewhere raise the unread count.
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    if (!workspace) return;
    return subscribeMessages(workspace.id, (m, kind) => {
      if (kind !== 'INSERT' || m.user_id === me) return;
      const s = selRef.current;
      if (s?.kind === 'channel' && s.id === m.channel_id) return;
      setUnread((u) => ({ ...u, [m.channel_id]: (u[m.channel_id] ?? 0) + 1 }));
      setChannels((cs) => cs.map((c) => (c.id === m.channel_id ? { ...c, last_message_at: m.created_at } : c)));
    });
  }, [workspace, me]);

  const open = (id: string) => { setSel({ kind: 'channel', id }); setUnread((u) => ({ ...u, [id]: 0 })); };
  const title = (c: Channel) => (c.kind === 'dm' ? dmPeople(c, me).map((id) => (byId.get(id) ? memberName(byId.get(id)!) : 'Someone')).join(', ') : c.name ?? '');

  if (loading) return <div className="card p-6"><LoadingSpinner className="h-8 w-8 text-ivory-600" /></div>;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="card flex h-[calc(100dvh-7.5rem)] min-h-[480px] overflow-hidden !p-0">
      {/* Channels and people */}
      <aside className={cn('w-full shrink-0 flex-col border-r border-ivory-200 bg-ivory-50/60 sm:flex sm:w-64', sel ? 'hidden' : 'flex')} aria-label="Conversations">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h1 className="text-lg font-semibold text-navy-800">Conversations</h1>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <SectionHead label="Channels" onAdd={() => setModal('channel')} addLabel="Create a channel" />
          {named.map((c) => (
            <SideItem key={c.id} active={sel?.kind === 'channel' && sel.id === c.id} unread={unread[c.id] ?? 0} onClick={() => open(c.id)}
              icon={c.is_private ? <Lock className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" />} label={c.name ?? ''} />
          ))}
          <button type="button" onClick={() => setModal('browse')} className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ivory-700 hover:bg-ivory-100">
            <Search className="h-3.5 w-3.5" /> Browse channels
          </button>

          <SectionHead label="Direct messages" onAdd={() => setModal('dm')} addLabel="New direct message" />
          {dms.map((c) => {
            const others = dmPeople(c, me).map((id) => byId.get(id)).filter((p): p is DirectoryMember => !!p);
            return (
              <SideItem key={c.id} active={sel?.kind === 'channel' && sel.id === c.id} unread={unread[c.id] ?? 0} onClick={() => open(c.id)}
                icon={others[0] ? <Avatar firstName={others[0].first_name} lastName={others[0].last_name} src={others[0].avatar_url} size="sm" className="!h-5 !w-5 !text-[9px]" /> : <AtSign className="h-3.5 w-3.5" />}
                label={title(c)} />
            );
          })}
          {dms.length === 0 && <p className="px-2 py-1 text-xs text-ivory-700">Message anyone in your team.</p>}

          <SectionHead label="Email" />
          <SideItem active={sel?.kind === 'email'} unread={0} onClick={() => setSel({ kind: 'email' })} icon={<Mail className="h-3.5 w-3.5" />} label="Email replies" />
        </nav>
      </aside>

      {/* The open conversation */}
      <section className={cn('min-w-0 flex-1 flex-col', sel ? 'flex' : 'hidden sm:flex')}>
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

function SectionHead({ label, onAdd, addLabel }: { label: string; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="mt-4 flex items-center justify-between px-2 pb-1">
      <span className="text-[11px] font-bold uppercase tracking-wider text-ivory-700">{label}</span>
      {onAdd && <button type="button" onClick={onAdd} aria-label={addLabel} title={addLabel} className="rounded p-0.5 text-ivory-700 hover:bg-ivory-100 hover:text-navy-800"><Plus className="h-4 w-4" /></button>}
    </div>
  );
}

function SideItem({ active, unread, onClick, icon, label }: { active: boolean; unread: number; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition', active ? 'bg-navy-800 text-white' : unread ? 'font-semibold text-navy-900 hover:bg-ivory-100' : 'text-navy-700 hover:bg-ivory-100')}>
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center', active ? 'text-white' : 'text-ivory-700')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {unread > 0 && !active && <span className="rounded-full bg-burgundy-500 px-1.5 text-[11px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

function Body({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-navy-800">
      {formatRuns(text).map((r, i) => (r.t === 'bold' ? <strong key={i}>{r.v}</strong> : r.t === 'link'
        ? <a key={i} href={r.v} target="_blank" rel="noreferrer noopener" className="text-gold-700 underline">{r.v}</a>
        : <span key={i}>{r.v}</span>))}
    </p>
  );
}

function ChannelView({ channel, title, me, people, byId, canManage, onBack, onChanged, onLeft }: {
  channel: Channel; title: string; me: string; people: DirectoryMember[]; byId: Map<string, DirectoryMember>; canManage: boolean;
  onBack: () => void; onChanged: () => void; onLeft: () => void;
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [thread, setThread] = useState<ChatMessage | null>(null);
  const [panel, setPanel] = useState<'add' | 'integrations' | null>(null);
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
    const { error } = await leaveChannel(channel.id, me);
    if (error) { toast(error, 'error'); return; }
    toast(`You left #${channel.name}`);
    onLeft();
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-ivory-200 px-4 py-3">
          <button type="button" onClick={onBack} aria-label="Back to conversations" className="rounded-md p-1 text-navy-700 hover:bg-ivory-100 sm:hidden"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-1.5 truncate text-base font-semibold text-navy-800">
              {channel.kind === 'channel' ? (channel.is_private ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />) : null}
              {title}
            </h2>
            <p className="truncate text-xs text-ivory-700">
              {channel.members.length} {channel.members.length === 1 ? 'member' : 'members'}{channel.description ? ` · ${channel.description}` : ''}
            </p>
          </div>
          {canManage && (
            <>
              <button type="button" onClick={() => setPanel('add')} className="btn-ghost !px-2.5 !py-1.5" title="Add people"><UserPlus className="h-4 w-4" /><span className="hidden md:inline"> Add people</span></button>
              <button type="button" onClick={() => setPanel('integrations')} className="btn-ghost !px-2.5 !py-1.5" title="Zapier, Airtable, Modal…"><Plug className="h-4 w-4" /><span className="hidden md:inline"> Integrations</span></button>
            </>
          )}
          {channel.kind === 'channel' && member && (
            <button type="button" onClick={leave} className="btn-ghost !px-2.5 !py-1.5 text-ivory-700" title="Leave channel">Leave</button>
          )}
        </header>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
          {more && <div className="mb-3 text-center"><button type="button" onClick={older} className="btn-ghost !py-1 text-xs">Show older messages</button></div>}
          {loading ? <LoadingSpinner className="mx-auto h-6 w-6 text-ivory-600" /> : messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-ivory-700">
              {channel.kind === 'dm' ? 'This is the start of your conversation.' : `This is the start of #${channel.name}.`}
            </p>
          ) : (
            <ol>
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
                return (
                  <li key={m.id}>
                    {newDay && <div className="my-3 flex items-center gap-3 text-xs font-semibold text-ivory-700"><span className="h-px flex-1 bg-ivory-200" />{dayLabel(m.created_at)}<span className="h-px flex-1 bg-ivory-200" /></div>}
                    <MessageItem message={m} first={newDay || startsGroup(prev, m)} me={me} byId={byId} canModerate={canManage}
                      onThread={() => setThread(m)} />
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {member ? (
          <Composer placeholder={channel.kind === 'dm' ? `Message ${title}` : `Message #${channel.name}`} onSend={send} />
        ) : (
          <div className="flex items-center justify-between gap-3 border-t border-ivory-200 px-4 py-3 text-sm">
            <span className="text-ivory-700">You're reading #{channel.name}.</span>
            <button type="button" onClick={join} className="btn-primary !py-1.5">Join channel</button>
          </div>
        )}
      </div>

      {thread && (
        <ThreadPanel parent={thread} channel={channel} me={me} byId={byId} member={member} canModerate={canManage} onClose={() => setThread(null)} />
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

function SenderAvatar({ m, byId }: { m: ChatMessage; byId: Map<string, DirectoryMember> }) {
  const p = m.user_id ? byId.get(m.user_id) : undefined;
  if (m.source === 'webhook') {
    return <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-100 text-gold-800"><Plug className="h-4 w-4" /></span>;
  }
  return <Avatar firstName={p?.first_name ?? null} lastName={p?.last_name ?? null} src={p?.avatar_url ?? null} size="sm" />;
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
    <div className={cn('group relative flex gap-3 rounded-lg px-2 hover:bg-ivory-50', first ? 'mt-3 pt-1' : 'mt-0.5')}>
      <div className="w-8 shrink-0">{first && <SenderAvatar m={m} byId={byId} />}</div>
      <div className="min-w-0 flex-1 pb-1">
        {first && (
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold text-navy-800">{name}</span>
            {m.source === 'webhook' && <span className="rounded bg-gold-100 px-1.5 text-[10px] font-bold uppercase tracking-wide text-gold-800">App{typeof m.meta?.via === 'string' && m.meta.via !== name ? ` · ${m.meta.via}` : ''}</span>}
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
          <button type="button" onClick={onThread} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-gold-700 hover:underline">
            <MessageSquare className="h-3.5 w-3.5" /> {m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}{m.last_reply_at ? ` · last ${time(m.last_reply_at)}` : ''}
          </button>
        )}
      </div>
      {!deleted && !editing && (
        <div className="absolute -top-3 right-2 hidden items-center gap-0.5 rounded-lg border border-ivory-200 bg-white p-0.5 shadow-sm group-hover:flex group-focus-within:flex">
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

function Composer({ placeholder, onSend }: { placeholder: string; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const ok = await onSend(text);
    setBusy(false);
    if (ok) setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
  };
  return (
    <div className="border-t border-ivory-200 p-3">
      <div className="flex items-end gap-2 rounded-xl border border-ivory-300 bg-white px-3 py-2 focus-within:border-navy-400">
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1} maxLength={8000} placeholder={placeholder} aria-label={placeholder}
          className="max-h-40 min-h-[24px] flex-1 resize-none border-0 bg-transparent p-0 text-sm text-navy-800 outline-none focus:ring-0" />
        <button type="button" onClick={submit} disabled={!text.trim() || busy} aria-label="Send" className="rounded-lg bg-navy-800 p-1.5 text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
      </div>
      <p className="mt-1 px-1 text-[11px] text-ivory-700">Enter to send · Shift + Enter for a new line · **bold**</p>
    </div>
  );
}

function ThreadPanel({ parent, channel, me, byId, member, canModerate, onClose }: {
  parent: ChatMessage; channel: Channel; me: string; byId: Map<string, DirectoryMember>; member: boolean; canModerate: boolean; onClose: () => void;
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
    <aside className="fixed inset-0 z-40 flex flex-col bg-white sm:static sm:z-auto sm:w-[340px] sm:shrink-0 sm:border-l sm:border-ivory-200" aria-label="Thread">
      <header className="flex items-center justify-between border-b border-ivory-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-navy-800">Thread</h3>
        <button type="button" onClick={onClose} aria-label="Close thread" className="rounded-md p-1 text-ivory-700 hover:bg-ivory-100"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <MessageItem message={parent} first me={me} byId={byId} canModerate={canModerate} inThread />
        <div className="my-2 flex items-center gap-2 px-2 text-xs text-ivory-700"><span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span><span className="h-px flex-1 bg-ivory-200" /></div>
        {replies.map((r, i) => <MessageItem key={r.id} message={r} first={startsGroup(replies[i - 1], r)} me={me} byId={byId} canModerate={canModerate} inThread />)}
        <div ref={endRef} />
      </div>
      {member && <Composer placeholder="Reply…" onSend={send} />}
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
