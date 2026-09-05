/* Chill v2 prediction model. Pure: raw statement fields and actual rewards are never changed. */
(function(root){
'use strict';
const VERSION='chill-v2-2026.09.05';
const SOURCE='https://www.bochk.com/dam/boccreditcard/chillcard/chill_offer_tnc_tc.pdf';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const month=t=>String(t.transaction_date||t.date||t.post_date||'').slice(0,7);
const desc=t=>String(t.merchant||t.raw_description||'').toUpperCase();
// Name matches are candidates, never bank-confirmed MCCs. Snapshot expires with the published offer.
const online=/APPLE\.COM|APPLE (?:STORE|MUSIC|TV)|APP STORE|ITUNES|NETFLIX|NINTENDO|PLAYSTATION|SPOTIFY|YOUTUBE|GOOGLE PLAY|DISNEY\+|MOOV|JOOX|KK ?BOX|AMAZON|HKTVMALL|HKEXPRESS|HONG KONG EXPRESS|TRIP\.COM|AGODA|BOOKING\.COM|KLOOK|ONLINE|E-COMMERCE/;
const entertainment=/APPLE\.COM|APPLE (?:STORE|MUSIC|TV)|APP STORE|ITUNES|NETFLIX|NINTENDO|PLAYSTATION|SPOTIFY|YOUTUBE|GOOGLE PLAY|DISNEY\+|MOOV|JOOX|KK ?BOX|CINEMA|CINEMACOM|MCL\b|BROADWAY|GOLDEN HARVEST|UA CINEMA/;
const localChill=/MCDONALD|PACIFIC COFFEE|STARBUCKS|DYSON|SAMSUNG|\bSONY\b|UNIQLO|\bGU\b|\bIKEA\b|LOG-?ON/;
const newChill=/\bNOC\b|%\s*ARABICA|FINEPRINT|LOGITECH|RAZER/;
const excluded=/TOP\s*UP|BOC\s*PAY|ALIPAY|WECHAT|OCTOPUS|\bOCL\*|AUTO\s*PAY|AUTOPAY|BILL PAYMENT|PAYPAL|CASH ADVANCE|BALANCE TRANSFER|INSURANCE|FINANCE CHARGE|ANNUAL FEE|TRANSACTION FEE|TAX PAYMENT|TUITION/;
function classify(t){
 const name=desc(t),date=t.transaction_date||t.date||'',notes=[];
 const override=t.prediction_channel;
 const invalidKind=t.kind&&!['tx','foreign_tx'].includes(t.kind);
 const foreignCurrency=t.original_currency||t.foreign_currency||'';
 const foreign=!!(foreignCurrency&&foreignCurrency!=='HKD')||/\b(?:CNY|RMB|USD|JPY|EUR|GBP|KRW|TWD|THB|SGD|AUD)\s*[\d,]+(?:\.\d+)?/.test(name);
 const outside=date<'2026-01-01'||date>'2026-12-31';
 if(outside)notes.push('沿用 Chill v2／2026 規則作歷史或未來情境估算，並非當期已核實優惠');
 let isExcluded=invalidKind||excluded.test(name)||override==='excluded';
 let isOnline=online.test(name)||t.online===true;
 if(override==='online')isOnline=true;
 if(override==='offline')isOnline=false;
 const isChill=override==='chill'||entertainment.test(name)||((!foreign)&&localChill.test(name))||(date>='2026-05-01'&&newChill.test(name));
 const late=t.post_date&&date?Math.round((Date.parse(t.post_date)-Date.parse(date))/86400000)>7:false;
 if(late)notes.push('交易超過7天才誌賬：預計不獲額外現金，基本積分仍按零售估算');
 if(isExcluded)notes.push('電子錢包／增值／繳費或非零售：本模型預計回贈0');
 else if(isOnline)notes.push(override==='online'?'你指定為網上交易':'按商戶名稱／已選渠道推定網上交易');
 else if(foreign)notes.push('原單列有外幣交易金額，推定合資格海外交易');
 else notes.push(override==='offline'?'你指定為實體交易':'未見網上或外幣證據，先按一般實體零售估算');
 if(isChill)notes.push('Chill 商戶名稱候選；需同曆月實體簽賬滿HK$1,500');
 if(name.includes('##'))notes.push('## 只保留為原單標記，不用來決定回贈率');
 return {excluded:isExcluded,online:isOnline,foreign,chill:isChill,late,historical:outside,notes};
}
function calculate(transactions,cardIds=['card-boc-chill']){
 const rows=transactions.filter(t=>cardIds.includes(t.cardId)&&!t.demo&&(!t.currency||t.currency==='HKD'));
 const groups=new Map(),results=new Map(),monthly=[];
 for(const t of rows){const key=t.cardId+'|'+month(t);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);}
 for(const [key,items] of groups){
  items.sort((a,b)=>String(a.transaction_date||a.date).localeCompare(String(b.transaction_date||b.date))||String(a.post_date||'').localeCompare(String(b.post_date||''))||String(a.source_id||a.id).localeCompare(String(b.source_id||b.id)));
  const cs=new Map(items.map(t=>[t,classify(t)]));
  const physical=round(items.reduce((s,t)=>s+(!cs.get(t).excluded&&!cs.get(t).online?Math.max(0,Number(t.amount)||0):0),0));
  let used=0,rawCash=0,totalPoints=0;
  for(const t of items){
   const c=cs.get(t),amount=Math.max(0,Number(t.amount)||0),whole=Math.floor(round(amount)),points=c.excluded?0:whole;
   let rate=0,label=c.excluded?'不合資格 · 預計0':'一般零售 · 基本積分約0.4%';
   if(!c.excluded&&!c.late){
    if(c.online||c.foreign){rate=.046;label='網上／海外 · 約5%';}
    if(c.chill&&physical>=1500){rate=.096;label='Chill 商戶 · 門檻已達 · 約10%';}
    else if(c.chill)c.notes.push('已匯入的同曆月實體消費 HK$'+physical.toFixed(2)+'，未達HK$1,500');
   }
   const raw=whole*rate;
   // Allocate the shared HK$150 cap chronologically in hundredths of a cent (no per-row rounding drift).
   const rawUnits=Math.round(raw*10000),remaining=Math.max(0,1500000-used),cashUnits=Math.min(remaining,rawUnits);
   const cash=round(round((used+cashUnits)/10000)-round(used/10000)),base=round(points/250),capped=cashUnits<rawUnits;
   used+=cashUnits;rawCash+=raw;totalPoints+=points;
   if(capped){label+=' · 共用上限';c.notes.push('5%／10%額外現金共用每曆月HK$150，上限依交易順序分配');}
   c.notes.push('依已匯入交易計門檻與上限；補入相鄰月結單會重新計算');
   const prediction={version:VERSION,source:SOURCE,period:month(t),base_points:points,base_hkd:base,bonus_hkd:cash,raw_bonus_hkd:round(raw),total_hkd:round(base+cash),bonus_rate:rate,physical_spend:physical,threshold_met:physical>=1500,capped,confidence:c.historical?'LOW':'INFERRED',channel:c.online?'online':'offline',label,notes:c.notes};
   results.set(t,prediction);
  }
  const cash=round(used/10000),[cardId,period]=key.split('|');
  monthly.push({cardId,period,physical_spend:physical,base_points:totalPoints,base_hkd:round(totalPoints/250),raw_bonus_hkd:round(rawCash),bonus_hkd:cash,rounded_bonus_hkd:Math.round(cash),version:VERSION});
 }
 return {results,monthly};
}
const api={VERSION,SOURCE,classify,calculate};if(typeof module!=='undefined')module.exports=api;root.ChillRewards=api;
})(typeof globalThis!=='undefined'?globalThis:this);
