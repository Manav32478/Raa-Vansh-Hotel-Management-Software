/* =====================================================================
   RAA VANSH HOTEL — Billing App server
   Zero-dependency Node server: static files + persistent JSON database.
   API:
     GET  /api/health  -> {ok:true}
     GET  /api/state   -> full DB JSON (404 if none)
     PUT  /api/state   -> replace DB (JSON body)
===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '8090', 10);
const DBF = path.join(ROOT, 'db.json');
const BDIR = path.join(ROOT, 'backups');
const MAX_BODY = 60 * 1024 * 1024; // 60 MB (bookings with ID photos)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};

function readDB() {
  try { return JSON.parse(fs.readFileSync(DBF, 'utf8')); } catch (e) { return null; }
}
function writeDB(db) {
  const tmp = DBF + '.tmp';
  db._syncedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DBF);
}

/* ---------- D3: automatic backups (JSON full copy + human-readable TXT) ---------- */
function pad(n){ return String(n).padStart(2, '0'); }
function stamp(){ const d = new Date(); return pad(d.getMonth()+1) + pad(d.getDate()) + '-' + String(d.getFullYear()).slice(2) + '-' + pad(d.getHours()) + pad(d.getMinutes()); }
function inr(n){ return 'Rs.' + Number(n||0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function txtLine(arr, w){ return (Array.isArray(arr) ? arr.join('') : String(arr)).slice(0, w).padEnd(w); }
function buildTxt(db){
  const L = [];
  const hotel = (db.hotel || {});
  L.push('=====================================================');
  L.push((hotel.name || 'HOTEL') + ' - AUTOMATIC DATA BACKUP (readable copy)');
  L.push('Generated: ' + new Date().toLocaleString('en-IN'));
  L.push('=====================================================');
  L.push('Rooms on file:        ' + (db.rooms || []).length);
  L.push('Total bookings:       ' + (db.bookings || []).length);
  const co = (db.bookings || []).filter(b => b.status === 'checked-out');
  L.push('Checked-out stays:    ' + co.length);
  L.push('Total income billed:  ' + inr(co.reduce((s,b) => s + (b.items || []).reduce((x,i) => x + (i.amount||0), 0), 0)));
  L.push('');
  L.push('ALL BOOKINGS (newest first)');
  L.push('-----------------------------------------------------');
  const bs = (db.bookings || []).slice().reverse();
  bs.forEach(b => {
    const g = b.guest || {};
    const name = [g.firstName, g.middleName, g.lastName].filter(Boolean).join(' ');
    const total = (b.items || []).reduce((x,i) => x + (i.amount||0), 0);
    const recv = (b.payments || []).reduce((x,p) => x + (p.amount||0), 0);
    L.push((name || '—') + ' | ' + (g.mobile || 'no mobile'));
    const rooms = Array.isArray(b.rooms) && b.rooms.length ? b.rooms : [{ no:b.roomNo || '?', type:b.roomType || '?', adults:(g.adults||b.persons||1), children:g.children||0 }];
    const roomText = rooms.map(r => 'Room ' + (r.no || '?') + ' (' + (r.type || '?') + '; ' + (r.adults||0) + ' adult(s), ' + (r.children||0) + ' child(ren)' + (r.occupantNames ? '; names: ' + r.occupantNames : '') + ')').join('; ');
    L.push('  ' + roomText + ' | in ' + b.checkIn + ' | out ' + b.checkOut + ' | ' + (b.nights||0) + ' night(s)' + (b.halfDay ? ' | HALF-DAY (full charge)' : ''));
    L.push('  Status: ' + b.status + ' | Bill ' + inr(total) + ' | Received ' + inr(recv) + ' | Balance ' + inr(Math.max(0, total - recv)));
    if(b.payments && b.payments.length) L.push('  Payments: ' + b.payments.map(p => (p.mode||'') + ' ' + inr(p.amount)).join(', '));
    L.push('');
  });
  L.push('-----------------------------------------------------');
  L.push('This .txt is the human-readable copy. The .json with the');
  L.push('same name is the FULL data (including ID document photos)');
  L.push('that the app itself uses to restore. Keep both.');
  return L.join('\n') + '\n';
}
function listBackups(){
  try {
    return fs.readdirSync(BDIR).filter(f => /^db-\d{4}-\d{2}-\d{4}\.(json|txt)$/.test(f))
      .map(f => ({ file: f, size: fs.statSync(path.join(BDIR, f)).size, mtime: fs.statSync(path.join(BDIR, f)).mtimeMs }))
      .sort((a,b) => b.mtime - a.mtime);
  } catch (e) { return []; }
}
function writeBackup(){
  const db = readDB();
  if (!db || !Array.isArray(db.bookings)) return;
  try {
    if (!fs.existsSync(BDIR)) fs.mkdirSync(BDIR);
    const base = 'db-' + stamp();
    fs.writeFileSync(path.join(BDIR, base + '.json'), JSON.stringify(db));
    fs.writeFileSync(path.join(BDIR, base + '.txt'), buildTxt(db));
    // keep the latest 24 snapshots (48 files)
    const groups = {};
    listBackups().forEach(x => { const k = x.file.replace(/\.(json|txt)$/, ''); (groups[k] = groups[k] || []).push(x.file); });
    const keys = Object.keys(groups).sort().reverse();
    keys.slice(24).forEach(k => groups[k].forEach(f => { try { fs.unlinkSync(path.join(BDIR, f)); } catch (e) {} }));
  } catch (e) { console.error('backup failed:', e.message); }
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); res.end('bad'); return; }
  const p = url.pathname;

  res.setHeader('Cache-Control', 'no-store');
  // CORS: allow the Android app (its own local origin) and any browser/laptop
  // to use this server as their shared database.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (p === '/api/backups') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ list: listBackups() }));
    return;
  }

  if (p === '/api/backup') {
    const f = (url.searchParams.get('file') || '');
    if (!/^db-\d{4}-\d{2}-\d{4}\.(json|txt)$/.test(f)) { res.writeHead(400); res.end('bad file'); return; }
    const fp = path.join(BDIR, f);
    fs.readFile(fp, (e, buf) => {
      if (e) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': f.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + f + '"'
      });
      res.end(buf);
    });
    return;
  }

  if (p === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, bookings: (readDB() || { bookings: [] }).bookings.length }));
    return;
  }

  if (p === '/api/state') {
    if (req.method === 'GET') {
      const db = readDB();
      if (db) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(db));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('null');
      }
      return;
    }
    if (req.method === 'PUT') {
      let body = '';
      let aborted = false;
      req.on('data', c => {
        body += c;
        if (body.length > MAX_BODY) {
          aborted = true;
          res.writeHead(413); res.end('too large');
          req.destroy();
        }
      });
      req.on('end', () => {
        if (aborted) return;
        try {
          const db = JSON.parse(body);
          if (!db || !db.hotel || !Array.isArray(db.bookings) || !Array.isArray(db.rooms)) {
            res.writeHead(400); res.end('bad shape'); return;
          }
          writeDB(db);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, size: body.length }));
        } catch (e) {
          res.writeHead(400); res.end('bad json');
        }
      });
      return;
    }
    res.writeHead(405); res.end('method not allowed');
    return;
  }

  // static files
  let fp = decodeURIComponent(p);
  if (fp === '/') fp = '/index.html';
  fp = path.normalize(path.join(ROOT, fp));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, (e, buf) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Raa Vansh Hotel billing server on http://0.0.0.0:' + PORT + ' (db: ' + DBF + ')');
});
setTimeout(writeBackup, 2000);
setInterval(writeBackup, 6 * 60 * 60 * 1000);
