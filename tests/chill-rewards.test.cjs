const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../versions/v2.15.0/rewards.js'),P=require('../versions/v2.15.0/parser.js');
const tx=(id,merchant,amount,date='2026-05-27',extra={})=>({id,cardId:'card-boc-chill',kind:'tx',currency:'HKD',date,transaction_date:date,merchant,amount,...extra});
test('Apple 78 yields theoretical 3.59 cash plus .31 points without inventing actual',()=>{
 const t=tx('a','##APPLE.COM/BILL CORK IRL',78),before=JSON.stringify(t),p=R.calculate([t]).results.get(t);
 assert.equal(p.bonus_hkd,3.59);assert.equal(p.base_points,78);assert.equal(p.base_hkd,.31);assert.equal(p.total_hkd,3.9);assert.equal(JSON.stringify(t),before);
 const x=tx('b','##CIRCLE K',100);assert.equal(R.calculate([x]).results.get(x).bonus_hkd,0);
});
test('monthly physical threshold crosses statement boundaries and does not depend on input order',()=>{
 const a=tx('a','##UNIQLO',278,'2026-05-27',{record_month:'2026-06'}),b=tx('b','STORE',1222,'2026-05-02',{record_month:'2026-05'}),c=tx('c','APPLE.COM/BILL',78,'2026-05-28');
 const p=R.calculate([a,b,c]);assert.equal(p.results.get(a).bonus_rate,.096);assert.equal(p.results.get(c).bonus_rate,.096);
 assert.equal(p.results.get(a).physical_spend,1500);assert.equal(R.calculate([a]).results.get(a).bonus_rate,0);
 assert.deepEqual([...R.calculate([c,b,a]).results.values()],[...p.results.values()]);
});
test('5 and 10 percent share a single 150 cap; base points continue and caps reset each year/month',()=>{
 const rows=[tx('a','UNIQLO',2000),tx('b','APPLE.COM/BILL',1000),tx('c','APPLE.COM/BILL',1000,'2026-06-01'),tx('d','APPLE.COM/BILL',1000,'2025-05-27')];
 const p=R.calculate(rows);assert.equal(p.results.get(rows[0]).bonus_hkd,150);assert.equal(p.results.get(rows[1]).bonus_hkd,0);assert.equal(p.results.get(rows[1]).base_hkd,4);
 assert.equal(p.results.get(rows[2]).bonus_hkd,46);assert.equal(p.results.get(rows[3]).bonus_hkd,46);assert.equal(p.results.get(rows[3]).confidence,'LOW');
});
test('wallets, Octopus, fees and late posting do not receive bonus',()=>{
 const rows=[tx('a','Top Up To BoC Pay+ For Merchant Payment',100),tx('b','##OCL* OCTOPUS',100),tx('c','APPLE.COM FEE',1,undefined,{kind:'fee'}),tx('d','APPLE.COM/BILL',78,'2026-05-01',{post_date:'2026-05-10'})];
 const p=R.calculate(rows);for(const t of rows)assert.equal(p.results.get(t).bonus_hkd,0);assert.equal(p.results.get(rows[0]).base_points,0);assert.equal(p.results.get(rows[3]).base_points,78);
});
test('manual channel edits change predictions, not raw markers; cent allocations sum to cap',()=>{
 const a=tx('a','##SHOP',100),b=tx('b','##SHOP',100,undefined,{prediction_channel:'online'});
 assert.equal(R.calculate([a,b]).results.get(a).bonus_rate,0);assert.equal(R.calculate([a,b]).results.get(b).bonus_rate,.046);
 const rows=Array.from({length:100},(_,i)=>tx('p'+i,'ONLINE SHOP',78));const p=R.calculate(rows);
 assert.equal(Math.round([...p.results.values()].reduce((s,r)=>s+r.bonus_hkd,0)*100),15000);
});
function app(){
 const html=fs.readFileSync(require.resolve('../versions/v2.15.0/index.html'),'utf8');
 const js=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n').replace(/boot\(\);\s*$/,'');
 const memory=new Map(),c={ChillRewards:R,StatementParser:P,console,Date,setTimeout:()=>0,clearTimeout:()=>{},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},document:{querySelector:()=>null,addEventListener:()=>{}},window:{addEventListener:()=>{}}};
 vm.createContext(c);vm.runInContext(js,c);vm.runInContext('S.data=freshData();S.data.cards=JSON.parse(JSON.stringify(REAL_CARDS));render=()=>{};schedulePush=()=>{};closeSheet=()=>{};toast=()=>{};pdfPut=async()=>{}',c);return c;
}
test('existing imported records migrate and imports persist predictions; actual rewards stay separate',async()=>{
 const c=app();c.old=tx('old','##APPLE.COM/BILL CORK IRL',78,undefined,{expectedReward:null,actualReward:3,raw_description:'##APPLE.COM/BILL CORK IRL'});
 vm.runInContext('S.data.transactions=[old];migrateData()',c);assert.equal(c.old.expectedReward,3.9);assert.equal(c.old.actualReward,3);assert.equal(c.old.raw_description,'##APPLE.COM/BILL CORK IRL');assert.equal(vm.runInContext('recalculatePredictions(S.data)',c),false);
 c.input='BOC Chill World Mastercard\nStatement Date 19-JUL-2026\n28-JUN 27-JUN ##APPLE.COM/BILL CORK IRL 78.00\n20-JUN 19-JUN 10% & 5% CASH REBATE RETAIL TXN(May) 3.00 CR';
 vm.runInContext('S.data.transactions=[];IMPPDF.rows=buildRows(input);IMPPDF.stmts=[{fp:IMPPDF.rows[0].fp,name:"test",text:input}];IMPPDF.pdfs=[]',c);
 await vm.runInContext('ACTIONS["pdft-save"]()',c);
 assert.equal(vm.runInContext('S.data.transactions[0].expectedReward',c),3.9);assert.equal(vm.runInContext('S.data.transactions[0].actualReward',c),null);
 vm.runInContext('load();UI.recMonth="2026-07";UI.recCard="card-boc-chill"',c);const html=vm.runInContext('recordsHTML()',c);assert.doesNotMatch(html,/應得回贈待核實/);assert.match(html,/HK\$3\.90/);assert.equal(vm.runInContext('S.data.rewardMonths[0].amount',c),3);
 assert.match(vm.runInContext('txSheet(S.data.transactions[0].id)',c),/預計額外現金/);
});
test('release root and version use existing correct parser and prediction scripts',()=>{
 const path=require('node:path'),root=path.resolve(__dirname,'..');
 for(const dir of [root,path.join(root,'versions/v2.15.0')]){
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  const scripts=[...html.matchAll(/<script src="(\.\/[^\"]+)"/g)].map(m=>m[1]);assert.equal(scripts.length,2);
  for(const file of scripts)assert.ok(fs.existsSync(path.join(dir,file)),file);
  assert.match(scripts[0],/parser(?:-v2\.15)?\.js/);assert.match(scripts[1],/rewards(?:-v2\.15)?\.js/);
 }
});
