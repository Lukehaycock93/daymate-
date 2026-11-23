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
  supabaseUrl: 'https://mmumhmkmzsmjjesclbqi.supabase.co',
  supabaseAnonKey: 'sb_publishable_6V4Wll6Gtjyz9Gr8YyTDew_scha2b2f',
  // Google Analytics 4 (public id). Only ever loaded after the person says yes.
  ga4MeasurementId: 'G-YCQ42P39T4',
  // Shown on the privacy page so people can contact you. Add your support email.
  contactEmail: '',
  vapidPublicKey: 'BEyPkf0Kk_xM13B89SP9JtkLpLBoUN-7SWfVzt3WYl567IDT0Fbs5QKMD2hPTDpw9dawyRTHN7QaIuWRBwu04B4',
};
