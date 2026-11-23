// DAYMATE — send a real test push to the signed-in user's own devices.
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (shared with send-due-notifications)
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
// (CORS headers are inlined so this file can be pasted on its own into the Supabase dashboard editor.)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const pub = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const priv = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "";
  if (!url || !anon || !service || !pub || !priv || !subject) return json({ error: "not configured" }, 500);

  // Who is asking? Identified from their own JWT, never from the request body.
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: u, error: uErr } = await asUser.auth.getUser();
  if (uErr || !u?.user) return json({ error: "unauthorised" }, 401);

  webpush.setVapidDetails(subject, pub, priv);
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", u.user.id);

  let sent = 0, removed = 0, failed = 0;
  const payload = JSON.stringify({ title: "DAYMATE test", body: "Notifications are working on this device.", tag: "daymate-test", url: "./#/notifications" });
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 120, urgency: "high" });
      sent++;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) { await admin.from("push_subscriptions").delete().eq("id", s.id); removed++; }
      else { failed++; console.error("test push failed", err?.statusCode, err?.body ?? err?.message); }
    }
  }
  return json({ sent, removed, failed });
});
