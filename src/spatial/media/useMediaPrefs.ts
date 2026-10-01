import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { saveMediaPrefs } from '@/lib/spaces';
import { normalizeMediaPrefs } from './devices';
import type { MediaPrefs } from '@/types';

/** The join toggles, saved to profiles.media_prefs as they change. */
export function useMediaPrefs() {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<MediaPrefs>(() => normalizeMediaPrefs(profile?.media_prefs));
  const saving = useRef(0);

  const update = useCallback(async (patch: Partial<MediaPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (!user) return;
    const n = ++saving.current;
    const error = await saveMediaPrefs(user.id, next);
    if (n !== saving.current) return;
    if (error) toast(`Couldn't save that setting. ${error}`, 'error');
    else refreshProfile();
  }, [prefs, user, toast, refreshProfile]);

  return [prefs, update] as const;
}
