import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Placeholder for a space's picture until live 3D previews exist: a navy tile with a
 * faint isometric floor, the space's icon and the template name.
 */
export function SpacePreview({
  title,
  subtitle,
  icon: Icon,
  size = 'md',
  showLabel = true,
  wallScreen,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  size?: 'sm' | 'md' | 'lg';
  /** Hide the name strip when the card already shows the name next to the tile. */
  showLabel?: boolean;
  /** Draw the office wall screen with the workspace logo and accent colour. */
  wallScreen?: { logoUrl?: string | null; accent?: string | null };
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl bg-gradient-to-br from-navy-700 via-navy-800 to-navy-950 ring-1 ring-inset ring-white/10',
        size === 'sm' ? 'aspect-[16/10]' : size === 'lg' ? 'aspect-[4/3]' : 'aspect-[16/10]',
        className,
      )}
      role="img"
      aria-label={subtitle ? `${title}, ${subtitle}` : title}
    >
      <IsoFloor className="absolute inset-x-[8%] top-[10%] h-[70%] w-[84%]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(228,169,60,0.16),transparent_60%)]" />
      {wallScreen && (
        <span
          className="absolute left-1/2 top-[7%] flex aspect-video w-[34%] -translate-x-1/2 items-center justify-center overflow-hidden rounded-md bg-navy-950 shadow-lg shadow-black/40"
          style={{ boxShadow: `0 0 0 2px ${wallScreen.accent ?? '#E4A93C'}` }}
          aria-label="Wall screen"
        >
          {wallScreen.logoUrl
            ? <img src={wallScreen.logoUrl} alt="" className="h-full w-full object-contain p-1.5" />
            : <span className="text-[10px] font-semibold uppercase tracking-wider text-ivory-600">Your logo</span>}
        </span>
      )}
      {Icon && (
        <span className={cn(
          'absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-gold-400 text-navy-900 shadow-lg shadow-black/30',
          wallScreen ? 'top-[55%]' : 'top-[42%]',
          size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-16 w-16' : 'h-12 w-12',
        )} style={wallScreen?.accent ? { backgroundColor: wallScreen.accent, color: ['#E4A93C', '#B07A1B'].includes(wallScreen.accent) ? '#091530' : '#fff' } : undefined}>
          <Icon className={size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-6 w-6'} />
        </span>
      )}
      {showLabel && (
        <div className={cn('absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-950/90 to-transparent', size === 'sm' ? 'p-3' : 'p-4')}>
          <p className={cn('truncate font-semibold text-white', size === 'lg' ? 'text-lg' : 'text-sm')}>{title}</p>
          {subtitle && <p className="truncate text-xs text-ivory-500">{subtitle}</p>}
        </div>
      )}
    </div>
  );
}

function IsoFloor({ className }: { className?: string }) {
  // A diamond floor plate with a light grid, drawn in an isometric-looking projection.
  const lines = [];
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    lines.push(
      <line key={`a${i}`} x1={100 - 100 * t} y1={50 * t} x2={200 - 100 * t} y2={50 + 50 * t} />,
      <line key={`b${i}`} x1={100 + 100 * t} y1={50 * t} x2={100 * t} y2={50 + 50 * t} />,
    );
  }
  return (
    <svg viewBox="0 0 200 110" className={className} aria-hidden="true">
      <polygon points="100,0 200,50 100,100 0,50" fill="rgba(255,255,255,0.04)" stroke="rgba(228,169,60,0.55)" strokeWidth="0.8" />
      <polygon points="0,50 100,100 100,110 0,60" fill="rgba(0,0,0,0.25)" />
      <polygon points="200,50 100,100 100,110 200,60" fill="rgba(0,0,0,0.4)" />
      <g stroke="rgba(255,255,255,0.08)" strokeWidth="0.5">{lines}</g>
    </svg>
  );
}
