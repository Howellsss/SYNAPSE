/**
 * Reads QR codes from the camera on every phone. Chrome on Android has a built-in reader; Safari on
 * iPhone doesn't, so there we use the barcode-detector library (ZXing compiled to WebAssembly).
 * The .wasm file is served by SYNAPSE itself, not fetched from a CDN, and only loaded when needed.
 */
export interface QrReader { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }
type DetectorCtor = (new (opts: { formats: string[] }) => QrReader) & { getSupportedFormats?: () => Promise<string[]> };

let reader: Promise<QrReader> | null = null;

export function getQrReader(): Promise<QrReader> {
  if (!reader) {
    reader = (async () => {
      const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      if (Native) {
        try {
          const formats = await Native.getSupportedFormats?.();
          if (!formats || formats.includes('qr_code')) return new Native({ formats: ['qr_code'] });
        } catch { /* fall through to the library */ }
      }
      const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
        import('barcode-detector/ponyfill'),
        import('zxing-wasm/reader/zxing_reader.wasm?url'),
      ]);
      prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) }, fireImmediately: true });
      return new BarcodeDetector({ formats: ['qr_code'] }) as QrReader;
    })();
    reader.catch(() => { reader = null; });
  }
  return reader;
}
