/**
 * A ticket as a picture people can save to their phone: the event's colour across the top, the
 * QR, the short code, who it's for and when and where. Drawn in the browser (no upload).
 */
export interface TicketImageInput {
  eventTitle: string;
  tagline?: string;
  dateLine: string;
  place: string;
  typeName: string;
  name: string;
  code: string | null;
  qrDataUrl: string;
  colour?: string;
  footer?: string;
}

const W = 1080;

const loadImage = (src: string) => new Promise<HTMLImageElement>((ok, fail) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => fail(new Error('The QR picture could not be drawn.'));
  img.src = src;
});

/** Words on as many lines as they need (up to `max`), each no wider than `width`. */
export function wrapLines(measure: (s: string) => number, text: string, width: number, max = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (measure(next) <= width || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > max) { lines.length = max; lines[max - 1] = `${lines[max - 1].replace(/\s+\S*$/, '')}…`; }
  return lines;
}

export async function drawTicketImage(t: TicketImageInput): Promise<Blob> {
  // Taller when there's a footer line to fit under the details.
  const H = t.footer ? 1720 : 1560;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('This browser can’t draw the ticket.');
  const colour = /^#[0-9a-f]{6}$/i.test(t.colour ?? '') ? t.colour! : '#0A1628';
  const font = (weight: number, size: number) => `${weight} ${size}px Inter, "Helvetica Neue", Arial, sans-serif`;

  // The card on white, with the event's colour across the top.
  c.fillStyle = '#FFFFFF';
  c.fillRect(0, 0, W, H);
  c.fillStyle = colour;
  c.beginPath();
  c.roundRect(40, 40, W - 80, 420, [48, 48, 0, 0]);
  c.fill();
  c.strokeStyle = '#E3E7EF';
  c.lineWidth = 3;
  c.beginPath();
  c.roundRect(40, 40, W - 80, H - 80, 48);
  c.stroke();

  c.fillStyle = '#FFFFFF';
  c.textBaseline = 'top';
  c.font = font(700, 30);
  c.globalAlpha = 0.85;
  c.fillText(t.typeName.toUpperCase(), 110, 110);
  c.globalAlpha = 1;
  c.font = font(800, 84);
  const titleLines = wrapLines((s) => c.measureText(s).width, t.eventTitle, W - 220, 2);
  titleLines.forEach((l, i) => c.fillText(l, 110, 160 + i * 92));
  if (t.tagline) {
    c.font = font(600, 32);
    c.globalAlpha = 0.9;
    c.fillText(t.tagline, 110, 160 + titleLines.length * 92 + 18);
    c.globalAlpha = 1;
  }

  // The tear line between the stub and the pass.
  c.fillStyle = '#FFFFFF';
  [40, W - 40].forEach((x) => { c.beginPath(); c.arc(x, 460, 30, 0, Math.PI * 2); c.fill(); });
  c.setLineDash([14, 14]);
  c.strokeStyle = '#CBD2DE';
  c.beginPath(); c.moveTo(90, 460); c.lineTo(W - 90, 460); c.stroke();
  c.setLineDash([]);

  // The QR, then the code people can read out.
  const qr = await loadImage(t.qrDataUrl);
  const q = 560;
  c.drawImage(qr, (W - q) / 2, 520, q, q);
  c.textAlign = 'center';
  if (t.code) {
    c.fillStyle = '#6B7280';
    c.font = font(700, 26);
    c.fillText('TICKET CODE', W / 2, 1110);
    c.fillStyle = '#0A1628';
    c.font = font(800, 76);
    c.fillText(t.code.split('').join(String.fromCharCode(8202)), W / 2, 1148);
  }

  // Who and when.
  c.fillStyle = '#0A1628';
  c.font = font(700, 44);
  c.fillText(t.name, W / 2, 1270);
  c.fillStyle = '#374151';
  c.font = font(500, 34);
  c.fillText(t.dateLine, W / 2, 1338);
  wrapLines((s) => c.measureText(s).width, t.place, W - 200, 2).forEach((l, i) => c.fillText(l, W / 2, 1388 + i * 44));

  if (t.footer) {
    c.fillStyle = '#6B7280';
    c.font = `italic ${font(500, 28)}`;
    wrapLines((s) => c.measureText(s).width, t.footer, W - 220, 2).forEach((l, i) => c.fillText(l, W / 2, 1540 + i * 38));
  }

  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('The ticket could not be saved.'))), 'image/png'));
}

/** Draw the ticket and hand it to the browser as a download. */
export async function downloadTicketImage(t: TicketImageInput, fileName: string) {
  const blob = await drawTicketImage(t);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
