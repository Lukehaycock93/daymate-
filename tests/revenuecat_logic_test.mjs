// Run: node --experimental-strip-types tests/revenuecat_logic_test.mjs
import { decide, fromSubscriber, pickUserId, timingSafeEqual, isUuid } from '../supabase/functions/revenuecat/logic.ts';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const U = '0b271515-f8b4-4dc0-b31e-9319d40671b6';
const NOW = Date.UTC(2026, 10, 24, 12);
const D = 86400000;
const o = { entitlementId: 'premium', allowSandbox: false, now: NOW };
const ev = (x) => ({ type: 'INITIAL_PURCHASE', app_user_id: U, entitlement_ids: ['premium'], event_timestamp_ms: NOW, expiration_at_ms: NOW + 30 * D, store: 'APP_STORE', product_id: 'daymate_premium_monthly', environment: 'PRODUCTION', ...x });

let d = decide(ev(), o);
ok(d.action === 'apply' && d.update.plan === 'premium' && d.update.status === 'active' && d.update.willRenew === true, 'purchase → premium');
ok(d.update.store === 'app_store' && d.update.currentPeriodEnd === new Date(NOW + 30 * D).toISOString(), 'store lowercased, period end');
d = decide(ev({ period_type: 'TRIAL' }), o); ok(d.update.status === 'trialing', 'trial');
d = decide(ev({ type: 'RENEWAL' }), o); ok(d.update.plan === 'premium', 'renewal');
d = decide(ev({ type: 'CANCELLATION' }), o); ok(d.update.plan === 'premium' && d.update.willRenew === false, 'cancel keeps access until period end');
d = decide(ev({ type: 'CANCELLATION', expiration_at_ms: NOW - 1000 }), o); ok(d.update.plan === 'free', 'refund/expired cancellation → free');
d = decide(ev({ type: 'EXPIRATION', expiration_at_ms: NOW - 1000 }), o); ok(d.update.plan === 'free' && d.update.status === 'canceled', 'expiration → free');
d = decide(ev({ type: 'BILLING_ISSUE', grace_period_expires_at_ms: NOW + 3 * D }), o); ok(d.update.plan === 'premium' && d.update.currentPeriodEnd === new Date(NOW + 3 * D).toISOString(), 'grace period keeps access');
d = decide(ev({ type: 'BILLING_ISSUE' }), o); ok(d.update.status === 'past_due', 'billing issue w/o grace → past_due');
d = decide(ev({ type: 'TEST' }), o); ok(d.action === 'ignore', 'test ignored');
d = decide(ev({ environment: 'SANDBOX' }), o); ok(d.action === 'ignore', 'sandbox ignored by default');
d = decide(ev({ environment: 'SANDBOX' }), { ...o, allowSandbox: true }); ok(d.action === 'apply', 'sandbox allowed when enabled');
d = decide(ev({ entitlement_ids: ['other'] }), o); ok(d.action === 'ignore', 'other entitlement ignored');
d = decide(ev({ app_user_id: '$RCAnonymousID:abc' }), o); ok(d.action === 'ignore', 'anonymous id ignored');
d = decide(ev({ app_user_id: '$RCAnonymousID:abc', aliases: ['$RCAnonymousID:abc', U] }), o); ok(d.action === 'apply' && d.userId === U, 'alias uuid used');
d = decide(ev({ type: 'SOMETHING_NEW' }), o); ok(d.action === 'ignore', 'unknown event ignored');
ok(pickUserId({ app_user_id: 'x', original_app_user_id: 'y' }) === null, 'no uuid → null');
ok(isUuid(U) && !isUuid('nope') && !isUuid("'; drop table"), 'uuid check');

// subscriber API (restore)
const sub = (ent, subs) => ({ subscriber: { entitlements: ent ? { premium: ent } : {}, subscriptions: subs || {} } });
let u = fromSubscriber(sub({ expires_date: new Date(NOW + 10 * D).toISOString(), product_identifier: 'p' }, { p: { store: 'app_store', period_type: 'normal' } }), { entitlementId: 'premium', now: NOW });
ok(u.plan === 'premium' && u.status === 'active' && u.willRenew === true && u.store === 'app_store', 'restore active');
u = fromSubscriber(sub({ expires_date: new Date(NOW + 10 * D).toISOString(), product_identifier: 'p' }, { p: { store: 'play_store', unsubscribe_detected_at: 'x' } }), { entitlementId: 'premium', now: NOW });
ok(u.plan === 'premium' && u.willRenew === false, 'restore cancelled-but-active');
u = fromSubscriber(sub({ expires_date: new Date(NOW - D).toISOString(), product_identifier: 'p' }, { p: {} }), { entitlementId: 'premium', now: NOW });
ok(u.plan === 'free', 'restore expired → free');
u = fromSubscriber(sub(null), { entitlementId: 'premium', now: NOW }); ok(u.plan === 'free', 'no entitlement → free');
u = fromSubscriber(sub({ expires_date: new Date(NOW + D).toISOString(), product_identifier: 'p' }, { p: { is_sandbox: true } }), { entitlementId: 'premium', now: NOW });
ok(u.plan === 'free', 'sandbox subscription never grants');
u = fromSubscriber(sub({ expires_date: new Date(NOW + D).toISOString(), product_identifier: 'p' }, { p: { is_sandbox: true, store: 'stripe' } }), { entitlementId: 'premium', now: NOW, allowSandbox: true });
ok(u.plan === 'premium', 'sandbox subscription grants when testing is switched on (so restore does not undo a test purchase)');
u = fromSubscriber({}, { entitlementId: 'premium', now: NOW }); ok(u.plan === 'free', 'garbage → free');
ok(timingSafeEqual('abc', 'abc') && !timingSafeEqual('abc', 'abd') && !timingSafeEqual('abc', 'abcd') && !timingSafeEqual('', 'x'), 'secret compare');
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
