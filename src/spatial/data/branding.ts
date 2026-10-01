/** Accent colours a workspace can use, all from the SYNAPSE palette. */
export const ACCENTS: { value: string; label: string }[] = [
  { value: '#E4A93C', label: 'SYNAPSE gold' },
  { value: '#B07A1B', label: 'Deep gold' },
  { value: '#0D1C3B', label: 'Navy' },
  { value: '#394560', label: 'Slate' },
  { value: '#8B2530', label: 'Burgundy' },
  { value: '#6B7588', label: 'Stone' },
];

export const DEFAULT_ACCENT = ACCENTS[0].value;

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
