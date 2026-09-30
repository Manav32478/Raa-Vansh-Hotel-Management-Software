/* =====================================================================
   RAA VANSH HOTEL — Billing App server
   Static files + persistent hotel database + per-installation subscription gate.
   UPI QR payments are manually verified by an owner before activation.
===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '8090', 10);
const DATA_DIR = process.env.DATA_DIR || ROOT;
const DBF = process.env.DB_PATH || path.join(DATA_DIR, 'db.json');
const SUBF = process.env.SUBSCRIPTION_PATH || path.join(DATA_DIR, 'subscription.json');
const BDIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const MAX_BODY = 60 * 1024 * 1024; // hotel DB may contain ID photos
const MAX_SUB_BODY = 128 * 1024;
const ADMIN_KEY = String(process.env.SUBSCRIPTION_ADMIN_KEY || '');
const DAY_MS = 24 * 60 * 60 * 1000;
const PLANS = Object.freeze({
  monthly:    { id:'monthly',    name:'Monthly',      months:1,  price:700 },
  quarterly:  { id:'quarterly',  name:'Quarterly',    months:3,  price:2100 },
  halfYearly: { id:'halfYearly', name:'Half yearly',  months:6,  price:4199 },
  yearly:     { id:'yearly',     name:'Yearly',       months:12, price:6999 }
});
const UPI_ID = 'manavsarvaiya188@okhdfcbank';
const QR_PATHS = Object.freeze({
  monthly:'/assets/subscription-upi-monthly.png',
  quarterly:'/assets/subscription-upi-quarterly.png',
  halfYearly:'/assets/subscription-upi-halfYearly.png',
  yearly:'/assets/subscription-upi-yearly.png'
});

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
  fs.mkdirSync(path.dirname(DBF), {recursive:true});
  const tmp = DBF + '.tmp';
  db._syncedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DBF);
}
function freshSubscription(){
  return { version:1, status:'inactive', planId:null, startsAt:null, expiresAt:null, requests:[], history:[] };
}
function readSubscription(){
  try {
    const s = JSON.parse(fs.readFileSync(SUBF, 'utf8'));
    if(!s || !Array.isArray(s.requests) || !Array.isArray(s.history)) return freshSubscription();
    return Object.assign(freshSubscription(), s);
  } catch(e){ return freshSubscription(); }
}
function writeSubscription(s){
  fs.mkdirSync(path.dirname(SUBF), {recursive:true});
  const tmp = SUBF + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, SUBF);
}
function addCalendarMonths(iso, months){
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString();
}
function subscriptionInfo(s=readSubscription()){
  const exp = s.expiresAt ? Date.parse(s.expiresAt) : NaN;
  const active = s.status === 'active' && Number.isFinite(exp) && exp > Date.now();
  const state = active ? 'active' : (s.status === 'active' ? 'expired' : (s.status || 'inactive'));
  const daysRemaining = active ? Math.max(0, Math.ceil((exp-Date.now())/DAY_MS)) : 0;
  const latest = s.requests.length ? s.requests[s.requests.length-1] : null;
  const pending = [...s.requests].reverse().find(r => r.status === 'pending') || null;
  const plan = s.planId && PLANS[s.planId] ? PLANS[s.planId] : null;
  return {
    state, active, plan:plan ? { id:plan.id, name:plan.name, months:plan.months, price:plan.price } : null,
    startsAt:s.startsAt || null, expiresAt:s.expiresAt || null, daysRemaining,
    reminderDays: active && daysRemaining <= 4 ? daysRemaining : null,
    request:latest ? { id:latest.id, planId:latest.planId, planName:latest.planName, amount:latest.amount, status:latest.status, submittedAt:latest.submittedAt, decidedAt:latest.decidedAt || null, message:latest.message || '' } : null,
    pendingRequestId:pending ? pending.id : null
  };
}
function sendJson(res, status, data){
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function readJson(req, limit=MAX_SUB_BODY){
  return new Promise((resolve,reject) => {
    let body=''; let tooLarge=false;
    req.on('data', chunk => {
      body += chunk;
      if(body.length > limit && !tooLarge){ tooLarge=true; reject(Object.assign(new Error('too large'), { status:413 })); }
    });
    req.on('end', () => {
      if(tooLarge) return;
      try { resolve(body ? JSON.parse(body) : {}); }
      catch(e){ reject(Object.assign(new Error('invalid JSON'), { status:400 })); }
    });
    req.on('error', reject);
  });
}
function adminAuthorized(req){
  if(!ADMIN_KEY) return false;
  const supplied = String(req.headers['x-subscription-admin-key'] || '');
  const a = Buffer.from(supplied), b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}
function requireAdmin(req,res){
  if(!ADMIN_KEY){ sendJson(res,503,{ error:'admin_not_configured', message:'Set SUBSCRIPTION_ADMIN_KEY in the server environment before approving payments.' }); return false; }
  if(!adminAuthorized(req)){ sendJson(res,401,{ error:'unauthorized', message:'Admin key was not accepted.' }); return false; }
  return true;
}
function activeLicense(){ return subscriptionInfo().active; }
function normalizeMobile(v){ return String(v||'').replace(/\D/g,''); }

/* ---------- automatic backups (full JSON + readable TXT) ---------- */
function pad(n){ return String(n).padStart(2, '0'); }
function stamp(){ const d = new Date(); return pad(d.getMonth()+1) + pad(d.getDate()) + '-' + String(d.getFullYear()).slice(2) + '-' + pad(d.getHours()) + pad(d.getMinutes()); }
function inr(n){ return 'Rs.' + Number(n||0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
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
  (db.bookings || []).slice().reverse().forEach(b => {
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
      .map(f => ({ file:f, size:fs.statSync(path.join(BDIR,f)).size, mtime:fs.statSync(path.join(BDIR,f)).mtimeMs }))
      .sort((a,b) => b.mtime-a.mtime);
  } catch(e){ return []; }
}
function writeBackup(){
  const db = readDB();
  if(!db || !Array.isArray(db.bookings)) return;
  try {
    if(!fs.existsSync(BDIR)) fs.mkdirSync(BDIR, {recursive:true});
    const base = 'db-' + stamp();
    fs.writeFileSync(path.join(BDIR,base+'.json'), JSON.stringify(db));
    fs.writeFileSync(path.join(BDIR,base+'.txt'), buildTxt(db));
    const groups={};
    listBackups().forEach(x => { const k=x.file.replace(/\.(json|txt)$/,''); (groups[k]=groups[k]||[]).push(x.file); });
    Object.keys(groups).sort().reverse().slice(24).forEach(k => groups[k].forEach(f => { try{fs.unlinkSync(path.join(BDIR,f));}catch(e){} }));
  } catch(e){ console.error('backup failed:',e.message); }
}

const server = http.createServer(async (req,res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch(e){ res.writeHead(400); res.end('bad'); return; }
  const p=url.pathname;
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Subscription-Admin-Key');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}

  if(p==='/api/subscription' && req.method==='GET'){
    sendJson(res,200,{ ...subscriptionInfo(), plans:Object.values(PLANS), qrPaths:QR_PATHS, qrPath:QR_PATHS.monthly, upiId:UPI_ID }); return;
  }
  if(p==='/api/subscription/request' && req.method==='POST'){
    try {
      const body=await readJson(req);
      const plan=PLANS[String(body.planId||'')];
      const businessName=String(body.businessName||'').trim().slice(0,100);
      const ownerName=String(body.ownerName||'').trim().slice(0,100);
      const mobile=normalizeMobile(body.mobile);
      const email=String(body.email||'').trim().slice(0,160);
      const transactionRef=String(body.transactionRef||'').trim().replace(/\s+/g,'').slice(0,64);
      if(!plan) return sendJson(res,400,{error:'invalid_plan',message:'Choose a valid subscription plan.'});
      if(!businessName || !ownerName || !/^[6-9]\d{9}$/.test(mobile) || !/^[A-Za-z0-9/-]{6,64}$/.test(transactionRef))
        return sendJson(res,400,{error:'invalid_details',message:'Enter business name, owner name, valid Indian mobile, and UPI transaction reference.'});
      const s=readSubscription();
      if(s.requests.some(r => r.status==='pending')) return sendJson(res,409,{error:'pending_exists',message:'A payment request is already awaiting review.'});
      if(s.requests.some(r => String(r.transactionRef).toLowerCase()===transactionRef.toLowerCase())) return sendJson(res,409,{error:'duplicate_reference',message:'This transaction reference has already been submitted.'});
      const request={
        id:crypto.randomUUID(), planId:plan.id, planName:plan.name, months:plan.months, amount:plan.price,
        businessName, ownerName, mobile, email, transactionRef, submittedAt:new Date().toISOString(),
        status:'pending', decidedAt:null, message:''
      };
      s.requests.push(request);
      s.status=s.status==='active' && subscriptionInfo(s).active ? 'active' : 'pending';
      writeSubscription(s);
      return sendJson(res,201,{ok:true,request:{id:request.id,planName:plan.name,amount:plan.price,status:'pending',submittedAt:request.submittedAt},subscription:subscriptionInfo(s)});
    } catch(e){ return sendJson(res,e.status||400,{error:'bad_request',message:e.status===413?'Request too large':'Invalid request.'}); }
  }
  if(p==='/api/admin/subscription'){
    if(!requireAdmin(req,res)) return;
    if(req.method==='GET'){
      const s=readSubscription();
      return sendJson(res,200,{subscription:subscriptionInfo(s),requests:s.requests.slice().reverse(),history:s.history});
    }
    if(req.method==='POST'){
      try {
        const body=await readJson(req);
        const action=String(body.action||'');
        const s=readSubscription();
        const r=s.requests.find(x => x.id===String(body.requestId||''));
        if(!r) return sendJson(res,404,{error:'request_not_found',message:'Payment request not found.'});
        if(r.status!=='pending') return sendJson(res,409,{error:'request_decided',message:'This request has already been reviewed.'});
        r.decidedAt=new Date().toISOString();
        if(action==='approve'){
          const plan=PLANS[r.planId];
          if(!plan) return sendJson(res,400,{error:'invalid_plan',message:'Plan details are invalid.'});
          const now=new Date();
          const oldExpiry=Date.parse(s.expiresAt||'');
          const start=new Date(Number.isFinite(oldExpiry)&&oldExpiry>now.getTime()?oldExpiry:now.getTime());
          s.startsAt=start.toISOString();
          s.expiresAt=addCalendarMonths(s.startsAt,plan.months);
          s.planId=plan.id;
          s.status='active';
          r.status='approved';
          r.message='Payment verified and plan activated.';
          s.history.push({requestId:r.id,planId:plan.id,planName:plan.name,amount:plan.price,transactionRef:r.transactionRef,startsAt:s.startsAt,expiresAt:s.expiresAt,approvedAt:r.decidedAt});
        } else if(action==='reject'){
          r.status='rejected';
          r.message=String(body.message||'Payment could not be verified. Contact support or submit a new payment reference.').trim().slice(0,300);
          const stillActive=subscriptionInfo(s).active;
          s.status=stillActive?'active':'inactive';
        } else return sendJson(res,400,{error:'invalid_action',message:'Action must be approve or reject.'});
        writeSubscription(s);
        return sendJson(res,200,{ok:true,subscription:subscriptionInfo(s),request:r});
      } catch(e){ return sendJson(res,e.status||400,{error:'bad_request',message:e.status===413?'Request too large':'Invalid request.'}); }
    }
    res.writeHead(405);res.end('method not allowed');return;
  }

  if(p==='/api/subscription/backup' && req.method==='GET'){
    const db=readDB();
    if(!db){ res.writeHead(404);res.end('no backup available');return; }
    const date=new Date().toISOString().slice(0,10);
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="raavansh-hotel-server-backup-'+date+'.json"'});
    res.end(JSON.stringify(db)); return;
  }
  if(p==='/api/backups' && req.method==='GET'){
    sendJson(res,200,{list:listBackups()});return;
  }
  if(p==='/api/backup' && req.method==='GET'){
    const f=url.searchParams.get('file')||'';
    if(!/^db-\d{4}-\d{2}-\d{4}\.(json|txt)$/.test(f)){res.writeHead(400);res.end('bad file');return;}
    fs.readFile(path.join(BDIR,f),(e,buf)=>{
      if(e){res.writeHead(404);res.end('not found');return;}
      res.writeHead(200,{'Content-Type':f.endsWith('.txt')?'text/plain; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="'+f+'"'});
      res.end(buf);
    });return;
  }
  if(p==='/api/health' && req.method==='GET'){
    const sub=subscriptionInfo();
    sendJson(res,200,{ok:true,bookings:(readDB()||{bookings:[]}).bookings.length,subscription:sub.state});return;
  }

  if(p==='/api/state'){
    if(!activeLicense()) return sendJson(res,403,{error:'subscription_required',subscription:subscriptionInfo()});
    if(req.method==='GET'){
      const db=readDB();
      if(db){sendJson(res,200,db);}else sendJson(res,404,null);
      return;
    }
    if(req.method==='PUT'){
      try {
        const db=await readJson(req,MAX_BODY);
        if(!db || !db.hotel || !Array.isArray(db.bookings) || !Array.isArray(db.rooms)) return sendJson(res,400,{error:'bad_shape'});
        writeDB(db);
        sendJson(res,200,{ok:true,size:JSON.stringify(db).length});
      } catch(e){return sendJson(res,e.status||400,{error:e.status===413?'too_large':'bad_json'});}
      return;
    }
    res.writeHead(405);res.end('method not allowed');return;
  }

  if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405);res.end('method not allowed');return;}
  let fp;
  try { fp=decodeURIComponent(p); } catch(e){res.writeHead(400);res.end('bad path');return;}
  if(fp==='/') fp='/index.html';
  fp=path.resolve(ROOT,'.'+fp);
  const rel=path.relative(ROOT,fp);
  const parts=rel.split(path.sep);
  if(rel.startsWith('..') || path.isAbsolute(rel) || parts.some(x => x.startsWith('.') || x==='db.json' || x==='subscription.json' || x==='backups')){res.writeHead(404);res.end('not found');return;}
  fs.readFile(fp,(e,buf)=>{
    if(e){res.writeHead(404,{'Content-Type':'text/plain'});res.end('not found');return;}
    const headers={'Content-Type':MIME[path.extname(fp).toLowerCase()]||'application/octet-stream'};
    res.writeHead(200,headers);
    if(req.method==='HEAD')res.end();else res.end(buf);
  });
});

server.listen(PORT,'0.0.0.0',()=>{
  console.log('Raa Vansh Hotel billing server on http://0.0.0.0:'+PORT+' (db: '+DBF+')');
  if(!ADMIN_KEY) console.warn('Subscription payments can be submitted, but approval is disabled until SUBSCRIPTION_ADMIN_KEY is configured.');
});
setTimeout(writeBackup,2000);
setInterval(writeBackup,6*60*60*1000);
