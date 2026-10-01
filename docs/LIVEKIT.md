# Audio & video (LiveKit)

Inside a workspace, people talk over **LiveKit** (WebRTC). Each space has one LiveKit room,
`space_<spaceId>`. Who you actually hear and see is decided by proximity (see "Proximity
conversations" in docs/ARCHITECTURE.md): you subscribe only to people in range.

```
Browser                         Supabase                           LiveKit Cloud
──────                          ────────                           ─────────────
useLiveKitRoom(spaceId) ──POST { spaceId } + JWT──▶ livekit-token
                                  checks: signed in, active member
                                  of the tenant that owns the space
                        ◀── { token, url } ──────────
Room.connect(url, token) ───────────────────────────────────────────▶ room space_<spaceId>
```

## Set it up (once)

### 1. Create a LiveKit project

1. Sign up at **https://cloud.livekit.io** and create a project (any name, e.g. "SYNAPSE").
2. **Settings → Keys → Create key**. You get three values:
   - **WebSocket URL**, like `wss://synapse-abc123.livekit.cloud`
   - **API key**, like `APIxxxxxxxx`
   - **API secret** (shown once — keep it somewhere safe)

Self-hosting LiveKit also works; use your server's `wss://` URL and keys.

### 2. Add the secrets to Supabase

Never paste these into chat, code or GitHub. Either:

- **Dashboard:** your project → **Edge Functions → Secrets** (or **Project Settings → Edge
  Functions**) → add `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- **CLI:**
  ```sh
  supabase secrets set LIVEKIT_URL=wss://your-project.livekit.cloud LIVEKIT_API_KEY=APIxxxx LIVEKIT_API_SECRET=xxxx
  ```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions
automatically.

### 3. Deploy the function

From the repository root, with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```sh
supabase login
supabase link --project-ref parmtumfpsdtdtgwvscq   # once per machine
supabase functions deploy livekit-token
```

`supabase/config.toml` sets `verify_jwt = false` for this function: it checks the caller's login
itself (`auth.getUser`), the same as `send-email`, because the gateway's legacy check can reject
valid logins signed with Supabase's newer keys. If your CLI ignores config.toml, add
`--no-verify-jwt`.

### 4. Check it

1. Open a workspace in SYNAPSE. The pill at the top left should show **Connected** with signal
   bars and **Excellent/Good**, not "Audio & video off".
2. Click the microphone. It should turn white (on); your browser asks for permission the first time.
3. In LiveKit Cloud → **Sessions**, you'll see room `space_<id>` with you in it.

Or from a terminal (replace the JWT with a signed-in user's access token and a real space id):

```sh
curl -X POST "https://parmtumfpsdtdtgwvscq.supabase.co/functions/v1/livekit-token" \
  -H "Authorization: Bearer <user access token>" -H "apikey: <anon key>" \
  -H "Content-Type: application/json" -d '{"spaceId":"<space uuid>"}'
# -> {"token":"eyJ…","url":"wss://…"}
```

## How it behaves

| | |
| --- | --- |
| **Token** | `POST { spaceId }` with the user's JWT. Only **active** members (`workspace_members.status = 'active'`) of the tenant that owns the space get one; everyone else gets the same 403, so space ids can't be probed. Identity = user id, name = profile name (or the email's first part), grants `roomJoin`, `canPublish`, `canSubscribe`, `canPublishData`, valid **6 hours** (LiveKit refreshes it for connected participants). |
| **Joining** | `adaptiveStream` and `dynacast` on; `autoSubscribe: false`. Mic and camera start as set in **Check your camera & mic** (`profiles.media_prefs`: join muted / camera off). Data saver uses a 320×180 camera instead of 960×540. Saved devices (camera, mic, speakers) are used. |
| **Controls** | Mic and camera buttons show the real state and turn **red when off**. **Ctrl+Shift+A** (⌘+Shift+A on Mac) toggles the mic, **Ctrl+Shift+V** (⌘+Shift+V) the camera; ignored while typing in a text box. Screen share is in the bar (and under More on phones). |
| **Connection pill** | Top left: the space connection, then audio/video quality (Excellent / Good / Poor / Lost) with signal bars. |
| **Device unplugged** | Switches to the default device and says so ("Your microphone was disconnected. Switched to MacBook Microphone"). |
| **Permission taken away** | The mic/camera turns off and a card explains how to allow it again in this browser (or in macOS/Windows privacy settings), with a link to the camera & mic check. |
| **Network drop** | "Reconnecting audio & video…" while LiveKit recovers. If the connection is lost for good it retries after 2, 5 and 10 seconds, then shows **Try again**. |
| **Same person, second tab** | LiveKit allows one connection per identity, so the newer tab takes over and the older one says "You joined from another tab or device". |
| **Not set up / no access** | A card says "Audio and video aren't set up for this SYNAPSE yet" (function missing or secrets missing) or "You don't have access…". Everything else in the space keeps working. |
| **Leaving** | Leave (or closing the page) disconnects, which stops the camera and mic. |

The `livekit-client` library (~150 KB gzipped) is loaded only when someone enters a workspace.

## Privacy note for proximity

`autoSubscribe: false` controls **bandwidth and UX, not privacy**. Every token can subscribe to
every track in `space_<spaceId>`, so a modified client could listen to the whole space. For rooms
that must be private (locked meeting rooms, coaching sessions), use one of:

- a separate LiveKit room per private zone, with tokens issued only to people allowed in, or
- track-level permissions (`setTrackSubscriptionPermissions`) set by the publisher, or
- a server that updates subscription permissions (LiveKit server API) when people enter/leave zones.

## Costs

LiveKit Cloud bills by connection minutes and bandwidth, with a free tier. Check
https://livekit.io/pricing for current numbers. Adaptive stream, dynacast, no auto-subscribe and
the data-saver option all keep bandwidth down.

## Troubleshooting

| What you see | Likely cause | Fix |
| --- | --- | --- |
| "Audio and video aren't set up for this SYNAPSE yet." | Function not deployed, or a `LIVEKIT_*` secret missing | Steps 2–3 above |
| "Please sign in again to use audio and video." | Expired login | Sign out and in |
| "You don't have access to audio and video in this workspace." | Not an active member of the account that owns the space | Settings → Team: check their status |
| "Couldn't connect audio and video." then retries | LiveKit URL wrong, or websockets blocked by a network/VPN | Check `LIVEKIT_URL` starts with `wss://`; try another network |
| Mic button turns red right after clicking | Browser or OS blocked the microphone | Follow the card's steps, then **Check camera & mic** |
| ⌘+Shift+A opens tab search on Chrome (Mac) | Chrome reserves that shortcut on some versions | Use the button, or Ctrl+Shift+A |

## Tests

- `supabase/functions/livekit-token/handler.test.ts` — who gets a token (runs with `npm test`).
- The function was also run under Deno against a stand-in Supabase API, with the issued tokens
  verified using `livekit-server-sdk` (identity, name, room, grants, 6-hour expiry, CORS).
- The browser suite swaps `livekit-client` for a scriptable fake and covers joining per media
  prefs, toggles and shortcuts, screen share, quality, unplugged devices, permission loss,
  reconnecting, automatic retries, duplicate tabs and the "not set up" states.
