/* ==========================================================================
   DAYMATE — public project settings (safe to commit and ship to the browser)

   Fill these in after creating your Supabase project (see SETUP.md):
     supabaseUrl      Project URL            e.g. https://abcdefgh.supabase.co
     supabaseAnonKey  The *anon / publishable* key (Project Settings → API).
                      It is designed to be public; Row Level Security protects data.
     vapidPublicKey   The PUBLIC half of your VAPID key pair (Web Push).

   NEVER put any of these here:  service_role key · sb_secret_… key · VAPID
   private key · CRON_SECRET · database password.  Those live only in Supabase
   Edge Function secrets. js/supabase.js refuses to start if it detects a
   service-role key in this file.

   Left blank, DAYMATE runs exactly as in Part 1: local-only, no accounts.
   ========================================================================== */
export const CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  vapidPublicKey: '',
};
