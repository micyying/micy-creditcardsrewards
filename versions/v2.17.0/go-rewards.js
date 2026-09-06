/* BOC Go: dated rules, CNY reward basis, no marker-based eligibility or actual allocation. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.GoRewards=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='go-2026-h2-v1',FROM='2026-07-01',TO='2026-12-31';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const normalize=s=>String(s||'').replace(/##/g,'').toUpperCase().replace(/[^A-Z0-9\u3400-\u9FFF]/g,'');
const MOBILE=['unionpay_qr','apple_pay','samsung_pay','huawei_pay','bocpay'];
const MERCHANTS=[['keeta',/KEETA/],['meituan',/MEITUAN|美團|美团/],['dianping',/DIANPING|大眾點評|大众点评/],['rail',/HIGHSPEEDRAIL|高速鐵路|高速铁路|WESTKOWLOON/],['didi',/DIDI|滴滴/],['jd',/^JD|JDCOM|京東|京东/],['wellcome',/WELLCOME|惠康/],['marketplace',/MARKETPLACE/],['olivers',/OLIVERS/],['3hreesixty',/3HREESIXTY/]];
const CONDITIONAL=['rail','didi','jd','wellcome','marketplace','olivers','3hreesixty'];
function predict(t){
 const date=t.transaction_date||t.date||'',period=date.slice(0,7),name=normalize(t.raw_description||t.merchant),channel=t.go_channel||({apple_pay:'apple_pay',boc_pay_plus:'bocpay'}[t.payment_method])||'unknown',active=date>=FROM&&date<=TO;
 const purchase=!t.kind||['tx','foreign_tx','purchase'].includes(t.kind);
 const currency=t.currency||'HKD',basis=['HKD','CNY'].includes(currency)?Math.max(0,Number(t.amount)||0):Math.max(0,Number(t.amount_hkd)||0);
 const merchant=MERCHANTS.find(([,re])=>re.test(name))?.[0]||null;
 const notes=['港幣／人民幣簽帳以1:1獎賞基準計算；不代表貨幣兌換率。','##不參與資格判定。實際回贈不逐筆分配。'];
 let pointsRate=1,cashRate=0,label='基本積分情境 0.4%',confidence='PENDING',go=false,mode='base';
 const excluded=!purchase||t.go_qualification==='excluded'||/RENTSMART|^RENT$|租金|ALIPAY|WECHATPAY|TOPUP|AUTOADDINGVALUE|AUTOPAY|DIRECTDEBIT|CASHINSTALMENT|INSTALLMENT|積FUN錢|增值|繳租|交租|CASHADVANCE|PAYPAL|稅款|學費|水費|電費|煤氣/.test(name)||['alipay','wechat'].includes(channel);
 const supported=['HKD','CNY'].includes(currency)||Number(t.amount_hkd)>0;
 const posted=t.post_date||t.settlement_date;
 const delay=posted?(Date.parse(posted)-Date.parse(date))/86400000:null;
 const postingOK=delay!=null&&delay>=0&&delay<=7;
 if(excluded){pointsRate=0;label='非合資格項目';confidence=(!purchase||t.go_qualification==='excluded'||active)?'HIGH':'PENDING';mode='excluded';}
 else if(!supported){pointsRate=0;notes.push('欠缺港幣入賬金額，不用原外幣金額計算。');}
 else if(active){
  const channelOK=['direct','unionpay_qr','apple_pay','samsung_pay','huawei_pay'].includes(channel);
  const conditionsOK=!CONDITIONAL.includes(merchant)||t.go_qualification==='merchant_confirmed';
  go=!!merchant&&t.go_qualification!=='ordinary'&&channelOK&&conditionsOK;
  if(go){cashRate=.046;mode='merchant';label='Go商戶5%：0.4%積分＋4.6%現金';confidence=postingOK?'HIGH':'PENDING';}
  else if(merchant&&t.go_qualification!=='ordinary'){
   // Merchant purchases are excluded from mobile/overseas multiplier offers.
   notes.push('指定商戶候選：渠道或商戶附加條件未核實，先列基本積分；確認後重算5%。');
  }else if(MOBILE.includes(channel)){pointsRate=t.cardId==='card-boc-go-dia'?3:2;mode='mobile';label='手機支付 '+pointsRate+'X 積分';confidence=postingOK?'HIGH':'PENDING';}
  else if(t.original_currency&& !['HKD','CNY'].includes(t.original_currency)) {pointsRate=2;mode='overseas';label='外幣海外簽帳 2X 積分';confidence=postingOK?'HIGH':'PENDING';}
  else if(channel==='direct'){confidence=postingOK?'HIGH':'PENDING';}
  if(delay!=null&&!postingOK){cashRate=0;pointsRate=1;go=false;mode='base';confidence='PENDING';notes.push('未在交易後7日內入賬，推廣資格待核實。');}
  notes.push('2026下半年本地HK$1,500門檻豁免；20X／10X另行登記推廣未啟用。');
 }else notes.push('此月份未取得完整有效條款，僅列基本積分情境；不回溯套用2026下半年優惠。');
 const points=Math.floor(basis*pointsRate),cash=round(basis*cashRate);
 return {engine:'go',version:VERSION,period,date,basis,currency,mode,go_merchant:merchant,merchant_qualified:go,points_rate:pointsRate,extra_cash_rate:cashRate,base_points:points,base_hkd:round(points/250),bonus_hkd:cash,total_hkd:round(points/250+cash),raw_bonus_hkd:cash,label,confidence,notes,expected_cashback:confidence==='HIGH'?cash:null,observed_cashback_total:null,allocated_actual_cashback:null,evidence_count:0,reconciliation_status:'UNRESOLVED'};
}
function calculate(transactions,ids=['card-boc-go','card-boc-go-dia']){
 const results=new Map(),groups=new Map();
 for(const t of transactions){if(!ids.includes(t.cardId)||t.demo||t.kind&&!['tx','foreign_tx','purchase'].includes(t.kind))continue;const p=predict(t);results.set(t,p);const key=t.cardId+'|'+p.period;if(!groups.has(key))groups.set(key,[]);groups.get(key).push([t,p]);}
 const monthly=[];
 for(const [key,rows] of groups){
  // Deterministic chronological theoretical allocation only; NOT observed allocations.
  rows.sort((a,b)=>a[1].date.localeCompare(b[1].date)||String(a[0].source_id||a[0].id||'').localeCompare(String(b[0].source_id||b[0].id||'')));
  let cashLeft=92,merchantPointsLeft=2000,mobilePointsLeft=25000;
  for(const [,p] of rows){
   if(p.mode==='merchant'){p.bonus_hkd=round(Math.min(cashLeft,p.bonus_hkd));cashLeft=round(cashLeft-p.bonus_hkd);p.base_points=Math.min(merchantPointsLeft,p.base_points);merchantPointsLeft-=p.base_points;}
   if(p.mode==='mobile'){p.base_points=Math.min(mobilePointsLeft,p.base_points);mobilePointsLeft-=p.base_points;}
   p.base_hkd=round(p.base_points/250);p.total_hkd=round(p.base_hkd+p.bonus_hkd);p.notes.push('逐筆積分向下取整及現金至分為情境；銀行推廣按整月四捨五入至整元／分，整月值另列。');p.expected_cashback=p.confidence==='HIGH'?p.bonus_hkd:null;
  }
  const [cardId,period]=key.split('|');monthly.push({cardId,period,points:rows.reduce((s,[,p])=>s+p.base_points,0),cash:round(rows.reduce((s,[,p])=>s+p.bonus_hkd,0)),raw_cash:round(rows.reduce((s,[,p])=>s+p.raw_bonus_hkd,0)),bank_rounded_cash:Math.round(rows.reduce((s,[,p])=>s+p.bonus_hkd,0)),pending_count:rows.filter(([,p])=>p.confidence==='PENDING').length,transaction_count:rows.length,observed_cashback_total:null,evidence_count:0,allocated_actual_cashback:null,reconciliation_status:'UNRESOLVED'});
 }
 return {results,monthly};
}
return {VERSION,FROM,TO,normalize,predict,calculate};
});
