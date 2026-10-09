"""
SYNAPSE: shrink a Meshy character GLB so it fits under the upload limit.

Run it from Blender's Text Editor (Text > Open..., then Text > Run Script).
A file browser opens: pick your Meshy .glb, adjust the options in the
browser's side panel if you like, then press "Optimize GLB".

What it does
  1. Imports the GLB into a brand-new, empty scene, so the objects already in
     your .blend are never read, changed or exported.
  2. Reports the file size and what the bytes are spent on (textures,
     geometry, skinning, animation), read straight from the GLB.
  3. Inspects the imported meshes, materials, textures, armature and actions.
  4. Tries progressively stronger texture settings, lightest first, and stops
     at the first one under the target. Each step starts again from the
     original pixels, so quality is never lost twice.
  5. Never touches meshes, bones, skin weights or animation actions. If the
     target can't be reached by textures alone, it stops and says why.
  6. Writes "<name>_optimized.glb" next to the original (or "_optimized_2"
     and so on, if that name is taken). The original is never overwritten.
  7. Re-reads the new GLB and checks that triangles, bones, skins,
     morph targets and animation clips all match the original.

The full report is printed to the console, saved to a .txt file next to the
new GLB, and put in a Text Editor block called "SYNAPSE_GLB_Report".
"""

import json
import os
import shutil
import struct
import tempfile
import time

import bpy
from bpy.props import BoolProperty, FloatProperty, IntProperty, StringProperty
from bpy_extras.io_utils import ImportHelper

MB = 1024 * 1024
REPORT_TEXT_NAME = "SYNAPSE_GLB_Report"
WORK_SCENE_NAME = "SYNAPSE_GLB_Optimize"

# Extensions the Blender glTF importer can't read back faithfully. If the
# original uses one of these, re-exporting it would lose data, so we stop.
UNSUPPORTED_EXTENSIONS = {
    "EXT_meshopt_compression": "meshopt-compressed geometry",
    "KHR_texture_basisu": "KTX2 / Basis textures",
    "KHR_mesh_quantization": "quantized vertex data",
}


class OptimizeError(Exception):
    """A reason to stop without writing an optimized file."""


# ---------------------------------------------------------------------------
# Reading GLB files directly (no Blender involved), for the size breakdown
# and for verifying the result.
# ---------------------------------------------------------------------------

COMPONENT_BYTES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 20 or data[:4] != b"glTF":
        raise OptimizeError(f"{os.path.basename(path)} is not a binary glTF (.glb) file.")
    version = struct.unpack_from("<I", data, 4)[0]
    if version != 2:
        raise OptimizeError(f"This GLB is glTF version {version}; only version 2 is supported.")
    offset, gltf, binary = 12, None, b""
    while offset + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8: offset + 8 + length]
        if kind == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8"))
        elif kind == 0x004E4942:
            binary = chunk
        offset += 8 + length
    if gltf is None:
        raise OptimizeError("The GLB has no JSON chunk; the file looks damaged.")
    return gltf, binary, len(data)


def accessor_bytes(gltf, index):
    if index is None:
        return 0
    acc = gltf["accessors"][index]
    if "bufferView" not in acc and "sparse" not in acc:
        return 0
    return acc["count"] * COMPONENT_BYTES.get(acc["componentType"], 4) * TYPE_COMPONENTS.get(acc["type"], 1)


def image_dimensions(blob, mime):
    try:
        if blob[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", blob[16:24])
        if blob[:2] == b"\xff\xd8":
            i = 2
            while i + 9 < len(blob):
                if blob[i] != 0xFF:
                    i += 1
                    continue
                marker = blob[i + 1]
                if marker in (0xC0, 0xC1, 0xC2):
                    h, w = struct.unpack(">HH", blob[i + 5: i + 9])
                    return w, h
                i += 2 + struct.unpack(">H", blob[i + 2: i + 4])[0]
    except (struct.error, IndexError):
        pass
    return None


def image_roles(gltf):
    """Map image index -> set of uses (base colour, normal, ...)."""
    roles = {}
    textures = gltf.get("textures", [])

    def tag(texinfo, role):
        if not texinfo:
            return
        tex = textures[texinfo["index"]]
        src = tex.get("source")
        for ext in tex.get("extensions", {}).values():
            src = ext.get("source", src)
        if src is not None:
            roles.setdefault(src, set()).add(role)

    for mat in gltf.get("materials", []):
        pbr = mat.get("pbrMetallicRoughness", {})
        tag(pbr.get("baseColorTexture"), "base colour")
        tag(pbr.get("metallicRoughnessTexture"), "metallic/roughness")
        tag(mat.get("normalTexture"), "normal")
        tag(mat.get("occlusionTexture"), "occlusion")
        tag(mat.get("emissiveTexture"), "emissive")
    return roles


def analyze_glb(path):
    """Summarise a GLB: sizes by category plus counts used for verification."""
    gltf, binary, total = read_glb(path)
    images = []
    roles = image_roles(gltf)
    views = gltf.get("bufferViews", [])
    for i, img in enumerate(gltf.get("images", [])):
        size, dims = 0, None
        if "bufferView" in img:
            view = views[img["bufferView"]]
            start = view.get("byteOffset", 0)
            blob = binary[start: start + view["byteLength"]]
            size, dims = view["byteLength"], image_dimensions(blob, img.get("mimeType"))
        images.append({
            "name": img.get("name") or f"image_{i}",
            "mime": img.get("mimeType", "external file" if "uri" in img else "?"),
            "bytes": size,
            "dims": dims,
            "roles": sorted(roles.get(i, [])),
        })

    geo = {"positions": 0, "normals": 0, "uvs": 0, "tangents": 0, "colours": 0,
           "skin weights": 0, "indices": 0, "morph targets": 0, "other": 0}
    triangles = 0
    morph_targets = 0
    primitives = 0
    skinned_primitives = 0
    unskinned_when_skinned = 0
    vertex_colours = False
    node_meshes = {n["mesh"]: n for n in gltf.get("nodes", []) if "mesh" in n}
    for mi, mesh in enumerate(gltf.get("meshes", [])):
        skinned_node = "skin" in node_meshes.get(mi, {})
        for prim in mesh.get("primitives", []):
            primitives += 1
            attrs = prim.get("attributes", {})
            if "JOINTS_0" in attrs:
                skinned_primitives += 1
            elif skinned_node:
                unskinned_when_skinned += 1
            for name, acc in attrs.items():
                b = accessor_bytes(gltf, acc)
                if name == "POSITION":
                    geo["positions"] += b
                elif name == "NORMAL":
                    geo["normals"] += b
                elif name.startswith("TEXCOORD"):
                    geo["uvs"] += b
                elif name == "TANGENT":
                    geo["tangents"] += b
                elif name.startswith("COLOR"):
                    geo["colours"] += b
                    vertex_colours = True
                elif name.startswith(("JOINTS", "WEIGHTS")):
                    geo["skin weights"] += b
                else:
                    geo["other"] += b
            if "indices" in prim:
                geo["indices"] += accessor_bytes(gltf, prim["indices"])
            for target in prim.get("targets", []):
                morph_targets += 1
                for acc in target.values():
                    geo["morph targets"] += accessor_bytes(gltf, acc)
            if prim.get("mode", 4) == 4:
                count = (gltf["accessors"][prim["indices"]]["count"] if "indices" in prim
                         else gltf["accessors"][attrs["POSITION"]]["count"])
                triangles += count // 3

    nodes = gltf.get("nodes", [])
    skins = []
    skin_bytes = 0
    for skin in gltf.get("skins", []):
        skins.append(sorted(nodes[j].get("name", f"node_{j}") for j in skin.get("joints", [])))
        skin_bytes += accessor_bytes(gltf, skin.get("inverseBindMatrices"))

    anims = []
    anim_bytes = 0
    for i, anim in enumerate(gltf.get("animations", [])):
        size = 0
        duration = 0.0
        for sampler in anim.get("samplers", []):
            size += accessor_bytes(gltf, sampler["input"]) + accessor_bytes(gltf, sampler["output"])
            duration = max(duration, (gltf["accessors"][sampler["input"]].get("max") or [0])[0])
        anim_bytes += size
        anims.append({"name": anim.get("name") or f"animation_{i}", "bytes": size,
                      "duration": duration, "channels": len(anim.get("channels", []))})

    return {
        "path": path,
        "total": total,
        "json_bytes": len(json.dumps(gltf)),
        "extensions": sorted(set(gltf.get("extensionsUsed", []))),
        "extensions_required": sorted(set(gltf.get("extensionsRequired", []))),
        "images": images,
        "image_bytes": sum(i["bytes"] for i in images),
        "external_images": [i["name"] for i in images if i["mime"] == "external file"],
        "geometry": geo,
        "geometry_bytes": sum(geo.values()),
        "triangles": triangles,
        "meshes": len(gltf.get("meshes", [])),
        "primitives": primitives,
        "skinned_primitives": skinned_primitives,
        "unskinned_when_skinned": unskinned_when_skinned,
        "vertex_colours": vertex_colours,
        "morph_targets": morph_targets,
        "materials": len(gltf.get("materials", [])),
        "skins": skins,
        "skin_bytes": skin_bytes,
        "animations": anims,
        "animation_bytes": anim_bytes,
    }


def fmt_mb(n):
    return f"{n / MB:.2f} MB"


# ---------------------------------------------------------------------------
# Report collection
# ---------------------------------------------------------------------------

class Report:
    def __init__(self):
        self.lines = []

    def __call__(self, text=""):
        print(text)
        self.lines.append(text)

    def section(self, title):
        self("")
        self(title)
        self("-" * len(title))

    def text(self):
        return "\n".join(self.lines) + "\n"


def report_size_breakdown(log, info, heading):
    log.section(heading)
    log(f"File: {info['path']}")
    log(f"Total size: {fmt_mb(info['total'])} ({info['total']:,} bytes)")
    parts = [
        ("Textures (embedded images)", info["image_bytes"]),
        ("Geometry (vertices, indices, morphs)", info["geometry_bytes"]),
        ("Animation clips", info["animation_bytes"]),
        ("Skeleton bind matrices", info["skin_bytes"]),
        ("JSON scene description", info["json_bytes"]),
    ]
    for label, b in sorted(parts, key=lambda p: -p[1]):
        pct = 100.0 * b / info["total"] if info["total"] else 0
        log(f"  {label:<38} {fmt_mb(b):>10}  {pct:5.1f}%")
    if info["extensions"]:
        log(f"glTF extensions used: {', '.join(info['extensions'])}")

    if info["images"]:
        log("")
        log("Textures, largest first:")
        for img in sorted(info["images"], key=lambda i: -i["bytes"]):
            dims = f"{img['dims'][0]}x{img['dims'][1]}" if img["dims"] else "?x?"
            roles = ", ".join(img["roles"]) or "unused by materials"
            log(f"  {img['name'][:40]:<40} {dims:>11} {img['mime']:<11} {fmt_mb(img['bytes']):>10}  ({roles})")

    geo = {k: v for k, v in info["geometry"].items() if v}
    if geo:
        log("")
        log(f"Geometry: {info['triangles']:,} triangles in {info['meshes']} mesh(es), "
            f"{info['primitives']} primitive(s), {info['morph_targets']} morph target(s)")
        for k, v in sorted(geo.items(), key=lambda kv: -kv[1]):
            log(f"  {k:<38} {fmt_mb(v):>10}")

    if info["animations"]:
        log("")
        log(f"Animation clips ({len(info['animations'])}):")
        for a in info["animations"]:
            log(f"  {a['name'][:40]:<40} {a['duration']:7.2f}s  {a['channels']:4d} channels  {fmt_mb(a['bytes']):>10}")
    for i, joints in enumerate(info["skins"]):
        log(f"Skin {i}: {len(joints)} bones")


# ---------------------------------------------------------------------------
# Blender side
# ---------------------------------------------------------------------------

def operator_props(op):
    return set(op.get_rna_type().properties.keys())


def filtered(op, **kwargs):
    """Drop keyword arguments this Blender's glTF add-on doesn't know about."""
    known = operator_props(op)
    return {k: v for k, v in kwargs.items() if k in known}


def snapshot():
    return {
        "objects": set(bpy.data.objects),
        "materials": set(bpy.data.materials),
        "images": set(bpy.data.images),
        "actions": set(bpy.data.actions),
        "armatures": set(bpy.data.armatures),
        "meshes": set(bpy.data.meshes),
    }


def new_since(before):
    after = snapshot()
    return {k: after[k] - before[k] for k in before}


def image_links(materials):
    """For each image used by these materials, how it is used."""
    uses = {}
    for mat in materials:
        if not mat.use_nodes or not mat.node_tree:
            continue
        for node in mat.node_tree.nodes:
            if node.type != "TEX_IMAGE" or not node.image:
                continue
            u = uses.setdefault(node.image, {"normal": False, "alpha_linked": False, "data": False})
            if node.outputs.get("Alpha") and node.outputs["Alpha"].is_linked:
                u["alpha_linked"] = True
            for link in node.outputs["Color"].links:
                if link.to_node.type == "NORMAL_MAP":
                    u["normal"] = True
    for img, u in uses.items():
        u["data"] = img.colorspace_settings.is_data or img.colorspace_settings.name in {"Non-Color", "Raw"}
    return uses


def is_helper(obj):
    """Objects the glTF importer makes for its own use (e.g. bone display shapes)."""
    return any(c.name.startswith("glTF_not_exported") for c in obj.users_collection)


def inspect_import(log, new, original):
    log.section("What Blender imported")
    objs = sorted((o for o in new["objects"] if not is_helper(o)), key=lambda o: o.name)
    armatures = [o for o in objs if o.type == "ARMATURE"]
    meshes = [o for o in objs if o.type == "MESH"]
    others = [o for o in objs if o.type not in {"ARMATURE", "MESH"}]
    log(f"Objects: {len(objs)} ({len(meshes)} mesh, {len(armatures)} armature, {len(others)} other)")
    for arm in armatures:
        log(f"  Armature '{arm.name}': {len(arm.data.bones)} bones")
        ad = arm.animation_data
        if ad:
            log(f"    active action: {ad.action.name if ad.action else 'none'}; "
                f"NLA tracks: {len(ad.nla_tracks)}")
    for m in meshes:
        tris = sum(len(p.vertices) - 2 for p in m.data.polygons)
        arm_mods = [mod for mod in m.modifiers if mod.type == "ARMATURE"]
        target = arm_mods[0].object.name if arm_mods and arm_mods[0].object else "none"
        shape_keys = len(m.data.shape_keys.key_blocks) - 1 if m.data.shape_keys else 0
        log(f"  Mesh '{m.name}': {len(m.data.vertices):,} vertices, {tris:,} triangles, "
            f"{len(m.vertex_groups)} vertex groups, armature: {target}, shape keys: {shape_keys}, "
            f"materials: {', '.join(s.material.name for s in m.material_slots if s.material) or 'none'}")
    for o in others:
        log(f"  {o.type.title()} '{o.name}'")

    log(f"Materials: {', '.join(sorted(m.name for m in new['materials'])) or 'none'}")
    uses = image_links(new["materials"])
    log(f"Images: {len(new['images'])}")
    for img in sorted(new["images"], key=lambda i: i.name):
        packed = fmt_mb(img.packed_file.size) if img.packed_file else "not packed"
        u = uses.get(img, {})
        kind = "normal map" if u.get("normal") else ("data" if u.get("data") else "colour")
        log(f"  '{img.name}': {img.size[0]}x{img.size[1]}, {img.file_format}, {packed}, {kind}"
            f"{', alpha used' if u.get('alpha_linked') else ''}")
    log(f"Actions: {len(new['actions'])}")
    for act in sorted(new["actions"], key=lambda a: a.name):
        start, end = act.frame_range
        log(f"  '{act.name}': frames {start:g}-{end:g}, users: {act.users}")

    # Safety checks before we change anything.
    problems = []
    if original["skins"] and not armatures:
        problems.append("The GLB has a skeleton, but Blender imported no armature.")
    if original["animations"] and not new["actions"]:
        problems.append("The GLB has animation clips, but Blender imported no actions.")
    for m in meshes:
        if m.vertex_groups and not any(mod.type == "ARMATURE" and mod.object for mod in m.modifiers):
            problems.append(f"Mesh '{m.name}' has skin weights but isn't bound to an armature.")
    if problems:
        raise OptimizeError("The import didn't come through intact, so re-exporting it could "
                            "break the character:\n  - " + "\n  - ".join(problems))
    return meshes, armatures, uses


def has_variable_alpha(img):
    """True if any pixel is noticeably transparent."""
    if img.channels < 4:
        return False
    try:
        import numpy as np
        px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        return float(px[3::4].min()) < 0.99
    except Exception:
        return True  # can't tell: be safe and keep it lossless


def build_image(src, max_size, fmt, quality, workdir, keep_alpha):
    """Make a re-encoded, optionally smaller, packed copy of `src`."""
    import numpy as np

    w, h = src.size
    scale = min(1.0, max_size / max(w, h)) if max_size else 1.0
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))

    work = src.copy()  # never scale the original
    try:
        if (nw, nh) != (w, h):
            work.scale(nw, nh)
        px = np.empty(nw * nh * 4, dtype=np.float32)
        work.pixels.foreach_get(px)
    finally:
        bpy.data.images.remove(work)

    out = bpy.data.images.new(src.name + "__tmp", nw, nh, alpha=keep_alpha)
    out.colorspace_settings.name = src.colorspace_settings.name
    out.pixels.foreach_set(px)
    # The exporter names the texture after this file, so keep the original name.
    ext = ".jpg" if fmt == "JPEG" else ".png"
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in src.name) or "texture"
    folder = tempfile.mkdtemp(dir=workdir)
    path = os.path.join(folder, safe + ext)
    out.filepath_raw = path
    out.file_format = fmt
    if fmt == "PNG":
        out.alpha_mode = "STRAIGHT"
    try:
        out.save(filepath=path, quality=quality)
    except TypeError:  # older API without keyword arguments
        bpy.context.scene.render.image_settings.quality = quality
        out.save()
    bpy.data.images.remove(out)

    final = bpy.data.images.load(path, check_existing=False)
    final.colorspace_settings.name = src.colorspace_settings.name
    final.alpha_mode = src.alpha_mode
    final.pack()
    return final


# Lightest first. Each level starts again from the original images.
#   max: longest side in pixels (None = keep), normals_jpeg: allow JPEG for
#   normal maps (PNG otherwise), q: JPEG quality.
LEVELS = [
    {"label": "Re-export only, textures untouched", "max": None, "jpeg": False, "normals_jpeg": False, "q": 95},
    {"label": "Opaque colour/data textures to JPEG (quality 95), full size", "max": None, "jpeg": True, "normals_jpeg": False, "q": 95},
    {"label": "All opaque textures to JPEG (quality 95), full size", "max": None, "jpeg": True, "normals_jpeg": True, "q": 95},
    {"label": "Textures at most 4096 px, JPEG quality 90", "max": 4096, "jpeg": True, "normals_jpeg": True, "q": 90},
    {"label": "Textures at most 2048 px, JPEG quality 92", "max": 2048, "jpeg": True, "normals_jpeg": True, "q": 92},
    {"label": "Textures at most 2048 px, JPEG quality 85", "max": 2048, "jpeg": True, "normals_jpeg": True, "q": 85},
    {"label": "Textures at most 1024 px, JPEG quality 90", "max": 1024, "jpeg": True, "normals_jpeg": True, "q": 90},
]


def apply_level(level, images, uses, alpha_images, workdir, min_size):
    """Swap each image for a re-encoded copy. Returns [(original, replacement)]."""
    swaps = []
    for img in images:
        u = uses.get(img)
        if u is None:
            continue  # not used by a material, the exporter won't write it
        w, h = img.size
        max_size = level["max"]
        if max_size is not None:
            max_size = max(max_size, min_size)
        shrink = max_size is not None and max(w, h) > max_size
        keeps_alpha = img in alpha_images
        to_jpeg = (level["jpeg"] and not keeps_alpha and (level["normals_jpeg"] or not u["normal"]))
        if not shrink and not to_jpeg:
            continue
        if not shrink and img.file_format == "JPEG":
            continue  # already a JPEG at this size: re-encoding only adds loss
        fmt = "JPEG" if (to_jpeg or img.file_format == "JPEG") else "PNG"
        new_img = build_image(img, max_size, fmt, level["q"], workdir, keeps_alpha)
        img.user_remap(new_img)
        name = img.name
        img.name = name + "__original"
        new_img.name = name  # the exporter names the texture after this
        swaps.append((img, new_img))
    return swaps


def undo_swaps(swaps):
    for orig, new_img in swaps:
        new_img.user_remap(orig)
        name = new_img.name
        bpy.data.images.remove(new_img)
        orig.name = name


def export_glb(path, quality, original):
    op = bpy.ops.export_scene.gltf
    kwargs = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        use_active_scene=True,
        use_visible=False,
        use_renderable=False,
        export_apply=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_jpeg_quality=quality,
        export_image_quality=quality,
        export_skins=True,
        export_all_influences=False,
        export_morph=True,
        export_morph_normal=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_def_bones=False,
        export_rest_position_armature=True,
        export_draco_mesh_compression_enable=False,
        will_save_settings=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    if original["vertex_colours"]:
        kwargs.update(export_vertex_color="ACTIVE", export_colors=True)
    result = op(**filtered(op, **kwargs))
    if "FINISHED" not in result or not os.path.exists(path):
        raise OptimizeError("Blender's glTF exporter did not finish; nothing was written.")


def verify(original, new):
    """Compare the new GLB with the original. Returns (errors, warnings)."""
    errors, warnings = [], []
    if new["triangles"] < original["triangles"]:
        errors.append(f"Triangles dropped from {original['triangles']:,} to {new['triangles']:,}.")
    elif new["triangles"] != original["triangles"]:
        warnings.append(f"Triangle count changed {original['triangles']:,} -> {new['triangles']:,}.")
    if len(new["skins"]) < len(original["skins"]):
        errors.append(f"Skins dropped from {len(original['skins'])} to {len(new['skins'])}.")
    orig_bones = set(b for s in original["skins"] for b in s)
    new_bones = set(b for s in new["skins"] for b in s)
    missing = orig_bones - new_bones
    if missing:
        errors.append(f"{len(missing)} bone(s) missing from the skin: {', '.join(sorted(missing)[:10])}")
    if original["skinned_primitives"] and new["skinned_primitives"] < original["skinned_primitives"]:
        errors.append("Some meshes lost their skin weights (JOINTS_0/WEIGHTS_0).")
    if new["morph_targets"] < original["morph_targets"]:
        errors.append(f"Morph targets dropped from {original['morph_targets']} to {new['morph_targets']}.")
    if len(new["animations"]) < len(original["animations"]):
        errors.append(f"Animation clips dropped from {len(original['animations'])} to {len(new['animations'])}.")
    else:
        old = sorted(original["animations"], key=lambda a: a["duration"])
        cur = sorted(new["animations"], key=lambda a: a["duration"])
        for a, b in zip(old, cur):
            if abs(a["duration"] - b["duration"]) > 0.1:
                warnings.append(f"Clip '{a['name']}' is {a['duration']:.2f}s in the original; "
                                f"closest new clip '{b['name']}' is {b['duration']:.2f}s.")
        names_old = {a["name"] for a in original["animations"]}
        names_new = {a["name"] for a in new["animations"]}
        if names_old != names_new:
            warnings.append("Clip names changed. Original: " + ", ".join(sorted(names_old))
                            + " | New: " + ", ".join(sorted(names_new)))
        if len(new["animations"]) > len(original["animations"]):
            warnings.append(f"The new file has {len(new['animations'])} clips; the original had "
                            f"{len(original['animations'])}.")
    if new["materials"] < original["materials"]:
        warnings.append(f"Materials changed {original['materials']} -> {new['materials']}.")
    return errors, warnings


def unique_output_path(src):
    folder, name = os.path.split(src)
    stem = os.path.splitext(name)[0]
    n = 1
    while True:
        suffix = "_optimized" if n == 1 else f"_optimized_{n}"
        candidate = os.path.join(folder, stem + suffix + ".glb")
        if not os.path.exists(candidate):
            return candidate
        n += 1


def copy_no_overwrite(src, dst):
    """Copy src to dst, failing if dst already exists (never overwrites)."""
    with open(src, "rb") as fin, open(dst, "xb") as fout:
        shutil.copyfileobj(fin, fout)


def is_glb(path):
    try:
        with open(path, "rb") as f:
            return f.read(4) == b"glTF"
    except OSError:
        return False


def resolve_glb(path, log):
    """Accept a GLB file, or a folder (e.g. Meshy's download folder) holding exactly one."""
    if os.path.isfile(path):
        if is_glb(path):
            return path
        raise OptimizeError(f"'{os.path.basename(path)}' is not a GLB file. Please pick the .glb file.")
    if os.path.isdir(path):
        found = sorted(os.path.join(path, n) for n in os.listdir(path)
                       if n.lower().endswith(".glb") and "_optimized" not in n.lower()
                       and is_glb(os.path.join(path, n)))
        if len(found) == 1:
            log(f"You picked a folder; using the only GLB inside it: {os.path.basename(found[0])}")
            return found[0]
        if not found:
            names = ", ".join(sorted(os.listdir(path))[:15]) or "nothing"
            raise OptimizeError(f"The folder '{os.path.basename(path)}' has no .glb file in it "
                                f"(it contains: {names}). Open the folder that has your .glb and pick the file.")
        raise OptimizeError(f"The folder '{os.path.basename(path)}' has {len(found)} GLB files: "
                            + ", ".join(os.path.basename(f) for f in found)
                            + ". Double-click the folder, then click the one you want so its name "
                              "appears in the file-name box.")
    raise OptimizeError(f"Couldn't find '{path}'. Click the .glb file so its name appears in the "
                        "file-name box at the bottom of the file browser, then press Optimize GLB.")


def run(context, src, target_mb, min_size, log):
    src = resolve_glb(os.path.abspath(bpy.path.abspath(src)), log)
    target = int(target_mb * MB)

    log(f"SYNAPSE GLB optimizer  ({time.strftime('%Y-%m-%d %H:%M')}, Blender {bpy.app.version_string})")
    log(f"Target: under {target_mb:g} MB")

    original = analyze_glb(src)
    report_size_breakdown(log, original, "Original file")

    for ext, what in UNSUPPORTED_EXTENSIONS.items():
        if ext in original["extensions"]:
            raise OptimizeError(f"The GLB uses {ext} ({what}). Blender can't round-trip that "
                                "without losing data, so the file was left alone.")
    if original["external_images"]:
        raise OptimizeError("The GLB points at external texture files instead of embedding them: "
                            + ", ".join(original["external_images"]))
    if original["unskinned_when_skinned"]:
        raise OptimizeError("Some skinned meshes in the GLB have no skin weights; the file "
                            "looks malformed, so it was left alone.")

    non_texture = original["total"] - original["image_bytes"]
    if non_texture >= target:
        raise OptimizeError(
            f"Everything except the textures already takes {fmt_mb(non_texture)}, which is over the "
            f"{target_mb:g} MB target. Shrinking textures can't get there, and the only other "
            "options (reducing triangles, trimming animation keys, or Draco compression) change the "
            "mesh or animation data, which this script won't do automatically.")

    # Work in a new, empty scene so nothing else in the .blend is touched.
    window = context.window
    home_scene = context.scene
    work_scene = bpy.data.scenes.new(WORK_SCENE_NAME)
    view_layer = work_scene.view_layers[0]
    if window:
        window.scene = work_scene
        override = context.temp_override(window=window)
    else:  # command-line (background) mode has no window
        override = context.temp_override(scene=work_scene, view_layer=view_layer)
    workdir = tempfile.mkdtemp(prefix="synapse_glb_")
    try:
        with override:
            if bpy.context.scene != work_scene:
                raise OptimizeError("Couldn't switch to a separate work scene, so nothing was imported.")
            candidate, level = optimize_in_scene(work_scene, view_layer, src, original,
                                                 target, target_mb, min_size, workdir, log)
            result_info = verify_candidate(candidate, original, log)

            out_path = unique_output_path(src)
            if os.path.abspath(out_path) == src:
                raise OptimizeError("Refusing to write over the original file.")
            copy_no_overwrite(candidate, out_path)
    finally:
        if window:
            window.scene = home_scene
        shutil.rmtree(workdir, ignore_errors=True)

    final_size = os.path.getsize(out_path)
    result_info["path"] = out_path
    report_size_breakdown(log, result_info, "Optimized file")
    log.section("Done")
    log(f"Settings used: {level['label']}")
    log(f"Original:  {fmt_mb(original['total'])}  (unchanged) {src}")
    log(f"Optimized: {fmt_mb(final_size)}  {out_path}")
    log(f"Saved {100.0 * (1 - final_size / original['total']):.1f}%")
    log(f"The imported copy is in the scene '{work_scene.name}' if you want to look at it. "
        "You don't need to save this .blend.")
    return out_path


def optimize_in_scene(work_scene, view_layer, src, original, target, target_mb, min_size, workdir, log):
    """Import the GLB into work_scene and export the lightest setting under target."""
    before = snapshot()
    op = bpy.ops.import_scene.gltf
    result = op(**filtered(op, filepath=src, bone_heuristic="BLENDER",
                            guess_original_bind_pose=True, merge_vertices=False,
                            import_pack_images=True))
    if "FINISHED" not in result:
        raise OptimizeError("Blender's glTF importer failed on this file.")
    new = new_since(before)
    if any(work_scene not in o.users_scene for o in new["objects"]):
        raise OptimizeError("The importer put objects outside the work scene; stopping to be safe.")

    meshes, armatures, uses = inspect_import(log, new, original)

    # Select exactly the imported character, nothing else.
    for obj in work_scene.objects:
        obj.select_set(False, view_layer=view_layer)
    for obj in new["objects"]:
        if is_helper(obj):
            continue
        obj.hide_set(False, view_layer=view_layer)
        obj.select_set(True, view_layer=view_layer)
    if armatures:
        view_layer.objects.active = armatures[0]

    images = [i for i in new["images"] if i in uses]
    # Textures with real transparency stay PNG so their alpha survives.
    alpha_images = {i for i in images if not uses[i]["data"] and not uses[i]["normal"]
                    and has_variable_alpha(i)}

    log.section("Trying settings, lightest first")
    for n, level in enumerate(LEVELS, 1):
        if level["max"] is not None and level["max"] < min_size:
            break
        candidate = os.path.join(workdir, f"candidate_{n}.glb")
        swaps = apply_level(level, images, uses, alpha_images, workdir, min_size)
        try:
            export_glb(candidate, level["q"], original)
        finally:
            undo_swaps(swaps)
        size = os.path.getsize(candidate)
        under = size < target
        log(f"  {n}. {level['label']}: {fmt_mb(size)}{'  <- under target' if under else ''}")
        if under:
            return candidate, level

    raise OptimizeError(
        f"Even with textures at {min_size} px the file stays over {target_mb:g} MB. Going "
        "further would visibly blur the character, and the rest of the size is mesh and "
        "animation data that this script won't change. Nothing was saved. You can lower "
        "'Smallest texture (px)' in the file browser's side panel if you accept softer textures.")


def verify_candidate(candidate, original, log):
    info = analyze_glb(candidate)
    errors, warnings = verify(original, info)
    log.section("Checking the new file against the original")
    log(f"Triangles: {original['triangles']:,} -> {info['triangles']:,}")
    log(f"Bones: {sum(map(len, original['skins']))} -> {sum(map(len, info['skins']))}")
    log(f"Skinned mesh parts: {original['skinned_primitives']} -> {info['skinned_primitives']}")
    log(f"Animation clips: {len(original['animations'])} -> {len(info['animations'])}")
    log(f"Morph targets: {original['morph_targets']} -> {info['morph_targets']}")
    log(f"Materials: {original['materials']} -> {info['materials']}")
    for w in warnings:
        log(f"  note: {w}")
    if errors:
        raise OptimizeError("The optimized export didn't keep the character intact, so it "
                            "wasn't saved:\n  - " + "\n  - ".join(errors))
    return info


def write_report(log, out_path=None):
    text = bpy.data.texts.get(REPORT_TEXT_NAME) or bpy.data.texts.new(REPORT_TEXT_NAME)
    text.clear()
    text.write(log.text())
    if out_path:
        report_path = os.path.splitext(out_path)[0] + "_report.txt"
        try:
            with open(report_path, "x", encoding="utf-8") as f:
                f.write(log.text())
        except OSError:
            pass


class SYNAPSE_OT_optimize_glb(bpy.types.Operator, ImportHelper):
    """Pick a Meshy GLB and write a smaller copy next to it"""

    bl_idname = "synapse.optimize_meshy_glb"
    bl_label = "Optimize GLB"
    bl_options = {"REGISTER"}

    filename_ext = ".glb"
    filter_glob: StringProperty(default="*.glb", options={"HIDDEN"})
    target_mb: FloatProperty(name="Target size (MB)", default=25.0, min=1.0, max=1000.0,
                             description="Stop at the first setting that makes the file smaller than this")
    min_texture_size: IntProperty(name="Smallest texture (px)", default=1024, min=256, max=8192,
                                  description="Never shrink textures below this many pixels on the long side")

    def execute(self, context):
        log = Report()
        out_path = None
        try:
            out_path = run(context, self.filepath, self.target_mb, self.min_texture_size, log)
        except OptimizeError as e:
            log.section("Stopped, nothing was saved")
            log(str(e))
            log("Your original GLB was not changed.")
            write_report(log)
            self.report({"ERROR"}, f"Stopped: {str(e).splitlines()[0]} (see '{REPORT_TEXT_NAME}' in the Text Editor)")
            return {"CANCELLED"}
        write_report(log, out_path)
        self.report({"INFO"}, f"Saved {os.path.basename(out_path)} "
                              f"({fmt_mb(os.path.getsize(out_path))}). Full report: '{REPORT_TEXT_NAME}'")
        return {"FINISHED"}


def register():
    try:
        bpy.utils.unregister_class(SYNAPSE_OT_optimize_glb)
    except RuntimeError:
        pass
    bpy.utils.register_class(SYNAPSE_OT_optimize_glb)


if __name__ == "__main__":
    register()
    if bpy.app.background:
        # Command-line use: blender -b -P optimize_meshy_glb.py -- /path/to/file.glb
        import sys
        args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
        if not args:
            raise SystemExit("Pass the GLB path after --")
        bpy.ops.synapse.optimize_meshy_glb(filepath=args[0])
    else:
        bpy.ops.synapse.optimize_meshy_glb("INVOKE_DEFAULT")
