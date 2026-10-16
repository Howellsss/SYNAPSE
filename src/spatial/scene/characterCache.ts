/**
 * Character files kept on this device, so people appear as their characters straight away.
 * The files come from short-lived signed links that change every visit, which the browser can't
 * cache by itself; here each file is stored under its own stable key (path and size) instead.
 */

import { characterLibrary } from '@/lib/characters';
import { chosenCharacterId, pickSpaceCharacter } from './avatarClips';

const CACHE_NAME = 'synapse-characters-v1';
const inMemory = new Map<string, Promise<ArrayBuffer>>();

const cacheRequest = (key: string) => new Request(`${location.origin}/__synapse-character/${encodeURIComponent(key)}`);

async function fromDevice(key: string): Promise<ArrayBuffer | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheRequest(key));
    return hit ? await hit.arrayBuffer() : null;
  } catch { return null; }
}

async function keepOnDevice(key: string, data: ArrayBuffer) {
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheRequest(key), new Response(data, { headers: { 'Content-Type': 'model/gltf-binary' } }));
  } catch { /* storage full or private mode: it just downloads next time */ }
}

/** The character file's bytes: from memory, then this device, then the network (and kept). */
export function characterBytes(key: string, url: string): Promise<ArrayBuffer> {
  const known = inMemory.get(key);
  if (known) return known;
  const p = (async () => {
    const stored = await fromDevice(key);
    if (stored) return stored;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Character download failed (${res.status})`);
    const data = await res.arrayBuffer();
    void keepOnDevice(key, data.slice(0));
    return data;
  })();
  inMemory.set(key, p);
  p.catch(() => inMemory.delete(key));
  return p;
}

/**
 * Start downloading the character you'll appear as (your choice, else the default), so it's
 * there the moment you enter a workspace instead of loading after you arrive.
 */
export async function prefetchMyCharacter(avatarConfig: unknown): Promise<void> {
  try {
    const { list, urls } = await characterLibrary();
    const mine = chosenCharacterId(avatarConfig);
    const c = list.find((x) => x.id === mine) ?? pickSpaceCharacter(list);
    if (c && urls[c.id]) await characterBytes(`${c.storage_path}:${c.size_bytes}`, urls[c.id]);
  } catch { /* it just loads on arrival instead */ }
}
