# SYNAPSE architecture

SYNAPSE is a single-page React app (Vite + TypeScript + Tailwind) on top of Supabase
(Postgres with row-level security, Auth, Storage and Edge Functions). It deploys to Vercel.
Everything a signed-in user works on lives inside a **workspace**.

## Folder map

```
src/
  main.tsx               Boots React; shows "Configuration required" if Supabase env vars are missing
  App.tsx                Router switch + authenticated shell (Sidebar, TopBar, page)
  index.css              Tailwind layers, shared classes (card, btn-*, input-field, nav-item …)
  context/
    AuthContext.tsx      Session, profile, current workspace and membership/role
    ToastContext.tsx     toast(message, type)
  lib/
    supabase.ts          The Supabase client
    router.ts            useRouter(): hash router
    utils.ts             cn(), formatting, slugify, getFullName …
    scheduling.ts        Slot/availability engine (+ scheduling.test.ts, run with vitest)
    workflow-engine.ts   Workflow execution helpers; workflow-constants.tsx has triggers/actions
    form-*.ts            Form builder model, definitions, templates; booking-form.ts
    group-page-config.ts Group calendar page designer config
    email-accounts.ts    Connected Gmail accounts (hooks + connect/disconnect)
    contact-nav.ts       Prev/next navigation between contacts
    spaces.ts            Spaces (virtual offices): list, get by slug, slug check, createSpace,
                         updateSpace, logo upload, joinSpaceAsGuest (guest link RPC)
    invitations.ts       Team invitations (used by Settings → Team and the space wizard)
  pages/                 One component per screen (see Routing)
  components/
    layout/              Sidebar, TopBar
    ui/                  Modal, Drawer, ConfirmDialog, Avatar, States, StatusPills, TimezoneSelect
    contacts/ calendar/ forms/ workflow/   Feature components used by the pages
    spaces/              room/ is the in-space screen (people panel, toolbar, control bar, invite);
                         space preview tile, settings drawer, DeviceCheck (camera & mic: wizard last
                         step, "Get ready" before a first visit, modal from Workspaces and in a space); wizard/ holds the create-workspace
                         steps and state (branching by type); config/ holds the Rooms, Access,
                         Availability and Branding editors shared by the wizard and the drawer
  types/index.ts         Shared TypeScript types mirroring the database tables
  spatial/               Spatial workspace data: media/useLiveKitRoom (audio & video, see docs/LIVEKIT.md),
                         net/ (realtime multiplayer: channel, presence, moves,
                         emotes, interpolation), quality (graphics
                         setting), scene/pathfinding (A* on the nav grid), media/ (camera & mic check: devices, useMediaCheck,
                         useMediaPrefs), slug rules, links, schedule (open hours), access
                         (permissions, guest tokens), layoutFile (.synapse-space.json import/export),
                         data/ (types, sizing, templates, rooms, branding)
supabase/
  migrations/            Schema history (run in order); supabase-setup.sql is the combined file
  functions/             Edge Functions: form-submit, gmail-oauth, send-email, livekit-token
  config.toml            Per-function JWT settings
scripts/build-supabase-setup.sh   Regenerates supabase-setup.sql from the migrations
docs/                    This file, GMAIL_SETUP.md, ART-BRIEF.md (3D art commission brief),
                         TESTING-MULTIPLAYER.md, LIVEKIT.md (audio & video setup)
```

## Routing

`src/lib/router.ts` is a tiny hash router. `useRouter()` returns `[path, navigate]`:

- `path` is `location.hash` without the `#`, falling back to `location.pathname`, then `/dashboard`.
- `navigate('/x')` sets `location.hash`. The public pages `/book/…`, `/group/…`, `/join/…` and
  `/invite/…` use a real page load (`location.href`) so they work as shareable links.
- Query strings ride inside the hash (`#/settings?tab=email`); pages parse them themselves.

`App.tsx` decides what to render, in this order:

1. Auth still loading → spinner.
2. `/book/:slug` or `/group/:slug` → `BookingPage` (public, no login).
3. `/join/:token` → `GuestJoinPage` (public; a space's guest link, via the `join_space_as_guest` RPC).
   `/invite/:token` → `AcceptInvitePage` (public to view, login to accept).
4. No user → `AuthPage` (sign in, sign up, forgot/reset password).
5. `/workspace/new` → `CreateSpaceWizard`, full screen without the shell.
6. Otherwise the shell (`Sidebar` + `TopBar`) around `renderPage()`, which matches `path` with
   `startsWith`/regex: `/contacts/:id` → `ContactDetailPage`, `/contacts` → `ContactsPage`,
   `/calendars/groups/:id` → `GroupCalendarSettingsPage`, `/calendars` → `CalendarsPage`,
   `/forms/:id/edit` → `FormBuilder`, `/forms` → `FormsPage`, `/workflows`, `/recordings`,
   `/workspace/:slug` → `SpacePage` (rendered full height next to the sidebar, without the top bar), `/workspace` → `WorkspacesPage`,
   `/ai-hub`, `/settings`, and the placeholder routes below. Unknown paths show the Dashboard.

To add a screen: create `src/pages/XPage.tsx`, add a branch in `renderPage()`, and add a
`navItems` entry in `Sidebar.tsx` if it belongs in the menu.

## Auth → profile → workspace

All of this lives in `AuthContext.tsx` and is exposed through `useAuth()`:
`{ user, session, profile, workspace, membership, role, canManageTeam, loading, … }`.

1. On mount, `supabase.auth.getSession()` restores the session; `onAuthStateChange` handles
   later sign-ins and sign-outs.
2. `loadUserData(user)` runs for a signed-in user:
   - loads `profiles` where `user_id = user.id` → `profile`;
   - loads the user's **oldest** `workspace_members` row → `membership`, then that
     `workspaces` row → `workspace` (falls back to a workspace the user owns);
   - if there is no membership but the user owns a workspace, it re-creates the owner
     membership;
   - if the user has neither, it runs first-time account setup (profile, first workspace, owner
     membership, demo data via the `seed_workspace_demo_data` RPC), then loads again.
3. `signIn` also accepts pending `team_invitations` for the email, which adds memberships.
4. `role` is `membership.role` (`owner` | `admin` | `member`); `canManageTeam` is owner/admin.

A user sees **one current workspace** (the oldest membership). There is no workspace switcher
yet. Pages read `workspace.id` from `useAuth()` and filter every query by it. Row-level security
enforces the same thing server-side with `is_workspace_member(workspace_id)` /
`can_access_workspace(...)`, so building inside the workspace means: every new table gets a
`workspace_id` column and RLS policies using those helpers.

Calendars, calendar groups, forms, booking links/locks, appointments and some messages were later
made to work **without** a workspace: `workspace_id` is nullable there and an `owner_id` column
is the fallback. New work should still scope by `workspace_id`.

## Tables by module

| Module | Tables |
| --- | --- |
| Workspace & team | `workspaces`, `workspace_members`, `profiles`, `team_invitations`, `workspace_settings` (per-category JSON settings), `audit_logs` |
| Contacts (CRM) | `contacts`, `tags`, `contact_tags`, `smart_lists`, `notes` |
| Calendars & booking | `calendars`, `calendar_hosts`, `calendar_groups`, `calendar_group_members`, `calendar_group_analytics`, `availability_rules`, `availability_overrides`, `host_availability_rules`, `external_busy_periods`, `booking_links`, `booking_locks`, `appointments`, `appointment_participants`, `notification_rules` |
| Forms | `forms`, `form_fields`, `form_field_conditions`, `form_submissions`, `form_notification_logs`, `form_activity_timeline` |
| Workflows | `workflows`, `workflow_nodes`, `workflow_edges`, `workflow_versions`, `workflow_enrollments`, `workflow_executions`, `workflow_execution_logs`, `workflow_goals`, `workflow_templates` |
| Spaces (virtual offices) | `spaces` (owned by a workspace; slug unique across all tenants; also `access_mode`, `guest_link_token`, `permissions`, `persistence` + `schedule`, `branding`, `config.rooms`), `space_members` (per-person state in a space) |
| Messaging | `messages` (email/SMS log per contact), `email_accounts`, `email_account_secrets` (encrypted OAuth tokens, no client access) |
| Recordings | `recordings` |
| Integrations | `integrations`, `integration_sync_logs`, `webhooks` |

Child tables (`form_fields`, `workflow_nodes`, `calendar_hosts`, `availability_rules`, …) have no
`workspace_id`; their RLS goes through the parent row. Storage buckets: `avatars`,
`workspace-logos` (both public).

## Sidebar items

| Item | Route | State |
| --- | --- | --- |
| Dashboard | `/dashboard` | Real (reads workspace data) |
| Meetings | `/meetings` | **Placeholder** (`ComingSoonPage`) |
| Workspaces | `/workspace` | Real: spaces grid and create wizard (`/workspace/new`, full screen); `/workspace/:slug` is the in-space screen (people, status, controls); the 3D world itself waits for the art kit |
| Contacts | `/contacts` | Real: list, add, detail page with composer (email via Gmail) |
| Conversations | `/conversations` | **Placeholder** (`ComingSoonPage`) |
| Events | `/events` | **Placeholder** (`ComingSoonPage`) |
| Webinars | `/webinars` | **Placeholder** (`ComingSoonPage`) |
| Calendars | `/calendars` | Real: calendars, groups, appointments, public booking pages |
| Submissions | `/forms` | Real: forms and surveys, builder, submissions |
| Workflows | `/workflows` | Real builder and storage; runs in the browser (`workflow-engine.ts`), triggered only by public-page bookings and cancellations |
| Recordings | `/recordings` | Real list/detail over `recordings`; nothing creates recordings yet |
| Media Library | `/media-library` | **Placeholder** (`ComingSoonPage`) |
| AI Hub | `/ai-hub` | Partial: keyword-matched database queries, no AI model behind it |
| Settings | `/settings` | Real: profile, workspace, team, email (Gmail); some tabs only save preferences |

## Realtime multiplayer (`src/spatial/net/`)

Each space has one Supabase Realtime channel, `space:<spaceId>`, opened by `useSpaceChannel` while
you're inside the space.

| What | How | Volume |
| --- | --- | --- |
| Who's here | **Presence**, keyed by user id: `{ userId, name, avatarUrl, avatarHash, status, away, zoneId, deskId, conversation, joinedAt }`. Tracked once connected, re-tracked after every reconnect, untracked on leave. `away` turns on after 5 minutes hidden or idle. | Only on join, leave or change |
| Keyboard movement | Broadcast `move` `{ userId, x, z, rot, anim, seq, t }`, at most 10 a second, plus a final message when you stop | 10/s per person moving |
| Click-to-walk | Broadcast `path` once (the waypoints, speed, and whether to sit at the end); receivers walk it themselves. A `move` correction is sent once a second while walking. | 1 + 1/s per walker |
| Standing still | `move` heartbeat every 5 s (`HEARTBEAT_MS`). When someone new joins, everyone sends their position once, so newcomers don't wait for a heartbeat. | 0.2/s per person |
| Emotes | Broadcast `emote` `{ userId, kind, to, t }`: wave, cheer, heart, raise_hand, lower_hand. `to` aims a wave at one person. | Occasional |

Receivers keep each remote person in a `RemoteMover` (outside React state): snapshots are placed
on the local clock and drawn 120 ms in the past (`INTERPOLATION_DELAY_MS`) so there's almost always
a next snapshot to blend to; nothing is extrapolated, so avatars never overshoot through walls.
Late or duplicate messages are dropped by `seq`.

The Workspaces grid's "N online" counts come from `usePresenceCounts`, which listens to each space's
presence without tracking (so viewing the grid doesn't count you as inside).

### Spoofing limits

Realtime broadcast and presence are relayed by Supabase **without checking what's inside them**.
Today the channels are public: anyone with the project's anon key who knows a space's id could join.

- **What we do:** every message is validated (`protocol.ts`: types, ranges, lengths, https-only avatar
  URLs). Movement and emotes are ignored unless the sender's `userId` is present in the channel, and
  presence entries filed under a key that isn't their own `userId` are dropped. You can't move your
  own copy from outside.
- **What a malicious member could still do:** send `move`/`emote` messages with another present
  person's `userId` (their avatar would jump or wave for everyone else), or put a false name or
  status in their own presence. Nothing is stored and nothing reaches the database, so the damage
  is cosmetic and lasts until the real person's next message.
- **To close it:**
  1. Make channels private (Realtime Authorization) with an RLS policy on `realtime.messages` that
     allows only members of the space's workspace. This stops outsiders, not insiders.
  2. Make names come from the database, not presence (look the user id up in `profiles`).
  3. For full protection, route moves through an Edge Function or a small authoritative server that
     stamps the sender's verified user id.

### Message volume and plan limits

Supabase counts a broadcast once **per receiving client**, so one message in a 25-person space
counts as 24. Estimates for one 25-person space (`estimateVolume` in `volume.ts`; 8-hour days,
22 days a month):

| Scenario | Sent/s | Delivered/s | Per 8 h day | Per month |
| --- | --- | --- | --- | --- |
| Quiet: 1 person walking at a time, 5 s heartbeat (current) | 6.0 | 145 | 4.2 M | 92 M |
| Busy peak: 3 on keyboard + 3 walking at once | 37 | 897 | 26 M | — (peak, not all day) |
| Quiet with a 30 s heartbeat | 2.0 | 49 | 1.4 M | 31 M |
| Quiet, no heartbeat while standing | 1.2 | 30 | 0.85 M | 19 M |

Plan limits (from the Supabase Realtime limits page, Oct 2026 — check before relying on them):

| | Free | Pro | Pro, no spend cap / Team |
| --- | --- | --- | --- |
| Concurrent connections | 200 | 500 | 10,000 |
| Messages per second | 100 | 500 | 2,500 |
| Presence messages per second | 20 | 50 | 1,000 |
| Messages included per month | 2 M | 5 M | 5 M, then about $2.50 per million |

What that means for one busy 25-person office:
- **Free** is too small: a quiet office already delivers ~145 messages a second (over 100), and a
  day uses most of the month's 2 M.
- **Pro** handles the rate of a quiet office, but busy peaks (~900/s) exceed 500/s; Supabase then
  disconnects clients until traffic drops (supabase-js reconnects). Monthly volume (~92 M) would be
  ~87 M over the included 5 M ≈ **$220/month** in overage.
- **Pro without spend cap or Team** covers the peaks (2,500/s).
- **Cheapest fix:** raise `HEARTBEAT_MS` to 30 s (≈ 31 M/month ≈ $65 overage) — newcomers already
  get everyone's position when they join, so a slow heartbeat only affects drift correction.

## Proximity conversations (`src/spatial/media/proximity.ts`, `useProximity.ts`)

Who you hear and see is decided on each position update and at least every 500 ms:

| Where | Rule |
| --- | --- |
| Open floor, lounges, breakouts | In range at ≤ 4 tiles, out at > 5 (hysteresis). Volume full at ≤ 1.5 tiles, ~20 % at the edge. |
| Meeting rooms, private offices | Everyone in the same room at full volume, nobody outside (not even the stage). Lockable rooms: people with the `lock_rooms` permission lock them (the lock lasts while they're present, shared in presence `locks`); others **Knock**, and anyone inside can **Let in**. |
| Stage | People on the stage are heard and seen by the whole space (except closed rooms and quiet zones); the audience is heard only by people near them. |
| Quiet zone | Chat only: no audio or video in or out. |

`useProximity` subscribes only to in-range participants' tracks and unsubscribes from everyone else
(LiveKit `autoSubscribe` is off), sets each person's volume, and plays the subscribed audio.
Conversation groups are connected groups of in-range people; each open-floor group gets a floor
circle (centre and radius in tiles) for the scene to draw as the soft gold dashed ring. Your group
fills "In your conversation" and your presence `conversation`. Above 30 people, neighbours come
from a spatial hash instead of checking every pair.

Video strip (top centre): a tile per person you hear — camera or avatar portrait, name, gold ring
while speaking, muted icon, click to enlarge, "+N" when they don't fit. **Data saver:** audio
from everyone in range, video from the nearest 2 only, at low quality; it's suggested
automatically after 8 s of a poor connection.

Your position comes from the 3D scene, which isn't built yet. Until then you're "nowhere": only
stage speakers reach you. In development, `window.__synapse.setPose(x, z, zoneId?)` places you
for testing. Note: proximity decides what the client subscribes to; it isn't a privacy boundary
(see the privacy note in docs/LIVEKIT.md).

## Checks

`npm run typecheck`, `npm run lint`, `npm run build`, `npx vitest run`.
