# Testing multiplayer with 2–3 browser profiles

Realtime features (who's here, status, waves, reactions, raised hands, online counts) only show up
with more than one person. You can test alone with two or three **separate browser profiles**, each
signed in as a different SYNAPSE user in the same account.

## 1. Set up the people

1. Sign in as yourself (an owner or admin).
2. **Settings → Team → Invite** two test addresses you can receive mail for (for example
   `you+ama@gmail.com` and `you+kenji@gmail.com` — Gmail delivers `+anything` to your inbox).
3. Open each invite link in its own profile (below) and finish signing up. Give each a different
   first name so you can tell them apart.

## 2. Open separate profiles

Each profile has its own login, so the same computer can be three people.

| Browser | How |
| --- | --- |
| Chrome / Edge | Profile icon (top right) → **Add** → "Continue without an account". Open SYNAPSE in each profile's window. |
| Firefox | Go to `about:profiles` → **Create a new profile** → **Launch profile in new browser**. |
| Mixed | Use Chrome for one person, Firefox for another, Safari for a third. |

A private/incognito window also works for one extra person (it forgets the login when closed).

Put the windows side by side. Phones work too: sign in as one of the test users on your phone.

## 3. What to check

Do these in **Workspaces → (a workspace) → Enter**, with everyone in the same workspace.

| Step | Expected |
| --- | --- |
| Person A enters, then B enters | Both see each other in **Around the office**. "Main Floor · N online" goes up for both within a second or two. |
| Look at the Workspaces grid in C's window while A and B are inside | The card shows **2 online** (C isn't counted until they enter). |
| A changes status to **Focus** | B sees A's dot and label change to Focus almost immediately. |
| A clicks B in the people panel → **Wave** | B gets a toast "A waved at you 👋". A sees "You waved at B". C sees nothing. |
| A opens **Reactions** → 🎉 | Everyone sees "A 🎉" float over the office for a few seconds. |
| A presses **Raise hand** | B and C get a toast and see a ✋ next to A in the panel. Lower hand removes it. |
| A switches to another tab for 5+ minutes (or leaves the mouse alone) | B sees A as **Away**. When A comes back and moves the mouse, Away goes. |
| B clicks **Leave** | B disappears from A's and C's lists within a few seconds; the online count drops. |
| B opens the workspace in two tabs | B is listed once. |
| A turns Wi-Fi off for ~10 s, then on | A sees "You're offline…" then **Reconnecting…**, then the banner disappears and A is back in B's list. |
| Close A's window without pressing Leave | A drops out of B's list within a few seconds. If A's computer lost its connection instead (Wi-Fi off and window left open), it can take up to about a minute. |

**Moving around** (each person needs to have entered; upload a character on the Characters page
first, or everyone appears as a simple figure):

| Step | Expected |
| --- | --- |
| A clicks a spot on the floor | A walks there. B sees A walk the same route at the same pace and stop in the same place. |
| A holds W or the arrow keys | A walks; B sees A move smoothly a moment later. |
| A walks next to B (within about 4 squares) | A gold ring appears around them on both screens, and their audio/video connects. Walking away (more than 5 squares) ends it. |
| B clicks A in the people panel → **Walk to** | B walks to just beside A. |
| A sends 🎉 or 👋 | Everyone sees the emoji over A's head, and A's character plays the Cheer or Wave clip if one is chosen. |
| A raises their hand | ✋ appears in A's name label for everyone. |

"Follow" still shows as **Soon** in the people panel.

## 4. If something doesn't show up

- **No one else appears:** check both people are in the **same** workspace (same URL), and that
  both windows show **Connected** at the bottom left.
- **Stays on "Connecting…":** check Realtime is enabled for the project in the Supabase dashboard.
  Ad blockers or strict company networks sometimes block websockets; try another network.
- **Grid count stays 0:** reload the Workspaces page; counts come from live presence, not the
  database.
- **Watch the traffic:** the Supabase dashboard's Realtime inspector can join channel
  `space:<space id>` and show presence and broadcast messages as they happen. The space id is in
  the `spaces` table. In the browser, DevTools → Network → WS → the `realtime` connection →
  Messages shows the same traffic for that window.

## Automated checks

The browser test suite fakes the Realtime server (so it runs without a second person) and covers
presence lists, statuses, waves, reactions, raised hands, ignored spoofed messages, reconnecting,
away after 5 idle minutes and the grid's online counts. Unit tests in `src/spatial/net/net.test.ts`
cover the send rate, heartbeat, path broadcasting, interpolation and message validation.
