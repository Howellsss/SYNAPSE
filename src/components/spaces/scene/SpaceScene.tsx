import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { lerpAngle, pointAlong } from '@/spatial/net/interpolation';
import { shownStatus } from '@/spatial/net/status';
import { EMOTE_EMOJI } from '@/spatial/net/emotes';
import type { RemoteStore } from '@/spatial/net/useSpaceChannel';
import type { LocalState } from '@/spatial/net/moveSender';
import type { EmoteKind, EmoteMsg, Gait, PresenceMeta } from '@/spatial/net/protocol';
import type { Group } from '@/spatial/media/proximity';
import type { GraphicsQuality } from '@/spatial/quality';
import { findPath, smoothPath } from '@/spatial/scene/pathfinding';
import { AVATAR_ACTIONS, type AvatarAction, type SpaceClips, type WalkStyle } from '@/spatial/scene/avatarClips';
import {
  BIKE_SPEED, CAR_SPEED, cellCenter, facing, freeSpot, isFree, keyDirection, mapCell, moveKeyFor, pinRootMotion, RUN_SPEED, spawnPoint, stepTo, walkMap, WALK_SPEED,
  type Floor, type MoveKey,
} from '@/spatial/scene/floor';
import type { OfficeLayout } from '@/spatial/scene/offices';
import { SIT_BACK, seatApproach, seatAt, seatOnRay, sittingSpot, type Seat } from '@/spatial/scene/seats';
import { applyEdits, NO_EDITS, type CampusEdits } from '@/spatial/scene/campus/office';
import { campusObstacles, campusSeats, portalAt, wingAt } from '@/spatial/scene/campus/layout';
import { fitsAt, isGlb, KIT_BY_ID, pieceAt, placedBounds, rideAt, type Placed, type ProcItem } from '@/spatial/scene/campus/kit';
import { groundOf } from '@/spatial/scene/campus/ground';
import { bikeParts, carParts, GLOW_LAYER, markGlow, type Part } from './kitParts';
import type { Rect } from '@/spatial/scene/offices';
import { createWorld, type World } from './campusWorld';
import { refurnish } from './refurnish';
import { flickerFlames, headlightPool, itemPartsNow, loadItemParts, vehicleLightParts, vehicleSize, wheelFlames } from './propModels';
import { aimBone, beginPose, endPose, feminineGait, findRig, relaxPosture, turnBone, type Rig } from './posture';
import { characterBytes } from '@/spatial/scene/characterCache';

/** What the world toolbar and the people panel can ask the scene to do. */
export interface SceneControls {
  center: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Walk to someone (stops a little short of them). Returns false if they aren't placed yet. */
  walkTo: (userId: string) => boolean;
  /** Start or stop dancing (also Ctrl+Z). */
  dance: () => void;
  /** Get out of the car or off the scooter you're on (also E). */
  getOut: () => void;
}

export type VehicleKind = 'car' | 'bike';

/** A car or bike someone is in: the parked piece they took, and what it is. */
interface Ride { piece: string; item: ProcItem; kind: VehicleKind }

/** One stretch of a plane's trip: where, how fast, on the ground or in the air, and what happens after. */
interface Leg { points: [number, number][]; speed: number; air: boolean; done?: () => void }

/** A car or bike like the one someone is in, when they don't say which. */
const fallbackRide = (kind: VehicleKind): Ride => ({ piece: '', item: KIT_BY_ID.get(kind === 'car' ? 'car_navy' : 'bike_teal') as ProcItem, kind });

/** The car or bike a parked piece is, if it is one. */
function rideOf(piece: Placed | undefined): Ride | null {
  const item = piece ? KIT_BY_ID.get(piece.kind) : undefined;
  if (!piece || !item || isGlb(item) || (item.proc !== 'car' && item.proc !== 'bike')) return null;
  return { piece: piece.id, item, kind: item.proc };
}
export type MoveMode = 'walk' | 'run';

/** A character from the shared library, ready to load. */
export interface SceneCharacter {
  id: string;
  /** Signed URL of the .glb. */
  url: string;
  /** Stays the same while the file does (the signed URL changes every visit), for keeping it on this device. */
  cacheKey?: string;
  clips: SpaceClips;
  /** Feminine: narrower steps, a gentle hip sway, softer arms. */
  style?: WalkStyle;
}

export interface SpaceSceneProps {
  /** The SYNAPSE character library. Each person appears as the one they chose, else the default. */
  library: SceneCharacter[];
  defaultCharacterId: string | null;
  /** The character library has arrived (until then nobody is drawn as a stand-in figure). */
  charactersReady?: boolean;
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
  startPath: (points: [number, number][], speed: number, sitAtEnd?: boolean, gait?: Gait) => void;
  endPath: () => void;
  onEmote: (fn: (e: EmoteMsg) => void) => () => void;
  /** My own reactions (others' arrive through onEmote). */
  localEmote: { kind: EmoteKind; id: number } | null;
  controls: MutableRefObject<SceneControls | null>;
  /** A character file couldn't be loaded; simple figures are used instead. */
  onCharacterError?: (message: string) => void;
  /** Campus only: pieces added or taken away in build mode (applied live, no reload). */
  campusEdits?: CampusEdits;
  /** Looking down from above (default) or from the corner at an angle. */
  view?: SceneView;
  /** Campus build mode: clicks place or pick pieces instead of walking. */
  build?: BuildState | null;
  /** Walking or running by default (Shift does the other). */
  moveMode?: MoveMode;
  /** You got into a car or onto a bike (or out: null), and which parked one you took. */
  onVehicle?: (kind: VehicleKind | null, piece: string | null) => void;
}

export interface BuildState {
  /** The piece being placed (from the catalog, or one being moved), or null to pick pieces. */
  kind: string | null;
  rot: number;
  /** The piece being moved (left out when checking where the new spot fits). */
  moving: string | null;
  selected: string | null;
  onPlace: (x: number, z: number) => void;
  onSelect: (id: string | null) => void;
}

export type SceneView = 'top' | 'angled';

const AVATAR_HEIGHT = 1.7;
/** The flying car: how high it flies (clear of the trees and roofs), and how fast. */
const FLY_HEIGHT = 6;
const FLY_SPEED = 11;
/** Planes: how high they cruise, how fast they fly and taxi. */
const PLANE_HEIGHT = 15;
const PLANE_SPEED = 19;
const TAXI_SPEED = 8;
/** The helicopter: how high it flies (well over the trees). */
const HELI_HEIGHT = 12;
/** How high something in the air flies. */
const cruiseHeight = (ride: Ride | null) => (ride?.item.vehicle?.plane ? PLANE_HEIGHT : ride?.item.vehicle?.rotor ? HELI_HEIGHT : FLY_HEIGHT);
const LABEL_HEIGHT = 2.0;
/** Where the camera sits relative to what it looks at. */
const CAMERA_OFFSETS: Record<SceneView, THREE.Vector3> = {
  // From above, tilted so people and furniture still read as 3D (about 50° down).
  top: new THREE.Vector3(0, 13.5, 11),
  // From the +x/+z corner, about 35° down.
  angled: new THREE.Vector3(10, 9.9, 10),
};
/** Walking cells on the campus (it's six times the size of an office). */
const CAMPUS_CELL = 0.5;
const CAMPUS_MIN_ZOOM = 0.32;
const VIEW_HEIGHT = 12; // metres of floor visible top to bottom at zoom 1
const MIN_ZOOM = 0.45;
const OFFICE_MIN_ZOOM = 0.6;
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
  /** Bones for the seated pose (when the character has no sitting clip of its own) and posture fixes. */
  rig: Rig | null;
  /** The character's walk style (from the library). */
  style: WalkStyle;
  /** Was drawn seated last frame (so the body can be put back when standing up). */
  seated: boolean;
  /** The car or bike drawn under them while they ride (from its model once that has loaded). */
  vehicle: { item: ProcItem; kind: VehicleKind; group: THREE.Group; real: boolean; flames: THREE.Group | null; pool: THREE.Mesh | null } | null;
  /** Height off the ground (the flying car in the air). */
  lift: number;
  /** The height of what they're standing on (a floor, a rug, a stage), eased so steps are smooth. */
  ground: number;
  /** Bouncing to music without a dance clip (so the body can be put back). */
  bouncing: boolean;
}

const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();

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

/**
 * Lawn beyond a built office's own grounds (Office 02 brings a park around it): the same green,
 * darkening far away, so the world never ends in an empty sky.
 */
const GROUND_CENTER = '#5E8B3A';
const GROUND_EDGE = '#3A5A27';
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
  const zoomedOnce = useRef(false);
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
    // Checking each shader for errors makes the first frame wait on the graphics card: only while developing.
    renderer.debug.checkShaderErrors = import.meta.env.DEV;
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
    // A built office stands on a lawn that runs past the edges of the screen, never in an empty sky.
    let ground: THREE.Mesh | null = null;
    if (office) {
      ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ map: groundTexture(), toneMapped: false }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(floor.width / 2, -0.53, floor.depth / 2);
      scene.add(ground);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envMap;
    scene.environmentIntensity = 0.7;
    const hemi = new THREE.HemisphereLight('#ffffff', '#8A95B0', 1.1);
    scene.add(hemi);
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

    // SYNAPSE Campus: the whole world around the office, drawn from its layout.
    const campus = office?.campus ?? null;
    let appliedEdits = latest.current.campusEdits ?? NO_EDITS;
    let campusLayout = campus ? applyEdits(campus, appliedEdits) : null;
    let campusWorld: World | null = null;
    if (campus && campusLayout) {
      campusWorld = createWorld(campusLayout, { shadows, grass: !low });
      scene.add(campusWorld.root);
      // Golden light: a warm, lower sun with long shadows, a blue sky above and warm bounce below.
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      sun.color.set('#FFE2BC');
      sun.intensity = 2.6;
      hemi.color.set('#CFE2FF');
      hemi.groundColor.set('#6B5236');
      hemi.intensity = 0.85;
      scene.environmentIntensity = 0.45;
      scene.background = new THREE.Color(campus.wings?.length ? '#16110D' : GROUND_EDGE);
      if (ground) ground.visible = false;
      if (shadows) {
        // The shadow box follows the view (campusWorld.follow) instead of covering 120 m at once.
        Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 90 });
        sun.shadow.camera.updateProjectionMatrix();
      }
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
    if (campus) {
      // The campus has its own ground: the plain floor only catches clicks, from the start (not once
      // the office file arrives, or a slow or failed download would leave a white floor over it).
      grid.visible = false;
      edge.visible = false;
      (floorMesh.material as THREE.Material).visible = false;
    }

    // A built office: one GLB, merged by material so it draws in a few dozen batches.
    const officeRoot = new THREE.Group();
    officeRoot.name = 'office';
    scene.add(officeRoot);
    // A sign over the office door: walk up to it to go to another space.
    if (office?.door) {
      const signEl = document.createElement('div');
      signEl.className = 'pointer-events-none select-none whitespace-nowrap rounded-full bg-navy-900/90 px-2.5 py-1 text-[11px] font-semibold text-gold-300 shadow-popover';
      signEl.textContent = 'Door · other spaces';
      const sign = new CSS2DObject(signEl);
      sign.position.set(0.15, 2.55, office.door.z);
      officeRoot.add(sign);
    }
    if (office) {
      new GLTFLoader().load(
        office.url,
        (gltf) => {
          if (disposed) return;
          gltf.scene.updateMatrixWorld(true);
          if (campus && campusWorld) {
            // The kit's furniture comes from this file; then the office itself stands as the HQ,
            // without its own park (the campus has the grounds).
            campusWorld.attachKit(gltf);
            const drop: THREE.Object3D[] = [];
            gltf.scene.traverse((o) => { if (o.name === 'BAKED_ground' || o.name.startsWith('GRD_')) drop.push(o); });
            drop.forEach((o) => o.removeFromParent());
            gltf.scene.updateMatrixWorld(true);
            if (!campus.hq) {
              // A world without the HQ (the Hub) only wanted the furniture.
              gltf.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
              grid.visible = false;
              edge.visible = false;
              (floorMesh.material as THREE.Material).visible = false;
              return;
            }
            officeRoot.position.set(campus.hq.x, 0, campus.hq.z);
          }
          // The old chairs, desks, tables, sofa, lamps and plants make way for the prop models.
          officeRoot.add(refurnish(gltf.scene).group);
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
              if (mesh.name === 'BAKED_floor') {
                // Just above y = 0, under the soft shadow drawn at each person's feet.
                geo.computeBoundingBox();
                geo.translate(0, 0.002 - (geo.boundingBox?.max.y ?? 0), 0);
              }
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
            // Over the office's floor (on the campus, only the HQ's: the campus ground takes its own).
            const cw = campus ? 20.5 : W;
            const cd = campus ? 16.5 : D;
            const catcher = new THREE.Mesh(new THREE.PlaneGeometry(cw, cd), new THREE.ShadowMaterial({ opacity: 0.28 }));
            catcher.rotation.x = -Math.PI / 2;
            catcher.position.set(cw / 2, 0.005, cd / 2);
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
    // With planes in the sky the camera stands further back along the same line, so they pass
    // under it (an orthographic view looks exactly the same from further away).
    const farOffset = new THREE.Vector3();
    const cameraOffset = () => (campusLayout?.airport ? farOffset.copy(CAMERA_OFFSETS[latest.current.view ?? 'top']).multiplyScalar(3.2) : CAMERA_OFFSETS[latest.current.view ?? 'top']);
    // A built office is surrounded by its grounds; don't zoom out past them.
    const minZoom = campus ? CAMPUS_MIN_ZOOM : office ? OFFICE_MIN_ZOOM : MIN_ZOOM;
    // The campus starts a little further out, so you see where you are.
    let zoom = Math.max(minZoom, campus && !zoomedOnce.current ? 0.75 : zoomRef.current);
    zoomedOnce.current = true;
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
      camera.position.copy(target).add(cameraOffset());
      camera.lookAt(target);
      camera.updateProjectionMatrix();
    };
    // High quality in a built office: soft contact shadows where things meet (ambient occlusion).
    let composer: EffectComposer | null = null;
    let glowComposer: EffectComposer | null = null;
    const clearColor = new THREE.Color();
    if (office && !low) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const ao = new GTAOPass(scene, camera, mount.clientWidth || 1, mount.clientHeight || 1);
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = 0.85;
      composer.addPass(ao);
      // Lamps, screens, fires and string lights glow: only what's on the glow layer is bloomed
      // (drawn on its own first), then added over the scene, so bright white clothes, keyboards or
      // leaves in the sun don't glow like bulbs.
      if (campus) {
        glowComposer = new EffectComposer(renderer);
        glowComposer.renderToScreen = false;
        glowComposer.addPass(new RenderPass(scene, camera));
        glowComposer.addPass(new UnrealBloomPass(new THREE.Vector2(mount.clientWidth || 1, mount.clientHeight || 1), 0.7, 0.45, 0));
        const mix = new ShaderPass(new THREE.ShaderMaterial({
          uniforms: { baseTexture: { value: null }, glowTexture: { value: glowComposer.renderTarget2.texture } },
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'uniform sampler2D baseTexture; uniform sampler2D glowTexture; varying vec2 vUv; void main() { vec4 base = texture2D(baseTexture, vUv); vec4 glow = texture2D(glowTexture, vUv); gl_FragColor = vec4(base.rgb + glow.rgb, base.a); }',
        }), 'baseTexture');
        mix.needsSwap = true;
        composer.addPass(mix);
      }
      composer.addPass(new OutputPass());
    }
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      composer?.setSize(w, h);
      glowComposer?.setSize(w, h);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      labels.setSize(w, h);
      applyCamera();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // Me.
    let map = campusLayout
      ? walkMap(floor, campusObstacles(campusLayout), CAMPUS_CELL, OFFICE_CLEARANCE)
      : office ? walkMap(floor, office.obstacles, OFFICE_CELL, OFFICE_CLEARANCE) : walkMap(floor);
    // Appear at the world's arrival point (the campus, the Hub's courtyard) or near the middle of
    // the floor, or where you were before a rebuild; never inside furniture.
    const arrival = () => {
      const at = office?.campus?.spawn;
      return at ? { x: at.x + (Math.random() - 0.5) * 3, z: at.z + (Math.random() - 0.5) * 2 } : spawnPoint(floor);
    };
    const from = myPlace.current ?? arrival();
    const start = freeSpot(map, from.x, from.z);
    const me = {
      x: start.x, z: start.z, rot: myPlace.current?.rot ?? Math.PI * 1.25,
      path: null as null | { points: [number, number][]; startedAt: number; speed: number; gait: Gait },
      dancing: false,
      /** The car or bike I'm in, and the one I'm walking to. */
      vehicle: null as Ride | null,
      pendingVehicle: null as Ride | null,
      /** In the flying car or a plane, off the ground. */
      airborne: false,
      /** A plane's next stretches (taxi out then take off; fly in, land and taxi back), and what to do at the end of this one. */
      legs: [] as Leg[],
      pathDone: null as (() => void) | null,
      /** A plane on its way in to land (don't circle). */
      landing: false,
      /** The seat I'm in, and the one I'm walking to. */
      seat: null as Seat | null,
      pathSeat: null as Seat | null,
    };
    // Development only: lets browser checks reach the scene (never in a production build).
    if (import.meta.env.DEV) (window as unknown as { __scene?: unknown }).__scene = { scene, camera, renderer, me };
    target.set(me.x, 0, me.z);
    const held = new Set<MoveKey>();
    let seats = campusLayout ? campusSeats(campusLayout) : office?.seats ?? [];
    /** How high the floor is underfoot: building floors, rugs, stages and their steps. */
    let underfootMap = campusLayout ? groundOf(campusLayout.buildings, campusLayout.objects, campusLayout.paths) : null;
    /** Seats other people are sitting in (updated every frame). */
    let occupied = new Set<string>();
    /** Parked cars and bikes someone is out in (updated every frame): not drawn in their bays. */
    let taken = new Set<string>();
    /** Which way the car I'm walking to is parked (I get in facing that way). */
    let pendingRot = 0;
    /** Pieces by id, for finding the car or bike someone took. */
    const piecesById = new Map((campusLayout?.objects ?? []).map((o) => [o.id, o]));

    /** Walk to (x, z), or to a seat and sit in it. Standing up first if I'm sitting. */
    let shiftHeld = false;
    const running = () => shiftHeld !== (latest.current.moveMode === 'run');
    const flying = () => !!me.vehicle?.item.vehicle?.flies;
    const inPlane = () => !!me.vehicle?.item.vehicle?.plane;
    const gaitNow = (): Gait => (me.vehicle?.kind === 'car' ? (flying() && me.airborne ? 'fly' : 'drive') : me.vehicle?.kind === 'bike' ? 'ride' : running() ? 'run' : 'walk');
    const stopLegs = () => { me.legs = []; me.pathDone = null; me.landing = false; };
    const setVehicleMine = (ride: Ride | null) => {
      if (me.vehicle?.piece === ride?.piece) return;
      // Out of the flying car in the air: down onto the nearest clear ground first.
      if (!ride && me.airborne) {
        const down = freeSpot(map, me.x, me.z);
        me.x = down.x;
        me.z = down.z;
        if (me.path) { me.path = null; me.pathSeat = null; latest.current.endPath(); }
      }
      stopLegs();
      me.airborne = false;
      me.vehicle = ride;
      // In a plane: zoom out, so the whole plane and where it's going are in view.
      if (ride?.item.vehicle?.plane) { zoom = minZoom; applyCamera(); }
      latest.current.onVehicle?.(ride?.kind ?? null, ride?.piece ?? null);
    };
    /** Start one stretch of a trip (others see it as a route, like a walk). */
    const startLeg = (leg: Leg) => {
      if (leg.points.length < 2) { leg.done?.(); return; }
      me.airborne = leg.air;
      const gait: Gait = leg.air ? 'fly' : 'drive';
      me.path = { points: leg.points, startedAt: performance.now(), speed: leg.speed, gait };
      me.pathDone = leg.done ?? null;
      me.seat = null;
      me.dancing = false;
      me.pathSeat = null;
      latest.current.startPath(leg.points, leg.speed, false, gait);
    };
    const runLegs = (legs: Leg[]) => {
      me.legs = legs.slice(1);
      startLeg(legs[0]);
    };
    const inBounds = (x: number, z: number): [number, number] => [Math.min(W - 0.6, Math.max(0.6, x)), Math.min(D - 0.6, Math.max(0.6, z))];
    const showMarker = (x: number, z: number) => {
      marker.position.set(x, 0.02, z);
      marker.visible = true;
      markerUntil = performance.now() + 900;
    };
    /**
     * The flying car goes straight there through the air and lands on clear ground. A plane on the
     * ground taxis to the end of the runway and takes off first; in the air it flies there, then
     * circles until it's sent on or brought in to land.
     */
    const flyTo = (x: number, z: number) => {
      const [gx, gz] = inBounds(x, z);
      if (inPlane()) {
        me.landing = false;
        const strip = campusLayout?.airport?.runway;
        if (!me.airborne && strip) {
          // From the end of the runway nearer the plane, along it, lifting off half way.
          const west = me.x < (strip.x0 + strip.x1) / 2;
          const start: [number, number] = [west ? strip.x0 + 8 : strip.x1 - 8, strip.z];
          const lift: [number, number] = [west ? strip.x0 + 70 : strip.x1 - 70, strip.z];
          runLegs([
            { points: [[me.x, me.z], start], speed: TAXI_SPEED, air: false },
            { points: [start, lift, [gx, gz]], speed: PLANE_SPEED, air: true },
          ]);
        } else {
          me.legs = [];
          startLeg({ points: [[me.x, me.z], [gx, gz]], speed: PLANE_SPEED, air: true });
        }
        showMarker(gx, gz);
        return true;
      }
      const goal = freeSpot(map, gx, gz);
      if (Math.hypot(goal.x - me.x, goal.z - me.z) < 0.05) return false;
      startLeg({ points: [[me.x, me.z], [goal.x, goal.z]], speed: FLY_SPEED, air: true });
      showMarker(goal.x, goal.z);
      return true;
    };
    /** A plane with nowhere to go flies a wide circle where it is. */
    const circle = () => {
      const r = 26;
      const cx = me.x + Math.cos(me.rot) * r;
      const cz = me.z - Math.sin(me.rot) * r;
      const a0 = Math.atan2(me.z - cz, me.x - cx);
      const pts: [number, number][] = [];
      for (let i = 0; i <= 32; i++) {
        const a = a0 - (i / 32) * Math.PI * 2;
        pts.push(inBounds(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
      }
      startLeg({ points: pts, speed: PLANE_SPEED * 0.8, air: true });
    };
    /** Get out: a plane in the air flies in, lands on the runway and taxis back to its stand first. */
    const getOut = () => {
      const ride = me.vehicle;
      if (!ride) return;
      const stand = piecesById.get(ride.piece);
      const strip = campusLayout?.airport?.runway;
      const behind = () => {
        if (!stand) return;
        const away = ride.item.d / 2 + 0.7;
        const at = freeSpot(map, stand.x - Math.sin(stand.rot) * away, stand.z - Math.cos(stand.rot) * away);
        me.x = at.x;
        me.z = at.z;
      };
      if (ride.item.vehicle?.plane && me.airborne && stand && strip) {
        if (me.landing) return;
        me.landing = true;
        // In over the far end of the runway, down along it towards the stand, then taxi in.
        const west = stand.x < (strip.x0 + strip.x1) / 2;
        const over: [number, number] = [west ? strip.x1 - 2 : strip.x0 + 2, strip.z];
        const slow: [number, number] = [stand.x + (west ? 25 : -25), strip.z];
        runLegs([
          { points: [[me.x, me.z], over], speed: PLANE_SPEED, air: true },
          { points: [over, slow], speed: 16, air: false },
          {
            points: [slow, [stand.x, strip.z], [stand.x, stand.z]],
            speed: TAXI_SPEED,
            air: false,
            done: () => { setVehicleMine(null); behind(); me.rot = stand.rot; },
          },
        ]);
        return;
      }
      // The helicopter flies back to its bay, comes straight down, and you step out there.
      if (ride.item.vehicle?.rotor && stand && Math.hypot(me.x - stand.x, me.z - stand.z) > 0.5) {
        if (me.landing) return;
        me.landing = true;
        runLegs([{
          points: [[me.x, me.z], [stand.x, stand.z]], speed: FLY_SPEED * 1.4, air: true,
          done: () => { setVehicleMine(null); behind(); me.rot = stand.rot; me.landing = false; },
        }]);
        return;
      }
      setVehicleMine(null);
      if (ride.item.vehicle?.plane || ride.item.vehicle?.rotor) behind();
    };
    const walkTo = (x: number, z: number, seat: Seat | null = null, gait: Gait = gaitNow()) => {
      if (!seat) me.pendingVehicle = null;
      if (!seat && flying()) return flyTo(x, z);
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
      const speed = gait === 'run' ? RUN_SPEED : gait === 'drive' ? CAR_SPEED : gait === 'ride' ? BIKE_SPEED : gait === 'fly' ? FLY_SPEED : WALK_SPEED;
      me.path = { points: route, startedAt: performance.now(), speed, gait };
      me.seat = null;
      me.dancing = false;
      me.pathSeat = seat;
      latest.current.startPath(route, speed, !!seat, gait);
      marker.position.set(goal.x, 0.02, goal.z);
      marker.visible = true;
      markerUntil = performance.now() + 900;
      return true;
    };

    // Characters load the first time someone appears as them.
    const loadTemplate = (entry: SceneCharacter) => {
      templates.current.set(entry.id, 'loading');
      const loaded = (gltf: GLTF) => {
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
      };
      const failed = () => {
        templates.current.set(entry.id, 'failed');
        latest.current.onCharacterError?.("Couldn't load a character; showing a simple figure instead.");
      };
      // Kept on this device after the first visit, so characters appear straight away. A failed
      // download is tried once more before falling back to the simple figure.
      const fetchOnce = () => characterBytes(entry.cacheKey ?? entry.url, entry.url).then((bytes) => new GLTFLoader().parseAsync(bytes, ''));
      fetchOnce()
        .catch(() => new Promise((ok) => setTimeout(ok, 1500)).then(fetchOnce))
        .then(loaded, failed);
    };
    const entryFor = (chosenId: string | null | undefined) => {
      const { library, defaultCharacterId } = latest.current;
      return (chosenId ? library.find((c) => c.id === chosenId) : undefined) ?? library.find((c) => c.id === defaultCharacterId);
    };
    /**
     * Nobody is drawn as a stand-in figure while their character is on its way (just their name
     * shows); the simple figure is only for when there is no character or it can't load.
     */
    const waitingFor = (chosenId: string | null | undefined): boolean => {
      if (latest.current.charactersReady === false) return true;
      const entry = entryFor(chosenId);
      if (!entry) return false;
      const t = templates.current.get(entry.id);
      // Still on its way, however long that takes: the stand-in figure is only for a failed load.
      return t === 'loading' || t === undefined;
    };
    /** The loaded character someone appears as, or null while it loads (or when there's none). */
    const templateFor = (chosenId: string | null | undefined): Template | null => {
      const entry = entryFor(chosenId);
      if (!entry) return null;
      const t = templates.current.get(entry.id);
      if (t === undefined) { loadTemplate(entry); return null; }
      return typeof t === 'object' ? t : null;
    };
    const clipsFor = (tpl: Template | null): SpaceClips | null =>
      (tpl ? latest.current.library.find((c) => c.id === tpl.id)?.clips : null) ?? null;
    const bodySig = (tpl: Template | null, waiting: boolean) => (tpl ? JSON.stringify([clipsFor(tpl), latest.current.library.find((c) => c.id === tpl.id)?.style]) : waiting ? 'waiting' : 'figure');
    // Start fetching the characters people are most likely to be, before anyone is drawn.
    for (const id of new Set([latest.current.myCharacterId, latest.current.defaultCharacterId])) templateFor(id);

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
      return { root, body: null, bodyFor: undefined, clipsSig: '', mixer: null, actions: {}, current: null, emote: null, label, labelEl, labelSig: '', bubble: null, rig: null, style: 'standard', seated: false, vehicle: null, lift: 0, ground: 0, bouncing: false };
    };
    const setBody = (a: Avatar, userId: string, tpl: Template | null, waiting = false) => {
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
      a.style = (tpl ? latest.current.library.find((c) => c.id === tpl.id)?.style : null) ?? 'standard';
      a.bodyFor = tpl;
      const names = clipsFor(tpl);
      a.clipsSig = bodySig(tpl, waiting);
      if (!tpl && waiting) {
        a.body = new THREE.Group();
      } else if (!tpl) {
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
        // No dancing clip: the cheer, on a loop (its own copy, so the one-off cheer still plays once).
        const cheer = names?.cheer ? tpl.clips.get(names.cheer) : undefined;
        if (!a.actions.dance && cheer) a.actions.dance = a.mixer.clipAction(cheer.clone());
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
    const knee = new THREE.Vector3();
    const ankle = new THREE.Vector3();
    /** How far a foot's ankle joint sits above its sole. */
    const ANKLE = 0.08;
    /** Hip joints, averaged: how high they are in the world now. */
    const hipHeight = (rig: Rig) => {
      let y = 0;
      for (const leg of rig.legs) y += leg.root.getWorldPosition(_vb).y;
      return y / rig.legs.length;
    };
    /**
     * Sitting, the feet rest on the floor (a rug, a stage) rather than through it: a seat lower than
     * the shins are long puts the feet a little forward, as people do.
     */
    const feetOnFloor = (rig: Rig, floorY: number) => {
      for (const leg of rig.legs) {
        leg.mid.getWorldPosition(knee);
        leg.end.getWorldPosition(ankle);
        const len = knee.distanceTo(ankle);
        if (len < 1e-3 || ankle.y >= floorY + ANKLE - 0.005) continue;
        const down = Math.min(len, Math.max(0, knee.y - floorY - ANKLE));
        dirB.copy(fwd).multiplyScalar(Math.sqrt(len * len - down * down)).add(_va.set(0, -down, 0)).normalize();
        aimBone(leg.mid, leg.end, dirB);
      }
    };
    const toRest = (rig: Rig) => { for (const r of rig.rest) { r.bone.quaternion.copy(r.q); r.bone.position.copy(r.p); } };
    /**
     * On a motorbike or scooter: astride the saddle, leaning forward over the tank, hands on the
     * grips, knees bent and feet back on the pegs.
     */
    const poseRiding = (a: Avatar, rig: Rig, seat: Seat) => {
      if (!a.body) return;
      side.set(fwd.z, 0, -fwd.x); // to the rider's left
      if (rig.spine) turnBone(rig.spine, _va.set(0, 1, 0).cross(fwd).normalize(), 0.42);
      let hipY = 0;
      for (const leg of rig.legs) {
        leg.root.getWorldPosition(_vb);
        const out = Math.sign(_vb.clone().sub(a.root.position).dot(side)) || 1;
        // Thighs forward and down, a little apart round the tank; shins down and back to the pegs.
        dirA.copy(fwd).multiplyScalar(0.72).addScaledVector(side, out * 0.16).add(_va.set(0, -0.62, 0)).normalize();
        aimBone(leg.root, leg.mid, dirA);
        dirB.copy(fwd).multiplyScalar(-0.28).addScaledVector(side, out * 0.06).add(_va.set(0, -1, 0)).normalize();
        aimBone(leg.mid, leg.end, dirB);
        leg.root.getWorldPosition(_vb);
        hipY += _vb.y;
      }
      hipY /= rig.legs.length;
      for (const arm of rig.arms) {
        arm.root.getWorldPosition(_vb);
        const out = Math.sign(_vb.clone().sub(a.root.position).dot(side)) || 1;
        // Upper arms forward and down to the bars, forearms reaching on to the grips.
        dirA.copy(fwd).multiplyScalar(0.8).addScaledVector(side, out * 0.18).add(_va.set(0, -0.55, 0)).normalize();
        aimBone(arm.root, arm.mid, dirA);
        dirB.copy(fwd).multiplyScalar(0.95).addScaledVector(side, out * 0.05).add(_va.set(0, -0.3, 0)).normalize();
        aimBone(arm.mid, arm.end, dirB);
      }
      a.body.position.y = Math.min(0.3, Math.max(-0.9, seat.y + 0.05 - hipY));
    };
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
      if (!a.bodyFor) { a.body.position.y = -(0.95 - (seat.y - a.root.position.y)); return; } // simple figure
      if (!a.rig) { a.body.position.y = 0; return; }
      const rig = a.rig;
      if (a.current === 'sit') {
        // The character's own sitting clip, made for some chair: lowered or raised so its hips are
        // on this cushion (not sunk into it), then its feet kept on the floor.
        a.body.position.y = 0;
        a.root.updateMatrixWorld(true);
        a.body.position.y = Math.min(0.3, Math.max(-0.9, seat.y + 0.07 - hipHeight(rig)));
        a.root.updateMatrixWorld(true);
        fwd.set(Math.sin(a.root.rotation.y), 0, Math.cos(a.root.rotation.y));
        feetOnFloor(rig, a.ground);
        return;
      }
      toRest(rig);
      a.body.position.y = 0;
      a.root.updateMatrixWorld(true);
      fwd.set(Math.sin(a.root.rotation.y), 0, Math.cos(a.root.rotation.y));
      if (seat.id === 'ride-bike') { poseRiding(a, rig, seat); return; }
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
      // Hip joints just above the cushion, feet on the floor.
      a.body.position.y = Math.min(0.3, Math.max(-0.9, seat.y + 0.07 - hipY));
      a.root.updateMatrixWorld(true);
      feetOnFloor(rig, a.ground);
    };
    /** Where someone riding sits: on the bike's saddle, or in the car's driving seat (a kick scooter is stood on). */
    const rideSeat = (pose: { x: number; z: number; rot: number }, ride: Ride): Seat | null => {
      if (ride.item.id === 'kick_scooter') return null;
      const fx = Math.sin(pose.rot);
      const fz = Math.cos(pose.rot);
      const y = ride.kind === 'car' ? 0.56 : Math.min(0.72, Math.max(0.5, vehicleSize(ride.item).h * 0.66));
      return { id: `ride-${ride.kind}`, x: pose.x + fx * SIT_BACK, z: pose.z + fz * SIT_BACK, rot: pose.rot, y, kind: 'chair' };
    };
    /**
     * The car or bike under someone riding: its model (code-drawn until the model has loaded) with
     * its head and tail lights on, a pool of headlight on the road ahead, and the flying car's
     * flames. In a car the driver is inside (not drawn; their name shows over the roof).
     */
    const fallbackParts = new Map<VehicleKind, Part[]>();
    const setVehicle = (a: Avatar, ride: Ride | null) => {
      const real = ride ? !!itemPartsNow(ride.item) : false;
      if ((a.vehicle?.item.id ?? null) === (ride?.item.id ?? null) && (!ride || a.vehicle?.real === real)) return;
      if (a.vehicle) { a.root.remove(a.vehicle.group); a.vehicle.pool?.geometry.dispose(); a.vehicle = null; }
      if (!ride) return;
      const { item, kind } = ride;
      let parts: Part[] | undefined = itemPartsNow(item) ?? undefined;
      if (parts) parts = [...parts, ...vehicleLightParts(item, true)];
      else {
        void loadItemParts(item); // drawn from the model next frame once it's here
        parts = fallbackParts.get(kind);
        if (!parts) { parts = kind === 'car' ? carParts('#24406E') : bikeParts('#2F7F86'); fallbackParts.set(kind, parts); }
      }
      const group = new THREE.Group();
      for (const part of parts) {
        const m = new THREE.Mesh(part.geo, part.mat);
        m.matrixAutoUpdate = false;
        m.matrix.copy(part.local);
        m.castShadow = shadows && part.shadow;
        group.add(m);
      }
      const pool = real && !item.vehicle?.plane ? headlightPool(item) : null;
      if (pool) group.add(pool);
      const flames = item.vehicle?.flies && !item.vehicle.plane && !item.vehicle.rotor ? wheelFlames(item) : null;
      if (flames) group.add(flames);
      markGlow(group);
      // A rider sits just behind the middle of the bike; a car is centred on its driver.
      if (kind === 'bike') group.position.set(0, 0, item.id === 'kick_scooter' ? 0.05 : 0.2);
      a.root.add(group);
      a.vehicle = { item, kind, group, real, flames, pool };
    };

    /** After the clips: shoulders down, arms by the sides, and the feminine walk where chosen. */
    const standTall = (a: Avatar, rig: Rig, body: THREE.Object3D) => {
      const walking = a.current === 'walk' || a.current === 'run';
      if (a.current === 'wave' || a.current === 'cheer' || a.current === 'dance') return; // gestures play as made
      if (!a.current) toRest(rig); // no clip at all: start from the file's pose every frame
      const feminine = a.style === 'feminine';
      const walk = a.actions.walk;
      if (feminine && walking && walk) feminineGait(rig, body, (walk.time / Math.max(0.01, walk.getClip().duration)) % 1);
      relaxPosture(rig, body, walking ? 'walk' : a.current ? 'stand' : 'still');
      // Standing: a relaxed weight shift onto one hip.
      if (feminine && !walking) feminineGait(rig, body, 0.25, 0.3);
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
    // Hold and drag to look around: the view slides with the pointer (and comes back to you when
    // you move). `pan` is how far the view is from you, `dragFrom` the floor point under the pointer.
    const pan = new THREE.Vector3();
    let dragFrom: THREE.Vector3 | null = null;
    const floorPoint = (cx: number, cy: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const at = new THREE.Vector3();
      return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), at) ? at : null;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dragFrom = null;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (dragFrom) { dragFrom = null; renderer.domElement.style.cursor = ''; return; }
      if (moved > 8) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const build = latest.current.build;
      if (build && campusLayout) {
        const hit = raycaster.intersectObject(floorMesh)[0];
        if (!hit) return;
        if (build.kind) {
          const at = snap(hit.point.x, hit.point.z);
          if (fitsAt(buildObstacles(build.moving), { id: 'ghost', kind: build.kind, ...at, rot: build.rot }, floor.width, floor.depth)) build.onPlace(at.x, at.z);
        } else {
          build.onSelect(pieceAt(campusLayout.objects, hit.point.x, hit.point.z)?.id ?? null);
        }
        return;
      }
      // A parked car or scooter (when you're on foot): walk over to it and get in.
      if (campusLayout && !me.vehicle) {
        const floorHit = raycaster.intersectObject(floorMesh)[0];
        const piece = floorHit ? rideAt(campusLayout.objects, floorHit.point.x, floorHit.point.z) : null;
        const ride = rideOf(piece ?? undefined);
        // (Not one someone else has taken: it's out on the road.)
        if (piece && ride && !taken.has(piece.id)) {
          // Just behind it, on the side away from where it's parked nose-first.
          const away = ride.item.d / 2 + 0.7;
          const back = { x: piece.x - Math.sin(piece.rot) * away, z: piece.z - Math.cos(piece.rot) * away };
          if (walkTo(back.x, back.z, null, gaitNow())) { me.pendingVehicle = ride; pendingRot = piece.rot; }
          else { setVehicleMine(ride); me.rot = piece.rot; }
          return;
        }
      }
      // A chair or sofa place: walk over and sit (unless someone's in it).
      const seat = seatOnRay(seats, raycaster.ray.origin, raycaster.ray.direction);
      if (seat && seat === me.seat) return;
      if (seat && !occupied.has(seat.id) && !inPlane()) { setVehicleMine(null); walkTo(seat.x, seat.z, seat, gaitNow()); return; }
      if (seat) { const near = seatApproach(map, seat); walkTo(near.x, near.z); return; }
      const hit = raycaster.intersectObject(floorMesh)[0];
      if (hit) walkTo(hit.point.x, hit.point.z);
    };
    // A hand over seats you can sit in.
    const onPointerMove = (e: PointerEvent) => {
      // Dragging (not in build mode, where clicks place pieces): slide the view.
      if (down && down.id === e.pointerId && !latest.current.build && (dragFrom || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8)) {
        const at = floorPoint(e.clientX, e.clientY);
        if (!at) return;
        if (!dragFrom) { dragFrom = floorPoint(down.x, down.y) ?? at; renderer.domElement.style.cursor = 'grabbing'; }
        pan.x += dragFrom.x - at.x;
        pan.z += dragFrom.z - at.z;
        target.x += dragFrom.x - at.x;
        target.z += dragFrom.z - at.z;
        camera.position.copy(target).add(cameraOffset());
        camera.lookAt(target);
        camera.updateMatrixWorld();
        dragFrom = floorPoint(e.clientX, e.clientY);
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const build = latest.current.build;
      if (build && campusWorld) {
        const hit = raycaster.intersectObject(floorMesh)[0];
        if (build.kind && hit) {
          const at = snap(hit.point.x, hit.point.z);
          ghostAt = at;
          showGhost(build);
        } else {
          ghostAt = null;
          renderer.domElement.style.cursor = hit && campusLayout && pieceAt(campusLayout.objects, hit.point.x, hit.point.z) ? 'pointer' : '';
        }
        return;
      }
      if (!seats.length || e.pointerType === 'touch') return;
      const seat = seatOnRay(seats, raycaster.ray.origin, raycaster.ray.direction);
      renderer.domElement.style.cursor = seat && !occupied.has(seat.id) && seat !== me.seat ? 'pointer' : '';
    };
    // Build mode: pieces sit on a 25 cm grid; the preview is checked against everything but the piece being moved.
    const snap = (x: number, z: number) => ({ x: Math.round(x * 4) / 4, z: Math.round(z * 4) / 4 });
    let ghostAt: { x: number; z: number } | null = null;
    let obstaclesKey = '';
    let obstaclesCache: Rect[] = [];
    const buildObstacles = (moving: string | null): Rect[] => {
      const key = `${moving ?? ''}`;
      if (!campusLayout) return [];
      if (key !== obstaclesKey || !obstaclesCache.length) {
        obstaclesKey = key;
        obstaclesCache = campusObstacles(moving ? { ...campusLayout, objects: campusLayout.objects.filter((o) => o.id !== moving) } : campusLayout);
      }
      return obstaclesCache;
    };
    const showGhost = (build: BuildState) => {
      if (!campusWorld) return;
      if (!build.kind || !ghostAt) { campusWorld.setGhost(null, false); return; }
      const p = { id: 'ghost', kind: build.kind, ...ghostAt, rot: build.rot };
      campusWorld.setGhost(p, fitsAt(buildObstacles(build.moving), p, floor.width, floor.depth));
    };
    let shownBuild: BuildState | null | undefined;
    let shownSelection = '';
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = Math.min(MAX_ZOOM, Math.max(minZoom, zoom * Math.exp(-e.deltaY * 0.0015)));
      applyCamera();
    };
    const isEditable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftHeld = true;
      // Ctrl+Z dances, like Gather (not while typing).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && !isEditable(e.target)) {
        e.preventDefault();
        toggleDance();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      if ((e.key === 'e' || e.key === 'E') && me.vehicle) { e.preventDefault(); getOut(); return; }
      const k = moveKeyFor(e);
      if (!k) return;
      e.preventDefault();
      held.add(k);
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeld = false; const k = moveKeyFor(e); if (k) held.delete(k); };
    const onBlur = () => { held.clear(); shiftHeld = false; };
    const toggleDance = () => {
      if (me.path || me.seat || me.vehicle) return;
      me.dancing = !me.dancing;
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    latest.current.controls.current = {
      center: () => { zoom = 1; pan.set(0, 0, 0); target.set(me.x, 0, me.z); applyCamera(); },
      zoomIn: () => { zoom = Math.min(MAX_ZOOM, zoom * 1.25); applyCamera(); },
      zoomOut: () => { zoom = Math.max(minZoom, zoom / 1.25); applyCamera(); },
      dance: () => toggleDance(),
      getOut: () => getOut(),
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

    // The Hub: which wing is showing, the doorway I'm standing in, signs over doorways, a fade between places.
    let shownWing: string | null = null;
    let lastPortal: string | null = campusLayout ? portalAt(campusLayout, me.x, me.z)?.id ?? null : null;
    const portalSigns = (campusLayout?.portals ?? []).map((pt) => {
      const el = document.createElement('div');
      el.className = 'pointer-events-none select-none whitespace-nowrap rounded-full bg-navy-900/90 px-3 py-1 text-xs font-semibold text-gold-300 shadow-popover';
      el.textContent = pt.label;
      const sign = new CSS2DObject(el);
      const x = (pt.rect.x0 + pt.rect.x1) / 2;
      const z = (pt.rect.z0 + pt.rect.z1) / 2;
      sign.position.set(x, 2.6, z);
      sign.visible = false;
      scene.add(sign);
      // The place the doorway belongs to: the nearest one (the doorway sits on its edge).
      const dist = (r: Rect) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
      const wing = [...(campusLayout?.wings ?? [])].sort((a, b) => dist(a.rect) - dist(b.rect))[0]?.id ?? null;
      return { sign, wing };
    });
    const fade = document.createElement('div');
    fade.style.cssText = 'position:absolute;inset:0;background:#0D0A07;opacity:0;pointer-events:none;';
    mount.appendChild(fade);

    const timer = new THREE.Timer();
    renderer.setAnimationLoop((time) => {
      timer.update(time);
      // Big enough for slow devices to keep pace; small enough that a background tab doesn't jump.
      const dt = Math.min(0.25, timer.getDelta());
      const now = performance.now();
      const p = latest.current;

      // Build mode changed the campus: new pieces, new walls to walk around, new seats.
      if (campus && campusWorld && (p.campusEdits ?? NO_EDITS) !== appliedEdits) {
        appliedEdits = p.campusEdits ?? NO_EDITS;
        campusLayout = applyEdits(campus, appliedEdits);
        campusWorld.setObjects(campusLayout.objects);
        map = walkMap(floor, campusObstacles(campusLayout), CAMPUS_CELL, OFFICE_CLEARANCE);
        seats = campusSeats(campusLayout);
        underfootMap = groundOf(campusLayout.buildings, campusLayout.objects, campusLayout.paths);
        obstaclesCache = [];
        shownSelection = '';
      }
      // Build mode: keep the preview and the selection outline in step with what's chosen.
      if (campusWorld && p.build !== shownBuild) {
        shownBuild = p.build;
        if (p.build) showGhost(p.build); else { campusWorld.setGhost(null, false); ghostAt = null; }
        renderer.domElement.style.cursor = p.build?.kind ? 'crosshair' : '';
      }
      if (campusWorld && campusLayout) {
        const sel = p.build?.selected && !p.build.kind ? p.build.selected : '';
        if (sel !== shownSelection) {
          shownSelection = sel;
          const piece = sel ? campusLayout.objects.find((o) => o.id === sel) : null;
          campusWorld.setSelected(piece ? placedBounds(piece) : null);
        }
      }

      // Move me.
      let moving = false;
      const off = cameraOffset();
      const flat = Math.hypot(off.x, off.z) || 1;
      const dir = keyDirection(held, { x: -off.x / flat, z: -off.z / flat });
      if (dir) {
        if (me.path) { me.path = null; me.pathSeat = null; p.endPath(); }
        if (me.legs.length || me.landing) stopLegs();
        if (me.seat) {
          // Stand up on the free side of the seat, then walk.
          const up = seatApproach(map, me.seat);
          me.x = up.x;
          me.z = up.z;
          me.seat = null;
        }
        const speed = inPlane() ? PLANE_SPEED : flying() ? FLY_SPEED : me.vehicle?.kind === 'car' ? CAR_SPEED : me.vehicle?.kind === 'bike' ? BIKE_SPEED : running() ? RUN_SPEED : WALK_SPEED;
        // The flying car goes over everything (within the grounds).
        const next = flying()
          ? { x: Math.min(W - 0.6, Math.max(0.6, me.x + dir.x * speed * dt)), z: Math.min(D - 0.6, Math.max(0.6, me.z + dir.z * speed * dt)) }
          : stepTo(map, me.x, me.z, dir.x * speed * dt, dir.z * speed * dt);
        me.dancing = false;
        moving = Math.hypot(next.x - me.x, next.z - me.z) > 1e-4;
        me.x = next.x;
        me.z = next.z;
        me.rot = facing(dir.x, dir.z);
      } else if (me.path) {
        // By the clock, like everyone else's screen walks this route, so we stay in step.
        const at = pointAlong(me.path.points, ((now - me.path.startedAt) / 1000) * me.path.speed);
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
          // Arrived at a parked car or scooter: get in.
          if (me.pendingVehicle) {
            if (!taken.has(me.pendingVehicle.piece)) { setVehicleMine(me.pendingVehicle); me.rot = pendingRot; }
            me.pendingVehicle = null;
          }
          p.endPath();
          // A plane's trip: on to the next stretch.
          const done = me.pathDone;
          me.pathDone = null;
          done?.();
          const next = me.legs.shift();
          if (next) startLeg(next);
        }
      }
      // Kept for a scene rebuild: standing beside my seat if I'm in one.
      const place = me.seat ? seatApproach(map, me.seat) : me;
      myPlace.current = { x: place.x, z: place.z, rot: me.rot };
      // The Hub: stepping into a doorway takes you to the place it leads to.
      if (campusLayout?.portals?.length && !me.seat) {
        const portal = portalAt(campusLayout, me.x, me.z);
        if (portal && portal.id !== lastPortal) {
          const to = freeSpot(map, portal.to.x, portal.to.z);
          me.x = to.x;
          me.z = to.z;
          me.rot = portal.to.rot;
          if (me.path) { me.path = null; me.pathSeat = null; p.endPath(); }
          held.clear();
          moving = false;
          target.set(me.x, 0, me.z);
          fade.style.transition = 'none';
          fade.style.opacity = '1';
          requestAnimationFrame(() => { fade.style.transition = 'opacity 450ms ease-out'; fade.style.opacity = '0'; });
          lastPortal = portalAt(campusLayout, me.x, me.z)?.id ?? null;
        } else lastPortal = portal?.id ?? null;
      }
      if (campusWorld && campusLayout?.wings?.length) {
        const wing = wingAt(campusLayout, me.x, me.z)?.id ?? shownWing;
        if (wing !== shownWing) {
          shownWing = wing;
          campusWorld.showWing(wing);
          for (const s of portalSigns) s.sign.visible = s.wing === wing;
        }
      }
      campusWorld?.update(dt);
      const travel: Gait = me.path ? me.path.gait : gaitNow();
      // In a car or on a scooter you stay in it, moving or not.
      // The flying car stays up while it moves, or while it's over something it can't land on. A
      // plane stays up until it lands, circling when it has nowhere to go.
      if (inPlane()) {
        if (dir) me.airborne = true;
        else if (me.airborne && !me.path && !me.landing) circle();
      } else if (flying()) me.airborne = moving || !!me.path || !isFree(map, me.x, me.z);
      const myAnim = me.vehicle ? gaitNow() : moving ? travel : me.seat ? 'sit' : me.dancing ? 'dance' : 'idle';
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
      const needsBody = (a: Avatar, tpl: Template | null, waiting: boolean) => a.bodyFor !== tpl || a.clipsSig !== bodySig(tpl, waiting);

      // Place, turn, animate and (if sitting) seat one avatar.
      const turn = 1 - Math.exp(-dt * 14);
      // Zoomed out over a big world, people are drawn larger so you can still see them
      // (not when sitting, where they must fit the chair).
      // (Not in the Campus or Hub, where they must stay in proportion with the cars and bikes.)
      const grow = campusLayout ? 1 : Math.min(2.2, Math.max(1, Math.pow(0.85 / zoom, 0.8)));
      const nowOccupied = new Set<string>();
      const nowTaken = new Set<string>();
      const drawAvatar = (a: Avatar, pose: { x: number; z: number; rot: number; anim: string }, chair: Seat | null, ride: Ride | null) => {
        // Riding: seated in the car or on the bike, which is drawn under them (someone on an older
        // version doesn't say which: a car or bike like it).
        const inCar = pose.anim === 'drive' || pose.anim === 'fly';
        const riding: Ride | null = inCar ? (ride?.kind === 'car' ? ride : fallbackRide('car')) : pose.anim === 'ride' ? (ride?.kind === 'bike' ? ride : fallbackRide('bike')) : null;
        if (riding?.piece) nowTaken.add(riding.piece);
        const seat = chair ?? (riding ? rideSeat(pose, riding) : null);
        setVehicle(a, riding);
        const spot = seat ? sittingSpot(seat) : pose;
        // The flying car rises and settles smoothly, and hovers gently in the air.
        // A plane climbs and comes down gently, along the way; the car lifts straight up.
        const before = a.lift;
        const rate = riding?.item.vehicle?.plane ? 0.9 : riding?.item.vehicle?.rotor ? 1.4 : 3;
        a.lift += ((pose.anim === 'fly' ? cruiseHeight(riding) : 0) - a.lift) * (1 - Math.exp(-Math.min(dt, 0.1) * rate));
        if (a.lift < 0.003) a.lift = 0;
        const climb = dt > 0 ? (a.lift - before) / dt : 0;
        const hover = a.lift > 0.3 ? Math.sin(now / 420) * 0.05 : 0;
        const deck = riding?.item.id === 'kick_scooter' ? 0.13 : 0; // standing on the scooter's deck
        // On foot (or sitting): up on what's underfoot, a rug or a stage, easing up and down steps.
        const underfoot = riding || !underfootMap ? 0 : underfootMap.at(spot.x, spot.z);
        a.ground += (underfoot - a.ground) * (1 - Math.exp(-Math.min(dt, 0.1) * 16));
        if (Math.abs(underfoot - a.ground) < 0.002) a.ground = underfoot;
        a.root.position.set(spot.x, a.lift + hover + deck + a.ground, spot.z);
        const scale = chair ? 1 : grow;
        a.root.scale.setScalar(scale);
        if (a.vehicle) {
          // A car keeps its size when you zoom out (its driver isn't drawn); a rider and bike grow together.
          a.vehicle.group.scale.setScalar(a.vehicle.kind === 'car' ? 1 / scale : 1);
          a.vehicle.group.position.y = -deck / scale;
          // Nose up while climbing, down while coming in.
          a.vehicle.group.rotation.x = pose.anim === 'fly' || a.lift > 0.05 ? Math.max(-0.22, Math.min(0.14, -climb * 0.03 - 0.02)) : 0;
          if (a.vehicle.flames) flickerFlames(a.vehicle.flames, a.lift + hover, now);
          if (a.vehicle.pool) a.vehicle.pool.visible = a.lift < 0.25;
        }
        if (a.body) a.body.visible = a.vehicle?.kind !== 'car';
        a.root.rotation.y = lerpAngle(a.root.rotation.y, seat ? seat.rot : pose.rot, turn);
        if (a.emote && (a.emote.until <= now || pose.anim === 'walk')) a.emote = null;
        if (a.emote && pose.anim === 'run') a.emote = null;
        const want: AvatarAction | null = a.emote ? a.emote.action
          : pose.anim === 'walk' ? 'walk'
          : pose.anim === 'run' ? (a.actions.run ? 'run' : 'walk')
          : pose.anim === 'dance' ? 'dance'
          : seat ? (a.actions.sit && !riding ? 'sit' : a.rig ? null : 'idle') : 'idle';
        play(a, want && a.actions[want] ? want : want && a.actions.idle ? 'idle' : null);
        // Quicker steps for the quicker walk; a walk sped right up when there's no running clip.
        if (a.actions.walk) a.actions.walk.timeScale = pose.anim === 'run' && !a.actions.run ? 2.1 : 1.3;
        a.mixer?.update(dt);
        // Dancing with no clip at all: bounce and sway to the beat.
        const bounce = pose.anim === 'dance' && !a.actions.dance && !!a.body;
        if (bounce && a.body) {
          a.body.position.y = Math.abs(Math.sin(now / 190)) * 0.12;
          a.body.rotation.y = Math.sin(now / 380) * 0.4;
          a.bouncing = true;
        } else if (a.bouncing && a.body) {
          a.body.position.y = 0;
          a.body.rotation.y = 0;
          a.bouncing = false;
        }
        if (a.rig && a.body) {
          beginPose(a.rig);
          if (!seat) standTall(a, a.rig, a.body);
          endPose(a.rig);
        }
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
        const chosen = isMe ? p.myCharacterId : person.characterId;
        const tpl = templateFor(chosen);
        const waiting = !tpl && waitingFor(chosen);
        if (needsBody(a, tpl, waiting)) setBody(a, person.userId, tpl, waiting);
        // Others sitting: find the seat from where they are (everyone has the same office).
        const seat = pose.anim !== 'sit' ? null : isMe ? me.seat : seatAt(seats, pose.x, pose.z);
        if (seat && !isMe) nowOccupied.add(seat.id);
        const ride = isMe ? me.vehicle : rideOf(person.vehicle ? piecesById.get(person.vehicle) : undefined);
        drawAvatar(a, pose, seat, ride);
        // In the Hub you only see the people in the same place as you.
        a.root.visible = isMe || shownWing === null || wingAt(campusLayout ?? {}, pose.x, pose.z)?.id === shownWing;
        updateLabel(a, person, isMe, now);
      }
      // Draw me even before presence lists me.
      if (!present.has(p.meId)) {
        let a = avatars.get(p.meId);
        if (!a) { a = makeAvatar(); avatars.set(p.meId, a); }
        const tpl = templateFor(p.myCharacterId);
        const waiting = !tpl && waitingFor(p.myCharacterId);
        if (needsBody(a, tpl, waiting)) setBody(a, p.meId, tpl, waiting);
        drawAvatar(a, { x: me.x, z: me.z, rot: me.rot, anim: myAnim }, me.seat, me.vehicle);
        updateLabel(a, undefined, true, now);
        present.add(p.meId);
      }
      occupied = nowOccupied;
      taken = nowTaken;
      campusWorld?.setHidden(taken);
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
      // Keep up with a car or a bike.
      const k = 1 - Math.exp(-dt * (me.path && me.path.speed > RUN_SPEED ? 10 : me.path?.gait === 'run' || running() ? 7 : 5));
      // In an office the view stays over the office, so its edge never fills the screen. Zoomed
      // in, the margin shrinks with the view, so you always stay on screen.
      const mx = Math.min(W / 2, 6 / zoom);
      const mz = Math.min(D / 2, 4.5 / zoom);
      // Moving brings the view back to you after looking around.
      if (moving) pan.multiplyScalar(Math.max(0, 1 - dt * 3));
      // Up in the air, the view follows the car or plane itself, not the ground under it.
      const up = avatars.get(p.meId)?.lift ?? 0;
      const off2 = cameraOffset();
      const ux = (-up * off2.x) / off2.y;
      const uz = (-up * off2.z) / off2.y;
      const fx = office ? Math.min(Math.max(me.x + pan.x + ux, mx), W - mx) : me.x + pan.x + ux;
      const fz = office ? Math.min(Math.max(me.z + pan.z + uz, mz - 20), D - mz) : me.z + pan.z + uz;
      if (!dragFrom) {
        target.x += (fx - target.x) * k;
        target.z += (fz - target.z) * k;
      }
      camera.position.copy(target).add(cameraOffset());
      camera.lookAt(target);
      campusWorld?.follow(target, sun, camera);

      if (glowComposer) {
        // Only the lights, on black, with the shadows from the main render.
        const background = scene.background;
        const layers = camera.layers.mask;
        const shadowUpdate = renderer.shadowMap.autoUpdate;
        scene.background = null;
        camera.layers.set(GLOW_LAYER);
        renderer.shadowMap.autoUpdate = false;
        renderer.getClearColor(clearColor);
        const clearAlpha = renderer.getClearAlpha();
        renderer.setClearColor(0x000000, 1);
        glowComposer.render(dt);
        renderer.setClearColor(clearColor, clearAlpha);
        renderer.shadowMap.autoUpdate = shadowUpdate;
        camera.layers.mask = layers;
        scene.background = background;
      }
      if (composer) composer.render(dt);
      else renderer.render(scene, camera);
      labels.render(scene, camera);
    });

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      for (const child of [...officeRoot.children]) disposeObject(child);
      officeRoot.clear();
      campusWorld?.dispose();
      for (const s of portalSigns) { s.sign.element.remove(); scene.remove(s.sign); }
      fade.remove();
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
      // Give the graphics context back now: browsers allow only a few, and refuse 3D once they run out.
      renderer.forceContextLoss();
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
