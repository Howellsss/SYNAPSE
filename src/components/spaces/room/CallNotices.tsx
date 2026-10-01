import { useMemo } from 'react';
import { AlertTriangle, Loader2, RotateCw, Settings2, VideoOff, X } from 'lucide-react';
import { detectBrowser, permissionHelp, problemText, systemPermissionHelp } from '@/spatial/media/devices';
import type { LiveKitRoom } from '@/spatial/media/useLiveKitRoom';

/** Small cards above the control bar: audio/video connection problems and device problems. */
export function CallNotices({ call, onOpenSettings }: { call: LiveKitRoom; onOpenSettings: () => void }) {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browser = useMemo(() => detectBrowser(ua), [ua]);
  const issue = call.deviceIssue;

  const issueText = issue
    ? issue.device === 'screen'
      ? issue.problem === 'unsupported' ? "This browser can't share your screen." : "Couldn't share your screen. Try again."
      : problemText(issue.problem, issue.device)
    : null;
  const issueHelp = issue && issue.device !== 'screen'
    ? issue.problem === 'denied' ? permissionHelp(browser) : issue.problem === 'system_denied' ? systemPermissionHelp(ua) : null
    : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[11rem] flex flex-col items-center gap-2 px-3 sm:bottom-20">
      {call.state === 'reconnecting' && (
        <p role="status" className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-navy-900/90 px-4 py-2 text-sm font-semibold text-white shadow-popover">
          <Loader2 className="h-4 w-4 animate-spin text-gold-400" /> Reconnecting audio & video…
        </p>
      )}
      {(call.state === 'unavailable' || call.state === 'disconnected') && call.error && (
        <div role="alert" className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-navy-800 shadow-popover">
          <VideoOff className="h-5 w-5 shrink-0 text-burgundy-500" />
          <p className="min-w-0 flex-1">{call.error} <span className="text-ivory-700">You can still see who's here.</span></p>
          <button type="button" onClick={call.retry} className="inline-flex shrink-0 items-center gap-1 font-semibold text-gold-700 hover:text-gold-600">
            <RotateCw className="h-4 w-4" /> Try again
          </button>
        </div>
      )}
      {issue && issueText && (
        <div role="alert" className="pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-navy-800 shadow-popover">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-burgundy-500" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{issueText}</p>
            {issueHelp && <p className="mt-1 text-xs leading-relaxed text-ivory-700">{issueHelp}</p>}
            {issue.device !== 'screen' && (
              <button type="button" onClick={onOpenSettings} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-gold-700 hover:text-gold-600">
                <Settings2 className="h-3.5 w-3.5" /> Check camera & mic
              </button>
            )}
          </div>
          <button type="button" onClick={call.clearDeviceIssue} aria-label="Dismiss" className="rounded-lg p-1 text-ivory-700 hover:bg-ivory-50"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}
