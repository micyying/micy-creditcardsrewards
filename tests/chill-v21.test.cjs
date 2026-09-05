const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../versions/v2.15.1/rewards.js'),P=require('../versions/v2.15.1/parser.js');
const tx=(name,amount=78,date='2026-07-27',extra={})=>({id:name,cardId:'card-boc-chill',kind:'tx',date,transaction_date:date,amount,merchant:name,...extra});
test('confirmed merchant aliases normalize before dated matching; other merchants are not Chill',()=>{
 for(const name of ['APPLE.COM/BILL','Nintendo','UNIQLO',"McDonald's",'McDonalds','BBMSL*Cinemacomhk APMHong Kong HKG'])assert.equal(R.classify(tx(name)).chill_merchant,true,name);
 for(const name of ['Circle K','GreenPrice','YATA','Sa Sa','Matsumoto Kiyoshi','Eternal East','HK Express','VFS'])assert.equal(R.classify(tx(name)).chill_merchant,false,name);
 const t=tx('HKEXPRESS00000',100);assert.equal(R.calculate([t]).results.get(t).bonus_rate,.046);
});
test('new merchants apply from May 1 and stop at effective_to',()=>{
 for(const name of ['NOC','% Arabica','FINEPRINT','Logitech','Razer']){
  assert.equal(R.classify(tx(name,100,'2026-04-30')).chill,false);
  assert.equal(R.classify(tx(name,100,'2026-05-01')).chill,true);
  assert.equal(R.classify(tx(name,100,'2027-01-01')).chill,false);
 }
 assert.equal(R.classify(tx('UNIQLO',100,'2025-12-31')).chill,false);
});
test('Eternal East remains UNKNOWN even with stale online heuristic; April mismatch does not alter it',()=>{
 const east=tx('ETERNAL EAST CROS07100 HONG KONG HKG',58,'2026-04-20',{online:true});
 const rows=[tx('Nintendo',75,'2026-04-01'),tx('APPLE.COM/BILL',78,'2026-04-27'),east,{...east,id:'east2'}];
 const m=R.calculate(rows),report=R.reconcile(m,[{cardId:east.cardId,period:'2026-04',amount:9,source_id:'apr-statement',source_type:'statement'}])[0];
 assert.equal(m.results.get(east).online_status,'UNKNOWN');assert.equal(m.results.get(east).cashback_category,'UNKNOWN');assert.equal(m.results.get(east).confidence,'PENDING');assert.equal(m.results.get(east).bonus_hkd,0);assert.equal(report.physical_spend,0);assert.equal(report.reconciliation_status,'UNRESOLVED');assert.equal(report.raw_bonus_hkd,7.04);
});
test('marker presence changes neither classification, qualification nor predictions',()=>{
 for(const name of ['APPLE.COM/BILL','Nintendo','McDonalds','MTR','KMB','Circle K','Sa Sa','YATA','GreenPrice','VFS','Eternal East']){
  const a=tx(name),b=tx('##'+name);assert.deepEqual(R.classify(a),R.classify(b));
  assert.deepEqual(R.calculate([a]).results.get(a),R.calculate([b]).results.get(b));
 }
 const r=P.parse('BOC Chill World Mastercard\nStatement Date 18-AUG-2026\n28-JUL 27-JUL ##APPLE.COM/BILL CORK IRL 78.00').rows[0];
 assert.equal(r.transaction_marker,'##');assert.equal(r.marker_meaning,'UNKNOWN');assert.equal(r.marker_confidence,'PENDING');assert.equal(Object.hasOwn(r,'merchant_marker'),false);assert.equal(r.merchant,'##APPLE.COM/BILL CORK IRL');
});
test('1500 threshold exactly, no stacking, shared cap is theoretical not actual allocation',()=>{
 const a=tx('UNIQLO',1500),b=tx('APPLE.COM/BILL',1000),m=R.calculate([a,b]);
 assert.equal(m.results.get(a).extra_cash_rebate_rate,.096);assert.equal(m.results.get(b).headline_reward_rate,.1);assert.equal(m.monthly[0].bonus_hkd,150);
 const evidence=[{cardId:a.cardId,period:'2026-07',amount:150,source_id:'confirmed',source_type:'user_confirmation'}];
 const r=R.reconcile(m,evidence)[0];assert.equal(r.reconciliation_status,'CAPPED_MATCH');assert.equal(r.minimum_implied_extra_cashback,150);assert.equal(r.observed_cashback_total,150);assert.ok(r.raw_bonus_hkd>150);
 for(const p of m.results.values()){assert.equal(p.allocated_actual_cashback,null);assert.equal(p.evidence_count,1);}
 const low=R.reconcile(R.calculate([tx('APPLE.COM/BILL',78)]),evidence)[0];assert.equal(low.reconciliation_status,'UNRESOLVED');assert.equal(low.observed_cap_reached,true);
 const below=R.calculate([tx('UNIQLO',1499.99)]);assert.equal([...below.results.values()][0].bonus_rate,0);
});
test('confirmation and bank evidence are not added together; conflicts and missing months remain explicit',()=>{
 const a=tx('UNIQLO',2000),e={cardId:a.cardId,period:'2026-07',amount:150,source_id:'bank',source_type:'statement'};
 const r=R.reconcile(R.calculate([a]),[e,e,{...e,source_id:'user',source_type:'user_confirmation'}])[0];assert.equal(r.observed_cashback_total,150);assert.equal(r.evidence_count,2);
 const conflict=R.reconcile(R.calculate([a]),[e,{...e,amount:140,source_id:'user',source_type:'user_confirmation'}])[0];assert.equal(conflict.reconciliation_status,'UNRESOLVED');assert.equal(conflict.evidence_conflict,true);
 assert.equal(R.reconcile(R.calculate([a]),[])[0].reconciliation_status,'INSUFFICIENT_DATA');
});

test('small unexplained differences and bank amounts above cap are unresolved',()=>{
 const a=tx('APPLE.COM/BILL',78),e={cardId:a.cardId,period:'2026-07',amount:3,source_id:'bank',source_type:'statement'};
 assert.equal(R.reconcile(R.calculate([a]),[e])[0].reconciliation_status,'UNRESOLVED');
 assert.equal(R.reconcile(R.calculate([tx('UNIQLO',2000)]),[{...e,amount:151}])[0].reconciliation_status,'UNRESOLVED');
});
