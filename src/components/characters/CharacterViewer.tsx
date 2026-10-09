import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * A 3D preview of a character .glb: drag to turn, scroll or pinch to zoom.
 * Plays the named clip (crossfading from the previous one); `playing` pauses it in place.
 * Loaded lazily by the Characters page so three.js stays out of the main bundle.
 */
export default function CharacterViewer({ url, clip, playing, onLoaded }: {
  url: string;
  clip: string | null;
  playing: boolean;
  /** The clip names actually found in the file, once it has loaded. */
  onLoaded?: (clipNames: string[]) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const currentRef = useRef<THREE.AnimationAction | null>(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const [progress, setProgress] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Build the scene and load the file.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    setReady(false);
    setError(null);
    setProgress(0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NeutralToneMapping;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envMap;
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(2, 4, 3);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    camera.position.set(0, 1.2, 4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;

    let model: THREE.Object3D | null = null;
    // Frame the character: centred, whole body in view.
    const frame = () => {
      if (!model) return;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const fit = Math.max(size.y, size.x / camera.aspect) || 1;
      const distance = (fit / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.3 + size.z / 2;
      controls.target.copy(center);
      camera.position.set(center.x, center.y + size.y * 0.1, center.z + distance);
      camera.near = distance / 100;
      camera.far = distance * 100;
      camera.updateProjectionMatrix();
      controls.minDistance = distance * 0.3;
      controls.maxDistance = distance * 4;
      controls.update();
    };

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      const aspect = w / h;
      const changed = Math.abs(aspect - camera.aspect) > 0.01;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      if (changed) frame();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let disposed = false;
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (disposed) return;
        model = gltf.scene;
        scene.add(model);
        frame();

        const mixer = new THREE.AnimationMixer(model);
        mixerRef.current = mixer;
        actionsRef.current = new Map(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
        setProgress(null);
        setReady(true);
        onLoadedRef.current?.(gltf.animations.map((c) => c.name));
      },
      (e) => { if (!disposed && e.total) setProgress(Math.round((e.loaded / e.total) * 100)); },
      (e) => { if (!disposed) { setError(e instanceof Error ? e.message : 'Could not load this character.'); setProgress(null); } },
    );

    const timer = new THREE.Timer();
    renderer.setAnimationLoop((time) => {
      timer.update(time);
      mixerRef.current?.update(timer.getDelta());
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      controls.dispose();
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
      actionsRef.current = new Map();
      currentRef.current = null;
      model?.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        for (const mat of ([] as THREE.Material[]).concat(mesh.material ?? [])) {
          for (const value of Object.values(mat)) if (value instanceof THREE.Texture) value.dispose();
          mat.dispose();
        }
      });
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url]);

  // Switch clips with a short crossfade.
  useEffect(() => {
    if (!ready) return;
    const next = clip ? actionsRef.current.get(clip) ?? null : null;
    const prev = currentRef.current;
    if (next === prev) return;
    prev?.fadeOut(0.25);
    if (next) next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.25).play();
    currentRef.current = next;
  }, [clip, ready]);

  // Pause and resume in place.
  useEffect(() => {
    if (mixerRef.current) mixerRef.current.timeScale = playing ? 1 : 0;
  }, [playing, ready]);

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="absolute inset-0" aria-label="3D character preview. Drag to turn, scroll to zoom." role="img" />
      {progress !== null && !error && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-ivory-300">
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gold-400 transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          Loading character… {progress}%
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ivory-300">{error}</div>
      )}
    </div>
  );
}
