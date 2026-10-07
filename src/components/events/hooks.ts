import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700&family=Unbounded:wght@500;600;700&display=swap';

/** Loads the events typefaces (Unbounded + Raleway) the first time an events page shows. */
export function useEventFonts() {
  useEffect(() => {
    if (document.querySelector('link[data-event-fonts]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTS_HREF;
    link.dataset.eventFonts = 'true';
    document.head.appendChild(link);
  }, []);
}

/** A QR code drawn as an image (data URL). */
export function useQrDataUrl(text: string | null, size = 320) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!text) { setUrl(null); return; }
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0D1C3B', light: '#FFFFFF' } })
      .then((u) => { if (alive) setUrl(u); })
      .catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [text, size]);
  return url;
}
