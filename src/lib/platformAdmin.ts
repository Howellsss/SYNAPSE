import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

const cache = new Map<string, boolean>();

/**
 * Whether you run SYNAPSE itself (the platform_admins list), as opposed to owning a workspace.
 * SYNAPSE admins manage the shared character library. Null while checking.
 * Before the library migration is installed, workspace owners and admins count, as before.
 */
export function usePlatformAdmin(): boolean | null {
  const { user, canManageTeam } = useAuth();
  const [value, setValue] = useState<boolean | null>(user ? cache.get(user.id) ?? null : false);

  useEffect(() => {
    if (!user) { setValue(false); return; }
    if (cache.has(user.id)) { setValue(cache.get(user.id)!); return; }
    let alive = true;
    supabase.rpc('is_platform_admin').then(({ data, error }) => {
      const result = error ? canManageTeam : data === true;
      if (!error) cache.set(user.id, result);
      if (alive) setValue(result);
    });
    return () => { alive = false; };
  }, [user, canManageTeam]);

  return value;
}
