import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Camera, Mic, MicOff, Video, VideoOff, Volume2, AlertTriangle, RotateCw, Check, ShieldAlert, ArrowRight, Loader2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { HowellsLogo } from '@/components/layout/Sidebar';
import { useMediaCheck, type MediaCheck } from '@/spatial/media/useMediaCheck';
import { useMediaPrefs } from '@/spatial/media/useMediaPrefs';
import {
  HEAR_THRESHOLD, METER_SEGMENTS, chimeWav, detectBrowser, levelFromSamples, litSegments,
  permissionHelp, permissionHint, problemText, supportsSpeakerChoice, systemPermissionHelp, type DeviceProblem,
} from '@/spatial/media/devices';
import { cn } from '@/lib/utils';
import type { MediaPrefs } from '@/types';

// ---------------------------------------------------------------- pieces

function useBrowser() {
  return useMemo(() => {
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    return { ua, kind: detectBrowser(ua) };
  }, []);
}

const blocked = (p: DeviceProblem | null) => p === 'denied' || p === 'system_denied';

/** Live 12-segment microphone meter. Runs its own animation loop so the page doesn't re-render. */
export function LevelMeter({ analyser }: { analyser: AnalyserNode | null }) {
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);

  useEffect(() => {
    setLevel(0);
    if (!analyser) { setHeard(false); return; }
    const data = new Float32Array(analyser.fftSize);
    let raf = 0;
    let last = 0;
    let heardUntil = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 50) return; // ~20 updates a second is plenty for a meter
      last = t;
      analyser.getFloatTimeDomainData(data);
      const l = levelFromSamples(data);
      setLevel(l);
      if (l > HEAR_THRESHOLD) heardUntil = t + 1500;
      setHeard(t < heardUntil);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  const lit = litSegments(level);
  return (
    <div className="mt-2 flex items-center gap-3">
      <div className="flex flex-1 gap-1" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={METER_SEGMENTS} aria-valuenow={lit}>
        {Array.from({ length: METER_SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-2.5 flex-1 rounded-full transition-colors duration-75',
              i < lit ? (i >= METER_SEGMENTS - 2 ? 'bg-burgundy-500' : i >= METER_SEGMENTS - 4 ? 'bg-gold-500' : 'bg-gold-400') : 'bg-navy-50',
            )}
          />
        ))}
      </div>
      <span className={cn('flex w-36 shrink-0 items-center gap-1 text-xs font-semibold transition-opacity', heard ? 'text-green-700 opacity-100' : 'opacity-0')} aria-live="polite">
        {heard && <><Check className="h-3.5 w-3.5" /> We can hear you</>}
      </span>
    </div>
  );
}

function DeviceSelect({ id, label, icon: Icon, devices, value, onChange, disabled, fallback, children }: {
  id: string;
  label: string;
  icon: typeof Camera;
  devices: MediaDeviceInfo[];
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  fallback: string;
  children?: ReactNode;
}) {
  const options = devices.length ? devices : null;
  const current = options && value && options.some((d) => d.deviceId === value) ? value : options?.[0]?.deviceId ?? '';
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-navy-800">
        <Icon className="h-4 w-4 text-gold-600" /> {label}
      </label>
      <select id={id} className="input-field" value={current} disabled={disabled || !options} onChange={(e) => onChange(e.target.value)}>
        {options
          ? options.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>)
          : <option value="">{fallback}</option>}
      </select>
      {children}
    </div>
  );
}

function Problem({ problem, device, ua, kind, onRetry }: {
  problem: DeviceProblem;
  device: 'camera' | 'microphone';
  ua: string;
  kind: ReturnType<typeof detectBrowser>;
  onRetry: () => void;
}) {
  const help = problem === 'denied' ? permissionHelp(kind) : problem === 'system_denied' ? systemPermissionHelp(ua) : null;
  const canRetry = problem !== 'insecure' && problem !== 'unsupported';
  return (
    <div role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-burgundy-600">
      <p className="flex items-start gap-2 font-medium">
        {problem === 'insecure' ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1">{problemText(problem, device)}</span>
        {canRetry && (
          <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1 font-semibold underline-offset-2 hover:underline">
            <RotateCw className="h-3.5 w-3.5" /> Try again
          </button>
        )}
      </p>
      {help && <p className="mt-1 pl-6 text-xs leading-relaxed text-navy-700">{help}</p>}
    </div>
  );
}

function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-navy-800">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-ivory-700">{description}</span>}
      </span>
      <span className={cn('relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition', checked ? 'bg-gold-400' : 'bg-navy-100')}>
        <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
        <span className={cn('absolute h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
        <span className="absolute inset-0 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-gold-400/60" />
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- left: controls

export function DeviceControls({ check, prefs, onPrefs }: {
  check: MediaCheck;
  prefs: MediaPrefs;
  onPrefs: (patch: Partial<MediaPrefs>) => void;
}) {
  const { ua, kind } = useBrowser();
  const speakerChoice = supportsSpeakerChoice() && check.devices.speakers.length > 0;
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => {
    const a = audioRef.current;
    if (a) { a.pause(); URL.revokeObjectURL(a.src); }
  }, []);

  const playTest = async () => {
    try {
      let a = audioRef.current;
      if (!a) {
        a = new Audio(URL.createObjectURL(chimeWav()));
        a.onended = () => setPlaying(false);
        audioRef.current = a;
      }
      if (speakerChoice && check.selected.speaker) {
        await (a as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(check.selected.speaker).catch(() => {});
      }
      a.currentTime = 0;
      setPlaying(true);
      await a.play();
    } catch {
      setPlaying(false);
    }
  };

  const shared = check.cameraProblem === 'insecure' || check.cameraProblem === 'unsupported';

  return (
    <div className="space-y-5">
      {shared && <Problem problem={check.cameraProblem!} device="camera" ua={ua} kind={kind} onRetry={check.retry} />}

      <DeviceSelect
        id="dc-camera" label="Camera" icon={Camera}
        devices={check.devices.cameras} value={check.selected.camera} onChange={check.selectCamera}
        fallback={check.ready ? 'No camera found' : 'Looking for cameras…'}
      >
        {!shared && check.cameraProblem && <Problem problem={check.cameraProblem} device="camera" ua={ua} kind={kind} onRetry={check.retry} />}
      </DeviceSelect>

      <DeviceSelect
        id="dc-speaker" label="Speakers" icon={Volume2}
        devices={speakerChoice ? check.devices.speakers : []} value={check.selected.speaker} onChange={check.selectSpeaker}
        fallback="System default"
      >
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={playTest} className="btn-secondary !py-2 text-sm">
            <Volume2 className="h-4 w-4" /> {playing ? 'Playing…' : 'Play test sound'}
          </button>
          {!speakerChoice && <span className="text-xs text-ivory-700">This browser plays sound through your system's default output.</span>}
        </div>
      </DeviceSelect>

      <DeviceSelect
        id="dc-mic" label="Microphone" icon={Mic}
        devices={check.devices.microphones} value={check.selected.microphone} onChange={check.selectMicrophone}
        fallback={check.ready ? 'No microphone found' : 'Looking for microphones…'}
      >
        {check.micOn && !check.micProblem && <LevelMeter analyser={check.analyser} />}
        {!check.micOn && <p className="mt-2 text-xs text-ivory-700">Microphone is off. Turn it on in the preview to test it.</p>}
        {!shared && check.micProblem && <Problem problem={check.micProblem} device="microphone" ua={ua} kind={kind} onRetry={check.retry} />}
      </DeviceSelect>

      <div className="divide-y divide-navy-50 rounded-2xl border border-navy-100 px-4">
        <Switch label="Join with mic muted" checked={prefs.join_muted} onChange={(v) => onPrefs({ join_muted: v })} />
        <Switch label="Join with camera off" checked={prefs.join_camera_off} onChange={(v) => onPrefs({ join_camera_off: v })} />
        <Switch
          label="Data saver"
          description="Audio first, at most 2 small videos — good on mobile data."
          checked={prefs.data_saver}
          onChange={(v) => onPrefs({ data_saver: v })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- right: preview

export function DevicePreview({ check, name, firstName, lastName, avatarUrl }: {
  check: MediaCheck;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
}) {
  const { kind } = useBrowser();
  const videoRef = useRef<HTMLVideoElement>(null);
  const showVideo = check.cameraOn && !!check.video;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = check.video;
    if (check.video) el.play().catch(() => {});
  }, [check.video, showVideo]);

  const anyBlocked = blocked(check.cameraProblem) || blocked(check.micProblem);
  const micLive = check.micOn && !check.micProblem;

  return (
    <div className="text-white">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-navy-900 ring-1 ring-white/10">
        {showVideo ? (
          <video ref={videoRef} muted playsInline autoPlay aria-label="Your camera preview" className="h-full w-full -scale-x-100 object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_40%,rgba(228,169,60,0.16),transparent_60%)]">
            <Avatar firstName={firstName} lastName={lastName} src={avatarUrl} size="xl" className="!h-20 !w-20 !text-2xl ring-4 ring-white/10 sm:!h-24 sm:!w-24" />
            <p className="text-xs text-ivory-500">
              {!check.ready ? 'Starting your camera…' : check.cameraOn ? (check.cameraProblem ? 'Camera unavailable' : 'Starting your camera…') : 'Camera is off'}
            </p>
          </div>
        )}
        <span className="absolute bottom-3 left-3 flex max-w-[70%] items-center gap-1.5 rounded-full bg-navy-900/75 px-3 py-1 text-xs font-semibold backdrop-blur">
          {micLive ? <Mic className="h-3.5 w-3.5 text-gold-300" aria-label="Mic on" /> : <MicOff className="h-3.5 w-3.5 text-red-300" aria-label="Mic off" />}
          <span className="truncate">{name}</span>
        </span>
      </div>

      <div className="mt-4 flex justify-center gap-3">
        <RoundButton on={check.micOn} onClick={() => check.setMicOn(!check.micOn)} labelOn="Turn microphone off" labelOff="Turn microphone on" iconOn={Mic} iconOff={MicOff} />
        <RoundButton on={check.cameraOn} onClick={() => check.setCameraOn(!check.cameraOn)} labelOn="Turn camera off" labelOff="Turn camera on" iconOn={Video} iconOff={VideoOff} />
      </div>
      {anyBlocked && <p className="mt-3 text-center text-xs text-ivory-400">{permissionHint(kind)}</p>}
    </div>
  );
}

function RoundButton({ on, onClick, labelOn, labelOff, iconOn: On, iconOff: Off }: {
  on: boolean; onClick: () => void; labelOn: string; labelOff: string; iconOn: typeof Mic; iconOff: typeof Mic;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? labelOn : labelOff}
      title={on ? labelOn : labelOff}
      className={cn(
        'flex h-12 w-12 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400',
        on ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-burgundy-500 text-white hover:bg-burgundy-600',
      )}
    >
      {on ? <On className="h-5 w-5" /> : <Off className="h-5 w-5" />}
    </button>
  );
}

// ---------------------------------------------------------------- assembled

function useYou() {
  const { profile, user } = useAuth();
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email?.split('@')[0] || 'You';
  return { name, firstName: profile?.first_name, lastName: profile?.last_name, avatarUrl: profile?.avatar_url };
}

/** Controls on the left, navy preview on the right (stacked on phones, preview first). */
export function DeviceCheck({ active = true }: { active?: boolean }) {
  const check = useMediaCheck(active);
  const [prefs, setPrefs] = useMediaPrefs();
  const you = useYou();
  return (
    <div className="flex flex-col-reverse gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
      <DeviceControls check={check} prefs={prefs} onPrefs={setPrefs} />
      <div className="rounded-3xl bg-navy-800 p-4 sm:p-6 lg:self-start">
        <DevicePreview check={check} {...you} />
      </div>
    </div>
  );
}

/** "Check camera & mic" from the Workspaces page, and the settings modal inside a space. */
export function DeviceCheckModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Check your camera & mic"
      description="Make sure people can see and hear you when you walk over."
      size="xl"
      footer={<button type="button" onClick={onClose} className="btn-primary">Done</button>}
    >
      {open && <DeviceCheck />}
    </Modal>
  );
}

/** Full-screen "Get ready" before someone enters a space for the first time. */
export function GetReadyScreen({ spaceName, onEnter, onBack }: { spaceName: string; onEnter: () => Promise<void> | void; onBack: () => void }) {
  const [entering, setEntering] = useState(false);
  const enter = async () => {
    setEntering(true);
    try { await onEnter(); } finally { setEntering(false); }
  };
  return (
    <div className="fixed inset-0 z-[80] flex flex-col overflow-y-auto bg-white">
      <header className="flex items-center justify-between gap-3 px-4 pt-5 sm:px-8">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-800 text-white"><HowellsLogo className="h-5 w-5" /></span>
          <span className="text-lg font-bold tracking-wide text-navy-800">SYNAPSE</span>
        </div>
        <button type="button" onClick={onBack} className="btn-ghost !px-3 !py-2">Back to workspaces</button>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-6 pt-6 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-ivory-700">Get ready · Camera & mic</p>
        <h1 className="mt-2 break-words text-2xl font-bold text-navy-800 sm:text-[28px]">Check your camera & mic</h1>
        <p className="mb-6 mt-2 text-sm text-ivory-700 sm:text-base">Make sure people can see and hear you before you enter <strong className="text-navy-800">{spaceName}</strong>.</p>
        <DeviceCheck />
      </main>
      <footer className="sticky bottom-0 border-t border-navy-50 bg-white/95 px-4 py-3 backdrop-blur sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2">
          <div className="flex-1" />
          <button type="button" onClick={enter} disabled={entering} className="btn-ghost shrink-0 whitespace-nowrap !px-3">Skip for now</button>
          <button type="button" onClick={enter} disabled={entering} aria-label={`Enter ${spaceName}`} className="btn-primary min-w-0 !px-5">
            {entering && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
            <span className="truncate">Enter<span className="hidden sm:inline"> {spaceName}</span></span> <ArrowRight className="h-4 w-4 shrink-0" />
          </button>
        </div>
      </footer>
    </div>
  );
}
