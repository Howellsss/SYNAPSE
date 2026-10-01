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
    spaces/              Space preview tile and settings drawer; wizard/ holds the create-workspace
                         steps and state (branching by type); config/ holds the Rooms, Access,
                         Availability and Branding editors shared by the wizard and the drawer
  types/index.ts         Shared TypeScript types mirroring the database tables
  spatial/               Spatial workspace data: slug rules, links, schedule (open hours), access
                         (permissions, guest tokens), layoutFile (.synapse-space.json import/export),
                         data/ (types, sizing, templates, rooms, branding)
supabase/
  migrations/            Schema history (run in order); supabase-setup.sql is the combined file
  functions/             Edge Functions: form-submit, gmail-oauth, send-email
  config.toml            Per-function JWT settings
scripts/build-supabase-setup.sh   Regenerates supabase-setup.sql from the migrations
docs/                    This file, GMAIL_SETUP.md
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
   `/workspace/:slug` → `SpacePage`, `/workspace` → `WorkspacesPage`,
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
| Workspaces | `/workspace` | Real: spaces grid and create wizard (`/workspace/new`, full screen); `/workspace/:slug` is a placeholder until the 3D office exists |
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

## Checks

`npm run typecheck`, `npm run lint`, `npm run build`, `npx vitest run`.
