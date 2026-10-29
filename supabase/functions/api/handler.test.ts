import { describe, expect, it } from "vitest";
import { handle, readBody, route, type Deps, type Result } from "./handler";

const TOKEN = "a".repeat(64);
const url = (path: string) => `https://x.supabase.co/functions/v1/api${path}`;
function deps(result: Result = { ok: true, status: 201, contact_id: "c1", created: true }) {
  const calls: { token: string; payload: Record<string, unknown> }[] = [];
  const d: Deps = { async addContact(token, payload) { calls.push({ token, payload }); return result; } };
  return { d, calls };
}
const post = (path: string, body: string, type = "application/json") =>
  new Request(url(path), { method: "POST", body, headers: { "content-type": type } });

describe("route", () => {
  it("reads the token from the path or ?token=", () => {
    expect(route(url(`/incoming/${TOKEN}`))).toEqual({ kind: "incoming", token: TOKEN });
    expect(route(url(`/incoming?token=${TOKEN.toUpperCase()}`))).toEqual({ kind: "incoming", token: TOKEN });
    expect(route(url("/incoming/not-a-token")).token).toBeNull();
    expect(route(url("/other")).kind).toBeNull();
  });
});

describe("readBody", () => {
  it("reads JSON and form posts, and nothing else", () => {
    expect(readBody('{"email":"a@b.co"}', "application/json")).toEqual({ email: "a@b.co" });
    expect(readBody("email=a%40b.co&first_name=Jo", "application/x-www-form-urlencoded")).toEqual({ email: "a@b.co", first_name: "Jo" });
    expect(readBody("[1,2]", "application/json")).toBeNull();
    expect(readBody("hello", "text/plain")).toBeNull();
  });
});

describe("handle", () => {
  it("passes the token and fields to the database and answers with its status", async () => {
    const { d, calls } = deps();
    const res = await handle(post(`/incoming/${TOKEN}`, '{"email":"a@b.co"}'), d);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, contact_id: "c1", created: true });
    expect(calls).toEqual([{ token: TOKEN, payload: { email: "a@b.co" } }]);
  });

  it("passes refusals through (404, 422, 429)", async () => {
    const { d } = deps({ ok: false, status: 422, error: "Send an email or a phone number" });
    const res = await handle(post(`/incoming/${TOKEN}`, '{"first_name":"Jo"}'), d);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/email/);
  });

  it("refuses before touching the database when the request is wrong", async () => {
    const { d, calls } = deps();
    expect((await handle(new Request(url(`/incoming/${TOKEN}`)), d)).status).toBe(405);
    expect((await handle(post("/incoming/bad", "{}"), d)).status).toBe(404);
    expect((await handle(post("/nowhere", "{}"), d)).status).toBe(404);
    expect((await handle(post(`/incoming/${TOKEN}`, "not json", "text/plain"), d)).status).toBe(400);
    expect((await handle(post(`/incoming/${TOKEN}`, JSON.stringify({ x: "y".repeat(70_000) })), d)).status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("answers 500 when the database can't be reached", async () => {
    const d: Deps = { async addContact() { throw new Error("down"); } };
    expect((await handle(post(`/incoming/${TOKEN}`, '{"email":"a@b.co"}'), d)).status).toBe(500);
  });
});
