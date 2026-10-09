import { useLayoutEffect, useRef, useState } from 'react';
import { Download, PenLine, X } from 'lucide-react';
import { AnnotationLayer } from './AnnotationLayer';
import type { MeetingBus } from '@/meetings/useMeetingBus';
import { BOARD_DRAW_TOPIC, type WhiteboardState } from '@/meetings/useWhiteboard';

const BOARD_COLORS = ['#0D1C3B', '#EF4444', '#22C55E', '#3B82F6', '#E4A93C'] as const;


/** The whiteboard on the stage: a white 16:9 board with the drawing tools. */
export function Whiteboard({ bus, me, hostId, board, names }: { bus: MeetingBus; me: string; hostId: string; board: WhiteboardState; names: Record<string, string> }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const [tools, setTools] = useState(true);

  // Keep the board 16:9 and as large as fits, so drawings line up on every screen.
  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => {
      const W = el.clientWidth; const H = el.clientHeight;
      const w = Math.min(W, (H * 16) / 9);
      setSize({ w: Math.floor(w), h: Math.floor((w * 9) / 16) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const save = () => {
    const canvas = surface?.querySelector('canvas');
    if (!canvas) return;
    const out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `Whiteboard ${new Date().toLocaleString().replace(/[/:]/g, '-')}.png`;
    a.click();
  };

  const ownerName = board.owner === me ? 'You' : names[board.owner ?? ''] ?? 'Someone';
  return (
    <div ref={outerRef} className="relative flex h-full w-full items-center justify-center rounded-lg bg-navy-50" data-whiteboard>
      <div
        ref={setSurface}
        aria-label="Whiteboard"
        role="img"
        className="relative overflow-hidden rounded-lg bg-white shadow-card ring-1 ring-navy-100"
        style={{ width: size.w, height: size.h }}
      >
        {surface && (
          <AnnotationLayer
            bus={bus}
            me={me}
            roles={{ presenter: board.owner ?? '', host: hostId }}
            surface={surface}
            topic={BOARD_DRAW_TOPIC}
            colors={BOARD_COLORS}
            open={tools}
            onClose={() => (board.canClose ? board.close() : setTools(false))}
            closeLabel={board.canClose ? 'Close whiteboard' : 'Hide drawing tools'}
            extra={<button type="button" onClick={save} aria-label="Save as image" title="Save as image" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl hover:bg-white/10"><Download className="h-[18px] w-[18px]" /></button>}
            names={names}
          />
        )}
        <span className="pointer-events-none absolute bottom-2 left-3 text-[11px] font-medium text-ivory-600">Whiteboard · opened by {ownerName}</span>
      </div>
      {!tools && (
        <button type="button" onClick={() => setTools(true)} className="absolute left-1/2 top-3 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-navy-800 px-3.5 py-2 text-xs font-semibold text-white shadow-popover hover:bg-navy-700">
          <PenLine className="h-4 w-4" /> Draw
        </button>
      )}
      {board.canClose && !tools && (
        <button type="button" onClick={board.close} aria-label="Close whiteboard" className="absolute right-3 top-3 rounded-lg bg-white p-2 text-navy-700 shadow ring-1 ring-navy-100 hover:bg-navy-50"><X className="h-4 w-4" /></button>
      )}
    </div>
  );
}
