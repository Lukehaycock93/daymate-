// DAYMATE — permanently delete the signed-in user's account.
// Deleting the auth user cascades to every table (all foreign keys are ON DELETE CASCADE).
import { createClient } from "npm:@supabase/supabase-js@2";
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
  if (!url || !anon || !service) return json({ error: "not configured" }, 500);

  const asUser = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data, error } = await asUser.auth.getUser();
  if (error || !data?.user) return json({ error: "unauthorised" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { error: delErr } = await admin.auth.admin.deleteUser(data.user.id);
  if (delErr) { console.error("delete failed", delErr.message); return json({ error: "could not delete account" }, 500); }
  return json({ ok: true });
});
