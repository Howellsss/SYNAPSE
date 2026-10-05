# SYNAPSE design system: Graphite & Indigo

The look is "what Apple would build": calm near-white surfaces, near-black words, and one accent
colour that only appears where you can act.

## Colour

The Tailwind token names are kept from the first palette, so every page follows the new values:

| Token | Means | Key values |
| --- | --- | --- |
| `navy-*` | Ink and graphite greys | `navy-800` #1D1D1F text and dark surfaces, `navy-100` #E5E5EA hairlines, `navy-950` #0B0B0D meeting room |
| `gold-*` | The **indigo** accent | `gold-400` #4350E6 main buttons, selection, links (white text on it); `gold-50` #F0F1FE soft tint; `gold-700` accent text |
| `ivory-*` | Light greys | `ivory-50` #F7F7F9 sidebar, `ivory-100` #F2F2F5 panels, `ivory-600` #6E6E73 secondary text |
| `burgundy-*` | Red | `burgundy-500` #D70015 leave, delete, errors |

Rules:

- One accent, one job: indigo marks the next thing you can do. Everything else is ink on white.
- Grey does the organising: size, weight and two greys make the hierarchy, not boxes and colours.
- Text on indigo is always white. Indigo text on white is fine (contrast 6:1).
- Green only means live or online; red only means leave or delete. Both always come with a word.
- People's own brand colours on booking pages and workspaces stay theirs.

## Type

The system font: SF Pro on Mac, iPhone and iPad (so SYNAPSE reads like a native app), Geist
elsewhere. Titles use the display cut with tight tracking (`h1`–`h3` get it automatically).
Sizes: large title 34–44, title 24–28, headline 17, body 15, caption 13.

## Components

- Buttons (`btn-primary`, `btn-secondary`, `btn-danger`, `btn-ghost`) are pills.
- Cards (`card`) are 20 px rounded with a hairline, no shadow; hover lifts softly (`card-hover`).
- Inputs: hairline, indigo focus ring.
- Sidebar: light, grouped (everyday places, then tools), the current page in a grey row with an
  indigo icon.

## Motion

- Pages fade in with a 6 px rise over 220 ms (`animate-page-in`, keyed by section).
- Menus and sheets scale in from their button on a soft curve (`cubic-bezier(.2,.8,.2,1)`).
- Nothing bounces or spins; Reduce Motion makes everything instant.

## Home page

`src/pages/HomePage.tsx` is what signed-out visitors see at `/`. **Sign in** and **Get started**
open the existing forms at `/signin` and `/signup` (`AuthPage` with `initialMode`; the sign-in
and sign-up logic is unchanged). The Workspaces section uses `public/landing/office.webp`.

Mockups of every screen in both directions live in the "SYNAPSE Redesign" canvas.
