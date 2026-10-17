import { createClient } from '@supabase/supabase-js';
import { tagsWrittenBy } from './cache/writes';
import { invalidateTags, queryClient } from './cache/withCache';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
// Supabase's newer Publishable key when it's set (Edge Functions accept only the newer keys),
// else the legacy anon key.
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
/** The public key the app talks to Supabase with (for the few direct fetches). */
export const supabaseKey: string = supabaseAnonKey;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

/** Every request goes through here: once a write lands, the cached reads of that table refresh. */
async function fetchAndRefresh(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const tags = tagsWrittenBy(url, method);
  if (tags === '*') void queryClient.invalidateQueries({ refetchType: 'none' });
  else invalidateTags(tags);
  return res;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchAndRefresh },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
