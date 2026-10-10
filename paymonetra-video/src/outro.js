// PayMonetra 10s outro — feature showcase (brief scenes 03–06) + download end card (scene 10).
// Deliberately a different look from the teaser: split layout, orange diagonal wipes, a 3D card.
// Every frame is a pure function of time, so render.mjs can step it frame by frame.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const W = 1920, H = 1080, FPS = 30, DURATION = 10;
const C = {
  green900: '#04241A', green800: '#073826', green700: '#0A4730', green600: '#0E5A3C',
  orange: '#FF7A1A', white: '#FFFFFF', ink: '#0B2A1E', mute: '#5D6F67',
};

// ---------- easing / timing helpers ----------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, start, dur) => clamp((t - start) / dur);
const outCubic = (x) => 1 - Math.pow(1 - x, 3);
const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const outBack = (x) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

// ---------- icons (24×24 stroke paths) ----------
const ICONS = {
  airtime: 'M8.5 2.5 H15.5 Q17 2.5 17 4 V20 Q17 21.5 15.5 21.5 H8.5 Q7 21.5 7 20 V4 Q7 2.5 8.5 2.5 Z M10.8 18.5 H13.2',
  data: 'M2.5 9 Q12 0.5 21.5 9 M5.5 12.5 Q12 6.5 18.5 12.5 M8.7 16 Q12 13 15.3 16 M12 19.5 L12 19.6',
  bolt: 'M13 2.5 L5.5 13 H11.5 L10.5 21.5 L18.5 10.5 H12.5 Z',
  tv: 'M4.5 6 H19.5 Q21 6 21 7.5 V16 Q21 17.5 19.5 17.5 H4.5 Q3 17.5 3 16 V7.5 Q3 6 4.5 6 Z M8 21 H16 M9 2.5 L12 6 L15 2.5',
  check: 'M6 12.5 L10.2 16.5 L18 8',
  contactless: 'M8 8 Q10 12 8 16 M11.5 6 Q14.5 12 11.5 18 M15 4 Q19 12 15 20',
};
const PATHS = Object.fromEntries(Object.entries(ICONS).map(([k, d]) => [k, new Path2D(d)]));

function drawIcon(ctx, name, x, y, size, color, lineWidth = 2) {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke(PATHS[name]);
  ctx.restore();
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function text(ctx, str, x, y, font, color, align = 'left', baseline = 'alphabetic') {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = baseline;
  ctx.fillText(str, x, y);
}
function chip(ctx, x, y, label, a) {
  // White confirmation pill with a green check, centred on (x, y).
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = '600 32px Inter';
  const w = ctx.measureText(label).width + 140;
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
  ctx.fillStyle = C.white; rr(ctx, x - w / 2, y - 44, w, 88, 44); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = C.green600; ctx.beginPath(); ctx.arc(x - w / 2 + 50, y, 26, 0, Math.PI * 2); ctx.fill();
  drawIcon(ctx, 'check', x - w / 2 + 50, y, 32, C.white, 3);
  text(ctx, label, x - w / 2 + 92, y + 11, '600 32px Inter', C.ink);
  ctx.restore();
}

// ---------- timeline ----------
const BOUNDS = [0, 1.5, 3.0, 4.5, 6.0];  // feature 0–3 starts, then end card
const WIPE = 0.5;                         // a wipe covers the frame fully at each boundary
const RIGHT_X = 1440;                     // centre of the right-hand visual

// ---------- layers ----------
const fx = document.getElementById('fx').getContext('2d');
const top = document.getElementById('top').getContext('2d');
const features = [0, 1, 2, 3].map((i) => document.getElementById(`f${i}`));
const featureLines = features.map((f) => [...f.querySelectorAll('.line')]);
const end = document.getElementById('end');
const logo = document.getElementById('logo');
const endParts = ['.tag', '.cta', '#stores', '.urls'].map((s) => end.querySelector(s));
const stores = [...end.querySelectorAll('.store')];
let LOGO_W = 0, LOGO_H = 0;

function drawBackground(t) {
  const g = fx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0A4A33');
  g.addColorStop(1, C.green900);
  fx.fillStyle = g;
  fx.fillRect(0, 0, W, H);
  // Large soft orange arc on the right — a quieter echo of the wipe colour.
  const glow = fx.createRadialGradient(RIGHT_X, 540, 0, RIGHT_X, 540, 620);
  glow.addColorStop(0, 'rgba(255,122,26,0.10)');
  glow.addColorStop(1, 'rgba(255,122,26,0)');
  fx.fillStyle = glow; fx.fillRect(0, 0, W, H);
  // Diagonal hairlines drifting slowly (the teaser used dots; this section uses lines).
  fx.save();
  fx.strokeStyle = 'rgba(255,255,255,0.035)';
  fx.lineWidth = 2;
  const off = (t * 30) % 90;
  for (let x = -H; x < W + H; x += 90) {
    fx.beginPath(); fx.moveTo(x + off, 0); fx.lineTo(x + off - H * 0.45, H); fx.stroke();
  }
  fx.restore();
}

// F0 — a ₦ coin travels from sender to receiver.
function drawTransfer(lt) {
  const A = { x: RIGHT_X - 250, y: 560 }, B = { x: RIGHT_X + 250, y: 560 }, P = { x: RIGHT_X, y: 300 };
  const appear = outBack(prog(lt, 0.0, 0.4));
  const people = [[A, 'AO', C.orange], [B, 'TB', C.white]];
  people.forEach(([p, initials, col], i) => {
    const s = outBack(prog(lt, i * 0.08, 0.4));
    fx.save(); fx.translate(p.x, p.y); fx.scale(s, s);
    fx.fillStyle = col; fx.beginPath(); fx.arc(0, 0, 78, 0, Math.PI * 2); fx.fill();
    text(fx, initials, 0, 2, '800 52px Inter', i === 0 ? C.white : C.green700, 'center', 'middle');
    fx.restore();
  });
  const q = (u) => ({
    x: (1 - u) ** 2 * A.x + 2 * (1 - u) * u * P.x + u * u * B.x,
    y: (1 - u) ** 2 * A.y + 2 * (1 - u) * u * P.y + u * u * B.y,
  });
  // Dashed route, drawn progressively.
  const draw = outCubic(prog(lt, 0.1, 0.45));
  fx.save();
  fx.setLineDash([14, 14]); fx.lineWidth = 4; fx.strokeStyle = `rgba(255,255,255,${0.45 * appear})`;
  fx.beginPath();
  for (let i = 0; i <= 40 * draw; i++) { const p = q(i / 40); i ? fx.lineTo(p.x, p.y) : fx.moveTo(p.x, p.y); }
  fx.stroke(); fx.restore();
  // Coin.
  const u = inOutCubic(prog(lt, 0.3, 0.7));
  if (lt > 0.3 && u < 1) {
    const p = q(u);
    fx.fillStyle = C.orange; fx.beginPath(); fx.arc(p.x, p.y, 40, 0, Math.PI * 2); fx.fill();
    fx.strokeStyle = 'rgba(255,255,255,0.8)'; fx.lineWidth = 3; fx.stroke();
    text(fx, '₦', p.x, p.y + 2, '800 44px Inter', C.white, 'center', 'middle');
  }
  // Arrival pulse + confirmation.
  const arrive = prog(lt, 1.0, 0.45);
  if (arrive > 0 && arrive < 1) {
    fx.strokeStyle = `rgba(255,122,26,${1 - arrive})`; fx.lineWidth = 4;
    fx.beginPath(); fx.arc(B.x, B.y, lerp(80, 150, outCubic(arrive)), 0, Math.PI * 2); fx.stroke();
  }
  if (lt > 1.0) chip(fx, RIGHT_X, 780, '₦15,000.00 sent to Tolu B.', outCubic(prog(lt, 1.0, 0.3)));
}

// F1 — three supported assets and a Buy/Sell toggle (no price charts or gains implied).
function drawCrypto(lt) {
  const coins = [
    ['BTC', C.orange, C.white], ['ETH', C.white, C.green700], ['USDT', C.green600, C.white],
  ];
  coins.forEach(([sym, fill, ink], i) => {
    const p = outBack(prog(lt, 0.05 + i * 0.12, 0.45));
    if (p <= 0) return;
    const x = RIGHT_X + (i - 1) * 230;
    const y = 470 + lerp(90, 0, p) + Math.sin(lt * 3 + i * 1.3) * 8;
    fx.save(); fx.globalAlpha = clamp(p); fx.translate(x, y);
    fx.fillStyle = 'rgba(0,0,0,0.25)'; fx.beginPath(); fx.ellipse(0, 112, 70, 14, 0, 0, Math.PI * 2); fx.fill();
    fx.fillStyle = fill; fx.beginPath(); fx.arc(0, 0, 96, 0, Math.PI * 2); fx.fill();
    fx.strokeStyle = 'rgba(255,255,255,0.35)'; fx.lineWidth = 4;
    fx.beginPath(); fx.arc(0, 0, 80, 0, Math.PI * 2); fx.stroke();
    text(fx, sym, 0, 2, `800 ${sym.length > 3 ? 40 : 46}px Inter`, ink, 'center', 'middle');
    fx.restore();
  });
  // Buy / Sell toggle.
  const tp = outCubic(prog(lt, 0.45, 0.35));
  if (tp > 0) {
    fx.save(); fx.globalAlpha = tp;
    const x = RIGHT_X - 220, y = 690 + lerp(30, 0, tp), w = 440, h = 92;
    fx.fillStyle = 'rgba(255,255,255,0.12)'; rr(fx, x, y, w, h, 46); fx.fill();
    const slide = inOutCubic(prog(lt, 0.95, 0.3));
    fx.fillStyle = C.orange; rr(fx, x + 8 + slide * (w / 2), y + 8, w / 2 - 16, h - 16, 38); fx.fill();
    text(fx, 'Buy', x + w / 4, y + h / 2 + 2, '700 34px Inter', C.white, 'center', 'middle');
    text(fx, 'Sell', x + (3 * w) / 4, y + h / 2 + 2, '700 34px Inter', C.white, 'center', 'middle');
    fx.restore();
  }
}

// F3 — bill tiles pop in; electricity gets paid.
function drawBills(lt) {
  const tiles = [['airtime', 'Airtime'], ['data', 'Data'], ['bolt', 'Electricity'], ['tv', 'TV']];
  tiles.forEach(([icon, label], i) => {
    const p = outBack(prog(lt, 0.05 + i * 0.1, 0.4));
    if (p <= 0) return;
    const x = RIGHT_X + (i % 2 ? 140 : -140), y = 430 + Math.floor(i / 2) * 270;
    const paid = i === 2 ? prog(lt, 0.85, 0.3) : 0;
    fx.save(); fx.translate(x, y); fx.scale(p, p);
    fx.fillStyle = C.white; rr(fx, -115, -115, 230, 230, 40); fx.fill();
    if (paid > 0) { fx.strokeStyle = C.orange; fx.lineWidth = 8 * paid; rr(fx, -115, -115, 230, 230, 40); fx.stroke(); }
    drawIcon(fx, icon, 0, -22, 84, i === 2 && paid > 0 ? C.orange : C.green600, 2);
    text(fx, label, 0, 72, '700 30px Inter', C.ink, 'center');
    if (paid > 0) {
      const s = outBack(paid);
      fx.fillStyle = C.green600; fx.beginPath(); fx.arc(100, -100, 34 * s, 0, Math.PI * 2); fx.fill();
      drawIcon(fx, 'check', 100, -100, 40 * s, C.white, 3);
    }
    fx.restore();
  });
}

// ---------- 3D virtual card (F2) ----------
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('gl'), alpha: true, antialias: true, preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
camera.position.set(0, 0, 30);
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(-6, 8, 12); scene.add(key);
const rim = new THREE.DirectionalLight(0xff7a1a, 2.2); rim.position.set(9, -4, -6); scene.add(rim);
scene.add(new THREE.AmbientLight(0xffffff, 0.3));
const unitsPerPx = (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / H;

const faceCanvas = document.createElement('canvas');
faceCanvas.width = 1024; faceCanvas.height = 646;
function drawCardFace() {
  const c = faceCanvas.getContext('2d');
  const g = c.createLinearGradient(0, 0, 1024, 646);
  g.addColorStop(0, '#0E5A3C'); g.addColorStop(1, '#04241A');
  c.fillStyle = g; c.fillRect(0, 0, 1024, 646);
  c.fillStyle = 'rgba(255,122,26,0.9)'; c.beginPath(); c.arc(1010, -40, 300, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(255,122,26,0.25)'; c.beginPath(); c.arc(1010, -40, 400, 0, Math.PI * 2); c.fill();
  text(c, 'Pay', 64, 110, '800 60px Inter', C.white);
  const pw = c.measureText('Pay').width;
  text(c, 'Monetra', 64 + pw, 110, '800 60px Inter', C.orange);
  // Chip.
  const cg = c.createLinearGradient(64, 220, 184, 310);
  cg.addColorStop(0, '#F3D27A'); cg.addColorStop(1, '#C99A3B');
  c.fillStyle = cg; rr(c, 64, 220, 120, 92, 16); c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(64, 266); c.lineTo(184, 266); c.moveTo(124, 220); c.lineTo(124, 312); c.stroke();
  drawIcon(c, 'contactless', 240, 266, 70, 'rgba(255,255,255,0.85)', 2);
  text(c, '••••  ••••  ••••  4821', 64, 440, '600 54px Inter', C.white);
  text(c, 'ADA OKAFOR', 64, 560, '600 36px Inter', 'rgba(255,255,255,0.85)');
  text(c, 'VIRTUAL', 960, 560, '800 34px Inter', C.orange, 'right');
}
const faceTex = new THREE.CanvasTexture(faceCanvas);
faceTex.colorSpace = THREE.SRGBColorSpace;
faceTex.anisotropy = 8;
const edgeMat = new THREE.MeshPhysicalMaterial({ color: 0x0a3a28, metalness: 0.6, roughness: 0.35, clearcoat: 1 });
const faceMat = new THREE.MeshPhysicalMaterial({ map: faceTex, metalness: 0.15, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });
const backMat = new THREE.MeshPhysicalMaterial({ color: 0x062a1f, metalness: 0.3, roughness: 0.4, clearcoat: 1 });
// RoundedBoxGeometry keeps BoxGeometry's face groups: 4 = front (+z), 5 = back.
const card = new THREE.Mesh(
  new RoundedBoxGeometry(9.4, 5.93, 0.12, 4, 0.08),
  [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, backMat],
);
scene.add(card);

// ---------- wipes ----------
function drawWipe(t) {
  top.clearRect(0, 0, W, H);
  for (const b of BOUNDS) {
    const p = prog(t, b - WIPE / 2, WIPE);
    if (p <= 0 || p >= 1) continue;
    const L = lerp(-2700, 2400, inOutCubic(p));
    const band = (x0, w, color) => {
      top.fillStyle = color;
      top.beginPath();
      top.moveTo(x0 + 420, 0); top.lineTo(x0 + 420 + w, 0); top.lineTo(x0 + w, H); top.lineTo(x0, H);
      top.closePath(); top.fill();
    };
    band(L, 2300, C.orange);
    band(L + 2300, 60, C.white);
  }
}

// ---------- frame ----------
function renderFrame(frame) {
  const t = frame / FPS;
  drawBackground(t);

  const idx = BOUNDS.findLastIndex((b) => t >= b);  // 0–3 = feature, 4 = end card
  const lt = t - BOUNDS[idx];

  features.forEach((f, i) => {
    f.style.visibility = i === idx ? 'visible' : 'hidden';
    if (i !== idx) return;
    featureLines[i].forEach((el, k) => {
      const p = outCubic(prog(lt, 0.12 + k * 0.08, 0.45));
      el.style.opacity = String(p);
      el.style.transform = `translateX(${lerp(-50, 0, p)}px)`;
    });
  });

  if (idx === 0) drawTransfer(lt);
  if (idx === 1) drawCrypto(lt);
  if (idx === 3) drawBills(lt);

  // 3D card turns in during F2; a payment confirmation follows.
  card.visible = idx === 2;
  if (idx === 2) {
    const e = outCubic(prog(lt, 0.0, 0.9));
    card.position.set((RIGHT_X - W / 2) * unitsPerPx, lerp(-1.6, 0.6, e) + Math.sin(lt * 1.6) * 0.08, 0);
    card.rotation.set(lerp(0.5, 0.1, e), lerp(-1.9, -0.32, e) + 0.1 * prog(lt, 0.9, 0.6), lerp(-0.25, 0.04, e));
    if (lt > 0.85) chip(fx, RIGHT_X, 820, 'Payment approved', outCubic(prog(lt, 0.85, 0.3)));
  }
  renderer.render(scene, camera);

  // End card.
  end.style.visibility = idx === 4 ? 'visible' : 'hidden';
  if (idx === 4) {
    const glow = fx.createRadialGradient(960, 400, 0, 960, 400, 700);
    glow.addColorStop(0, 'rgba(255,122,26,0.16)');
    glow.addColorStop(1, 'rgba(255,122,26,0)');
    fx.fillStyle = glow; fx.fillRect(0, 0, W, H);
    const lp = prog(lt, 0.2, 0.6);
    const s = lerp(0.85, 1, outBack(lp));
    logo.style.opacity = String(clamp(lp * 2));
    logo.style.transform = `translate(${(W - LOGO_W) / 2}px, ${330 - LOGO_H / 2}px) scale(${s})`;
    [[0.5, 0.5], [0.8, 0.45], [1.0, 0.5], [1.35, 0.5]].forEach(([st, d], i) => {
      const p = outCubic(prog(lt, st, d));
      endParts[i].style.opacity = String(p);
      endParts[i].style.transform = `translateY(${lerp(26, 0, p)}px)`;
    });
    stores.forEach((el, i) => {
      const p = outBack(prog(lt, 1.0 + i * 0.12, 0.45));
      el.style.transform = `scale(${lerp(0.8, 1, p)})`;
    });
  }

  drawWipe(t);
}

async function init() {
  const fonts = ['400', '500', '600', '700', '800'].map((w) => document.fonts.load(`${w} 40px Inter`));
  fonts.push(document.fonts.load('800 104px "Inter Display"'));
  await Promise.all(fonts);
  await document.fonts.ready;
  end.style.visibility = 'visible';
  const r = logo.getBoundingClientRect();
  LOGO_W = r.width; LOGO_H = r.height;
  end.style.visibility = 'hidden';
  drawCardFace();
  faceTex.needsUpdate = true;
  renderFrame(0);
  window.TOTAL_FRAMES = FPS * DURATION;
  window.renderFrame = renderFrame;
  window.ready = true;
}
init();
