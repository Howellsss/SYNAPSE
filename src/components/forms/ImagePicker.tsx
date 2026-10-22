import { createContext, useContext, useRef, useState } from 'react';
import { ImagePlus, Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { uploadFormImage } from '@/lib/form-files';
import { cn } from '@/lib/utils';

/** The workspace the builder's pictures belong to (set by the form builder). */
export const FormWorkspaceCtx = createContext<string | null>(null);

/**
 * A picture for the form: drop it, choose it from the device, or paste a link. Shows the
 * picture once there is one, with Replace and Remove.
 */
export function ImagePicker({ value, onChange, label = 'Image', hint, compact }: {
  value: string | null | undefined;
  onChange: (url: string) => void;
  label?: string;
  hint?: string;
  /** Smaller, for tight panels (logos). */
  compact?: boolean;
}) {
  const workspaceId = useContext(FormWorkspaceCtx);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');

  const send = async (file: File | undefined) => {
    if (!file) return;
    if (!workspaceId) { setProblem('Open this form from Forms to upload pictures.'); return; }
    setBusy(true);
    setProblem(null);
    try { onChange(await uploadFormImage(workspaceId, file)); }
    catch (e) { setProblem((e as Error).message); }
    finally { setBusy(false); }
  };
  const applyLink = () => {
    const url = link.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) { setProblem('Paste a full link, starting with https://'); return; }
    onChange(url);
    setLink('');
    setLinkOpen(false);
    setProblem(null);
  };

  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-[#3A4357]">{label}</p>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif" className="hidden"
        onChange={(e) => { void send(e.target.files?.[0]); e.target.value = ''; }} />
      {value ? (
        <div className="overflow-hidden rounded-xl bg-[#F5F6F8] ring-1 ring-black/[0.06]">
          <div className={cn('flex items-center justify-center bg-[repeating-conic-gradient(#EEF0F3_0%_25%,#F7F8FA_0%_50%)] bg-[length:16px_16px]', compact ? 'h-20' : 'h-32')}>
            <img src={value} alt="" className="max-h-full max-w-full object-contain" />
          </div>
          <div className="flex items-center gap-1 border-t border-black/[0.06] bg-white p-1.5">
            <button type="button" onClick={() => input.current?.click()} disabled={busy} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium text-navy-900 hover:bg-[#F0F2F5]">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Replace
            </button>
            <button type="button" onClick={() => onChange('')} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium text-[#C2352B] hover:bg-[#FDF0EF]">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void send(e.dataTransfer.files?.[0]); }}
          className={cn('flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-center transition-colors',
            compact ? 'py-4' : 'py-6', over ? 'border-[#0A84FF] bg-[#0A84FF]/[0.06]' : 'border-[#C9CED8] bg-[#FAFBFC] hover:border-[#9AA3B2] hover:bg-white')}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin text-[#0A84FF]" /> : <ImagePlus className="h-5 w-5 text-[#0A84FF]" />}
          <span className="text-[13px] font-semibold text-navy-900">{busy ? 'Uploading…' : 'Upload from device'}</span>
          <span className="text-[11px] text-[#8A93A5]">{hint ?? 'or drop a picture here · up to 10 MB'}</span>
        </button>
      )}
      {linkOpen ? (
        <div className="mt-2 flex gap-1.5">
          <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') setLinkOpen(false); }}
            placeholder="https://…" className="h-8 min-w-0 flex-1 rounded-lg border border-[#D9DDE4] px-2.5 text-[13px] outline-none focus:border-[#0A84FF] focus:ring-2 focus:ring-[#0A84FF]/20" />
          <button type="button" onClick={applyLink} className="h-8 rounded-lg bg-navy-900 px-3 text-[13px] font-semibold text-white hover:bg-navy-800">Use</button>
        </div>
      ) : (
        <button type="button" onClick={() => setLinkOpen(true)} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-[#0A6ACF] hover:underline">
          <Link2 className="h-3 w-3" /> {value ? 'Use a link instead' : 'Or paste a link'}
        </button>
      )}
      {problem && <p role="alert" className="mt-1.5 text-[12px] text-[#C2352B]">{problem}</p>}
    </div>
  );
}
