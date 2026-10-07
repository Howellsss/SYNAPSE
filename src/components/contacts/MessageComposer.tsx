import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Mail, MessageSquare, StickyNote, ChevronDown, Minus, Maximize2, Minimize2, X, Type, Bold, Italic, Underline,
  List, ListOrdered, Smile, Link2, Braces, Trash2, Send, Loader2, Plus,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { cn, getFullName } from '@/lib/utils';
import { useEmailAccounts, connectGmail, functionErrorMessage } from '@/lib/email-accounts';
import type { Contact } from '@/types';

type Mode = 'email' | 'sms' | 'note';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMOJIS = ['😀', '😊', '🙏', '👍', '🎉', '❤️', '🙌', '👋', '✅', '📅', '📞', '✨', '🔥', '💡', '🤝', '⏰'];

// Personalisation fields: inserted as {{contact.x}} and filled in when the message is sent.
const MERGE_FIELDS: { token: string; label: string; value: (c: Contact) => string }[] = [
  { token: '{{contact.first_name}}', label: 'First name', value: (c) => c.first_name ?? '' },
  { token: '{{contact.last_name}}', label: 'Last name', value: (c) => c.last_name ?? '' },
  { token: '{{contact.full_name}}', label: 'Full name', value: (c) => getFullName(c) },
  { token: '{{contact.email}}', label: 'Email', value: (c) => c.email ?? '' },
  { token: '{{contact.phone}}', label: 'Phone', value: (c) => c.phone ?? '' },
  { token: '{{contact.company}}', label: 'Company', value: (c) => c.company ?? '' },
];

function fillMergeFields(text: string, contact: Contact): string {
  return MERGE_FIELDS.reduce((out, f) => out.split(f.token).join(f.value(contact)), text);
}

function isMissingColumnError(error: { code?: string; message?: string }) {
  return error.code === 'PGRST204' || /column .* does not exist|schema cache/i.test(error.message ?? '');
}

function smsSegments(text: string) {
  // GSM-7 fits 160 chars (153 per part when split); anything else (emoji, accents) is UCS-2: 70 / 67.
  const gsm = /^[\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€^{}\\[~\]|]*$/.test(text);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const len = [...text].length;
  return { len, parts: len === 0 ? 0 : len <= single ? 1 : Math.ceil(len / multi), single };
}

/** Email addresses typed into CC/BCC: add with Enter, comma or when leaving the field. */
function AddressInput({ label, values, onChange, autoFocus }: { label: string; values: string[]; onChange: (v: string[]) => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    const parts = draft.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const bad = parts.filter((p) => !EMAIL_RE.test(p));
    const good = parts.filter((p) => EMAIL_RE.test(p) && !values.includes(p));
    if (good.length) onChange([...values, ...good]);
    setDraft(bad.join(', '));
    setInvalid(bad.length > 0);
  };
  return (
    <div className="flex min-h-[40px] flex-wrap items-center gap-1.5 border-b border-sand px-3 py-1.5">
      <span className="w-12 shrink-0 text-sm text-ivory-600">{label}</span>
      {values.map((v) => (
        <Chip key={v} onRemove={() => onChange(values.filter((x) => x !== v))} removeLabel={`Remove ${v}`}>{v}</Chip>
      ))}
      <input
        autoFocus={autoFocus}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
          else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={commit}
        placeholder={values.length ? '' : 'name@example.com'}
        aria-label={`${label} addresses`}
        aria-invalid={invalid}
        className={cn('min-w-[140px] flex-1 bg-transparent text-sm outline-none placeholder:text-ivory-400', invalid && 'text-burgundy-600')}
      />
    </div>
  );
}

function Chip({ children, onRemove, removeLabel, avatar }: { children: ReactNode; onRemove?: () => void; removeLabel?: string; avatar?: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-navy-100 bg-ivory-50 py-0.5 pl-1.5 pr-1 text-sm text-navy-800">
      {avatar && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold-100 text-[10px] font-semibold text-gold-800">{avatar}</span>}
      <span className="truncate">{children}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={removeLabel} className="rounded p-0.5 text-ivory-500 hover:bg-white hover:text-navy-800"><X className="h-3 w-3" /></button>
      )}
    </span>
  );
}

function ToolButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault() /* keep the editor's text selection */}
      onClick={onClick}
      className={cn('flex h-8 w-8 items-center justify-center rounded-lg text-ivory-600 transition hover:bg-ivory-100 hover:text-navy-800', active && 'bg-ivory-100 text-navy-800')}
    >
      {children}
    </button>
  );
}

export function MessageComposer({ contact, onSent }: { contact: Contact; onSent: () => Promise<void> }) {
  const { workspace, user, profile } = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>(contact.email ? 'email' : contact.phone ? 'sms' : 'note');
  const [lastChannel, setLastChannel] = useState<'email' | 'sms'>(contact.email || !contact.phone ? 'email' : 'sms');
  const [channelMenu, setChannelMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);

  // Email fields
  const defaultFromName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || workspace?.name || '';
  const [fromEmail, setFromEmail] = useState(user?.email ?? '');
  const [fromName, setFromName] = useState(defaultFromName);
  const [editingFrom, setEditingFrom] = useState(false);
  const [editingFromName, setEditingFromName] = useState(false);
  // Which mailbox sends: a connected Gmail account id, or 'save' (recorded only, not delivered).
  const { accounts: mailboxes, loading: mailboxesLoading } = useEmailAccounts();
  const activeMailboxes = mailboxes.filter((m) => m.status === 'active');
  const [senderId, setSenderId] = useState('');
  const mailbox = activeMailboxes.find((m) => m.id === senderId) ?? null;
  const [connecting, setConnecting] = useState(false);
  const toOptions = [contact.email, ...(contact.additional_emails ?? [])].filter((e): e is string => Boolean(e));
  const [toEmail, setToEmail] = useState(toOptions[0] ?? '');
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [popover, setPopover] = useState<'emoji' | 'merge' | null>(null);
  const [emailEmpty, setEmailEmpty] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);

  // SMS + note fields
  const [text, setText] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!fromName && defaultFromName) setFromName(defaultFromName); }, [defaultFromName, fromName]);
  useEffect(() => {
    if (mailboxesLoading) return;
    if (!senderId || (senderId !== 'save' && !activeMailboxes.some((m) => m.id === senderId))) {
      setSenderId(activeMailboxes[0]?.id ?? 'save');
    }
  }, [mailboxesLoading, activeMailboxes, senderId]);

  const startGmailConnect = async () => {
    if (!workspace) return;
    setConnecting(true);
    const err = await connectGmail(workspace.id, `/contacts/${contact.id}`);
    if (err) { toast(err, 'error'); setConnecting(false); }
  };

  const dnd = (ch: 'email' | 'sms') => !!contact.dnd_all || (contact.dnd_channels ?? []).includes(ch);
  const blocker =
    mode === 'email' ? (!contact.email ? 'This contact has no email address.' : dnd('email') ? 'Email is turned off for this contact (Do not disturb).' : null)
    : mode === 'sms' ? (!contact.phone ? 'This contact has no phone number.' : dnd('sms') ? 'Text messages are turned off for this contact (Do not disturb).' : null)
    : null;

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setEmailEmpty(!(editorRef.current?.innerText.trim()));
  };

  const insertText = (value: string) => {
    if (mode === 'email') { exec('insertText', value); return; }
    const el = textRef.current;
    if (!el) { setText((t) => t + value); return; }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + value + text.slice(end);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + value.length, start + value.length); });
  };

  const addLink = () => {
    const url = window.prompt('Link address (https://…)');
    if (!url) return;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    exec('createLink', href);
  };

  const clear = () => {
    if (editorRef.current) editorRef.current.innerHTML = '';
    setEmailEmpty(true);
    setSubject(''); setText(''); setCc([]); setBcc([]); setShowCc(false); setShowBcc(false);
  };

  const pickChannel = (ch: 'email' | 'sms') => { setMode(ch); setLastChannel(ch); setChannelMenu(false); setPopover(null); };

  const emailReady = mailbox ? subject.trim().length > 0 : EMAIL_RE.test(fromEmail);
  const canSend = !blocker && !sending && (mode === 'email' ? !emailEmpty && emailReady && EMAIL_RE.test(toEmail) : text.trim().length > 0);

  const sendViaGmail = async () => {
    if (!mailbox) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: {
        account_id: mailbox.id,
        contact_id: contact.id,
        to: toEmail,
        cc,
        bcc,
        from_name: fromName.trim() || null,
        subject: fillMergeFields(subject.trim(), contact),
        text: fillMergeFields(editorRef.current?.innerText.trim() ?? '', contact),
        html: fillMergeFields(editorRef.current?.innerHTML ?? '', contact),
      },
    });
    setSending(false);
    if (error || data?.sent === false) {
      toast(await functionErrorMessage(error, 'The email could not be sent.'), 'error');
      await onSent(); // a failed attempt is still recorded on the contact
      return;
    }
    toast(`Email sent from ${mailbox.email}`);
    if (data?.recorded === false) toast('Sent, but it could not be saved on this contact. Run the latest database update.', 'info');
    clear();
    await onSent();
  };

  const send = async () => {
    if (!canSend || !workspace) return;
    if (mode === 'email' && mailbox) { await sendViaGmail(); return; }
    setSending(true);
    let error: { message: string; code?: string } | null = null;

    if (mode === 'note') {
      ({ error } = await supabase.from('notes').insert({ workspace_id: workspace.id, contact_id: contact.id, author_id: user?.id ?? null, content: text.trim() }));
    } else {
      const base = {
        workspace_id: workspace.id, contact_id: contact.id, channel: mode, direction: 'outbound', status: 'queued',
        subject: mode === 'email' ? fillMergeFields(subject.trim(), contact) || null : null,
        body: mode === 'email' ? fillMergeFields(editorRef.current?.innerText.trim() ?? '', contact) : fillMergeFields(text.trim(), contact),
      };
      const details = mode === 'email'
        ? { from_email: fromEmail, from_name: fromName.trim() || null, to_address: toEmail, cc, bcc, body_html: fillMergeFields(editorRef.current?.innerHTML ?? '', contact) }
        : { to_address: contact.phone };
      ({ error } = await supabase.from('messages').insert({ ...base, ...details }));
      if (error && isMissingColumnError(error)) {
        // Database without the email-details update: keep the message rather than losing it.
        ({ error } = await supabase.from('messages').insert(base));
        if (!error && mode === 'email' && (cc.length || bcc.length)) toast('Saved. CC/BCC need the latest database update to be saved.', 'info');
      }
    }

    setSending(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(mode === 'note' ? 'Note added' : `${mode === 'email' ? 'Email' : 'Text'} saved on this contact (not delivered)`);
    clear();
    await onSent();
  };

  const sms = smsSegments(text);
  const initials = (getFullName(contact).match(/\b\w/g) ?? []).slice(0, 2).join('').toUpperCase();

  return (
    <div className={cn('m-3 overflow-hidden rounded-2xl border bg-white shadow-sm transition-colors', mode === 'note' ? 'border-gold-300' : 'border-navy-200 focus-within:border-navy-400')}>
      {/* Header: channel, internal note, minimise/expand */}
      <div className={cn('flex items-center gap-1 border-b px-2 py-1.5', mode === 'note' ? 'border-gold-200 bg-gold-50' : 'border-navy-100 bg-ivory-50')}>
        <div className="relative">
          <button
            type="button"
            onClick={() => { if (mode === 'note') pickChannel(lastChannel); else setChannelMenu((v) => !v); }}
            aria-haspopup="menu"
            aria-expanded={channelMenu}
            className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition', mode !== 'note' ? 'bg-white text-navy-800 shadow-sm ring-1 ring-navy-100' : 'text-ivory-600 hover:text-navy-800')}
          >
            {lastChannel === 'email' ? <Mail className="h-4 w-4 text-gold-600" /> : <MessageSquare className="h-4 w-4 text-gold-600" />}
            {lastChannel === 'email' ? 'Email' : 'SMS'}
            <ChevronDown className="h-3.5 w-3.5 text-ivory-500" />
          </button>
          {channelMenu && (
            <div role="menu" className="absolute left-0 top-full z-20 mt-1 w-40 rounded-xl border border-navy-100 bg-white p-1 shadow-lg">
              {([['email', 'Email', Mail, contact.email], ['sms', 'SMS', MessageSquare, contact.phone]] as const).map(([k, label, Icon, addr]) => (
                <button key={k} role="menuitem" onClick={() => pickChannel(k)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-navy-800 hover:bg-ivory-50">
                  <Icon className="h-4 w-4 text-gold-600" />
                  <span className="flex-1">{label}</span>
                  {!addr && <span className="text-[11px] text-ivory-500">none</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => { setMode('note'); setChannelMenu(false); setPopover(null); }}
          aria-pressed={mode === 'note'}
          className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition', mode === 'note' ? 'bg-gold-400 text-navy-900 shadow-sm' : 'text-ivory-600 hover:text-navy-800')}
        >
          <StickyNote className="h-4 w-4" /> Internal note
        </button>
        <div className="flex-1" />
        <ToolButton label={collapsed ? 'Open composer' : 'Minimise composer'} onClick={() => setCollapsed((v) => !v)}><Minus className="h-4 w-4" /></ToolButton>
        <ToolButton label={expanded ? 'Smaller editor' : 'Bigger editor'} onClick={() => { setExpanded((v) => !v); setCollapsed(false); }}>
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </ToolButton>
      </div>

      {!collapsed && (
        <>
          {blocker && <p className="border-b border-sand bg-red-50 px-3 py-2 text-sm text-burgundy-600">{blocker}</p>}

          {/* EMAIL */}
          {mode === 'email' && (
            <div className={cn(blocker && 'pointer-events-none opacity-50')}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-sand px-3 py-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="w-12 shrink-0 text-sm text-ivory-600">From</span>
                  {activeMailboxes.length > 0 && (
                    <select value={senderId} onChange={(e) => setSenderId(e.target.value)} aria-label="Send from" className="max-w-[16rem] rounded-lg border border-navy-100 bg-ivory-50 px-2 py-1 text-sm text-navy-800 outline-none">
                      {activeMailboxes.map((m) => <option key={m.id} value={m.id}>{m.email} (Gmail)</option>)}
                      <option value="save">Save only, don’t deliver</option>
                    </select>
                  )}
                  {mailbox ? null : editingFrom ? (
                    <input autoFocus value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} onBlur={() => setEditingFrom(false)} onKeyDown={(e) => e.key === 'Enter' && setEditingFrom(false)} aria-label="From email" className={cn('w-56 rounded-md border px-2 py-1 text-sm outline-none', EMAIL_RE.test(fromEmail) ? 'border-navy-200 focus:border-gold-400' : 'border-burgundy-500')} />
                  ) : (
                    <button type="button" onClick={() => setEditingFrom(true)} className="min-w-0 text-left" title="Change sender email">
                      <Chip avatar={(fromName[0] ?? 'S').toUpperCase()}>{fromEmail || 'Add sender email'}</Chip>
                    </button>
                  )}
                  {!mailboxesLoading && activeMailboxes.length === 0 && (
                    <button type="button" onClick={startGmailConnect} disabled={connecting} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-gold-700 hover:bg-gold-50 disabled:opacity-50">
                      <Plus className="h-3.5 w-3.5" /> {connecting ? 'Opening Google…' : 'Connect Gmail to send'}
                    </button>
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-sm text-ivory-600">From name</span>
                  {editingFromName ? (
                    <input autoFocus value={fromName} onChange={(e) => setFromName(e.target.value)} onBlur={() => setEditingFromName(false)} onKeyDown={(e) => e.key === 'Enter' && setEditingFromName(false)} aria-label="From name" className="w-44 rounded-md border border-navy-200 px-2 py-1 text-sm outline-none focus:border-gold-400" />
                  ) : (
                    <button type="button" onClick={() => setEditingFromName(true)} className="min-w-0 text-left" title="Change sender name"><Chip>{fromName || 'Add a name'}</Chip></button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 border-b border-sand px-3 py-1.5">
                <span className="w-12 shrink-0 text-sm text-ivory-600">To</span>
                {toOptions.length > 1 ? (
                  <select value={toEmail} onChange={(e) => setToEmail(e.target.value)} aria-label="To" className="rounded-lg border border-navy-100 bg-ivory-50 px-2 py-1 text-sm text-navy-800 outline-none">
                    {toOptions.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                ) : (
                  <Chip avatar={initials}>{toEmail || '—'}</Chip>
                )}
                <div className="flex-1" />
                {!showCc && <button type="button" onClick={() => setShowCc(true)} className="text-sm font-medium text-ivory-600 hover:text-navy-800">CC</button>}
                {!showBcc && <button type="button" onClick={() => setShowBcc(true)} className="text-sm font-medium text-ivory-600 hover:text-navy-800">BCC</button>}
              </div>
              {showCc && <AddressInput label="CC" values={cc} onChange={setCc} autoFocus />}
              {showBcc && <AddressInput label="BCC" values={bcc} onChange={setBcc} autoFocus={!showCc} />}
              <div className="flex items-center gap-2 border-b border-sand px-3 py-1.5">
                <label htmlFor="composer-subject" className="w-12 shrink-0 text-sm text-ivory-600">Subject</label>
                <input id="composer-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Enter subject" className="flex-1 bg-transparent py-1 text-sm text-navy-800 outline-none placeholder:text-ivory-400" />
              </div>
              {showFormatBar && (
                <div className="flex items-center gap-0.5 border-b border-sand px-2 py-1">
                  <ToolButton label="Bold" onClick={() => exec('bold')}><Bold className="h-4 w-4" /></ToolButton>
                  <ToolButton label="Italic" onClick={() => exec('italic')}><Italic className="h-4 w-4" /></ToolButton>
                  <ToolButton label="Underline" onClick={() => exec('underline')}><Underline className="h-4 w-4" /></ToolButton>
                  <span className="mx-1 h-5 w-px bg-navy-100" />
                  <ToolButton label="Bulleted list" onClick={() => exec('insertUnorderedList')}><List className="h-4 w-4" /></ToolButton>
                  <ToolButton label="Numbered list" onClick={() => exec('insertOrderedList')}><ListOrdered className="h-4 w-4" /></ToolButton>
                </div>
              )}
              <div
                ref={editorRef}
                role="textbox"
                aria-multiline="true"
                aria-label="Email message"
                contentEditable={!blocker}
                suppressContentEditableWarning
                data-placeholder="Type a message"
                onInput={() => setEmailEmpty(!(editorRef.current?.innerText.trim()))}
                onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                className={cn('composer-editor relative overflow-y-auto px-4 py-3', emailEmpty && 'is-empty', ' text-sm leading-relaxed text-navy-800 outline-none [&_a]:text-gold-700 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6', expanded ? 'min-h-[320px]' : 'min-h-[120px] max-h-[260px]')}
              />
            </div>
          )}

          {/* SMS / NOTE */}
          {mode !== 'email' && (
            <div className={cn(blocker && 'pointer-events-none opacity-50', mode === 'note' && 'bg-gold-50/40')}>
              {mode === 'sms' && (
                <div className="flex items-center gap-2 border-b border-sand px-3 py-1.5">
                  <span className="w-12 shrink-0 text-sm text-ivory-600">To</span>
                  <Chip avatar={initials}>{contact.phone || '—'}</Chip>
                </div>
              )}
              <textarea
                ref={textRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                placeholder={mode === 'note' ? 'Write a note only your team can see…' : 'Type a text message'}
                aria-label={mode === 'note' ? 'Internal note' : 'Text message'}
                disabled={!!blocker}
                className={cn('block w-full resize-none bg-transparent px-4 py-3 text-sm text-navy-800 outline-none placeholder:text-ivory-400', expanded ? 'min-h-[300px]' : 'min-h-[110px]')}
              />
            </div>
          )}

          {/* Toolbar */}
          <div className="relative flex items-center gap-0.5 border-t border-sand px-2 py-1.5">
            {mode === 'email' && (
              <>
                <ToolButton label="Text formatting" active={showFormatBar} onClick={() => setShowFormatBar((v) => !v)}><Type className="h-4 w-4" /></ToolButton>
                <ToolButton label="Insert link" onClick={addLink}><Link2 className="h-4 w-4" /></ToolButton>
              </>
            )}
            <ToolButton label="Emoji" active={popover === 'emoji'} onClick={() => setPopover(popover === 'emoji' ? null : 'emoji')}><Smile className="h-4 w-4" /></ToolButton>
            {mode !== 'note' && (
              <ToolButton label="Personalise (insert contact details)" active={popover === 'merge'} onClick={() => setPopover(popover === 'merge' ? null : 'merge')}><Braces className="h-4 w-4" /></ToolButton>
            )}
            {popover && (
              <div className="absolute bottom-full left-2 z-20 mb-1 rounded-xl border border-navy-100 bg-white p-2 shadow-lg">
                {popover === 'emoji' ? (
                  <div className="grid grid-cols-8 gap-0.5">
                    {EMOJIS.map((e) => (
                      <button key={e} type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => { insertText(e); setPopover(null); }} className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-ivory-50" aria-label={`Insert ${e}`}>{e}</button>
                    ))}
                  </div>
                ) : (
                  <div className="w-56">
                    <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ivory-500">Filled in when sent</p>
                    {MERGE_FIELDS.map((f) => (
                      <button key={f.token} type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => { insertText(f.token); setPopover(null); }} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-navy-800 hover:bg-ivory-50">
                        {f.label} <span className="truncate pl-2 text-xs text-ivory-500">{f.value(contact) || '—'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex-1" />
            {mode === 'sms' && (
              <span className={cn('mr-2 text-xs tabular-nums', sms.parts > 1 ? 'text-gold-700' : 'text-ivory-500')}>
                {sms.len}/{sms.single} · {sms.parts} {sms.parts === 1 ? 'message' : 'messages'}
              </span>
            )}
            <ToolButton label="Clear" onClick={clear}><Trash2 className="h-4 w-4" /></ToolButton>
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              className="ml-1 inline-flex h-9 items-center gap-2 rounded-lg bg-navy-800 px-4 text-sm font-semibold text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'note' ? <Plus className="h-4 w-4" /> : <Send className="h-4 w-4 text-gold-400" />}
              {mode === 'note' ? 'Add note' : mode === 'email' && !mailbox ? 'Save' : mode === 'sms' ? 'Save' : 'Send'}
            </button>
          </div>
          <p className="px-4 pb-2 text-[11px] text-ivory-500">
            {mode === 'note'
              ? 'Only your team can see notes.'
              : mode === 'email' && mailbox
                ? `Sends from your Gmail (${mailbox.email}). It will also appear in your Gmail “Sent” folder. ⌘/Ctrl + Enter to send.`
                : mode === 'email'
                  ? 'Saved on this contact only, not delivered. Connect Gmail to send real emails. ⌘/Ctrl + Enter to save.'
                  : 'Text messages are saved but not delivered until an SMS provider is connected. ⌘/Ctrl + Enter to save.'}
          </p>
        </>
      )}
    </div>
  );
}
