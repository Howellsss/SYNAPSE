# SYNAPSE virtual office: 3D art kit brief

A commissioning brief for a freelance 3D artist. It describes what to make, how it will be used,
the technical limits, and how the work is delivered and paid for. The final contract may refine
the commercial terms; the art and technical requirements here are what we will review against.

---

## 1. The product

SYNAPSE is a business web app (CRM, calendars, email). Its **Workspaces** feature is a virtual
office in the browser. Each team gets a small 3D world, such as an office, classroom, event hall
or town square. Everyone appears as an avatar. You walk your avatar up to colleagues to start a
video call, sit at a desk, or step into a meeting room.

How the art is seen:

- **Fixed isometric camera.** The world is viewed from one angle only: orthographic, rotated 45°
  around the vertical axis and tilted about 35° down. Players can pan and zoom, but they never
  rotate the camera. Assets only need to look finished from the **front and the two front-facing
  sides**. Backs and undersides can be simplified, but not missing, because some items are placed
  rotated by 90° or 180°.
- **Small to medium on screen.** A character is about **60–140 px tall** on a laptop screen, and
  furniture is often smaller. Silhouettes, colour blocks and big shapes matter far more than fine
  detail. If a detail can't be read at 80 px, leave it out.
- **Busy scenes.** A room can hold 50+ avatars and a few hundred furniture pieces, rendered in
  real time with three.js in an ordinary laptop or phone browser. Keep triangle counts, materials
  and textures within the budgets in section 8.
- **Brand.** The app UI is navy `#0D1C3B` and gold `#E4A93C`, with clean white and ivory
  surfaces. The world should feel warm and premium next to that UI. Gold and navy work well as
  accent colours (rugs, upholstery, signage), but the world shouldn't be painted in them.

## 2. Style target

**Premium, stylised, chibi.** Soft and friendly, clean materials, and nothing gritty or
photoreal.

- Characters have chibi proportions: a large head (about 1/3 of total height), a compact body,
  short limbs and expressive faces.
- Furniture and rooms have rounded edges and simplified forms, with a slightly toy-like "premium
  miniature" feel. They are not low-poly faceted, and they are not cartoon-outlined.
- Materials are soft and mostly matte: warm wood, fabric, brushed metal, frosted and clear glass,
  plants. Use little texture noise; most variation comes from colour and form.
- Lighting in the app is soft, warm and ambient with gentle shadows. Assets must look good under
  this without baked-in shadows, except for ambient occlusion (see section 8).

### Reference images

These images are **concept art made with an image generator**. They show the mood and quality we
want. **Do not copy them**, and do not treat them as exact specifications. Logos, slogans and
people's names in them are placeholders.

| File | Use it for |
| --- | --- |
| `docs/design/art-target/01-office.png` | Overall look: lighting, materials, furniture style, the floating grass island |
| `docs/design/art-target/02-characters.png` | **Character style.** Proportions, faces, a globally diverse cast, outfit detail |
| `docs/design/art-target/03-avatar-builder.png` | How characters are shown in the avatar builder (skin-tone row, hairstyle grid) |
| `docs/design/art-target/04-classroom.png` | Classroom furniture: stage, podium, screen, rows, breakout tables |
| `docs/design/art-target/05-event-hall.png` | Event furniture: lit stage, audience seating, networking tables |
| `docs/design/art-target/06-app-office-screen.png` | How the world sits inside the app at real size, with name tags and UI around it |
| `docs/design/art-target/07-coworking.png` | Hot-desk tables, coffee bar, phone booths, bean bags, plant wall |
| `docs/design/art-target/08-town-square.png` | Outdoor kit: fountain, market stalls, string lights, picnic tables |
| `docs/design/art-target/09-coaching-studio.png` | Glass session rooms, waiting lounge, reception |
| `docs/design/C-office.png` | **Room layout reference** for the main office (how rooms, walls and zones fit together) |

Notes on the references:

- Images 07–09 lean toward darker skin tones. The cast must cover the full range, as in `02`.
- The characters in `10-campus.png` are smaller and less chibi than the rest. Follow `02`.

> The art-target images currently live on the repository's `design/art-target` branch.
> `C-office.png` will be added before the brief is sent. If it isn't in the package you receive,
> ask for it.

## 3. Scale and units

Everything is built in **metres** and laid out on a **1 m grid**, with 0.5 m snapping. The
characters are chibi, so the furniture is scaled to them rather than to real people. Please use
these sizes. If the style test shows they look wrong, we'll adjust them then.

| Item | Size |
| --- | --- |
| Character, standing, top of head (no hair) | 1.20 m |
| Seat height (chairs, sofas) | 0.38 m |
| Desk and table height | 0.60 m |
| Standard desk | 1.2 × 0.6 m |
| Wall height | 2.4 m |
| Wall thickness | 0.15 m |
| Door opening | 1.0 × 1.9 m |
| Floor tile module | 1 × 1 m |

## 4. Character kit

The characters are **one modular system**. Players build their own avatar in an in-app builder,
so every part must fit together with every other part.

### Base body
- **One base body in several builds:** slim, average, broad and curvy, each in a shorter and a
  taller version. Builds can be separate meshes or shape keys, whichever works best for the
  wardrobe. Clothing must fit every build.
- **Skin is recoloured in the app.** Deliver a palette of **at least 12 skin tones from very deep
  to very light**. Include warm, neutral and cool undertones at each depth, as hex values, plus
  test renders of the base character in each one. Avoid ashy or grey results on deep tones.
- **Faces for a globally diverse cast:** several eye shapes, brow shapes, nose shapes and mouth
  shapes, kept within the chibi style. Facial hair (stubble, short beard, full beard, moustache)
  and freckles are optional extras. Faces may be texture-driven (swappable decals) or mesh-based.
  Recommend whichever you think works best at small sizes.
- **Expressions:** neutral, smile, talking (mouth open) and blink, as shape keys or texture swaps.
  These are used to show who is speaking.

### Hair and head coverings
Every style must work with **recolourable hair** and in every skin tone. Head coverings must hide
or replace the hair cleanly; tell us which hairstyles each covering works with.

- **Hairstyles:** afro, braids, locs, low cut, buzz cut, straight, wavy, curly, bob, ponytail,
  bun, long hair, bald.
- **Head coverings:** hijab, turban, gele (head-tie) and cap.

Textured and Afro-textured hair (afro, braids, locs, coils) should be modelled with the same
care and volume as straight styles. These are core styles, not extras.

### Clothing and accessories
- **Tops:** t-shirt, shirt/blouse, knitted jumper, hoodie.
- **Jackets:** blazer, casual jacket.
- **Dresses:** at least two (for example a shift dress and a long dress).
- **Trousers and skirts:** trousers, jeans, shorts, a skirt.
- **Shoes:** trainers, smart shoes, boots, sandals.
- **Glasses:** round and rectangular frames, and sunglasses.
- **Headphones:** over-ear headphones, used to show "in a call" or "focusing".

The minimum is what's listed above. More variety is welcome if it stays within budget.

### Construction
- **Separate meshes per part** (body, head, eyes, brows, hair, each clothing item, shoes,
  accessories). We mix and match parts in the app.
- **One shared humanoid rig** drives every build and every clothing item. Use standard humanoid
  bone naming (Mixamo-style or similar; tell us which). Limit it to about 65 bones and at most
  4 bone influences per vertex. Export with no IK or constraints.
- **Hide or cut away hidden body parts.** Where clothing fully covers the body, provide a matching
  body-mask option (or split body regions) so skin doesn't poke through during animation.
- **Recolourable materials.** Base colours are neutral or white so the app can tint them. Use
  clearly named material slots or masks, for example: `skin`, `hair`, `cloth_primary`,
  `cloth_secondary`, `cloth_trim`, `accessory`.

### Animations
All animations use the shared rig, at 30 fps, **in place** (no root motion), with loops that
loop seamlessly. They must work with every build and outfit without clipping, including dresses
and long hair.

| Clip | Notes |
| --- | --- |
| `idle` | Loop. Subtle breathing and shifting of weight, with a little life in it |
| `walk` | Loop. Friendly and slightly bouncy, matching the chibi proportions |
| `sit_down` / `sit_idle` / `stand_up` | Transition into a chair, a seated loop, and the transition out |
| `wave` | One-shot greeting, about 1.5 s |
| `cheer` | One-shot celebration, about 2 s |
| `raise_hand` | Raise into a held loop, then lower (used for "hand raised" in classes and meetings) |

Optional extras we'd welcome a quote for: a `typing` loop while seated, and `talk_gesture` loops.

## 5. Pets

A **dog** and a **cat**, in the same style, each with recolourable fur (at least 4 coat colours
per animal). Each has its own small rig, with these clips: `idle`, `walk`, `sit` and `lie_down`.
In-place loops at 30 fps.

## 6. Furniture and props

Each item is a separate GLB. Use the IDs below as the file names; the app's furniture catalogue
will use the same IDs. Where it says "variants", supply colour or material options through
recolourable slots instead of separate meshes where you can.

**Work: desks and seating**
- `desk_single` (with monitor, keyboard and a small lamp as separate props)
- `desk_cluster_4`
- `standing_desk`
- `hot_desk_table_long` (6–8 seats)
- `office_chair`
- `stool`
- `workbench`
- `reception_desk` (with a booking-screen prop)
- `coach_desk`

**Meetings and talks**
- `meeting_table_4`
- `meeting_table_8`
- `round_table_small`
- `bar_table_high`
- `whiteboard`
- `tv_screen_wall`
- `screen_on_stand`
- `podium`
- `stage_platform` (modular 1 × 1 m and 2 × 1 m blocks, plus steps)
- `stage_lights`
- `audience_chair`
- `audience_row_5`
- `conversation_circle_rug` (a floor ring that can glow, used for group-call zones)

**Lounge and social**
- `sofa_2`, `sofa_3`, `sofa_corner`
- `armchair`
- `bean_bag`
- `coffee_table`
- `side_table`
- `rug_round` and `rug_rect` (variants)
- `coffee_bar` (counter with machine)
- `kitchen_counter`
- `fridge`
- `water_cooler`
- `phone_booth` (enclosed, one person, with glass door)
- `bookshelf`
- `library_shelf_tall`
- `reading_nook_chair`

**Plants and decor**
- `plant_floor_large`, `plant_floor_small`
- `plant_desk`
- `plant_wall_panel`
- `planter_box`
- `tree_small`
- `wall_art_frame`
- `wall_screen` (has a flat face where the app shows a team's logo)
- `clock`
- `pendant_lamp`
- `floor_lamp`

**Classroom**
- `teacher_desk`
- `student_desk`
- `student_chair`
- `blackboard_wall`
- `breakout_table`
- `bean_bag_cluster`

**Outdoor (Town Square)**
- `fountain`
- `market_stall`
- `picnic_table`
- `bench`
- `lamp_post`
- `string_lights` (a span between two posts)
- `open_air_screen`
- `campfire_ring`
- `tent_small`
- `paving_path` tiles

**Interactive markers**
- `door_knock_panel`
- `lock_indicator` (a small light on room doors)
- `ai_assistant_pedestal` (a pedestal with a hologram-style projection, as in `01`)

If you see an item that would clearly improve a scene, suggest it. Keep the list as the minimum.

## 7. Room kit

A modular kit that snaps to the 1 m grid. The app builds every room from these pieces.

- **Floor tiles,** 1 × 1 m, with seamless edges: warm wood, light wood, carpet (recolourable),
  polished concrete, tile, outdoor paving and grass.
- **Walls in 1 m and 2 m modules:** brick (exposed, warm) and plaster (recolourable). Each comes
  as a full-height version and a **low cut-away version** about 0.6 m high. The app lowers the
  walls nearest the camera so players can see inside.
  - Pieces needed: straight, corner (inner and outer), T-junction and end cap.
  - **Window modules:** a large window with a frame, and a high strip window.
  - **Door modules:** an open doorway, and a doorway with a door. The door should be a separate
    mesh that can open.
- **Glass partitions** in 1 m and 2 m modules, frosted and clear, plus a glass door module. These
  are used for meeting rooms and coaching session rooms. Glass must still read clearly at small
  sizes, with visible frames and a faint tint.
- **Grass island base:** the floating base under the whole world, as in `01`. It's modular so we
  can build any rectangular size: centre, edge and corner pieces showing a soil and rock
  cross-section, with grass trim. Include a few optional edge decorations such as small rocks,
  hanging roots and bushes.

## 8. Technical specifications

**Format and scene setup**

| Item | Requirement |
| --- | --- |
| Format | **glTF 2.0, binary `.glb`**, one file per asset |
| Units and axes | Metres, **Y-up**, facing **+Z** (front faces the camera's "down-right" side when unrotated) |
| Transforms | All applied: scale 1, rotation 0. No negative scale |
| Pivot | **At floor level, centred on the footprint.** For characters, between the feet. For walls, the base centre of the module |

**Polygon budgets**

| Item | Requirement |
| --- | --- |
| Character | **≤ 3,000 triangles for a fully dressed character** (body + hair + outfit + accessories). Tell us the count for each part |
| Pet | ≤ 2,000 triangles |
| Furniture | **≤ 1,500 triangles per item.** Small props should be far less, about 100–500 |
| Room kit pieces | ≤ 500 triangles per module |

**Materials and textures**

| Item | Requirement |
| --- | --- |
| Materials | PBR metallic-roughness. Use as few as possible: about **2 per furniture item** and **1 per character part** |
| Textures | **Shared texture atlases, ≤ 1024 × 1024**, power-of-two sizes. A gradient or colour-palette atlas shared across many items is ideal |
| Compression | **KTX2 / Basis-friendly.** No fine high-frequency detail that falls apart when compressed. Avoid alpha where you can; if it's needed, use alpha-cutout rather than blending (except glass) |
| Ambient occlusion | May be baked into the base colour or a separate AO channel. Don't bake cast shadows |
| Normal maps | Optional. Only use them if they visibly help at in-app size |

**Rigging and animation**

| Item | Requirement |
| --- | --- |
| Rig | One shared humanoid skeleton, ≤ 65 bones, ≤ 4 influences per vertex |
| Animation | glTF animation clips, named exactly as in section 4, at 30 fps |

**Naming and checks**

| Item | Requirement |
| --- | --- |
| Naming | `snake_case` for files, meshes, materials and clips. File names use the IDs in section 6 |
| Validation | Every GLB passes the [Khronos glTF Validator](https://github.khronos.org/glTF-Validator/) with **0 errors** and loads in the three.js editor |

## 9. Delivery

For each milestone, send:

1. **Source files:** Blender `.blend` (4.x), organised into collections with modifiers applied or
   clearly labelled, plus any texture sources (layered PSD or Krita files, or Substance projects).
2. **Exports:** one `.glb` per asset, in a folder structure like
   `characters/ pets/ furniture/ room-kit/ animations/`.
3. **Preview renders** of each asset at the in-app camera angle (orthographic, 45° / 35°) on a
   neutral background, plus one contact sheet per milestone.
4. **A short README:** material slots and what each one controls, the skin-tone palette (hex),
   per-part triangle counts, which hairstyles work with which head coverings, and any known
   limits.

We review every delivery inside the real app, at real size, with the real lighting. Each
milestone includes **two rounds of revisions**.

## 10. Licence and ownership

- **Full commercial rights, exclusive.** All work made for this commission is assigned to the
  client on payment: copyright and all other rights, worldwide, forever, for any use, including
  modification and resale as part of the product. The artist may not resell, re-license or reuse
  these assets or close derivatives.
- **Portfolio use** (renders only, not the asset files) is allowed after the feature launches,
  unless agreed otherwise in writing.
- **Original work only.** Don't include third-party or marketplace assets, scans or textures
  without written approval and a licence that allows exclusive commercial use. List any approved
  third-party content in the README.
- Moral rights are waived to the extent the law allows.

## 11. Milestones

The **style test comes first** and is paid on its own. The rest of the commission only goes ahead
once the style test is approved.

| # | Milestone | Contents |
| --- | --- | --- |
| **1** | **Style test** | **1 character** (average build, one hairstyle, one outfit, rigged, with `idle` and `walk`) and **3 furniture pieces**: `desk_single` with chair, `sofa_2`, `plant_floor_large`. Exported to spec, with renders at the in-app angle |
| 2 | Character base | All builds, at least 12 skin tones, face variants, expressions, rig final |
| 3 | Hair and headwear | All hairstyles and head coverings |
| 4 | Wardrobe | Clothing, shoes, glasses, headphones |
| 5 | Animations | All character clips |
| 6 | Room kit | Floors, walls, windows, doors, glass partitions, grass island |
| 7 | Furniture | Section 6, in two or three batches (work and meetings first, then lounge and decor, then classroom and outdoor) |
| 8 | Pets | Dog and cat, with clips |
| 9 | Final pass | Consistency fixes across the kit, final README |

**To quote,** please give a price and timeline for each milestone, your hourly rate for extras,
and links to relevant stylised character and environment work.
