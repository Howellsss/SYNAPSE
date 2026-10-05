# Audio & video (LiveKit)

**Meetings** (`/meetings/<code>`) use LiveKit too: the function accepts `{ meetingCode }` instead of
`{ spaceId }`, checks the caller is an active member of the meeting's account, refuses ended
meetings (410), and issues a token for room `meeting_<meetingId>`. Meetings subscribe to everyone
automatically. See [Meetings](#meetings) below for what's in the room.

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

## Meetings

The room looks and works like Zoom:

| | |
| --- | --- |
| **Before joining** | Your camera preview with **Audio** / **Video** toggles, a **Microphone** and a **Camera** list, and **Start** (host) or **Join**. Audio starts off if "join muted" is on in your camera & mic settings; video starts on so you can check yourself. What you pick is what you join with. |
| **Top right** | Shield (audio, video and chat are encrypted in transit by WebRTC; not end-to-end), time in the meeting, the annotate pen while someone shares, and Speaker / Gallery view. |
| **Audio ^ / Video ^** | Click the icon to mute/unmute or start/stop video (⌘/Ctrl+Shift+A and V still work). The caret lists every microphone, speaker (Chrome/Edge) and camera with a tick on the one in use; picking one switches it live (`room.switchActiveDevice`) and remembers it. "Audio/Video settings…" opens the full camera & mic check. |
| **Participants** | Everyone, with host, mic, camera and raised hands; copy the invite link. |
| **Chat** | Everyone in the meeting, sent over the data channel (`synapse.chat`). Not saved: it's gone when the meeting ends. Unread count on the button. |
| **React** | 👏 👍 ❤️ 😂 😮 🎉 show on your tile for 4 seconds; **Raise hand** stays until lowered (people who join later see it). |
| **Share** | Share a screen, window or tab (not on phones: mobile browsers can't). |
| **Annotate** | While anyone shares, everyone can draw on the shared screen: pen, highlighter, text, eraser, spotlight (laser pointer with your name), colours, undo, clear mine / clear all (presenter and host). The presenter can switch **Others can draw** off. People who join late get the drawings so far from the presenter. |
| **More** | Meeting info, copy invite link, settings. On phones, reactions and raise hand are here too. |
| **End** | Everyone: **Leave meeting**. Host: also **End meeting for all** (sets `meetings.ended_at` and tells everyone; only a message from the host is obeyed). |

### Using an iPhone as the camera (Mac)

macOS Continuity Camera makes an iPhone a normal camera for every app, including the browser. It
shows up in **Video ^** and the pre-join **Camera** list as e.g. "Howells's iPhone Camera". It needs
macOS Ventura (13) or later and iOS 16 or later, the same Apple ID on both, Wi-Fi and Bluetooth on,
and the phone nearby, locked, in landscape and still (a mount helps). The list refreshes itself every few
seconds and whenever you come back to the window.

If the **iPhone microphone** is listed but not the camera, macOS is offering only the mic: SYNAPSE
says so in the pre-join screen and the Video menu, with the fixes (turn on Continuity Camera on the
iPhone under Settings → General → AirPlay & Continuity; lock it and stand it still in landscape,
or plug it in by USB; check FaceTime's Video menu; quit and reopen the browser) and a **Look
again** button. On Windows, apps like
Camo or Iriun do the same over USB/Wi-Fi.

### Annotation vs. remote control

Annotations are drawn on top of the shared video in each person's browser, positioned in
fractions of the frame so they line up at any window size. They are **not** drawn on the
presenter's actual desktop, and nobody can move the presenter's mouse or type on their computer:
browsers don't allow a web page to control the operating system (Zoom's remote control needs
its desktop app). Annotation plus the spotlight pointer covers "show me where to click"; actually
taking control would need a desktop helper app.

### Data channel messages

All on LiveKit's data channel with a topic; the sender is the LiveKit identity set by the server,
never a field in the message. Every message is validated (`src/meetings/annotations.ts`,
`src/meetings/messages.ts`) and size-limited.

| Topic | Messages |
| --- | --- |
| `synapse.annotate` | `begin` / `pts` (strokes), `text`, `erase`, `clear`, `laser` (lossy), `perm`, `sync-req`, `sync` (chunked under ~12 KB) |
| `synapse.chat` | `msg` (≤ 1000 characters) |
| `synapse.react` | `emoji`, `hand` |
| `synapse.control` | `ended` (host only) |

Recording isn't built: it would need LiveKit Egress (a paid server-side recorder) and storage.

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
- For meetings it also covers the pre-join pickers, switching to an iPhone camera mid-call, chat,
  reactions and raised hands, layouts, End for all (host only), and annotation sync between people
  (late joiners, permissions, who may erase what).
- `src/meetings/*.test.ts` — message validation and the annotation rules.
