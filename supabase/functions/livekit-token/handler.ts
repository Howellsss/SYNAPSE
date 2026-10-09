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

export type AdmissionStatus = "waiting" | "admitted" | "denied" | "removed";

export interface Admission {
  ticket: string;
  meetingId: string;
  identity: string;
  status: AdmissionStatus;
}

/** The host's breakout rooms while they are open (meetings.breakout). */
export interface Breakout {
  open?: boolean;
  rooms?: { n: number; name?: string }[];
  assign?: Record<string, number>;
}

export interface MeetingRow {
  id: string;
  workspaceId: string;
  ended: boolean;
  inviteToken?: string | null;
  hostId?: string | null;
  waitingRoom?: boolean;
  locked?: boolean;
  breakout?: Breakout | null;
}

export interface Deps {
  /** The signed-in user for this JWT, or null. */
  getUser(jwt: string): Promise<{ id: string; email?: string | null } | null>;
  /** The space's owning tenant (workspaces.id), or null if there's no such space. */
  getSpaceWorkspace(spaceId: string): Promise<string | null>;
  /** A meeting's id, owning tenant and invite token by code, or null. Ended meetings return ended: true. */
  getMeeting(code: string): Promise<MeetingRow | null>;
  /**
   * Admissions (waiting room, lock, remove). Left out, or returning undefined when the
   * meeting_admissions table doesn't exist yet, means everyone with access goes straight in.
   */
  getAdmission?(ticket: string): Promise<Admission | null | undefined>;
  /** The latest admission for this person in this meeting. */
  findAdmission?(meetingId: string, identity: string): Promise<Admission | null | undefined>;
  /** Saves a new admission and returns its ticket. */
  createAdmission?(row: { meetingId: string; identity: string; name: string; userId: string | null; status: AdmissionStatus }): Promise<string | undefined>;
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

/** A guest's typed name, tidied: "Ada (Guest)". */
export function guestName(raw: unknown): string {
  const n = [...String(raw ?? "")].filter((c) => c >= " " && c !== "<" && c !== ">").join("").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${n || "Guest"} (Guest)`;
}

/** Same-length comparison that doesn't stop at the first different character. */
function sameToken(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function breakoutRoomName(meetingId: string, n: number): string {
  return `meeting_${meetingId}_b${n}`;
}

/** The breakout room number this person may enter, or null. Hosts may enter any open room. */
export function breakoutAllowed(b: Breakout | null | undefined, n: unknown, identity: string, isHost: boolean): number | null {
  if (!b?.open || typeof n !== "number" || !Number.isInteger(n) || n < 1) return null;
  if (!(b.rooms ?? []).some((r) => r.n === n)) return null;
  return isHost || b.assign?.[identity] === n ? n : null;
}

const randomId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, "").slice(0, 16);

/**
 * POST { spaceId } or { meetingCode } with the user's Supabase JWT  ->  { token, url }
 * Only active members of the tenant that owns the space or meeting get a token.
 * Meetings also accept { meetingCode, invite, guestName } from anyone holding the meeting's invite
 * link: signed-in people from other accounts join as themselves, everyone else as "Name (Guest)".
 *
 * Meetings also go through admissions: with the waiting room on, everyone but the host gets
 * 202 { waiting, ticket } and asks again with { ticket } until the host lets them in. A locked
 * meeting refuses new people (423); removed or turned-away people are refused (403).
 * { breakout: n } joins breakout room n when the host has assigned this person to it.
 * Meeting answers also carry { identity, ticket }.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const body = await req.json().catch(() => ({})) as { spaceId?: unknown; meetingCode?: unknown; invite?: unknown; guestName?: unknown; ticket?: unknown; breakout?: unknown };
  const invite = typeof body.invite === "string" ? body.invite.trim() : "";
  // A guest with an invite link has no login; the anon key isn't a user, so getUser gives null.
  const user = jwt ? await deps.getUser(jwt) : null;
  if (!user && !(typeof body.meetingCode === "string" && invite)) return json({ error: "Please sign in again." }, 401);

  if (typeof body.meetingCode === "string") {
    const code = body.meetingCode.trim().toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: "Missing or invalid meeting code." }, 400);
    const meeting = await deps.getMeeting(code);
    const workspaceId = meeting?.workspaceId ?? null;
    const status = user && workspaceId ? await deps.getMembershipStatus(workspaceId, user.id) : null;
    const invited = !!meeting && sameToken(invite, meeting.inviteToken ?? "");
    if (!meeting || (status !== "active" && !invited)) {
      return json({ error: invite ? "This invite link isn't valid." : "You don't have access to this meeting." }, 403);
    }
    if (meeting.ended) return json({ error: "This meeting has ended." }, 410);
    if (!deps.livekitUrl) throw new Error("Missing secret LIVEKIT_URL");

    const isHost = !!user && user.id === meeting.hostId;
    const name = user ? displayName(await deps.getProfileName(user.id), user.email) : guestName(body.guestName);
    let identity = user ? user.id : `guest_${randomId()}`;
    let ticket: string | undefined;

    if (!isHost && deps.createAdmission) {
      const asked = typeof body.ticket === "string" && UUID_RE.test(body.ticket) ? body.ticket : "";
      let adm = asked && deps.getAdmission ? await deps.getAdmission(asked) : null;
      // A ticket only counts for its own meeting, and a signed-in person can't borrow someone else's.
      if (adm && (adm.meetingId !== meeting.id || (user && adm.identity !== user.id))) adm = null;
      if (!adm && user && deps.findAdmission) adm = await deps.findAdmission(meeting.id, user.id);
      if (adm === undefined) {
        // meeting_admissions isn't set up yet: no waiting room, straight in.
      } else if (adm) {
        if (adm.status === "removed") return json({ error: "The host removed you from this meeting." }, 403);
        if (adm.status === "denied") return json({ error: "The host didn't let you in to this meeting." }, 403);
        identity = adm.identity;
        ticket = adm.ticket;
        if (adm.status === "waiting") return json({ waiting: true, ticket }, 202);
      } else {
        if (meeting.locked) return json({ error: "The host has locked this meeting, so nobody new can join." }, 423);
        const status: AdmissionStatus = meeting.waitingRoom ? "waiting" : "admitted";
        ticket = await deps.createAdmission({ meetingId: meeting.id, identity, name, userId: user?.id ?? null, status });
        if (ticket && status === "waiting") return json({ waiting: true, ticket }, 202);
      }
    }

    let room = meetingRoomName(meeting.id);
    if (body.breakout !== undefined && body.breakout !== null && body.breakout !== 0) {
      const n = breakoutAllowed(meeting.breakout, body.breakout, identity, isHost);
      if (n === null) return json({ error: "That breakout room isn't open to you." }, 403);
      room = breakoutRoomName(meeting.id, n);
    }
    const token = await deps.makeToken({ room, identity, name, ttl: TOKEN_TTL });
    return json({ token, url: deps.livekitUrl, identity, ...(ticket ? { ticket } : {}) });
  }

  if (!user) return json({ error: "Please sign in again." }, 401);
  const spaceId = typeof body.spaceId === "string" ? body.spaceId.trim() : "";
  if (!UUID_RE.test(spaceId)) return json({ error: "Missing or invalid spaceId." }, 400);
  // Same answer for "no such space" and "not yours", so ids can't be probed.
  const workspaceId = await deps.getSpaceWorkspace(spaceId);
  const status = workspaceId ? await deps.getMembershipStatus(workspaceId, user.id) : null;
  if (!workspaceId || status !== "active") {
    return json({ error: "You don't have access to this workspace." }, 403);
  }
  if (!deps.livekitUrl) throw new Error("Missing secret LIVEKIT_URL");
  const name = displayName(await deps.getProfileName(user.id), user.email);
  const token = await deps.makeToken({ room: roomName(spaceId), identity: user.id, name, ttl: TOKEN_TTL });
  return json({ token, url: deps.livekitUrl });
}
