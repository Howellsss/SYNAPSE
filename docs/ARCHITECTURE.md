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
    glb.ts               Reads a character .glb in the browser: size check (30 MB), clip names and
                         lengths, bones, triangles (+ glb.test.ts)
    glbCompress.ts       Shrinks a .glb in the browser before upload (textures only: JPEG, then smaller,
                         lightest step first; mesh, skeleton and animation bytes untouched), so files
                         straight from Meshy fit the 30 MB limit without Blender (+ glbCompress.test.ts)
    characters.ts        Characters: list, upload (checks and, if needed, shrinks the GLB first), signed file URL, set the
                         default clip, delete
  pages/                 One component per screen (see Routing)
  components/
    layout/              Sidebar, TopBar
    ui/                  Modal, Drawer, ConfirmDialog, Avatar, States, StatusPills, TimezoneSelect
    contacts/ calendar/ forms/ workflow/   Feature components used by the pages
    characters/          CharacterViewer: three.js preview of a .glb (orbit, zoom, play a clip).
                         Loaded lazily, so three.js only downloads on the Characters page
    spaces/              room/ is the in-space screen (people panel, toolbar, control bar, invite);
                         space preview tile, settings drawer, DeviceCheck (camera & mic: wizard last
                         step, "Get ready" before a first visit, modal from Workspaces and in a space); wizard/ holds the create-workspace
                         steps and state (branching by type); config/ holds the Rooms, Access,
                         Availability and Branding editors shared by the wizard and the drawer;
                         scene/SpaceScene is the 3D world (lazy-loaded three.js, see "The 3D space")
  types/index.ts         Shared TypeScript types mirroring the database tables
  spatial/               Spatial workspace data: media/useLiveKitRoom (audio & video, see docs/LIVEKIT.md),
                         net/ (realtime multiplayer: channel, presence, moves,
                         emotes, interpolation), quality (graphics
                         setting), scene/ (pathfinding: A* on the nav grid; floor: floor size, spawning, keys → walking
                         direction; avatarClips: which character and clips people appear as), media/ (camera & mic check: devices, useMediaCheck,
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
5. `/meetings/:code` → `MeetingRoomPage` (Zoom-style preview with mic/camera pickers, then the video call), full screen. See "Meetings" in docs/LIVEKIT.md for devices, chat, reactions and annotation.
   `/workspace/new` → `CreateSpaceWizard`, full screen without the shell.
6. Otherwise the shell (`Sidebar` + `TopBar`) around `renderPage()`, which matches `path` with
   `startsWith`/regex: `/contacts/:id` → `ContactDetailPage`, `/contacts` → `ContactsPage`,
   `/calendars/groups/:id` → `GroupCalendarSettingsPage`, `/calendars` → `CalendarsPage`,
   `/forms/:id/edit` → `FormBuilder`, `/forms` → `FormsPage`, `/f/:id` → `PublicFormPage` (public), `/workflows`, `/recordings`, `/characters`,
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
4. `role` is `membership.role` (`owner` | `admin` | `supervisor` | `member`); `canManageTeam` is owner/admin.

A user sees **one current workspace** (the oldest membership). There is no workspace switcher
yet. Pages read `workspace.id` from `useAuth()` and filter every query by it. Row-level security
enforces the same thing server-side with `is_workspace_member(workspace_id)` /
`can_access_workspace(...)`, so building inside the workspace means: every new table gets a
`workspace_id` column and RLS policies using those helpers.

Calendars, calendar groups, forms, booking links/locks, appointments and some messages were later
made to work **without** a workspace: `workspace_id` is nullable there and an `owner_id` column
is the fallback. New work should still scope by `workspace_id`.

## Company accounts: roles, departments, invitations

Migration `20261014090000_company_foundations.sql`; client code in `src/lib/team.ts`,
`src/components/team/` (Settings → Team Members and Departments) and `AcceptInvitePage.tsx`.

- **Roles**: `owner` (the account holder, only `workspaces.owner_id`), `admin` (everything),
  `supervisor` (leads departments), `member` (experts/staff). `is_workspace_admin()` = owner or admin.
- **Departments**: `departments` (unique name per workspace, colour) and `department_members`
  (`is_lead` marks a department's supervisors; `is_department_lead(dept)`). Admins create, edit
  and delete departments and set leads; a lead can add and remove non-lead people in their own
  department. A trigger keeps memberships inside the department's workspace.
- **Directory**: RPC `workspace_directory(workspace)` returns members with names, avatars, title,
  department ids and lead department ids (emails only for admins), so the Team page handles
  hundreds of people in one call. Teammates can read each other's profiles.
- **Invitations**: bulk invite by pasted emails or CSV (`email, role, department, title`; synonyms
  accepted), inserted 100 at a time. Invitees read their invite through RPC `get_invitation(token)`
  and join through `accept_invitation(token)`, which checks the signed-in email, adds the member
  and their department (as lead when supervisor). The old public select of all invitations is gone.
- **Guards**: `wm_insert_self` lets someone add only themselves and only with a matching pending
  invitation (or as the owner / by an admin); trigger `workspace_members_guard` stops anyone but
  admins/owner from changing role, status or title, and keeps `owner` for the account holder.

## Company rooms (`src/lib/rooms.ts`, `RoomsPage.tsx`)

Migration `20261015090000_company_rooms.sql` (after company foundations).

- `company_rooms`: standing video rooms, optionally in a department, `open_to_department` lets
  the whole department use one. Admins and supervisors create them (supervisors only in
  departments they lead); experts can't. `company_room_assignees` says who may use a room.
- A link an expert makes in a room is a `meetings` row with `room_id` and `for_whom`; trigger
  `meetings_room_guard` only allows that for people who may use the room (`can_use_room`).
- Busy: the meeting page calls `room_heartbeat(meeting)` every 45 s during a room call
  (busy for 90 s) and `room_release` on leaving; busy columns can't be written directly.

## Spaces at 50 people

Movement, emotes and knocks go over the space call's LiveKit data channel once connected
(`SPACE_TOPIC`, sender identity checked), and over Supabase broadcast only while someone present
isn't in the call (`needsRealtime`). Supabase still carries presence. The office door
(`office.door`) lists the account's other spaces grouped by `space.config.department_id`.

## Conversations (`src/lib/chat.ts`, `ConversationsPage.tsx`)

Migration `20261016090000_conversations.sql`.

- `chat_channels` (channels and direct messages, `dm_key` = sorted user ids), `chat_members`
  (`last_read_at` for unread counts via `chat_unread`), `chat_messages` (`parent_id` = thread reply,
  `source` user/webhook/system), `chat_webhooks` (secret token per link). Created through the RPCs
  `create_channel` and `open_dm`. Live updates: `postgres_changes` on `chat_messages` (RLS applies).
- Edge Function `chat-webhook` (verify_jwt off; the token is the key): Zapier, Airtable, Modal or
  any app POSTs JSON/form/text to `/functions/v1/chat-webhook/<token>`; 30 posts a minute per link.
- Email replies: `send-email` stores the Gmail `threadId` (`messages.provider_thread_id`); its
  once-a-minute scheduler run also checks up to 40 recent threads (`reply_checked_at` order) and saves
  new replies as inbound `messages` on the same contact (`send-email/replies.ts`). Needs the
  `gmail.readonly` scope, so accounts connected before need reconnecting.

## Forms and surveys (`src/lib/form-engine.ts`, `FormBuilder`, `PublicFormPage`, `form-submit`)

People fill them in at **`/f/<id>`** (older links `/forms/<id>` still open), no account needed;
`FormPlayer` runs it and the builder's Preview uses the same player. **A form** is one long page
(or its pages in turn when it has several); **a survey** goes slide by slide (its pages, or one
question per slide when it has one page). Settings → Layout overrides either.

`form-engine.ts` holds the rules (unit-tested): **logic** (when all/any conditions match: show,
hide, require, set an answer, jump to a page, disqualify with a message or link, redirect after
submit), the **steps** and **checks**, **prefill** from the link (`?email=…`, or a field's own
key) and **where they came from** (utm tags, `?source=`, referrer), the **quiz** (points per
option and/or right answers, categories; the result by score range or the strongest category).
Forms don't take payments (a Payment field left in an older form is not shown or sent). Settings
also close it on a date or after N responses, remember people on their device, turn off autofill,
and catch bots with a hidden trap field.

`form-submit` (single file) re-checks on the server what matters: open or closed, and the quiz
score. The team alert and the auto-reply are queued as `messages` (with `form_submission_id`) and
sent by the `send-email` mailer from the form's chosen connected Gmail.
Submissions keep `meta`, `score*`, `quiz_result` and `disqualified`
(`20261021090000_forms_upgrade.sql`); the builder's Submissions tab lists and exports them.
The contact is attached just after the submission is saved, so `20261021120000_form_workflow_trigger.sql`
starts "Form submitted" workflows on that update too, and wakes the mailer for form emails. The
builder's Preview sends `preview: true` with the member's login: it works on drafts, never charges,
and is saved with source `preview`. Going live: `docs/FORMS_GO_LIVE.md`.

## Streams (`src/lib/streams.ts`, `StreamsPage`, `StreamStudioPage`, `WatchPage`)

Migration `20261017090000_streams.sql`. A stream is LiveKit room `stream_<id>`: the host sends,
viewers get watch-only tokens (`canPublish: false`) from `livekit-token` with `{ streamCode, watch }`,
and only while `status = 'live'` (425 before). The public watch page `/live/CODE?watch=<token>` reads
`stream_by_watch`; chat and reactions go over the data channel (`STREAM_TOPICS`).

## Tables by module

| Module | Tables |
| --- | --- |
| Workspace & team | `workspaces`, `workspace_members` (+ `title`), `profiles`, `team_invitations` (+ `title`, `department_id`), `departments`, `department_members` (`is_lead`), `workspace_settings` (per-category JSON settings), `audit_logs` |
| Contacts (CRM) | `contacts`, `tags`, `contact_tags`, `smart_lists`, `notes` |
| Calendars & booking | `calendars`, `calendar_hosts`, `calendar_groups`, `calendar_group_members`, `calendar_group_analytics`, `availability_rules`, `availability_overrides`, `host_availability_rules`, `external_busy_periods`, `booking_links`, `booking_locks`, `appointments`, `appointment_participants`, `notification_rules` |
| Forms | `forms`, `form_fields`, `form_field_conditions`, `form_submissions`, `form_notification_logs`, `form_activity_timeline` |
| Workflows | `workflows`, `workflow_nodes`, `workflow_edges`, `workflow_versions`, `workflow_enrollments`, `workflow_executions`, `workflow_execution_logs`, `workflow_goals`, `workflow_templates` |
| Meetings | `meetings` (owned by a workspace; join code like FOCU-358, optional nickname, instant/later/scheduled, ended_at) |
| Spaces (virtual offices) | `spaces` (owned by a workspace; slug unique across all tenants; also `access_mode`, `guest_link_token`, `permissions`, `persistence` + `schedule`, `branding`, `config.rooms`), `space_members` (per-person state in a space) |
| Messaging | `messages` (email/SMS log per contact), `email_accounts`, `email_account_secrets` (encrypted OAuth tokens, no client access) |
| Recordings | `recordings` |
| Characters | `characters`: the shared SYNAPSE character library (an uploaded .glb per row: clips, default clip, size; file in the `characters` bucket). Everyone signed in can read it; only `platform_admins` can change it |
| SYNAPSE admins | `platform_admins` (people who run SYNAPSE itself, not workspace owners; `is_platform_admin()`) |
| Integrations | `integrations`, `integration_sync_logs`, `webhooks` |

Child tables (`form_fields`, `workflow_nodes`, `calendar_hosts`, `availability_rules`, …) have no
`workspace_id`; their RLS goes through the parent row. Storage buckets: `avatars`,
`workspace-logos` (both public); `characters` (private, 30 MB per file, new files under
`library/`; everyone signed in can read, SYNAPSE admins upload and delete).

## Sidebar items

| Item | Route | State |
| --- | --- | --- |
| Dashboard | `/dashboard` | Real (reads workspace data) |
| Meetings | `/meetings` | Real: today's meetings, upcoming rooms, join by code/nickname, New (later / instant / scheduled with calendar links), Calls history; rooms at `/meetings/:code` (LiveKit: switch camera/mic/speaker mid-call incl. iPhone Continuity Camera, chat, reactions, raise hand, screen share with live annotation and laser pointer) |
| Workspaces | `/workspace` | Real: spaces grid and create wizard (`/workspace/new`, full screen); `/workspace/:slug` is the in-space screen (people, status, controls) with the walkable 3D floor; rooms and furniture wait for the art kit |
| Contacts | `/contacts` | Real: list, add, detail page with composer (email via Gmail) |
| Conversations | `/conversations` | Real: channels, direct messages, threads, activity, email replies, app posts |
| Events | `/events` | **Placeholder** (`ComingSoonPage`) |
| Webinars | `/webinars` | **Placeholder** (`ComingSoonPage`) |
| Calendars | `/calendars` | Real: calendars, groups, appointments, public booking pages |
| Submissions | `/forms` | Real: forms and surveys, builder, submissions |
| Workflows | `/workflows` | Real builder and storage; runs in the browser (`workflow-engine.ts`), triggered only by public-page bookings and cancellations |
| Recordings | `/recordings` | Real list/detail over `recordings`; nothing creates recordings yet |
| Characters | `/characters` | SYNAPSE admins only (hidden for everyone else): the shared character library for all accounts. Upload a 3D character (.glb, up to 30 MB), preview it in 3D, play each animation clip and save one as the default; choose the character everyone appears as in spaces and which clip plays for standing, walking, wave and cheer. Make Meshy files fit with `scripts/blender/optimize_meshy_glb.py` |
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

Your position comes from the 3D scene (below). Everyone is on the open floor for now (no zone),
because rooms don't exist on the floor until the art kit arrives. Note: proximity decides what the client subscribes to; it isn't a privacy boundary
(see the privacy note in docs/LIVEKIT.md).

## The 3D space (`src/components/spaces/scene/SpaceScene.tsx`)

What you see inside a space, until the art kit brings rooms and furniture:

- **Floor:** an open floor sized by team size (`spatial/scene/floor.ts`: 12×10 m for one person up
  to 44×34 m for 50+), from (0, 0) to (width, depth) in metres, the same units the network and
  proximity use. You appear near the middle.
- **Camera:** orthographic, looking down at about 35° from the +x/+z corner, following you.
  The world toolbar's centre and zoom buttons and the mouse wheel control it.
- **Walking:** click or tap the floor (A* route on a 1 m grid, smoothed, sent once as a `path`
  broadcast and walked by the clock on everyone's screen), or hold the arrow keys / WASD (move
  messages, rate-limited by `MoveSender`). **Walk to** in the people panel walks to about a metre
  from someone.
- **People:** everyone appears as the character they picked in **Choose your character** (the
  shirt button on the world toolbar; offered automatically on a first visit). The pick is saved in
  `profiles.avatar_config.characterId` and shared with others through presence (`characterId`).
  Without a pick (or if it was deleted) they appear as the library's default: the one a SYNAPSE
  admin chose with **Use in workspaces** on the Characters page, else the newest upload. Each
  character file downloads once, the first time someone in the space appears as it. It's scaled to 1.7 m and its clips
  are kept in place (root motion removed). Which clip plays for standing, walking, wave and cheer
  is chosen on the Characters page (`characters.space_clips`), guessed from clip names until then
  (`spatial/scene/avatarClips.ts`). Without a character, or if it can't load (for example if the
  library migration hasn't been run), people appear as simple coloured figures.
- **Labels and rings:** a name label over each head (status dot, ✋ for a raised hand, the latest
  reaction for 3 s), and a gold ring on the floor around each conversation group.
- **Graphics quality:** Low renders at 1× pixel ratio without antialiasing. Changing it rebuilds
  the scene but keeps your place and zoom.
- **Built offices:** a space can show a furnished office instead of the open floor
  (Workspace settings → **3D office**, saved as `spaces.config.scene`). Layouts live in
  `spatial/scene/offices.ts`: the GLB under `public/assets/spatial/offices/`, its floor size and the
  furniture and wall footprints. Walking uses a 25 cm grid with clearance around footprints
  (`walkMap` in `floor.ts`): taps on furniture walk to the nearest free spot, the arrow keys slide
  along walls, and you appear in a free spot. The GLB is merged by material when it loads (lights
  and cameras from Blender are ignored) and gets real shadows except on Low.
  **SYNAPSE Office 01** (20 × 16 m) was built in Blender (hosted 3D Jutsu project "SYNAPSE Office 01",
  revision 4): metres, Y up, origin at the floor's back corner, no textures, about 21k triangles.
  **SYNAPSE Office 02** (20 × 16 m, listed first) is the realistic one, from the same Blender project
  (revision 13, 1.8 MB): dark plinth with shrub planters, navy and gold accents. Its soft overhead
  light and contact shadows are baked
  into one floor texture: a top-down Cycles render of the floors with the furniture hidden from
  the camera but still casting shadows, saved as JPEG on the `BAKED_floor` mesh. In the app a
  `BAKED_*` mesh is drawn unlit as-is, `SRC_*` meshes (the unbaked floors kept for re-baking) are
  skipped, furniture stops casting live shadows (they are in the bake) and people cast theirs onto
  a see-through shadow layer, from the office's `sun` direction so both fall the same way.
  To re-bake after moving furniture, render the same orthographic view (centre x 10.075,
  z 8.075, 20.85 m wide, covering x −0.35..20.5, z −0.35..16.5) and replace the image, then update
  the footprints.
- **Sitting:** an office lists its `seats` (`spatial/scene/seats.ts`: position, facing, cushion
  height, chair / sofa / armchair). Tapping a seat (the tap's ray is followed down to cushion
  height, and the cursor becomes a hand over free seats) walks to the free side of it, behind a
  chair or in front of a sofa, then into it; the click-to-walk `path` is sent with
  `sitAtEnd: true` and the resting `move` has `anim: 'sit'` and the seat's facing. Receivers find
  the seat from the position (everyone has the same office), so nothing new goes over the network.
  A seat someone is in can't be taken. Arrow keys or a tap elsewhere stand you up. A character's
  "Sitting" clip plays only if one is chosen on the Characters page (never guessed from clip names:
  "sitting" clips are often on the floor). Otherwise the character sits from its natural standing
  pose: every bone back to the file's pose, thighs aimed forward along the cushion, shins down,
  upper arms down and forearms forward onto the lap, then the hips lowered onto the cushion.
  Simple figures sink into the seat.
- **Inside a space** the world is the whole screen: no sidebar or top bar (Leave goes back), and
  the people panel opens over the world from the People button. Office 02 stands in a park
  (lawn, stone paths, trees, lamp posts, benches; its light and tree shadows baked into
  `BAKED_ground`, which keeps its own height, unlike `BAKED_floor`) that runs past every edge of the
  screen, never an empty sky; zooming out stops at 0.6 so the park always fills the view, the camera stays over the office, labels show first
  names (yours too), and on High quality ambient occlusion (`GTAOPass`) adds soft contact shadows.
- **SYNAPSE Campus** (`campus-01`, listed first in Workspace settings → 3D office): one large
  workspace (120 × 96 m) with many places in it, so walking through a door never leaves the
  workspace. `spatial/scene/campus/layout.ts` is pure data: Office 02 as the headquarters, an
  all-hands hall with a stage, a café and lounge, four team areas named after the account's
  departments (`team.ts` → `loadDepartments`), four glass meeting rooms, focus booths, a game room,
  a library, a garden with a pond and a central plaza, joined by avenues. Each named area is a
  `Zone`: its type feeds proximity like a room (meeting rooms and booths are closed, the stage
  carries, quiet zones are quiet) and the location pill shows where you are. Furniture comes from
  `campus/kit.ts`: pieces cut out of `office-02.glb` by node name (pivot, facing, footprints,
  seats) plus pieces drawn in code (trees, benches, fountains, rugs, stage…). The renderer
  (`components/spaces/scene/campusWorld.ts`) draws one `InstancedMesh` per part per kind, canvas
  textures for the lawn, pavers and floors, glass or solid walls with door gaps, and a sign per
  area that faces the camera; the sun's shadow box follows the view. Walking uses a 50 cm grid.
- **SYNAPSE Hub** (`hub-01`, first in the 3D office list): you arrive in a walled garden courtyard
  with doorways all round it; each doorway opens into its own place (`campus/hub.ts`): an
  auditorium (stage, LED wall, about 600 seats), a conference center (four glass meeting rooms), a
  work studio (desk pods, focus booths), a café and bar, a lounge and library, and a garden
  terrace. The places are wings of one layout, 25 m+ apart in the same coordinates (so walking,
  the network and proximity work unchanged). `createWorld` (`campusWorld.ts`) draws each wing on
  its own and shows only the one you're in; people elsewhere are hidden. A `Portal` is a doorway:
  stepping into its rect moves you to its `to` point (with a short fade), and others see you jump
  rather than slide (`RemoteMover` treats moves over `JUMP_M` = 8 m as a jump).
- **Realism** (Campus and Hub): golden late-afternoon sun (ACES tone mapping), bloom on Medium
  and High so lamps, screens, fires and string lights glow (lights use HDR colours on unlit
  materials). Pieces drawn in code live in `scene/kitParts.ts`: trees are a trunk and branches
  under a crown of leaf clusters with noise-displaced, faceted surfaces and vertex-coloured shade
  (two draws per kind), plus palms, flowering bushes, dense flower beds, reeds, lilies, pergolas,
  gazebos, umbrella tables, fire pits, theatre seats, sofas and chairs in several colours, bar,
  bookcases, booths, conference tables. Lawns get thousands of instanced grass tufts (not on Low),
  ponds a stone edge and rippling, reflective water, walls a wooden cap and warm sconces, paths
  warm sandstone pavers and winding flagstone walks (`Walk`, `plazas` in the layout).
- **Characters** (`scene/posture.ts`, after the clips each frame): shoulders are kept level and
  arms within a natural range of hanging down; a character with no standing clip stands with arms
  down instead of its file's T or A pose. A feminine walk style (Characters page → Walk style,
  saved in `characters.space_clips.style`, guessed from names like "Woman") narrows the steps, sways
  the hips with the chest turning against them and softens the arms. Adjustments are undone on
  bones no clip animates, so they never pile up.
- **Moving** (`floor.ts` speeds): walk 3.4 m/s, run 6.4 m/s (hold Shift, or Run as the default
  in the Action menu on the call bar), dance (Ctrl+Z, or Action → Dance). Run and dance clips are
  guessed from clip names or chosen on the Characters page; without them a faster walk, the cheer
  on a loop, or a bounce stands in. A route (`PathMsg`) carries its `gait`, so others see you
  walk, run, drive or ride.
- **Prop models** (`public/assets/spatial/props/<id>.glb`, sizes in `campus/props.ts`): 75 models
  made in Meshy, compressed (meshopt, WebP textures) and baked to real size, facing +z, standing
  on y = 0. A kit item with `model` is drawn from them (`propModels.ts` loads each file once per
  page; `campusWorld.ts` swaps the code-drawn piece for the model when it arrives). Sofas, lounge
  chairs, benches, lamp posts, bar stools, plants and the reception desk use them; the catalog
  also has desks with screens and chairs, office and dining chairs, loveseats, plants and lamps.
- **Cars and bikes** (kit `car_*`, `bike_*`, `moto_*`, `kick_scooter`: 17 cars at 0.88 of life
  size and motorbikes and scooters at 0.9, to sit right with the characters) stand in car parks
  and bike parks in the Hub courtyard and on the Campus. Click one on foot: you walk to it and
  get in. Then click where to go, or use the arrow keys, at 10 m/s (car) or 7 m/s (bike); E or
  "Get out" leaves it, and clicking a seat gets you out first. Presence carries which parked one
  you took (`vehicle`), so everyone draws that car under you and leaves its bay empty while you're
  out. A driver isn't drawn (their name shows over the roof); a rider sits on the saddle. Head
  and tail lights sit on each body where rays cast at the model meet it: dim when parked, lit
  with a pool of light on the road when driven.
- **The flying car** (`car_flying`) flies: straight to where you click, over everything, at
  11 m/s and 6 m up (gait and anim `fly`), and lands on clear ground. Small flames burn under
  its wheels and glow on the ground below while it's in the air.
- **Planes** (`plane_airliner`, `plane_jet`) stand by the terminal. Board one and click where to
  go: it taxis to the end of the runway, takes off and flies there at 15 m up, then circles until
  sent on. "Get out" (or E) brings it in over the runway, lands it and taxis it back to its stand.
  Each stretch is sent as a route (`fly`, or `drive` on the ground), so others see the same flight.
- **The airport** (Campus, south of the boulevard): the terminal with a plane stand on each side,
  car parks and bike parks along the road, a forecourt, a taxiway and a runway (`layout.airport`).
- **Built offices refurnished** (`refurnish.ts`): Office 01, Office 02 and the Campus HQ keep
  their walls, floors, shelves and planters, but their chairs, desks and screens, tables, sofa,
  armchairs, lamps and potted plants are swapped for the prop models in the same places. Kit
  pieces taken from the office file have `model` too, so the Campus and Hub use the models as well.
- **Riding pose:** on a motorbike or scooter the character leans over the tank with hands on the
  grips and feet back (`poseRiding`). People aren't drawn larger when zoomed out in the Campus or
  Hub, so they stay in proportion with the cars and bikes.
- **Your video in a workspace:** your camera in the bottom-left corner; its corner button opens the
  meeting view (you and everyone you're talking to, laid out like a SYNAPSE meeting).
- **Glow:** only lights glow. Their materials are marked `glowing()` (`kitParts.ts`) and drawn on
  `GLOW_LAYER`; SpaceScene blooms that layer on its own and adds it over the scene, so white
  clothes, keyboards or leaves in the sun stay ordinary lit surfaces.
- **Real surfaces** (`realSurfaces.ts`): grass, paving, brick paths, wood, parquet, marble, slate,
  terrazzo and asphalt are Poly Haven photos (CC0, 512 px, ~800 KB in all, in
  `public/assets/spatial/textures`). They load after the world appears; until then, or if one
  fails, the drawn texture stays.
- **Looking around:** hold and drag on the floor to slide the view (it eases back to you when you
  move; the locate button recentres it).
- **Getting everywhere:** pieces turned at an angle block their real shape (cut into short boxes),
  round ones a circle, so you can walk past the front of the benches round a fountain. Tests check
  that no open floor in the Campus or any Hub place is unreachable and that you can walk right
  round each fountain (`campus/reach.ts`).
- **Views:** from above (default, about 50° down) or angled from the corner, switched in the
  right toolbar and remembered on the device (`spatial/view.ts`).
- **Build mode** (campus, people who can edit the office): the hammer in the right toolbar opens
  the catalog. Pick a piece and click the floor (a gold preview where it fits, red where a wall,
  water or furniture is in the way; R turns it), or click a piece to turn, move or remove it.
  Changes are saved in `spaces.config.campus` as `{ added, removed }` (`campus/office.ts`:
  `readEdits` checks ids, kinds and bounds; a layout piece that's moved or turned becomes an added
  copy and its id goes in `removed`). The change shows at once, each save starts from the latest
  saved layout so two builders don't undo each other, and a `layout` message on the space channel
  tells everyone else to reload it. No database change was needed (`config` is jsonb).

## Layout: every feature full screen

SYNAPSE opens on the dashboard with the menu (`Sidebar`) on the left and the top bar; there is no
dock. Opening any feature (or loading straight into one) tucks the menu away: the feature fills the
screen with every feature as small icons in a dock along the bottom (`FeatureDock`, sections in
`layout/nav.ts`). Clicking another icon opens that feature full screen; only the dock's arrow
brings the menu back. Only one feature shows at a time: a workspace you step out of stays
connected but hidden (mic, camera and sharing off), and its dock icon gets a green dot and takes
you back. Inside a workspace the world fills the screen above the dock (a navy strip). Full-screen
editors use `--nav-w`, fill-the-screen pages `--top-h` and `--dock-h` (set by `App.tsx`).

**Conversations** keeps Slack's features but writes every action out, so nothing has to be found.
The layout follows a calm, Apple-finished version of Slack's flow, in three columns that each do
one job. The **rail** on the far left (SYNAPSE logo, Home · DMs · Activity · Files, counts on the
icons) picks what the **list** beside it shows: Home lists the company name, Threads, Email replies,
Starred, Channels and People; DMs lists every direct message with its last line; Activity lists
mentions and replies (All / Mentions / Replies); Files lists every link shared. Whatever you pick
opens in the **white card** on the right; an Activity or Files item opens its message in place,
lit up. Messages are flat rows; pointing at one shows a small bar (Reply, Edit, Delete); Reply
splits the card, with the replies beside the channel; the header's At a glance button opens
members, threads and links on the right (remembered per browser). Counts are quiet grey, gold only
when someone mentioned you.
Your photo at the bottom of the rail opens **You**: your status (one-click presets like "In a
meeting · 1 hour", or your own words and emoji, clearing itself on time), Set yourself as away /
active, Profile, Notifications, Settings and Sign out. Statuses live in `member_status`
(`20261018090000_member_status.sql`) and show next to names (DM list, People, message authors, At
a glance, the DM header with "Active now"). Who is online is worked out live with Realtime
presence (`src/lib/presence.ts`), nothing stored. Replying in a thread can also post the reply in
the channel ("Also send to # name"), quoting the message it answers.
One navy list on the left holds everything: search, **Activity** (with its count), **Channels**
("+ New channel", starred and private marked, unread counts, "Browse all channels"), **People**
(direct messages with each one's last message, "+ Message someone") and **From outside** (email
replies). Inside a conversation:
- a row of labelled actions: members, "+ Add people", "Search in this channel", "Channel settings"
  (connect an app such as Zapier or Airtable, leave);
- tabs **Channels · Messages · Threads · Files & links**. Channels lists your channels as cards and
  the public ones you can join ("Have a look" or "Join"); Threads lists the channel's threads;
  Files & links collects the links shared there;
- "Reply to this message" under every message (or "N replies · Open replies"). It splits the screen:
  the replies open beside the channel, titled "Replies to Ama's message", and the message being
  answered is highlighted;
- hover actions written out (Reply, Edit, Delete, with a confirm), and a composer with the
  formatting bar, "Emoji" and "Mention" buttons, @here/@channel, and the keys explained.

Activity lists @mentions of you (and @here/@channel) and replies to your threads, from `listRecent`,
and each can be answered in place. Stars are kept on the device.

## Checks

`npm run typecheck`, `npm run lint`, `npm run build`, `npx vitest run`.
