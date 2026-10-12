import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { lerpAngle, pointAlong } from '@/spatial/net/interpolation';
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
  cellCenter, facing, freeSpot, keyDirection, mapCell, moveKeyFor, pinRootMotion, spawnPoint, stepTo, walkMap, WALK_SPEED,
  type Floor, type MoveKey,
} from '@/spatial/scene/floor';
import type { OfficeLayout } from '@/spatial/scene/offices';
import { seatApproach, seatAt, seatOnRay, sittingSpot, type Seat } from '@/spatial/scene/seats';

/** What the world toolbar and the people panel can ask the scene to do. */
export interface SceneControls {
  center: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Walk to someone (stops a little short of them). Returns false if they aren't placed yet. */
  walkTo: (userId: string) => boolean;
}

/** A character from the shared library, ready to load. */
export interface SceneCharacter {
  id: string;
  /** Signed URL of the .glb. */
  url: string;
  clips: SpaceClips;
}

export interface SpaceSceneProps {
  /** The SYNAPSE character library. Each person appears as the one they chose, else the default. */
  library: SceneCharacter[];
  defaultCharacterId: string | null;
  /** The character I chose (others' choices arrive with their presence). */
  myCharacterId: string | null;
  floor: Floor;
  /** A built office to show and walk around in, or null for the open floor. */
  office?: OfficeLayout | null;
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
  /** Click-to-walk; `sitAtEnd` when the route ends in a seat. */
  startPath: (points: [number, number][], speed: number, sitAtEnd?: boolean) => void;
  endPath: () => void;
  onEmote: (fn: (e: EmoteMsg) => void) => () => void;
  /** My own reactions (others' arrive through onEmote). */
  localEmote: { kind: EmoteKind; id: number } | null;
  controls: MutableRefObject<SceneControls | null>;
  /** A character file couldn't be loaded; simple figures are used instead. */
  onCharacterError?: (message: string) => void;
}

const AVATAR_HEIGHT = 1.7;
const LABEL_HEIGHT = 2.0;
const CAMERA_OFFSET = new THREE.Vector3(10, 9.9, 10); // looks down at about 35°, from the +x/+z corner
const VIEW_HEIGHT = 12; // metres of floor visible top to bottom at zoom 1
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.6;
const EMOTE_BUBBLE_MS = 3000;
/** Walking grid inside a built office: fine enough for doorways, with room for the avatar's body. */
const OFFICE_CELL = 0.25;
const OFFICE_CLEARANCE = 0.28;
const ONE_SHOT: AvatarAction[] = ['wave', 'cheer'];

interface Template {
  id: string;
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  scale: number;
  lift: number;
}

interface Avatar {
  root: THREE.Group;
  body: THREE.Object3D | null;
  bodyFor: Template | null | undefined;
  /** The clip choices the body was built with. */
  clipsSig: string;
  mixer: THREE.AnimationMixer | null;
  actions: Partial<Record<AvatarAction, THREE.AnimationAction>>;
  current: AvatarAction | null;
  emote: { action: AvatarAction; until: number } | null;
  label: CSS2DObject;
  labelEl: HTMLDivElement;
  labelSig: string;
  bubble: { text: string; until: number } | null;
  /** Bones for the seated pose (when the character has no sitting clip of its own). */
  rig: Rig | null;
  /** Was drawn seated last frame (so the body can be put back when standing up). */
  seated: boolean;
}

interface Limb { root: THREE.Object3D; mid: THREE.Object3D; end: THREE.Object3D }
interface Rig {
  legs: Limb[];
  arms: Limb[];
  /** Every bone's natural (standing) pose, from the file. */
  rest: { bone: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3 }[];
}

/** Legs and arms of a rigged character, found by the usual bone names (Mixamo, Meshy, Blender). */
function findRig(model: THREE.Object3D): Rig | null {
  const legs: Limb[] = [];
  const arms: Limb[] = [];
  const rest: Rig['rest'] = [];
  const isBone = (o: THREE.Object3D | null | undefined): o is THREE.Object3D => !!o && !!(o as THREE.Bone).isBone;
  const firstBone = (o: THREE.Object3D) => o.children.find(isBone);
  model.traverse((o) => {
    if (!isBone(o)) return;
    rest.push({ bone: o, q: o.quaternion.clone(), p: o.position.clone() });
    if (/twist|roll/i.test(o.name)) return;
    if (/up_?leg|thigh|upper_?leg/i.test(o.name)) {
      const mid = firstBone(o);
      const end = mid && firstBone(mid);
      if (mid && end) legs.push({ root: o, mid, end });
    } else if (/hand$/i.test(o.name.replace(/[._-]?[lr]$/i, '').replace(/^.*[:|]/, '')) || /(^|[^a-z])hand([^a-z]|$)/i.test(o.name)) {
      // Hand → forearm → upper arm.
      const mid = o.parent;
      const root = mid?.parent;
      if (isBone(mid) && isBone(root) && arms.every((a) => a.end !== o)) arms.push({ root, mid, end: o });
    }
  });
  return legs.length === 2 ? { legs, arms: arms.length === 2 ? arms : [], rest } : null;
}

const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
/** Turns `bone` so the direction to `child` points along `want` (world space, unit length). */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, want: THREE.Vector3) {
  if (!bone.parent) return;
  bone.getWorldPosition(_va);
  child.getWorldPosition(_vb);
  const cur = _vb.sub(_va);
  if (cur.lengthSq() < 1e-10) return;
  cur.normalize();
  _qa.setFromUnitVectors(cur, want);
  bone.getWorldQuaternion(_qb);
  bone.parent.getWorldQuaternion(_qc);
  bone.quaternion.copy(_qc.invert().multiply(_qa.multiply(_qb)));
  bone.updateMatrixWorld(true);
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

/** Ground around a built office: dark slate under the office, darker towards the edges. */
const GROUND_CENTER = '#262C37';
const GROUND_EDGE = '#12151B';
function groundTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 6, 128, 128, 128);
  grad.addColorStop(0, GROUND_CENTER);
  grad.addColorStop(0.18, GROUND_CENTER);
  grad.addColorStop(1, GROUND_EDGE);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
  /** Loaded characters by id ('loading' / 'failed' while not usable). Kept across scene rebuilds. */
  const templates = useRef(new Map<string, Template | 'loading' | 'failed'>());
  const emotesRef = useRef<{ userId: string; kind: EmoteKind }[]>([]);
  const groupsDirty = useRef(true);
  /** Where I am, kept when the scene is rebuilt (e.g. a graphics quality change). */
  const myPlace = useRef<{ x: number; z: number; rot: number } | null>(null);
  const zoomRef = useRef(1);
  const { quality, floor } = props;
  const office = props.office ?? null;

  // Free the loaded characters when leaving the space.
  useEffect(() => {
    const loaded = templates.current;
    return () => {
      for (const t of loaded.values()) if (typeof t === 'object') disposeObject(t.scene);
      loaded.clear();
    };
  }, []);

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
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: low ? 'low-power' : 'high-performance' });
    renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    // Real shadows inside a built office (not on Low).
    const shadows = !!office && !low;
    if (shadows) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    mount.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    labels.domElement.style.position = 'absolute';
    labels.domElement.style.inset = '0';
    labels.domElement.style.pointerEvents = 'none';
    mount.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(office ? GROUND_EDGE : '#0D1C3B');
    // A built office stands on a dark ground that fades out, never floating in an empty sky.
    let ground: THREE.Mesh | null = null;
    if (office) {
      ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ map: groundTexture(), toneMapped: false }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(floor.width / 2, -0.52, floor.depth / 2);
      scene.add(ground);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envMap;
    scene.environmentIntensity = 0.7;
    scene.add(new THREE.HemisphereLight('#ffffff', '#8A95B0', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(6, 12, 8);
    scene.add(sun);
    if (shadows) {
      // Light the whole floor from the same direction, with a shadow camera that covers it.
      // Where the sun shines from: the office's own (to match light baked into its floor), else front-right.
      const from = office.sun ?? { x: 9, y: 18, z: 12 };
      const len = Math.hypot(from.x, from.y, from.z) || 1;
      sun.position.set(floor.width / 2 + (from.x / len) * 24, (from.y / len) * 24, floor.depth / 2 + (from.z / len) * 24);
      sun.target.position.set(floor.width / 2, 0, floor.depth / 2);
      scene.add(sun.target);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const half = Math.max(floor.width, floor.depth) * 0.8;
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 70 });
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
      sun.shadow.radius = 3;
    }

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

    // A built office: one GLB, merged by material so it draws in a few dozen batches.
    const officeRoot = new THREE.Group();
    officeRoot.name = 'office';
    scene.add(officeRoot);
    if (office) {
      new GLTFLoader().load(
        office.url,
        (gltf) => {
          if (disposed) return;
          gltf.scene.updateMatrixWorld(true);
          const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
          // BAKED_* meshes carry light rendered in Blender (sun, lamps, soft shadows) in their
          // texture: shown as-is. Furniture shadows are then already on the floor, so only people
          // cast live ones, onto a see-through layer just above it. SRC_* are the unbaked sources.
          let baked = false;
          gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name.startsWith('BAKED_')) baked = true; });
          gltf.scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh || mesh.name.startsWith('SRC_')) return;
            const mat = mesh.material as THREE.Material;
            if (mesh.name.startsWith('BAKED_')) {
              const map = (mat as THREE.MeshStandardMaterial).map ?? null;
              const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
              // Just above y = 0, under the soft shadow drawn at each person's feet.
              geo.computeBoundingBox();
              geo.translate(0, 0.002 - (geo.boundingBox?.max.y ?? 0), 0);
              const flat = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, toneMapped: false }));
              mat.dispose();
              officeRoot.add(flat);
              return;
            }
            let geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
            for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
            if (geo.index) geo = geo.toNonIndexed();
            const list = byMaterial.get(mat) ?? [];
            list.push(geo);
            byMaterial.set(mat, list);
          });
          for (const [mat, geos] of byMaterial) {
            const merged = mergeGeometries(geos);
            for (const g of geos) g.dispose();
            if (!merged) continue;
            if (mat.transparent) { mat.depthWrite = false; mat.side = THREE.DoubleSide; }
            const mesh = new THREE.Mesh(merged, mat);
            mesh.castShadow = shadows && !mat.transparent && !baked;
            mesh.receiveShadow = shadows;
            officeRoot.add(mesh);
          }
          if (baked && shadows) {
            const catcher = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.ShadowMaterial({ opacity: 0.28 }));
            catcher.rotation.x = -Math.PI / 2;
            catcher.position.set(W / 2, 0.005, D / 2);
            catcher.receiveShadow = true;
            officeRoot.add(catcher);
          }
          // Lights and cameras from Blender are left out: the scene has its own.
          gltf.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
          grid.visible = false;
          edge.visible = false;
          (floorMesh.material as THREE.Material).visible = false; // still catches clicks
        },
        undefined,
        () => { latest.current.onCharacterError?.("Couldn't load the office; showing the open floor instead."); },
      );
    }

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
    // High quality in a built office: soft contact shadows where things meet (ambient occlusion).
    let composer: EffectComposer | null = null;
    if (office && !low) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const ao = new GTAOPass(scene, camera, mount.clientWidth || 1, mount.clientHeight || 1);
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = 0.85;
      composer.addPass(ao);
      composer.addPass(new OutputPass());
    }
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      composer?.setSize(w, h);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      labels.setSize(w, h);
      applyCamera();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // Me.
    const map = office ? walkMap(floor, office.obstacles, OFFICE_CELL, OFFICE_CLEARANCE) : walkMap(floor);
    // Appear near the middle (or where you were before a rebuild), never inside furniture.
    const from = myPlace.current ?? spawnPoint(floor);
    const start = freeSpot(map, from.x, from.z);
    const me = {
      x: start.x, z: start.z, rot: myPlace.current?.rot ?? Math.PI * 1.25,
      path: null as null | { points: [number, number][]; startedAt: number },
      /** The seat I'm in, and the one I'm walking to. */
      seat: null as Seat | null,
      pathSeat: null as Seat | null,
    };
    target.set(me.x, 0, me.z);
    const held = new Set<MoveKey>();
    const seats = office?.seats ?? [];
    /** Seats other people are sitting in (updated every frame). */
    let occupied = new Set<string>();

    /** Walk to (x, z), or to a seat and sit in it. Standing up first if I'm sitting. */
    const walkTo = (x: number, z: number, seat: Seat | null = null) => {
      // Tapping on furniture walks to the nearest free spot beside it.
      const goal = seat ? seatApproach(map, seat) : freeSpot(map, x, z);
      // Stand up on the free side of my seat, then go from there.
      const from = me.seat ? seatApproach(map, me.seat) : { x: me.x, z: me.z };
      const cells = findPath(map.grid, mapCell(map, from.x, from.z), mapCell(map, goal.x, goal.z));
      if (!cells) return false;
      const smooth = smoothPath(map.grid, cells);
      const points: [number, number][] = smooth.map((c) => cellCenter(map, c));
      points[0] = [from.x, from.z];
      if (points.length === 1) points.push([goal.x, goal.z]);
      else points[points.length - 1] = [goal.x, goal.z];
      if (me.seat) points.unshift([me.x, me.z]);
      if (seat) points.push([seat.x, seat.z]);
      // Drop zero-length steps (e.g. already standing at the seat).
      const route = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-3);
      const length = route.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - route[i - 1][0], p[1] - route[i - 1][1]) : 0), 0);
      if (length < 0.05 || route.length < 2) return false;
      me.path = { points: route, startedAt: performance.now() };
      me.seat = null;
      me.pathSeat = seat;
      latest.current.startPath(route, WALK_SPEED, !!seat);
      marker.position.set(goal.x, 0.02, goal.z);
      marker.visible = true;
      markerUntil = performance.now() + 900;
      return true;
    };

    // Characters load the first time someone appears as them.
    const loadTemplate = (entry: SceneCharacter) => {
      templates.current.set(entry.id, 'loading');
      new GLTFLoader().load(
        entry.url,
        (gltf) => {
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
          templates.current.set(entry.id, {
            id: entry.id,
            scene: gltf.scene,
            clips: new Map(gltf.animations.map((c) => [c.name, c])),
            scale,
            lift: -box.min.y * scale,
          });
        },
        undefined,
        () => {
          templates.current.set(entry.id, 'failed');
          latest.current.onCharacterError?.("Couldn't load a character; showing a simple figure instead.");
        },
      );
    };
    /** The loaded character someone appears as, or null (a simple figure) while it loads. */
    const templateFor = (chosenId: string | null | undefined): Template | null => {
      const { library, defaultCharacterId } = latest.current;
      const entry = (chosenId ? library.find((c) => c.id === chosenId) : undefined)
        ?? library.find((c) => c.id === defaultCharacterId);
      if (!entry) return null;
      const t = templates.current.get(entry.id);
      if (t === undefined) { loadTemplate(entry); return null; }
      return typeof t === 'object' ? t : null;
    };
    const clipsFor = (tpl: Template | null): SpaceClips | null =>
      (tpl ? latest.current.library.find((c) => c.id === tpl.id)?.clips : null) ?? null;

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
      return { root, body: null, bodyFor: undefined, clipsSig: '', mixer: null, actions: {}, current: null, emote: null, label, labelEl, labelSig: '', bubble: null, rig: null, seated: false };
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
      a.rig = null;
      a.seated = false;
      a.bodyFor = tpl;
      const names = clipsFor(tpl);
      a.clipsSig = JSON.stringify(names);
      if (!tpl) {
        a.body = makeFigure(userId);
      } else {
        const holder = new THREE.Group();
        const model = cloneSkinned(tpl.scene);
        model.scale.setScalar(tpl.scale);
        model.position.y = tpl.lift;
        holder.add(model);
        a.body = holder;
        a.rig = findRig(model);
        a.mixer = new THREE.AnimationMixer(model);
        for (const action of AVATAR_ACTIONS) {
          const name = names?.[action];
          const clip = name ? tpl.clips.get(name) : undefined;
          if (!clip) continue;
          const act = a.mixer.clipAction(clip);
          if (ONE_SHOT.includes(action)) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
          a.actions[action] = act;
        }
      }
      if (shadows) a.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
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
    /**
     * Seated. A character with a sitting clip chosen on the Characters page plays it. Otherwise it
     * sits from its natural standing pose: back straight, thighs forward along the cushion, shins
     * down, hands resting forward on the lap, and the hips lowered onto the cushion. Done after the
     * frame's clips so nothing else moves the body. A simple figure sinks into the seat.
     */
    const fwd = new THREE.Vector3();
    const side = new THREE.Vector3();
    const dirA = new THREE.Vector3();
    const dirB = new THREE.Vector3();
    const toRest = (rig: Rig) => { for (const r of rig.rest) { r.bone.quaternion.copy(r.q); r.bone.position.copy(r.p); } };
    const poseSeated = (a: Avatar, seat: Seat | null) => {
      if (!a.body) return;
      a.label.position.y = seat ? LABEL_HEIGHT - 0.45 : LABEL_HEIGHT;
      if (!seat) {
        if (a.seated) {
          a.body.position.y = 0;
          if (a.rig) toRest(a.rig); // the standing clips take over from here
          a.seated = false;
        }
        return;
      }
      a.seated = true;
      if (!a.bodyFor) { a.body.position.y = -(0.95 - seat.y); return; } // simple figure
      if (a.current === 'sit' || !a.rig) { a.body.position.y = 0; return; }
      const rig = a.rig;
      toRest(rig);
      a.body.position.y = 0;
      a.root.updateMatrixWorld(true);
      fwd.set(Math.sin(a.root.rotation.y), 0, Math.cos(a.root.rotation.y));
      // Thighs along the cushion (slightly down to the knee), shins straight down to the floor.
      dirA.copy(fwd).add(_va.set(0, -0.08, 0)).normalize();
      dirB.copy(fwd).multiplyScalar(0.08).add(_va.set(0, -1, 0)).normalize();
      let hipY = 0;
      let hipX = 0;
      let hipZ = 0;
      for (const leg of rig.legs) {
        aimBone(leg.root, leg.mid, dirA);
        aimBone(leg.mid, leg.end, dirB);
        leg.root.getWorldPosition(_vb);
        hipY += _vb.y; hipX += _vb.x; hipZ += _vb.z;
      }
      hipY /= rig.legs.length; hipX /= rig.legs.length; hipZ /= rig.legs.length;
      // Upper arms down by the sides, forearms forward so the hands rest on the thighs.
      for (const arm of rig.arms) {
        arm.root.getWorldPosition(_vb);
        side.set(_vb.x - hipX, 0, _vb.z - hipZ);
        side.addScaledVector(fwd, -side.dot(fwd));
        if (side.lengthSq() > 1e-6) side.normalize();
        dirA.copy(fwd).multiplyScalar(0.18).addScaledVector(side, 0.12).add(_va.set(0, -1, 0)).normalize();
        aimBone(arm.root, arm.mid, dirA);
        dirB.copy(fwd).multiplyScalar(0.9).addScaledVector(side, -0.08).add(_va.set(0, -0.42, 0)).normalize();
        aimBone(arm.mid, arm.end, dirB);
      }
      // Hip joints just above the cushion.
      a.body.position.y = Math.min(0.3, Math.max(-0.9, seat.y + 0.07 - hipY));
    };
    const play = (a: Avatar, want: AvatarAction | null) => {
      if (want === a.current) return;
      const prev = a.current ? a.actions[a.current] : undefined;
      const next = want ? a.actions[want] : undefined;
      prev?.fadeOut(0.2);
      if (next) next.reset().fadeIn(0.2).play();
      a.current = want;
    };

    const updateLabel = (a: Avatar, p: PresenceMeta | undefined, isMe: boolean, now: number) => {
      const st = p ? shownStatus(p) : null;
      const hand = latest.current.raisedHands.has(p?.userId ?? '');
      const bubble = a.bubble && a.bubble.until > now ? a.bubble.text : '';
      // First names, like people call each other in an office (mine too, not "You").
      const full = p?.name ?? (isMe ? latest.current.people.find((x) => x.userId === latest.current.meId)?.name : '') ?? '';
      const name = full.trim().split(/\s+/)[0] || (isMe ? 'You' : '');
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
      // A chair or sofa place: walk over and sit (unless someone's in it).
      const seat = seatOnRay(seats, raycaster.ray.origin, raycaster.ray.direction);
      if (seat && seat === me.seat) return;
      if (seat && !occupied.has(seat.id)) { walkTo(seat.x, seat.z, seat); return; }
      if (seat) { const near = seatApproach(map, seat); walkTo(near.x, near.z); return; }
      const hit = raycaster.intersectObject(floorMesh)[0];
      if (hit) walkTo(hit.point.x, hit.point.z);
    };
    // A hand over seats you can sit in.
    const onPointerMove = (e: PointerEvent) => {
      if (!seats.length || e.pointerType === 'touch') return;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const seat = seatOnRay(seats, raycaster.ray.origin, raycaster.ray.direction);
      renderer.domElement.style.cursor = seat && !occupied.has(seat.id) && seat !== me.seat ? 'pointer' : '';
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
    renderer.domElement.addEventListener('pointermove', onPointerMove);
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
        if (me.path) { me.path = null; me.pathSeat = null; p.endPath(); }
        if (me.seat) {
          // Stand up on the free side of the seat, then walk.
          const up = seatApproach(map, me.seat);
          me.x = up.x;
          me.z = up.z;
          me.seat = null;
        }
        const next = stepTo(map, me.x, me.z, dir.x * WALK_SPEED * dt, dir.z * WALK_SPEED * dt);
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
        if (at.done) {
          me.path = null;
          if (me.pathSeat) {
            // Arrived: sit down, facing the way the seat faces.
            me.seat = me.pathSeat;
            me.x = me.seat.x;
            me.z = me.seat.z;
            me.rot = me.seat.rot;
          }
          me.pathSeat = null;
          p.endPath();
        }
      }
      // Kept for a scene rebuild: standing beside my seat if I'm in one.
      const place = me.seat ? seatApproach(map, me.seat) : me;
      myPlace.current = { x: place.x, z: place.z, rot: me.rot };
      const myAnim = moving ? 'walk' : me.seat ? 'sit' : 'idle';
      p.onLocal({ x: me.x, z: me.z, rot: me.rot, anim: myAnim });

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
      const needsBody = (a: Avatar, tpl: Template | null) => a.bodyFor !== tpl || a.clipsSig !== JSON.stringify(clipsFor(tpl));

      // Place, turn, animate and (if sitting) seat one avatar.
      const turn = 1 - Math.exp(-dt * 14);
      const nowOccupied = new Set<string>();
      const drawAvatar = (a: Avatar, pose: { x: number; z: number; rot: number; anim: string }, seat: Seat | null) => {
        const spot = seat ? sittingSpot(seat) : pose;
        a.root.position.set(spot.x, 0, spot.z);
        a.root.rotation.y = lerpAngle(a.root.rotation.y, seat ? seat.rot : pose.rot, turn);
        if (a.emote && (a.emote.until <= now || pose.anim === 'walk')) a.emote = null;
        const want: AvatarAction | null = a.emote ? a.emote.action : pose.anim === 'walk' ? 'walk'
          : seat ? (a.actions.sit ? 'sit' : a.rig ? null : 'idle') : 'idle';
        play(a, want && a.actions[want] ? want : want && a.actions.idle ? 'idle' : null);
        a.mixer?.update(dt);
        poseSeated(a, seat);
      };

      // Everyone present (me included).
      const present = new Set<string>();
      for (const person of p.people) {
        const isMe = person.userId === p.meId;
        const pose = isMe ? { x: me.x, z: me.z, rot: me.rot, anim: myAnim } : p.remotes.pose(person.userId, now);
        if (!pose) continue; // not placed yet
        present.add(person.userId);
        let a = avatars.get(person.userId);
        if (!a) { a = makeAvatar(); avatars.set(person.userId, a); }
        const tpl = templateFor(isMe ? p.myCharacterId : person.characterId);
        if (needsBody(a, tpl)) setBody(a, person.userId, tpl);
        // Others sitting: find the seat from where they are (everyone has the same office).
        const seat = pose.anim !== 'sit' ? null : isMe ? me.seat : seatAt(seats, pose.x, pose.z);
        if (seat && !isMe) nowOccupied.add(seat.id);
        drawAvatar(a, pose, seat);
        updateLabel(a, person, isMe, now);
      }
      // Draw me even before presence lists me.
      if (!present.has(p.meId)) {
        let a = avatars.get(p.meId);
        if (!a) { a = makeAvatar(); avatars.set(p.meId, a); }
        const tpl = templateFor(p.myCharacterId);
        if (needsBody(a, tpl)) setBody(a, p.meId, tpl);
        drawAvatar(a, { x: me.x, z: me.z, rot: me.rot, anim: myAnim }, me.seat);
        updateLabel(a, undefined, true, now);
        present.add(p.meId);
      }
      occupied = nowOccupied;
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
      // In an office the view stays over the office, so its edge never fills the screen.
      const fx = office ? Math.min(Math.max(me.x, Math.min(W / 2, 6)), Math.max(W / 2, W - 6)) : me.x;
      const fz = office ? Math.min(Math.max(me.z, Math.min(D / 2, 4.5)), Math.max(D / 2, D - 4.5)) : me.z;
      target.x += (fx - target.x) * k;
      target.z += (fz - target.z) * k;
      camera.position.copy(target).add(CAMERA_OFFSET);
      camera.lookAt(target);

      if (composer) composer.render(dt);
      else renderer.render(scene, camera);
      labels.render(scene, camera);
    });

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      for (const child of [...officeRoot.children]) disposeObject(child);
      officeRoot.clear();
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
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
      composer?.dispose();
      if (ground) disposeObject(ground);
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    };
  }, [quality, floor, office]);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0"
      role="application"
      aria-label="3D office. Click or tap the floor to walk there, or use the arrow keys or W A S D. Scroll to zoom."
    />
  );
}
