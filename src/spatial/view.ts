/** Camera view in spaces: from above (default) or the angled corner view. Kept on this device. */
import type { SceneView } from '@/components/spaces/scene/SpaceScene';

const KEY = 'synapse.view';

export function loadView(): SceneView {
  try { return localStorage.getItem(KEY) === 'angled' ? 'angled' : 'top'; } catch { return 'top'; }
}

export function saveView(v: SceneView) {
  try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
}
