import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { pointAlong } from '@/spatial/net/interpolation';
import { shownStatus } from '@/spatial/net/status';
import { EMOTE_EMOJI } from '@/spatial/net/emotes';
import type { RemoteStore } from '@/spatial/net/useSpaceChannel';
import type { LocalState } from '@/spatial/net/moveSender';
import type { EmoteKind, EmoteMsg, PresenceMeta } from '@/spatial/net/protocol';
import type { Group } from '@/spatial/media/proximity';
import type { GraphicsQuality } from '@/spatial/quality';
import { findPath, smoothPath } from '@/spatial/scene/pathfinding';
import { AVATAR_ACTIONS, type AvatarAction, type SpaceClips } from '@/spatial/scene/avatarClips';
import {
  cellAt, clampToFloor, facing, floorGrid, keyDirection, moveKeyFor, pinRootMotion, spawnPoint, WALK_SPEED,
  type Floor, type MoveKey,
} from '@/spatial/scene/floor';

/** What the world toolbar and the people panel can ask the scene to do. */
export interface SceneControls {
  center: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Walk to someone (stops a little short of them). Returns false if they aren't placed yet. */
  walkTo: (userId: string) => boolean;
}

export interface SpaceSceneProps {
  /** Signed URL of the workspace's character .glb, or null to use simple figures. */
  characterUrl: string | null;
  clips: SpaceClips;
  floor: Floor;
  quality: GraphicsQuality;
  meId: string;
  /** Everyone present, including me. */
  people: PresenceMeta[];
  raisedHands: Set<string>;
  remotes: RemoteStore;
  /** Conversation groups (floor rings). */
  groups: Group[];
  /** My state, every frame. */
  onLocal: (state: LocalState) => void;
  startPath: (points: [number, number][], speed: number) => void;
  endPath: () => void;
  onEmote: (fn: (e: EmoteMsg) => void) => () => void;
  /** My own reactions (others' arrive through onEmote). */
  localEmote: { kind: EmoteKind; id: number } | null;
  controls: MutableRefObject<SceneControls | null>;
  /** The character file couldn't be loaded; figures are used instead. */
  onCharacterError?: (message: string) => void;
}

const AVATAR_HEIGHT = 1.7;
const LABEL_HEIGHT = 2.0;
const CAMERA_OFFSET = new THREE.Vector3(10, 9.9, 10); // looks down at about 35°, from the +x/+z corner
const VIEW_HEIGHT = 12; // metres of floor visible top to bottom at zoom 1
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.6;
const EMOTE_BUBBLE_MS = 3000;
const ONE_SHOT: AvatarAction[] = ['wave', 'cheer'];

interface Template {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  scale: number;
  lift: number;
}

interface Avatar {
  root: THREE.Group;
  body: THREE.Object3D | null;
  bodyFor: Template | null | undefined;
  mixer: THREE.AnimationMixer | null;
  actions: Partial<Record<AvatarAction, THREE.AnimationAction>>;
  current: AvatarAction | null;
  emote: { action: AvatarAction; until: number } | null;
  label: CSS2DObject;
  labelEl: HTMLDivElement;
  labelSig: string;
  bubble: { text: string; until: number } | null;
}

const STATUS_DOT: Record<string, string> = {
  'bg-green-500': '#22c55e', 'bg-gold-500': '#D49826', 'bg-indigo-500': '#6366f1', 'bg-burgundy-500': '#8B2530',
};

function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** A simple figure for when there's no character (or while it loads). */
function makeFigure(userId: string): THREE.Object3D {
  const color = new THREE.Color().setHSL(hueFor(userId) / 360, 0.45, 0.55);
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.85, 6, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  body.position.y = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), new THREE.MeshStandardMaterial({ color: '#f1d3b8', roughness: 0.7 }));
  head.position.y = 1.45;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: '#0D1C3B' }));
  nose.position.set(0, 1.47, 0.19);
  group.add(body, head, nose);
  return group;
}

function shadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(9,21,48,0.35)');
  grad.addColorStop(1, 'rgba(9,21,48,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function disposeObject(obj: THREE.Object3D, keepShared = false) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!keepShared) mesh.geometry?.dispose();
    if (keepShared) return;
    for (const mat of ([] as THREE.Material[]).concat(mesh.material ?? [])) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

/**
 * The walkable 3D space: an open floor, everyone as the workspace's character (or a simple
 * figure), name labels, conversation rings, click-to-walk and arrow keys / WASD.
 * Loaded lazily so three.js only downloads inside a space.
 */
export default function SpaceScene(props: SpaceSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const templateRef = useRef<Template | null>(null);
  const emotesRef = useRef<{ userId: string; kind: EmoteKind }[]>([]);
  const groupsDirty = useRef(true);
  /** Where I am, kept when the scene is rebuilt (e.g. a graphics quality change). */
  const myPlace = useRef<{ x: number; z: number; rot: number } | null>(null);
  const zoomRef = useRef(1);
  const { quality, floor, characterUrl } = props;

  // Load the character once per file.
  useEffect(() => {
    templateRef.current = null;
    if (!characterUrl) return;
    let cancelled = false;
    new GLTFLoader().load(
      characterUrl,
      (gltf) => {
        if (cancelled) return;
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const height = box.max.y - box.min.y;
        const scale = height > 0 ? AVATAR_HEIGHT / height : 1;
        // Keep every clip in place: the network decides where people are.
        for (const clip of gltf.animations) {
          for (const track of clip.tracks) {
            if (!track.name.endsWith('.position')) continue;
            const node = gltf.scene.getObjectByName(track.name.slice(0, -'.position'.length));
            const isRoot = node && (node as THREE.Bone).isBone && !(node.parent as THREE.Bone | null)?.isBone;
            if (isRoot) pinRootMotion(track.values);
          }
        }
        templateRef.current = {
          scene: gltf.scene,
          clips: new Map(gltf.animations.map((c) => [c.name, c])),
          scale,
          lift: -box.min.y * scale,
        };
      },
      undefined,
      () => { if (!cancelled) latest.current.onCharacterError?.("Couldn't load the workspace's character; showing simple figures."); },
    );
    return () => {
      cancelled = true;
      const t = templateRef.current;
      templateRef.current = null;
      if (t) disposeObject(t.scene);
    };
  }, [characterUrl]);

  // Remote emotes.
  useEffect(() => props.onEmote((e) => { emotesRef.current.push({ userId: e.userId, kind: e.kind }); }), [props.onEmote]); // eslint-disable-line react-hooks/exhaustive-deps
  // My own emotes.
  useEffect(() => {
    if (props.localEmote) emotesRef.current.push({ userId: latest.current.meId, kind: props.localEmote.kind });
  }, [props.localEmote]);
  useEffect(() => { groupsDirty.current = true; }, [props.groups]);

  // The scene.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const low = quality === 'low';

    const renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: low ? 'low-power' : 'high-performance' });
    renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    mount.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    labels.domElement.style.position = 'absolute';
    labels.domElement.style.inset = '0';
    labels.domElement.style.pointerEvents = 'none';
    mount.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0D1C3B');
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envMap;
    scene.environmentIntensity = 0.7;
    scene.add(new THREE.HemisphereLight('#ffffff', '#8A95B0', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(6, 12, 8);
    scene.add(sun);

    // Floor, grid lines and a gold edge.
    const { width: W, depth: D } = floor;
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: '#EDEFF3', roughness: 0.92 }));
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(W / 2, 0, D / 2);
    scene.add(floorMesh);
    const gridPts: number[] = [];
    for (let x = 1; x < W; x++) gridPts.push(x, 0.005, 0, x, 0.005, D);
    for (let z = 1; z < D; z++) gridPts.push(0, 0.005, z, W, 0.005, z);
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: '#C5CCDB', transparent: true, opacity: 0.55 }));
    scene.add(grid);
    const edgeGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(W, 0.01, 0), new THREE.Vector3(W, 0.01, D), new THREE.Vector3(0, 0.01, D),
    ]);
    const edge = new THREE.LineLoop(edgeGeo, new THREE.LineBasicMaterial({ color: '#E4A93C' }));
    scene.add(edge);

    const shadowTex = shadowTexture();
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
    const shadowGeo = new THREE.CircleGeometry(0.5, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#E4A93C', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const ringLayer = new THREE.Group();
    scene.add(ringLayer);
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 32), ringMat.clone());
    marker.rotation.x = -Math.PI / 2;
    marker.visible = false;
    scene.add(marker);
    let markerUntil = 0;

    // Camera: orthographic, from the +x/+z corner, following me.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    let zoom = zoomRef.current;
    const target = new THREE.Vector3(W / 2, 0, D / 2);
    const applyCamera = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      const aspect = w / h;
      camera.left = (-VIEW_HEIGHT * aspect) / 2;
      camera.right = (VIEW_HEIGHT * aspect) / 2;
      camera.top = VIEW_HEIGHT / 2;
      camera.bottom = -VIEW_HEIGHT / 2;
      camera.zoom = zoom;
      zoomRef.current = zoom;
      camera.position.copy(target).add(CAMERA_OFFSET);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
    };
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      labels.setSize(w, h);
      applyCamera();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // Me.
    const navGrid = floorGrid(floor);
    const start = myPlace.current ? clampToFloor(floor, myPlace.current.x, myPlace.current.z) : spawnPoint(floor);
    const me = { x: start.x, z: start.z, rot: myPlace.current?.rot ?? Math.PI * 1.25, path: null as null | { points: [number, number][]; startedAt: number } };
    target.set(me.x, 0, me.z);
    const held = new Set<MoveKey>();

    const walkTo = (x: number, z: number) => {
      const goal = clampToFloor(floor, x, z);
      const cells = findPath(navGrid, cellAt(floor, me.x, me.z), cellAt(floor, goal.x, goal.z));
      if (!cells) return false;
      const smooth = smoothPath(navGrid, cells);
      const points: [number, number][] = smooth.map((c) => [c.x + 0.5, c.z + 0.5]);
      points[0] = [me.x, me.z];
      if (points.length === 1) points.push([goal.x, goal.z]);
      else points[points.length - 1] = [goal.x, goal.z];
      const length = points.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) : 0), 0);
      if (length < 0.05) return false;
      me.path = { points, startedAt: performance.now() };
      latest.current.startPath(points, WALK_SPEED);
      marker.position.set(goal.x, 0.02, goal.z);
      marker.visible = true;
      markerUntil = performance.now() + 900;
      return true;
    };

    // Avatars.
    const avatars = new Map<string, Avatar>();
    const makeAvatar = (): Avatar => {
      const root = new THREE.Group();
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.01;
      root.add(shadow);
      const labelEl = document.createElement('div');
      labelEl.className = 'pointer-events-none select-none whitespace-nowrap rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-navy-800 shadow-popover';
      const label = new CSS2DObject(labelEl);
      label.position.set(0, LABEL_HEIGHT, 0);
      root.add(label);
      scene.add(root);
      return { root, body: null, bodyFor: undefined, mixer: null, actions: {}, current: null, emote: null, label, labelEl, labelSig: '', bubble: null };
    };
    const setBody = (a: Avatar, userId: string, tpl: Template | null) => {
      if (a.body) {
        a.mixer?.stopAllAction();
        a.root.remove(a.body);
        disposeObject(a.body, !!a.bodyFor);
      }
      a.mixer = null;
      a.actions = {};
      a.current = null;
      a.bodyFor = tpl;
      if (!tpl) {
        a.body = makeFigure(userId);
      } else {
        const holder = new THREE.Group();
        const model = cloneSkinned(tpl.scene);
        model.scale.setScalar(tpl.scale);
        model.position.y = tpl.lift;
        holder.add(model);
        a.body = holder;
        a.mixer = new THREE.AnimationMixer(model);
        const names = latest.current.clips;
        for (const action of AVATAR_ACTIONS) {
          const clip = names[action] ? tpl.clips.get(names[action]!) : undefined;
          if (!clip) continue;
          const act = a.mixer.clipAction(clip);
          if (ONE_SHOT.includes(action)) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
          a.actions[action] = act;
        }
      }
      a.root.add(a.body);
    };
    const removeAvatar = (id: string) => {
      const a = avatars.get(id);
      if (!a) return;
      a.mixer?.stopAllAction();
      if (a.body) disposeObject(a.body, !!a.bodyFor);
      a.labelEl.remove();
      scene.remove(a.root);
      avatars.delete(id);
    };
    const play = (a: Avatar, want: AvatarAction | null) => {
      if (want === a.current) return;
      const prev = a.current ? a.actions[a.current] : undefined;
      const next = want ? a.actions[want] : undefined;
      prev?.fadeOut(0.2);
      if (next) next.reset().fadeIn(0.2).play();
      a.current = want;
    };
    let clipsSig = JSON.stringify(latest.current.clips);

    const updateLabel = (a: Avatar, p: PresenceMeta | undefined, isMe: boolean, now: number) => {
      const st = p ? shownStatus(p) : null;
      const hand = latest.current.raisedHands.has(p?.userId ?? '');
      const bubble = a.bubble && a.bubble.until > now ? a.bubble.text : '';
      const name = isMe ? 'You' : p?.name ?? '';
      const sig = `${name}|${st?.dot}|${p?.away}|${hand}|${bubble}`;
      if (sig === a.labelSig) return;
      a.labelSig = sig;
      a.labelEl.textContent = '';
      const dot = document.createElement('span');
      dot.style.cssText = `display:inline-block;width:7px;height:7px;border-radius:9999px;margin-right:5px;vertical-align:1px;background:${STATUS_DOT[st?.dot ?? ''] ?? '#22c55e'}`;
      a.labelEl.append(dot, document.createTextNode(name + (hand ? ' ✋' : '') + (bubble ? ` ${bubble}` : '')));
      a.labelEl.style.opacity = p?.away ? '0.6' : '1';
    };

    // Input: click/tap the floor to walk, arrow keys / WASD.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down: { x: number; y: number; id: number } | null = null;
    const onPointerDown = (e: PointerEvent) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
    const onPointerUp = (e: PointerEvent) => {
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 8) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(floorMesh)[0];
      if (hit) walkTo(hit.point.x, hit.point.z);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.exp(-e.deltaY * 0.0015)));
      applyCamera();
    };
    const isEditable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      const k = moveKeyFor(e);
      if (!k) return;
      e.preventDefault();
      held.add(k);
    };
    const onKeyUp = (e: KeyboardEvent) => { const k = moveKeyFor(e); if (k) held.delete(k); };
    const onBlur = () => held.clear();
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    latest.current.controls.current = {
      center: () => { zoom = 1; target.set(me.x, 0, me.z); applyCamera(); },
      zoomIn: () => { zoom = Math.min(MAX_ZOOM, zoom * 1.25); applyCamera(); },
      zoomOut: () => { zoom = Math.max(MIN_ZOOM, zoom / 1.25); applyCamera(); },
      walkTo: (userId: string) => {
        const a = avatars.get(userId);
        if (!a || userId === latest.current.meId) return false;
        // Stop about a metre short, on my side of them.
        const dx = me.x - a.root.position.x;
        const dz = me.z - a.root.position.z;
        const len = Math.hypot(dx, dz) || 1;
        return walkTo(a.root.position.x + (dx / len) * 1.1, a.root.position.z + (dz / len) * 1.1);
      },
    };

    const timer = new THREE.Timer();
    renderer.setAnimationLoop((time) => {
      timer.update(time);
      // Big enough for slow devices to keep pace; small enough that a background tab doesn't jump.
      const dt = Math.min(0.25, timer.getDelta());
      const now = performance.now();
      const p = latest.current;

      // Move me.
      let moving = false;
      const dir = keyDirection(held);
      if (dir) {
        if (me.path) { me.path = null; p.endPath(); }
        const next = clampToFloor(floor, me.x + dir.x * WALK_SPEED * dt, me.z + dir.z * WALK_SPEED * dt);
        moving = Math.hypot(next.x - me.x, next.z - me.z) > 1e-4;
        me.x = next.x;
        me.z = next.z;
        me.rot = facing(dir.x, dir.z);
      } else if (me.path) {
        // By the clock, like everyone else's screen walks this route, so we stay in step.
        const at = pointAlong(me.path.points, ((now - me.path.startedAt) / 1000) * WALK_SPEED);
        me.x = at.x;
        me.z = at.z;
        me.rot = at.rot;
        moving = !at.done;
        if (at.done) { me.path = null; p.endPath(); }
      }
      myPlace.current = { x: me.x, z: me.z, rot: me.rot };
      p.onLocal({ x: me.x, z: me.z, rot: me.rot, anim: moving ? 'walk' : 'idle' });

      // Emotes that arrived since the last frame.
      for (const e of emotesRef.current.splice(0)) {
        const a = avatars.get(e.userId);
        if (!a) continue;
        if (e.kind === 'raise_hand' || e.kind === 'lower_hand') continue;
        a.bubble = { text: EMOTE_EMOJI[e.kind], until: now + EMOTE_BUBBLE_MS };
        const action: AvatarAction | null = e.kind === 'wave' ? 'wave' : e.kind === 'cheer' ? 'cheer' : null;
        const act = action ? a.actions[action] : undefined;
        if (action && act) a.emote = { action, until: now + act.getClip().duration * 1000 };
      }

      // Rebuild bodies when the character (or its clip choices) changes.
      const tpl = templateRef.current;
      const sig = JSON.stringify(p.clips);
      const clipsChanged = sig !== clipsSig;
      clipsSig = sig;

      // Everyone present (me included).
      const present = new Set<string>();
      for (const person of p.people) {
        const isMe = person.userId === p.meId;
        const pose = isMe ? { x: me.x, z: me.z, rot: me.rot, anim: moving ? 'walk' : 'idle' } : p.remotes.pose(person.userId, now);
        if (!pose) continue; // not placed yet
        present.add(person.userId);
        let a = avatars.get(person.userId);
        if (!a) { a = makeAvatar(); avatars.set(person.userId, a); }
        if (a.bodyFor !== tpl || clipsChanged) setBody(a, person.userId, tpl);
        a.root.position.set(pose.x, 0, pose.z);
        a.root.rotation.y = pose.rot;
        if (a.emote && (a.emote.until <= now || pose.anim === 'walk')) a.emote = null;
        const want: AvatarAction = a.emote ? a.emote.action : pose.anim === 'walk' ? 'walk' : 'idle';
        play(a, a.actions[want] ? want : a.actions.idle ? 'idle' : null);
        a.mixer?.update(dt);
        updateLabel(a, person, isMe, now);
      }
      // Draw me even before presence lists me.
      if (!present.has(p.meId)) {
        let a = avatars.get(p.meId);
        if (!a) { a = makeAvatar(); avatars.set(p.meId, a); }
        if (a.bodyFor !== tpl || clipsChanged) setBody(a, p.meId, tpl);
        a.root.position.set(me.x, 0, me.z);
        a.root.rotation.y = me.rot;
        play(a, moving && a.actions.walk ? 'walk' : a.actions.idle ? 'idle' : null);
        a.mixer?.update(dt);
        updateLabel(a, undefined, true, now);
        present.add(p.meId);
      }
      for (const id of [...avatars.keys()]) if (!present.has(id)) removeAvatar(id);

      // Conversation rings.
      if (groupsDirty.current) {
        groupsDirty.current = false;
        for (const child of [...ringLayer.children]) { ringLayer.remove(child); (child as THREE.Mesh).geometry.dispose(); }
        for (const g of p.groups) {
          if (!g.circle) continue;
          const ring = new THREE.Mesh(new THREE.RingGeometry(g.circle.r - 0.05, g.circle.r, 64), ringMat);
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(g.circle.x, 0.015, g.circle.z);
          ringLayer.add(ring);
        }
      }

      // Click marker fades out.
      if (marker.visible) {
        const left = markerUntil - now;
        if (left <= 0) marker.visible = false;
        else (marker.material as THREE.MeshBasicMaterial).opacity = Math.min(0.8, left / 600);
      }

      // Follow me.
      const k = 1 - Math.exp(-dt * 5);
      target.x += (me.x - target.x) * k;
      target.z += (me.z - target.z) * k;
      camera.position.copy(target).add(CAMERA_OFFSET);
      camera.lookAt(target);

      renderer.render(scene, camera);
      labels.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (me.path) latest.current.endPath();
      latest.current.controls.current = null;
      for (const id of [...avatars.keys()]) removeAvatar(id);
      for (const child of [...ringLayer.children]) (child as THREE.Mesh).geometry.dispose();
      floorMesh.geometry.dispose();
      (floorMesh.material as THREE.Material).dispose();
      gridGeo.dispose();
      (grid.material as THREE.Material).dispose();
      edgeGeo.dispose();
      (edge.material as THREE.Material).dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      shadowTex.dispose();
      ringMat.dispose();
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    };
  }, [quality, floor]);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0"
      role="application"
      aria-label="3D office. Click or tap the floor to walk there, or use the arrow keys or W A S D. Scroll to zoom."
    />
  );
}
