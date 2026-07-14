# Deploying Slate

Live at **https://slate.greydeercapital.com** — static origin on the shared VPS
(`root@146.190.142.17`, DigitalOcean), served by Caddy behind Cloudflare.

## How it deploys

- **Automatic:** every push to `main` runs `.github/workflows/deploy.yml`, which rsyncs
  the served app (`index.html`, `css/`, `js/`, `icons/`, `manifest.webmanifest`, `sw.js`)
  to `/opt/slate/` using the `VPS_DEPLOY_KEY` repo secret. A build check fails the deploy
  if `sw.js`/`Slate.html` weren't regenerated after a source edit.
- **Manual:** `deploy/deploy.sh` does the same from a Mac with
  `~/.ssh/macro_dashboard_deploy_v2`.

## The pieces this repo does NOT own

- **Caddy site block** — `/etc/caddy/Caddyfile` on the VPS is installed from the
  **macro repo** (`app/deploy/Caddyfile`) by the `macro-update` cron on every macro
  `main` commit. The `slate.greydeercapital.com` block lives THERE; a block edited only
  on the box gets wiped. Run `caddy validate` before committing Caddyfile changes.
- **DNS** — Cloudflare zone `greydeercapital.com`: A record `slate` → `146.190.142.17`,
  **proxied** (orange cloud), zone SSL mode "Full" (origin presents Caddy's
  `tls internal` self-signed cert, same as the apex and maltese subdomain).
- **TLS** — terminated at the Cloudflare edge; edge↔origin hop uses the self-signed cert.

## Second origin — notes.mastermind-x.com (Tencent EdgeOne)

Slate is also reachable at **https://notes.mastermind-x.com**, fronted by the
Tencent EdgeOne CDN (the mastermind-x.com zone; migrated off Cloudflare).

- **Same files, same box.** It serves the identical `/opt/slate` tree as
  `slate.greydeercapital.com` — no separate rsync target. The push-to-`main`
  deploy above already keeps `/opt/slate` fresh, so the pipeline is unchanged.
  Slate is client-side only, so the two origins keep *separate*
  localStorage/IndexedDB data — move data with the in-app gear → Export/Import.
- **Caddy block** — [`deploy/notes.mastermind-x.com.Caddyfile`](notes.mastermind-x.com.Caddyfile)
  is a ready-to-paste block. Its canonical home is the **macro repo**
  (`app/deploy/Caddyfile`); a block added only on the box gets wiped by the
  `macro-update` cron. `caddy validate` before reloading.
  - ⚠ **Divergence risk:** the macro repo Caddyfile currently has **no**
    `slate.greydeercapital.com` block even though that site is live — the live
    `/etc/caddy/Caddyfile` has drifted from the repo. Reconcile them *before*
    committing, or the cron reinstall could drop the live slate block.
- **DNS / CDN** — CNAME `notes` → EdgeOne is already live
  (`notes.mastermind-x.com` → `*.eo.dnse3.com`). In the EdgeOne console: origin →
  `146.190.142.17`, **non-strict** HTTPS origin pull (accept Caddy's self-signed
  `tls internal` cert), **Force HTTPS + HSTS** at the edge, and set the origin-fetch
  Host header to `notes.mastermind-x.com` so Caddy routes to this block.

## Notes

- The app is fully client-side (localStorage + IndexedDB per browser) — the server holds
  no user data, so a public URL only ever shows a visitor their own empty board.
  `X-Robots-Tag: noindex` keeps it out of search. For real access control, front it with
  Cloudflare Access.
- Data is origin-scoped: the live site, localhost, and the `file://` single file each
  keep separate data. Move data with the in-app gear menu → Export/Import.
