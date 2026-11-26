// DAYMATE — Edge Function: assistant
// POST { message, conversationId? }  (JWT required; the person is identified from the token, never from the body)
// Secrets: GEMINI_API_KEY (or AI_API_KEY) · optional AI_PROVIDER, AI_MODEL, AI_BASE_URL
// Injected by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "npm:@supabase/supabase-js@2";
import { getProvider, ProviderError } from "./providers.ts";
import {
  assignRefs, buildContext, buildSystemPrompt, clampHistory, markConflicts, parseModelJson, PLAN_LIMITS, sanitizeProposals, todayIn, type Item,
} from "./logic.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "", anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "", service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !service) return json({ error: "not_configured" }, 500);

  const asUser = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: u, error: uErr } = await asUser.auth.getUser();
  if (uErr || !u?.user) return json({ error: "unauthorised" }, 401);
  const userId = u.user.id;

  let body: { message?: unknown; conversationId?: unknown };
  try { body = await req.json(); } catch (_) { return json({ error: "bad_request" }, 400); }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "empty_message" }, 400);
  if (message.length > 1000) return json({ error: "too_long", max: 1000 }, 400);
  const convIn = typeof body.conversationId === "string" && /^[0-9a-f-]{36}$/i.test(body.conversationId) ? body.conversationId : "";

  const provider = getProvider(Deno.env);
  if (!provider) return json({ error: "ai_not_configured" }, 503);

  const db = createClient(url, service, { auth: { persistSession: false } });

  // Consent, profile and plan — all read on the server.
  const [{ data: prefs }, { data: profile }, { data: prem }] = await Promise.all([
    db.from("user_preferences").select("ai_consent_at").eq("user_id", userId).maybeSingle(),
    db.from("profiles").select("display_name, timezone").eq("id", userId).maybeSingle(),
    db.rpc("is_premium", { p_user: userId }),
  ]);
  if (!prefs?.ai_consent_at) return json({ error: "consent_required" }, 403);
  const plan: "free" | "premium" = prem === true ? "premium" : "free";
  const tz = profile?.timezone || "Europe/London";
  const today = todayIn(tz);

  const { data: bump, error: bErr } = await db.rpc("dm_ai_bump", { p_user: userId, p_day: today, p_limit: PLAN_LIMITS[plan].daily });
  if (bErr) return json({ error: "server_error" }, 500);
  const b = Array.isArray(bump) ? bump[0] : bump;
  if (!b?.allowed) return json({ error: "limit_reached", limit: PLAN_LIMITS[plan].daily, plan }, 429);

  // Conversation
  let conversationId = convIn;
  if (conversationId) {
    const { data: c } = await db.from("ai_conversations").select("id").eq("user_id", userId).eq("id", conversationId).maybeSingle();
    if (!c) conversationId = "";
  }
  if (!conversationId) {
    const { data: c, error } = await db.from("ai_conversations").insert({ user_id: userId, title: message.slice(0, 60) }).select("id").single();
    if (error || !c) return json({ error: "server_error" }, 500);
    conversationId = c.id;
  }
  const { data: past } = await db.from("ai_messages").select("role, content").eq("user_id", userId).eq("conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(12);
  const history = clampHistory((past ?? []).reverse());

  // Planner context (their own data, limited by plan)
  const lim = PLAN_LIMITS[plan];
  const from = new Date(Date.parse(today) - 14 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(today) + (lim.horizonDays + 1) * 86400000).toISOString().slice(0, 10);
  const [tasks, appts, rems, mems, shop] = await Promise.all([
    db.from("tasks").select("id, title, due_date, due_time, completed, priority, category").eq("user_id", userId).is("deleted_at", null).gte("due_date", from).lte("due_date", to).limit(200),
    db.from("appointments").select("id, title, appt_date, appt_time, done, category").eq("user_id", userId).is("deleted_at", null).gte("appt_date", from).lte("appt_date", to).limit(200),
    db.from("reminders").select("id, title, remind_date, remind_time, done, category, category_tag").eq("user_id", userId).is("deleted_at", null).gte("remind_date", from).lte("remind_date", to).limit(200),
    lim.useMemory
      ? db.from("memories").select("category, content").eq("user_id", userId).eq("sensitive", false).is("deleted_at", null).order("updated_at", { ascending: false }).limit(40)
      : Promise.resolve({ data: [] as { category: string; content: string }[] }),
    db.from("shopping_items").select("id, name, checked").eq("user_id", userId).is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
  ]);
  const hm = (t: string | null) => (t ? t.slice(0, 5) : "");
  const items: Item[] = [
    ...(tasks.data ?? []).map((t) => ({ id: t.id, tkind: "task", date: t.due_date, time: hm(t.due_time), label: t.title, done: t.completed, kind: "task", category: t.category, priority: t.priority })),
    ...(appts.data ?? []).map((a) => ({ id: a.id, tkind: "event", date: a.appt_date, time: hm(a.appt_time), label: a.title, done: a.done, kind: "appointment", category: a.category })),
    ...(rems.data ?? []).map((r) => ({ id: r.id, tkind: r.category === "bill" ? "bill" : "reminder", date: r.remind_date, time: hm(r.remind_time), label: r.title, done: r.done, kind: r.category === "bill" ? "bill" : "reminder", category: r.category_tag || "personal" })),
  ];
  const shopping = (shop.data ?? []).map((x) => ({ id: x.id as string, name: x.name as string, checked: !!x.checked }));
  const refs = assignRefs(items, shopping);
  const context = buildContext({ today, items, memories: mems.data ?? [], plan, shopping });
  const system = buildSystemPrompt({ today, tz, name: (profile?.display_name || "").slice(0, 30), plan });
  const messages = [...history, { role: "user" as const, content: `<planner_data>\n${context}\n</planner_data>\n\nPerson says: ${message}` }];

  // Ask the model (one retry for temporary failures)
  let text = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try { text = await provider.complete({ system, messages, signal: AbortSignal.timeout(25000) }); break; }
    catch (e) {
      const pe = e as ProviderError;
      console.error("provider error", provider.name, pe.status, String(pe.message).slice(0, 120));
      if (attempt === 1 || !pe.retryable) {
        // Give the message back: a failed call must not use up the person's allowance.
        await db.from("ai_usage").update({ count: Math.max(0, (b.used ?? 1) - 1) }).eq("user_id", userId).eq("day", today);
        return json({ error: pe.status === 429 ? "provider_busy" : "provider_error" }, 502);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  const parsed = parseModelJson(text);
  const reply = (parsed?.reply || "").trim().slice(0, 3000) || "Sorry, I couldn't put that together. Could you try rephrasing?";
  const proposals = parsed ? markConflicts(
    sanitizeProposals(parsed.proposals, today, refs),
    items.filter((i) => i.kind === "appointment" && !i.done && i.time).map((i) => ({ date: i.date, time: i.time, title: i.label })),
  ) : [];

  const now = Date.now();
  const messageId = crypto.randomUUID();
  // Every row carries the same keys (a bulk insert with differing keys would null out the missing ones).
  const { error: saveErr } = await db.from("ai_messages").insert([
    { user_id: userId, id: crypto.randomUUID(), conversation_id: conversationId, role: "user", content: message, proposals: null, created_at: new Date(now).toISOString() },
    { user_id: userId, id: messageId, conversation_id: conversationId, role: "assistant", content: reply, proposals: proposals.length ? proposals : null, created_at: new Date(now + 1).toISOString() },
  ]);
  if (saveErr) console.error("could not save chat", saveErr.code, saveErr.message);
  await db.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", conversationId);

  return json({ conversationId, messageId, reply, proposals, plan, used: b.used, limit: lim.daily, today });
});
