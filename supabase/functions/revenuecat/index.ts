// DAYMATE — RevenueCat ⇄ entitlements.
//   POST  (RevenueCat webhook)  header `Authorization: <REVENUECAT_WEBHOOK_AUTH>`  body {event:{…}}
//   POST  (the app)             user's own JWT                                      body {action:"refresh"}
// Secrets: REVENUECAT_WEBHOOK_AUTH, REVENUECAT_SECRET_API_KEY, optional REVENUECAT_ENTITLEMENT_ID (default "premium"),
//          optional ALLOW_RC_SANDBOX=true (testing only).
// The browser can never grant itself Premium: only this function (service role) writes `entitlements`,
// and lifetime rows are protected by a database trigger.
import { createClient } from "npm:@supabase/supabase-js@2";
import { decide, fromSubscriber, timingSafeEqual, type Update } from "./logic.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const lastRefresh = new Map<string, number>();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "", anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "", service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !service) return json({ error: "not_configured" }, 500);
  const entitlementId = Deno.env.get("REVENUECAT_ENTITLEMENT_ID") || "premium";
  const db = createClient(url, service, { auth: { persistSession: false } });

  let body: Record<string, any>;
  try { body = await req.json(); } catch (_) { return json({ error: "bad_request" }, 400); }

  async function write(userId: string, u: Update, eventMs: number | null) {
    const { data: cur } = await db.from("entitlements").select("source,last_event_ms").eq("user_id", userId).maybeSingle();
    if (cur?.source === "lifetime") return "lifetime";
    if (eventMs !== null && cur && Number(cur.last_event_ms) >= eventMs) return "stale";
    const { error } = await db.from("entitlements").upsert({
      user_id: userId, plan: u.plan, status: u.status, source: "revenuecat", current_period_end: u.currentPeriodEnd, will_renew: u.willRenew,
      store: u.store, product_id: u.productId, revenuecat_app_user_id: userId, last_event_ms: eventMs ?? Number(cur?.last_event_ms ?? 0), updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) { console.error("entitlement write failed", error.code, error.message); throw new Error("write_failed"); }
    return "ok";
  }

  /* ---------- RevenueCat webhook ---------- */
  if (body && typeof body.event === "object") {
    const secret = Deno.env.get("REVENUECAT_WEBHOOK_AUTH") ?? "";
    const given = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!secret || !timingSafeEqual(given, secret.replace(/^Bearer\s+/i, ""))) return json({ error: "unauthorised" }, 401);
    const d = decide(body.event, { entitlementId, allowSandbox: Deno.env.get("ALLOW_RC_SANDBOX") === "true" });
    if (d.action === "ignore") return json({ ok: true, ignored: d.reason });
    try { const r = await write(d.userId, d.update, d.eventMs); return json({ ok: true, result: r }); }
    catch (_) { return json({ error: "server_error" }, 500); }   // non-2xx makes RevenueCat retry
  }

  /* ---------- the signed-in person asks us to re-check with RevenueCat (restore / after purchase) ---------- */
  if (body?.action === "refresh") {
    const asUser = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
    const { data: u, error: uErr } = await asUser.auth.getUser();
    if (uErr || !u?.user) return json({ error: "unauthorised" }, 401);
    const userId = u.user.id;
    const key = Deno.env.get("REVENUECAT_SECRET_API_KEY") ?? "";
    if (!key) return json({ error: "billing_not_configured" }, 503);
    const now = Date.now();
    if (now - (lastRefresh.get(userId) ?? 0) < 3000) return json({ error: "too_fast" }, 429);
    lastRefresh.set(userId, now);
    const { data: cur } = await db.from("entitlements").select("source").eq("user_id", userId).maybeSingle();
    if (cur?.source === "lifetime") return json({ ok: true, plan: "premium", source: "lifetime" });
    let res: Response;
    try { res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000) }); }
    catch (_) { return json({ error: "provider_error" }, 502); }
    if (res.status === 404) return json({ ok: true, plan: "free" });
    if (!res.ok) { console.error("revenuecat api", res.status); return json({ error: "provider_error" }, 502); }
    const upd = fromSubscriber(await res.json(), { entitlementId, allowSandbox: Deno.env.get("ALLOW_RC_SANDBOX") === "true" });
    // Never replace a test/manual grant with "free" just because RevenueCat has never heard of this person.
    if (upd.plan === "free" && cur && (cur.source === "test" || cur.source === "manual")) return json({ ok: true, kept: cur.source });
    try { await write(userId, upd, null); } catch (_) { return json({ error: "server_error" }, 500); }
    return json({ ok: true, plan: upd.plan, status: upd.status });
  }
  return json({ error: "bad_request" }, 400);
});
