import { useRef, useState } from 'react';
import { ImagePlus, Loader2, X, Check } from 'lucide-react';
import type { SpaceBranding } from '@/types';
import { ACCENTS, DEFAULT_ACCENT, LOGO_TYPES, MAX_LOGO_BYTES } from '@/spatial/data/branding';
import { cn } from '@/lib/utils';

/** Logo for the office's wall screen, and an accent colour from the SYNAPSE palette. */
export function BrandingEditor({ branding, onChange, upload }: {
  branding: SpaceBranding;
  onChange: (b: SpaceBranding) => void;
  /** Stores the file and returns its public URL, or an error message. */
  upload: (file: File) => Promise<{ url: string | null; error: string | null }>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accent = branding.accent ?? DEFAULT_ACCENT;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!LOGO_TYPES.includes(file.type)) { setError('Use a PNG, JPG, WebP or SVG image.'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('Logos can be up to 2 MB.'); return; }
    setBusy(true);
    const { url, error: err } = await upload(file);
    setBusy(false);
    if (input.current) input.current.value = '';
    if (err || !url) { setError(err ?? 'Upload failed. Try again.'); return; }
    onChange({ ...branding, logo_url: url });
  };

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div>
        <p className="mb-2 text-sm font-semibold text-navy-800">Logo</p>
        <div className="flex items-center gap-3">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-navy-800 ring-1 ring-navy-100">
            {branding.logo_url ? <img src={branding.logo_url} alt="Workspace logo" className="h-full w-full object-contain p-1.5" /> : <ImagePlus className="h-6 w-6 text-ivory-600" />}
          </span>
          <div className="flex flex-col items-start gap-1">
            <button type="button" onClick={() => input.current?.click()} disabled={busy} className="btn-secondary !py-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} {branding.logo_url ? 'Change logo' : 'Upload logo'}
            </button>
            {branding.logo_url && (
              <button type="button" onClick={() => onChange({ ...branding, logo_url: null })} className="inline-flex items-center gap-1 text-xs font-medium text-ivory-700 hover:text-burgundy-600">
                <X className="h-3 w-3" /> Remove
              </button>
            )}
          </div>
        </div>
        <input ref={input} type="file" accept={LOGO_TYPES.join(',')} className="sr-only" aria-label="Logo file" onChange={(e) => pick(e.target.files?.[0])} />
        <p className={cn('mt-2 text-xs', error ? 'text-burgundy-600' : 'text-ivory-700')}>{error ?? 'PNG, JPG, WebP or SVG, up to 2 MB. Shown on the wall screen.'}</p>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-navy-800">Accent colour</p>
        <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={accent === a.value}
              aria-label={a.label}
              title={a.label}
              onClick={() => onChange({ ...branding, accent: a.value })}
              className={cn('flex h-9 w-9 items-center justify-center rounded-lg ring-2 ring-offset-2 transition', accent === a.value ? 'ring-navy-800' : 'ring-transparent hover:ring-navy-100')}
              style={{ backgroundColor: a.value }}
            >
              {accent === a.value && <Check className={cn('h-4 w-4', ['#E4A93C', '#B07A1B'].includes(a.value) ? 'text-navy-900' : 'text-white')} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
