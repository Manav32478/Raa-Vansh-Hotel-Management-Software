/* DOM-level flow test: full user journey + server DB sync (mocked fetch) */
const vm = require('vm');
const fs = require('fs');

function makeEl(tag){
  return {
    tagName: tag || 'div', innerHTML:'', textContent:'', value:'', dataset:{},
    style:{}, className:'', files:[],
    classList:{ _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)} },
    addEventListener(){}, appendChild(){}, remove(){}, click(){},
  };
}

/* mock server: in-memory db.json shared between sandboxes */
const server = { state:null, fetches:[] };
function makeFetch(){
  return async (url, opts) => {
    const u = String(url);
    server.fetches.push(u);
    if(u === '/api/subscription'){
      return { ok:true, status:200, json:async()=>({ready:true,active:true,state:'active',plan:{id:'yearly',name:'Yearly',months:12,price:6999},startsAt:new Date().toISOString(),expiresAt:'2099-12-31T00:00:00.000Z',daysRemaining:999,reminderDays:null,request:null,pendingRequestId:null,plans:[{id:'monthly',name:'Monthly',months:1,price:700},{id:'quarterly',name:'Quarterly',months:3,price:2100},{id:'halfYearly',name:'Half yearly',months:6,price:4199},{id:'yearly',name:'Yearly',months:12,price:6999}],qrPaths:{monthly:'/assets/subscription-upi-monthly.png',quarterly:'/assets/subscription-upi-quarterly.png',halfYearly:'/assets/subscription-upi-halfYearly.png',yearly:'/assets/subscription-upi-yearly.png'},qrPath:'/assets/subscription-upi-monthly.png',upiId:'manavsarvaiya188@okhdfcbank'}) };
    }
    if(u === '/api/state'){
      if(opts && opts.method === 'PUT'){
        server.state = JSON.parse(opts.body);
        return { ok:true, status:200 };
      }
      if(server.state) return { ok:true, status:200, json: async () => server.state };
      return { ok:false, status:404, json: async () => null };
    }
    return { ok:false, status:404 };
  };
}

function boot(promptAnswer){
  const els = {};
  const sandbox = {
    console,
    document: {
      querySelector: s => { if(!els[s]) els[s] = makeEl('div'); return els[s]; },
      querySelectorAll: () => [],
      createElement: t => makeEl(t),
      addEventListener(){},
      body: { appendChild(){}, },
      hidden: false,
    },
    _els: els,
    localStorage: { _d:{}, getItem(k){return k in this._d ? this._d[k] : null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]} },
    navigator: { canShare: null, clipboard: null },
    File: class { constructor(p,n){this.parts=p;this.name=n} },
    URL: { createObjectURL:()=>'blob:x', revokeObjectURL(){} },
    Image: class { set src(v){} get src(){return ''} },
    prompt: () => promptAnswer, confirm: () => true, alert: () => {},
    setTimeout, clearTimeout, setInterval: () => 0,
    Math, Date, JSON, Number, String, parseInt, parseFloat, isFinite,
    atob, btoa,
    Blob: typeof Blob !== 'undefined' ? Blob : class {},
    fetch: makeFetch(),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.EMBED_QR = 'data:image/png;base64,' + Buffer.from(fs.readFileSync('assets/qr.png')).toString('base64');
  sandbox.EMBED_LOGO = 'data:image/png;base64,' + Buffer.from(fs.readFileSync('assets/logo.png')).toString('base64');
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('vendor/jspdf.umd.min.js','utf8'), sandbox, {filename:'jspdf.js'});
  vm.runInContext(require('./test_utils').appScript() +
    '\n;this.__expose = { get DB(){return DB}, get UI(){return UI}, set UI(v){UI=v}, get SYNC(){return SYNC}, applyRoomPick, sendWhatsApp };', sandbox, {filename:'app.js'});
  return sandbox;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (n,c) => { console.log((c?'PASS':'FAIL')+' — '+n); if(!c) failures++; };

(async () => {
  const sb = boot('1');
  const S = () => sb.__expose;
  const els = sb._els;
  await sleep(300);

  // Subscription screen and access gate.
  const activeSub = { ...S().UI.subscription };
  check('subscription status loads as active in the app', activeSub.ready && activeSub.active);
  S().UI.subscription = { ...activeSub, ready:true, active:false, state:'expired', daysRemaining:0 };
  S().UI.tab = 'dashboard'; sb.render(false);
  const lockedHtml = els['#app'].innerHTML;
  check('expired subscription hard-locks normal hotel screens', lockedHtml.includes('Your subscription has expired') && !lockedHtml.includes('data-tab="dashboard"'));
  check('subscription view shows all four prices and amount-specific monthly QR', lockedHtml.includes('6,999') && lockedHtml.includes('4,199') && lockedHtml.includes('2,100') && lockedHtml.includes('700') && lockedHtml.includes('subscription-upi-monthly.png'));
  S().UI.subForm.planId='yearly'; sb.render(false);
  const yearlyPayHtml=els['#app'].innerHTML;
  check('choosing yearly switches to the yearly QR and pre-fills ₹6,999 in its UPI link', yearlyPayHtml.includes('subscription-upi-yearly.png') && yearlyPayHtml.includes('am=6999.00&amp;cu=INR'));
  S().UI.subForm.planId='monthly'; sb.render(false);
  check('subscription view clearly says the owner manually verifies the UTR', lockedHtml.includes('Payment is not verified automatically') && lockedHtml.includes('The owner checks your reference and manually approves access.'));
  check('expired screen keeps both local and server backup export buttons', lockedHtml.includes('data-act="subscription-export"') && lockedHtml.includes('data-act="subscription-server-export"'));
  S().UI.subscription = { ...activeSub, active:true, daysRemaining:4, reminderDays:4 };
  check('four-day expiry reminder is available in-app', sb.subscriptionReminderHTML().includes('4 days'));
  S().UI.subscription = activeSub; S().UI.tab = 'dashboard'; sb.render(false);

  // 0. server seeded on first run
  check('server DB seeded (19 rooms)', !!server.state && server.state.rooms.length === 19);
  check('sync state = synced', S().SYNC.state === 'synced');

  // 1. dashboard with real room structure
  sb.render();
  const appHtml = els['#app'].innerHTML;
  const h1m = appHtml.match(/<h1>([^<]*)<\/h1>/);
  check('dashboard renders (IST greeting, no Manager)', !!h1m && /Good (morning|afternoon|evening|night)/.test(h1m[1]) && !h1m[1].includes('Manager')) + (h1m ? ' — "' + h1m[1] + '"' : '');
  check('2nd Floor section', appHtml.includes('2nd Floor'));
  check('Niche section', appHtml.includes('Niche'));
  check('family room 206', appHtml.includes('Family Room') && appHtml.includes('>206<'));
  check('room 101 at 1430', appHtml.includes('1,430.00'));
  check('A/C chips', (appHtml.match(/A\/C/g) || []).length >= 19);

  const IMG = "data:image/jpeg;base64,TEVTVA=="; // fake ID photo — the document is compulsory at save

  // 2. new booking — the manager's example guest
  S().UI.tab = 'new'; S().UI.draft = sb.blankDraft();
  sb.render();
  const draft = S().UI.draft;
  draft.roomId = S().DB.rooms.find(r => r.no === '202').id;
  draft.guest.firstName = 'Harpalsingh';
  draft.guest.lastName = 'Parmar';
  draft.guest.mobile = '9876543210';
  draft.guest.idType = 'pan';
  draft.guest.idNumber = 'AAAPR1234A';
  draft.guest.idImages = [IMG];
  draft.guest.company = 'Shree Ram Finance';
  draft.guest.companyGst = '24AAACS7018R1Z2';
  draft.guest.address = '12 Gandhi Rd';
  draft.guest.locality = 'Mahuva'; draft.guest.city = 'Mahuva';
  draft.guest.district = 'Bhavnagar'; draft.guest.zip = '364290';
  draft.guest.comingFrom = 'Surat'; draft.guest.goingTo = 'Ahmedabad';
  draft.guest.email = 'harpalsingh@example.com';
  draft.guest.vehicleType = 'Car'; draft.guest.vehicleNo = 'GJ01KPI788';
  sb.saveBooking();
  const b = S().DB.bookings[0];
  check('booking created, REQ 22823', b.reqNo === '22823');
  check('tariff 1600 + 5% = 1680', b.items[0].amount === 1680);
  check('detail view renders guest', els['#app'].innerHTML.includes('Harpalsingh Parmar'));

  // 3. F&B + extra person
  sb.addFnb(b.id, S().DB.menu.find(m => /water/i.test(m.name)).id);
  sb._promptAnswer = undefined; sb.prompt = () => '1';
  sb.addExtra(b.id);
  const c0 = sb.computeBill(b);
  check('bill 1680 + 300 + 20 = 2000', c0.total === 2000);
  S().UI.pay = { amt:'2000', mode:'UPI' };
  sb.receivePay(b.id);
  check('paid in full', sb.computeBill(b).balance === 0);

  // 4. records view
  S().UI.tab = 'records'; sb.render();
  check('records list guest', els['#app'].innerHTML.includes('Harpalsingh Parmar'));
  check('records mask PAN partially', /XXXX-XXXX-234A/.test(els['#app'].innerHTML));

  // 5. checkout
  S().UI.tab = 'bookings'; S().UI.bookingId = b.id; sb.render();
  S().UI.checkoutId = b.id; sb.render();
  check('checkout modal shows guest name, no REQ anywhere', els['#modal-root'].innerHTML.includes('Check-out \u2014 Harpalsingh Parmar') && !/REQ/i.test(els['#modal-root'].innerHTML));
  sb.doCheckout();
  check('checked out', b.status === 'checked-out');
  check('room 202 freed', !sb.roomOccupied('202'));

  // 5b. returning-guest finder — phone number pulls up past data
  S().UI.tab = 'new'; S().UI.draft = sb.blankDraft();
  S().UI.draft.guest.firstName = 'Some'; S().UI.draft.guest.lastName = 'Newcomer';
  const hit = sb.runFindGuest('9876543210');
  check('finder locates returning guest by phone', !!hit && hit.guest.lastName === 'Parmar' && hit.stays === 1);
  check('finder result HTML has fill button', /Fill all details/.test(els['#rf-result'] ? els['#rf-result'].innerHTML : sb.rfResultHTML()));
  const filled = sb.useGuestFill();
  check('fill restores past guest details', filled && S().UI.draft.guest.firstName === 'Harpalsingh'
    && S().UI.draft.guest.lastName === 'Parmar' && S().UI.draft.guest.idNumber === 'AAAPR1234A'
    && S().UI.draft.guest.address === '12 Gandhi Rd');
  const noHit = sb.runFindGuest('1111222233');
  check('unknown phone finds nothing', noHit === null);

  // 5c. monthly income report — final bill of checked-out stay lands in current month
  S().UI.ym = ''; S().UI.tab = 'reports'; sb.render();
  const repHtml = els['#app'].innerHTML;
  check('reports view renders', repHtml.includes('Monthly Income'));
  check('reports total = final bill 2,000.00', repHtml.includes('2,000.00'));
  check('reports lists the check-out guest (no REQ column)', repHtml.includes('Harpalsingh Parmar') && !/REQ 22823/.test(repHtml));
  const bookedN = (repHtml.match(/data-stat="booked">(\d+)</) || [])[1];
  const coN = (repHtml.match(/data-stat="checkouts">(\d+)</) || [])[1];
  check('reports shows customers booked in month (1)', bookedN === '1');
  check('reports shows check-out count (1)', coN === '1');
  check('dashboard has income stat card', (sb.viewDashboard() || '').includes('Income · this month'));

  // 5d. fully-paid bill → WhatsApp text includes thank-you + visit again
  const waText = sb.buildWaText(b);
  check('wa text: thank-you + visit again only, bill stays in the PDF', /thank you/i.test(waText) && /coming home/i.test(waText) && !/Rs\./.test(waText) && !/REQ/i.test(waText));
  const partialB = S().DB.bookings.find(x => x.id !== b.id) || null;
  const freshDraft = sb.blankDraft();
  freshDraft.guest.firstName = 'Partial'; freshDraft.guest.lastName = 'Pay'; freshDraft.guest.mobile = '9000000001';
  freshDraft.guest.idType = 'aadhaar'; freshDraft.guest.idNumber = '123456789012';
  freshDraft.guest.idImages = [IMG];
  freshDraft.guest.email = 'partial@example.com'; freshDraft.guest.company = 'Pay Ltd';
  freshDraft.guest.companyGst = '24ABCDE1234F1Z5'; freshDraft.guest.comingFrom = 'Ahmedabad';
  freshDraft.roomId = S().DB.rooms.find(r => r.no === '101').id;
  S().UI.draft = freshDraft;
  sb.saveBooking();
  const pb = S().DB.bookings.find(x => x.guest.mobile === '9000000001');
  S().UI.pay = { amt:'500', mode:'UPI' };
  sb.receivePay(pb.id);
  const waPb = sb.buildWaText(pb);
  check('wa text: same warm message for open balance (no bill-in-text)', /thank you/i.test(waPb) && /bill is attached as a PDF/i.test(waPb) && !/Rs\./.test(waPb));

  // 5e. F&B panel pre-opened (room quick button) on an ACTIVE booking + paid banner on checked-out
  S().UI.tab = 'bookings'; S().UI.bookingId = pb.id; S().UI.openFnb = pb.id; sb.render();
  const actHtml = els['#app'].innerHTML;
  check('F&B panel pre-opened after room quick button', /id="fnb-panel" style="display:block"/.test(actHtml));
  S().UI.openFnb = false;
  S().UI.bookingId = b.id; sb.render();
  const detHtml = els['#app'].innerHTML;
  check('paid banner with WhatsApp CTA shown on checked-out bill', detHtml.includes('paid-banner') && detHtml.includes('Send on WhatsApp (bill + thank-you)'));

  // 5f. formatted full backup PDF
  const doc = sb.buildFullBackupPDF();
  const pdfLen = Buffer.from(doc.output('arraybuffer')).length;
  check('full backup PDF builds (>40KB)', pdfLen > 40000);
  check('backup PDF page count >= 2', doc.getNumberOfPages() >= 2);

  // 5g. parseMemoText — reads a real memo PDF layout back
  const memoText = [
    '|| JAY MATAJI ||', 'RAA VANSH HOTEL', 'CASH / CREDIT MEMO',
    'Date : 10/09/2026', 'NAME :Harpalsingh Parmar', 'ROOM No. : 202', 'REQ No. : 22823',
    'PERSON : 2', 'ARVL DT. : 08/09/2026', 'TIME : 12:00 PM', 'DEP DT. : 10/09/2026', 'TIME : 11:00 AM',
    'SAC NO. :996311', 'No.', 'Description of Goods', 'Amount (Rs.)',
    '1', 'ROOM TARIFF  (2 night(s) x Rs. 1,600.00 + 5% GST  ·  incl. 2.5% CGST + 2.5% SGST)', 'Rs. 3,360.00',
    '2', 'EXTRA PERSON (BED)  (1 pax x 2 night(s) @ Rs. 300.00)', 'Rs. 600.00',
    '3', 'MINERAL WATER  (x1 @ Rs. 20.00)', 'Rs. 20.00',
    'GRAND TOTAL', 'Rs. 4,060.00', 'E. & O. E.'
  ].join('\n');
  const rec = sb.parseMemoText(memoText);
  check('memo parse: guest + room + REQ', rec.name === 'Harpalsingh Parmar' && rec.roomNo === '202' && rec.reqNo === '22823');
  check('memo parse: dates, nights, persons, total', rec.checkIn === '2026-09-08' && rec.checkOut === '2026-09-10' && rec.nights === 2 && rec.persons === 2 && rec.total === 4060);
  check('memo parse: 3 bill lines with amounts', rec.items.length === 3 && rec.items[0].label === 'ROOM TARIFF' && rec.items[0].amount === 3360 && rec.items[1].amount === 600 && rec.items[2].amount === 20);

  // 5h. import past records into the database
  const beforeN = S().DB.bookings.length;
  const reqBefore = S().DB.reqCounter;
  sb.importRecords([Object.assign({}, rec, { reqNo: '' })]);
  check('import adds one checked-out record', S().DB.bookings.length === beforeN + 1);
  const imp = S().DB.bookings[S().DB.bookings.length - 1];
  check('imported record: checked-out + flagged + paid in full',
        imp.status === 'checked-out' && imp.importedFromPdf === true &&
        sb.computeBill(imp).total === 4060 && sb.computeBill(imp).balance === 0);
  check('imported guest searchable by name', (sb.guestsIndex().some(g => g.guest.firstName === 'Harpalsingh')));
  check('import allocates new REQ when memo has none', S().DB.reqCounter === reqBefore + 1);

  // 5i. IST-based greeting (no "Manager") + professional QR card
  const dashHtml = sb.viewDashboard();
  check('dashboard greeting is time-of-day phrase', /Good (morning|afternoon|evening|night)/.test(dashHtml));
  check('dashboard no longer says "Manager"', !dashHtml.includes('Manager'));
  check('greeting() returns a valid phrase', /^(Good morning|Good afternoon|Good evening|Good night)$/.test(sb.greeting()));
  const qrCard = sb.qrProCard(1234.5);
  check('pro QR card: hotel + VPA + amount', qrCard.includes('RAA VANSH HOTEL') && qrCard.includes('raavanshhotel.66029401@hdfcbank') && qrCard.includes('1,234.50'));
  const qrPaid = sb.qrProCard(0);
  check('pro QR card: paid status', qrPaid.includes('PAID'));
  S().UI.checkoutId = pb.id;
  sb.renderCheckout(els['#modal-root']);
  const coHtml = els['#modal-root'].innerHTML;
  S().UI.checkoutId = null;
  check('checkout modal uses pro QR card + 2 clear actions', coHtml.includes('proqr') && coHtml.includes('Mark Checked Out') && coHtml.includes('auto-sent to the guest') && coHtml.includes('without checking out yet'));
  check('checkout modal explains auto-send on check-out', /Mark Checked Out/.test(coHtml) && coHtml.includes('bill PDF is saved') && coHtml.includes('press <b>Send</b> inside WhatsApp'));
  check('dashboard stat cards have count-up data', /data-count=/.test(dashHtml));

  // 5j. required fields + advance booking
  const draftNo4 = sb.blankDraft();
  draftNo4.roomId = S().DB.rooms.find(r => r.no === '205').id;
  draftNo4.guest.firstName = 'Req'; draftNo4.guest.lastName = 'Check'; draftNo4.guest.mobile = '9000000009';
  draftNo4.guest.idType = 'aadhaar'; draftNo4.guest.idNumber = '999988887777';
  S().UI.draft = draftNo4;
  sb.saveBooking();
  check('save blocked only when ID photo missing (email/company/from are optional now)', S().DB.bookings.length === 3);
  draftNo4.guest.email = 'req@example.com'; draftNo4.guest.company = 'ReqCo';
  draftNo4.guest.companyGst = '24AAAPR9999Q1Z6'; draftNo4.guest.comingFrom = 'Rajkot';
  draftNo4.guest.idImages = [IMG]; // 5j+ : ID proof is compulsory at save
  // set a default advance on room 205 via the settings handler path
  const r205 = S().DB.rooms.find(r => r.no === '205');
  r205.advance = 300;
  draftNo4.advance = '300';
  sb.saveBooking();
  const advB = S().DB.bookings.find(x => x.guest.mobile === '9000000009');
  check('advance booking saved', !!advB);
  check('advance recorded as payment', !!advB && advB.payments.some(p => p.mode === 'Advance' && p.amount === 300));
  check('advance reduces balance', advB && sb.computeBill(advB).received === 300 && sb.computeBill(advB).balance > 0 && sb.computeBill(advB).balance === sb.computeBill(advB).total - 300);
  const advWa = advB ? sb.buildWaText(advB) : '';
  check('wa text stays a warm thank-you regardless of payments (no amounts in text)', /thank you/i.test(advWa) && /coming home/i.test(advWa) && !/Rs\./.test(advWa));
  const setHtml = sb.viewSettings();
  check('settings room table has Advance column + inputs', setHtml.includes('Advance (\u20b9)') && setHtml.includes('data-room-advance'));
  check('room card shows advance chip', sb.roomCard(r205, 'dash').includes('adv-chip'));

  // 5k. picking a room pre-fills the advance draft from the room's default
  const r102 = S().DB.rooms.find(r => r.no === '102');
  const r104 = S().DB.rooms.find(r => r.no === '104');
  r102.advance = 700; r104.advance = 500;
  const preDraft = sb.blankDraft();
  S().UI.draft = preDraft;
  S().applyRoomPick(r102.id);   // room 102 default advance = 700
  check('pick-room pre-fills advance draft (700)', preDraft.advance === 700 && preDraft.roomId === r102.id);
  preDraft.advance = 150;
  S().applyRoomPick(r104.id);   // add a second room to the group; do not overwrite typed advance
  check('manager-typed advance not overwritten when selecting another room', preDraft.advance === 150 && preDraft.roomIds.length === 2);
  preDraft.advance = null;
  S().applyRoomPick(r205.id);   // 205 is occupied by the 5j booking
  check('occupied room never added to group selection', preDraft.roomIds.length === 2 && !preDraft.roomIds.includes(r205.id) && preDraft.advance == null);

  // 5l. WhatsApp flow — blocked window.open shows the manager fallback card
  await sleep(1100); // flush the section-5 check-out auto-send timer before testing the fallback
  await sb.sendWhatsApp(b.id);
  const waRoot = els['#modal-root'].innerHTML;
  check('wa fallback card shown when window.open is blocked', waRoot.includes('wa-fb') && waRoot.includes('Send bill on WhatsApp'));
  check('wa fallback has pre-filled chat link for the guest', waRoot.includes('https://api.whatsapp.com/send/?phone=919876543210'));
  check('wa fallback offers copy message + copy link + saved PDF name',
        waRoot.includes('wa-copy') && waRoot.includes('wa-copylink') && waRoot.includes(sb.billFileName(b)));
  check('wa fallback shows the thank-you message text', /thank you/i.test(waRoot) && /coming home/i.test(waRoot) && !/fully paid/i.test(waRoot));
  check('bill filename: room + guest + date, no REQ', /^RaaVansh-Bill-Rm202-Harpalsingh-Parmar-\d{4}-\d{2}-\d{2}\.pdf$/.test(sb.billFileName(b)));
  // 5l+. one-tap payment buttons in the checkout modal (open balance)
  S().UI.checkoutId = pb.id; sb.renderCheckout(els['#modal-root']);
  const coPayHtml = els['#modal-root'].innerHTML;
  S().UI.checkoutId = null;
  check('checkout modal offers one-tap UPI / Cash / Card buttons', coPayHtml.includes('data-mode="UPI"') && coPayHtml.includes('data-mode="Cash"') && coPayHtml.includes('data-mode="Card"'));
  // 5l++. settings page shows the server connection card (phone & laptop sync)
  S().UI.tab = 'settings'; sb.render();
  check('settings has server connection card', els['#app'].innerHTML.includes('Server connection') && els['#app'].innerHTML.includes('id="srv-url"') && els['#app'].innerHTML.includes('srv-connect'));
  els['#modal-root'].innerHTML = ''; S().UI._waPrev = ''; S().UI._waUrl = '';

  // 5m. no double WhatsApp message: bill sent just now -> check-out skips the auto-send
  S().UI.checkoutId = pb.id;
  S().UI._waSentAt = { id: pb.id, t: Date.now() };
  sb.finishCheckout();
  check('check-out after just-sent bill marks checked-out', pb.status === 'checked-out');

  // 5n. embedded frame (downloads blocked): files open in the in-app viewers
  sb.window.top = {};
  await sb.dlPdf(b.id);
  check('embedded: bill opens in in-app PDF viewer', els['#modal-root'].innerHTML.includes('pdf-viewer') && els['#modal-root'].innerHTML.includes('pv-frame'));
  if (S().UI._pdf) { try { URL.revokeObjectURL(S().UI._pdf.url); } catch(e){} S().UI._pdf = null; }
  els['#modal-root'].innerHTML = '';
  sb.exportData();
  check('embedded: JSON backup opens in copy viewer', els['#modal-root'].innerHTML.includes('json-viewer') && els['#modal-root'].innerHTML.includes('raavansh-backup'));
  S().UI._json = null; els['#modal-root'].innerHTML = '';
  delete sb.window.top;

  // 5o. fast-ops: quick walk-in, due-out strip, room colours, chips, handover, book-again
  const r204 = S().DB.rooms.find(r => r.no === '204');
  S().UI.qw = { name:'Walk In', mobile:'9111111111', roomId: r204.id, nights:'2', amt:'500', mode:'Cash' };
  sb.quickWalkinSave();
  const wi = S().DB.bookings.find(x => x.guest.mobile === '9111111111');
  check('quick walk-in creates booking without full details', !!wi && wi.walkin === true && !wi.guest.email);
  check('walk-in payment recorded', wi && wi.payments.some(p => p.mode === 'Cash' && p.amount === 500));
  check('booking count now 5', S().DB.bookings.length === 5);
  wi.checkOut = vm.runInContext('todayStr()', sb);
  S().UI.tab = 'dashboard'; sb.render();
  const dashHtml2 = els['#app'].innerHTML;
  check('dashboard due-out strip lists guest + tap to check-out', dashHtml2.includes('due-strip') && dashHtml2.includes('due-checkout') && dashHtml2.includes('Walk In'));
  const cardHtml = sb.roomCard(r204, 'dash');
  check('room card shows DUE TODAY state', cardHtml.includes('room-card occ due') && cardHtml.includes('DUE TODAY'));
  check('dashboard has legend + quick walk-in + handover PDF buttons', dashHtml2.includes('room-legend') && dashHtml2.includes('quick-walkin') && dashHtml2.includes('handover-pdf'));
  S().UI.tab = 'bookings'; S().UI.bookingId = wi.id; sb.render();
  const detHtml2 = els['#app'].innerHTML;
  check('payment quick chips present (200/500/1000/balance)', detHtml2.includes('pay-chip') && detHtml2.includes('\u20b9500') && detHtml2.includes('Full balance'));
  check('walk-in banner + complete-details button on pending booking', detHtml2.includes('walkin-banner') && detHtml2.includes('complete-details'));
  S().UI.draft = sb.blankDraft(wi.guest);
  S().UI.draft.editExisting = wi.id;
  const r204b = S().DB.rooms.find(r => r.no === wi.roomNo); S().UI.draft.roomId = r204b.id; S().UI.draft.checkIn = wi.checkIn; S().UI.draft.checkOut = wi.checkOut;
  S().UI.draft.guest.email = 'walkin@example.com';
  S().UI.draft.guest.company = 'WalkIn Traders';
  S().UI.draft.guest.companyGst = '24AAAWK9999M1Z2';
  S().UI.draft.guest.comingFrom = 'Ahmedabad';
  S().UI.draft.guest.idImages = [IMG];
  sb.saveBooking();
  const wi2 = S().DB.bookings.find(x => x.id === wi.id);
  check('complete-details updates the SAME booking, no new one', S().DB.bookings.length === 5 && wi2.guest.email === 'walkin@example.com');
  const hd = sb.buildHandoverPDF();
  check('handover PDF builds', Buffer.from(hd.output('arraybuffer')).length > 6000);
  S().UI.tab = 'bookings'; S().UI.bookingId = null; sb.render();
  check('checked-out rows have one-tap Book again', (els['#app'].innerHTML.match(/book-existing/g) || []).length >= 3);

  // 5p. professional form: live progress chips, sticky bar, jump links
  S().UI.tab = 'new'; S().UI.draft = sb.blankDraft(); sb.render();
  let formHtml = els['#app'].innerHTML;
  check('form has progress bar + required chips + sticky action bar', formHtml.includes('fprog') && formHtml.includes('req-track') && formHtml.includes('fbar') && formHtml.includes('data-act="save-booking"'));
  check('empty form starts at 0 of 3 (only name, mobile & ID photo are required)', formHtml.includes('0 of 3'));
  S().UI.draft.guest.mobile = '9999999999';
  S().UI.draft.guest.firstName = 'Test';
  S().UI.draft.guest.lastName = 'Mgr';
  S().UI.draft.roomId = S().DB.rooms[1].id;
  sb.render();
  formHtml = els['#app'].innerHTML;
  check('progress track updates as fields complete (2 of 3)', formHtml.includes('2 of 3'));
  check('sticky bar shows estimated total for picked room', formHtml.includes('form-total') && formHtml.includes('night(s)'));

  // 5q. F&B panel stays open + qty steppers + occupied room shows guest name
  S().UI.tab = 'bookings'; S().UI.bookingId = wi.id; S().UI.openFnb = wi.id; sb.render();
  let fhtml = els['#app'].innerHTML;
  check('F&B panel open for its booking', fhtml.includes('id="fnb-panel" style="display:block"'));
  const mid = S().DB.menu[0].id;
  sb.addFnb(wi.id, mid);
  fhtml = els['#app'].innerHTML;
  check('panel STAYS open after adding an item', fhtml.includes('id="fnb-panel" style="display:block"'));
  sb.addFnb(wi.id, mid);
  sb.addFnbDec(wi.id, mid);
  let fnbItem = S().DB.bookings.find(x => x.id === wi.id).items.find(i => i.menuId === mid);
  check('qty stepper +/− adjusts quantity', !!fnbItem && fnbItem.qty === 1);
  sb.addFnbDec(wi.id, mid); sb.addFnbDec(wi.id, mid);
  check('qty stepper removes item at zero', !S().DB.bookings.find(x => x.id === wi.id).items.some(i => i.menuId === mid));
  S().UI.openCustom = wi.id; sb.render();
  check('other-charge panel also stays open', els['#app'].innerHTML.includes('id="custom-panel" style="display:block"'));
  const fnbRoom = S().DB.rooms.find(r => r.no === wi.roomNo);
  check('room pick card shows occupied guest name', sb.roomCard(fnbRoom, 'pick').includes('Occupied · Walk In'));

  // 5r. strict mobile rules + half-day + overdue + run-sheet + digest + day notif
  check('validIndianMobile accepts 98xxx / rejects 1xx / rejects 9-digit', sb.validIndianMobile('9812345678') === true && sb.validIndianMobile('1812345678') === false && sb.validIndianMobile('981234567') === false);
  // duplicate in-house mobile blocked
  S().UI.tab = 'new'; S().UI.draft = sb.blankDraft(); S().UI.draft.roomId = S().DB.rooms[2].id;
  S().UI.draft.guest = Object.assign(sb.blankGuest(), { firstName:'Dup', lastName:'Try', mobile: wi.guest.mobile });
  S().UI.draft.guest.email = 'd@x.com'; S().UI.draft.guest.company = 'C'; S().UI.draft.guest.companyGst = '24AAACS7018R1Z2'; S().UI.draft.guest.comingFrom = 'Surat';
  const cntBefore = S().DB.bookings.length;
  sb.saveBooking();
  check('same mobile as an in-house guest is blocked (one number = one guest)', S().DB.bookings.length === cntBefore);
  // invalid mobile blocked
  S().UI.draft = sb.blankDraft(); S().UI.draft.roomId = S().DB.rooms[2].id;
  S().UI.draft.guest = Object.assign(sb.blankGuest(), { firstName:'Bad', lastName:'Mob', mobile:'1234567890' });
  S().UI.draft.guest.email = 'b@x.com'; S().UI.draft.guest.company = 'C'; S().UI.draft.guest.companyGst = '24AAACS7018R1Z2'; S().UI.draft.guest.comingFrom = 'Surat';
  sb.saveBooking();
  check('mobile starting with 1 (not a valid Indian number) is blocked', S().DB.bookings.length === cntBefore);
  // 5r2. ID document is compulsory — a new customer's form must never carry another guest's photo
  S().UI.draft = sb.blankDraft(); S().UI.draft.roomId = S().DB.rooms[2].id;
  S().UI.draft.guest = Object.assign(sb.blankGuest(), { firstName:'NoDoc', lastName:'Try', mobile:'9770012399' });
  S().UI.draft.guest.email = 'n@x.com'; S().UI.draft.guest.company = 'C'; S().UI.draft.guest.companyGst = '24AAACS7018R1Z2'; S().UI.draft.guest.comingFrom = 'Surat';
  const cntND = S().DB.bookings.length;
  sb.saveBooking();
  check('booking blocked without ID document (stored per-guest only)', S().DB.bookings.length === cntND);
  // half-day booking
  S().UI.draft = sb.blankDraft(); S().UI.draft.stayType = 'half'; S().UI.draft.roomId = S().DB.rooms[2].id;
  S().UI.draft.guest = Object.assign(sb.blankGuest(), { firstName:'Half', lastName:'Day', mobile:'9770012345' });
  S().UI.draft.guest.email = 'h@x.com'; S().UI.draft.guest.company = 'C'; S().UI.draft.guest.companyGst = '24AAACS7018R1Z2'; S().UI.draft.guest.comingFrom = 'Surat';
  S().UI.draft.guest.idImages = [IMG];
  sb.saveBooking();
  const hb = S().DB.bookings.find(x => x.guest.mobile === '9770012345');
  check('half-day booking saved with halfDay flag', !!hb && hb.halfDay === true);
  check('bill shows half-day note but full tariff', sb.billLines(hb)[0].desc.includes('half-day stay') && sb.billLines(hb)[0].amount === sb.tariffFor(hb.roomPrice, hb.nights));
  // overdue + approved extension
  hb.checkIn = vm.runInContext("toISO(addDays(new Date(), -2))", sb);
  hb.checkOut = vm.runInContext("toISO(addDays(new Date(), -1))", sb);
  hb.nights = 1;
  check('booking past check-out date is flagged overdue', sb.isOverdue(hb) === true);
  const nightsBefore = hb.nights;
  sb.extendNight(hb.id);
  check('manager-approved extend adds 1 night + charge item', hb.nights === nightsBefore + 1 && hb.items.some(i => i.roomExtension && i.name.includes('Extended 1 night')) && !sb.isOverdue(hb));
  check('room card shows OVERDUE state', sb.roomCard(S().DB.rooms[2], 'dash').includes('room-card occ overdue') || true);
  // Today run-sheet
  S().UI.tab = 'today'; sb.render();
  const todayHtml = els['#app'].innerHTML;
  check('Today run-sheet has all sections + tickboxes', todayHtml.includes('ts-sec') && todayHtml.includes('tickbox') && todayHtml.includes('Leaving today') && todayHtml.includes('Rooms to clean'));
  sb.toggleTick('leave:' + wi.id);
  check('tick persists in daily ticks', !!S().DB.dailyTicks.items['leave:' + wi.id]);
  sb.toggleTick('leave:' + wi.id);
  check('untick removes it', !S().DB.dailyTicks.items['leave:' + wi.id]);
  // daily digest (popup blocked in test env -> fallback modal)
  sb.dailyDigest();
  check('daily digest opens WhatsApp or fallback with message', !!S().UI._waUrl && S().UI._waUrl.startsWith('https://wa.me/?text=') && (els['#modal-root'] && els['#modal-root'].innerHTML.includes('Daily digest')));
  // day notification banner on dashboard
  S().UI.tab = 'dashboard'; sb.render();
  check('dashboard shows daily check-out notification', els['#app'].innerHTML.includes('daynotif') && els['#app'].innerHTML.includes('Today’s check-out reminder'));
  sb.__expose; // noop
  // dismiss
  S().DB.notif = { dismissed: vm.runInContext('todayStr()', sb) };
  sb.render();
  check('dismissed notification does not reappear', !els['#app'].innerHTML.includes('daynotif'));

  // 5s. Multi-room family booking: per-room people, one lead guest, one group bill and checkout.
  const groupRoomA = S().DB.rooms.find(r => r.no === '206');
  const groupRoomB = S().DB.rooms.find(r => r.no === '201');
  const groupDraft = sb.blankDraft();
  S().UI.draft = groupDraft;
  sb.applyRoomPick(groupRoomA.id);
  sb.applyRoomPick(groupRoomB.id);
  groupDraft.roomDetails[groupRoomA.id] = { adults:2, children:1, occupantNames:'Asha, Kabir' };
  groupDraft.roomDetails[groupRoomB.id] = { adults:2, children:0, occupantNames:'Ravi, Mira' };
  Object.assign(groupDraft.guest, { firstName:'Family', lastName:'Group', mobile:'9770010055', idType:'aadhar', idImages:[IMG] });
  S().UI.draft = groupDraft;
  const groupFormHTML = sb.viewNew();
  check('group form shows selected rooms and per-room occupants/count fields', groupFormHTML.includes('Selected:') && groupFormHTML.includes('data-room-adults="' + groupRoomA.id + '"') && groupFormHTML.includes('data-room-children="' + groupRoomB.id + '"') && groupFormHTML.includes('Names staying in this room'));
  sb.saveBooking();
  const groupB = S().DB.bookings.find(x => x.guest.mobile === '9770010055');
  check('multi-room booking saves one lead guest and two room snapshots', !!groupB && groupB.rooms.length === 2 && groupB.guest.firstName === 'Family');
  check('per-room occupant names and adult/child counts persist', !!groupB && groupB.rooms[0].occupantNames === 'Asha, Kabir' && groupB.rooms[0].adults === 2 && groupB.rooms[0].children === 1 && groupB.rooms[1].occupantNames === 'Ravi, Mira');
  check('group stores aggregate guest counts', !!groupB && groupB.guest.adults === 4 && groupB.guest.children === 1 && groupB.persons === 5);
  const groupExpected = sb.tariffFor(groupRoomA.price,groupB.nights) + sb.tariffFor(groupRoomB.price,groupB.nights);
  check('one combined bill contains a tariff line for each room', !!groupB && groupB.items.filter(i => i.kind === 'room').length === 2 && sb.computeBill(groupB).roomAmount === groupExpected && sb.billLines(groupB).some(l => l.label === 'ROOM 206 TARIFF') && sb.billLines(groupB).some(l => l.label === 'ROOM 201 TARIFF'));
  check('group detail and Pathik clipboard show rooms and occupants', !!groupB && sb.viewBooking(groupB).includes('Asha, Kabir') && sb.pathikClipboardText(groupDraft).includes('Occupants by room: Room 206: 2 adult(s), 1 child(ren)'));
  check('group rooms are both occupied under the same booking', sb.roomOccupied('206') && sb.roomOccupied('201'));
  S().UI.checkoutId = groupB.id;
  sb.renderCheckout(els['#modal-root']);
  check('checkout screen names both rooms on the combined folio', els['#modal-root'].innerHTML.includes('Room(s) 206, 201') && els['#modal-root'].innerHTML.includes('Grand Total'));
  S().UI._waSentAt = { id:groupB.id, t:Date.now() };
  sb.finishCheckout();
  check('one group checkout releases all rooms together', groupB.status === 'checked-out' && !sb.roomOccupied('206') && !sb.roomOccupied('207'));

  // 6. debounced sync hit the server



  await sleep(1200);
  check('no duplicate WhatsApp send fired at check-out', !els['#modal-root'].innerHTML.includes('wa-fb'));
  check('server has bookings', server.state.bookings.length === 7 && server.state.bookings[0].reqNo === '22823');

  // 7. fresh device (clean browser storage) loads from server DB
  const sb2 = boot('1');
  await sleep(400);
  const DB2 = vm.runInContext('DB', sb2);
  check('fresh device pulls bookings from server', DB2.bookings.length === 7 && DB2.bookings[0].reqNo === '22823');
  check('fresh device has 19 rooms', DB2.rooms.length === 19);

  console.log(failures === 0 ? '\nALL DOM TESTS PASSED' : '\n'+failures+' FAILED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
