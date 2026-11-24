# DAYMATE Part 2 — setup guide

DAYMATE still works with **no setup at all** (local-only, exactly like Part 1). Follow this to switch on accounts, cloud sync and phone notifications. Allow about 30 minutes.

## What is public and what is secret

| Value | Where it goes | Public? |
|---|---|---|
| Supabase **Project URL** | `js/config.js` | Yes |
| Supabase **anon / publishable key** | `js/config.js` | Yes. Designed for browsers; Row Level Security protects the data |
| VAPID **public** key | `js/config.js` and Supabase secret | Yes |
| VAPID **private** key | Supabase secret `VAPID_PRIVATE_KEY` only | **NO. Never in the repo or app** |
| `CRON_SECRET` | Supabase secret + Vault (step 6) | **NO** |
| Supabase **service-role / secret key** | Nowhere you type it. Edge Functions receive it automatically | **NO** |
| Database password | Your password manager | **NO** |

`js/supabase.js` refuses to start if it spots a service-role or `sb_secret_` key in `js/config.js`.

## 1. Create the Supabase project
1. https://supabase.com → **New project** (free tier is fine). Choose a region near you (e.g. London) and save the database password somewhere safe.
2. **Project Settings → API**: copy the **Project URL** and the **anon / publishable** key.

## 2. Create the database
**SQL Editor → New query**, paste the whole of `supabase/migrations/001_daymate_part2.sql`, **Run**. It is safe to run again.

Tables created: `profiles`, `entitlements`, `tasks`, `appointments`, `reminders`, `shopping_items`, `household_info`, `user_preferences`, `notification_preferences`, `memories`, `memory_candidates`, `notifications`, `push_subscriptions`. Every table has Row Level Security on.

## 3. Authentication settings
**Authentication → URL Configuration**
- **Site URL**: your GitHub Pages address, e.g. `https://<you>.github.io/<repo>/`
- **Redirect URLs**: add the same address, plus `http://localhost:8080/` for local testing.

**Authentication → Sign In / Providers → Email**: keep *Confirm email* on. Set **minimum password length to 8**.

**Email delivery:** Supabase's built-in email sender has very low limits and is meant for testing only. Before real users, add your own SMTP provider under **Authentication → SMTP Settings**.

## 4. Point the app at your project
Edit `js/config.js`:
```js
supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
supabaseAnonKey: 'YOUR-ANON-OR-PUBLISHABLE-KEY',
```
Open the app → More → **Sign in or create an account**.

## 5. Web Push (phone notifications)
1. Generate your keys (needs Node, nothing to install): `node scripts/generate-vapid-keys.mjs`
2. Put the **public** key in `js/config.js` → `vapidPublicKey`.
3. Install the Supabase CLI (https://supabase.com/docs/guides/cli), then:
```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." \
  VAPID_SUBJECT="mailto:you@example.com" CRON_SECRET="$(openssl rand -hex 32)"
supabase functions deploy send-due-notifications
supabase functions deploy send-test-notification
supabase functions deploy delete-account
```
Note the `CRON_SECRET` value you generated; you need it in step 6 (`supabase secrets list` shows only a digest).

## 6. Schedule the sender (server-side, every minute)
1. **Database → Extensions**: enable `pg_cron` and `pg_net`.
2. Open `supabase/migrations/002_schedule_push.sql.example`, replace `<PROJECT_REF>` and `<CRON_SECRET>`, and run it in the SQL editor. It also schedules a nightly purge of rows deleted more than 30 days ago.

Check it is running: `select * from cron.job_run_details order by start_time desc limit 10;`

## 7. Deploy to GitHub Pages
Push this folder's contents to your repo root (as in Part 1). **Bump `VERSION` in `service-worker.js` on every deploy** so installed copies update.

## 8. Test notifications (do this before relying on them)
1. Sign in, then **More → Notification settings → Turn on phone notifications** and accept the browser prompt.
2. Tap **Send a test notification**. A real push is sent by the server; it should arrive within seconds.
3. Create a reminder for 2–3 minutes from now, **close the app**, and wait. It should arrive on schedule.

**iPhone / iPad:** web push only works for a Home Screen app. Open the site in Safari → Share → **Add to Home Screen** → open DAYMATE *from the Home Screen icon* → turn notifications on there. (Requires iOS/iPadOS 16.4 or later.)
**Android / desktop:** Chrome or Edge. If you tapped "Block" earlier, re-allow notifications for the site in browser settings.

## Testing Premium (no payments yet)
Premium can only be granted on the server. In the SQL editor:
```sql
update public.entitlements set plan = 'premium', source = 'manual'
where user_id = (select id from auth.users where email = 'you@example.com');
```
Use `plan = 'free'` to revert. The browser cannot do this itself (tested). Free accounts are limited **by the database** to one reminder lead time and no morning summary, even if the app were tampered with.

## Data model notes
- Records are created on the device with UUIDs and keyed `(user_id, id)`, so the same local data can be migrated safely and two accounts never collide.
- Deletes are soft (`deleted_at`) so other devices learn about them; deleted memories have their text wiped immediately and rows are purged after 30 days.
- Sync: push on change (debounced), pull on open / every minute while visible / when back online. Newest `updated_at` wins per record; the database refuses older writes.

## Future AI memory (not built, by design)
`memories.source` allows `'ai'` and `memory_candidates` exists, but **nothing writes to them**. The intended flow: a future server function proposes candidates → the person approves each → only then does it become a memory. Retrieval would be a server function over `memories` (a full-text index exists) gated by the `ai-memory` entitlement. The "pause automatic collection" switch is stored now (default: paused).

## Future Stripe
Add a webhook Edge Function that verifies Stripe's signature and writes `entitlements` (`plan`, `status`, `current_period_end`, `stripe_customer_id`, `source = 'stripe'`) with the service role. No app code changes: the app and the SQL functions already read from that table.

## Running the tests
```bash
node tests/schedule_parity_test.mjs        # no dependencies
node tests/ui_regression.js                # needs Playwright
node tests/sync_migration_test.js          # needs Playwright
# Database: run supabase/tests/rls_and_scheduling_test.sql on a SCRATCH Postgres only (see the file header)
```

## AI assistant (Stage D)
1. Apply `supabase/migrations/005_ai.sql`.
2. Deploy the `assistant` function (`supabase/functions/assistant`, JWT required).
3. Add the secret `GEMINI_API_KEY` (Supabase → Edge Functions → Secrets). Never put it in the app or in GitHub.
4. Optional secrets: `AI_PROVIDER` (`gemini` | `anthropic` | `openai-compatible`), `AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY`.
Free vs Premium limits live in `supabase/functions/assistant/logic.ts` (`PLAN_LIMITS`). The plan comes from the `entitlements` table, never from the app.
Tests: `node --experimental-strip-types tests/assistant_logic_test.mjs` and `node tests/assistant_ui_test.js`.

---

## Part 3 — Premium, lifetime access, ads (what you must still set up)

Everything below is **built and tested in the app/database**, but the live store and ad connections need *your* accounts. Until you do, the app is honest about it: the Upgrade button says "Subscriptions open soon" and no adverts appear.

### 1. RevenueCat (subscriptions)
1. Create a RevenueCat project. Add an **entitlement** called `premium`, and an **offering** with one **monthly package** priced £2.99.
2. **Web/PWA:** enable *Web Billing* (it uses Stripe) and copy the public key (starts `rcb_`) into `js/config.js` → `revenuecat.webPublicKey`.
3. **Apple / Google (needs the Capacitor app — Stage I):** create the subscription product in App Store Connect / Google Play, attach it to the `premium` entitlement, copy the SDK keys (`appl_…`, `goog_…`) into `revenuecat.nativeApiKeyApple` / `nativeApiKeyGoogle`, and add the RevenueCat Capacitor plugin to the native project.
4. **Webhook:** RevenueCat → Integrations → Webhooks → URL `https://mmumhmkmzsmjjesclbqi.supabase.co/functions/v1/revenuecat`, and set the *Authorization header* to a secret string you choose.
5. In Supabase → Edge Functions → Secrets add: `REVENUECAT_WEBHOOK_AUTH` (that same string) and `REVENUECAT_SECRET_API_KEY` (RevenueCat secret API key, starts `sk_`). Optional: `REVENUECAT_ENTITLEMENT_ID` (default `premium`).
6. For store/web **sandbox testing** only, add secret `ALLOW_RC_SANDBOX=true`, test, then delete it (sandbox purchases are ignored otherwise).

### 2. Lifetime Premium
Already applied to account `0b271515-f8b4-4dc0-b31e-9319d40671b6` (migration 006). A database trigger stops any subscription event from changing it. To give someone else lifetime: SQL editor → `select public.dm_grant_lifetime('<their user id>');`

### 3. Testing both account types
SQL editor (admin only — the app itself has no switch):
```sql
select public.dm_set_test_plan('tester@example.com', 'premium');  -- or 'free'
```
Refuses to touch a lifetime account. Sign up a second account with another email to use as your test user.

### 4. Ads
1. Create a Google AdSense account, add the site, get approved, then create 3 ad units (Home / Planner / More).
2. Put the publisher id (`ca-pub-…`) and the ad-unit ids into `js/config.js` → `ads`.
3. UK/EEA: Google requires a certified consent platform for personalised ads. DAYMATE only requests non-personalised ads after an explicit "Allow ads", but before launch consider enabling Google's free *Funding Choices* (Privacy & messaging in AdSense).
4. Native apps will use AdMob (not built yet).
