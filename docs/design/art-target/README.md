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

## Notes for the build (don't copy these details)

- **Logo and slogans:** the SYNAPSE logo, the "Work. Meet. Build. Together." tagline and the "Better Ideas Together" wall sign in `06` were invented by the image generator. Use the real SYNAPSE logo and brand from the app, and don't add slogans unless the product owner provides them.
- **Names and people** in the images are placeholders. Real names come from users.
- **Avatar builder (`03`):** hairstyle thumbnails in the real builder should render in the currently selected skin tone and hair colour. Offer at least 12 skin tones and the full list of hairstyles and head coverings in the build prompts.
- **People panel (`06`):** "In your conversation" must list the same people who are standing in the glowing circle.
- **Sidebar (`06`):** keep the app's full, existing sidebar navigation. The image shows a shortened version.
- **Video tiles** show real camera feeds when the camera is on, and the avatar portrait when it's off.
- **Performance:** match this look on the **High** graphics setting. The **Low** setting may drop post-processing and real-time shadows but keeps the baked lighting, so it still looks good.
