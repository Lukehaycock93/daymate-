# DAYMATE

**Your Life, Better Organised.** — Less forgetting. Less stress. More time for life.

Stage 1 foundation: a mobile-first, installable web app built with plain HTML, CSS and JavaScript. Data is saved in the browser (localStorage). No build step, no dependencies.

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
app.js              Config · Utils · Storage · Store · Entitlements · UI · Renderers · Flows · Router
manifest.json       PWA manifest
service-worker.js   Offline app shell cache
assets/             Logo mark
icons/              App icons (SVG + PNG)
```

## Where later stages plug in

- **Supabase:** write a `SupabaseAdapter` with the same `load / save / onExternalChange` shape as `LocalAdapter` and pass it to `Store.init()` in `boot()`.
- **Premium / Stripe:** `Account.getPlan()` currently returns `'free'`. Make it read the server-verified plan; `Entitlements.has()` and `Entitlements.guard()` already gate Premium features. Enforce Premium server-side too.
- **Feature catalogue:** `FEATURES` in `app.js` lists every Free/Premium feature.
