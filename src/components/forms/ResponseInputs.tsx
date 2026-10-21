import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, PenLine, RotateCcw, UploadCloud, X } from 'lucide-react';
import type { FieldDefinition, FormTheme } from '@/lib/form-builder-types';
import { RADIUS_MAP } from '@/lib/form-builder-types';
import { acceptAttr, fileProblem, fileSize, MAX_FORM_FILE_MB, uploadFormResponseFile } from '@/lib/form-files';

/** A File Upload answer holds one link per line. */
export const fileLinks = (value: string) => value.split('\n').map((s) => s.trim()).filter(Boolean);
const nameFromLink = (url: string) => decodeURIComponent(url.split('/').pop() ?? 'file');

type Upload = { key: string; name: string; size: number; progress: 'sending' | 'error'; error?: string };

/**
 * File Upload: click or drop files; each goes up straight away (with its name and size shown),
 * and the answer is its link. Without a form to send to (the builder canvas), it's a picture of
 * the field.
 */
export function FileUploadInput({ field, value, onChange, theme, formId, disabled }: {
  field: FieldDefinition; value: string; onChange: (v: string) => void; theme: FormTheme; formId?: string; disabled: boolean;
}) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const links = fileLinks(value);
  const multiple = !!field.allowMultipleFiles;
  const max = Math.min(field.maxFileSizeMB || MAX_FORM_FILE_MB, MAX_FORM_FILE_MB);
  const live = !disabled && !!formId;
  // The latest answer, for uploads that finish after another one changed it.
  const latest = useRef(value);
  latest.current = value;

  const add = (files: FileList | File[]) => {
    if (!live) return;
    const list = Array.from(files).slice(0, multiple ? 10 : 1);
    for (const file of list) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const problem = fileProblem(file, field.allowedFileTypes, field.maxFileSizeMB);
      if (problem) { setUploads((u) => [...u, { key, name: file.name, size: file.size, progress: 'error', error: problem }]); continue; }
      setUploads((u) => [...u.filter((x) => x.progress !== 'error'), { key, name: file.name, size: file.size, progress: 'sending' }]);
      uploadFormResponseFile(formId!, file, file.name).then((url) => {
        setUploads((u) => u.filter((x) => x.key !== key));
        onChange(multiple ? [...fileLinks(latest.current), url].join('\n') : url);
      }).catch((e: Error) => {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: 'error', error: e.message } : x)));
      });
    }
  };
  const remove = (url: string) => onChange(links.filter((l) => l !== url).join('\n'));
  const radius = RADIUS_MAP[theme.fieldStyle.borderRadius];
  const showDrop = multiple || (!links.length && !uploads.some((u) => u.progress === 'sending'));
  const types = (field.allowedFileTypes ?? []).map((t) => t.replace(/^\./, '').toUpperCase()).join(', ');

  return (
    <div className="space-y-2">
      {showDrop && (
        <button type="button" disabled={!live}
          onClick={() => input.current?.click()}
          onDragOver={(e) => { if (!live) return; e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          className="flex w-full flex-col items-center justify-center gap-1.5 border-2 border-dashed px-4 py-7 text-center transition-colors disabled:cursor-default"
          style={{ borderRadius: radius, borderColor: over ? theme.colors.primary : theme.colors.border, background: over ? `${theme.colors.primary}0d` : theme.fieldStyle.background }}>
          <UploadCloud className="h-6 w-6" style={{ color: theme.colors.primary }} aria-hidden />
          <span className="text-sm font-semibold" style={{ color: theme.colors.bodyText }}>{multiple ? 'Choose files' : 'Choose a file'} <span style={{ fontWeight: 400, color: theme.colors.mutedText }}>or drag {multiple ? 'them' : 'it'} here</span></span>
          <span className="text-xs" style={{ color: theme.colors.mutedText }}>{types ? `${types} · ` : ''}up to {max} MB</span>
        </button>
      )}
      <input ref={input} type="file" className="hidden" multiple={multiple} accept={acceptAttr(field.allowedFileTypes)} tabIndex={-1}
        onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
      {[...links.map((url) => ({ key: url, url })), ...uploads.map((u) => ({ key: u.key, up: u }))].map((item) => (
        <div key={item.key} className="flex items-center gap-3 px-3 py-2.5" style={{ borderRadius: radius, border: `1px solid ${'up' in item && item.up?.progress === 'error' ? theme.colors.error : theme.colors.border}`, background: theme.fieldStyle.background }}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${theme.colors.primary}12`, color: theme.colors.primary }}>
            {'up' in item && item.up?.progress === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium" style={{ color: theme.colors.bodyText }}>{'url' in item ? nameFromLink(item.url!) : item.up!.name}</span>
            <span className="block text-xs" style={{ color: 'up' in item && item.up?.error ? theme.colors.error : theme.colors.mutedText }}>
              {'url' in item ? 'Uploaded' : item.up!.progress === 'sending' ? `Uploading · ${fileSize(item.up!.size)}` : item.up!.error}
            </span>
          </span>
          {('url' in item || item.up?.progress === 'error') && (
            <button type="button" aria-label="Remove" onClick={() => ('url' in item ? remove(item.url!) : setUploads((u) => u.filter((x) => x.key !== item.key)))}
              className="rounded-full p-1.5 transition-colors hover:bg-black/5" style={{ color: theme.colors.mutedText }}><X className="h-4 w-4" /></button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Signature: draw with a finger, pen or mouse. The answer is the drawing (a PNG); the form sends
 * it as a file when it's submitted.
 */
export function SignatureInput({ value, onChange, theme, disabled }: {
  value: string; onChange: (v: string) => void; theme: FormTheme; disabled: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const radius = RADIUS_MAP[theme.fieldStyle.borderRadius];

  // Sharp lines on high-density screens; redraw a saved signature (e.g. after Back).
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = c.getBoundingClientRect();
    c.width = Math.round(width * ratio);
    c.height = Math.round(height * ratio);
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = theme.fieldStyle.textColor || '#0D1C3B';
    if (value.startsWith('data:image') || value.startsWith('http')) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => ctx.drawImage(img, 0, 0, width, height);
      img.src = value;
    }
    // Only when the pad is set up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = e.currentTarget.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const p = point(e);
    const ctx = e.currentTarget.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    onChange(canvas.current!.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    onChange('');
  };

  return (
    <div className="relative overflow-hidden" style={{ borderRadius: radius, border: `1px solid ${theme.colors.border}`, background: theme.fieldStyle.background }}>
      <canvas ref={canvas} aria-label="Sign here" className="block h-40 w-full touch-none" style={{ cursor: disabled ? 'default' : 'crosshair' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
      {!value && (
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-sm" style={{ color: theme.colors.mutedText }}>
          <PenLine className="h-5 w-5" aria-hidden />Sign here
        </span>
      )}
      <span className="pointer-events-none absolute bottom-9 left-5 right-5 border-b border-dashed" style={{ borderColor: theme.colors.border }} />
      {value && !disabled && (
        <button type="button" onClick={clear} className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5 hover:bg-white" style={{ color: theme.colors.bodyText }}>
          <RotateCcw className="h-3 w-3" /> Clear
        </button>
      )}
    </div>
  );
}
