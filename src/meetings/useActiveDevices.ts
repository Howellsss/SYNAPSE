import { useCallback, useEffect, useState } from 'react';
import type { Room } from 'livekit-client';
import { loadDeviceIds, saveDeviceIds, type DeviceIds } from '@/spatial/media/devices';

export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';
const KEY: Record<DeviceKind, keyof DeviceIds> = { audioinput: 'microphone', videoinput: 'camera', audiooutput: 'speaker' };

/**
 * Which camera, microphone and speaker the call is using, and switching between them mid-call
 * (e.g. from the Mac's camera to an iPhone). The choice is remembered for next time.
 */
export function useActiveDevices(room: Room | null) {
  const [active, setActive] = useState<Record<DeviceKind, string | undefined>>(() => {
    const s = loadDeviceIds();
    return { audioinput: s.microphone, videoinput: s.camera, audiooutput: s.speaker };
  });

  useEffect(() => {
    if (!room) return;
    const read = () => setActive((a) => ({
      audioinput: room.getActiveDevice('audioinput') ?? a.audioinput,
      videoinput: room.getActiveDevice('videoinput') ?? a.videoinput,
      audiooutput: room.getActiveDevice('audiooutput') ?? a.audiooutput,
    }));
    read();
    room.on('activeDeviceChanged', read);
    return () => { room.off('activeDeviceChanged', read); };
  }, [room]);

  const choose = useCallback(async (kind: DeviceKind, deviceId: string): Promise<boolean> => {
    if (!room) return false;
    const ok = await room.switchActiveDevice(kind, deviceId, true).then((r) => r !== false, () => false);
    if (ok) {
      setActive((a) => ({ ...a, [kind]: deviceId }));
      saveDeviceIds({ ...loadDeviceIds(), [KEY[kind]]: deviceId });
    }
    return ok;
  }, [room]);

  return { active, choose };
}
