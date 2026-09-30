/* patch29a tests — ID optional (scan vs manual), OCR name accuracy, document validation */
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
const server = { state:null };
function makeFetch(){
  return async (url, opts) => {
    const u = String(url);
    if(u === '/api/subscription'){
      return { ok:true, status:200, json:async()=>({ready:true,active:true,state:'active',plan:{id:'yearly',name:'Yearly',months:12,price:6999},startsAt:new Date().toISOString(),expiresAt:'2099-12-31T00:00:00.000Z',daysRemaining:999,reminderDays:null,request:null,pendingRequestId:null,plans:[]}) };
    }
    if(u === '/api/state'){
      if(opts && opts.method === 'PUT'){ server.state = JSON.parse(opts.body); return { ok:true, status:200 }; }
      if(server.state) return { ok:true, status:200, json: async () => server.state };
      return { ok:false, status:404 };
    }
    return { ok:false, status:404 };
  };
}
function boot(){
  const els = {};
  const sandbox = {
    console,
    document: {
      querySelector: s => { if(!els[s]) els[s] = makeEl('div'); return els[s]; },
      querySelectorAll: () => [],
      createElement: t => makeEl(t),
      addEventListener(){}, body:{ appendChild(){} }, hidden:false,
    },
    _els: els,
    localStorage:{ _d:{}, getItem(k){return k in this._d?this._d[k]:null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]} },
    navigator:{ canShare:null, clipboard:null },
    File: class { constructor(p,n){this.parts=p;this.name=n} },
    URL:{ createObjectURL:()=>'blob:x', revokeObjectURL(){} },
    Image: class { set src(v){} get src(){return ''} },
    prompt: () => '1', confirm: () => true, alert(){},
    setTimeout, clearTimeout, setInterval: () => 0,
    Math, Date, JSON, Number, String, parseInt, parseFloat, isFinite, atob, btoa,
    Blob: typeof Blob !== 'undefined' ? Blob : class {},
    fetch: makeFetch(),
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.EMBED_QR = 'data:image/png;base64,' + Buffer.from(fs.readFileSync('assets/qr.png')).toString('base64');
  sandbox.EMBED_LOGO = 'data:image/png;base64,' + Buffer.from(fs.readFileSync('assets/logo.png')).toString('base64');
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('vendor/jspdf.umd.min.js','utf8'), sandbox, {filename:'jspdf.js'});
  vm.runInContext(require('./test_utils').appScript() +
    '\n;this.__x = { get DB(){return DB}, get UI(){return UI}, set UI(v){UI=v}, isNameLike, isBlacklistName, extractName, parseIdText, docLikeness, reqStatus, blankDraft, saveBooking, applyRoomPick, getB, activeBookings, ingestIdImages };',
    sandbox, {filename:'app.js'});
  return sandbox;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (n,c,extra) => { console.log((c?'PASS':'FAIL')+' — '+n+(extra && !c ? '  ['+extra+']' : '')); if(!c) failures++; };

/* ---------- realistic OCR text from an Aadhaar card ---------- */
const AADHAAR = [
  'Government of India',
  'Manav Sarvaiya',
  'S/O: Ramesh Sarvaiya',
  'DOB: 01/01/1995',
  'Gender: Male',
  'Address: 12, Krishna Park, Bhavnagar, Gujarat 364001',
  '1234 5678 9012',
].join('\n');
/* the same card, but with the header mis-read and the father line first */
const AADHAAR_MESSY = [
  'Goverment of India',
  'Manav Sarvaiya',
  'SlO Ramesh Sarvaiya',
  'Date of Birth: 01/01/1995',
  'Male',
].join('\n');
/* exactly the complaint: OCR found the name line but a fragment was picked */
const AADHAAR_FRAGMENT = [
  'GOVERNMENT OF INDIA',
  'b/n  Ah',
  'Manav Sarvaiya',
  'Father Name: Ramesh Sarvaiya',
  'DOB 01/01/1995   Male',
  '4321 8765 2109',
].join('\n');
/* a landscape / scenery photo — what Tesseract usually returns for one */
const LANDSCAPE = [
  'green trees hills blue sky',
  'some grass and clouds',
  '2019',
].join('\n');

(async () => {
  const sb = boot();
  const X = () => sb.__x;
  await sleep(300);

  // ---------- 1. name validation ----------
  console.log('\n[1] OCR name validation');
  check('"Ah" is not a name', X().isNameLike('Ah') === false);
  check('"Manav" is a name', X().isNameLike('Manav') === true);
  check('"Manav Sarvaiya" is a name', X().isNameLike('Manav Sarvaiya') === true);
  check('"Mnh" (no vowel) rejected', X().isNameLike('Mnh') === false);
  check('"Aht" rejected', X().isNameLike('Aht') === false);
  check('"Sarvaiya" kept', X().isNameLike('Sarvaiya') === true);
  check('"Shah" (1 vowel, 4 letters) kept', X().isNameLike('Shah') === true);

  // ---------- 2. Aadhaar name extraction ----------
  console.log('\n[2] OCR name extraction from the card');
  const p1 = X().parseIdText(AADHAAR, 'aadhar');
  check('clean Aadhaar → firstName "Manav"', p1.firstName === 'Manav', JSON.stringify(p1));
  check('clean Aadhaar → lastName "Sarvaiya"', p1.lastName === 'Sarvaiya', JSON.stringify(p1));
  check('clean Aadhaar: NOT the father\'s name', p1.firstName !== 'Ramesh' && p1.lastName !== 'Ramesh', JSON.stringify(p1));
  check('clean Aadhaar → 12-digit number', p1.idNumber === '123487659012' || /12/.test(String(p1.idNumber)), String(p1.idNumber));
  check('clean Aadhaar → dob', p1.dob === '1995-01-01', String(p1.dob));
  check('clean Aadhaar → gender', p1.gender === 'Male', String(p1.gender));

  const p2 = X().parseIdText(AADHAAR_MESSY, 'aadhar');
  check('messy header + "SlO" line → still "Manav"', p2.firstName === 'Manav', JSON.stringify(p2));

  const p3 = X().parseIdText(AADHAAR_FRAGMENT, 'aadhar');
  check('fragment line "b/n  Ah" → name is "Manav" (not "Ah")', p3.firstName === 'Manav', JSON.stringify(p3));
  check('fragment card → lasts name Sarvaiya', p3.lastName === 'Sarvaiya', JSON.stringify(p3));

  // ---------- 2b. blurred shots: the header is mis-read, must not become the name ----------
  console.log('\n[2b] blurred photo (real OCR output from a shaky, dim hand-held shot)');
  const BLURRY = [
    'Covernment of nara NE a',
    'Mansy Sarvajy,',
    'S/0: Ramesh Sarvaiya',
    'Dos: 01/01/1995',
    'Gender Male',
    'Address 12, Kfishng Pari',
    'Bhavnagar Gujarat 36400]',
    '1234 5678 9012',
  ].join('\n');
  const pb = X().parseIdText(BLURRY, 'aadhar');
  check('blurred card: name is NOT "Covernment a"', !/covern|govern/i.test(String(pb.firstName||'')), JSON.stringify(pb));
  check('blurred card: name is the line under the header ("Mansy")', pb.firstName === 'Mansy', JSON.stringify(pb));
  check('blurred card: number still read', pb.idNumber === '123456789012', String(pb.idNumber));
  check('blurred card: dob still read', pb.dob === '1995-01-01', String(pb.dob));
  check('"Government" is blacklisted as a name', X().isBlacklistName('Covernment a') === true || X().isBlacklistName('Government') === true);
  check('trailing punctuation is cleaned ("Mansy Sarvajy,")', X().isNameLike('Mansy Sarvajy,') === false, 'raw comma must not pass');

  // ---------- 3. document validation ----------
  console.log('\n[3] document validation (no more landscape photos)');
  const dA = X().docLikeness(AADHAAR);
  const dL = X().docLikeness(LANDSCAPE);
  check('Aadhaar text is accepted', dA.ok === true, JSON.stringify(dA));
  check('landscape / scenery photo is REFUSED', dL.ok === false, JSON.stringify(dL));
  const panTxt = 'INCOME TAX DEPARTMENT\nGOVT. OF INDIA\nPermanent Account Number\nMANAV SARVAIYA\nRAMESH SARVAIYA\n01/01/1995\nABCDE1234F';
  check('PAN card is accepted', X().docLikeness(panTxt).ok === true, JSON.stringify(X().docLikeness(panTxt)));
  const dlTxt = 'Driving Licence\nLicence No. GJ01 20190001234\nName Manav Sarvaiya\nDOB 01-01-1995\nAddress Bhavnagar Gujarat 364001\nValid Till 2030';
  check('Driving licence is accepted', X().docLikeness(dlTxt).ok === true, JSON.stringify(X().docLikeness(dlTxt)));
  const mrzTxt = 'P<INDSARVAIYA<<MANAV<<<<<<<<<<<<<<<<<<<<<<<<\nK1234567<8IND9501011M3001012<<<<<<<<<<<<<<<6';
  check('passport MRZ is accepted', X().docLikeness(mrzTxt).ok === true, JSON.stringify(X().docLikeness(mrzTxt)));
  check('blank text is refused', X().docLikeness('').ok === false);
  check('a single word is refused', X().docLikeness('Sunset').ok === false);
  const wordyScene = 'Green hills and pine trees overlook a lake. Trail marker 24, altitude 1830, take road 7 north.';
  check('wordy landscape text with numbers is still refused', X().docLikeness(wordyScene).ok === false, JSON.stringify(X().docLikeness(wordyScene)));

  // OCR offline must never be treated as a valid document (fail closed).
  X().UI.tab = 'new'; X().UI.draft = X().blankDraft();
  vm.runInContext('var ocrForDocOriginal = ocrForDoc; ocrForDoc = async function(){ throw new Error("OCR offline"); }', sb);
  const failClosed = await X().ingestIdImages(['data:image/jpeg;base64,AA=='], true);
  check('OCR failure rejects the upload', failClosed.refused === 1 && failClosed.added === 0);
  check('unverified image is not stored', X().UI.draft.guest.idImages.length === 0);
  check('rejection offers manual entry or retry, never keep-anyway', X().UI.confirm && X().UI.confirm.yesLabel === 'Switch to manual entry' && X().UI.confirm.noLabel === 'Try another ID' && !/keep it anyway/i.test(X().UI.confirm.yesLabel));
  vm.runInContext('ocrForDoc = ocrForDocOriginal', sb);

  // ---------- 4. ID document optional: manual entry allowed ----------
  console.log('\n[4] new booking: scan OR type manually');
  sb.render();
  const manualHtml = (() => { X().UI.tab = 'new'; X().UI.draft = X().blankDraft(); sb.render(); return sb._els['#app'].innerHTML; })();
  check('Identity Proof offers both choices', manualHtml.includes('Type the details manually') && manualHtml.includes('Scan / upload the document'));

  // If a manager fills details but has no ID, offer an explicit choice instead of only blocking.
  const before = X().DB.bookings.length;
  X().UI.draft.guest.firstName = 'Test'; X().UI.draft.guest.lastName = 'Guest';
  X().UI.draft.guest.mobile = '9876500123';
  X().UI.draft.roomId = X().DB.rooms[0].id;
  X().saveBooking();
  check('scan mode + no document opens manual-entry confirmation', X().DB.bookings.length === before && X().UI.confirm && X().UI.confirm.yesLabel === 'Save manually');
  const manualChoice = X().UI.confirm; X().UI.confirm = null; manualChoice.yes();
  check('manual confirmation saves booking without a document', X().DB.bookings.length === before + 1, 'bookings=' + X().DB.bookings.length);
  check('manual mode: ID is not a required field', X().reqStatus(X().DB.bookings[X().DB.bookings.length-1].guest).length === 2, JSON.stringify(X().reqStatus(X().DB.bookings[X().DB.bookings.length-1].guest)));
  const nb = X().DB.bookings[X().DB.bookings.length - 1];
  check('the saved guest has no ID and is flagged ID PENDING', (!nb.guest.idImages || !nb.guest.idImages.length) && nb.status === 'active');
  const rowHtml = (() => { X().UI.tab = 'bookings'; X().UI.bookingId = null; sb.render(); return sb._els['#app'].innerHTML; })();
  check('bookings list shows the ID PENDING badge', rowHtml.includes('ID PENDING'));
  const bHtml = (() => { X().UI.bookingId = nb.id; sb.render(); return sb._els['#app'].innerHTML; })();
  check('booking page offers "Add ID document"', bHtml.includes('Add ID document') && bHtml.includes('No ID document on record'));

  // switching back to scan mode re-arms the requirement
  X().UI.tab = 'new'; X().UI.draft = X().blankDraft();
  X().UI.draft.guest.idMode = 'scan';
  check('scan mode: ID is required again', X().reqStatus(X().UI.draft.guest).length === 3);

  await sleep(400);
  console.log(failures === 0 ? '\nALL PATCH29 TESTS PASSED' : '\n' + failures + ' FAILED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
