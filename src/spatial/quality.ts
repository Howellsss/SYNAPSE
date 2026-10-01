export type GraphicsQuality = 'high' | 'low';

const KEY = 'synapse.quality';

/** Low on phones and slower laptops: few CPU cores or little memory. */
export function autoQuality(hardwareConcurrency?: number, deviceMemory?: number): GraphicsQuality {
  if (hardwareConcurrency !== undefined && hardwareConcurrency <= 4) return 'low';
  if (deviceMemory !== undefined && deviceMemory <= 4) return 'low';
  return 'high';
}

/** The person's choice if they made one, otherwise picked from the device. */
export function loadQuality(): GraphicsQuality {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'high' || v === 'low') return v;
  } catch { /* private mode */ }
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number });
  return autoQuality(nav?.hardwareConcurrency, nav?.deviceMemory);
}

export function saveQuality(q: GraphicsQuality) {
  try { localStorage.setItem(KEY, q); } catch { /* private mode */ }
}
