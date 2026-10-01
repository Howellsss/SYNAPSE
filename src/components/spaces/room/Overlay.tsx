import { useState, type ReactNode } from 'react';
import {
  LocateFixed, ZoomIn, ZoomOut, Map as MapIcon, Gauge, PencilRuler, Mic, MicOff, Video, VideoOff, MonitorUp,
  SmilePlus, Hand, MessageSquare, Megaphone, MoreHorizontal, PhoneOff, Settings2, Check, Wifi, WifiOff, Loader2,
} from 'lucide-react';
import type { ConnectionState } from '@/spatial/presence';
import type { GraphicsQuality } from '@/spatial/quality';
import { cn } from '@/lib/utils';
import { Popover } from './Popover';
import { menuItem } from './styles';

// ---------------------------------------------------------------- right toolbar

function ToolButton({ label, onClick, active, children }: { label: string; onClick?: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-xl transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400',
        active ? 'bg-gold-400 text-navy-900' : 'text-navy-700 hover:bg-ivory-50',
      )}
    >
      {children}
    </button>
  );
}

export function WorldToolbar({ quality, onQuality, canEdit, onCenter, onZoomIn, onZoomOut, mapOpen, onToggleMap, onEdit }: {
  quality: GraphicsQuality;
  onQuality: (q: GraphicsQuality) => void;
  canEdit: boolean;
  onCenter: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  mapOpen: boolean;
  onToggleMap: () => void;
  onEdit: () => void;
}) {
  return (
    <div role="toolbar" aria-label="View" aria-orientation="vertical" className="flex flex-col gap-1 rounded-2xl border border-navy-100/70 bg-white/95 p-1 shadow-popover backdrop-blur">
      <ToolButton label="Center on me" onClick={onCenter}><LocateFixed className="h-[18px] w-[18px]" /></ToolButton>
      <ToolButton label="Zoom in" onClick={onZoomIn}><ZoomIn className="h-[18px] w-[18px]" /></ToolButton>
      <ToolButton label="Zoom out" onClick={onZoomOut}><ZoomOut className="h-[18px] w-[18px]" /></ToolButton>
      <ToolButton label="Floor map" onClick={onToggleMap} active={mapOpen}><MapIcon className="h-[18px] w-[18px]" /></ToolButton>
      <Popover
        label="Graphics quality"
        panelClassName="right-full top-0 mr-2 w-48"
        trigger={({ open, toggle }) => (
          <ToolButton label={`Graphics quality: ${quality === 'high' ? 'High' : 'Low'}`} onClick={toggle} active={open}><Gauge className="h-[18px] w-[18px]" /></ToolButton>
        )}
      >
        {(close) => (
          <>
            <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-ivory-700">Graphics quality</p>
            {(['high', 'low'] as const).map((q) => (
              <button key={q} role="menuitemradio" aria-checked={quality === q} className={menuItem} onClick={() => { onQuality(q); close(); }}>
                <span className="flex-1">
                  <span className="block font-semibold">{q === 'high' ? 'High' : 'Low'}</span>
                  <span className="block text-xs text-ivory-700">{q === 'high' ? 'Best look, for laptops' : 'Smooth on phones and older computers'}</span>
                </span>
                {quality === q && <Check className="h-4 w-4 text-gold-600" />}
              </button>
            ))}
          </>
        )}
      </Popover>
      {canEdit && (
        <>
          <div className="mx-2 my-0.5 border-t border-navy-50" />
          <ToolButton label="Edit office" onClick={onEdit}><PencilRuler className="h-[18px] w-[18px]" /></ToolButton>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- connection

const CONNECTION = {
  connecting: { text: 'Connecting…', dot: 'bg-gold-400', icon: Loader2 },
  connected: { text: 'Connected', dot: 'bg-green-500', icon: Wifi },
  reconnecting: { text: 'Reconnecting…', dot: 'bg-gold-400', icon: Loader2 },
  offline: { text: 'Offline', dot: 'bg-burgundy-500', icon: WifiOff },
} as const;

export function ConnectionPill({ state }: { state: ConnectionState }) {
  const c = CONNECTION[state];
  const Icon = c.icon;
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-full bg-navy-900/80 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
      <span className={cn('h-2 w-2 rounded-full', c.dot)} />
      <Icon className={cn('h-3.5 w-3.5', (state === 'connecting' || state === 'reconnecting') && 'animate-spin')} />
      {c.text}
    </div>
  );
}

// ---------------------------------------------------------------- control bar

const REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '🤔'];

function BarButton({ label, onClick, on = true, danger, children, className, pressed }: {
  label: string;
  onClick?: () => void;
  on?: boolean;
  danger?: boolean;
  pressed?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400',
        danger ? 'bg-burgundy-500 text-white hover:bg-burgundy-600'
          : pressed ? 'bg-gold-400 text-navy-900 hover:bg-gold-300'
          : on ? 'text-white hover:bg-white/10' : 'bg-white/10 text-red-300 hover:bg-white/20',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Bottom-center controls. Visual only until calls, chat and reactions are wired up. */
export function ControlBar({ initialMicOn, initialCameraOn, onLeave, onSettings }: { initialMicOn: boolean; initialCameraOn: boolean; onLeave: () => void; onSettings: () => void }) {
  const [mic, setMic] = useState(initialMicOn);
  const [cam, setCam] = useState(initialCameraOn);
  const [sharing, setSharing] = useState(false);
  const [hand, setHand] = useState(false);
  const [chat, setChat] = useState(false);
  const divider = <span className="mx-1 h-6 w-px shrink-0 bg-white/15" aria-hidden="true" />;

  return (
    <div role="toolbar" aria-label="Call controls" className="flex max-w-full items-center gap-1 rounded-full bg-navy-900/90 p-1.5 shadow-popover backdrop-blur">
      <BarButton label={mic ? 'Mute microphone' : 'Unmute microphone'} on={mic} onClick={() => setMic(!mic)}>
        {mic ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
      </BarButton>
      <BarButton label={cam ? 'Turn camera off' : 'Turn camera on'} on={cam} onClick={() => setCam(!cam)}>
        {cam ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
      </BarButton>
      <BarButton label={sharing ? 'Stop sharing' : 'Share screen'} pressed={sharing} onClick={() => setSharing(!sharing)} className="hidden sm:flex">
        <MonitorUp className="h-5 w-5" />
      </BarButton>
      {divider}
      <Popover
        label="Reactions"
        panelClassName="bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1 !rounded-full !p-1.5"
        trigger={({ open, toggle }) => <BarButton label="Reactions" pressed={open} onClick={toggle}><SmilePlus className="h-5 w-5" /></BarButton>}
      >
        {(close) => REACTIONS.map((r) => (
          <button key={r} role="menuitem" aria-label={`React ${r}`} onClick={close} className="flex h-9 w-9 items-center justify-center rounded-full text-xl transition hover:scale-110 hover:bg-ivory-50">{r}</button>
        ))}
      </Popover>
      <BarButton label={hand ? 'Lower hand' : 'Raise hand'} pressed={hand} onClick={() => setHand(!hand)}><Hand className="h-5 w-5" /></BarButton>
      <BarButton label="Chat" pressed={chat} onClick={() => setChat(!chat)} className="hidden sm:flex"><MessageSquare className="h-5 w-5" /></BarButton>
      <BarButton label="Bring your team over" className="hidden sm:flex"><Megaphone className="h-5 w-5" /></BarButton>
      <Popover
        label="More"
        panelClassName="bottom-full right-0 mb-2 w-52"
        trigger={({ open, toggle }) => <BarButton label="More" pressed={open} onClick={toggle}><MoreHorizontal className="h-5 w-5" /></BarButton>}
      >
        {(close) => (
          <>
            <button role="menuitem" className={cn(menuItem, 'sm:hidden')} onClick={() => { setSharing(!sharing); close(); }}><MonitorUp className="h-4 w-4 text-gold-600" /> {sharing ? 'Stop sharing' : 'Share screen'}</button>
            <button role="menuitem" className={cn(menuItem, 'sm:hidden')} onClick={() => { setChat(!chat); close(); }}><MessageSquare className="h-4 w-4 text-gold-600" /> Chat</button>
            <button role="menuitem" className={cn(menuItem, 'sm:hidden')} onClick={close}><Megaphone className="h-4 w-4 text-gold-600" /> Bring your team over</button>
            <button role="menuitem" className={menuItem} onClick={() => { close(); onSettings(); }}><Settings2 className="h-4 w-4 text-gold-600" /> Camera & mic settings</button>
          </>
        )}
      </Popover>
      {divider}
      <BarButton label="Leave" danger onClick={onLeave} className="!w-auto gap-1.5 px-4">
        <PhoneOff className="h-5 w-5" /> <span className="hidden text-sm font-semibold sm:inline">Leave</span>
      </BarButton>
    </div>
  );
}
