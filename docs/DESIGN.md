# SYNAPSE design: solid, in navy & gold

SYNAPSE keeps its brand colours (navy, gold, white) and looks **solid**: firm shapes, visible
structure, strong text and compact layouts, like a serious work tool. The public pages (home, events)
keep big photos and headlines but use the same firm buttons and type.

## Colour

| Token | Use |
| --- | --- |
| `navy-800` #0D1C3B | Text, accents, the meeting room (`navy-900/950`) |
| `gold-400` #E4A93C | Main buttons (with navy text), the active page, live and unread marks |
| `gold-700` #875C16 | Gold used as text on white (links, "View all"); plain `gold-400` is too light to read on white |
| White | Every surface: pages, the sidebar, panels, controls. No off-white or cream anywhere. |
| `sand` #E3E7EE, `navy-100` | Neutral hairlines and outlines |
| `navy-800` fills | The few navy accents: the active menu item, selected tabs, Create/New/Add buttons |
| `ivory-700` | Secondary text |
| `burgundy-*` | Leave, delete, errors |

The dashboard also uses its soft blue, green, amber, cyan and rose icon tints, as it always has.

## Type and shapes

- **Inter** everywhere in the app (bundled with `@fontsource-variable/inter`), medium and semibold
  weights, near-black navy text. Secondary text is `ivory-700` (#4F596B), never paler for content.
- **Corners:** 8px for buttons, inputs, tabs and menu items (`rounded-lg`), 6px for small tags
  (`rounded-md`), 10px for cards (`rounded-xl`), 12px for dialogs. No pill-shaped buttons in the app.
- **Controls** share one height: 38px (`.btn-*`, `.input-field`, toolbar buttons).
- **Buttons:** gold with navy text for the main action, solid navy for Create/New, white with a
  visible border for everything else.
- **Lines:** borders `navy-100` (#C5CCDB), dividers and grid lines `sand` (#D5DAE3). Cards are
  attached to the page with a border and almost no shadow; real shadows only on menus and dialogs.
- **Page titles** are 24px semibold/bold in the same row as the page's buttons.
- **Sidebar:** white, solid (filled) Heroicons in navy, 14.5px medium labels, groups separated by
  lines, the active item a navy block with a gold icon. The top bar is 64px to line up with it.

## Motion

- Pages fade in with a 6 px rise over 220 ms (`animate-page-in`).
- Menus scale in from their button on a soft curve. Reduce Motion makes everything instant.

## Home page

`src/pages/HomePage.tsx` is what signed-out visitors see at `/`. **Sign in** and **Get started**
open the existing forms at `/signin` and `/signup` (`AuthPage` with `initialMode`; the sign-in and
sign-up logic is unchanged). The Workspaces section uses `public/landing/office.webp`.

## Rule

Redesigns change how things look, never what's there: every feature on a page stays.

## Events

Public pages live at `/e` (explore), `/e/<slug>` (event) and `/e/ticket/<token>` (an attendee's
pass). They open for everyone, signed in or not. Hosts manage events at `/events` inside the app.

- Type: **Unbounded** for titles and **Raleway** for text, loaded only on events pages
  (`font-event-display`, `font-event`). The rest of SYNAPSE keeps the system font.
- The hero and the default poster use `public/events/hero.webp`.
- Only real numbers are shown (upcoming events, people registered, cities); with no events the page
  says so.
- Registration gives a QR code and a 6-digit PIN; the door checks people in by scanning or typing
  the PIN. Paid tickets are held and paid at the venue until online payment is connected.
- Database: `supabase/migrations/20261005100000_add_events.sql`.
