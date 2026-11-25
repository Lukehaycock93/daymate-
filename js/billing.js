/* ==========================================================================
   DAYMATE — Premium paywall + purchases (RevenueCat)

   • The browser NEVER decides who is Premium. A purchase goes to the store /
     RevenueCat; then the server (Edge Function `revenuecat`) re-checks with
     RevenueCat and writes the read-only `entitlements` row. The app just reads
     that row. Expiry, cancellation and lifetime access are all decided there.
   • Web/PWA purchases use RevenueCat Web Billing; the Capacitor apps will use the
     RevenueCat native plugin (Apple App Store / Google Play).
   • No key configured  → the screen says purchases aren't open yet. Nothing is charged.
   ========================================================================== */
import { CONFIG } from './config.js';
import { session } from './session.js';

export const PRICE_LABEL = '£2.99';

const RC = () => CONFIG.revenuecat || {};
const nativePlugin = () => {
  const c = window.Capacitor;
  return c && typeof c.isNativePlatform === 'function' && c.isNativePlatform() && c.Plugins && c.Plugins.Purchases ? c.Plugins.Purchases : null;
};
const nativeKey = () => {
  const c = window.Capacitor;
  const plat = c && typeof c.getPlatform === 'function' ? c.getPlatform() : '';
  return plat === 'ios' ? RC().nativeApiKeyApple : plat === 'android' ? RC().nativeApiKeyGoogle : '';
};

/** 'native' | 'web' | 'off' — how a purchase can be made in this copy of the app. */
export function purchaseMode() {
  if (nativePlugin() && nativeKey()) return 'native';
  if (!nativePlugin() && RC().webPublicKey) return 'web';
  return 'off';
}

/** What the Premium screen should show for an entitlement. Pure, so it is unit-tested. */
export function describePlan(account, now = new Date()) {
  const e = account.entitlement;
  const premium = account.getPlan() === 'premium';
  if (!premium) {
    const lapsed = !!e && e.source !== 'lifetime' && !!e.currentPeriodEnd && (e.plan === 'premium' || (e.source === 'revenuecat' && e.status === 'canceled'));   // only if there really was a subscription
    return { premium: false, lifetime: false, line: lapsed ? 'Your Premium has ended — you’re back on the Free plan. Your data is all still here.' : 'You’re on the Free plan', canManage: false };
  }
  if (e.source === 'lifetime') return { premium: true, lifetime: true, line: 'Lifetime Premium — thank you for backing DAYMATE', canManage: false };
  const end = e.currentPeriodEnd ? new Date(e.currentPeriodEnd) : null;
  const when = end && end > now ? end.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const line = e.status === 'trialing' ? `Free trial${when ? ` until ${when}` : ''}`
    : e.willRenew === false ? `Premium until ${when || 'the end of this period'} — won’t renew`
      : `Premium${when ? ` — renews on ${when}` : ''}`;
  return { premium: true, lifetime: false, line, canManage: true };
}

export function manageUrl(store) {
  if (store === 'app_store') return 'https://apps.apple.com/account/subscriptions';
  if (store === 'play_store') return 'https://play.google.com/store/account/subscriptions';
  return '';
}

const BENEFITS = [
  { icon: 'shield', title: 'No adverts, anywhere', text: 'Premium removes every advert from DAYMATE.', live: true },
  { icon: 'sparkles', title: 'Advanced AI assistant', text: 'Ten times the daily messages, and it can see 30 days of your plans instead of 7.', live: true },
  { icon: 'bell', title: 'Enhanced reminders', text: 'Be reminded more than once — up to four times before something is due.', live: true },
  { icon: 'sparkles', title: 'Long-term AI memory', text: 'DAYMATE suggests things worth remembering, for you to approve.', live: false },
  { icon: 'clock', title: 'Advanced scheduling', text: 'A suggested plan for your day, built around your commitments.', live: false },
  { icon: 'calendar-check', title: 'Morning briefings', text: 'A daily summary of your day, sent to your phone.', live: false },
];
const COMPARE = [
  ['Adverts', 'Yes', 'None'],
  ['AI messages per day', '10', '100'],
  ['AI sees your plans', '7 days', '30 days'],
  ['Reminder times', 'One', 'Up to four'],
  ['Tasks, planner, reminders', 'Included', 'Included'],
];

export function initBilling(DM) {
  const { Account, UI, Modal, helpers } = DM;
  const { esc, icon } = helpers;
  const st = { busy: false, note: '', sdk: null, sdkUser: '', offering: null };

  /* ---------------- server round-trips ---------------- */
  async function pullPlan() {
    if (!session.client || !session.user) return;
    const { data } = await session.client.from('entitlements').select('plan,status,current_period_end,source,will_renew,store').eq('user_id', session.user.id).maybeSingle();
    if (data) Account.set({ entitlement: { plan: data.plan, status: data.status, currentPeriodEnd: data.current_period_end, source: data.source, willRenew: data.will_renew, store: data.store } });
  }
  /** Ask the server to re-check with RevenueCat, then re-read the (read-only) entitlement. */
  async function verifyOnServer() {
    const { data, error } = await session.client.functions.invoke('revenuecat', { body: { action: 'refresh' } });
    await pullPlan();
    if (error) return { ok: false };
    return { ok: true, plan: data && data.plan };
  }
  async function waitForPlan(tries = 4) {
    for (let i = 0; i < tries && Account.getPlan() !== 'premium'; i++) { await new Promise((r) => setTimeout(r, 2500)); await pullPlan(); }
  }

  /* ---------------- RevenueCat SDKs ---------------- */
  async function webSdk() {
    if (!st.sdk) {
      const mod = await import(`https://cdn.jsdelivr.net/npm/@revenuecat/purchases-js@${encodeURIComponent(RC().sdkVersion)}/+esm`);
      st.sdk = mod;
    }
    const { Purchases } = st.sdk;
    if (st.sdkUser !== session.user.id) {
      if (st.sdkUser) Purchases.getSharedInstance().changeUser(session.user.id);
      else Purchases.configure({ apiKey: RC().webPublicKey, appUserId: session.user.id });
      st.sdkUser = session.user.id;
    }
    return Purchases.getSharedInstance();
  }
  async function nativeSdk() {
    const P = nativePlugin();
    if (st.sdkUser !== session.user.id) {
      if (!st.sdkUser) await P.configure({ apiKey: nativeKey(), appUserID: session.user.id });
      else await P.logIn({ appUserID: session.user.id });
      st.sdkUser = session.user.id;
    }
    return P;
  }

  /* ---------------- actions ---------------- */
  function goSignIn() { Modal.close('m-premium'); window.location.assign('#/more'); UI.toast('Sign in or create an account, then upgrade.'); }
  function say(msg) { st.note = msg; render(); }

  async function upgrade() {
    if (st.busy) return;
    if (!session.user) return goSignIn();
    const mode = purchaseMode();
    if (mode === 'off') return say('Subscriptions aren’t open in this version yet. Nothing has been charged.');
    st.busy = true; say('');
    try {
      if (mode === 'web') {
        const p = await webSdk();
        const offerings = await p.getOfferings();
        const off = (RC().offeringId && offerings.all && offerings.all[RC().offeringId]) || offerings.current;
        const pkg = off && off.availablePackages && (off.monthly || off.availablePackages[0]);
        if (!pkg) throw new Error('no_package');
        await p.purchase({ rcPackage: pkg });
      } else {
        const P = await nativeSdk();
        const { current } = await P.getOfferings();
        const pkg = current && current.availablePackages && (current.monthly || current.availablePackages[0]);
        if (!pkg) throw new Error('no_package');
        await P.purchasePackage({ aPackage: pkg });
      }
      say('Thanks! Confirming your purchase…');
      await verifyOnServer();
      await waitForPlan();
      if (Account.getPlan() === 'premium') UI.toast('Welcome to Premium!');
      else say('Your purchase went through but hasn’t been confirmed yet. It will show here shortly — or tap Restore purchases.');
    } catch (err) {
      const cancelled = err && (err.errorCode === 1 || err.userCancelled === true || /cancel/i.test(String(err.message || '')));
      say(cancelled ? '' : 'Sorry, the purchase didn’t complete. You haven’t been charged. Please try again.');
    } finally { st.busy = false; render(); }
  }

  async function restore() {
    if (st.busy) return;
    if (!session.user) return say('Sign in first — your subscription is linked to your DAYMATE account.');
    st.busy = true; say('Checking for your subscription…');
    try {
      const mode = purchaseMode();
      if (mode === 'native') { const P = await nativeSdk(); await P.restorePurchases(); }
      const r = await verifyOnServer();
      if (!r.ok) say('We couldn’t reach the subscription service. Please try again in a minute.');
      else say(Account.getPlan() === 'premium' ? 'Premium restored.' : 'No active subscription found for this account.');
    } catch (_) { say('Restore didn’t work this time. Please try again.'); }
    finally { st.busy = false; render(); }
  }

  function manage() {
    const url = manageUrl(Account.entitlement && Account.entitlement.store);
    if (url) window.open(url, '_blank', 'noopener');
    else say('Manage or cancel from the email receipt we sent you, or contact support from the privacy page.');
  }

  /* ---------------- the Premium screen ---------------- */
  function render() {
    const scroll = document.getElementById('premiumScroll');
    const actions = document.getElementById('premiumActions');
    if (!scroll || !actions) return;
    const info = describePlan(Account);
    const mode = purchaseMode();
    const signedIn = !!Account.user;
    const top = scroll.scrollTop;

    scroll.innerHTML = `
      <div class="phero">
        <span class="phero__badge">${icon('sparkles')}</span>
        <h2 id="premiumTitle">DAYMATE Premium</h2>
        ${info.premium ? '' : `<p class="pprice"><strong>${PRICE_LABEL}</strong> <span>/ month</span></p>`}
        <p class="phero__lead">${info.premium ? 'Thank you for supporting DAYMATE. Everything below is switched on for you.' : 'Everything free stays free. Premium removes the adverts and gives DAYMATE a smarter, more generous assistant.'}</p>
        <p class="plan-pill"><span class="plan-pill__dot"></span>${esc(info.line)}</p>
      </div>
      <p class="padfree">${icon('shield')}<span><strong>Premium is completely ad-free.</strong> Free accounts see a small number of adverts.</span></p>

      <h3 class="psub">What you get</h3>
      <ul class="pfeats" id="premiumFeatures">
        ${BENEFITS.map((b) => `<li class="pfeat" data-feature="${b.title === 'No adverts, anywhere' ? 'ad-free' : b.title === 'Advanced AI assistant' ? 'ai-assistant' : b.title === 'Enhanced reminders' ? 'smart-reminders' : b.title === 'Long-term AI memory' ? 'ai-memory' : b.title === 'Advanced scheduling' ? 'smart-scheduling' : 'morning-briefing'}">
          <span class="pfeat__icon">${icon(b.icon)}</span>
          <span class="pfeat__text"><strong>${esc(b.title)}</strong><small>${esc(b.text)}</small></span>
          ${b.live ? `<span class="pfeat__tag pfeat__tag--live">${info.premium ? 'On' : 'Included'}</span>` : '<span class="pfeat__tag">Coming soon</span>'}
        </li>`).join('')}
      </ul>

      <h3 class="psub">Free vs Premium</h3>
      <table class="pcompare" aria-label="Free compared with Premium">
        <thead><tr><th></th><th>Free</th><th>Premium</th></tr></thead>
        <tbody>${COMPARE.map(([a, f, p]) => `<tr><th scope="row">${esc(a)}</th><td>${esc(f)}</td><td>${esc(p)}</td></tr>`).join('')}</tbody>
      </table>

      <p class="fine">Your tasks, reminders, memories and chats always stay yours. If Premium ends you go back to Free and keep all your saved data.</p>
      <div class="pterms">
        <h3 class="psub">Subscription terms</h3>
        <p class="fine">${PRICE_LABEL} per month, charged to your Apple ID, Google Play account or card at confirmation. The subscription renews automatically each month unless you cancel at least 24 hours before the end of the current period. Cancel any time in your store’s subscription settings — you keep Premium until the period ends and aren’t charged again. Subscriptions are linked to your DAYMATE account, so sign in to restore them on a new device.</p>
        <p class="fine"><a href="privacy.html">Privacy policy</a> · <a href="terms.html">Terms of use</a></p>
      </div>`;
    scroll.scrollTop = top;

    const note = st.note ? `<p class="pnote" role="status">${esc(st.note)}</p>` : '';
    let main;
    if (info.lifetime) main = `<p class="pnote pnote--ok">${icon('check')} Lifetime Premium is active on this account.</p>`;
    else if (info.premium) main = `<button type="button" class="btn btn--gold" data-action="manage-subscription">Manage subscription</button>`;
    else if (!signedIn) main = `<button type="button" class="btn btn--gold" data-action="premium-signin">Sign in to upgrade</button>`;
    else if (mode === 'off') main = `<button type="button" class="btn btn--gold" disabled>Subscriptions open soon</button><p class="pnote">Purchases aren’t switched on in this version yet. Nothing will be charged.</p>`;
    else main = `<button type="button" class="btn btn--gold" data-action="upgrade-premium" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Please wait…' : `Upgrade — ${PRICE_LABEL}/month`}</button>`;
    actions.innerHTML = `${note}${main}
      ${info.premium ? '' : `<button type="button" class="btn btn--ghost" data-action="restore-purchases" ${st.busy ? 'disabled' : ''}>Restore purchases</button>`}
      <button type="button" class="btn btn--ghost" data-action="close-modal">${info.premium ? 'Close' : 'Continue with Free'}</button>`;
  }

  DM.setPremiumRenderer(render);
  DM.registerActions({
    'upgrade-premium': upgrade,
    'restore-purchases': restore,
    'manage-subscription': manage,
    'premium-signin': goSignIn,
  });
  // After sign-in or a plan change, keep the screen current.
  DM.onRender(() => { if (Modal.isOpen('m-premium')) render(); });
}
