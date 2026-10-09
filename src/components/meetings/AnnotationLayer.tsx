import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { MousePointer2, Pen, Highlighter, Type, Eraser, Undo2, Trash2, X, Users, Zap } from 'lucide-react';
import {
  COLORS, TOPIC as DEFAULT_TOPIC, WIDTHS, chunkSync, contentRect, emptyState, hitTest, mayAnnotate, newId, parseMsg, reduce,
  type AnnotMsg, type AnnotState, type Item, type Point, type Roles, type Tool,
} from '@/meetings/annotations';
import type { MeetingBus } from '@/meetings/useMeetingBus';
import { Popover } from '@/components/spaces/room/Popover';
import { menuItem } from '@/components/spaces/room/styles';
import { cn } from '@/lib/utils';

interface Props {
  bus: MeetingBus;
  me: string;
  roles: Roles;
  /** The shared-screen <video>, for where the picture actually sits. */
  video?: HTMLVideoElement | null;
  /** Or a blank surface to draw on (the whiteboard): the layer covers all of it. */
  surface?: HTMLElement | null;
  /** Data channel topic (the whiteboard uses its own). */
  topic?: string;
  /** Pen colours to offer; the first is the starting colour. */
  colors?: readonly string[];
  /** What the tool bar's close button says. */
  closeLabel?: string;
  /** Extra buttons at the end of the tool bar. */
  extra?: React.ReactNode;
  /** Show the annotation tool bar. */
  open: boolean;
  onClose: () => void;
  names: Record<string, string>;
}

const LASER_MS = 1500;
const FLUSH_MS = 40;

/** Annotations drawn over a shared screen, shared live with everyone in the meeting. */
export function AnnotationLayer({ bus, me, roles, video = null, surface = null, topic: TOPIC = DEFAULT_TOPIC, colors = COLORS, closeLabel = 'Close annotation tools', extra, open, onClose, names }: Props) {
  const [state, setState] = useState<AnnotState>(emptyState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const rolesRef = useRef(roles);
  rolesRef.current = roles;
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(colors === COLORS ? COLORS[1] : colors[0]);
  const [rect, setRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [textAt, setTextAt] = useState<Point | null>(null);
  const [textValue, setTextValue] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lasers = useRef(new Map<string, { x: number; y: number; t: number }>());
  const drawing = useRef<{ id: string; pending: Point[]; last: number } | null>(null);
  const [, force] = useState(0);
  const activeTool: Tool = open ? tool : 'none';
  const allowedForMe = mayAnnotate(me, state, roles);
  const isPresenter = me === roles.presenter;
  const moderator = isPresenter || me === roles.host;

  const apply = useCallback((msg: AnnotMsg, from: string) => {
    setState((s) => reduce(s, msg, from, rolesRef.current));
  }, []);

  const send = useCallback((msg: AnnotMsg, reliable = true) => {
    bus.send(TOPIC, msg, { reliable });
    apply(msg, me);
  }, [bus, apply, me, TOPIC]);

  // Incoming messages.
  useEffect(() => bus.on(TOPIC, (raw, from) => {
    const msg = parseMsg(raw);
    if (!msg) return;
    if (msg.t === 'laser') {
      lasers.current.set(from, { x: msg.x, y: msg.y, t: performance.now() });
      force((n) => n + 1);
      return;
    }
    if (msg.t === 'sync-req') {
      // The presenter answers late joiners with everything drawn so far.
      if (rolesRef.current.presenter === me) {
        for (const part of chunkSync(stateRef.current.items, stateRef.current.allowed)) bus.send(TOPIC, part, { to: [from] });
      }
      return;
    }
    apply(msg, from);
  }), [bus, apply, me, TOPIC]);

  // New presentation: start clean, and ask the presenter for what's already there.
  useEffect(() => {
    setState(emptyState());
    if (roles.presenter && roles.presenter !== me) bus.send(TOPIC, { t: 'sync-req' }, { to: [roles.presenter] });
  }, [roles.presenter, me, bus, TOPIC]);

  // A blank surface: draw over all of it.
  useLayoutEffect(() => {
    if (!surface) return;
    const measure = () => setRect({ x: 0, y: 0, w: surface.clientWidth, h: surface.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(surface);
    return () => ro.disconnect();
  }, [surface]);

  // Follow the video's on-screen picture (it's letterboxed inside its box).
  useLayoutEffect(() => {
    if (!video) return;
    const measure = () => {
      const box = video.getBoundingClientRect();
      const parent = video.parentElement!.getBoundingClientRect();
      const r = contentRect(box.width, box.height, video.videoWidth, video.videoHeight);
      setRect({ x: box.left - parent.left + r.x, y: box.top - parent.top + r.y, w: r.w, h: r.h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(video);
    video.addEventListener('loadedmetadata', measure);
    video.addEventListener('resize', measure);
    return () => { ro.disconnect(); video.removeEventListener('loadedmetadata', measure); video.removeEventListener('resize', measure); };
  }, [video]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rect.w) return;
    let raf = 0;
    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(rect.w * dpr) || canvas.height !== Math.round(rect.h * dpr)) {
        canvas.width = Math.round(rect.w * dpr);
        canvas.height = Math.round(rect.h * dpr);
      }
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.w, rect.h);
      for (const item of stateRef.current.items) drawItem(ctx, item, rect.w, rect.h, !surface);
      // Laser pointers fade after a moment.
      const now = performance.now();
      let live = false;
      for (const [who, l] of lasers.current) {
        const age = now - l.t;
        if (age > LASER_MS) { lasers.current.delete(who); continue; }
        live = true;
        const a = 1 - age / LASER_MS;
        const x = l.x * rect.w; const y = l.y * rect.h;
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(239,68,68,0.35)';
        ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#EF4444';
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
        const label = who === me ? 'You' : names[who] ?? 'Guest';
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(13,28,59,0.85)';
        const tw = ctx.measureText(label).width;
        ctx.fillRect(x + 12, y + 10, tw + 12, 20);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, x + 18, y + 24);
        ctx.globalAlpha = 1;
      }
      if (live) raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  });

  const toPoint = (e: ReactPointerEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const flush = useCallback(() => {
    const d = drawing.current;
    if (!d || !d.pending.length) return;
    send({ t: 'pts', id: d.id, pts: d.pending });
    d.pending = [];
    d.last = performance.now();
  }, [send]);

  const eraseAt = (p: Point) => {
    const hit = hitTest(stateRef.current.items, p);
    if (hit && (hit.by === me || moderator)) send({ t: 'erase', id: hit.id });
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activeTool === 'none' || !allowedForMe) return;
    const p = toPoint(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (activeTool === 'pen' || activeTool === 'highlighter') {
      const id = newId();
      drawing.current = { id, pending: [], last: performance.now() };
      send({ t: 'begin', id, tool: activeTool, color, width: WIDTHS[activeTool], p });
    } else if (activeTool === 'eraser') {
      eraseAt(p);
    } else if (activeTool === 'text') {
      setTextAt(p);
      setTextValue('');
    } else if (activeTool === 'laser') {
      send({ t: 'laser', x: p[0], y: p[1] }, false);
      lasers.current.set(me, { x: p[0], y: p[1], t: performance.now() });
    }
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activeTool === 'laser' && allowedForMe) {
      const p = toPoint(e);
      const mine = lasers.current.get(me);
      if (!mine || performance.now() - mine.t > 30) {
        lasers.current.set(me, { x: p[0], y: p[1], t: performance.now() });
        bus.send(TOPIC, { t: 'laser', x: p[0], y: p[1] }, { reliable: false });
        force((n) => n + 1);
      }
      return;
    }
    if (activeTool === 'eraser' && e.buttons) { eraseAt(toPoint(e)); return; }
    const d = drawing.current;
    if (!d) return;
    d.pending.push(toPoint(e));
    if (performance.now() - d.last > FLUSH_MS) flush();
  };

  const onUp = () => {
    flush();
    drawing.current = null;
  };

  const commitText = () => {
    if (textAt && textValue.trim()) send({ t: 'text', id: newId(), color, x: textAt[0], y: textAt[1], text: textValue.trim() });
    setTextAt(null);
    setTextValue('');
  };

  const undo = () => {
    const mine = [...stateRef.current.items].reverse().find((i) => i.by === me);
    if (mine) send({ t: 'erase', id: mine.id });
  };

  const tools: { id: Tool; label: string; icon: typeof Pen }[] = [
    { id: 'none', label: 'Mouse (stop drawing)', icon: MousePointer2 },
    { id: 'pen', label: 'Draw', icon: Pen },
    { id: 'highlighter', label: 'Highlight', icon: Highlighter },
    { id: 'text', label: 'Text', icon: Type },
    { id: 'laser', label: 'Spotlight (laser pointer)', icon: Zap },
    { id: 'eraser', label: 'Eraser', icon: Eraser },
  ];

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-label="Annotations"
        data-annotations={state.items.length}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className={cn('absolute touch-none', activeTool === 'none' || !allowedForMe ? 'pointer-events-none' : activeTool === 'text' ? 'cursor-text' : 'cursor-crosshair')}
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      />

      {textAt && (
        <input
          autoFocus
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') { setTextAt(null); } }}
          onBlur={commitText}
          maxLength={200}
          aria-label="Annotation text"
          placeholder="Type, then press Enter"
          className="absolute z-20 min-w-[160px] rounded-md border border-white/40 bg-navy-950/70 px-2 py-1 text-sm font-semibold text-white outline-none"
          style={{ left: rect.x + textAt[0] * rect.w, top: rect.y + textAt[1] * rect.h - 14, color }}
        />
      )}

      {open && (
        <div role="toolbar" aria-label="Annotation tools" className="absolute left-1/2 top-3 z-30 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-2xl bg-navy-900/95 p-1.5 text-white shadow-popover ring-1 ring-white/10">
          {tools.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTool(t.id)}
              aria-label={t.label}
              title={t.label}
              aria-pressed={tool === t.id}
              disabled={t.id !== 'none' && !allowedForMe}
              className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition disabled:opacity-40', tool === t.id ? 'bg-gold-400 text-navy-900' : 'hover:bg-white/10')}
            >
              <t.icon className="h-[18px] w-[18px]" />
            </button>
          ))}
          <span className="mx-1 h-6 w-px shrink-0 bg-white/15" aria-hidden="true" />
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              className={cn('h-6 w-6 shrink-0 rounded-full ring-2 transition', color === c ? 'ring-gold-300 ring-offset-2 ring-offset-navy-900' : 'ring-white/20')}
              style={{ background: c }}
            />
          ))}
          <span className="mx-1 h-6 w-px shrink-0 bg-white/15" aria-hidden="true" />
          <button type="button" onClick={undo} aria-label="Undo my last mark" title="Undo" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl hover:bg-white/10"><Undo2 className="h-[18px] w-[18px]" /></button>
          <Popover
            label="Clear"
            panelClassName="top-full right-0 mt-2 w-56"
            trigger={({ open: o, toggle }) => (
              <button type="button" onClick={toggle} aria-expanded={o} aria-label="Clear" title="Clear" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl hover:bg-white/10"><Trash2 className="h-[18px] w-[18px]" /></button>
            )}
          >
            {(close) => (
              <>
                <button role="menuitem" className={menuItem} onClick={() => { send({ t: 'clear', scope: 'mine' }); close(); }}>Clear my drawings</button>
                {moderator && <button role="menuitem" className={menuItem} onClick={() => { send({ t: 'clear', scope: 'all' }); close(); }}>Clear all drawings</button>}
              </>
            )}
          </Popover>
          {isPresenter && (
            <button
              type="button"
              onClick={() => send({ t: 'perm', allowed: !state.allowed })}
              aria-pressed={state.allowed}
              title={state.allowed ? 'Others can annotate. Click to stop them.' : 'Only you can annotate. Click to let others.'}
              className={cn('ml-1 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold', state.allowed ? 'bg-white/10' : 'bg-burgundy-500')}
            >
              <Users className="h-4 w-4" /> {state.allowed ? 'Others can draw' : 'Only you'}
            </button>
          )}
          {extra}
          <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel} className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl hover:bg-white/10"><X className="h-[18px] w-[18px]" /></button>
        </div>
      )}
      {open && !allowedForMe && (
        <p className="absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-full bg-navy-900/90 px-3 py-1.5 text-xs text-ivory-200">The presenter has turned off annotation for others.</p>
      )}
    </>
  );
}

function drawItem(ctx: CanvasRenderingContext2D, item: Item, w: number, h: number, outline = true) {
  if (item.kind === 'text') {
    ctx.font = `700 ${Math.max(12, Math.round(w * 0.024))}px Inter, system-ui, sans-serif`;
    if (outline) {
      // Over a shared screen, a dark edge keeps text readable on any picture.
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(item.text, item.x * w, item.y * h);
    }
    ctx.fillStyle = item.color;
    ctx.fillText(item.text, item.x * w, item.y * h);
    return;
  }
  ctx.globalAlpha = item.tool === 'highlighter' ? 0.35 : 1;
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = Math.max(1.5, item.width * w);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const [first, ...rest] = item.points;
  if (!rest.length) {
    ctx.beginPath(); ctx.arc(first[0] * w, first[1] * h, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(first[0] * w, first[1] * h);
    for (const p of rest) ctx.lineTo(p[0] * w, p[1] * h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
