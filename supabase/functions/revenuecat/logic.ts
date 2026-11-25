// DAYMATE — pure RevenueCat → entitlement logic (no network, fully unit-tested).
export type Update = {
  plan: "free" | "premium";
  status: "active" | "trialing" | "past_due" | "canceled";
  currentPeriodEnd: string | null;
  willRenew: boolean | null;
  store: string | null;
  productId: string | null;
};
export type Decision = { action: "apply"; userId: string; update: Update; eventMs: number } | { action: "ignore"; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const GRANTING = new Set(["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT", "CANCELLATION", "SUBSCRIPTION_PAUSED"]);

export function pickUserId(ev: Record<string, unknown>): string | null {
  const cands: unknown[] = [ev.app_user_id, ev.original_app_user_id, ...(Array.isArray(ev.aliases) ? ev.aliases : [])];
  return (cands.find(isUuid) as string | undefined) ?? null;
}

const iso = (ms: unknown) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** Webhook event → what to write. `now` is injectable for tests. */
export function decide(ev: Record<string, unknown>, opts: { entitlementId: string; allowSandbox: boolean; now?: number }): Decision {
  const now = opts.now ?? Date.now();
  const type = String(ev.type ?? "");
  if (type === "TEST") return { action: "ignore", reason: "test event" };
  if (ev.environment === "SANDBOX" && !opts.allowSandbox) return { action: "ignore", reason: "sandbox events disabled" };
  const userId = pickUserId(ev);
  if (!userId) return { action: "ignore", reason: "no DAYMATE user id on event" };
  const ids = Array.isArray(ev.entitlement_ids) ? (ev.entitlement_ids as unknown[]) : null;
  if (ids && ids.length && !ids.includes(opts.entitlementId)) return { action: "ignore", reason: "different entitlement" };
  const eventMs = typeof ev.event_timestamp_ms === "number" ? ev.event_timestamp_ms : now;
  const exp = typeof ev.expiration_at_ms === "number" ? ev.expiration_at_ms : null;
  const base = { currentPeriodEnd: iso(exp), store: typeof ev.store === "string" ? ev.store.toLowerCase() : null, productId: typeof ev.product_id === "string" ? ev.product_id : null };

  if (type === "EXPIRATION") {
    return { action: "apply", userId, eventMs, update: { ...base, plan: "free", status: "canceled", willRenew: false, currentPeriodEnd: iso(exp ?? now) } };
  }
  if (type === "BILLING_ISSUE") {
    const grace = typeof ev.grace_period_expires_at_ms === "number" ? ev.grace_period_expires_at_ms : null;
    if (grace && grace > now) return { action: "apply", userId, eventMs, update: { ...base, plan: "premium", status: "active", willRenew: true, currentPeriodEnd: iso(grace) } };
    return { action: "apply", userId, eventMs, update: { ...base, plan: "premium", status: "past_due", willRenew: true } };
  }
  if (GRANTING.has(type)) {
    const alive = exp === null || exp > now;           // refunds/expired come with a past date
    const cancelled = type === "CANCELLATION" || type === "SUBSCRIPTION_PAUSED";
    if (!alive) return { action: "apply", userId, eventMs, update: { ...base, plan: "free", status: "canceled", willRenew: false } };
    return { action: "apply", userId, eventMs, update: { ...base, plan: "premium", status: ev.period_type === "TRIAL" ? "trialing" : "active", willRenew: !cancelled } };
  }
  return { action: "ignore", reason: `event ${type} needs no change` };
}

/** RevenueCat REST `GET /v1/subscribers/{id}` → what to write (used by "Restore purchases"/refresh). */
export function fromSubscriber(json: unknown, opts: { entitlementId: string; now?: number; allowSandbox?: boolean }): Update {
  const now = opts.now ?? Date.now();
  const sub = ((json as Record<string, unknown>)?.subscriber ?? {}) as Record<string, any>;
  const ent = sub.entitlements?.[opts.entitlementId];
  const free: Update = { plan: "free", status: "canceled", currentPeriodEnd: null, willRenew: false, store: null, productId: null };
  if (!ent) return free;
  const expMs = ent.expires_date ? Date.parse(ent.expires_date) : null;
  if (expMs !== null && !(expMs > now)) return { ...free, currentPeriodEnd: iso(expMs), productId: ent.product_identifier ?? null };
  const s = sub.subscriptions?.[ent.product_identifier] ?? {};
  if (s.is_sandbox === true && !opts.allowSandbox) return free;        // sandbox never grants real Premium unless testing is switched on
  return {
    plan: "premium", status: s.period_type === "trial" ? "trialing" : "active",
    currentPeriodEnd: expMs === null ? null : iso(expMs), willRenew: expMs === null ? false : !s.unsubscribe_detected_at,
    store: typeof s.store === "string" ? s.store : null, productId: ent.product_identifier ?? null,
  };
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
