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

## Install as an APP (no app store, free)
- **Phone (Android):** open the URL in Chrome → menu ⋮ → "Add to Home screen / Install app".
- **Phone (iPhone):** open in Safari → Share → "Add to Home Screen".
- **Laptop (Windows/Mac, Chrome/Edge):** click the install icon in the address bar (or ⋮ → "Install app").
It opens full-screen like a normal app and works offline (data stays on the device, syncs back when online).

## The Android .apk (built & signed)
**RaaVansh-Hotel.apk** is the real, signed Android app (see the `android/` folder for its
source and signing notes). It runs the complete app on the phone — and because it serves
the app from a secure local origin (not file://), PDF/JSON downloads save to the phone's
Downloads folder, the photo picker works, and the ID-scan OCR runs like the website.
It also bundles the app for offline use; when a public server URL is set inside it
(android/Main.java → REMOTE_URL), it shares the same live database as the laptop.

## Complete app guide
**APP-GUIDE.docx** (in this folder) explains the whole application — every screen,
every button, the check-out/WhatsApp flow, backups, and troubleshooting, in plain language.

## Data safety
- Server database: db.json (full history, never erased)
- Auto-backups: backups/ (every 6 hours, kept 3 weeks) — .txt is readable on any phone
- Manual: Settings → Export full report (PDF) / Backup (JSON)
