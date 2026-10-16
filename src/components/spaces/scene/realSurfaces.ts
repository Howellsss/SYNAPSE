import * as THREE from 'three';

/**
 * Photographed surfaces (Poly Haven, CC0): grass, stone paving, brick paths, wood, marble, slate,
 * terrazzo and asphalt, each with its colour and its bumps (normal map). They're small (512 px,
 * about 800 KB together) and load after the world appears: until then each surface keeps its drawn
 * texture, and if one can't load it simply stays drawn.
 */
export type RealSurface = 'grass' | 'paving' | 'brick' | 'oak' | 'walnut' | 'deck' | 'parquet' | 'marble' | 'slate' | 'terrazzo' | 'asphalt';

/** How many metres one copy of each photo covers. */
export const SURFACE_METRES: Record<RealSurface, number> = {
  grass: 3, paving: 1.5, brick: 0.75, oak: 1.2, walnut: 2, deck: 1.8, parquet: 3.4, marble: 1.5, slate: 2.3, terrazzo: 2, asphalt: 3,
};

const BASE = '/assets/spatial/textures/';
const loaded = new Map<RealSurface, Promise<{ map: THREE.Texture; normal: THREE.Texture } | null>>();

function load(name: RealSurface) {
  let p = loaded.get(name);
  if (!p) {
    const loader = new THREE.TextureLoader();
    const one = (file: string, srgb: boolean) => loader.loadAsync(BASE + file).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
    p = Promise.all([one(`${name}.jpg`, true), one(`${name}_n.jpg`, false)])
      .then(([map, normal]) => ({ map, normal }))
      .catch(() => null);
    loaded.set(name, p);
  }
  return p;
}

/**
 * Give `mat` the photographed surface once it's loaded. `uvMetres` is how many metres one unit of
 * the mesh's UVs covers (across and down, if they differ).
 * Disposing it stops the swap (if the world is taken down first) and frees the copies.
 */
export function applyRealSurface(mat: THREE.MeshStandardMaterial, name: RealSurface, uvMetres: number | [number, number], normalStrength = 0.8): { dispose(): void } {
  let cancelled = false;
  const made: THREE.Texture[] = [];
  void load(name).then((tex) => {
    if (!tex || cancelled) return;
    const [u, v] = typeof uvMetres === 'number' ? [uvMetres, uvMetres] : uvMetres;
    const m = SURFACE_METRES[name];
    // Copies share the loaded image (uploaded once); each keeps its own repeat.
    const map = tex.map.clone();
    map.repeat.set(u / m, v / m);
    const normal = tex.normal.clone();
    normal.repeat.set(u / m, v / m);
    made.push(map, normal);
    mat.map = map;
    mat.normalMap = normal;
    mat.normalScale.set(normalStrength, normalStrength);
    mat.color.set('#FFFFFF');
    mat.needsUpdate = true;
  });
  return { dispose: () => { cancelled = true; made.forEach((t) => t.dispose()); } };
}
