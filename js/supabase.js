/* ==========================================================================
   DAYMATE — Supabase client (lazy-loaded)
   The library is only downloaded when accounts are configured, so the app still
   works fully offline / unconfigured. The CDN version is pinned.
   ========================================================================== */
import { CONFIG } from './config.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

function jwtRole(token) {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).role || '';
  } catch (_) { return ''; }
}

/** Why the config is unusable, or '' if it is fine. */
export function configProblem() {
  const url = (CONFIG.supabaseUrl || '').trim();
  const key = (CONFIG.supabaseAnonKey || '').trim();
  if (!url && !key) return 'not-set';
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) return 'bad-url';
  if (!key) return 'no-key';
  // Hard stop: a private key must never ship in frontend code.
  if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') return 'private-key';
  return '';
}
export const isConfigured = () => configProblem() === '';

/** Where Supabase should send people after email links (works on GitHub Pages sub-paths). */
export const redirectUrl = () => `${window.location.origin}${window.location.pathname}`;

let clientPromise = null;
export function getClient() {
  if (!isConfigured()) return Promise.reject(new Error('Accounts are not configured'));
  if (!clientPromise) {
    clientPromise = import(SUPABASE_JS).then(({ createClient }) =>
      createClient(CONFIG.supabaseUrl.trim(), CONFIG.supabaseAnonKey.trim(), {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // PKCE puts the code in the query string, so it can't clash with DAYMATE's #/hash routes.
          flowType: 'pkce',
          storageKey: 'daymate:auth',
        },
      })
    ).catch((err) => { clientPromise = null; throw err; });
  }
  return clientPromise;
}
