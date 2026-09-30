# Raa Vansh Hotel — Guest & Billing Manager

Complete front-desk app: bookings, quick walk-ins, ID-scan (OCR) check-in, F&B billing,
payments, WhatsApp bill delivery, records, reports, night-shift handover PDF,
daily run-sheet, automatic backups and an installable app (PWA).

## Run it (laptop / any machine with Node.js)
1. Install Node.js (free) from nodejs.com
2. In this folder run:  node server.js
3. Open:  http://localhost:8090

The database (db.json) is created automatically on first run and never erases data.
Automatic backups (readable .txt + full .json) are saved to the `backups/` folder every 6 hours.

## Free public hosting (so the phone can reach it)
- Create a free account on render.com → "New Web Service" → connect this GitHub repo.
- Build command: (leave empty)   Start command: `node server.js`
- Render gives you an https://... URL — that URL is what you install on the phone.
- (GitHub Pages / Netlify static cannot be used — the app needs this small Node server for the shared database.)
- **Storage warning:** the included Render free blueprint has ephemeral local storage. Do not use it for real hotel records/licenses without persistent storage; a redeploy/restart can erase `db.json`, `subscription.json`, and backups. Use a persistent disk and set `DATA_DIR` to its mount path (for example `/var/data`), or choose a host with durable storage.

## Install as an APP (no app store, free)
- **Phone (Android):** open the URL in Chrome → menu ⋮ → "Add to Home screen / Install app".
- **Phone (iPhone):** open in Safari → Share → "Add to Home Screen".
- **Laptop (Windows/Mac, Chrome/Edge):** click the install icon in the address bar (or ⋮ → "Install app").
It opens full-screen like a normal app. The app shell is cached, but a server connection is required to verify the subscription; without verification, normal hotel screens stay locked. Locally cached data can still be exported from the subscription screen.

## The Android .apk (built & signed)
**RaaVansh-Hotel.apk** is the real, signed Android app (see the `android/` folder for its
source and signing notes). It runs the complete app on the phone — and because it serves
the app from a secure local origin (not file://), PDF/JSON downloads save to the phone's
Downloads folder, the photo picker works, and the ID-scan OCR runs like the website.
It bundles the app assets, but subscription verification and payment submission require the hotel's licensed server. Set `android/Main.java → REMOTE_URL` to that server before building/installing; a standalone offline copy cannot verify a subscription and stays locked. The phone and laptop then share that server's hotel database.

## Complete app guide
**APP-GUIDE.docx** (in this folder) explains the whole application — every screen,
every button, the check-out/WhatsApp flow, backups, and troubleshooting, in plain language.

## Data safety
- Server database: db.json (full history, never erased)
- Auto-backups: backups/ (every 6 hours, kept 3 weeks) — .txt is readable on any phone
- Manual: Settings → Export full report (PDF) / Backup (JSON)


## Go-live checklist (Render)

1. Deploy this updated project to the GitHub repository connected to the Render service. Keep the repository's `.git` folder; copy the extracted project contents into the repository root, then commit and push.
2. In Render, change the service from the Free plan to a plan that supports persistent disks. The `render.yaml` demo blueprint still uses `free` by default.
3. Add a disk to the service with mount path `/var/data`, then set `DATA_DIR=/var/data` in the service's Environment. Keep this a single service instance. The app writes `db.json`, `subscription.json`, and `backups/` under that mount.
4. In Environment, set a private, long random `SUBSCRIPTION_ADMIN_KEY`. Never commit or share it. Without this key, the owner cannot approve payment requests.
5. Since demo data can be discarded, start with the new disk empty; do not copy demo files. Clear the old app's site data on your browser/devices (or use a fresh browser profile), so demo customer records in local storage are not synced to production. After deploy, check `https://your-service.onrender.com/api/health`. New installations start inactive; activate only after a real UPI payment and owner verification. After approval, create a real booking, restart once, and confirm both the license and booking persist.

## Subscription licensing (per hotel installation)

This build requires a paid subscription before hotel features/data are unlocked. Each customer/hotel must use a **separate server deployment and database**; the current app is single-hotel and is not a multi-tenant shared service.

Plans: Monthly ₹700 (1 month), Quarterly ₹2,100 (3 months), Half yearly ₹4,199 (6 months), and Yearly ₹6,999 (12 months). For the selected plan, the screen displays a plan-specific QR made from the supplied UPI payee details, with that exact amount prefilled in the payment app. The QR/payment app does not automatically notify or verify the server: after paying, customers enter the UPI UTR/reference and wait for manual owner verification. The owner approves/rejects requests from the subscription screen.

Set a strong secret environment variable named `SUBSCRIPTION_ADMIN_KEY` on the server (Render prompts for it via `render.yaml`; locally use `SUBSCRIPTION_ADMIN_KEY='your-long-random-secret' node server.js`). Never put the key in the repository or ZIP. The same key authorizes payment approvals for that one deployment. Without it, payment requests can be submitted but cannot be approved. In production, use persistent server storage for `db.json`, `subscription.json`, and `backups/` (set `DATA_DIR` to the mounted disk path, e.g. `/var/data`); ephemeral hosting storage can be erased on restart.

An in-app reminder appears 4 days before expiry. At expiry, the hotel app is locked, while the renewal screen still offers both local cached-data export and a server backup download; server-side hotel data is retained. Subscription state is stored in ignored `subscription.json`, not `db.json`.
