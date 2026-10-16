import type { RealtimeChannel, RealtimeChannelOptions } from '@supabase/supabase-js';
import { supabase } from './supabase';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A new channel for `name`, once any channel already open on it has gone. supabase-js hands back
 * an existing channel with the same name instead of making a new one, even one that's still
 * leaving (the Workspaces grid listens to each space's presence on the space's own channel, and
 * entering a space closes it), and that one never joins again. And when the last channel goes,
 * the connection closes, and a channel that subscribes meanwhile is never joined: so this also
 * waits for that to finish (subscribing then opens a new connection).
 * Resolves to null if `cancelled()` turns true meanwhile.
 */
export async function openChannel(name: string, opts: RealtimeChannelOptions, cancelled: () => boolean): Promise<RealtimeChannel | null> {
  const topic = `realtime:${name}`;
  const client = supabase.realtime as unknown as { isDisconnecting?: () => boolean };
  const busy = () => supabase.getChannels().some((c) => c.topic === topic) || client.isDisconnecting?.() === true;
  // Whoever opened the old channel is closing it; after 3 s, close it here.
  for (let waited = 0; busy(); waited += 50) {
    if (waited === 3000) supabase.getChannels().filter((c) => c.topic === topic).forEach((c) => void supabase.removeChannel(c));
    if (waited > 6000) break;
    await pause(50);
    if (cancelled()) return null;
  }
  if (cancelled()) return null;
  return supabase.channel(name, opts);
}
