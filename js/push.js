/* ==========================================================================
   DAYMATE — Web Push (browser side)

   Permission is ONLY ever requested from enable(), which is only called from a
   deliberate tap on "Turn on phone notifications". Nothing runs on page load
   except a silent re-registration for people who already opted in.
   The server (Supabase Edge Function + pg_cron) does the scheduling and sending.
   ========================================================================== */
import { CONFIG } from './config.js';
import { session } from './session.js';

const b64ToU8 = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

/** state: unsupported | ios-install | unconfigured | signed-out | denied | off | on */
export async function getStatus(DM) {
  const { isIOS, isStandalone } = DM.helpers;
  if (isIOS() && !isStandalone()) return { state: 'ios-install' };            // iPhone only offers web push to Home Screen apps
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { state: 'unsupported' };
  if (!CONFIG.vapidPublicKey) return { state: 'unconfigured' };
  if (!session.user) return { state: 'signed-out' };
  if (Notification.permission === 'denied') return { state: 'denied' };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub && Notification.permission === 'granted' && DM.Store.state.settings.notify.push) return { state: 'on', endpoint: sub.endpoint };
  } catch (_) { /* fall through */ }
  return { state: 'off' };
}

async function register(sub) {
  const j = sub.toJSON();
  const { error } = await session.client.rpc('register_push_subscription', {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

/** Must be called from a click/tap handler. */
export async function enable(DM) {
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission === 'denied' ? 'denied' : 'dismissed' };
  const reg = await withTimeout(navigator.serviceWorker.ready, 8000, 'The app is still starting. Try again in a moment.');
  const key = b64ToU8(CONFIG.vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
    catch (err) {
      if (err && err.name === 'InvalidStateError') { const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
      else throw err;
    }
  }
  await register(sub);
  DM.Store.setSettings({ notify: { ...DM.Store.state.settings.notify, push: true } });
  DM.storage.safeLS.set(`daymate:pushEndpoint:${session.user.id}`, sub.endpoint);
  return { ok: true };
}

export async function disable(DM) {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      if (session.client) await session.client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (err) { console.warn('[DAYMATE] Could not fully remove this device:', err); }
  DM.Store.setSettings({ notify: { ...DM.Store.state.settings.notify, push: false } });
}

/** On sign-out: stop this browser receiving the previous user's notifications. */
export async function detachThisDevice() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) { if (session.client) await session.client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch (_) { /* best effort */ }
}

/** Silent: keeps an already-granted subscription registered (endpoints can rotate). Never prompts. */
export async function resyncIfOptedIn(DM) {
  try {
    if (!session.user || !CONFIG.vapidPublicKey || !('PushManager' in window) || Notification.permission !== 'granted') return;
    if (!DM.Store.state.settings.notify.push) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(CONFIG.vapidPublicKey) });
    await register(sub);
    DM.storage.safeLS.set(`daymate:pushEndpoint:${session.user.id}`, sub.endpoint);
  } catch (err) { console.warn('[DAYMATE] Push re-registration skipped:', err && err.message); }
}

/** Asks the server to push a real notification to this account's devices (true end-to-end check). */
export async function sendTest() {
  const { data, error } = await session.client.functions.invoke('send-test-notification', { body: {} });
  if (error) throw error;
  return data;
}
