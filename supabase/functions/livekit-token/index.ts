// A LiveKit access token for a space's audio/video room or a meeting.
//
//   POST (with the user's Supabase JWT)  { spaceId }      -> room "space_<spaceId>"
//   POST (with the user's Supabase JWT)  { meetingCode }  -> room "meeting_<meetingId>"
//   POST (no login)  { meetingCode, invite, guestName }    -> the same room, as "Name (Guest)"
//   -> { token, url }    identity = user id, valid 6 hours
// Meetings also use meeting_admissions (waiting room, lock, remove) and meetings.breakout.
// Until those exist in the database, everyone with access goes straight in.
//
// Only active members of the tenant (workspaces row) that owns the space/meeting get a token.
// Secrets: LIVEKIT_URL (wss://…), LIVEKIT_API_KEY, LIVEKIT_API_SECRET
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { AccessToken } from "npm:livekit-server-sdk@2.19.1";
import { handle, json, type Admission, type Breakout } from "./handler.ts";

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
}

Deno.serve(async (req: Request) => {
  try {
    return await handle(req, {
      livekitUrl: Deno.env.get("LIVEKIT_URL"),

      async getUser(jwt) {
        const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
          global: { headers: { Authorization: `Bearer ${jwt}` } },
          auth: { persistSession: false },
        });
        const { data } = await client.auth.getUser(jwt);
        return data?.user ? { id: data.user.id, email: data.user.email } : null;
      },

      async getSpaceWorkspace(spaceId) {
        const { data, error } = await admin().from("spaces").select("workspace_id").eq("id", spaceId).maybeSingle();
        if (error) throw new Error(error.message);
        return (data as { workspace_id: string } | null)?.workspace_id ?? null;
      },

      async getMeeting(code) {
        const { data, error } = await admin().from("meetings").select("*").eq("code", code).maybeSingle();
        if (error) throw new Error(error.message);
        const row = data as {
          id: string; workspace_id: string; host_id: string; ended_at: string | null; invite_token?: string | null;
          waiting_room?: boolean; locked?: boolean; breakout?: Breakout | null;
        } | null;
        return row
          ? {
            id: row.id, workspaceId: row.workspace_id, hostId: row.host_id, ended: !!row.ended_at, inviteToken: row.invite_token ?? null,
            waitingRoom: !!row.waiting_room, locked: !!row.locked, breakout: row.breakout ?? null,
          }
          : null;
      },

      async getAdmission(ticket) {
        const { data, error } = await admin().from("meeting_admissions").select("ticket, meeting_id, identity, status").eq("ticket", ticket).maybeSingle();
        if (error) return missingTable(error) ? undefined : fail(error);
        return toAdmission(data);
      },

      async findAdmission(meetingId, identity) {
        const { data, error } = await admin()
          .from("meeting_admissions")
          .select("ticket, meeting_id, identity, status")
          .eq("meeting_id", meetingId)
          .eq("identity", identity)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) return missingTable(error) ? undefined : fail(error);
        return toAdmission(data);
      },

      async createAdmission({ meetingId, identity, name, userId, status }) {
        const { data, error } = await admin()
          .from("meeting_admissions")
          .insert({ meeting_id: meetingId, identity, name, user_id: userId, status, decided_at: status === "admitted" ? new Date().toISOString() : null })
          .select("ticket")
          .single();
        if (error) return missingTable(error) ? undefined : fail(error);
        return (data as { ticket: string }).ticket;
      },

      async getMembershipStatus(workspaceId, userId) {
        const { data, error } = await admin()
          .from("workspace_members")
          .select("status")
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        // Rows from before the status column default to active.
        const row = data as { status: string | null } | null;
        return row ? (row.status ?? "active") : null;
      },

      async getProfileName(userId) {
        const { data } = await admin().from("profiles").select("first_name, last_name").eq("user_id", userId).maybeSingle();
        return (data as { first_name: string | null; last_name: string | null } | null) ?? null;
      },

      async makeToken({ room, identity, name, ttl }) {
        const at = new AccessToken(env("LIVEKIT_API_KEY"), env("LIVEKIT_API_SECRET"), { identity, name, ttl });
        at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
        return await at.toJwt();
      },
    });
  } catch (err) {
    console.error("livekit-token", err);
    return json({ error: err instanceof Error ? err.message : "Could not create a call token." }, 500);
  }
});

/** The table (or a column) isn't in the database yet: the migration hasn't been applied. */
function missingTable(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || /does not exist|could not find the table/i.test(error.message ?? "");
}

function fail(error: { message: string }): never {
  throw new Error(error.message);
}

function toAdmission(data: unknown): Admission | null {
  const row = data as { ticket: string; meeting_id: string; identity: string; status: Admission["status"] } | null;
  return row ? { ticket: row.ticket, meetingId: row.meeting_id, identity: row.identity, status: row.status } : null;
}

let adminClient: ReturnType<typeof createClient> | null = null;
function admin() {
  adminClient ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  return adminClient;
}
