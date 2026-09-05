/* Chill v2 prediction model. Pure: raw statement fields and actual rewards are never changed. */
(function(root){
'use strict';
const VERSION='chill-v2.1-2026.09.05';
const SOURCE='https://www.bochk.com/dam/boccreditcard/chillcard/chill_offer_tnc_tc.pdf';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const month=t=>String(t.transaction_date||t.date||t.post_date||'').slice(0,7);
function normalizeMerchant(value){return String(value||'').normalize('NFKC').toUpperCase().replace(/^\s*##\s*/,'').replace(/^BBMSL\s*\*\s*/,'').replace(/[’']/g,'').replace(/\s+/g,' ').trim();}
const desc=t=>normalizeMerchant(t.merchant||t.raw_description);
const MERCHANT_RULES=[
 {id:'apple',pattern:'APPLE\\.COM/BILL|APPLE (?:TV|MUSIC|STORE)|APP STORE|ITUNES',group:'entertainment'},
 {id:'digital',pattern:'DISNEY\\+|GOOGLE PLAY|JOOX|KK ?BOX|MOOV|NETFLIX|NINTENDO|PLAYSTATION|SPOTIFY|YOUTUBE',group:'entertainment'},
 {id:'cinemas',pattern:'CINEMACOMHK|CINEMA|\\bMCL\\b|BROADWAY|GOLDEN HARVEST|戲院|电影院|電影院',group:'entertainment'},
 {id:'local-leisure',pattern:'MCDONALDS?|PACIFIC COFFEE|STARBUCKS|DYSON|SAMSUNG|\\bSONY\\b|UNIQLO|\\bGU\\b|\\bIKEA\\b|LOG-?ON',group:'local'},
 {id:'new-2026-may',pattern:'\\bNOC\\b|%\\s*ARABICA|FINEPRINT|LOGITECH|RAZER',group:'local',effective_from:'2026-05-01'}
].map(r=>({...r,effective_from:r.effective_from||'2026-01-01',effective_to:'2026-12-31'}));
function merchantRule(name,date,rules=MERCHANT_RULES){return rules.find(r=>date>=r.effective_from&&date<=r.effective_to&&new RegExp(r.pattern,'i').test(name))||null;}
// Name matches are candidates, never bank-confirmed MCCs. Snapshot expires with the published offer.
const online=/APPLE\.COM|APPLE (?:STORE|MUSIC|TV)|APP STORE|ITUNES|NETFLIX|NINTENDO|PLAYSTATION|SPOTIFY|YOUTUBE|GOOGLE PLAY|DISNEY\+|MOOV|JOOX|KK ?BOX|AMAZON|HKTVMALL|HKEXPRESS|HONG KONG EXPRESS|TRIP\.COM|AGODA|BOOKING\.COM|KLOOK|ONLINE|E-COMMERCE/;
const excluded=/TOP\s*UP|BOC\s*PAY|ALIPAY|WECHAT|OCTOPUS|\bOCL\*|AUTO\s*PAY|AUTOPAY|BILL PAYMENT|PAYPAL|CASH ADVANCE|BALANCE TRANSFER|INSURANCE|FINANCE CHARGE|ANNUAL FEE|TRANSACTION FEE|TAX PAYMENT|TUITION/;
function classify(t,rules=MERCHANT_RULES){
 const name=desc(t),date=t.transaction_date||t.date||'',notes=[];
 const override=t.prediction_channel;
 const invalidKind=t.kind&&!['tx','foreign_tx'].includes(t.kind);
 const foreignCurrency=t.original_currency||t.foreign_currency||'';
 const foreign=!!(foreignCurrency&&foreignCurrency!=='HKD')||/\b(?:CNY|RMB|USD|JPY|EUR|GBP|KRW|TWD|THB|SGD|AUD)\s*[\d,]+(?:\.\d+)?/.test(name);
 const outside=date<'2026-01-01'||date>'2026-12-31';
 if(outside)notes.push('沿用 Chill v2／2026 規則作歷史或未來情境估算，並非當期已核實優惠');
 let isExcluded=invalidKind||excluded.test(name)||override==='excluded';
 const eternal=/ETERNAL EAST/.test(name);
 let isOnline=eternal?false:online.test(name)||t.online===true;
 if(override==='online')isOnline=true;
 if(override==='offline')isOnline=false;
 const matchedRule=merchantRule(name,date,rules);
 const isChill=!eternal&&(override==='chill'||!!matchedRule&&(matchedRule.group!=='local'||!foreign));
 const unknown=eternal&&!['online','offline','excluded'].includes(override);
 const onlineStatus=unknown?'UNKNOWN':isOnline?'ONLINE':'OFFLINE';
 const late=t.post_date&&date?Math.round((Date.parse(t.post_date)-Date.parse(date))/86400000)>7:false;
 if(late)notes.push('交易超過7天才誌賬：預計不獲額外現金，基本積分仍按零售估算');
 if(isExcluded)notes.push('電子錢包／增值／繳費或非零售：本模型預計回贈0');
 else if(isOnline)notes.push(override==='online'?'你指定為網上交易':'按商戶名稱／已選渠道推定網上交易');
 else if(foreign)notes.push('原單列有外幣交易金額，推定合資格海外交易');
 else notes.push(unknown?'Eternal East渠道未知：不預設5%，基本積分僅為零售情境估計，且不計入實體門檻':override==='offline'?'你指定為實體交易':'未見網上或外幣證據，先按一般實體零售估算');
 if(isChill)notes.push('Chill 商戶名稱候選；需同曆月實體簽賬滿HK$1,500');
 return {excluded:isExcluded,online:isOnline,online_status:onlineStatus,unknown,foreign,chill:isChill,chill_merchant:isChill,merchant_rule:matchedRule,late,historical:outside,confidence:unknown?'PENDING':outside?'LOW':'INFERRED',cashback_category:unknown?'UNKNOWN':isChill?'CHILL_MERCHANT':isOnline||foreign?'ONLINE_OR_OVERSEAS':'RETAIL',notes};
}
function calculate(transactions,cardIds=['card-boc-chill']){
 const rows=transactions.filter(t=>cardIds.includes(t.cardId)&&!t.demo&&(!t.currency||t.currency==='HKD'));
 const groups=new Map(),results=new Map(),monthly=[];
 for(const t of rows){const key=t.cardId+'|'+month(t);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);}
 for(const [key,items] of groups){
  items.sort((a,b)=>String(a.transaction_date||a.date).localeCompare(String(b.transaction_date||b.date))||String(a.post_date||'').localeCompare(String(b.post_date||''))||String(a.source_id||a.id).localeCompare(String(b.source_id||b.id)));
  const cs=new Map(items.map(t=>[t,classify(t)]));
  const physical=round(items.reduce((s,t)=>s+(!cs.get(t).excluded&&!cs.get(t).online&&!cs.get(t).unknown?Math.max(0,Number(t.amount)||0):0),0));
  let used=0,rawCash=0,totalPoints=0;
  for(const t of items){
   const c=cs.get(t),amount=Math.max(0,Number(t.amount)||0),whole=Math.floor(round(amount)),points=c.excluded?0:whole;
   let rate=0,label=c.excluded?'不合資格 · 預計0':c.unknown?'渠道未知 · 基本積分情境估計':'一般零售 · 基本積分約0.4%';
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
   const prediction={version:VERSION,source:SOURCE,period:month(t),base_points:points,base_hkd:base,bonus_hkd:cash,raw_bonus_hkd:round(raw),total_hkd:round(base+cash),bonus_rate:rate,base_reward_rate:c.excluded?0:.004,extra_cash_rebate_rate:rate,headline_reward_rate:c.excluded?0:Number((.004+rate).toFixed(4)),physical_spend:physical,threshold_met:physical>=1500,capped,confidence:c.confidence,online_status:c.online_status,chill_merchant:c.chill_merchant,cashback_category:c.cashback_category,merchant_rule_id:c.merchant_rule?.id||null,effective_from:c.merchant_rule?.effective_from||null,effective_to:c.merchant_rule?.effective_to||null,channel:c.unknown?'unknown':c.online?'online':'offline',expected_cashback:cash,allocated_actual_cashback:null,evidence_count:0,reconciliation_status:'INSUFFICIENT_DATA',label,notes:c.notes};
   results.set(t,prediction);
  }
  const cash=round(used/10000),[cardId,period]=key.split('|');
  monthly.push({cardId,period,physical_spend:physical,base_points:totalPoints,base_hkd:round(totalPoints/250),raw_bonus_hkd:round(rawCash),bonus_hkd:cash,rounded_bonus_hkd:Math.round(cash),version:VERSION});
 }
 return {results,monthly};
}
function reconcile(model,observations=[]){
 const grouped=new Map();
 for(const row of observations){if(!row.period||!Number.isFinite(row.amount))continue;const key=row.cardId+'|'+row.period;if(!grouped.has(key))grouped.set(key,new Map());grouped.get(key).set(row.source_id||JSON.stringify(row),row);}
 const months=new Map(model.monthly.map(m=>[m.cardId+'|'+m.period,{...m}]));
 for(const key of grouped.keys())if(!months.has(key)){const [cardId,period]=key.split('|');months.set(key,{cardId,period,raw_bonus_hkd:0,bonus_hkd:0,physical_spend:0,no_transactions:true});}
 const reports=[];
 for(const [key,m] of months){
  const evidence=[...(grouped.get(key)||new Map()).values()];
  const bank=evidence.filter(e=>e.source_type!=='user_confirmation'),confirmed=evidence.filter(e=>e.source_type==='user_confirmation');
  const bankTotal=round(bank.reduce((s,e)=>s+e.amount,0)),confirmation=confirmed.at(-1);
  const observed=bank.length?bankTotal:confirmation?confirmation.amount:null;
  const conflict=!!(bank.length&&confirmation&&Math.abs(bankTotal-confirmation.amount)>.01);
  const capReached=observed!=null&&observed>=150,raw=m.raw_bonus_hkd||0;
  let status=observed==null?'INSUFFICIENT_DATA':m.no_transactions||conflict?'UNRESOLVED':capReached?(observed===150&&raw>=150?'CAPPED_MATCH':'UNRESOLVED'):Math.abs(m.bonus_hkd-observed)<.01?'MATCHED':'UNRESOLVED';
  const r={...m,expected_cashback:m.bonus_hkd,observed_cashback_total:observed,allocated_actual_cashback:null,evidence_count:evidence.length,evidence_sources:evidence.map(e=>e.source_type),observed_cap_reached:capReached,minimum_implied_extra_cashback:capReached?150:null,difference:observed==null?null:round(m.bonus_hkd-observed),reconciliation_status:status,confidence:status==='UNRESOLVED'?'PENDING':observed==null?'PENDING':'INFERRED',evidence_conflict:conflict,explanation:capReached?'實際已達HK$150上限：只證明未封頂金額至少HK$150，不能反推逐筆實際回贈':status==='UNRESOLVED'?'模型與銀行實際不符，保留差額；不為對數更改商戶分類':'理論與銀行現金獨立保存；逐筆實際回贈未獲證實'};
  reports.push(r);
  for(const [t,p] of model.results)if(t.cardId===m.cardId&&p.period===m.period){p.reconciliation_status=status;p.evidence_count=evidence.length;p.observed_cashback_total=observed;p.allocated_actual_cashback=null;}
 }
 return reports.sort((a,b)=>a.period.localeCompare(b.period)||a.cardId.localeCompare(b.cardId));
}
const api={VERSION,SOURCE,MERCHANT_RULES,normalizeMerchant,merchantRule,classify,calculate,reconcile};if(typeof module!=='undefined')module.exports=api;root.ChillRewards=api;
})(typeof globalThis!=='undefined'?globalThis:this);
