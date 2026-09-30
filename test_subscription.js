/* Subscription HTTP integration tests: manual approval, plan periods, hard gate, and backup export. */
'use strict';
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort(){
  const probe = net.createServer();
  await new Promise((resolve,reject) => probe.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
async function run(){
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'rvh-subscription-'));
  const port = await freePort();
  const key = 'test-only-admin-key-42';
  const child = spawn(process.execPath,['server.js'],{
    cwd:__dirname,
    env:{...process.env,PORT:String(port),DATA_DIR:dataDir,SUBSCRIPTION_ADMIN_KEY:key},
    stdio:['ignore','pipe','pipe']
  });
  let logs='';
  child.stdout.on('data',d=>logs+=d);
  child.stderr.on('data',d=>logs+=d);
  const base='http://127.0.0.1:'+port;
  const check=(name,condition)=>{ assert.ok(condition,name); console.log('PASS — '+name); };
  const req=async (url,opts={})=>{
    const r=await fetch(base+url,opts);
    const text=await r.text();
    let body=null; try{body=text?JSON.parse(text):null;}catch(_){body=text;}
    return {r,body,text};
  };
  try{
    let live=false;
    for(let i=0;i<100;i++){
      if(child.exitCode!==null) throw new Error('server exited during startup: '+logs);
      try{const h=await fetch(base+'/api/health'); if(h.ok){live=true;break;}}catch(_){}
      await delay(40);
    }
    assert.ok(live,'server did not start: '+logs);

    let x=await req('/api/subscription');
    check('new installation starts locked',x.r.status===200 && x.body.active===false && x.body.state==='inactive');
    const prices=Object.fromEntries(x.body.plans.map(p=>[p.id,p.price]));
    check('server offers the four agreed plan prices',prices.monthly===700 && prices.quarterly===2100 && prices.halfYearly===4199 && prices.yearly===6999);
    check('server selects a distinct amount-specific QR for each plan',x.body.qrPaths.monthly==='/assets/subscription-upi-monthly.png' && x.body.qrPaths.quarterly==='/assets/subscription-upi-quarterly.png' && x.body.qrPaths.halfYearly==='/assets/subscription-upi-halfYearly.png' && x.body.qrPaths.yearly==='/assets/subscription-upi-yearly.png');
    x=await req('/assets/subscription-upi-yearly.png');
    check('yearly amount-prefilled QR is served as PNG',x.r.status===200 && x.r.headers.get('content-type')==='image/png');
    x=await req('/api/state');
    check('hotel state is blocked before manual payment approval',x.r.status===403 && x.body.error==='subscription_required');

    const payload={planId:'yearly',businessName:'Test Hotel',ownerName:'Owner Test',mobile:'9876543210',email:'owner@example.test',transactionRef:'UTRTEST123456'};
    x=await req('/api/subscription/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    check('customer can submit a UTR without unlocking access',x.r.status===201 && x.body.request.status==='pending' && x.body.subscription.active===false);
    const requestId=x.body.request.id;
    x=await req('/api/subscription');
    check('public subscription status does not reveal the UTR',x.body.pendingRequestId===requestId && !JSON.stringify(x.body).includes(payload.transactionRef));
    x=await req('/api/state');
    check('pending payment remains locked',x.r.status===403);

    x=await req('/api/admin/subscription');
    check('admin review rejects requests without the secret key',x.r.status===401);
    x=await req('/api/admin/subscription',{headers:{'X-Subscription-Admin-Key':'wrong-key'}});
    check('admin review rejects an incorrect key',x.r.status===401);
    x=await req('/api/admin/subscription',{headers:{'X-Subscription-Admin-Key':key}});
    check('authorized owner can review the submitted UTR',x.r.status===200 && x.body.requests[0].transactionRef===payload.transactionRef);

    x=await req('/api/admin/subscription',{method:'POST',headers:{'Content-Type':'application/json','X-Subscription-Admin-Key':key},body:JSON.stringify({requestId,action:'approve'})});
    check('owner approval activates the selected plan',x.r.status===200 && x.body.subscription.active && x.body.subscription.plan.id==='yearly');
    const firstExpiry=Date.parse(x.body.subscription.expiresAt);
    x=await req('/api/state');
    check('hotel state becomes readable only after approval (empty install)',x.r.status===404);
    const db={hotel:{name:'Test Hotel'},bookings:[],rooms:[],_syncedAt:new Date().toISOString()};
    x=await req('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(db)});
    check('active installation can store hotel data',x.r.status===200);
    x=await req('/api/state');
    check('active installation can read hotel data',x.r.status===200 && x.body.hotel.name==='Test Hotel');
    x=await req('/subscription.json');
    check('private subscription storage is not served as a static file',x.r.status===404);
    x=await req('/db.json');
    check('private hotel database is not served as a static file',x.r.status===404);

    x=await req('/api/subscription/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,planId:'monthly'})});
    check('duplicate UTR cannot be reused',x.r.status===409);
    const renewal={...payload,planId:'monthly',transactionRef:'UTRTEST654321'};
    x=await req('/api/subscription/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(renewal)});
    const renewalId=x.body.request.id;
    check('active customer can submit a renewal for manual review',x.r.status===201 && x.body.subscription.active && !!x.body.subscription.pendingRequestId);
    x=await req('/api/admin/subscription',{method:'POST',headers:{'Content-Type':'application/json','X-Subscription-Admin-Key':key},body:JSON.stringify({requestId:renewalId,action:'approve'})});
    check('approved renewal extends from the existing expiry',x.r.status===200 && Date.parse(x.body.subscription.expiresAt)>firstExpiry);

    const rejectPayload={...payload,planId:'quarterly',transactionRef:'UTRTEST777888'};
    x=await req('/api/subscription/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rejectPayload)});
    const rejectId=x.body.request.id;
    x=await req('/api/admin/subscription',{method:'POST',headers:{'Content-Type':'application/json','X-Subscription-Admin-Key':key},body:JSON.stringify({requestId:rejectId,action:'reject',message:'Reference not found'})});
    check('rejected renewal leaves an existing active plan intact',x.r.status===200 && x.body.subscription.active && x.body.request.status==='rejected');

    const licensePath=path.join(dataDir,'subscription.json');
    const license=JSON.parse(fs.readFileSync(licensePath,'utf8'));
    license.expiresAt=new Date(Date.now()+3.5*86400000).toISOString();
    fs.writeFileSync(licensePath,JSON.stringify(license,null,2));
    x=await req('/api/subscription');
    check('server provides the in-app reminder during the final four days',x.body.active===true && x.body.daysRemaining===4 && x.body.reminderDays===4);
    license.expiresAt=new Date(Date.now()-86400000).toISOString();
    fs.writeFileSync(licensePath,JSON.stringify(license,null,2));
    x=await req('/api/subscription');
    check('server detects expiry',x.body.active===false && x.body.state==='expired');
    x=await req('/api/state');
    check('expired license hard-locks normal hotel API access',x.r.status===403);
    x=await req('/api/subscription/backup');
    check('server backup export remains available after expiry',x.r.status===200 && x.body.hotel.name==='Test Hotel');

    x=await req('/api/subscription/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,planId:'monthly',transactionRef:'UTRTEST999111'})});
    const reactivateId=x.body.request.id;
    x=await req('/api/admin/subscription',{method:'POST',headers:{'Content-Type':'application/json','X-Subscription-Admin-Key':key},body:JSON.stringify({requestId:reactivateId,action:'approve'})});
    check('approval after expiry reactivates a fresh plan from now',x.r.status===200 && x.body.subscription.active && Date.parse(x.body.subscription.startsAt)>Date.now()-60000);
    console.log('\nALL SUBSCRIPTION INTEGRATION TESTS PASSED');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(1500)]);
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
}
run().catch(e=>{console.error('SUBSCRIPTION TEST FAILED:',e);process.exitCode=1;});
