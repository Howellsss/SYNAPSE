import { useCallback, useEffect, useRef, useState } from 'react';
import {
  classifyMediaError, loadDeviceIds, mediaSupport, pickDevice, saveDeviceIds,
  type DeviceIds, type DeviceProblem,
} from './devices';

export interface DeviceLists {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

export interface MediaCheck {
  /** False until the first permission request has finished. */
  ready: boolean;
  devices: DeviceLists;
  selected: DeviceIds;
  cameraOn: boolean;
  micOn: boolean;
  video: MediaStream | null;
  analyser: AnalyserNode | null;
  cameraProblem: DeviceProblem | null;
  micProblem: DeviceProblem | null;
  setCameraOn: (on: boolean) => void;
  setMicOn: (on: boolean) => void;
  selectCamera: (id: string) => void;
  selectMicrophone: (id: string) => void;
  selectSpeaker: (id: string) => void;
  retry: () => void;
  /** Look for newly connected devices (e.g. an iPhone camera) now. */
  refreshDevices: () => Promise<void>;
}

const EMPTY: DeviceLists = { cameras: [], microphones: [], speakers: [] };

function stopStream(s: MediaStream | null) {
  s?.getTracks().forEach((t) => t.stop());
}

const videoConstraints = (id?: string, exact = false): MediaTrackConstraints => ({
  width: { ideal: 1280 }, height: { ideal: 720 }, ...(id ? { deviceId: exact ? { exact: id } : { ideal: id } } : {}),
});
const audioConstraints = (id?: string, exact = false): MediaTrackConstraints => ({
  echoCancellation: true, noiseSuppression: true, ...(id ? { deviceId: exact ? { exact: id } : { ideal: id } } : {}),
});

/**
 * Camera and microphone for the device check. While `active` it holds the streams;
 * when it becomes inactive or unmounts, every track is stopped so no camera light stays on.
 */
/** `initial` sets whether the camera and mic start on (both on by default). */
export function useMediaCheck(active: boolean, initial: { cam?: boolean; mic?: boolean } = {}): MediaCheck {
  const [ready, setReady] = useState(false);
  const [devices, setDevices] = useState<DeviceLists>(EMPTY);
  const [selected, setSelected] = useState<DeviceIds>(() => loadDeviceIds());
  const [cameraOn, setCameraOnState] = useState(initial.cam ?? true);
  const [micOn, setMicOnState] = useState(initial.mic ?? true);
  const [video, setVideo] = useState<MediaStream | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [cameraProblem, setCameraProblem] = useState<DeviceProblem | null>(null);
  const [micProblem, setMicProblem] = useState<DeviceProblem | null>(null);
  const [attempt, setAttempt] = useState(0);

  const videoRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const aliveRef = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const remember = useCallback((patch: DeviceIds) => {
    setSelected((s) => {
      const next = { ...s, ...patch };
      saveDeviceIds(next);
      return next;
    });
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      if (!aliveRef.current) return;
      // Before permission, browsers return devices without ids or labels; they're no use in a select.
      const real = all.filter((d) => d.deviceId);
      setDevices({
        cameras: real.filter((d) => d.kind === 'videoinput'),
        microphones: real.filter((d) => d.kind === 'audioinput'),
        speakers: real.filter((d) => d.kind === 'audiooutput'),
      });
    } catch { /* keep the old list */ }
  }, []);

  const releaseVideo = useCallback(() => {
    stopStream(videoRef.current);
    videoRef.current = null;
    setVideo(null);
  }, []);

  const releaseAudio = useCallback(() => {
    stopStream(audioRef.current);
    audioRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    setAnalyser(null);
  }, []);

  const attachVideo = useCallback((stream: MediaStream) => {
    if (!aliveRef.current) { stopStream(stream); return; }
    stopStream(videoRef.current);
    videoRef.current = stream;
    setVideo(stream);
    setCameraProblem(null);
    const id = stream.getVideoTracks()[0]?.getSettings().deviceId;
    if (id) remember({ camera: id });
    // Unplugging the camera ends the track; show it as missing rather than a frozen frame.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (videoRef.current === stream) { videoRef.current = null; setVideo(null); }
    });
  }, [remember]);

  const attachAudio = useCallback((stream: MediaStream) => {
    if (!aliveRef.current) { stopStream(stream); return; }
    releaseAudio();
    audioRef.current = stream;
    setMicProblem(null);
    const id = stream.getAudioTracks()[0]?.getSettings().deviceId;
    if (id) remember({ microphone: id });
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const node = ctx.createAnalyser();
      node.fftSize = 1024;
      node.smoothingTimeConstant = 0.3;
      ctx.createMediaStreamSource(stream).connect(node);
      ctxRef.current = ctx;
      ctx.resume().catch(() => {});
      setAnalyser(node);
    } catch { /* the meter is optional; the mic still works */ }
  }, [releaseAudio, remember]);

  const startCamera = useCallback(async (id?: string, exact = false) => {
    try {
      attachVideo(await navigator.mediaDevices.getUserMedia({ video: videoConstraints(id, exact) }));
    } catch (err) {
      if (!aliveRef.current) return;
      releaseVideo();
      setCameraProblem(classifyMediaError(err));
    }
    refreshDevices();
  }, [attachVideo, releaseVideo, refreshDevices]);

  const startMic = useCallback(async (id?: string, exact = false) => {
    try {
      attachAudio(await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(id, exact) }));
    } catch (err) {
      if (!aliveRef.current) return;
      releaseAudio();
      setMicProblem(classifyMediaError(err));
    }
    refreshDevices();
  }, [attachAudio, releaseAudio, refreshDevices]);

  // Start (one permission prompt for both) when the check opens; stop everything when it closes.
  useEffect(() => {
    if (!active) return;
    aliveRef.current = true;
    setReady(false);
    const support = mediaSupport();
    if (support !== 'ok') {
      setCameraProblem(support);
      setMicProblem(support);
      setReady(true);
      return () => { aliveRef.current = false; };
    }
    const saved = selectedRef.current;
    (async () => {
      const wantVideo = cameraOn;
      const wantAudio = micOn;
      if (wantVideo || wantAudio) {
        try {
          const both = await navigator.mediaDevices.getUserMedia({
            video: wantVideo ? videoConstraints(saved.camera) : false,
            audio: wantAudio ? audioConstraints(saved.microphone) : false,
          });
          if (!aliveRef.current) { stopStream(both); return; }
          const v = both.getVideoTracks();
          const a = both.getAudioTracks();
          if (v.length) attachVideo(new MediaStream(v));
          if (a.length) attachAudio(new MediaStream(a));
        } catch {
          // Ask separately so each device gets its own explanation (e.g. camera busy, mic fine).
          if (!aliveRef.current) return;
          await Promise.all([wantVideo && startCamera(saved.camera), wantAudio && startMic(saved.microphone)]);
        }
      }
      if (!aliveRef.current) return;
      await refreshDevices();
      setReady(true);
    })();

    const onDeviceChange = () => refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', onDeviceChange);
    // Coming back after setting up a phone, and a fallback for browsers that miss devicechange
    // (Continuity Camera sometimes doesn't fire it).
    const onVisible = () => { if (document.visibilityState === 'visible') refreshDevices(); };
    window.addEventListener('focus', onDeviceChange);
    document.addEventListener('visibilitychange', onVisible);
    const poll = window.setInterval(onDeviceChange, 4000);
    // Leaving the page (closing the tab, bfcache) must also turn the camera light off.
    const onPageHide = () => { releaseVideo(); releaseAudio(); };
    window.addEventListener('pagehide', onPageHide);
    // Some browsers keep a new AudioContext suspended until the person clicks something.
    const resume = () => { ctxRef.current?.resume().catch(() => {}); };
    window.addEventListener('pointerdown', resume);
    return () => {
      aliveRef.current = false;
      navigator.mediaDevices.removeEventListener?.('devicechange', onDeviceChange);
      window.removeEventListener('focus', onDeviceChange);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(poll);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pointerdown', resume);
      releaseVideo();
      releaseAudio();
    };
    // Toggles are handled by setCameraOn/setMicOn; this runs once per opening (and on Try again).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, attempt]);

  // If the chosen device is unplugged, fall back to another one.
  useEffect(() => {
    if (!active || !ready) return;
    if (cameraOn && videoRef.current && selected.camera && devices.cameras.length && !devices.cameras.some((d) => d.deviceId === selected.camera)) {
      startCamera(pickDevice(devices.cameras));
    }
    if (micOn && audioRef.current && selected.microphone && devices.microphones.length && !devices.microphones.some((d) => d.deviceId === selected.microphone)) {
      startMic(pickDevice(devices.microphones));
    }
  }, [active, ready, devices, selected.camera, selected.microphone, cameraOn, micOn, startCamera, startMic]);

  const setCameraOn = useCallback((on: boolean) => {
    setCameraOnState(on);
    if (!on) { releaseVideo(); setCameraProblem(null); return; }
    if (mediaSupport() === 'ok') startCamera(selectedRef.current.camera);
  }, [releaseVideo, startCamera]);

  const setMicOn = useCallback((on: boolean) => {
    setMicOnState(on);
    if (!on) { releaseAudio(); setMicProblem(null); return; }
    if (mediaSupport() === 'ok') startMic(selectedRef.current.microphone);
  }, [releaseAudio, startMic]);

  const selectCamera = useCallback((id: string) => {
    remember({ camera: id });
    if (cameraOn) startCamera(id, true);
  }, [cameraOn, remember, startCamera]);

  const selectMicrophone = useCallback((id: string) => {
    remember({ microphone: id });
    if (micOn) startMic(id, true);
  }, [micOn, remember, startMic]);

  const selectSpeaker = useCallback((id: string) => remember({ speaker: id }), [remember]);

  const retry = useCallback(() => {
    setCameraProblem(null);
    setMicProblem(null);
    setCameraOnState(true);
    setMicOnState(true);
    setAttempt((n) => n + 1);
  }, []);

  return {
    ready, devices, selected, cameraOn, micOn, video, analyser, cameraProblem, micProblem,
    setCameraOn, setMicOn, selectCamera, selectMicrophone, selectSpeaker, retry, refreshDevices,
  };
}
