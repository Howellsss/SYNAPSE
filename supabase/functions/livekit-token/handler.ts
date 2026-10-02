// Logic for the livekit-token function, kept free of Deno/npm imports so it can be unit-tested.
// index.ts wires it to Supabase and livekit-server-sdk.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export const TOKEN_TTL = "6h";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TokenGrant {
  room: string;
  identity: string;
  name: string;
  ttl: string;
}

export interface Deps {
  /** The signed-in user for this JWT, or null. */
  getUser(jwt: string): Promise<{ id: string; email?: string | null } | null>;
  /** The space's owning tenant (workspaces.id), or null if there's no such space. */
  getSpaceWorkspace(spaceId: string): Promise<string | null>;
  /** A meeting's id and owning tenant by code, or null. Ended meetings return ended: true. */
  getMeeting(code: string): Promise<{ id: string; workspaceId: string; ended: boolean } | null>;
  /** The caller's membership status in that tenant, or null if not a member. */
  getMembershipStatus(workspaceId: string, userId: string): Promise<string | null>;
  getProfileName(userId: string): Promise<{ first_name: string | null; last_name: string | null } | null>;
  /** Signs a LiveKit access token. */
  makeToken(grant: TokenGrant): Promise<string>;
  /** LiveKit server URL (wss://…). */
  livekitUrl: string | undefined;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function roomName(spaceId: string): string {
  return `space_${spaceId}`;
}

export function meetingRoomName(meetingId: string): string {
  return `meeting_${meetingId}`;
}

const CODE_RE = /^[A-Z]{4}-[0-9]{3}$/;

export function displayName(profile: { first_name: string | null; last_name: string | null } | null, email?: string | null): string {
  const n = [profile?.first_name, profile?.last_name].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  return (n || email?.split("@")[0] || "Guest").slice(0, 80);
}

/**
 * POST { spaceId } or { meetingCode } with the user's Supabase JWT  ->  { token, url }
 * Only active members of the tenant that owns the space or meeting get a token.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Please sign in again." }, 401);
  const user = await deps.getUser(jwt);
  if (!user) return json({ error: "Please sign in again." }, 401);

  const body = await req.json().catch(() => ({})) as { spaceId?: unknown; meetingCode?: unknown };
  let room: string;
  let workspaceId: string | null;
  if (typeof body.meetingCode === "string") {
    const code = body.meetingCode.trim().toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: "Missing or invalid meeting code." }, 400);
    const meeting = await deps.getMeeting(code);
    workspaceId = meeting?.workspaceId ?? null;
    const status = workspaceId ? await deps.getMembershipStatus(workspaceId, user.id) : null;
    if (!meeting || status !== "active") return json({ error: "You don't have access to this meeting." }, 403);
    if (meeting.ended) return json({ error: "This meeting has ended." }, 410);
    room = meetingRoomName(meeting.id);
  } else {
    const spaceId = typeof body.spaceId === "string" ? body.spaceId.trim() : "";
    if (!UUID_RE.test(spaceId)) return json({ error: "Missing or invalid spaceId." }, 400);
    // Same answer for "no such space" and "not yours", so ids can't be probed.
    workspaceId = await deps.getSpaceWorkspace(spaceId);
    const status = workspaceId ? await deps.getMembershipStatus(workspaceId, user.id) : null;
    if (!workspaceId || status !== "active") {
      return json({ error: "You don't have access to this workspace." }, 403);
    }
    room = roomName(spaceId);
  }

  if (!deps.livekitUrl) throw new Error("Missing secret LIVEKIT_URL");

  const name = displayName(await deps.getProfileName(user.id), user.email);
  const token = await deps.makeToken({ room, identity: user.id, name, ttl: TOKEN_TTL });
  return json({ token, url: deps.livekitUrl });
}
