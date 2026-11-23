// ==========================================================================
// DAYMATE — Edge Function: send-due-notifications
//
// Runs every minute (pg_cron → pg_net → this function). It:
//   1. asks the database which reminders/tasks/appointments are due (timezone,
//      lead times, preferences and Free/Premium rules are all applied in SQL)
//   2. records each one in `notifications` — the unique (user_id, dedupe_key)
//      makes this atomic, so the same alert can never be sent twice, even if two
//      runs overlap
//   3. sends a Web Push to every registered device of that user
//
// Secrets (set with `supabase secrets set`, never in frontend code):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
// Injected automatically by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ==========================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const configured = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT && CRON_SECRET);
if (configured) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const db = configured ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;

type Candidate = {
  user_id: string;
  source_type: string | null;
  source_id: string | null;
  notif_type: string;
  title: string;
  body: string;
  dedupe_key: string;
};

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

/** Constant-time string comparison so the secret can't be probed by timing. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!configured || !db) return json({ error: "function is not configured (missing secrets)" }, 500);
  if (!safeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) return json({ error: "unauthorised" }, 401);

  const now = new Date().toISOString();

  // 1. What is due right now?
  const [due, summaries] = await Promise.all([
    db.rpc("due_notification_candidates", { p_now: now }),
    db.rpc("morning_summary_candidates", { p_now: now }),
  ]);
  if (due.error) return json({ error: `due query failed: ${due.error.message}` }, 500);
  if (summaries.error) return json({ error: `summary query failed: ${summaries.error.message}` }, 500);

  const candidates: Candidate[] = [
    ...(due.data ?? []).map((r: any): Candidate => ({
      user_id: r.user_id,
      source_type: r.source_type,
      source_id: r.source_id,
      notif_type: r.notif_type,
      title: r.title,
      body: r.body,
      // Includes the due date/time and lead so a rescheduled item alerts again.
      dedupe_key: `${r.source_type}:${r.source_id}:L${r.lead}:${r.due_local}`,
    })),
    ...(summaries.data ?? []).map((r: any): Candidate => ({
      user_id: r.user_id,
      source_type: null,
      source_id: null,
      notif_type: "summary",
      title: r.title,
      body: r.body,
      dedupe_key: r.day_key,
    })),
  ];

  const subsCache = new Map<string, Sub[]>();
  const loadSubs = async (userId: string): Promise<Sub[]> => {
    if (!subsCache.has(userId)) {
      const { data } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
      subsCache.set(userId, (data ?? []) as Sub[]);
    }
    return subsCache.get(userId)!;
  };

  const stats = { candidates: candidates.length, created: 0, duplicates: 0, pushed: 0, expired: 0, retried: 0, errors: 0 };

  for (const c of candidates) {
    // 2. Record it. ignoreDuplicates => only a brand-new row is returned.
    const ins = await db
      .from("notifications")
      .upsert(
        {
          user_id: c.user_id,
          type: c.notif_type,
          title: c.title.slice(0, 160),
          body: c.body.slice(0, 300),
          source_type: c.source_type,
          source_id: c.source_id,
          dedupe_key: c.dedupe_key.slice(0, 200),
        },
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
      )
      .select("id");

    if (ins.error) { stats.errors++; console.error("insert failed", ins.error.message); continue; }
    if (!ins.data || ins.data.length === 0) { stats.duplicates++; continue; }
    stats.created++;
    const notificationId = ins.data[0].id as string;

    // 3. Push to every device.
    const subs = await loadSubs(c.user_id);
    if (subs.length === 0) continue;

    const payload = JSON.stringify({
      id: notificationId,
      title: c.title,
      body: c.body,
      tag: c.dedupe_key,
      url: "./#/notifications",
    });

    let delivered = 0;
    let transientFailure = false;
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60, urgency: "normal" },
        );
        delivered++;
      } catch (err: any) {
        const code = err?.statusCode;
        if (code === 404 || code === 410) {
          // Browser says this subscription is gone: clean it up.
          await db.from("push_subscriptions").delete().eq("id", s.id);
          subsCache.set(c.user_id, (subsCache.get(c.user_id) ?? []).filter((x) => x.id !== s.id));
          stats.expired++;
        } else {
          transientFailure = true;
          console.error("push failed", code, err?.body ?? err?.message);
        }
      }
    }

    if (delivered > 0) {
      stats.pushed += delivered;
      await db.from("push_subscriptions").update({ last_sent_at: new Date().toISOString() })
        .eq("user_id", c.user_id);
    } else if (transientFailure) {
      // Nothing got through because of a temporary problem: forget the record so
      // the next run (within the 2 h catch-up window) tries again.
      await db.from("notifications").delete().eq("user_id", c.user_id).eq("id", notificationId);
      stats.retried++;
    }
  }

  return json({ ok: true, at: now, ...stats });
});
