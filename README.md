# DAYMATE

**Your Life, Better Organised.** — Less forgetting. Less stress. More time for life.

Part 2: a mobile-first, installable web app built with plain HTML, CSS and JavaScript. Works fully offline and signed-out (data in localStorage). Optionally add accounts, cloud sync, memory and phone notifications with Supabase: see **[SETUP.md](SETUP.md)**. No build step.

## Run locally

Service workers need `http://localhost` (not `file://`), so serve the folder:

```bash
cd daymate
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy to GitHub Pages

1. Push this folder's contents to a GitHub repository (files at the repo root).
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Visit `https://<your-username>.github.io/<repo-name>/`.

Every path in the project is relative, so it works under a repo sub-path.

**Each time you deploy changes**, bump `VERSION` in `service-worker.js` so installed copies update.

## Structure

```
index.html          App shell, sheets and markup
styles.css          Design system and layout
app.js              Core: Config · Utils · Store (+sync bookkeeping) · Entitlements · UI · Renderers · Flows · Router
js/                 Part 2 ES modules (plug in through window.DAYMATE)
  config.js           Public project settings (Supabase URL + anon key, VAPID public key)
  supabase.js         Lazy, pinned Supabase client; refuses private keys
  auth.js             Sign up / in / out, password reset, session, account UI
  sync.js             Local-first push/pull, conflict rules, offline retry
  migration.js        Device data → account (safe, idempotent, verified)
  mapping.js          Local ⇄ cloud record mapping (pure)
  schedule.js         In-app notification rules (pure; mirrors the SQL)
  notifications.js    Notification centre + preferences
  push.js             Web Push opt-in (permission only on a deliberate tap)
  memory.js           DAYMATE Memory (manual only, no AI)
supabase/           SQL migration, RLS tests, Edge Functions, scheduler example
scripts/            VAPID key generator
tests/              Node / Playwright tests
manifest.json       PWA manifest
service-worker.js   Offline app shell + push handlers
assets/ icons/      Logo and app icons
```

## Where later stages plug in

- **Stripe:** write `entitlements` from a verified webhook (see SETUP.md). The app only displays the plan; the database enforces it.
- **AI memory:** see "Future AI memory" in SETUP.md.
- **Feature catalogue:** `FEATURES` in `app.js` lists every Free/Premium feature.
