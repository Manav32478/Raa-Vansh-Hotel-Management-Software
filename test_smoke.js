/* Node smoke test: app logic, real room structure, GST-inclusive tariff, PDF */
const vm = require('vm');
const fs = require('fs');

function fakeEl(){
  return { innerHTML:'', textContent:'', style:{}, value:'', dataset:{},
    classList:{add(){},remove(){}}, addEventListener(){}, appendChild(){}, remove(){} };
}
const els = {};
const sandbox = {
  console,
  document: {
    querySelector: s => { if(!els[s]) els[s] = fakeEl(); return els[s]; },
    querySelectorAll: () => [],
    createElement: () => fakeEl(),
    addEventListener(){},
    body: { appendChild(){}, },
  },
  localStorage: { _d:{}, getItem(k){return k in this._d ? this._d[k] : null}, setItem(k,v){this._d[k]=String(v)}, removeItem(k){delete this._d[k]} },
  fetch: async (url,opts) => {
    if(String(url).endsWith('/api/subscription')) return {ok:true,status:200,json:async()=>({ready:true,active:true,state:'active',plan:{id:'yearly',name:'Yearly',months:12,price:6999},startsAt:new Date().toISOString(),expiresAt:'2099-12-31T00:00:00.000Z',daysRemaining:999,reminderDays:null,request:null,pendingRequestId:null,plans:[]})};
    if(String(url).endsWith('/api/state') && opts && opts.method==='PUT') return {ok:true,status:200};
    if(String(url).endsWith('/api/state')) return {ok:false,status:404,json:async()=>null};
    return {ok:false,status:404,json:async()=>null};
  },
  navigator: { clipboard:null, canShare:null },
  File: class File { constructor(parts,name){ this.parts=parts; this.name=name; } },
  URL: { createObjectURL:()=>'blob:x', revokeObjectURL(){} },
  Image: class { set src(v){} get src(){return '';} },
  prompt: () => null, confirm: () => true, alert: () => {},
  setTimeout, clearTimeout, setInterval: () => 0,
  Math, Date, JSON, Number, String, parseInt, parseFloat, isFinite,
  atob, btoa,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.EMBED_QR = 'data:image/png;base64,' + Buffer.from(fs.readFileSync('assets/qr.png')).toString('base64');
sandbox.EMBED_LOGO = 'data:image/png;base64,' + Buffer.from(fs.readFileSync('assets/logo.png')).toString('base64');
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('vendor/jspdf.umd.min.js','utf8'), sandbox, {filename:'jspdf.js'});
if(!sandbox.jspdf) throw new Error('jsPDF did not load');
vm.runInContext(require('./test_utils').appScript() +
  '\n;this.__expose = { get DB(){return DB}, get UI(){return UI} };', sandbox, {filename:'app.js'});

const sb = sandbox;
let failures = 0;
const check = (n,c) => { console.log((c?'PASS':'FAIL')+' — '+n); if(!c) failures++; };

// room structure
const DB = sb.__expose.DB;
check('19 rooms loaded', DB.rooms.length === 19);
const byNo = n => DB.rooms.find(r => r.no === n);
check('room 206 family 2400', byNo('206').price === 2400 && byNo('206').occupancy === 6);
check('room 201-205 super deluxe 1600 (203 = 1900)', [201,202,204,205].every(n=>byNo(String(n)).price===1600) && byNo('203').price === 1900);
check('niche prices', byNo('101').price===1430 && byNo('102').price===1300 && byNo('106').price===860 && byNo('109').price===1050 && byNo('112').price===720);
check('all floors labelled', DB.rooms.every(r => r.floor === '2nd Floor' || r.floor === 'Niche'));
check('menu has water 20', DB.menu.some(m => /water/i.test(m.name) && m.price === 20));

// GST-inclusive tariff: 1430 + 5% = 1501.50
check('tariff 1430x1 inclusive = 1501.50', sb.tariffFor(1430, 1) === 1501.5);
check('tariff 1600x2 inclusive = 3360', sb.tariffFor(1600, 2) === 3360);
check('gstPct = 5', sb.gstPct() === 5);

// sample booking like their example (room 202, 1 night, 1 adult + company)
const room = byNo('202');
const b = {
  id:'t1', reqNo:'22822', createdAt:new Date().toISOString(), status:'active',
  guest:{ firstName:'Harpalsingh', middleName:'', lastName:'Parmar', gender:'Male',
    company:'Shree Ram Finance', companyGst:'24AAACS7018R1Z2',
    houseFlat:'', address:'12 Gandhi Rd', locality:'Mahuva', city:'Mahuva', district:'Bhavnagar', zip:'364290', country:'India', state:'Gujarat',
    dob:'1985-05-12', mobile:'9876543210', phone:'9876500000', email:'hp@example.com',
    comingFrom:'Surat', goingTo:'Ahmedabad',
    idType:'pan', idNumber:'AAAPR1234A', idImages:[],
    adults:1, children:0, vehicleType:'Car', vehicleNo:'GJ01KPI788' },
  roomNo: room.no, roomType: room.type, roomPrice: room.price, roomFloor: room.floor,
  checkIn:'2026-09-23', checkOut:'2026-09-24', nights:1, inTime:'12:30', outTime:'11:00', persons:1,
  items:[
    { id:'i1', kind:'room', amount: sb.tariffFor(room.price, 1), note:'1 night(s) x ₹1600 + 5% GST' },
    { id:'i2', kind:'extra', amount: 300, note:'1 pax x 1 night(s) @ ₹300' },
    { id:'i3', kind:'fnb', name:'Mineral Water', qty:2, amount:40, note:'x2 @ ₹20' },
  ],
  payments:[]
};
DB.bookings.push(b);
const c = sb.computeBill(b);
check('room tariff inclusive', c.roomAmount === 1680);
check('total = 1680+300+40 = 2020', c.total === 2020);
const lines = sb.billLines(b);
check('no separate CGST/SGST lines when inclusive', !lines.some(l => l.tax));
check('room line has GST note', lines[0].desc.includes('incl. 2.5% CGST + 2.5% SGST'));
check('fullName works', sb.fullName(b.guest) === 'Harpalsingh Parmar');
check('waPhone adds 91', sb.waPhone('9876543210') === '919876543210');

// WhatsApp text
const wa = sb.buildWaText(b);
check('wa is a warm thank-you addressed to the guest (bill details stay in the PDF)', wa.includes('Harpalsingh Parmar') && /thank you/i.test(wa) && /coming home/i.test(wa) && !wa.includes('Shree Ram Finance') && !wa.includes('GJ01KPI788'));
check('wa text has no document details or amounts (privacy + bill lives in the PDF)', !/ID: PAN/.test(wa) && !/Rs\./.test(wa) && !/REQ/i.test(wa));
console.log('--- WhatsApp preview ---\n' + wa + '\n');

// PDF
const pdf = sb.makeBillPDF(b);
const buf = Buffer.from(pdf.output('arraybuffer'));
fs.writeFileSync('/tmp/test_bill.pdf', buf);
check('pdf builds', buf.length > 50000);

// parseIdText v2: full Aadhaar-ish text
const aadhaarText = `N A M E : RAMESH P PATEL
FATHER / HUSBAND / SPONSOR NAME : KISHAN P PATEL
D O B : 12-05-1985
GENDER : M
HOUSE NO 45 SHASTRI NAGAR MAHUVA BHAVNAGAR GUJARAT - 364290
1234 5678 9012`;
const parsed = sb.parseIdText(aadhaarText, 'aadhar');
check('aadhaar name split', parsed.firstName === 'RAMESH' && parsed.lastName === 'PATEL' && parsed.middleName === 'P');
check('aadhaar dob', parsed.dob === '1985-05-12');
check('aadhaar gender', parsed.gender === 'Male');
check('aadhaar 12-digit', parsed.idNumber === '123456789012');
check('aadhaar address parsed (state/zip/district)', parsed.state === 'Gujarat' && parsed.zip === '364290' && parsed.district === 'Bhavnagar');

// PAN
const panParsed = sb.parseIdText('Name : HARPALSINGH PARMAR\nAAAPR1234A', 'pan');
check('pan number', panParsed.idNumber === 'AAAPR1234A');
check('pan name', panParsed.firstName === 'HARPALSINGH' && panParsed.lastName === 'PARMAR');

console.log(failures === 0 ? '\nALL SMOKE TESTS PASSED' : '\n'+failures+' FAILED');
process.exit(failures ? 1 : 0);
