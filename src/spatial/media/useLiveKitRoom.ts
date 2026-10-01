import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalTrack, Participant, RemoteParticipant, Room } from 'livekit-client';
import { supabase } from '@/lib/supabase';
import { classifyMediaError, loadDeviceIds, type DeviceProblem } from './devices';
import type { MediaPrefs } from '@/types';

export type CallState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'unavailable';
export type Quality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';
export type CallDevice = 'microphone' | 'camera' | 'screen';

export interface RemoteInfo {
  identity: string;
  name: string;
  isSpeaking: boolean;
  quality: Quality;
  hasMic: boolean;
  hasCamera: boolean;
  hasScreen: boolean;
}

export interface DeviceIssue {
  device: CallDevice;
  problem: DeviceProblem;
}

export interface LiveKitRoom {
  state: CallState;
  /** Why calls are unavailable or disconnected, in plain words. */
  error: string | null;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  /** A toggle is in progress (button shows busy). */
  pending: Partial<Record<CallDevice, boolean>>;
  localTracks: { microphone: LocalTrack | null; camera: LocalTrack | null; screen: LocalTrack | null };
  remoteParticipants: RemoteInfo[];
  /** Identities of who's talking, loudest first. */
  activeSpeakers: string[];
  /** Your own connection quality. */
  connectionQuality: Quality;
  deviceIssue: DeviceIssue | null;
  /** The LiveKit room, for proximity subscriptions (Prompt 10). */
  room: Room | null;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  /** Use the devices saved by the camera & mic check. */
  applySavedDevices: () => Promise<void>;
  clearDeviceIssue: () => void;
  retry: () => void;
}

interface Options {
  prefs: MediaPrefs;
  /** Short messages for a toast ("Switched to AirPods"). */
  onNotice?: (message: string, tone?: 'info' | 'error') => void;
}

const RETRY_DELAYS = [2000, 5000, 10000];

/** Error text from the livekit-token function, or a plain explanation. */
async function tokenError(err: unknown): Promise<string> {
  const ctx = (err as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.status === 'number') {
    if (ctx.status === 404) return "Audio and video aren't set up for this SYNAPSE yet.";
    try {
      const body = await ctx.clone().json();
      if (body?.error) return /Missing secret/.test(body.error) ? "Audio and video aren't set up for this SYNAPSE yet." : body.error;
    } catch { /* not JSON */ }
    if (ctx.status === 401) return 'Please sign in again to use audio and video.';
    if (ctx.status === 403) return "You don't have access to audio and video in this workspace.";
  }
  return "Couldn't reach the audio and video service.";
}

/**
 * One LiveKit room per space (`space_<spaceId>`). Connects with adaptive stream and dynacast,
 * subscribes to nothing by itself (proximity decides who you hear and see), and publishes your
 * mic and camera according to your join preferences.
 */
export function useLiveKitRoom(spaceId: string | null, { prefs, onNotice }: Options): LiveKitRoom {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [tick, setTick] = useState(0); // bumps when tracks/participants change
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>([]);
  const [connectionQuality, setQuality] = useState<Quality>('unknown');
  const [deviceIssue, setDeviceIssue] = useState<DeviceIssue | null>(null);
  const [pending, setPending] = useState<Partial<Record<CallDevice, boolean>>>({});
  const [attempt, setAttempt] = useState(0);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const notice = useRef(onNotice);
  notice.current = onNotice;
  const retries = useRef(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!spaceId) return;
    let alive = true;
    let current: Room | null = null;
    let retryTimer = 0;
    setState('connecting');
    setError(null);

    (async () => {
      const lk = await import('livekit-client');
      const { data, error: fnError } = await supabase.functions.invoke<{ token: string; url: string }>('livekit-token', { body: { spaceId } });
      if (!alive) return;
      if (fnError || !data?.token || !data?.url) {
        setError(await tokenError(fnError));
        setState('unavailable');
        return;
      }

      const saved = loadDeviceIds();
      const r = new lk.Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: { deviceId: saved.microphone, echoCancellation: true, noiseSuppression: true },
        videoCaptureDefaults: {
          deviceId: saved.camera,
          resolution: prefsRef.current.data_saver ? lk.VideoPresets.h180.resolution : lk.VideoPresets.h540.resolution,
        },
        audioOutput: saved.speaker ? { deviceId: saved.speaker } : undefined,
      });
      current = r;

      const E = lk.RoomEvent;
      r.on(E.ConnectionStateChanged, (s) => {
        if (s === lk.ConnectionState.Connected) { setState('connected'); retries.current = 0; }
        else if (s === lk.ConnectionState.Reconnecting || s === lk.ConnectionState.SignalReconnecting) setState('reconnecting');
        bump();
      })
        .on(E.Disconnected, (reason) => {
          if (!alive) return;
          setRoom(null);
          if (reason === lk.DisconnectReason.CLIENT_INITIATED) return;
          if (reason === lk.DisconnectReason.DUPLICATE_IDENTITY) {
            setError('You joined from another tab or device, so audio and video moved there.');
            setState('disconnected');
            return;
          }
          if (reason === lk.DisconnectReason.PARTICIPANT_REMOVED || reason === lk.DisconnectReason.ROOM_DELETED) {
            setError('You were removed from the call.');
            setState('disconnected');
            return;
          }
          // Lost the connection for good: try again a few times before asking.
          const delay = RETRY_DELAYS[retries.current];
          setState('disconnected');
          setError('Audio and video disconnected.');
          if (delay !== undefined) {
            retries.current += 1;
            retryTimer = window.setTimeout(() => setAttempt((n) => n + 1), delay);
          }
        })
        .on(E.ParticipantConnected, bump)
        .on(E.ParticipantDisconnected, bump)
        .on(E.TrackPublished, bump)
        .on(E.TrackUnpublished, bump)
        .on(E.TrackMuted, bump)
        .on(E.TrackUnmuted, bump)
        .on(E.LocalTrackPublished, (pub) => {
          bump();
          // A track ends when its device is unplugged or permission is taken away mid-call.
          pub.track?.once('ended', () => handleEnded(pub.source === lk.Track.Source.Camera ? 'camera' : pub.source === lk.Track.Source.ScreenShare ? 'screen' : 'microphone'));
        })
        .on(E.LocalTrackUnpublished, bump)
        .on(E.ActiveSpeakersChanged, (speakers: Participant[]) => setActiveSpeakers(speakers.map((p) => p.identity)))
        .on(E.ConnectionQualityChanged, (q, p) => {
          if (p.identity === r.localParticipant.identity) setQuality(q as Quality);
          bump();
        })
        .on(E.MediaDevicesError, (err, kind) => {
          const device: CallDevice = kind === 'videoinput' ? 'camera' : 'microphone';
          setDeviceIssue({ device, problem: classifyMediaError(err) });
          bump();
        })
        .on(E.MediaDevicesChanged, () => { followDevices(); });

      async function followDevices() {
        for (const [kind, label] of [['audioinput', 'microphone'], ['videoinput', 'camera']] as const) {
          const active = r.getActiveDevice(kind);
          if (!active || active === 'default') continue;
          const list = await lk.Room.getLocalDevices(kind, false).catch(() => [] as MediaDeviceInfo[]);
          if (list.length && !list.some((d) => d.deviceId === active)) {
            const next = list.find((d) => d.deviceId === 'default') ?? list[0];
            const okSwitch = await r.switchActiveDevice(kind, next.deviceId).catch(() => false);
            if (okSwitch) notice.current?.(`Your ${label} was disconnected. Switched to ${next.label || 'the default one'}.`);
            bump();
          }
        }
      }

      async function handleEnded(device: CallDevice) {
        if (!alive) return;
        if (device === 'screen') {
          await r.localParticipant.setScreenShareEnabled(false).catch(() => {});
          bump();
          return;
        }
        // Try the default device once; if that fails too, explain why.
        try {
          if (device === 'microphone') {
            await r.localParticipant.setMicrophoneEnabled(false);
            await r.localParticipant.setMicrophoneEnabled(true, { deviceId: 'default' });
          } else {
            await r.localParticipant.setCameraEnabled(false);
            await r.localParticipant.setCameraEnabled(true, { deviceId: 'default' });
          }
          notice.current?.(`Your ${device} stopped. Switched to the default one.`);
        } catch (err) {
          await (device === 'microphone' ? r.localParticipant.setMicrophoneEnabled(false) : r.localParticipant.setCameraEnabled(false)).catch(() => {});
          setDeviceIssue({ device, problem: classifyMediaError(err) });
        }
        bump();
      }

      try {
        await r.connect(data.url, data.token, { autoSubscribe: false });
      } catch (err) {
        if (!alive) return;
        console.warn('LiveKit connect failed', err);
        setError("Couldn't connect audio and video. Check your connection.");
        setState('disconnected');
        const delay = RETRY_DELAYS[retries.current];
        if (delay !== undefined) {
          retries.current += 1;
          retryTimer = window.setTimeout(() => setAttempt((n) => n + 1), delay);
        }
        return;
      }
      if (!alive) { r.disconnect(); return; }
      setRoom(r);
      setState('connected');
      setError(null);
      setQuality((r.localParticipant.connectionQuality as Quality) ?? 'unknown');

      // Join the way the person chose in "Check your camera & mic".
      const p = prefsRef.current;
      if (!p.join_muted) {
        await r.localParticipant.setMicrophoneEnabled(true).catch((err) => setDeviceIssue({ device: 'microphone', problem: classifyMediaError(err) }));
      }
      if (!p.join_camera_off) {
        await r.localParticipant.setCameraEnabled(true).catch((err) => setDeviceIssue({ device: 'camera', problem: classifyMediaError(err) }));
      }
      bump();
    })();

    return () => {
      alive = false;
      window.clearTimeout(retryTimer);
      // Disconnecting stops every local track, so no camera light stays on.
      current?.disconnect();
      setRoom(null);
    };
  }, [spaceId, attempt, bump]);

  // Permission taken away in browser settings while in the call.
  useEffect(() => {
    if (!room || !navigator.permissions?.query) return;
    const watchers: PermissionStatus[] = [];
    let alive = true;
    (['microphone', 'camera'] as const).forEach((name) => {
      navigator.permissions.query({ name: name as PermissionName }).then((status) => {
        if (!alive) return;
        watchers.push(status);
        status.onchange = () => {
          if (status.state !== 'denied') return;
          const lp = room.localParticipant;
          (name === 'microphone' ? lp.setMicrophoneEnabled(false) : lp.setCameraEnabled(false)).catch(() => {});
          setDeviceIssue({ device: name, problem: 'denied' });
          bump();
        };
      }).catch(() => { /* Firefox doesn't support camera/microphone here */ });
    });
    return () => { alive = false; watchers.forEach((w) => { w.onchange = null; }); };
  }, [room, bump]);

  const lp = room?.localParticipant;
  const micOn = !!lp?.isMicrophoneEnabled;
  const camOn = !!lp?.isCameraEnabled;
  const screenOn = !!lp?.isScreenShareEnabled;

  const run = useCallback(async (device: CallDevice, fn: () => Promise<unknown>) => {
    if (!room) {
      notice.current?.(error ?? 'Audio and video are still connecting.', 'error');
      return;
    }
    setPending((s) => ({ ...s, [device]: true }));
    try {
      await fn();
      setDeviceIssue((d) => (d?.device === device ? null : d));
    } catch (err) {
      const problem = classifyMediaError(err);
      // Cancelling the screen picker isn't a problem.
      if (!(device === 'screen' && problem === 'denied')) setDeviceIssue({ device, problem });
    } finally {
      setPending((s) => ({ ...s, [device]: false }));
      bump();
    }
  }, [room, error, bump]);

  const toggleMic = useCallback(() => run('microphone', () => room!.localParticipant.setMicrophoneEnabled(!room!.localParticipant.isMicrophoneEnabled)), [run, room]);
  const toggleCam = useCallback(() => run('camera', () => room!.localParticipant.setCameraEnabled(!room!.localParticipant.isCameraEnabled)), [run, room]);
  const startScreenShare = useCallback(() => run('screen', () => room!.localParticipant.setScreenShareEnabled(true, { audio: true })), [run, room]);
  const stopScreenShare = useCallback(() => run('screen', () => room!.localParticipant.setScreenShareEnabled(false)), [run, room]);

  const applySavedDevices = useCallback(async () => {
    if (!room) return;
    const ids = loadDeviceIds();
    if (ids.microphone) await room.switchActiveDevice('audioinput', ids.microphone).catch(() => {});
    if (ids.camera) await room.switchActiveDevice('videoinput', ids.camera).catch(() => {});
    if (ids.speaker) await room.switchActiveDevice('audiooutput', ids.speaker).catch(() => {});
    bump();
  }, [room, bump]);

  const retry = useCallback(() => {
    retries.current = 0;
    setAttempt((n) => n + 1);
  }, []);

  // Derived each render (tick forces a re-render when LiveKit state changes).
  void tick;
  const remoteParticipants: RemoteInfo[] = room
    ? [...room.remoteParticipants.values()].map((p: RemoteParticipant) => ({
      identity: p.identity,
      name: p.name || p.identity,
      isSpeaking: p.isSpeaking,
      quality: p.connectionQuality as Quality,
      hasMic: p.isMicrophoneEnabled,
      hasCamera: p.isCameraEnabled,
      hasScreen: p.isScreenShareEnabled,
    }))
    : [];
  const trackOf = (source: 'microphone' | 'camera' | 'screen_share') =>
    ([...(lp?.trackPublications.values() ?? [])].find((t) => t.source === source)?.track as LocalTrack | undefined) ?? null;

  return {
    state, error, micOn, camOn, screenOn, pending,
    localTracks: { microphone: trackOf('microphone'), camera: trackOf('camera'), screen: trackOf('screen_share') },
    remoteParticipants, activeSpeakers, connectionQuality, deviceIssue, room,
    toggleMic, toggleCam, startScreenShare, stopScreenShare, applySavedDevices,
    clearDeviceIssue: () => setDeviceIssue(null),
    retry,
  };
}
