const test=require('node:test'),assert=require('node:assert/strict'),G=require('../versions/v2.18.0/go-rewards');
const tx=(extra={})=>({id:'a',cardId:'card-boc-go',kind:'tx',merchant:'SHOP',amount:100,currency:'HKD',date:'2026-07-05',post_date:'2026-07-06',...extra});
test('Go effective dates and variants: 2X platinum / 3X diamond, no historical promo backfill',()=>{
 assert.equal(G.predict(tx({go_channel:'apple_pay'})).base_points,200);
 assert.equal(G.predict(tx({cardId:'card-boc-go-dia',go_channel:'apple_pay'})).base_points,300);
 for(const date of ['2026-06-30','2027-01-01']){const p=G.predict(tx({date,go_channel:'apple_pay'}));assert.equal(p.base_points,100);assert.equal(p.confidence,'PENDING');}
});
test('Go merchant 5% cash and points cap, no mobile stacking or 1500 threshold in H2',()=>{
 const p=G.predict(tx({merchant:'Keeta',go_channel:'apple_pay'}));assert.equal(p.bonus_hkd,4.6);assert.equal(p.base_points,100);assert.equal(p.total_hkd,5);
 const a=tx({merchant:'Keeta',amount:1500,go_channel:'direct'}),b=tx({id:'b',merchant:'Keeta',amount:1500,go_channel:'direct'});
 const m=G.calculate([b,a]).monthly[0];assert.equal(m.cash,92);assert.equal(m.points,2000);assert.equal(m.raw_cash,138);
 assert.equal(G.calculate([tx({amount:30000,go_channel:'apple_pay'})]).monthly[0].points,25000);
});
test('Go CNY reward basis combines with HKD without changing raw currencies',()=>{
 const a=tx({amount:1000,merchant:'Keeta',go_channel:'direct'}),b=tx({id:'b',amount:2000,currency:'CNY',kind:'foreign_tx',merchant:'Keeta',go_channel:'direct'}),before=JSON.stringify([a,b]);
 assert.equal(G.calculate([a,b]).monthly[0].cash,92);assert.equal(JSON.stringify([a,b]),before);
 assert.equal(G.predict(tx({currency:'JPY',amount:10000})).total_hkd,0);
});
test('Go conditional merchants require evidence; metro and marker do not confer 5%',()=>{
 const ordinary=G.predict(tx({merchant:'Shenzhen metro',go_channel:'direct'}));assert.equal(ordinary.go_merchant,null);assert.equal(ordinary.total_hkd,.4);
 assert.deepEqual(G.predict(tx({merchant:'##Shenzhen metro',go_channel:'direct'})),ordinary);
 assert.equal(G.predict(tx({merchant:'Wellcome',go_channel:'direct'})).bonus_hkd,0);
 assert.equal(G.predict(tx({merchant:'Wellcome',go_channel:'direct',go_qualification:'merchant_confirmed'})).bonus_hkd,4.6);
 assert.equal(G.predict(tx({merchant:'Keeta',go_channel:'direct',go_qualification:'ordinary'})).bonus_hkd,0);
 for(const merchant of ['RentSmart','PAYPAL','OCTOPUS TOP UP'])assert.equal(G.predict(tx({merchant,go_channel:'apple_pay'})).total_hkd,0);
});
test('Go no observed allocations, posting deadline and overseas/non-CNY distinction',()=>{
 const p=G.predict(tx({merchant:'Keeta',go_channel:'direct',post_date:'2026-07-20'}));assert.equal(p.bonus_hkd,0);assert.equal(p.confidence,'PENDING');assert.equal(p.allocated_actual_cashback,null);
 assert.equal(G.predict(tx({original_currency:'JPY',go_channel:'direct'})).base_points,200);
 assert.equal(G.predict(tx({original_currency:'CNY',go_channel:'direct'})).base_points,100);
 assert.equal(G.predict(tx({original_currency:'JPY',go_channel:'apple_pay',cardId:'card-boc-go-dia'})).base_points,300);
 assert.equal(G.predict(tx({merchant:'SHOP',go_channel:'bocpay'})).base_points,200);
 assert.equal(G.predict(tx({merchant:'Keeta',go_channel:'bocpay'})).bonus_hkd,0);
});

test('BOC card type comes from header, and date before English label is not due date',()=>{
 const P=require('../versions/v2.18.0/parser');
 const p=P.parse('MONTHLY STATEMENT\n信用卡類別 Card Type: 中銀雙幣白金卡\nBOC Dual Currency Platinum Card\n結單日期\n18-NOV-2024\nStatement Date\n到期付款日\n13-DEC-2024\nDue Date\nHKD Account No.: 1111-2222-3333-4444\n16-NOV 15-NOV SHOP 10.00\nPromotion: Diamond card');
 assert.equal(p.meta.card_type,'go_platinum');assert.equal(p.meta.statement_date,'2024-11-18');assert.equal(p.rows[0].cardId,'card-boc-go');assert.equal(p.rows[0].record_month,'2024-11');
 assert.equal(G.predict(tx({merchant:'OCTOPUS AUTO ADDING VALUE'})).total_hkd,0);
});
const registered=(month='2026-07')=>({promotions:{[G.PROMO.id]:{status:'yes',registration_month:month}}});
test('Q3 registered mainland/local multipliers and percentage values differ by card tier',()=>{
 for(const [cardId,region,x]of [['card-boc-go','mainland',10],['card-boc-go','hong_kong',5],['card-boc-go-dia','mainland',20],['card-boc-go-dia','hong_kong',10]]){
  const p=G.predict(tx({cardId,go_channel:'apple_pay',go_region:region}),registered());assert.equal(p.points_rate,x);assert.equal(p.base_points,100*x);assert.equal(p.nominal_rate,x*.004);assert.equal(p.total_hkd,x*.4);
 }
});
test('registration starts at calendar month, unknown registration has separate capped scenario',()=>{
 const row=tx({currency:'CNY',kind:'foreign_tx',go_channel:'bocpay',go_region:'mainland'});
 assert.equal(G.predict(row,registered('2026-08')).points_rate,2);
 assert.equal(G.predict({...row,date:'2026-08-01',post_date:'2026-08-02'},registered('2026-08')).points_rate,10);
 assert.equal(G.predict({...row,date:'2026-10-01',post_date:'2026-10-02'},registered()).points_rate,2);
 const p=G.calculate([row]).results.get(row);assert.equal(p.total_hkd,.8);assert.equal(p.conditional_total_hkd,4);assert.equal(p.allocated_actual_cashback,null);
 const no=G.calculate([row],undefined,{'card-boc-go':{promotions:{[G.PROMO.id]:{status:'no'}}}}).results.get(row);assert.equal(no.conditional_total_hkd,.8);
});
test('registered extra 25000 cap is shared across HKD/CNY and mainland/local, base 1X remains',()=>{
 const a=tx({amount:2000,currency:'CNY',go_channel:'apple_pay',go_region:'mainland'}),b=tx({id:'b',amount:2000,go_channel:'apple_pay',go_region:'hong_kong'});
 const model=G.calculate([a,b],undefined,{'card-boc-go':registered()}),m=model.monthly[0];assert.equal(m.basic_points,4000);assert.equal(m.extra_points,25000);assert.equal(m.points,29000);assert.equal(model.results.get(a).base_points,20000);assert.equal(model.results.get(b).base_points,9000);
 const c=tx({id:'c',cardId:'card-boc-go-dia',amount:2000,currency:'CNY',go_channel:'apple_pay',go_region:'mainland'});assert.equal(G.calculate([c],undefined,{'card-boc-go-dia':registered()}).monthly[0].points,27000);
});
test('Go merchant 5% has priority even over registered Diamond 20X; excluded channels and unknown currency remain distinct',()=>{
 const t=tx({merchant:'Keeta',go_channel:'apple_pay',go_region:'mainland',cardId:'card-boc-go-dia'}),p=G.predict(t,registered());assert.equal(p.total_hkd,5);assert.equal(p.points_rate,1);assert.equal(p.promo_id,null);
 for(const channel of ['alipay','wechat'])assert.equal(G.predict(tx({go_channel:channel,go_region:'mainland'}),registered()).total_hkd,0);
 assert.equal(G.predict(tx({currency:'CNY',go_channel:'direct'}),registered()).points_rate,1);
 assert.equal(G.predict(tx({currency:'CNY',go_channel:'apple_pay'}),registered()).confidence,'PENDING');
 assert.equal(G.predict(tx({currency:'CNY',merchant:'## SHOP'}),registered()).points_rate,1);
});
