# SYNAPSE design: Apple-style layouts in navy & gold

SYNAPSE keeps its brand colours, navy and gold, and uses Apple's discipline for layout: generous
space, large titles, quiet surfaces, one bright accent where you can act, and gentle motion.

## Colour

| Token | Use |
| --- | --- |
| `navy-800` #0D1C3B | Text, the sidebar, dark surfaces, the meeting room (`navy-900/950`) |
| `gold-400` #E4A93C | Main buttons (with navy text), the active page, live and unread marks |
| `gold-700` #875C16 | Gold used as text on white (links, "View all"); plain `gold-400` is too light to read on white |
| `paper` #F6F5F1, `sand` #E6E3DA | Warm ivory panels and hairlines in the Apple-style layouts |
| `ivory-700` | Secondary text |
| `burgundy-*` | Leave, delete, errors |

The dashboard also uses its soft blue, green, amber, cyan and rose icon tints, as it always has.

## Type and shapes

- The system font (SF Pro on Apple devices, Geist elsewhere); titles get tighter tracking.
- Buttons are pills; cards are 20 px rounded with a hairline and a soft navy shadow.

## Motion

- Pages fade in with a 6 px rise over 220 ms (`animate-page-in`).
- Menus scale in from their button on a soft curve. Reduce Motion makes everything instant.

## Home page

`src/pages/HomePage.tsx` is what signed-out visitors see at `/`. **Sign in** and **Get started**
open the existing forms at `/signin` and `/signup` (`AuthPage` with `initialMode`; the sign-in and
sign-up logic is unchanged). The Workspaces section uses `public/landing/office.webp`.

## Rule

Redesigns change how things look, never what's there: every feature on a page stays.
