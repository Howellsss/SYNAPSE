# Art target — SYNAPSE Workspaces

These concept images set the **visual quality bar** for the spatial Workspaces module. The 3D office, furniture and characters built in `src/spatial/` must look at least this polished. They are concept art, not exact specs. The screen layouts and flow come from the mockups in `docs/design/` and the build prompts.

| File | What it shows | Match it for |
|---|---|---|
| `01-office.png` | Main office on a floating grass island | Lighting (soft, warm, ambient occlusion), materials, furniture style, conversation circle, AI assistant hologram |
| `02-characters.png` | Character lineup | Character style: chibi proportions, faces, a globally diverse cast, outfit detail |
| `03-avatar-builder.png` | Avatar creator screen | Builder layout and feel: 3D preview on a gold platform, skin-tone row, hairstyle and headwear grid, hair colour |
| `04-classroom.png` | Classroom workspace | Classroom template: stage, podium, screen, rows, breakout tables, reading corner |
| `05-event-hall.png` | Event hall workspace | Event template: lit stage, audience seating, networking tables, reception |
| `06-app-office-screen.png` | Full in-app office screen | How the 3D world sits inside the app UI: name tags, video tiles, people panel, control bar, wave notification |
| `07-coworking.png` | Co-working Space template | Shared hot-desk tables, coffee bar, phone booths, bean-bag lounge, living plant wall |
| `08-town-square.png` | Town Square template | Outdoor plaza: fountain, market stalls, string lights, picnic tables, open-air screen and stage |
| `09-coaching-studio.png` | Coaching Studio template | Calm waiting lounge, glass 1-to-1 session rooms, reception with booking screen |
| `10-campus.png` | Campus (built later) | Several linked buildings around a green quad with paths. Reference only until Campus is built |

The type-chooser screen layout is in `docs/design/step2-type-v2.png` (used by Prompt 2B).

## Notes for the build (don't copy these details)

- **Logo and slogans:** the SYNAPSE logo, the "Work. Meet. Build. Together." tagline and the "Better Ideas Together" wall sign in `06` were invented by the image generator. Use the real SYNAPSE logo and brand from the app, and don't add slogans unless the product owner provides them.
- **Names and people** in the images are placeholders. Real names come from users.
- **Avatar builder (`03`):** hairstyle thumbnails in the real builder should render in the currently selected skin tone and hair colour. Offer at least 12 skin tones and the full list of hairstyles and head coverings in the build prompts.
- **People panel (`06`):** "In your conversation" must list the same people who are standing in the glowing circle.
- **Sidebar (`06`):** keep the app's full, existing sidebar navigation. The image shows a shortened version.
- **Video tiles** show real camera feeds when the camera is on, and the avatar portrait when it's off.
- **Performance:** match this look on the **High** graphics setting. The **Low** setting may drop post-processing and real-time shadows but keeps the baked lighting, so it still looks good.
- **Type chooser (`../step2-type-v2.png`):**
  - The progress bar should show exactly 2 of 8 segments filled. The image shows a stray partial third segment.
  - Use the real SYNAPSE logo; the one in the image was invented.
  - "Key features" must list real workspace features from `spaceTypes.ts`, such as proximity video, private meeting rooms and access control. Ignore "High-speed internet & modern tech" in the image.
- **Cast:** images 07–09 lean toward darker skin tones. Scenes in the real product should show the full, globally diverse range, like `02-characters.png`.
- **Campus (`10`):** its characters are smaller and less chibi than the rest. When Campus is built, use the same character style as `02-characters.png`.
