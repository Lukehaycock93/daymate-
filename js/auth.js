/* ==========================================================================
   DAYMATE — accounts (Supabase Auth)
   Sign up · sign in · sign out · password reset · session handling · account UI.
   Signed-out use is fully supported: with no account, DAYMATE behaves as in Part 1.
   ========================================================================== */
import { configProblem, isConfigured, getClient, redirectUrl } from './supabase.js';
import { session } from './session.js';
import { createSync } from './sync.js';
import { detectLocalData, migrate, skipKey } from './migration.js';
import * as push from './push.js';

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function initAuth(DM) {
  const { Account, Store, UI, Modal, confirmDialog, helpers, storage } = DM;
  const { $, esc, icon, plural, safeLS } = helpers;
  const LAST = DM.APP.lastUserKey;
  let mode = 'signin';
  let busy = false;
  let authToken = 0;

  Account.configured = isConfigured();

  const readHint = () => { try { const h = JSON.parse(safeLS.get(LAST) || 'null'); return h && h.id ? h : null; } catch (_) { return null; } };

  /* ----------------------------- UI: sign-in sheet ----------------------------- */
  const MODES = {
    signin:  { heading: 'Welcome back',        lead: 'Sign in to see your DAYMATE on every device.', submit: 'Sign in',            name: false, email: true,  pass: true,  forgot: true,  switchText: 'New here? Create an account', switchTo: 'signup' },
    signup:  { heading: 'Create your account', lead: 'Back up your tasks, reminders and memories, and use DAYMATE anywhere.', submit: 'Create account', name: true, email: true, pass: true, forgot: false, switchText: 'Already have an account? Sign in', switchTo: 'signin' },
    reset:   { heading: 'Reset your password', lead: 'Enter your email and we’ll send you a link to choose a new password.', submit: 'Send reset link', name: false, email: true, pass: false, forgot: false, switchText: 'Back to sign in', switchTo: 'signin' },
    newpass: { heading: 'Choose a new password', lead: `At least ${MIN_PASSWORD} characters.`, submit: 'Save new password', name: false, email: false, pass: true, forgot: false, switchText: '', switchTo: '' },
  };

  function setMode(next) {
    mode = next;
    const m = MODES[next];
    $('#authHeading').textContent = m.heading;
    $('#authLead').textContent = m.lead;
    $('#authSubmit').textContent = m.submit;
    $('#authNameField').hidden = !m.name;
    $('#authEmailField').hidden = !m.email;
    $('#authPassField').hidden = !m.pass;
    $('#authForgot').hidden = !m.forgot;
    const sw = $('#authSwitch'); sw.hidden = !m.switchTo; sw.textContent = m.switchText; sw.dataset.mode = m.switchTo;
    const pw = $('#authPass');
    pw.autocomplete = next === 'signin' ? 'current-password' : 'new-password';
    pw.value = ''; pw.type = 'password'; $('#authPwToggle').textContent = 'Show';
    $('#authPassHint').textContent = next === 'signin' ? '' : `Use at least ${MIN_PASSWORD} characters.`;
    showMsg('', '');
    $('#authForm').hidden = false; $('#authDone').hidden = true;
    $('#authSubmit').hidden = false;
  }

  function showMsg(error, info) {
    $('#authError').textContent = error || '';
    const i = $('#authInfo'); i.textContent = info || ''; i.hidden = !info;
  }

  function showDone(title, text) {
    $('#authForm').hidden = true; $('#authDone').hidden = false; $('#authSubmit').hidden = true;
    $('#authDoneTitle').textContent = title; $('#authDoneText').textContent = text;
  }

  function openAuth(m = 'signin') {
    const problem = configProblem();
    $('#authSetup').hidden = !problem;
    $('#authBody').hidden = !!problem;
    $('#authSubmit').hidden = !!problem;
    if (problem) {
      const msgs = {
        'not-set': 'Accounts aren’t switched on in this copy of DAYMATE yet. Add your Supabase project URL and public (anon) key to js/config.js. SETUP.md walks through it.',
        'bad-url': 'The Supabase URL in js/config.js doesn’t look right. It should look like https://your-project.supabase.co.',
        'no-key': 'js/config.js has a Supabase URL but no public (anon) key.',
        'private-key': 'js/config.js contains a PRIVATE Supabase key. Remove it immediately and use the public anon key instead. Private keys must never be in the app.',
      };
      $('#authSetupText').textContent = msgs[problem] || msgs['not-set'];
    } else setMode(m);
    Modal.open('m-auth', { focus: problem ? null : (m === 'signup' ? '#authName' : '#authEmail') });
  }

  async function submitAuth(e) {
    e.preventDefault();
    if (busy) return;
    const email = $('#authEmail').value.trim();
    const password = $('#authPass').value;
    const name = helpers.cleanText($('#authName').value, 30);
    const m = MODES[mode];
    if (m.email && !EMAIL_RE.test(email)) { showMsg('Enter a valid email address.', ''); $('#authEmail').focus(); return; }
    if (mode !== 'signin' && m.pass && password.length < MIN_PASSWORD) { showMsg(`Your password needs at least ${MIN_PASSWORD} characters.`, ''); $('#authPass').focus(); return; }
    if (mode === 'signin' && !password) { showMsg('Enter your password.', ''); $('#authPass').focus(); return; }

    busy = true; const btn = $('#authSubmit'); const label = btn.textContent; btn.disabled = true; btn.textContent = 'One moment…'; showMsg('', '');
    try {
      const client = await getClient();
      if (mode === 'signin') {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        Modal.close('m-auth');
      } else if (mode === 'signup') {
        const { data, error } = await client.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: redirectUrl() } });
        if (error) throw error;
        if (data.session) Modal.close('m-auth');       // email confirmation switched off in Supabase
        else showDone('Check your email', `We’ve sent a confirmation link to ${email}. Open it on this device to finish creating your account.`);
      } else if (mode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
        if (error && error.status && error.status !== 400 && error.status !== 422) throw error;
        // Same message whether or not the account exists, so this can't be used to discover accounts.
        showDone('Check your email', 'If an account exists for that address, a password reset link is on its way. It can take a minute to arrive.');
      } else if (mode === 'newpass') {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        Modal.close('m-auth');
        UI.toast('Password updated');
      }
    } catch (err) {
      showMsg(friendlyError(err), '');
    } finally {
      busy = false; btn.disabled = false; if (!btn.hidden) btn.textContent = label;
    }
  }

  function friendlyError(err) {
    const msg = String((err && err.message) || err || '');
    if (/invalid login|invalid credentials/i.test(msg)) return 'That email and password don’t match. Check them and try again.';
    if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link we sent.';
    if (/already registered|already been registered/i.test(msg)) return 'An account with that email already exists. Try signing in instead.';
    if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
    if (/password/i.test(msg) && /(weak|short|least|characters)/i.test(msg)) return msg;
    if (/failed to fetch|network|load failed/i.test(msg) || !navigator.onLine) return 'Couldn’t reach DAYMATE. Check your connection and try again.';
    return 'Something went wrong. Please try again.';
  }

  /* ----------------------------- session lifecycle ----------------------------- */
  async function onSignedIn(user) {
    const token = ++authToken;
    const cacheKey = storage.userCacheKey(user.id);
    safeLS.set(LAST, JSON.stringify({ id: user.id, email: user.email || '' }));
    if (Store.adapterKey !== cacheKey) await Store.useAdapter(storage.localAdapter(cacheKey));
    Store.setTracking(true);
    session.user = user;
    Account.set({ user: { id: user.id, email: user.email || '' }, syncState: 'syncing' });
    if (session.sync) session.sync.stop();
    session.sync = createSync({ client: session.client, user, DM });
    await session.sync.start();
    if (token !== authToken) return;
    push.resyncIfOptedIn(DM);
    await offerMigration();
  }

  async function onSignedOutLocal({ wipeCache = true } = {}) {
    authToken++;
    const prev = session.user || readHint();
    if (session.sync) { session.sync.stop(); session.sync.forgetCursor(); session.sync = null; }
    Store.setTracking(false);
    safeLS.del(LAST);
    session.user = null;
    await Store.useAdapter(storage.localAdapter(DM.APP.storageKey));
    if (prev && wipeCache) safeLS.del(storage.userCacheKey(prev.id));
    Account.set({ user: null, entitlement: null, syncState: 'local', syncDetail: '' });
  }

  async function signOut() {
    if (session.sync) {
      const ok = await session.sync.sync().catch(() => false);
      if (!ok || session.sync.hasPending()) {
        const yes = await confirmDialog({ title: 'Some changes haven’t synced', message: 'Signing out now would lose changes that haven’t reached your account yet. Stay signed in so they can sync, or sign out anyway?', okLabel: 'Sign out anyway' });
        if (!yes) return;
      }
    }
    await push.detachThisDevice();
    try { await session.client.auth.signOut({ scope: 'local' }); } catch (_) { /* local state is cleared below regardless */ }
    await onSignedOutLocal();
    Modal.close('m-settings');
    UI.toast('Signed out. Your data has been removed from this device.');
  }

  async function deleteAccount() {
    const yes = await confirmDialog({ title: 'Delete your account?', message: 'This permanently deletes your DAYMATE account and everything saved in it: tasks, reminders, shopping, memories and notifications. It can’t be undone.', okLabel: 'Delete everything' });
    if (!yes) return;
    try {
      const { error } = await session.client.functions.invoke('delete-account', { body: {} });
      if (error) throw error;
      await push.detachThisDevice();
      try { await session.client.auth.signOut({ scope: 'local' }); } catch (_) { /* ignore */ }
      await onSignedOutLocal();
      Modal.close('m-settings');
      UI.toast('Your account has been deleted.');
    } catch (err) {
      console.warn('[DAYMATE] Account deletion failed:', err);
      UI.toast('Couldn’t delete your account. Please try again.');
    }
  }

  /* ----------------------------- migration UI ----------------------------- */
  let migrating = false;
  async function offerMigration(force = false) {
    const found = detectLocalData(DM);
    if (!found || !session.user) return;
    if (!force && safeLS.get(skipKey(session.user.id)) === found.fingerprint) return;
    const c = found.counts;
    const parts = [c.tasks && plural(c.tasks, 'task', 'tasks'), c.reminders && plural(c.reminders, 'reminder or appointment', 'reminders and appointments'),
      c.shopping && plural(c.shopping, 'shopping item', 'shopping items'), c.memories && plural(c.memories, 'memory', 'memories')].filter(Boolean);
    $('#migrateList').innerHTML = parts.length ? parts.map((p) => `<li>${esc(p)}</li>`).join('') : '<li>Your name and settings</li>';
    setMigrateView('ask');
    Modal.open('m-migrate');
  }

  function setMigrateView(view, text = '') {
    ['ask', 'busy', 'ok', 'fail'].forEach((v) => { $(`#migrate-${v}`).hidden = v !== view; });
    if (view === 'busy') $('#migrateBusyText').textContent = text;
    if (view === 'ok') $('#migrateOkText').textContent = text;
    if (view === 'fail') $('#migrateFailText').textContent = text;
  }

  async function runMigration() {
    if (migrating) return;
    migrating = true;
    setMigrateView('busy', 'Starting…');
    const res = await migrate({ DM, session, onProgress: (t) => setMigrateView('busy', t) });
    migrating = false;
    if (res.ok) {
      setMigrateView('ok', res.nothing ? 'Nothing to move.' : `${plural(res.added, 'item', 'items')} moved to your account${res.duplicates ? `, ${plural(res.duplicates, 'duplicate', 'duplicates')} skipped` : ''}. The copy on this device was only removed after everything was confirmed.`);
      Account.set({});
    } else setMigrateView('fail', `${res.error} Nothing has been removed from this device, so you can safely try again.`);
  }

  /* ----------------------------- settings: account section ----------------------------- */
  function renderAccountSection() {
    const host = $('#accountSection');
    if (!host) return;
    const planLine = Account.getPlan() === 'premium' ? 'Premium' : 'Free plan';
    const stateText = { syncing: 'Syncing…', synced: 'Up to date', offline: 'Offline. Will sync when you’re back online', error: Account.syncDetail || 'Sync problem. Will retry', local: '' }[Account.syncState] || '';
    if (!Account.user) {
      host.innerHTML = `
        <span class="field__label">Account</span>
        <div class="acct">
          <p class="acct__line"><strong>Not signed in</strong><br><small>Your data is stored on this device only. Sign in to back it up and use DAYMATE on other devices.</small></p>
          <button type="button" class="btn btn--primary" data-action="open-auth" data-mode="signin">Sign in or create account</button>
        </div>`;
      return;
    }
    const local = detectLocalData(DM);
    host.innerHTML = `
      <span class="field__label">Account</span>
      <div class="acct">
        <p class="acct__line"><strong>${esc(Account.user.email || 'Signed in')}</strong><br><small>${esc(planLine)} · ${esc(stateText)}</small></p>
        ${local ? `<button type="button" class="row" data-action="migrate-now"><span class="row__icon">${icon('download')}</span><span class="row__text"><strong>Move device data to my account</strong><small>${esc(plural(local.total, 'item', 'items'))} found on this device</small></span></button>` : ''}
        <button type="button" class="row" data-action="sync-now"><span class="row__icon">${icon('repeat')}</span><span class="row__text"><strong>Sync now</strong><small>Check for changes from your other devices</small></span></button>
        <button type="button" class="row" data-action="sign-out"><span class="row__icon">${icon('lock')}</span><span class="row__text"><strong>Sign out</strong><small>Removes your data from this device. It stays safe in your account.</small></span></button>
        <button type="button" class="row row--danger" data-action="delete-account"><span class="row__icon">${icon('trash')}</span><span class="row__text"><strong>Delete my account</strong><small>Permanently removes your account and all its data</small></span></button>
      </div>`;
  }

  /* ----------------------------- wiring ----------------------------- */
  DM.registerActions({
    'open-auth': (el) => openAuth((el && el.dataset && el.dataset.mode) || 'signin'),
    'auth-mode': (el) => { if (el.dataset.mode) setMode(el.dataset.mode); },
    'toggle-password': () => { const p = $('#authPass'); const show = p.type === 'password'; p.type = show ? 'text' : 'password'; $('#authPwToggle').textContent = show ? 'Hide' : 'Show'; },
    'sign-out': () => signOut(),
    'delete-account': () => deleteAccount(),
    'sync-now': async () => { if (session.sync) { const ok = await session.sync.sync(); UI.toast(ok ? 'Up to date' : 'Couldn’t sync right now. Will retry.'); } },
    'migrate-now': () => offerMigration(true),
    'migrate-go': () => runMigration(),
    'migrate-skip': () => { const f = detectLocalData(DM); if (f && session.user) safeLS.set(skipKey(session.user.id), f.fingerprint); Modal.close('m-migrate'); UI.toast('OK. Your device data stays here. You can move it any time from Settings.'); },
    'migrate-close': () => { Modal.close('m-migrate'); renderAccountSection(); },
  });
  $('#authForm').addEventListener('submit', submitAuth);
  DM.onSettingsOpen(renderAccountSection);
  DM.onRender(() => { if (Modal.isOpen('m-settings')) renderAccountSection(); });

  /* ----------------------------- start ----------------------------- */
  (async function boot() {
    const hint = readHint();
    if (!Account.configured) {
      if (hint) await onSignedOutLocal({ wipeCache: false });     // config removed: fall back to device data, keep the cache
      return;
    }
    if (hint) { Store.setTracking(true); Account.set({ user: { id: hint.id, email: hint.email || '' }, syncState: 'syncing' }); }   // show their cached data straight away
    const start = async () => {
      let client;
      try { client = await getClient(); }
      catch (err) { if (hint) Account.set({ syncState: 'offline' }); window.addEventListener('online', start, { once: true }); return; }
      session.client = client;
      client.auth.onAuthStateChange((event, sess) => {
        // Don't call Supabase from inside this callback synchronously: defer.
        setTimeout(async () => {
          if (event === 'PASSWORD_RECOVERY') { openAuth('newpass'); }
          else if (event === 'SIGNED_IN' && sess && (!session.user || session.user.id !== sess.user.id || !session.sync)) { await onSignedIn(sess.user); }
          else if (event === 'SIGNED_OUT') { if (session.user || readHint()) await onSignedOutLocal({ wipeCache: false }); }
          else if (event === 'USER_UPDATED' && sess) { Account.set({ user: { id: sess.user.id, email: sess.user.email || '' } }); }
        }, 0);
      });
      const { data, error } = await client.auth.getSession();
      if (error && hint) { Account.set({ syncState: 'offline' }); return; }
      if (data && data.session) { if (!session.sync) await onSignedIn(data.session.user); }
      else if (hint) await onSignedOutLocal({ wipeCache: false });         // session expired/revoked: keep their cache for next sign-in
    };
    start();
  })();

  return { openAuth, signOut };
}
