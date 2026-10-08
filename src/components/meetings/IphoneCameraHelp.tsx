import { useState } from 'react';
import { ChevronDown, RefreshCw, Smartphone } from 'lucide-react';
import { browserName, type IphoneStatus } from '@/spatial/media/continuity';
import { cn } from '@/lib/utils';

/**
 * Help for using an iPhone as the camera on a Mac, shown when its camera isn't listed.
 * "mic-only" is the common case: macOS offers the iPhone's microphone but not its camera.
 */
export function IphoneCameraHelp({ status, onLookAgain, cameras, className }: {
  status: Exclude<IphoneStatus, 'camera'>;
  onLookAgain: () => Promise<void> | void;
  /** What the browser currently reports, shown so problems can be pinned down exactly. */
  cameras?: { label: string }[];
  className?: string;
}) {
  // A one-line hint; the steps open on request so the camera list stays the main thing.
  const [open, setOpen] = useState(false);
  const [looking, setLooking] = useState(false);
  const [looked, setLooked] = useState(false);

  const lookAgain = async () => {
    setLooking(true);
    await onLookAgain();
    // Give macOS a moment to hand over the camera before saying it's still missing.
    await new Promise((r) => setTimeout(r, 1200));
    await onLookAgain();
    setLooking(false);
    setLooked(true);
  };

  return (
    <div className={cn('rounded-lg bg-white/5 px-3 py-2 text-xs leading-relaxed text-ivory-300', className)} data-iphone-help={status}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-1.5 text-left font-semibold text-ivory-100 hover:text-white"
      >
        <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">
          {status === 'mic-only' ? "Your iPhone's microphone is connected, but not its camera." : "Don't see your iPhone camera?"}
        </span>
        <ChevronDown className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <ol className="list-decimal space-y-1 pl-4 text-ivory-300">
            <li>On the iPhone: <strong className="text-ivory-100">Settings → General → AirPlay &amp; Continuity</strong> (or AirPlay &amp; Handoff) → turn on <strong className="text-ivory-100">Continuity Camera</strong>.</li>
            <li>Lock the phone and stand it still, in landscape, near the Mac (a mount or stand is ideal). Or connect it with a USB cable.</li>
            <li>Same Apple ID on both, Wi-Fi and Bluetooth on. Needs iPhone XR or newer with iOS 16+, and macOS Ventura 13+.</li>
            <li>Check <strong className="text-ivory-100">FaceTime → Video</strong> menu. If the iPhone isn't there either, it's the phone or Mac setup above.</li>
            <li>If FaceTime shows it but this list doesn't, quit the browser completely (⌘Q) and reopen it, or try Safari.</li>
          </ol>
          <button
            type="button"
            onClick={() => { void lookAgain(); }}
            disabled={looking}
            className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 font-semibold text-white hover:bg-white/15 disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', looking && 'animate-spin')} /> {looking ? 'Looking…' : 'Look again'}
          </button>
          {cameras && (
            <p className="text-ivory-400" data-camera-report>
              {browserName()} reports {cameras.length === 0 ? 'no cameras' : cameras.length === 1 ? '1 camera' : `${cameras.length} cameras`}
              {cameras.length > 0 && <>: <span className="text-ivory-200">{cameras.map((c, i) => c.label || `Camera ${i + 1} (name hidden)`).join(', ')}</span></>}.
              {' '}If Google Meet lists your iPhone in this same browser and this doesn't after “Look again”, send us this line.
            </p>
          )}
          {looked && !looking && <p role="status" className="text-ivory-400">Still not showing. Work through the steps above, then look again. The list also updates by itself every few seconds.</p>}
        </div>
      )}
    </div>
  );
}
