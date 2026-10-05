import type { ReactNode } from 'react';
import { Check, ChevronUp, Mic, MicOff, Settings2, Smartphone, Video, VideoOff, Volume2 } from 'lucide-react';
import { Popover } from '@/components/spaces/room/Popover';
import { deviceLabel, isIphoneCamera, type DeviceLists } from '@/spatial/media/useDevices';
import { iphoneStatus, isMacDesktop } from '@/spatial/media/continuity';
import { IphoneCameraHelp } from './IphoneCameraHelp';
import { supportsSpeakerChoice } from '@/spatial/media/devices';
import type { DeviceKind } from '@/meetings/useActiveDevices';
import { cn } from '@/lib/utils';

/** Dark menu panel and rows for the meeting toolbar. */
export const darkPanel = '!border-white/10 !bg-navy-900 text-white shadow-popover';
export const darkItem = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ivory-100 hover:bg-white/10 focus:bg-white/10 focus:outline-none disabled:opacity-50';
const heading = 'px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ivory-500';

/** A labelled toolbar button: icon above a short label (label hidden on phones). */
export function ToolButton({ label, icon, onClick, pressed, off, badge, busy, title, className, ...rest }: {
  label: string; icon: ReactNode; onClick: () => void; pressed?: boolean; off?: boolean; badge?: number | string; busy?: boolean; title?: string; className?: string;
  'aria-expanded'?: boolean; 'aria-haspopup'?: 'menu' | 'dialog';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      {...rest}
      className={cn(
        'relative flex min-w-[44px] flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-1.5 text-[11px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 sm:min-w-[64px] sm:px-2',
        pressed ? 'bg-white/15 text-gold-300' : 'text-ivory-100 hover:bg-white/10',
        busy && 'cursor-wait opacity-70',
        className,
      )}
    >
      <span className={cn('relative flex h-6 items-center', off && 'text-red-400')}>
        {icon}
        {badge !== undefined && badge !== 0 && (
          <span className="absolute -right-3 -top-1.5 min-w-[18px] rounded-full bg-burgundy-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white">{badge}</span>
        )}
      </span>
      <span className="hidden whitespace-nowrap md:block">{label}</span>
    </button>
  );
}

/** Audio ^ and Video ^: the main button toggles, the caret opens the device list. */
function SplitButton({ main, menuLabel, children }: { main: ReactNode; menuLabel: string; children: (close: () => void) => ReactNode }) {
  return (
    <div className="flex items-stretch">
      {main}
      <Popover
        label={menuLabel}
        panelClassName={cn('bottom-full left-0 mb-3 max-h-[70vh] w-80 overflow-y-auto', darkPanel)}
        trigger={({ open, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-label={menuLabel}
            title={menuLabel}
            aria-haspopup="menu"
            aria-expanded={open}
            className={cn('flex w-5 items-start justify-center rounded-lg pt-2 sm:w-6 text-ivory-300 hover:bg-white/10 hover:text-white', open && 'bg-white/10 text-white')}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        )}
      >
        {children}
      </Popover>
    </div>
  );
}

function DeviceRows({ kind, devices, active, fallback, onChoose, close }: {
  kind: DeviceKind; devices: MediaDeviceInfo[]; active?: string; fallback: string; onChoose: (kind: DeviceKind, d: MediaDeviceInfo) => void; close: () => void;
}) {
  if (!devices.length) return <p className="px-3 py-2 text-sm text-ivory-500">None found</p>;
  // Before the browser reports the active one, the first entry (the system default) is in use.
  const current = active && devices.some((d) => d.deviceId === active) ? active : devices[0].deviceId;
  return (
    <>
      {devices.map((d, i) => (
        <button
          key={d.deviceId}
          role="menuitemradio"
          aria-checked={d.deviceId === current}
          className={darkItem}
          onClick={() => { close(); if (d.deviceId !== current) onChoose(kind, d); }}
        >
          <Check className={cn('h-4 w-4 shrink-0', d.deviceId === current ? 'text-gold-300' : 'invisible')} />
          <span className="min-w-0 flex-1 truncate">{deviceLabel(d, i, fallback)}</span>
          {kind === 'videoinput' && isIphoneCamera(d) && <Smartphone className="h-4 w-4 shrink-0 text-ivory-400" aria-label="iPhone" />}
        </button>
      ))}
    </>
  );
}

export function AudioButton({ micOn, busy, onToggle, devices, active, onChoose, onSettings, shortcut }: {
  micOn: boolean; busy?: boolean; onToggle: () => void; devices: DeviceLists; active: Record<DeviceKind, string | undefined>;
  onChoose: (kind: DeviceKind, d: MediaDeviceInfo) => void; onSettings: () => void; shortcut: string;
}) {
  const speakers = supportsSpeakerChoice() ? devices.speakers : [];
  return (
    <SplitButton
      menuLabel="Audio options"
      main={(
        <ToolButton
          label={micOn ? 'Mute' : 'Unmute'}
          title={`${micOn ? 'Mute' : 'Unmute'} (${shortcut})`}
          off={!micOn}
          busy={busy}
          onClick={onToggle}
          icon={micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        />
      )}
    >
      {(close) => (
        <>
          <p className={heading}>Microphone</p>
          <DeviceRows kind="audioinput" devices={devices.microphones} active={active.audioinput} fallback="Microphone" onChoose={onChoose} close={close} />
          {speakers.length > 0 && (
            <>
              <p className={cn(heading, 'mt-1 flex items-center gap-1.5')}><Volume2 className="h-3.5 w-3.5" /> Speaker</p>
              <DeviceRows kind="audiooutput" devices={speakers} active={active.audiooutput} fallback="Speaker" onChoose={onChoose} close={close} />
            </>
          )}
          <div className="my-1 h-px bg-white/10" />
          <button role="menuitem" className={darkItem} onClick={() => { close(); onSettings(); }}><Settings2 className="h-4 w-4" /> Audio settings…</button>
        </>
      )}
    </SplitButton>
  );
}

export function VideoButton({ camOn, busy, onToggle, devices, active, onChoose, onSettings, onRefresh, shortcut }: {
  camOn: boolean; busy?: boolean; onToggle: () => void; devices: DeviceLists; active: Record<DeviceKind, string | undefined>;
  onChoose: (kind: DeviceKind, d: MediaDeviceInfo) => void; onSettings: () => void; onRefresh: () => Promise<void>; shortcut: string;
}) {
  const iphone = iphoneStatus(devices.cameras, devices.microphones);
  return (
    <SplitButton
      menuLabel="Video options"
      main={(
        <ToolButton
          label={camOn ? 'Stop video' : 'Start video'}
          title={`${camOn ? 'Stop video' : 'Start video'} (${shortcut})`}
          off={!camOn}
          busy={busy}
          onClick={onToggle}
          icon={camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        />
      )}
    >
      {(close) => (
        <>
          <p className={heading}>Camera</p>
          <DeviceRows kind="videoinput" devices={devices.cameras} active={active.videoinput} fallback="Camera" onChoose={onChoose} close={close} />
          {iphone !== 'camera' && (iphone === 'mic-only' || isMacDesktop()) && (
            <IphoneCameraHelp status={iphone} onLookAgain={onRefresh} className="mx-2 my-1" />
          )}
          <div className="my-1 h-px bg-white/10" />
          <button role="menuitem" className={darkItem} onClick={() => { close(); onSettings(); }}><Settings2 className="h-4 w-4" /> Video settings…</button>
        </>
      )}
    </SplitButton>
  );
}
