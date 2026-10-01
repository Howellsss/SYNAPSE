import { useState } from 'react';
import { Copy, Loader2, Send } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { isValidEmail, normalizeEmail, sendInvitations } from '@/lib/invitations';
import { spaceUrl } from '@/spatial/links';
import type { Space } from '@/types';

/** "Invite people": share the space link, or invite teammates to the account by email. */
export function InviteToSpace({ space, open, onClose }: { space: Space; open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const emails = text.split(/[\s,;]+/).map(normalizeEmail).filter(Boolean);
  const bad = emails.filter((e) => !isValidEmail(e));

  const copy = async () => {
    try { await navigator.clipboard.writeText(spaceUrl(space.slug)); toast('Link copied'); }
    catch { toast('Could not copy the link', 'error'); }
  };

  const send = async () => {
    if (!emails.length || bad.length) return;
    setSending(true);
    const { error, count } = await sendInvitations({ workspaceId: space.workspace_id, emails, role: 'member', invitedBy: user?.id ?? null });
    setSending(false);
    if (error) { toast(`Couldn't send the invites. ${error}`, 'error'); return; }
    toast(`${count} ${count === 1 ? 'invite' : 'invites'} sent`);
    setText('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite people"
      description={`Teammates sign in with SYNAPSE, then walk into ${space.name}.`}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={send} disabled={!emails.length || bad.length > 0 || sending} className="btn-primary">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send invites
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-1.5 text-sm font-semibold text-navy-800">Workspace link</p>
          <div className="flex gap-2">
            <input readOnly value={spaceUrl(space.slug)} aria-label="Workspace link" className="input-field min-w-0 flex-1 font-mono text-sm" />
            <button type="button" onClick={copy} className="btn-secondary shrink-0"><Copy className="h-4 w-4" /> Copy</button>
          </div>
          <p className="mt-1 text-xs text-ivory-700">Works for people already in your SYNAPSE account.</p>
        </div>
        <div>
          <label htmlFor="invite-emails" className="mb-1.5 block text-sm font-semibold text-navy-800">Invite by email</label>
          <textarea
            id="invite-emails"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="name@company.com, another@company.com"
            className="input-field"
          />
          {bad.length > 0
            ? <p role="alert" className="mt-1 text-xs text-burgundy-600">Check {bad.length === 1 ? 'this address' : 'these addresses'}: {bad.join(', ')}</p>
            : <p className="mt-1 text-xs text-ivory-700">They join your account as members and can enter this workspace.</p>}
        </div>
      </div>
    </Modal>
  );
}
