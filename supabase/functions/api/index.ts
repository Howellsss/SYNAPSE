// See handler.ts. Deployed with verify_jwt = false (other apps have no SYNAPSE login); the secret
// token in the link is what lets a contact in.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { handle, type Deps, type Result } from "./handler.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const deps: Deps = {
  async addContact(token, payload) {
    const { data, error } = await db.rpc("inbound_contact", { p_token: token, p_payload: payload });
    if (error) { console.error("inbound_contact failed", error.message); throw error; }
    return data as Result;
  },
};

Deno.serve((req) => handle(req, deps));
