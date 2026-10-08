// A LiveKit access token for a space's audio/video room or a meeting.
//
//   POST (with the user's Supabase JWT)  { spaceId }      -> room "space_<spaceId>"
//   POST (with the user's Supabase JWT)  { meetingCode }  -> room "meeting_<meetingId>"
//   POST (no login)  { meetingCode, invite, guestName }    -> the same room, as "Name (Guest)"
//   -> { token, url }    identity = user id, valid 6 hours
//
// Only active members of the tenant (workspaces row) that owns the space/meeting get a token.
// Secrets: LIVEKIT_URL (wss://…), LIVEKIT_API_KEY, LIVEKIT_API_SECRET
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { AccessToken } from "npm:livekit-server-sdk@2.19.1";
import { handle, json } from "./handler.ts";

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
        const row = data as { id: string; workspace_id: string; ended_at: string | null; invite_token?: string | null } | null;
        return row ? { id: row.id, workspaceId: row.workspace_id, ended: !!row.ended_at, inviteToken: row.invite_token ?? null } : null;
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

let adminClient: ReturnType<typeof createClient> | null = null;
function admin() {
  adminClient ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  return adminClient;
}
