// See handler.ts. Deployed with verify_jwt = false (other apps have no SYNAPSE login); the API key,
// or the secret token in an incoming link, is what lets a request in.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { handle, type ApiAnswer, type Deps, type Result } from "./handler.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const deps: Deps = {
  async addContact(token, payload) {
    const { data, error } = await db.rpc("inbound_contact", { p_token: token, p_payload: payload });
    if (error) { console.error("inbound_contact failed", error.message); throw error; }
    return data as Result;
  },
  async apiRequest(key, method, path, query, body) {
    const { data, error } = await db.rpc("api_request", { p_key: key, p_method: method, p_path: path, p_query: query, p_body: body });
    if (error) { console.error("api_request failed", error.message); throw error; }
    return data as ApiAnswer;
  },
};

Deno.serve((req) => handle(req, deps));
