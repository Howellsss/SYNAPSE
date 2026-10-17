# Caching

SYNAPSE is a React + Vite app on Vercel that talks to Supabase straight from the browser, with
row-level security (RLS) deciding what each person may read. There's no SYNAPSE server in between,
so the cache lives where the reads happen: in the browser, in memory.

## What's cached, and for how long

| Page | Reads | Fresh for | Key |
|---|---|---|---|
| Dashboard | appointments, contacts, members, messages, spaces, activity | 30 s | `dashboard / <day>` |
| Contacts | contacts (+ tags), counts | 30 s | `contacts / page / search / tag / smart list / rules` |
| Calendars | calendars, appointments | 30 s | `calendar-view` |
| Workspaces | spaces, members, member profiles | 60 s | `spaces` |
| Forms | forms, submission counts, usages | 60 s | `forms` |
| Workspace characters | character list + file links | 10 min | `characterLibrary()` (lib/characters.ts) |

- **Fresh:** the page shows the cached answer at once, with no request.
- **Older:** the cached answer shows at once, and a fresh one replaces it as soon as it arrives.
- **First visit:** fetched and kept.

## Never cached

These are never cached:
- logins and tokens
- LiveKit call tokens
- guest and invite links
- waiting-room admissions
- booking slots and locks
- ticket availability
- email account connections

They're read fresh every time, as before.

## How it's kept safe

- **Keys** are `v1 / user:<id> / ws:<id> / <entity> / ...` (`lib/cache/keys.ts`). The user and
  workspace come from the verified session (AuthContext), never from a page, link or form. Data
  for one person or workspace can't be served to another, and the tests check this.
- **Memory only:** nothing goes to localStorage or IndexedDB, because contact lists hold personal data.
- **Cleared** when someone signs out, someone else signs in, or the workspace changes (`App.tsx`).
- **RLS still decides** what's read: the cache only keeps what the person was already allowed to
  see, under their own key. No service-role key is used anywhere in the browser.
- **Debug logs** show the entity only, never ids or data.

## Keeping it current (invalidation)

- **Writes made in SYNAPSE:** every request to Supabase goes through the client's `fetch`
  (`lib/supabase.ts`). When a write to a table lands (POST, PATCH, PUT or DELETE on
  `/rest/v1/<table>`), everything tagged `table:<table>` is marked out of date and refreshes on
  its next read. An RPC that may write refreshes everything; read-only RPCs are listed in
  `lib/cache/writes.ts`. This catches every write in the app without each page remembering to.
- **Writes from outside** (bookings, form submissions, workflow runs, chat webhooks, the
  dashboard): the short fresh times above bound how long anything can be old. Realtime isn't used
  for this, to stay within the free plan's Realtime quota.
- **Drop everything:** bump `CACHE_VERSION` in `lib/cache/keys.ts`.

## Using it in a page

```ts
import { withCache, tableTag, ttlMs } from '@/lib/cache';

const rows = await withCache(
  { scope: { userId: user.id, workspaceId: workspace.id }, key: ['forms'], ttl: ttlMs('FORMS'), tags: [tableTag('forms')] },
  async () => { const { data, error } = await supabase.from('forms').select('*'); if (error) throw new Error(error.message); return data; },
  (cached) => setForms(cached), // optional: show older data at once while refreshing
);
```

The fetcher must **throw** on a Supabase error. A thrown error is never cached, and it reaches the
page, which shows its usual error state.

## Settings (`.env.example`)

| Variable | Default | What it does |
|---|---|---|
| `VITE_CACHE` | `on` | `off` sends every read to Supabase (the app works the same) |
| `VITE_CACHE_DEBUG` | `off` | `on` logs HIT / MISS / STALE / ERROR in the console; counts are in `cacheStats` |
| `VITE_CACHE_TTL_<NAME>` | see table | seconds fresh: DASHBOARD, CONTACTS, CALENDARS, SPACES, FORMS |

There's no shared cache server (Redis) to go down: the cache is in each browser tab. If the cache
is off, or a read fails, the page reads Supabase directly, as before.

## Files and CDN

- `vercel.json`: built scripts and styles (`/assets/*.js|css`, named by content) are cached for
  a year; 3D offices, textures and pictures (`/assets/spatial/*`) for a day, refreshed in the
  background; the page itself (`index.html`) is always checked, so a release shows at once.
- **Uploads** (avatars, logos, contact photos, group pages, space and event covers) are stored
  with a one-year cache (`UPLOAD_CACHE`). Each gets a new name, or a `?t=` version for avatars and
  logos, so a new picture shows straight away.
- **Character files** are kept on the device by path and size (`spatial/scene/characterCache.ts`),
  because their signed links change on every visit.

## Tests

`src/lib/cache/cache.test.ts` checks:
- keys
- hits, misses, stale reads and errors
- one shared request for concurrent reads
- that one user never gets another's data, and workspaces stay apart
- refreshing after create, update and delete
- clearing
- the cache switched off

## Follow-ups

1. Other reads (contact record, workflows, settings, team, events) still go straight to Supabase.
   Move them to `withCache` the same way when they matter.
2. The dashboard's six separate requests could become one database function.
