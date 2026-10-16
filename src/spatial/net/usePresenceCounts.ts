import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { openChannel } from '@/lib/realtime';
import { mergePresence } from './protocol';

/**
 * How many people are in each space right now, for the Workspaces grid. Listens to each
 * space's presence without joining it (nothing is tracked, so you don't count yourself).
 */
export function usePresenceCounts(spaceIds: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = [...spaceIds].sort().join(',');

  useEffect(() => {
    if (!key) return;
    let stopped = false;
    const channels: RealtimeChannel[] = [];
    for (const id of key.split(',')) {
      void openChannel(`space:${id}`, { config: { presence: { key: '' } } }, () => stopped).then((ch) => {
        if (!ch) return;
        channels.push(ch);
        ch.on('presence', { event: 'sync' }, () => {
          const n = mergePresence(ch.presenceState() as unknown as Record<string, unknown[]>).length;
          setCounts((c) => (c[id] === n ? c : { ...c, [id]: n }));
        }).subscribe();
      });
    }
    return () => { stopped = true; channels.forEach((ch) => supabase.removeChannel(ch)); };
  }, [key]);

  return counts;
}
