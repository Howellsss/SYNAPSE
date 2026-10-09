# Blender helper scripts

## `optimize_meshy_glb.py`: shrink a Meshy character GLB

Makes a smaller copy of a Meshy `.glb` so it fits under SYNAPSE's 30 MB upload limit (default
target: under 25 MB). It only changes textures, and it tries the lightest change first. Meshes,
bones, skin weights and animation clips are never edited. Your original file is never overwritten.

### Run it on a Mac (Blender 5.4.0 Alpha)

1. Open Blender. Any `.blend` is fine: the script imports your character into its own new,
   empty scene called `SYNAPSE_GLB_Optimize`, so the objects you already have are never
   changed or exported.
2. At the top of the window, click the **Scripting** tab. (If you can't see it, scroll the tab
   row or use **+ > General > Scripting**.)
3. In the Text Editor (the large middle panel), choose **Text > Open…** (⌥O), select
   `optimize_meshy_glb.py`, and click **Open Text**.
4. Choose **Text > Run Script** (⌥P), or click the ▶ button in the Text Editor header.
5. A file browser opens. Go to your Meshy `.glb`, click it once, and click **Optimize GLB**.
   - Options are in the browser's right side panel (press **N** if it's hidden):
     **Target size (MB)** (default 25) and **Smallest texture (px)** (default 1024).
   - If macOS asks whether Blender may access your Downloads, Desktop or Documents folder,
     click **Allow**.
6. Blender may stop responding for a minute or two while it exports each try. That's normal.
7. When it finishes, a message appears in the status bar at the bottom of the window.
   The full report is in the Text Editor: use the text selector in the header to pick
   **SYNAPSE_GLB_Report**.

The result is saved next to the original as `<name>_optimized.glb`, or `<name>_optimized_2.glb`
if that name is already taken. A copy of the report is saved alongside it as `…_report.txt`.
You don't need to save the `.blend` afterwards.

**To see progress while it runs**, start Blender from Terminal instead of the Dock:

```sh
/Applications/Blender.app/Contents/MacOS/Blender
```

If your Blender 5.4 Alpha app has a different name or location, type the first part of that
command, drag **Blender.app** from Finder into the Terminal window, then add
`/Contents/MacOS/Blender` and press Return. The report prints in Terminal as the script runs.

### What it tries, in order

The script stops at the first setting that gets under the target. Each try starts from the
original pixels, so quality is never lost twice.

1. Re-export only, with textures untouched
2. Opaque colour and data textures to JPEG (quality 95), full size. Normal maps stay PNG.
3. All opaque textures to JPEG (quality 95), full size
4. Textures at most 4096 px, JPEG quality 90
5. Textures at most 2048 px, JPEG quality 92
6. Textures at most 2048 px, JPEG quality 85
7. Textures at most 1024 px, JPEG quality 90

Textures with real transparency always stay PNG, so their alpha is kept.

### When it stops without saving

It stops, and leaves your original untouched, if:

- The mesh and animation data alone already exceed the target. This needs fewer triangles,
  trimmed animation keys or Draco compression, and the script won't make those changes
  automatically.
- The GLB uses meshopt compression, KTX2 textures or quantized vertex data, which Blender
  can't read back without losing data.
- The import loses the armature, the skin binding or the animation actions.
- The exported file has fewer triangles, bones, skinned mesh parts, morph targets or
  animation clips than the original.

### Command line (optional)

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -P optimize_meshy_glb.py -- /path/to/character.glb
```
