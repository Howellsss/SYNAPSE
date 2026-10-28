/**
 * Downloads for the 3D world, shared by everything that asks (one download per file per page).
 *
 * Most important first: the office (the HQ and its furniture) starts as soon as a workspace is
 * opened, before the 3D code has even arrived. Prop models wait until the office is in (or 6 s),
 * then come a few at a time, nearest to where people arrive first, so dozens of vehicles across
 * the map don't crowd out what you see. Only downloading is queued; each model is unpacked as soon
 * as it lands.
 */
const AT_ONCE = 6;

const files = new Map<string, Promise<ArrayBuffer>>();
const queue: { url: string; priority: number; start: () => void }[] = [];
let running = 0;
let gate: Promise<unknown> = Promise.resolve();

const pump = () => {
  queue.sort((a, b) => a.priority - b.priority);
  while (running < AT_ONCE && queue.length) { running++; queue.shift()!.start(); }
};

const get = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.arrayBuffer();
});

/**
 * A file's bytes. `priority`: below 0 downloads at once (the office, a character); otherwise it
 * waits its turn, lower first (the world passes a piece's distance from where people arrive).
 */
export function fetchAsset(url: string, priority = 0): Promise<ArrayBuffer> {
  const waiting = queue.find((j) => j.url === url);
  if (waiting && priority < waiting.priority) {
    waiting.priority = priority;
    if (priority < 0) { queue.splice(queue.indexOf(waiting), 1); running++; waiting.start(); }
  }
  let p = files.get(url);
  if (p) return p;
  if (priority < 0) {
    p = get(url);
  } else {
    p = new Promise<ArrayBuffer>((resolve, reject) => {
      queue.push({ url, priority, start: () => { get(url).then(resolve, reject).finally(() => { running--; pump(); }); } });
      void gate.then(pump);
    });
  }
  // A failed download is tried again the next time it's asked for.
  p.catch(() => files.delete(url));
  files.set(url, p);
  return p;
}

/** Hold the queued downloads until this has arrived (at most 6 s). */
export function holdQueuedFor(first: Promise<unknown>) {
  gate = Promise.race([first.catch(() => undefined), new Promise((r) => setTimeout(r, 6000))]);
}
