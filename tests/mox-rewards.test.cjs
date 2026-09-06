const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const M=require('../versions/v2.16.1/mox-rewards'),P=require('../versions/v2.16.1/parser');
const tx=(merchant,amount=100,date='2026-07-06',post='2026-07-07',extra={})=>({id:merchant,cardId:'card-mox',merchant,raw_description:merchant,amount,date,transaction_date:date,post_date:post,kind:'tx',currency:'HKD',...extra});
test('Mox ordinary 1%, supermarkets 3% and convenience stores remain ordinary',()=>{
 for(const name of ['CIRCLE K','7-ELEVEN','ETERNAL EAST','CMHK'])assert.equal(M.predict(tx(name)).rate,.01,name);
 assert.equal(M.predict(tx('YATA SUPERMARKET',75)).scenario_cashback,2.25);
 assert.equal(M.predict(tx('STORE',100,undefined,undefined,{mcc:'5411'})).rate,.03);
 assert.equal(M.predict(tx('YATA',100,undefined,undefined,{mcc:'5311'})).rate,.01);
 assert.equal(M.predict(tx('GreenPrice',100,undefined,undefined,{category:'grocery'})).rate,.01,'app category guess is not MCC');
});
test('user-corrected introductory 2% is a dated scenario, not fixed 90 days or 3%',()=>{
 const early=M.predict(tx('ETERNAL EAST',58,'2026-03-16','2026-03-17'));
 assert.equal(early.rate,.02);assert.equal(early.scenario_cashback,1.16);assert.equal(early.expected_cashback,null);assert.equal(early.confidence,'PENDING');
 assert.equal(M.predict(tx('ARKA',497,'2026-04-11','2026-04-12')).scenario_cashback,9.94);
 assert.equal(M.predict(tx('CIRCLE K',22,'2026-04-13','2026-04-15')).scenario_cashback,.22);
 const boundary=M.predict(tx('SHOP',100,'2026-04-12','2026-04-13'));assert.equal(boundary.expected_cashback,null);assert.equal(boundary.expected_max,2);
 const config={welcome_start:'2026-02-15',welcome_end:'2026-04-14'};
 assert.equal(M.predict(tx('SHOP',100,'2026-04-14'),config).expected_cashback,2);
 assert.equal(M.predict(tx('SHOP',100,'2026-04-15'),config).expected_cashback,1);
 assert.equal(M.predict(tx('YATA',100,'2026-03-01')).expected_cashback,null);
});
test('Mox+ applies by dated membership after September, never retroactively or stacked',()=>{
 const c={plus_status:'yes',plus_from:'2026-09-10',plus_to:'2026-09-20'};
 assert.equal(M.predict(tx('SHOP',100,'2026-08-31'),c).rate,.01);
 assert.equal(M.predict(tx('SHOP',100,'2026-09-10'),c).rate,.02);
 assert.equal(M.predict(tx('SHOP',100,'2026-09-20'),c).rate,.02);
 assert.equal(M.predict(tx('SHOP',100,'2026-09-21'),c).expected_cashback,null);
 assert.equal(M.predict(tx('YATA',100,'2026-09-11'),c).rate,.03);
 assert.equal(M.predict(tx('SHOP',100,'2026-09-11'),{plus_status:'no'}).rate,.01);
 assert.equal(M.predict(tx('SHOP',100,'2026-09-11')).expected_cashback,null);
});
test('cash-only plan, excluded ledger types, uncertain historical eligibility and HKD conversion',()=>{
 for(const kind of ['payment','credit','fee','welcome_reward','rebate','transfer'])assert.equal(M.predict(tx('SHOP',100,undefined,undefined,{kind})).scenario_cashback,0);
 for(const merchant of ['IMMD E-SERVICES','OCTOPUS TOP UP','RENT'])assert.equal(M.predict(tx(merchant)).expected_cashback,null);
 assert.equal(M.predict(tx('IMMD',600)).expected_max,6);
 assert.equal(M.predict(tx('OCTOPUS TOP UP',100,'2026-09-10'),{plus_status:'no'}).scenario_cashback,0);
 assert.equal(M.predict(tx('SHOP',101.95,undefined,undefined,{original_currency:'JPY',original_amount:2000})).scenario_cashback,1.02);
 assert.equal(M.predict(tx('SHOP',100,undefined,undefined,{currency:'JPY'})).expected_cashback,null);
 assert.equal(M.predict(tx('SHOP'),{reward_plan:'asia_miles'}).expected_cashback,null);
 assert.equal(M.predict(tx('CMHK',201.5)).scenario_cashback,2.02);
});
test('Mox has no Chill threshold/cap, markers do not qualify, sources stay unchanged',()=>{
 const a=tx('YATA',10000),b=tx('##YATA',10000),before=JSON.stringify(a);assert.deepEqual(M.predict(a),M.predict(b));assert.equal(M.predict(a).scenario_cashback,300);M.calculate([a,b]);assert.equal(JSON.stringify(a),before);
});
test('settlement calendar reconciliation, dedup, same-day sums and delayed candidates never allocate actual',()=>{
 const a=tx('SHOP',100,'2026-06-30','2026-07-02'),b=tx('YATA',100,'2026-07-01','2026-07-02');
 const e={cardId:a.cardId,period:'2026-07',date:'2026-07-02',amount:4,source_id:'bank1'};
 const model=M.calculate([a,b]),r=M.reconcile(model,[e,e,{...e,amount:1000,source_id:'welcome',kind:'welcome_reward'}]);
 assert.equal(r.monthly[0].observed_cashback_total,4);assert.equal(r.monthly[0].reconciliation_status,'MATCHED_AGGREGATE');assert.equal(r.candidates[0].transaction_ids.length,2);
 for(const p of model.results.values())assert.equal(p.allocated_actual_cashback,null);
 const delayed=M.reconcile(model,[{...e,date:'2026-07-04'}]);assert.equal(delayed.candidates[0].status,'DELAYED_CANDIDATE');
 assert.equal(M.reconcile(model,[]).monthly[0].observed_cashback_total,null);
 assert.equal(M.reconcile(model,[],['card-mox|2026-07']).monthly[0].observed_cashback_total,0);
 assert.equal(M.reconcile(model,[{...e,amount:4.01}]).monthly[0].reconciliation_status,'UNRESOLVED');
});
test('Mox parser preserves activity, settlement, statement cycle and excludes invitation',()=>{
 const r=P.parse('Mox Credit statement\n10 Jun 2026 - 9 Jul 2026\n30 Jun 02 Jul YATA SUPERMARKET -75.00').rows[0];
 assert.equal(r.activity_date,'2026-06-30');assert.equal(r.settlement_date,'2026-07-02');assert.deepEqual(r.statement_period,{start:'2026-06-10',end:'2026-07-09'});assert.equal(r.record_month,'2026-07');
 const b=P.parse('Mox Bank statement\n1 Mar 2026 - 31 Mar 2026\n07 Mar 07 Mar Mox invitation reward +1,000.00\n17 Mar 17 Mar CashBack +1.16');assert.equal(b.rows[0].kind,'welcome_reward');assert.equal(b.rows[1].kind,'rebate');
});
function app(){
 const html=fs.readFileSync(require.resolve('../versions/v2.16.1/index.html'),'utf8'),js=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n').replace(/boot\(\);\s*$/,'');
 const mem=new Map(),c={MoxRewards:M,ChillRewards:require('../versions/v2.16.1/rewards'),StatementParser:P,console,Date,setTimeout:()=>0,clearTimeout:()=>{},document:{querySelector:()=>null,addEventListener:()=>{}},window:{addEventListener:()=>{}},localStorage:{getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,v)}};
 vm.createContext(c);vm.runInContext(js,c);vm.runInContext('S.data=freshData();S.data.cards=JSON.parse(JSON.stringify(REAL_CARDS));render=()=>{};schedulePush=()=>{};closeSheet=()=>{};toast=(s)=>globalThis.message=s;pdfPut=async()=>{};openSheet=s=>globalThis.sheet=s',c);return c;
}
test('old Mox rows automatically backfill, preserve actual/raw values and render cash-only detail',()=>{
 const c=app();c.row=tx('##YATA SUPERMARKET',75,undefined,undefined,{actualReward:2.25});vm.runInContext('S.data.transactions=[row];migrateData();saveLocal()',c);
 assert.equal(vm.runInContext('S.data.settings.moxRules["card-mox"].plus_status',c),'no');assert.equal(c.row.expectedReward,2.25);assert.equal(c.row.actualReward,2.25);assert.equal(c.row.allocated_actual_cashback,null);assert.equal(c.row.raw_description,'##YATA SUPERMARKET');assert.equal(vm.runInContext('recalculatePredictions(S.data)',c),false);
 vm.runInContext('load();UI.recMonth="2026-07";UI.recCard="card-mox"',c);assert.equal(vm.runInContext('S.data.transactions[0].expectedReward',c),2.25);
 const h=vm.runInContext('txSheet(row.id)',c);assert.match(h,/Mox 現金回贈預測/);assert.doesNotMatch(h,/220分|prediction-channel/);
 assert.equal(vm.runInContext('credibilityFor("card-mox")',c),null);assert.match(vm.runInContext('recordsHTML()',c),/Mox 現金回贈/);
});
test('Mox credit and bank imports remain idempotent with separate welcome and bank evidence',async()=>{
 const c=app();
 for(const text of ['Mox Credit statement\n10 Jun 2026 - 9 Jul 2026\n06 Jul 07 Jul YATA SUPERMARKET -75.00','Mox Bank statement\n1 Jul 2026 - 31 Jul 2026\n07 Jul 07 Jul CashBack +2.25\n08 Jul 08 Jul Mox invitation reward +1,000.00']){
  c.input=text;for(let i=0;i<2;i++){vm.runInContext('IMPPDF.rows=buildRows(input);IMPPDF.stmts=[{fp:IMPPDF.rows[0].fp,name:"test",text:input}];IMPPDF.pdfs=[]',c);await vm.runInContext('ACTIONS["pdft-save"]()',c);}
 }
 assert.equal(vm.runInContext('S.data.transactions.length',c),1);assert.equal(vm.runInContext('S.data.rewardMonths[0].amount',c),2.25);assert.equal(vm.runInContext('S.data.credits[0].kind',c),'welcome_reward');
 assert.equal(vm.runInContext('S.data.moxReconciliation[0].observed_cashback_total',c),2.25);assert.equal(vm.runInContext('S.data.moxReconciliation[0].evidence_count',c),1);
 vm.runInContext('UI.recCard="card-mox";ACTIONS["mox-reconciliation"]()',c);assert.match(c.sheet,/1,000\.00/);assert.match(c.sheet,/MATCHED_AGGREGATE/);
});

test('Circle K is other across all cards and RentSmart gets its own category despite learned labels',()=>{
 const c=app();vm.runInContext(`S.data.categories.find(c=>c.id==='fuel').keywords.push('CIRCLE K');S.data.knowledge=[{pattern:'CIRCLE K',category:'fuel'}];S.data.transactions=[{id:'a',cardId:'card-boc-chill',date:'2026-07-01',merchant:'##circle k HONG KONG',amount:10,category:'fuel'},{id:'b',cardId:'card-mox',date:'2026-07-01',merchant:'Circle K',amount:20,category:'grocery'},{id:'c',cardId:'card-mox',date:'2026-07-01',merchant:'rentsmart HKG',raw_description:'rentsmart HKG',amount:100,category:'other'}];migrateData()`,c);
 assert.equal(vm.runInContext('guessCategory("CIRCLE K")',c),'other');assert.equal(vm.runInContext('guessCategory("rent smart")',c),'rentsmart');assert.equal(vm.runInContext('S.data.transactions[0].category',c),'other');assert.equal(vm.runInContext('S.data.transactions[1].category',c),'other');assert.equal(vm.runInContext('S.data.transactions[2].category',c),'rentsmart');assert.equal(vm.runInContext('S.data.transactions[2].raw_description',c),'rentsmart HKG');assert.equal(vm.runInContext('S.data.categories.filter(c=>c.id==="rentsmart").length',c),1);
 assert.equal(vm.runInContext('recalculatePredictions(S.data)',c),false);
});
test('Mox owner-name credit is repayment, merchant refunds remain refunds, statement end controls month',()=>{
 const p=P.parse('JANE DOE Mox Credit statement\n10 Mar 2026 - 9 Apr 2026\n31 Mar 31 Mar DOE JANE 100.00\n31 Mar 31 Mar SHOP REFUND 9.00\n31 Mar 31 Mar OTHER SHOP 8.00');
 assert.equal(p.meta.account_holder,'JANE DOE');assert.equal(p.meta.record_month,'2026-04');assert.equal(p.rows[0].kind,'payment');assert.equal(p.rows[0].account_role,'credit_repayment');assert.equal(p.rows[1].kind,'credit');assert.equal(p.rows[2].kind,'credit');assert.equal(p.rows[0].raw_description,'DOE JANE');
 assert.equal(P.parse('Mox Credit statement\n10 Feb 2026 - 9 Mar 2026\n11 Feb 12 Feb SHOP -10.00').rows[0].record_month,'2026-03');
});
test('Mox bank money-in and credit repayment sides are linked without changing raw amounts or sources',async()=>{
 const c=app();
 const texts=['JANE DOE Mox Bank statement\n1 Mar 2026 - 31 Mar 2026\n31 Mar 31 Mar JANE DOE +80.00\n31 Mar 31 Mar DOE J*** -100.00','JANE DOE Mox Credit statement\n10 Mar 2026 - 9 Apr 2026\n31 Mar 31 Mar DOE JANE 100.00\n31 Mar 31 Mar SHOP REFUND 9.00'];
 for(const text of texts){c.input=text;vm.runInContext('IMPPDF.rows=buildRows(input);IMPPDF.stmts=[{fp:IMPPDF.rows[0].fp,name:"test",text:input}];IMPPDF.pdfs=[]',c);await vm.runInContext('ACTIONS["pdft-save"]()',c);}
 const rows=JSON.parse(vm.runInContext('JSON.stringify(S.data.credits)',c)),incoming=rows.find(r=>r.amount===80),out=rows.find(r=>r.amount===100&&r.document_type==='bank'),credit=rows.find(r=>r.amount===100&&r.document_type==='credit');
 assert.equal(incoming.account_role,'bank_transfer_in');assert.equal(incoming.kind,'transfer');assert.equal(out.kind,'payment');assert.equal(out.account_role,'bank_credit_payment');assert.equal(out.amount_minor,10000);assert.equal(credit.amount_minor,-10000);assert.equal(out.payment_link_id,credit.payment_link_id);assert.deepEqual(out.related_source_ids,[credit.source_id]);assert.equal(rows.find(r=>r.amount===9).kind,'credit');
 assert.equal(vm.runInContext('recalculatePredictions(S.data)',c),false);
});
test('existing Mox data migrates using original statement filename and end month without reimport',()=>{
 const c=app(),old=require('../versions/v2.16.0/parser');const report=old.parse('Mox Credit statement\n10 Feb 2026 - 9 Mar 2026\n12 Feb 13 Feb CIRCLE K -10.00\n01 Mar 01 Mar DOE JANE 100.00');
 c.report=report;vm.runInContext(`S.data.statementImports=[{...report,name:'JANE-DOE_3月2026_Mox_Credit_Statement.pdf',reviewed_rows:report.rows.map(r=>({...r}))}];S.data.transactions=report.rows.filter(r=>r.kind==='tx').map(r=>({...r,id:r.source_id}));S.data.credits=report.rows.filter(r=>r.kind==='credit').map(r=>({...r,id:r.source_id}));migrateData()`,c);
 assert.equal(vm.runInContext('S.data.transactions[0].record_month',c),'2026-03');assert.equal(vm.runInContext('txsOfMonth("2026-02").length',c),0);assert.equal(vm.runInContext('txsOfMonth("2026-03").length',c),1);assert.equal(vm.runInContext('S.data.credits[0].kind',c),'payment');assert.equal(vm.runInContext('S.data.credits[0].original_kind',c),'credit');assert.equal(vm.runInContext('S.data.statementImports[0].reviewed_rows[0].category',c),'other');assert.equal(vm.runInContext('recalculatePredictions(S.data)',c),false);
});
test('welcome joins rewards while repayments, transfers and refunds remain in other ledger',()=>{
 const c=app();vm.runInContext(`UI.recMonth='2026-03';UI.recCard='card-mox';UI.recTab='rm';S.data.rewardMonths=[{id:'cash',cardId:'card-mox',month:'2026-03',amount:10}];S.data.credits=[{id:'welcome',cardId:'card-mox',date:'2026-03-07',record_month:'2026-03',kind:'welcome_reward',merchant:'Invitation',amount:1000},{id:'offset',cardId:'card-mox',date:'2026-03-07',record_month:'2026-03',kind:'reward_offset',merchant:'Redeem',amount:2},{id:'payment',cardId:'card-mox',date:'2026-03-31',record_month:'2026-03',kind:'payment',account_role:'bank_credit_payment',merchant:'Payment',amount:500},{id:'refund',cardId:'card-mox',date:'2026-03-31',record_month:'2026-03',kind:'credit',merchant:'SHOP REFUND',amount:9}];`,c);
 const html=vm.runInContext('recordsHTML()',c),rewards=html.slice(html.indexOf('data-section="rewards"'),html.indexOf('data-section="other-ledger"')),other=html.slice(html.indexOf('data-section="other-ledger"'));
 assert.match(rewards,/HK\$1,012\.00/);assert.match(rewards,/迎新獎勵/);assert.match(rewards,/獎賞兌換/);assert.doesNotMatch(rewards,/SHOP REFUND|銀行扣款/);assert.match(other,/銀行扣款/);assert.match(other,/SHOP REFUND/);assert.doesNotMatch(other,/Invitation|Redeem/);
 assert.match(vm.runInContext('actualRewardDetailHTML()',c),/HK\$1,010\.00/);
 vm.runInContext('S.data.rewardMonths=[];UI.recTab="tx"',c);assert.doesNotMatch(vm.runInContext('recordsHTML()',c),/<div class="sv">未取得<\/div>/);
});
