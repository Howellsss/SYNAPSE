import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { supabase } from '@/lib/supabase';
import { TOPICS, type MeetingBus } from './useMeetingBus';
import { RECORDINGS_BUCKET, extFor, pickMimeType, recordingTitle } from './recording';

export type RecorderState = 'idle' | 'starting' | 'recording' | 'saving';

/**
 * Recording in the browser, the simple way: the host records this meeting tab (picture and
 * everyone's sound, plus their own microphone) with MediaRecorder. When they stop, the file is
 * saved to Recordings (storage bucket "meeting-recordings") and they can also download a copy.
 * Everyone in the meeting sees that it's being recorded.
 */

export interface Recorder {
  state: RecorderState;
  startedAt: number | null;
  /** Someone (the host) is recording this meeting. */
  someoneRecording: boolean;
  /** The last finished recording, for "Download a copy". */
  lastFile: { url: string; name: string } | null;
  supported: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

export function useRecorder({ bus, room, isHost, hostId, meetingId, meetingTitle, workspaceId, micTrack, transcript, notice }: {
  bus: MeetingBus; room: Room | null; isHost: boolean; hostId: string; meetingId: string; meetingTitle: string;
  /** The account the recording is saved to (members only). */
  workspaceId: string | null;
  micTrack: MediaStreamTrack | null;
  /** The captions transcript so far, saved with the recording. */
  transcript: () => string;
  notice: (msg: string, tone?: 'info' | 'error') => void;
}): Recorder {
  const [state, setState] = useState<RecorderState>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [remoteOn, setRemoteOn] = useState(false);
  const [lastFile, setLastFile] = useState<{ url: string; name: string } | null>(null);
  const parts = useRef<{ rec: MediaRecorder; display: MediaStream; ctx: AudioContext; dest: MediaStreamAudioDestinationNode; mics: Set<string> } | null>(null);
  const noticeRef = useRef(notice);
  noticeRef.current = notice;
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const supported = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  // Everyone else: is the host recording?
  useEffect(() => bus.on(TOPICS.record, (raw, from) => {
    if (from !== hostId || !raw || typeof raw !== 'object') return;
    const on = (raw as { on?: unknown }).on === true;
    setRemoteOn((was) => {
      if (on && !was) noticeRef.current('This meeting is being recorded.', 'info');
      if (!on && was) noticeRef.current('Recording stopped.', 'info');
      return on;
    });
  }), [bus, hostId]);
  const recordingRef = useRef(false);
  recordingRef.current = state === 'recording';
  useEffect(() => {
    if (!room || !isHost) return;
    const onJoin = (p: { identity: string }) => { if (recordingRef.current) void bus.send(TOPICS.record, { on: true }, { to: [p.identity] }); };
    room.on('participantConnected', onJoin);
    return () => { room.off('participantConnected', onJoin); };
  }, [room, isHost, bus]);

  // Your microphone joins the recording (again after you switch microphones).
  const addMic = useCallback((track: MediaStreamTrack | null) => {
    const p = parts.current;
    if (!p || !track || p.mics.has(track.id)) return;
    p.mics.add(track.id);
    p.ctx.createMediaStreamSource(new MediaStream([track])).connect(p.dest);
  }, []);
  useEffect(() => { addMic(micTrack); }, [micTrack, addMic]);

  const save = useCallback(async (blob: Blob, mime: string, began: number) => {
    const at = new Date(began);
    const name = `${recordingTitle(meetingTitle, at).replace(/[\\/:*?"<>|]/g, '-')}.${extFor(mime)}`;
    setLastFile((old) => { if (old) URL.revokeObjectURL(old.url); return { url: URL.createObjectURL(blob), name }; });
    const seconds = Math.max(1, Math.round((Date.now() - began) / 1000));
    if (!workspaceId) { noticeRef.current('Recording finished. Download your copy below.', 'info'); return; }
    const path = `${workspaceId}/${meetingId}-${began}.${extFor(mime)}`;
    const up = await supabase.storage.from(RECORDINGS_BUCKET).upload(path, blob, { contentType: mime.split(';')[0], upsert: false });
    if (up.error) {
      const big = /maximum allowed size|too large|413/i.test(up.error.message);
      const missing = /bucket not found|not found/i.test(up.error.message);
      noticeRef.current(
        big ? 'The recording is larger than your storage plan allows, so it wasn’t saved to Recordings. Download your copy instead.'
          : missing ? 'Recordings storage isn’t set up yet (database update needed). Download your copy instead.'
            : `Couldn’t save the recording to Recordings (${up.error.message}). Download your copy instead.`,
        'error',
      );
      return;
    }
    const text = transcriptRef.current().trim();
    const { error } = await supabase.from('recordings').insert({
      workspace_id: workspaceId,
      meeting_id: meetingId,
      title: recordingTitle(meetingTitle, at),
      duration_seconds: seconds,
      media_url: `${RECORDINGS_BUCKET}/${path}`,
      transcript: text || null,
      status: 'ready',
    });
    if (error) {
      // Before the database update there's no meeting_id column: save without it.
      const retry = /meeting_id/.test(error.message)
        ? await supabase.from('recordings').insert({ workspace_id: workspaceId, title: recordingTitle(meetingTitle, at), duration_seconds: seconds, media_url: `${RECORDINGS_BUCKET}/${path}`, transcript: text || null, status: 'ready' })
        : { error };
      if (retry.error) { noticeRef.current(`The file was saved, but adding it to Recordings failed (${retry.error.message}).`, 'error'); return; }
    }
    noticeRef.current('Recording saved to Recordings.', 'info');
  }, [workspaceId, meetingId, meetingTitle]);

  const stop = useCallback(() => {
    const p = parts.current;
    if (!p || p.rec.state === 'inactive') return;
    setState('saving');
    p.rec.stop();
  }, []);

  const start = useCallback(async () => {
    if (!isHost || parts.current) return;
    if (!supported) { noticeRef.current('Recording needs Chrome, Edge or Safari on a computer.', 'error'); return; }
    setState('starting');
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 24 },
        audio: true,
        // Ask the browser to offer this tab first, with its sound.
        preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include', surfaceSwitching: 'exclude',
      } as DisplayMediaStreamOptions);
    } catch {
      setState('idle');
      noticeRef.current('Recording didn’t start. To record, choose this tab and tick “Share tab audio”.', 'info');
      return;
    }
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    for (const t of display.getAudioTracks()) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest);
    const mime = pickMimeType();
    const stream = new MediaStream([...display.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 700_000, audioBitsPerSecond: 64_000 } : undefined);
    const chunks: Blob[] = [];
    const began = Date.now();
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      display.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
      parts.current = null;
      setStartedAt(null);
      void bus.send(TOPICS.record, { on: false });
      const type = rec.mimeType || mime || 'video/webm';
      void save(new Blob(chunks, { type }), type, began).finally(() => setState('idle'));
    };
    parts.current = { rec, display, ctx, dest, mics: new Set() };
    addMic(micTrack);
    // The browser's own "Stop sharing" button stops the recording too.
    display.getVideoTracks()[0]?.addEventListener('ended', () => stop());
    if (!display.getAudioTracks().length) noticeRef.current('Recording without the meeting’s sound: next time tick “Share tab audio”. Your microphone is still recorded.', 'info');
    rec.start(1000);
    setStartedAt(began);
    setState('recording');
    void bus.send(TOPICS.record, { on: true });
  }, [isHost, supported, micTrack, addMic, bus, save, stop]);

  // Leaving the meeting while recording: finish and save.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => () => { stopRef.current(); }, []);

  return { state, startedAt, someoneRecording: remoteOn || state === 'recording', lastFile, supported, start, stop };
}
