/* BOC Go: dated rules, CNY reward basis, no marker-based eligibility or actual allocation. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.GoRewards=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='go-2026-q3-v2',FROM='2026-07-01',TO='2026-12-31';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const normalize=s=>String(s||'').replace(/##/g,'').toUpperCase().replace(/[^A-Z0-9\u3400-\u9FFF]/g,'');
const MOBILE=['unionpay_qr','apple_pay','samsung_pay','huawei_pay','bocpay'];
const MERCHANTS=[['keeta',/KEETA/],['meituan',/MEITUAN|美團|美团/],['dianping',/DIANPING|大眾點評|大众点评/],['rail',/HIGHSPEEDRAIL|高速鐵路|高速铁路|WESTKOWLOON/],['didi',/DIDI|滴滴/],['jd',/^JD$|JDCOM|京東|京东/],['wellcome',/WELLCOME|惠康/],['marketplace',/MARKETPLACE/],['olivers',/OLIVERS/],['3hreesixty',/3HREESIXTY/]];
const CONDITIONAL=['rail','didi','jd','wellcome','marketplace','olivers','3hreesixty'];
function basePredict(t){
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
  notes.push('2026下半年本地HK$1,500門檻豁免；額外倍數須按登記月份及渠道核對。');
 }else notes.push('此月份未取得完整有效條款，僅列基本積分情境；不回溯套用2026下半年優惠。');
 const points=Math.floor(basis*pointsRate),cash=round(basis*cashRate);
 return {engine:'go',version:VERSION,period,date,basis,currency,mode,go_merchant:merchant,merchant_qualified:go,points_rate:pointsRate,extra_cash_rate:cashRate,base_points:points,base_hkd:round(points/250),bonus_hkd:cash,total_hkd:round(points/250+cash),raw_bonus_hkd:cash,label,confidence,notes,expected_cashback:confidence==='HIGH'?cash:null,observed_cashback_total:null,allocated_actual_cashback:null,evidence_count:0,reconciliation_status:'UNRESOLVED'};
}

const PROMO={id:'go-mobile-2026-q3',effective_from:'2026-07-01',effective_to:'2026-09-30',registration_from:'2026-07-02',registration_to:'2026-09-30',extra_points_cap:25000,source:'https://www.bochk.com/dam/boccreditcard/gopmq126/tnc_tc.pdf'};
function registration(config,period,scenario){
 const c=config?.promotions?.[PROMO.id]||{};
 if(c.status==='no')return false;
 if(c.status==='yes'&&/^2026-0[789]$/.test(c.registration_month||''))return period>=c.registration_month;
 return scenario;
}
function regionOf(t){
 if(t.go_region&&t.go_region!=='unknown')return {value:t.go_region,confirmed:true};
 const country=String(t.country_code||'').toUpperCase();
 if(['CN','CHN'].includes(country))return {value:'mainland',confirmed:true};
 if(['HK','HKG'].includes(country))return {value:'hong_kong',confirmed:true};
 if(country)return {value:'other',confirmed:true};
 const name=normalize(t.raw_description||t.merchant);
 if(t.currency==='CNY'||/SHENZHEN|GUANGZHOU|SHANGHAI|BEIJING|深圳|廣州|广州/.test(name))return {value:'mainland',confirmed:false};
 if(/HONGKONG|香港/.test(name))return {value:'hong_kong',confirmed:false};
 return {value:'unknown',confirmed:false};
}
function predict(t,config={},scenario=false){
 const original=basePredict(t),region=regionOf(t),knownChannel=t.go_channel||({apple_pay:'apple_pay',boc_pay_plus:'bocpay'}[t.payment_method])||'unknown';
 let input=t;
 if(scenario&&knownChannel==='unknown')input={...t,go_channel:'unionpay_qr'};
 if(scenario&&original.go_merchant&&(!t.go_qualification||t.go_qualification==='auto'))input={...input,go_qualification:'merchant_confirmed'};
 const p=basePredict(input),channel=input.go_channel||knownChannel,inPromo=p.date>=PROMO.effective_from&&p.date<=PROMO.effective_to;
 p.region=region.value;p.promo_id=null;p.basic_points=p.points_rate?Math.floor(p.basis):0;p.extra_points=Math.max(0,p.base_points-p.basic_points);
 if(inPromo&&registration(config,p.period,scenario)&&MOBILE.includes(channel)&&p.mode!=='excluded'&&!p.merchant_qualified&&(!p.go_merchant||t.go_qualification==='ordinary')&&['mainland','hong_kong'].includes(region.value)&&p.mode==='mobile'){
  const diamond=t.cardId==='card-boc-go-dia';p.points_rate=region.value==='mainland'?(diamond?20:10):(diamond?10:5);
  p.base_points=Math.floor(p.basis*p.points_rate);p.extra_points=p.base_points-p.basic_points;p.mode='promo_mobile';p.promo_id=PROMO.id;
  p.label=(region.value==='mainland'?'內地':'本地')+'手機 '+p.points_rate+'X 積分 ≈'+round(p.points_rate*.4)+'%';
  p.notes.push('指定手機推廣從成功登記曆月生效；含日常手機優惠的額外積分共用每曆月25,000分上限，基本1X另計。');
  if(!region.confirmed||scenario){p.confidence='PENDING';p.notes.push('地區、付款渠道或登記仍有情境假設；幣種不是銀行地區代碼。');}
 }
 if(scenario&&JSON.stringify(input)!==JSON.stringify(t)){p.confidence='PENDING';p.notes.push('此情境假設指定付款渠道及商戶附加資格成立，不是銀行確認。');}
 p.base_hkd=round(p.base_points/250);p.total_hkd=round(p.base_hkd+p.bonus_hkd);p.nominal_rate=p.points_rate*.004+p.extra_cash_rate;p.expected_cashback=p.confidence==='HIGH'?p.bonus_hkd:null;
 return p;
}
function calculateCore(transactions,ids,configs,scenario){
 const results=new Map(),groups=new Map();
 for(const t of transactions){if(!ids.includes(t.cardId)||t.demo||t.kind&&!['tx','foreign_tx','purchase'].includes(t.kind))continue;const p=predict(t,configs[t.cardId]||{},scenario);results.set(t,p);const key=t.cardId+'|'+p.period;if(!groups.has(key))groups.set(key,[]);groups.get(key).push([t,p]);}
 const monthly=[];
 for(const [key,rows] of groups){
  rows.sort((a,b)=>a[1].date.localeCompare(b[1].date)||String(a[0].source_id||a[0].id||'').localeCompare(String(b[0].source_id||b[0].id||'')));
  const [cardId,period]=key.split('|'),promoMonth=period>='2026-07'&&period<='2026-09'&&registration(configs[cardId]||{},period,scenario);
  let cashLeft=92,merchantPointsLeft=2000,mobilePointsLeft=25000,extraLeft=25000;
  for(const [,p] of rows){
   if(p.mode==='merchant'){p.bonus_hkd=round(Math.min(cashLeft,p.bonus_hkd));cashLeft=round(cashLeft-p.bonus_hkd);p.base_points=Math.min(merchantPointsLeft,p.base_points);merchantPointsLeft-=p.base_points;p.basic_points=p.base_points;p.extra_points=0;}
   if(p.mode==='mobile'||p.mode==='promo_mobile'){
    if(promoMonth){p.extra_points=Math.min(extraLeft,p.extra_points);extraLeft-=p.extra_points;p.base_points=p.basic_points+p.extra_points;}
    else{p.base_points=Math.min(mobilePointsLeft,p.base_points);mobilePointsLeft-=p.base_points;p.basic_points=Math.min(p.basic_points,p.base_points);p.extra_points=p.base_points-p.basic_points;}
   }
   p.base_hkd=round(p.base_points/250);p.total_hkd=round(p.base_hkd+p.bonus_hkd);p.effective_rate=p.basis?p.total_hkd/p.basis:0;p.notes.push('積分約值按250分=HK$1；名義百分比按獎賞計算基準，人民幣支出的實際港幣回報率另受兌換匯率影響。');p.expected_cashback=p.confidence==='HIGH'?p.bonus_hkd:null;
  }
  monthly.push({cardId,period,points:rows.reduce((s,[,p])=>s+p.base_points,0),basic_points:rows.reduce((s,[,p])=>s+p.basic_points,0),extra_points:rows.reduce((s,[,p])=>s+p.extra_points,0),cash:round(rows.reduce((s,[,p])=>s+p.bonus_hkd,0)),raw_cash:round(rows.reduce((s,[,p])=>s+p.raw_bonus_hkd,0)),bank_rounded_cash:Math.round(rows.reduce((s,[,p])=>s+p.bonus_hkd,0)),pending_count:rows.filter(([,p])=>p.confidence==='PENDING').length,transaction_count:rows.length,observed_cashback_total:null,evidence_count:0,allocated_actual_cashback:null,reconciliation_status:'UNRESOLVED'});
 }
 return {results,monthly};
}
function calculate(transactions,ids=['card-boc-go','card-boc-go-dia'],configs={}){
 const model=calculateCore(transactions,ids,configs,false),alternative=calculateCore(transactions,ids,configs,true);
 for(const [t,p] of model.results){const alt=alternative.results.get(t);p.conditional_total_hkd=alt.total_hkd;p.conditional_points=alt.base_points;p.conditional_cash_hkd=alt.bonus_hkd;p.conditional_label=alt.label;p.conditional_rate=alt.nominal_rate;}
 for(const m of model.monthly){const alt=alternative.monthly.find(a=>a.cardId===m.cardId&&a.period===m.period);m.conditional_points=alt.points;m.conditional_cash=alt.cash;}
 return model;
}
return {VERSION,FROM,TO,PROMO,normalize,regionOf,predict,calculate};
});
