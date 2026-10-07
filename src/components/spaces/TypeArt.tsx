import { useState } from 'react';
import { typePicture, type SpaceTypeInfo } from '@/spatial/data/spaceTypes';
import { cn } from '@/lib/utils';

/**
 * Picture for a workspace type: the art-target image (until live 3D previews replace it),
 * or a drawn placeholder for Custom Space and Import Template.
 */
export function TypeArt({ info, className, eager, light }: { info: SpaceTypeInfo; className?: string; eager?: boolean; light?: boolean }) {
  const [failed, setFailed] = useState(false);
  // The light set: a bright cut-away room on white, shown whole.
  if (light && !failed) {
    return (
      <img
        src={typePicture(info.key)}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
        className={cn('h-full w-full object-contain', info.comingSoon && 'opacity-70 saturate-[0.6]', className)}
      />
    );
  }
  if (info.image && !failed) {
    return (
      <img
        src={info.image}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
        className={cn('h-full w-full object-cover', info.comingSoon && 'opacity-60 saturate-50', className)}
      />
    );
  }
  return (
    <div className={cn('flex h-full w-full items-center justify-center bg-gradient-to-br from-navy-700 via-navy-800 to-navy-950', className)} aria-hidden="true">
      {info.key === 'import' ? <ImportDrawing /> : <EmptyFloorDrawing />}
    </div>
  );
}

function EmptyFloorDrawing() {
  const lines = [];
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    lines.push(
      <line key={`a${i}`} x1={100 - 100 * t} y1={30 + 50 * t} x2={200 - 100 * t} y2={80 + 50 * t} />,
      <line key={`b${i}`} x1={100 + 100 * t} y1={30 + 50 * t} x2={100 * t} y2={80 + 50 * t} />,
    );
  }
  return (
    <svg viewBox="0 0 200 150" className="h-[85%] w-[85%]">
      <polygon points="100,30 200,80 100,130 0,80" fill="#E8D3B0" />
      <g stroke="rgba(13,28,59,0.12)" strokeWidth="0.6">{lines}</g>
      <polygon points="0,80 100,130 100,138 0,88" fill="#B9A07A" />
      <polygon points="200,80 100,130 100,138 200,88" fill="#9C845F" />
      <polygon points="0,80 100,30 100,4 0,54" fill="rgba(255,255,255,0.85)" />
      <polygon points="200,80 100,30 100,4 200,54" fill="rgba(255,255,255,0.7)" />
      <circle cx="160" cy="98" r="7" fill="#3F7D4E" /><rect x="157" y="104" width="6" height="7" fill="#7A5A3A" />
    </svg>
  );
}

function ImportDrawing() {
  return (
    <svg viewBox="0 0 200 150" className="h-[85%] w-[85%]">
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${40 + i * 22} ${22 + i * 14}) skewY(-8)`}>
          <rect width="96" height="70" rx="6" fill="#fff" opacity={0.55 + i * 0.2} stroke="rgba(13,28,59,0.15)" />
          <rect x="8" y="8" width="80" height="40" rx="3" fill={i === 2 ? '#E4A93C' : '#C5CCDB'} opacity={i === 2 ? 0.85 : 0.6} />
          <rect x="8" y="54" width="46" height="5" rx="2" fill="#8A95B0" />
        </g>
      ))}
    </svg>
  );
}
