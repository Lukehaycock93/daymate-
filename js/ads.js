/* ==========================================================================
   DAYMATE — advertising for FREE accounts only

   • Premium accounts never see an advert and nothing from an ad network is ever
     requested for them. While a signed-in person's plan is still loading, no ad is shown.
   • No ad provider configured (config.js) → no ads and no placeholders at all. There are
     no fake adverts.
   • Ad cookies need the person's OK (a card in the ad space, not a pop-up). "No thanks"
     means the ad network is never contacted. They can change their mind in Settings.
   • Only non-personalised ads are requested. DAYMATE sends the ad network nothing about
     tasks, memories, names or emails.
   • Ads sit at the bottom of Home, Planner and More — never over a form, the assistant,
     a sheet, or a button. Each ad is loaded once, not on every screen refresh.
   • Provider adapters: 'adsense' now (web). Native AdMob arrives with the Capacitor apps.
   ========================================================================== */
import { CONFIG } from './config.js';

const KEY = 'daymate:adsConsent';
const PLACEMENTS = { home: '#view-home', planner: '#view-planner', more: '#view-more' };
const CLIENT_RE = /^ca-pub-\d{10,20}$/;
const SLOT_RE = /^\d{6,20}$/;

/** Does the person's account qualify for ads right now? Pure — unit-tested. */
export function adsEligible({ user, entitlement, plan, configured, native }) {
  if (!configured || native) return false;
  if (plan === 'premium') return false;
  if (user && !entitlement) return false;          // signed in but plan not known yet: stay quiet
  return true;
}

const readChoice = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && (v.ads === 'allow' || v.ads === 'deny') ? v.ads : null; } catch (_) { return null; } };
const writeChoice = (ads) => { try { localStorage.setItem(KEY, JSON.stringify({ ads, at: new Date().toISOString(), v: 1 })); } catch (_) { /* lasts this visit only */ } };

export function initAds(DM) {
  const { Account, helpers } = DM;
  const { esc, icon } = helpers;
  const cfg = CONFIG.ads || {};
  const configured = cfg.provider === 'adsense' && CLIENT_RE.test(cfg.adsenseClient || '');
  const nodes = {};            // placement -> persistent DOM node (so an ad is requested once)
  let choice = readChoice();
  let scriptLoaded = false;

  const isNative = () => !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  const eligible = () => adsEligible({ user: Account.user, entitlement: Account.entitlement, plan: Account.getPlan(), configured, native: isNative() });

  function loadScript() {
    if (scriptLoaded) return;
    scriptLoaded = true;
    window.adsbygoogle = window.adsbygoogle || [];
    window.adsbygoogle.requestNonPersonalizedAds = 1;
    const s = document.createElement('script');
    s.async = true; s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cfg.adsenseClient)}`;
    document.head.appendChild(s);
  }

  function consentCard() {
    return `<p class="ad-slot__label">Advertisement</p>
      <div class="ad-consent">
        <p><strong>Adverts keep DAYMATE free.</strong> Allow ad cookies to see non-personalised ads. Nothing from your planner is shared. Premium removes ads completely.</p>
        <div class="ad-consent__btns">
          <button type="button" class="btn btn--primary" data-ads-choice="allow">Allow ads</button>
          <button type="button" class="btn btn--ghost" data-ads-choice="deny">No thanks</button>
        </div>
        <a class="consent__link" href="privacy.html#ads">How ads work</a>
      </div>`;
  }

  function adNode(placement) {
    const slot = (cfg.slots || {})[placement];
    if (!SLOT_RE.test(slot || '')) return null;      // no ad unit for this placement → nothing shown
    const el = document.createElement('aside');
    el.className = 'ad-slot';
    el.setAttribute('aria-label', 'Advertisement');
    el.innerHTML = `<p class="ad-slot__label">Advertisement · <button type="button" class="link-btn" data-action="open-premium" data-feature="ad-free">Remove ads</button></p>
      <ins class="adsbygoogle" style="display:block" data-ad-client="${esc(cfg.adsenseClient)}" data-ad-slot="${esc(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    return el;
  }

  function remove() { Object.values(nodes).forEach((n) => n && n.remove()); }

  function sync() {
    if (!eligible()) { remove(); const f = document.getElementById('adsField'); if (f) f.remove(); return; }
    if (choice === 'deny') { remove(); return; }
    if (choice === 'allow') loadScript();      // only ever for an eligible Free account
    Object.entries(PLACEMENTS).forEach(([placement, sel]) => {
      const host = document.querySelector(sel);
      if (!host || host.hidden) return;
      if (choice === null) {
        // One calm consent card (on Home only) in the ad position until they choose.
        if (placement !== 'home') return;
        let card = nodes.consent;
        if (!card) {
          card = document.createElement('aside');
          card.className = 'ad-slot ad-slot--consent';
          card.innerHTML = consentCard();
          nodes.consent = card;
        }
        if (card.parentNode !== host) host.appendChild(card);
        return;
      }
      if (!(placement in nodes)) { nodes[placement] = adNode(placement); }
      const n = nodes[placement];
      if (!n) return;
      if (n.parentNode !== host) {
        host.appendChild(n);
        if (!n.dataset.requested) {
          n.dataset.requested = '1';
          try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (_) { /* ad blocked: the slot just stays empty */ }
        }
      }
    });
  }

  function choose(value) {
    choice = value; writeChoice(value);
    if (nodes.consent) { nodes.consent.remove(); delete nodes.consent; }
    if (value === 'allow') loadScript();
    sync();
    settingsRow();
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ads-choice]');
    if (b) choose(b.dataset.adsChoice);
  });

  function settingsRow() {
    const about = document.getElementById('settingsAbout');
    if (!about || !configured || !eligible()) { const old = document.getElementById('adsField'); if (old) old.remove(); return; }
    let box = document.getElementById('adsField');
    if (!box) { box = document.createElement('div'); box.className = 'field'; box.id = 'adsField'; about.parentNode.insertBefore(box, about); }
    const on = choice === 'allow';
    box.innerHTML = `<span class="field__label">Adverts</span>
      <button type="button" class="row" data-ads-choice="${on ? 'deny' : 'allow'}" role="switch" aria-checked="${on}">
        <span class="row__icon">${icon('sliders')}</span>
        <span class="row__text"><strong>Ad cookies: ${on ? 'On' : 'Off'}</strong><small>${on ? 'Tap to turn ads off' : 'Tap to allow non-personalised ads'}</small></span>
      </button>
      <button type="button" class="row" data-action="open-premium" data-feature="ad-free"><span class="row__icon">${icon('shield')}</span><span class="row__text"><strong>Remove ads with Premium</strong><small>No adverts, ever</small></span></button>`;
  }

  DM.onRender(sync);
  DM.onSettingsOpen(settingsRow);
  window.addEventListener('hashchange', () => setTimeout(sync, 0));
  sync();
}
