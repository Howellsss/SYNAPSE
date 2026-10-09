# Blender helper scripts

## `optimize_meshy_glb.py`: shrink and merge Meshy character GLBs

Meshy exports one complete `.glb` per animation: the same mesh, skeleton and textures, each with
one clip. This script does one of two jobs:

- **Merge all animations in a folder:** makes **one** character file with every clip, named
  after its file (`Walking`, `Running`, `ymca_dance`, …). This is the one to use for SYNAPSE.
- **Optimize one GLB:** makes a smaller copy of a single file.

Either way, it aims for under 25 MB (SYNAPSE's upload limit is 30 MB). It only changes textures,
lightest change first. Meshes, bones, skin weights and animation keys are never edited, and your
original files are never overwritten.

### Run it on a Mac (Blender 5.4.0 Alpha)

1. Open Blender. Any `.blend` is fine: the script imports into its own new, empty scene called
   `SYNAPSE_GLB_Optimize`, so the objects you already have are never changed or exported.
2. At the top of the window, click the **Scripting** tab.
3. In the Text Editor (the large middle panel), click **Open** (or **Text > Open…**, ⌥O), select
   `optimize_meshy_glb.py`, and click **Open Text**. If an older copy is already open, close it
   first with the **X** next to its name.
4. Hover over the code and press **⌥P** (or click ▶ in the Text Editor header).
5. A small menu appears. Choose **Merge all animations in a folder** or **Optimize one GLB**.
6. A file browser opens.
   - **Merge:** go to the Meshy download folder and either click the folder once, or open it and
     click the GLB whose mesh and textures you want to keep (any of them works, they're the same
     character). Then click **Merge Animations**. Every GLB in that folder is merged.
   - **Optimize:** open the folder, click one `.glb` so its name shows in the file-name box, and
     click **Optimize GLB**.
   - Options are in the browser's right side panel (press **N** if it's hidden):
     **Target size (MB)** (default 25) and **Smallest texture (px)** (default 1024).
   - If macOS asks whether Blender may access your Downloads, Desktop or Documents folder,
     click **Allow**.
7. Blender may stop responding for a few minutes while it imports each file and exports each
   try. That's normal.
8. When it finishes, a message appears in the status bar at the bottom of the window. The full
   report is in the Text Editor: use the text selector in the header to pick
   **SYNAPSE_GLB_Report**.

Results are saved next to the originals:

- **Merge:** `<character>_all_animations.glb`.
- **Optimize:** `<name>_optimized.glb`.

If the name is taken, `_2`, `_3` and so on is added. A copy of the report is saved alongside as
`…_report.txt`. You don't need to save the `.blend` afterwards.

**To see progress while it runs**, start Blender from Terminal instead of the Dock:

```sh
/Applications/Blender.app/Contents/MacOS/Blender
```

If your Blender 5.4 Alpha app has a different name or location, type the first part of that
command, drag **Blender.app** from Finder into the Terminal window, then add
`/Contents/MacOS/Blender` and press Return. The report prints in Terminal as the script runs.

### How merging stays safe

Before importing anything, it reads every GLB and checks that they share the same bone names,
bone hierarchy, rest pose, bind pose and mesh. If any file differs, it stops, names the
difference and saves nothing. A clip made for a different skeleton would distort the character.

The other files' meshes and textures are duplicates, so only their animation clips are used.
After exporting, it checks that every clip is in the new file with the right length.

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
- When merging: the files don't share the same skeleton and mesh, or a clip animates something
  other than the skeleton.

### Command line (optional)

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -P optimize_meshy_glb.py -- /path/to/character.glb
/Applications/Blender.app/Contents/MacOS/Blender -b -P optimize_meshy_glb.py -- --merge /path/to/meshy_folder
```
