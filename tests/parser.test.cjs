const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../versions/v2.14.1/parser.js');
const boc='BOC Chill World Mastercard\nStatement Date 19-JAN-2026\n';
test('dual dates, cross-year attribution, markers, fees and redemption remain separate',()=>{
 const r=P.parse(boc+'03-JAN 31-DEC ##APPLE.COM/BILL CORK IRL 78.00\n04-JAN 04-JAN CASH REBATE (Dec) 3.00 CR\n04-JAN 04-JAN Offset Spending with Points - BoC Pay+ 4.00 CR\n04-JAN 04-JAN OVERSEAS TRANSACTION FEE 1.50\nODD CENTS TO NEXT BILL 0.50 CR');
 assert.equal(r.rows[0].transaction_date,'2025-12-31');assert.equal(r.rows[0].post_date,'2026-01-03');assert.equal(r.rows[0].record_month,'2025-12');assert.equal(r.rows[0].merchant,'##APPLE.COM/BILL CORK IRL');assert.equal(r.rows[0].merchant_name_normalized,'APPLE.COM/BILL CORK IRL');assert.equal(r.rows[0].merchant_marker,'##');assert.equal(r.rows[0].online,null);assert.equal(r.rows[1].cashback_period,'2025-12');assert.equal(r.rows[2].kind,'reward_offset');assert.equal(r.rows[3].kind,'fee');assert.equal(r.rows[4].kind,'odd_cent');assert.equal(r.rows[0].expected_cashback,null);
});
test('merchant AEON does not change BOC bank; currency switches do not mix balances',()=>{
 const r=P.parse('BOC Go Platinum Card\nStatement Date 18-AUG-2026\nHKD Account No.: 1111-2222-3333-4444\n17-AUG 16-AUG AEON STORE 100.00\nCNY Account No.: 1111-2222-3333-5555\n17-AUG 16-AUG SHOP 100.00');assert.equal(r.meta.bank,'boc');assert.deepEqual(r.rows.map(r=>r.currency),['HKD','CNY']);assert.notEqual(r.rows[0].account_last4,r.rows[1].account_last4);
});
test('AEON comma points, coin redemption and card order',()=>{
 const r=P.parse('Credit Card Consolidated Statement AEON\nStatement Date 12 Jun 2026\nAEON CARD WAKUWAKU 1111-2222-3333-4444\n04 Jun 2026 05 Jun 2026 WAKU COIN REBATE 200.00 CR\nAEON Visa Credit Card(P) 1111-2222-3333-5555\n04 Jun 2026 05 Jun 2026 SHOP APPLE PAY 50.00\nBonus Point Program\nEarned Redeemed Balance Expiring\n30,212 25,000 9,556 0\nWAKU COIN Reward Program\n187 200 192 0');
 assert.equal(r.rows[0].kind,'reward_offset');assert.equal(r.rows[0].cardId,'card-aeon-waku');assert.equal(r.rows[1].payment_method,'apple_pay');assert.equal(r.rewards[0].earned,30212);assert.equal(r.rewards[0].redeemed,25000);assert.equal(r.rewards[1].earned,187);assert.equal(r.rows.filter(x=>x.kind==='rebate').length,0);
});
test('Mox bank cashback, welcome and transfers are distinct; credit positive does not imply payment',()=>{
 const r=P.parse('Mox Bank statement\nStatement period: 1 Mar 2026 - 31 Mar 2026\nStatement date: 3 Apr 2026\nCashBack\n1.16 HKD\n17 Mar 17 Mar CashBack +1.16\n17 Mar 17 Mar Mox invitation reward +1,000.00\n17 Mar 17 Mar ACCOUNT TRANSFER -100.00');assert.equal(r.meta.statement_month,'2026-03');assert.deepEqual(r.rows.map(x=>x.kind),['rebate','welcome_reward','transfer']);assert.equal(r.checks[0].ok,true);
 const c=P.parse('Mox Credit statement\n10 Mar 2026 - 9 Apr 2026\n11 Mar 12 Mar SHOP REFUND 50.00');assert.equal(c.rows[0].kind,'credit');assert.equal(c.rows[0].amount_minor,-5000);
});
test('statement cycle month, not calendar month, controls the consumption-record column',()=>{
 const r=P.parse('BOC Chill World Mastercard\nStatement Date 19-AUG-2026\n20-JUL 19-JUL ##START SHOP 10.00\n15-AUG 14-AUG END SHOP 20.00');
 assert.equal(r.meta.record_month,'2026-07');assert.deepEqual(r.rows.map(x=>x.record_month),['2026-07','2026-07']);
});
test('SC merchant association, actual miles and payment type',()=>{
 const r=P.parse('STANDARD CHARTERED CATHAY CARD\nStatement Date (DD/MM/YYYY) : 10/08/2026\nTransaction Ref 12345678901234567890123\n07/12 EXAMPLE SHOP HK 58.00\n08/03 SC IBANKING CREDIT CARD REPAYMEN T 100.00CR\n5523-43XX-XXXX-0000 1,057 1234567890');assert.equal(r.rows[0].merchant,'EXAMPLE SHOP HK');assert.equal(r.rows[0].transaction_reference,'12345678901234567890123');assert.equal(r.rows[0].post_date,null);assert.equal(r.rows[1].kind,'payment');assert.equal(r.rewards[0].earned,1057);assert.equal(r.rewards[0].valuation_hkd,null);
});
test('PDF layout excludes invisible space widths and keeps font fragments together',()=>{
 const i=(str,x,y,width)=>({str,transform:[1,0,0,8,x,y],width});
 const text=P.layoutText([i('05/07',10,100,20),i(' ',30,100,460),i('SHOP',50,100,30),i('Transaction Ref 123',200,102.14,90),i('58.00',400,100,30),i('J',10,50,4),i('u',14,50,4),i('n',18,50,4)]);
 assert.equal(text,'Transaction Ref 123\n05/07 SHOP 58.00\nJun');
});
test('missing metadata never substitutes today and full statement fingerprint avoids bank/month collisions',()=>{
 assert.equal(P.parse('BOC Chill no date\n03-JAN 03-JAN SHOP 5.00').rows.length,0);assert.notEqual(P.parse(boc+'03-JAN 03-JAN SHOP 5.00').fp,P.parse(boc+'03-JAN 03-JAN SHOP 6.00').fp);assert.equal(P.date(31,2,2026),null);
});
function app(){
 const h=fs.readFileSync(require.resolve('../versions/v2.14.1/index.html'),'utf8');
 const js=[...h.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n').replace(/boot\(\);\s*$/,'');
 const memory=new Map();const c={document:{querySelector:()=>null,addEventListener:()=>{}},window:{addEventListener:()=>{}},StatementParser:P,Date,console,localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},setTimeout:()=>0,clearTimeout:()=>{}};
 vm.createContext(c);vm.runInContext(js,c,{timeout:3000});vm.runInContext('S.data=freshData();S.data.cards=JSON.parse(JSON.stringify(REAL_CARDS));render=()=>{};closeSheet=()=>{};toast=(s)=>{globalThis.lastToast=s;};pdfPut=async()=>{};schedulePush=()=>{};',c);return c;
}
test('app import persists provenance, separates CNY, is idempotent and leaves old storage alone',async()=>{
 const c=app();c.text='BOC Go Platinum Card\nStatement Date 18-AUG-2026\nHKD Account No.: 1111-2222-3333-4444\n17-AUG 16-AUG SHOP 100.00\n17-AUG 16-AUG SHOP 100.00\nCNY Account No.: 1111-2222-3333-5555\n17-AUG 16-AUG SHOP 100.00';
 const importOnce=async()=>{vm.runInContext('IMPPDF.rows=buildRows(text);IMPPDF.stmts=[{fp:IMPPDF.rows[0].fp,name:"sample",text}];IMPPDF.pdfs=[];',c);await vm.runInContext('ACTIONS["pdft-save"]()',c);};
 await importOnce();await importOnce();
 assert.equal(vm.runInContext('S.data.transactions.length',c),2);assert.equal(vm.runInContext('S.data.credits.length',c),1);assert.equal(vm.runInContext('S.data.statementImports.length',c),1);assert.equal(vm.runInContext('S.data.transactions[0].raw_description',c),'SHOP');assert.equal(vm.runInContext('S.data.transactions[0].record_month',c),'2026-07');assert.equal(vm.runInContext('txsOfMonth("2026-07").length',c),2);assert.equal(vm.runInContext('txsOfMonth("2026-08").length',c),0);assert.equal(vm.runInContext('S.data.transactions[0].expectedReward',c),null);assert.equal(c.localStorage.getItem('micy_shuana_data_v1'),null);
 vm.runInContext('load()',c);assert.equal(vm.runInContext('S.data.transactions.length',c),2);
});
test('review edits preserve extracted amounts and quota failure retains review',async()=>{
 const c=app();c.text=boc+'03-JAN 03-JAN SHOP 5.00';vm.runInContext('IMPPDF.rows=buildRows(text);IMPPDF.stmts=[{fp:IMPPDF.rows[0].fp,name:"sample",text}];IMPPDF.rows[0].amount=6;IMPPDF.pdfs=[];',c);
 await vm.runInContext('ACTIONS["pdft-save"]()',c);assert.equal(vm.runInContext('S.data.statementImports[0].rows[0].amount',c),5);assert.equal(vm.runInContext('S.data.statementImports[0].reviewed_rows[0].amount',c),6);
 vm.runInContext('IMPPDF.rows=buildRows(text);IMPPDF.stmts=[{fp:IMPPDF.rows[0].fp,name:"sample",text}];localStorage.setItem=()=>{throw Error("QuotaExceededError")};',c);
 await vm.runInContext('ACTIONS["pdft-save"]()',c);assert.equal(vm.runInContext('IMPPDF.rows.length',c),1);assert.match(c.lastToast,/未能保存/);
});
test('record, review, reward and settings templates render without error',()=>{
 const c=app();c.text=boc+'03-JAN 03-JAN SHOP 5.00';vm.runInContext('IMPPDF.rows=buildRows(text);IMPPDF.stmts=[{fp:IMPPDF.rows[0].fp,name:"sample",text}];',c);
 for(const expr of ['recordsHTML()','pdfImportSheet(1)','pdfImportSheet(2)','statementLedgerHTML()','settingsHTML()'])assert.equal(typeof vm.runInContext(expr,c),'string');
});
