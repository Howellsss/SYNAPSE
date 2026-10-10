// PayMonetra 10s teaser — opening hook + phone intro (brief scenes 01–02).
// Every frame is a pure function of time, so render.mjs can step it frame by frame.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const W = 1920, H = 1080, FPS = 30, DURATION = 10;
const C = {
  green900: '#04241A', green800: '#073826', green700: '#0A4730', green600: '#0E5A3C',
  orange: '#FF7A1A', white: '#FFFFFF', ink: '#0B2A1E', mute: '#5D6F67', bg: '#F3F6F4',
};

// ---------- easing / timing helpers ----------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, start, dur) => clamp((t - start) / dur);
const outCubic = (x) => 1 - Math.pow(1 - x, 3);
const inCubic = (x) => x * x * x;
const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const outBack = (x) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

// ---------- icon set (24×24 stroke paths, shared by the hook and the app screen) ----------
const ICONS = {
  bank: 'M3 10 L12 4 L21 10 M5 10 V18 M9.5 10 V18 M14.5 10 V18 M19 10 V18 M3 20.5 H21',
  crypto: 'M9 6.5 H14 A2.75 2.75 0 0 1 14 12 H9 Z M9 12 H14.8 A2.75 2.75 0 0 1 14.8 17.5 H9 Z M7.5 6.5 H9 M7.5 17.5 H9 M10.5 4.5 V6.5 M13 4.5 V6.5 M10.5 17.5 V19.5 M13 17.5 V19.5',
  card: 'M5 6 H19 Q21 6 21 8 V16 Q21 18 19 18 H5 Q3 18 3 16 V8 Q3 6 5 6 Z M3 10 H21 M6.5 14.5 H10.5',
  airtime: 'M8.5 2.5 H15.5 Q17 2.5 17 4 V20 Q17 21.5 15.5 21.5 H8.5 Q7 21.5 7 20 V4 Q7 2.5 8.5 2.5 Z M10.8 18.5 H13.2',
  bolt: 'M13 2.5 L5.5 13 H11.5 L10.5 21.5 L18.5 10.5 H12.5 Z',
  business: 'M5 8 H19 Q20.5 8 20.5 9.5 V18 Q20.5 19.5 19 19.5 H5 Q3.5 19.5 3.5 18 V9.5 Q3.5 8 5 8 Z M9 8 V5.5 Q9 4.5 10 4.5 H14 Q15 4.5 15 5.5 V8 M3.5 13 H20.5',
  transfer: 'M4 8 H18 M14.5 4.5 L18 8 L14.5 11.5 M20 16 H6 M9.5 12.5 L6 16 L9.5 19.5',
  data: 'M2.5 9 Q12 0.5 21.5 9 M5.5 12.5 Q12 6.5 18.5 12.5 M8.7 16 Q12 13 15.3 16 M12 19.5 L12 19.6',
  tv: 'M4.5 6 H19.5 Q21 6 21 7.5 V16 Q21 17.5 19.5 17.5 H4.5 Q3 17.5 3 16 V7.5 Q3 6 4.5 6 Z M8 21 H16 M9 2.5 L12 6 L15 2.5',
  gift: 'M4.5 11 H19.5 V20.5 H4.5 Z M3 7.5 H21 V11 H3 Z M12 7.5 V20.5 M12 7.5 C9 3 6.5 4.5 7.5 6.5 C8 7.5 12 7.5 12 7.5 M12 7.5 C15 3 17.5 4.5 16.5 6.5 C16 7.5 12 7.5 12 7.5',
  home: 'M4 11 L12 4 L20 11 V20 H14.5 V14.5 H9.5 V20 H4 Z',
  user: 'M12 12 A4 4 0 1 0 12 4 A4 4 0 1 0 12 12 Z M4.5 20.5 Q5 15 12 15 Q19 15 19.5 20.5',
  check: 'M6 12.5 L10.2 16.5 L18 8',
  eye: 'M2.5 12 Q12 3 21.5 12 Q12 21 2.5 12 Z M12 14.8 A2.8 2.8 0 1 0 12 9.2 A2.8 2.8 0 1 0 12 14.8 Z',
};
const PATHS = Object.fromEntries(Object.entries(ICONS).map(([k, d]) => [k, new Path2D(d)]));

function drawIcon(ctx, name, x, y, size, color, lineWidth = 2) {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  const s = size / 24;
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(PATHS[name]);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ---------- 2D effects layer ----------
const fx = document.getElementById('fx').getContext('2d');
const HOOK_ICONS = ['transfer', 'crypto', 'card', 'airtime', 'bolt', 'business'];
const ORBIT = { cx: 960, cy: 470, rx: 640, ry: 330 };

function iconPos(i, t) {
  const n = HOOK_ICONS.length;
  const converge = inOutCubic(prog(t, 1.15, 1.9));
  const spin = 0.22 * t + 2.4 * inCubic(prog(t, 1.15, 1.9));
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + spin;
  const r = 1 - converge;
  const bob = Math.sin(t * 2.1 + i * 1.7) * 10 * r;
  return { x: ORBIT.cx + Math.cos(a) * ORBIT.rx * r, y: ORBIT.cy + Math.sin(a) * ORBIT.ry * r + bob, converge };
}

function drawBackground(t) {
  const g = fx.createRadialGradient(960, 470, 0, 960, 520, 1250);
  g.addColorStop(0, '#0B4A33');
  g.addColorStop(0.55, C.green800);
  g.addColorStop(1, C.green900);
  fx.fillStyle = g;
  fx.fillRect(0, 0, W, H);

  // Fine dot grid, drifting slowly to keep the frame alive.
  const drift = (t * 6) % 48;
  fx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let y = -48 + drift; y < H + 48; y += 48) {
    for (let x = 24; x < W; x += 48) {
      fx.beginPath();
      fx.arc(x, y, 1.6, 0, Math.PI * 2);
      fx.fill();
    }
  }
}

function drawHook(t) {
  if (t > 3.3) return;
  // Orange motion trails (sampled from the icon's own past positions).
  const trailStrength = 0.25 + 0.75 * clamp((t - 1.15) / 0.4);
  for (let i = 0; i < HOOK_ICONS.length; i++) {
    const appear = prog(t, 0.1 + i * 0.09, 0.45);
    if (appear <= 0) continue;
    const fadeOut = 1 - prog(t, 2.8, 0.3);
    const steps = 22;
    let prev = iconPos(i, t);
    for (let k = 1; k <= steps; k++) {
      const p = iconPos(i, Math.max(0, t - k * 0.018));
      const a = (1 - k / steps) * 0.55 * trailStrength * appear * fadeOut;
      fx.strokeStyle = `rgba(255,122,26,${a})`;
      fx.lineWidth = 7 * (1 - k / steps) + 0.5;
      fx.lineCap = 'round';
      fx.beginPath();
      fx.moveTo(prev.x, prev.y);
      fx.lineTo(p.x, p.y);
      fx.stroke();
      prev = p;
    }
  }
  // Icon badges.
  for (let i = 0; i < HOOK_ICONS.length; i++) {
    const appear = prog(t, 0.1 + i * 0.09, 0.45);
    if (appear <= 0) continue;
    const { x, y, converge } = iconPos(i, t);
    const shrink = lerp(1, 0.35, clamp((converge - 0.6) / 0.4));
    const alpha = appear * (1 - prog(t, 2.8, 0.3));
    const s = outBack(appear) * shrink;
    fx.save();
    fx.globalAlpha = alpha;
    fx.translate(x, y);
    fx.scale(s, s);
    fx.fillStyle = 'rgba(4,36,26,0.85)';
    fx.beginPath(); fx.arc(0, 0, 58, 0, Math.PI * 2); fx.fill();
    fx.strokeStyle = 'rgba(255,255,255,0.28)';
    fx.lineWidth = 2;
    fx.stroke();
    fx.strokeStyle = 'rgba(255,122,26,0.9)';
    fx.lineWidth = 3;
    fx.beginPath(); fx.arc(0, 0, 58, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * outCubic(appear)); fx.stroke();
    drawIcon(fx, HOOK_ICONS[i], 0, 0, 56, C.white, 2);
    fx.restore();
  }
}

function drawReveal(t) {
  const p = prog(t, 3.0, 0.9);
  if (p <= 0 || p >= 1) return;
  const glow = Math.sin(Math.PI * clamp((t - 2.95) / 0.9));
  const g = fx.createRadialGradient(960, 470, 0, 960, 470, 420);
  g.addColorStop(0, `rgba(255,122,26,${0.22 * glow})`);
  g.addColorStop(1, 'rgba(255,122,26,0)');
  fx.fillStyle = g;
  fx.fillRect(0, 0, W, H);

  const ring = (delay, color, maxA, width) => {
    const q = prog(t, 3.0 + delay, 0.85);
    if (q <= 0 || q >= 1) return;
    fx.strokeStyle = color.replace('A', String(maxA * (1 - q)));
    fx.lineWidth = lerp(width, 1, q);
    fx.beginPath();
    fx.arc(960, 470, lerp(70, 560, outCubic(q)), 0, Math.PI * 2);
    fx.stroke();
  };
  ring(0, 'rgba(255,122,26,A)', 0.85, 5);
  ring(0.12, 'rgba(255,255,255,A)', 0.35, 3);
}

function drawPhoneGlow(t, phoneX) {
  const p = outCubic(prog(t, 6.2, 1.2));
  if (p <= 0) return;
  const g = fx.createRadialGradient(phoneX, 560, 0, phoneX, 560, 520);
  g.addColorStop(0, `rgba(255,122,26,${0.16 * p})`);
  g.addColorStop(0.6, `rgba(255,122,26,${0.05 * p})`);
  g.addColorStop(1, 'rgba(255,122,26,0)');
  fx.fillStyle = g;
  fx.fillRect(0, 0, W, H);
  // Soft contact shadow under the phone.
  fx.save();
  fx.globalAlpha = 0.45 * p;
  const s = fx.createRadialGradient(phoneX, 1000, 0, phoneX, 1000, 260);
  s.addColorStop(0, 'rgba(0,0,0,0.6)');
  s.addColorStop(1, 'rgba(0,0,0,0)');
  fx.fillStyle = s;
  fx.setTransform(1, 0, 0, 0.18, 0, 1000 * 0.82);
  fx.fillRect(phoneX - 300, 700, 600, 600);
  fx.restore();
}

// ---------- app screen (fictional demonstration data) ----------
const SW = 1080, SH = 2348;
const screenCanvas = document.createElement('canvas');
screenCanvas.width = SW; screenCanvas.height = SH;
const sc = screenCanvas.getContext('2d');
const naira = (v) => '₦' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function text(ctx, str, x, y, font, color, align = 'left') {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}

function drawScreen(balance, toast) {
  const ctx = sc;
  ctx.clearRect(0, 0, SW, SH);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, SW, SH);

  // Header panel.
  const hg = ctx.createLinearGradient(0, 0, SW, 880);
  hg.addColorStop(0, C.green800); hg.addColorStop(1, C.green600);
  ctx.fillStyle = hg;
  roundRect(ctx, 0, -80, SW, 960, [0, 0, 72, 72]); ctx.fill();
  ctx.fillStyle = 'rgba(255,122,26,0.12)';
  ctx.beginPath(); ctx.arc(980, 120, 260, 0, Math.PI * 2); ctx.fill();

  // Status bar + island.
  text(ctx, '9:41', 96, 96, '600 40px Inter', C.white);
  ctx.fillStyle = '#000'; roundRect(ctx, SW / 2 - 150, 34, 300, 84, 42); ctx.fill();
  ctx.fillStyle = C.white;
  roundRect(ctx, 900, 70, 64, 30, 8); ctx.fill();
  roundRect(ctx, 820, 72, 8, 26, 3); ctx.fill(); roundRect(ctx, 836, 64, 8, 34, 3); ctx.fill();
  roundRect(ctx, 852, 56, 8, 42, 3); ctx.fill();

  // Greeting.
  text(ctx, 'Good morning,', 80, 236, '500 40px Inter', 'rgba(255,255,255,0.72)');
  text(ctx, 'Ada Okafor', 80, 308, '700 60px Inter', C.white);
  ctx.fillStyle = C.orange; ctx.beginPath(); ctx.arc(964, 262, 58, 0, Math.PI * 2); ctx.fill();
  text(ctx, 'AO', 964, 278, '700 42px Inter', C.white, 'center');

  // Balance card.
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  roundRect(ctx, 60, 380, SW - 120, 430, 52); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2; ctx.stroke();
  text(ctx, 'Wallet balance', 120, 470, '500 38px Inter', 'rgba(255,255,255,0.75)');
  drawIcon(ctx, 'eye', 430, 457, 44, 'rgba(255,255,255,0.75)', 1.8);
  text(ctx, naira(balance), 120, 590, '800 100px Inter', C.white);
  text(ctx, 'Demo Bank  •  0123 456 789', 120, 652, '500 32px Inter', 'rgba(255,255,255,0.6)');
  ctx.fillStyle = C.orange; roundRect(ctx, 110, 696, 410, 84, 42); ctx.fill();
  text(ctx, '+  Add money', 315, 752, '700 36px Inter', C.white, 'center');
  ctx.fillStyle = C.white; roundRect(ctx, 560, 696, 410, 84, 42); ctx.fill();
  text(ctx, 'Transfer', 765, 752, '700 36px Inter', C.green700, 'center');

  // Services grid.
  text(ctx, 'Services', 80, 990, '700 46px Inter', C.ink);
  text(ctx, 'See all', SW - 80, 990, '600 36px Inter', C.orange, 'right');
  const services = [
    ['transfer', 'Transfer'], ['crypto', 'Crypto'], ['card', 'Cards'], ['airtime', 'Airtime'],
    ['data', 'Data'], ['bolt', 'Electricity'], ['tv', 'TV'], ['gift', 'Gift cards'],
  ];
  services.forEach(([icon, label], i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const x = 60 + 120 + col * 240, y = 1110 + row * 270;
    ctx.fillStyle = i === 1 ? '#FFE9D9' : '#E1EDE6';
    roundRect(ctx, x - 80, y - 80, 160, 160, 48); ctx.fill();
    drawIcon(ctx, icon, x, y, 76, i === 1 ? C.orange : C.green600, 2);
    text(ctx, label, x, y + 140, '600 32px Inter', '#2B3B34', 'center');
  });

  // Recent activity (fictional).
  text(ctx, 'Recent activity', 80, 1700, '700 46px Inter', C.ink);
  const rows = [
    ['bank', 'Wallet funding', 'Today, 9:12 AM', '+' + naira(50000), C.green600],
    ['airtime', 'MTN Airtime', 'Yesterday, 6:40 PM', '−' + naira(2000), C.ink],
    ['transfer', 'Transfer to T. Bello', 'Mon, 2:05 PM', '−' + naira(15000), C.ink],
  ];
  rows.forEach(([icon, title, date, amt, col], i) => {
    const y = 1750 + i * 150;
    ctx.fillStyle = C.white; roundRect(ctx, 60, y, SW - 120, 130, 36); ctx.fill();
    ctx.fillStyle = '#E1EDE6'; ctx.beginPath(); ctx.arc(140, y + 65, 42, 0, Math.PI * 2); ctx.fill();
    drawIcon(ctx, icon, 140, y + 65, 46, C.green600, 2.2);
    text(ctx, title, 210, y + 58, '600 36px Inter', C.ink);
    text(ctx, date, 210, y + 102, '500 28px Inter', C.mute);
    text(ctx, amt, SW - 100, y + 78, '700 36px Inter', col, 'right');
  });

  // Bottom nav.
  ctx.fillStyle = C.white; ctx.fillRect(0, 2210, SW, SH - 2210);
  ctx.fillStyle = '#E4EAE7'; ctx.fillRect(0, 2210, SW, 2);
  [['home', 'Home'], ['card', 'Cards'], ['transfer', 'Pay'], ['user', 'Profile']].forEach(([icon, label], i) => {
    const x = 135 + i * 270, active = i === 0;
    drawIcon(ctx, icon, x, 2262, 50, active ? C.green600 : '#9AA8A1', 2.2);
    text(ctx, label, x, 2322, (active ? '700' : '500') + ' 26px Inter', active ? C.green600 : '#9AA8A1', 'center');
  });

  // Funding notification toast.
  if (toast > 0) {
    const y = lerp(-220, 150, outBack(clamp(toast)));
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
    ctx.fillStyle = C.white; roundRect(ctx, 60, y, SW - 120, 170, 48); ctx.fill();
    ctx.restore();
    ctx.fillStyle = C.green600; ctx.beginPath(); ctx.arc(150, y + 85, 48, 0, Math.PI * 2); ctx.fill();
    drawIcon(ctx, 'check', 150, y + 85, 56, C.white, 3);
    text(ctx, 'Wallet funded', 230, y + 72, '700 38px Inter', C.ink);
    text(ctx, '+' + naira(50000) + ' from Demo Bank', 230, y + 122, '500 32px Inter', C.mute);
  }
}

// ---------- 3D phone ----------
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('gl'), alpha: true, antialias: true, preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
camera.position.set(0, 0, 30);

const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(6, 8, 12); scene.add(key);
const rim = new THREE.DirectionalLight(0xff7a1a, 3.0); rim.position.set(-9, 5, -6); scene.add(rim);
scene.add(new THREE.AmbientLight(0xffffff, 0.25));

const PH = { w: 5.9, h: 12.4, d: 0.62, r: 0.85 };
const phone = new THREE.Group();
scene.add(phone);

const body = new THREE.Mesh(
  new RoundedBoxGeometry(PH.w, PH.h, PH.d, 8, PH.r),
  new THREE.MeshPhysicalMaterial({
    color: 0x1c2622, metalness: 0.85, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12,
  }),
);
phone.add(body);

function roundedPlane(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ShapeGeometry(s, 24);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  return g;
}

const bezel = new THREE.Mesh(
  roundedPlane(PH.w - 0.1, PH.h - 0.1, PH.r - 0.05),
  new THREE.MeshPhysicalMaterial({ color: 0x050706, roughness: 0.15, metalness: 0.2, clearcoat: 1 }),
);
bezel.position.z = PH.d / 2 + 0.002;
phone.add(bezel);

const screenTex = new THREE.CanvasTexture(screenCanvas);
screenTex.colorSpace = THREE.SRGBColorSpace;
screenTex.anisotropy = 8;
const SCR = { w: PH.w - 0.36, h: PH.h - 0.36 };
const screen = new THREE.Mesh(
  roundedPlane(SCR.w, SCR.h, PH.r - 0.2),
  new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }),
);
screen.position.z = PH.d / 2 + 0.004;
phone.add(screen);

// Glass sheen: a soft diagonal highlight that slides as the phone turns.
const sheenCanvas = document.createElement('canvas');
sheenCanvas.width = 512; sheenCanvas.height = 512;
{
  const s = sheenCanvas.getContext('2d');
  const g = s.createLinearGradient(0, 512, 512, 0);
  g.addColorStop(0.0, 'rgba(255,255,255,0)');
  g.addColorStop(0.42, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(0.58, 'rgba(255,255,255,0)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  s.fillStyle = g; s.fillRect(0, 0, 512, 512);
}
const sheenTex = new THREE.CanvasTexture(sheenCanvas);
sheenTex.wrapS = THREE.ClampToEdgeWrapping;
const sheen = new THREE.Mesh(
  roundedPlane(SCR.w, SCR.h, PH.r - 0.2),
  new THREE.MeshBasicMaterial({
    map: sheenTex, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }),
);
sheen.position.z = PH.d / 2 + 0.006;
phone.add(sheen);

// Side buttons.
const btnMat = body.material;
const power = new THREE.Mesh(new RoundedBoxGeometry(0.12, 1.5, 0.3, 4, 0.05), btnMat);
power.position.set(PH.w / 2 + 0.03, 2.4, 0); phone.add(power);
const vol = new THREE.Mesh(new RoundedBoxGeometry(0.12, 2.2, 0.3, 4, 0.05), btnMat);
vol.position.set(-PH.w / 2 - 0.03, 2.8, 0); phone.add(vol);

// Units → pixels at z = 0, used to place the 2D glow under the phone.
const unitsPerPx = (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / H;

// ---------- DOM text layer ----------
const $ = (id) => document.getElementById(id);
const logo = $('logo'), wordmarkClip = $('wordmark-clip'), wordmark = $('wordmark');
const taglineWords = [...document.querySelectorAll('#tagline span')];
const meet = $('meet');
const meetParts = [meet.querySelector('.kicker'), meet.querySelector('.bar'), meet.querySelector('.tag'), meet.querySelector('.url')];
let LOGO_W = 0, MARK_W = 132, GAP = 28;

// ---------- frame ----------
let lastScreenKey = '';
function renderFrame(frame) {
  const t = frame / FPS;

  // 2D layer.
  drawBackground(t);
  drawHook(t);
  drawReveal(t);

  // Logo: mark pops in at centre, wordmark wipes out from behind it, then the lockup moves left.
  const pop = prog(t, 3.0, 0.55);
  const wipe = outCubic(prog(t, 3.3, 0.6));
  const move = inOutCubic(prog(t, 6.0, 0.9));
  const centreLeft = (W - LOGO_W) / 2;
  const slide = ((LOGO_W - MARK_W) / 2) * (1 - wipe); // keeps the mark centred until the wordmark arrives
  const lx = lerp(centreLeft + slide, 170, move);
  const ly = lerp(404, 300, move);
  const ls = lerp(pop > 0 ? lerp(0.6, 1, outBack(pop)) : 0, 0.78, move);
  logo.style.opacity = String(clamp(pop * 2));
  logo.style.transform = `translate(${lx}px, ${ly}px) scale(${ls})`;
  wordmarkClip.style.width = `${(LOGO_W - MARK_W - GAP) * wipe}px`;
  wordmark.style.transform = `translateX(${lerp(-60, 0, wipe)}px)`;
  wordmark.style.opacity = String(clamp(wipe * 2.5));

  // Tagline: word by word, then out.
  const out = prog(t, 5.8, 0.35);
  taglineWords.forEach((el, i) => {
    const p = outCubic(prog(t, 3.9 + i * 0.35, 0.4));
    el.style.opacity = String(p * (1 - out));
    el.style.transform = `translateY(${lerp(34, 0, p) - 20 * out}px)`;
  });

  // "Meet PayMonetra" block.
  meet.style.opacity = t > 6.6 ? '1' : '0';
  [[6.9, 0.5], [7.2, 0.45], [7.4, 0.5], [7.75, 0.5]].forEach(([s, d], i) => {
    const p = outCubic(prog(t, s, d));
    const el = meetParts[i];
    if (i === 1) { el.style.transform = `scaleX(${p})`; return; }
    el.style.opacity = String(p);
    el.style.transform = `translateY(${lerp(28, 0, p)}px)`;
  });

  // Phone: rises in with a measured turn, then a gentle float. Never spins.
  const enter = outCubic(prog(t, 6.05, 1.5));
  const settleT = Math.max(0, t - 7.5);
  phone.visible = t > 6.0;
  phone.position.set(5.7, lerp(-15, 0, enter) + Math.sin(settleT * 1.4) * 0.12 * clamp(settleT), 0);
  phone.rotation.set(lerp(0.35, 0.05, enter), lerp(-1.25, -0.3, enter) + 0.06 * Math.sin(settleT * 0.8) * clamp(settleT), lerp(0.12, 0.02, enter));
  sheenTex.offset.x = lerp(0.55, -0.35, outCubic(prog(t, 6.2, 2.6)));
  sheen.material.opacity = 0.05 + 0.1 * (1 - prog(t, 7.0, 2.0));

  const phonePx = W / 2 + phone.position.x / unitsPerPx;
  drawPhoneGlow(t, phonePx);

  // Screen: balance counts up once the phone lands, then a funding notification drops in.
  const count = outCubic(prog(t, 7.3, 1.1));
  const balance = Math.round(248500 * count);
  const toast = prog(t, 8.5, 0.6);
  const screenKey = `${balance}|${toast.toFixed(3)}`;
  if (screenKey !== lastScreenKey) {
    drawScreen(balance, toast);
    screenTex.needsUpdate = true;
    lastScreenKey = screenKey;
  }
  renderer.render(scene, camera);
}

async function init() {
  const fonts = ['400', '500', '600', '700', '800'].map((w) => document.fonts.load(`${w} 40px Inter`));
  fonts.push(document.fonts.load('800 104px "Inter Display"'));
  await Promise.all(fonts);
  await document.fonts.ready;
  wordmarkClip.style.width = 'auto';
  LOGO_W = logo.getBoundingClientRect().width;
  MARK_W = $('mark').getBoundingClientRect().width;
  renderFrame(0);
  window.TOTAL_FRAMES = FPS * DURATION;
  window.renderFrame = renderFrame;
  window.ready = true;
}
init();
