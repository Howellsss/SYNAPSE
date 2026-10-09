/**
 * Camera backgrounds: blur, or a picture behind you. The pictures are drawn here in SYNAPSE's
 * colours (no stock photos), or you can upload your own.
 */

export type BackgroundChoice =
  | { kind: 'none' }
  | { kind: 'blur'; strength: 'light' | 'strong' }
  | { kind: 'image'; id: string; url: string; label: string };

export const BLUR_RADIUS = { light: 6, strong: 16 } as const;

export interface PresetBackground { id: string; label: string; stops: [string, string, string]; glow: string }

export const PRESETS: PresetBackground[] = [
  { id: 'navy', label: 'SYNAPSE navy', stops: ['#0D1C3B', '#16294F', '#0A1630'], glow: 'rgba(228,169,60,0.30)' },
  { id: 'studio', label: 'Soft studio', stops: ['#E9EDF4', '#D5DAE3', '#C3CAD7'], glow: 'rgba(255,255,255,0.75)' },
  { id: 'gold', label: 'Gold hour', stops: ['#1B2B4D', '#5A4A2E', '#E4A93C'], glow: 'rgba(255,214,140,0.45)' },
  { id: 'slate', label: 'Slate', stops: ['#3A4357', '#4F596B', '#2A3245'], glow: 'rgba(163,171,186,0.35)' },
];

/** Paint a preset as a 1280×720 picture (data URL), soft gradient with a glow behind the head. */
export function paintPreset(p: PresetBackground, width = 1280, height = 720): string {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, p.stops[0]); g.addColorStop(0.55, p.stops[1]); g.addColorStop(1, p.stops[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  const r = ctx.createRadialGradient(width * 0.5, height * 0.38, 10, width * 0.5, height * 0.38, width * 0.55);
  r.addColorStop(0, p.glow); r.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, width, height);
  return c.toDataURL('image/jpeg', 0.9);
}

const KEY = 'synapse.background';

/** The saved choice (uploaded pictures aren't kept between visits). */
export function loadChoice(): BackgroundChoice {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { kind?: string; strength?: string; id?: string } | null;
    if (v?.kind === 'blur' && (v.strength === 'light' || v.strength === 'strong')) return { kind: 'blur', strength: v.strength };
    const preset = v?.kind === 'image' ? PRESETS.find((p) => p.id === v.id) : undefined;
    if (preset) return { kind: 'image', id: preset.id, url: '', label: preset.label };
  } catch { /* nothing saved */ }
  return { kind: 'none' };
}

export function saveChoice(c: BackgroundChoice) {
  try {
    if (c.kind === 'image' && !PRESETS.some((p) => p.id === c.id)) return;
    localStorage.setItem(KEY, JSON.stringify(c.kind === 'image' ? { kind: 'image', id: c.id } : c));
  } catch { /* private mode */ }
}

export const sameChoice = (a: BackgroundChoice, b: BackgroundChoice) =>
  a.kind === b.kind && (a.kind !== 'blur' || a.strength === (b as typeof a).strength) && (a.kind !== 'image' || a.id === (b as typeof a).id);
