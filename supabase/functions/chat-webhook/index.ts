// See handler.ts. Deployed with verify_jwt = false (Zapier, Airtable and Modal have no SYNAPSE
// login); the secret token in the link is what lets a post in.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { handle, type Deps } from "./handler.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const deps: Deps = {
  async findWebhook(token) {
    const { data } = await db
      .from("chat_webhooks")
      .select("id, channel_id, name, revoked_at, chat_channels(archived_at)")
      .eq("token", token)
      .maybeSingle();
    if (!data || data.revoked_at) return null;
    const channel = (Array.isArray(data.chat_channels) ? data.chat_channels[0] : data.chat_channels) as { archived_at: string | null } | null;
    return { id: data.id, channelId: data.channel_id, name: data.name, archived: !!channel?.archived_at };
  },
  async countRecent(webhookId, sinceIso) {
    const { count } = await db.from("chat_messages").select("id", { count: "exact", head: true }).eq("webhook_id", webhookId).gte("created_at", sinceIso);
    return count ?? 0;
  },
  async insertMessage(m) {
    const { data, error } = await db
      .from("chat_messages")
      .insert({ channel_id: m.channelId, webhook_id: m.webhookId, body: m.body, source: "webhook", sender_name: m.senderName, meta: m.meta })
      .select("id")
      .single();
    if (error) { console.error("chat-webhook insert failed", error.message); return null; }
    return data.id as string;
  },
  async touch(webhookId) {
    await db.from("chat_webhooks").update({ last_used_at: new Date().toISOString() }).eq("id", webhookId);
  },
};

Deno.serve((req) => handle(req, deps));
