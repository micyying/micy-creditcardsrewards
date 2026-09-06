/* Mox cash plan: forecasts and evidence stay separate. No shared Chill cap. */
(function(root){
'use strict';
const VERSION='mox-v1-2026.09.06',SOURCE='https://mox.com/zh/faqs/faq-mox-card/';
const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const normalize=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/^\s*##\s*/,'').replace(/\s+/g,' ').trim();
const activity=t=>t.activity_date||t.transaction_date||t.date||'';
const settlement=t=>t.settlement_date||t.post_date||'';
const RULES=[
 {id:'initial-2-observed',effective_from:'2026-02-10',effective_to:'2026-04-11',rate:.02,confidence:'PENDING',source:'user_corrected_initial_2pct_and_statement_observations',date_basis:'activity',note:'首期2%已由你更正；此日期範圍為歷史情境，並非已確認迎新起止日'},
 {id:'ordinary-1-historical',effective_from:'2026-04-13',effective_to:'2026-08-31',rate:.01,confidence:'INFERRED',source:'user_rule_and_mid_april_statement_observations',date_basis:'activity',note:'按4月中旬後普通消費1%的歷史情境估算'},
 {id:'cashback-2026-september',effective_from:'2026-09-01',effective_to:null,rate:.01,plus_rate:.02,supermarket_rate:.03,confidence:'INFERRED',source:SOURCE,date_basis:'activity'}
];
function ordinary(t,config){
 const date=activity(t),start=config.welcome_start,end=config.welcome_end;
 if(start&&end&&start<=end&&date>=start&&date<=end)return {rate:.02,min:.02,max:.02,pending:false,id:'user-welcome-2',note:'使用你設定的迎新起止日：普通消費2%',source:'user_settings'};
 if(start&&end&&start<=end&&date>end&&date<'2026-09-01')return {rate:.01,min:.01,max:.01,pending:false,id:'user-post-welcome-1',note:'已超過你設定的迎新期：普通消費1%',source:'user_settings'};
 if(date>='2026-09-01'){
  if(config.plus_status==='no')return {rate:.01,min:.01,max:.01,pending:false,id:'ordinary-1',note:'你設定為非Mox+：普通消費1%',source:SOURCE};
  if(config.plus_status==='yes'&&config.plus_from&&date>=config.plus_from&&(!config.plus_to||date<=config.plus_to))return {rate:.02,min:.02,max:.02,pending:false,id:'plus-2',note:'在你設定的Mox+有效期內：普通消費2%',source:SOURCE};
  return {rate:.01,min:.01,max:.02,pending:true,id:'plus-unknown',note:'Mox+當日資格未確認：先顯示1%情境，另列2%可能值',source:SOURCE};
 }
 const rule=RULES.find(r=>date>=r.effective_from&&r.effective_to&&date<=r.effective_to);
 if(rule)return {rate:rule.rate,min:rule.rate===.02?.01:rule.rate,max:rule.rate,pending:rule.confidence==='PENDING',id:rule.id,note:rule.note,source:rule.source};
 return {rate:.01,min:.01,max:.02,pending:true,id:'welcome-boundary-unknown',note:'迎新適用日期未確認：保留1%／2%情境，不把三個月換算成90天',source:'unresolved_dates'};
}
function predict(t,config={}){
 const name=normalize(t.merchant||t.raw_description),date=activity(t),o=ordinary(t,config),notes=[o.note];
 const kind=t.kind||'tx',manual=t.mox_classification||'auto';
 const nonpurchase=!['tx','foreign_tx'].includes(kind)||t.document_type==='bank';
 const hardExcluded=nonpurchase||manual==='excluded'||/CASH ADVANCE|BALANCE TRANSFER|FINANCE CHARGE|ANNUAL FEE|INTEREST CHARGE/.test(name);
 const wallet=/OCTOPUS|\bOCL\*|TOP\s*UP|ALIPAY|WECHAT|支付寶|微信/.test(name);
 const unclear=/\bRENT\b|RENTAL|租金|IMMD|GOVERNMENT|TAX PAYMENT|INSURANCE|BILL PAYMENT/.test(name);
 const mcc=String(t.mcc||t.merchant_category_code||'');
 const convenience=/CIRCLE\s*K|7[ -]?ELEVEN|便利店/.test(name);
 const supermarket=manual==='supermarket'||manual==='auto'&&!convenience&&(mcc==='5411'||!mcc&&/SUPERMARKET|PARKN?SHOP|WELLCOME|MARKET PLACE|CITYSUPER|AEON STORES|百佳|惠康|一田|\bYATA\b/.test(name));
 let rate=o.rate,min=o.min,max=o.max,pending=o.pending,category='RETAIL',rule=o.id;
 if(supermarket){rate=.03;min=.03;max=.03;pending=false;category='SUPERMARKET';rule='supermarket-3';notes.push(mcc==='5411'?'MCC5411超市候選：3%':'超市名稱／手動分類候選：3%；最終以Mastercard分類為準');if(date<'2026-04-13'&&!(config.welcome_start&&config.welcome_end&&date>config.welcome_end)){pending=true;min=.02;notes.push('首期超市是否3%未確認，保留2%／3%情境');}}
 if(manual==='ordinary'){rate=o.rate;min=o.min;max=o.max;pending=o.pending;category='RETAIL';notes.push('你指定為一般合資格消費');}
 if(manual==='auto'&&(wallet||unclear)){
  category='ELIGIBILITY_UNKNOWN';pending=true;min=0;max=rate;
  if(wallet||/IMMD|GOVERNMENT|TAX PAYMENT|INSURANCE|BILL PAYMENT/.test(name))rate=0;
  notes.push('此類歷史交易資格未核實；不根據實收倒推合資格，另列0至一般比率的情境');
  if(date>='2026-09-01'&&wallet){rate=min=max=0;pending=false;category='EXCLUDED';notes.push('依現行規則，電子錢包／儲值增值不合資格');}
 }
 if(hardExcluded){rate=min=max=0;pending=false;category='EXCLUDED';rule='noneligible';notes.push('還款、轉賬、費用、迎新或非消費不計消費回贈');}
 if(config.reward_plan&&config.reward_plan!=='cashback'&&!hardExcluded){rate=min=max=0;pending=true;category='PLAN_UNKNOWN';notes.push('此模組只計CashBack；所選計劃並非現金，不套用現金率');}
 const hkd=Number(t.amount)||0,amount=(!t.currency||t.currency==='HKD')?Math.max(0,hkd):0;
 if(t.currency&&t.currency!=='HKD'){pending=true;notes.push('缺港幣結算金額，不以外幣數字當港幣');}
 const cash=round(amount*rate),confidence=pending?'PENDING':'INFERRED';
 notes.push('按原單港幣金額逐筆四捨五入至分作預測；不另加1.95%手續費。銀行取整及逐筆歸屬未獲證實');
 if(!settlement(t))notes.push('缺結算日期：暫以交易日歸類情境月份，不能當作已完成結算');
 return {engine:'mox',version:VERSION,source:SOURCE,rule_source:o.source,rule_id:rule,activity_date:date,settlement_date:settlement(t)||null,period:(settlement(t)||date).slice(0,7),reward_plan:config.reward_plan||'cashback',cashback_category:category,rate,bonus_rate:rate,bonus_hkd:cash,total_hkd:cash,base_points:0,base_hkd:0,scenario_cashback:cash,expected_cashback:pending?null:cash,expected_min:round(amount*min),expected_max:round(amount*max),confidence,evidence_count:0,observed_cashback_total:null,allocated_actual_cashback:null,reconciliation_status:'INSUFFICIENT_DATA',label:(pending?'情境預測 · ':'預計 · ')+(category==='SUPERMARKET'?'超市 ':category==='EXCLUDED'?'不合資格 ':category==='ELIGIBILITY_UNKNOWN'?'資格待核實 ':'普通消費 ')+(rate*100)+'%',notes};
}
function calculate(transactions,configs={},cardIds=['card-mox']){
 const results=new Map(),monthly=new Map();
 for(const t of transactions){if(t.demo||!cardIds.includes(t.cardId))continue;const p=predict(t,configs[t.cardId]||configs.default||{});results.set(t,p);const key=t.cardId+'|'+p.period;
 const m=monthly.get(key)||{cardId:t.cardId,period:p.period,scenario_cashback:0,expected_cashback:0,expected_min:0,expected_max:0,pending_count:0,transaction_count:0,missing_settlement_count:0};
 for(const k of ['scenario_cashback','expected_min','expected_max'])m[k]=round(m[k]+p[k]);if(p.expected_cashback==null)m.pending_count++;else m.expected_cashback=round(m.expected_cashback+p.expected_cashback);m.transaction_count++;if(!p.settlement_date)m.missing_settlement_count++;monthly.set(key,m);
 }
 for(const m of monthly.values()){m.known_expected_cashback=m.expected_cashback;if(m.pending_count)m.expected_cashback=null;}
 return {results,monthly:[...monthly.values()]};
}
function reconcile(model,evidence=[],coveredMonths=[]){
 const unique=new Map();for(const e of evidence)if(e.period&&Number.isFinite(e.amount)&&(!e.kind||e.kind==='rebate'))unique.set(e.source_id||JSON.stringify(e),e);
 const groups=new Map();for(const e of unique.values()){const key=e.cardId+'|'+e.period;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
 const months=new Map(model.monthly.map(m=>[m.cardId+'|'+m.period,{...m}]));
 for(const key of new Set([...groups.keys(),...coveredMonths]))if(!months.has(key)){const [cardId,period]=key.split('|');months.set(key,{cardId,period,scenario_cashback:0,expected_cashback:null,expected_min:0,expected_max:0,transaction_count:0,pending_count:0,missing_settlement_count:0});}
 const reports=[];
 for(const [key,m] of months){const es=groups.get(key)||[],observed=es.length?round(es.reduce((s,e)=>s+e.amount,0)):coveredMonths.includes(key)?0:null;
 const difference=observed==null?null:round(m.scenario_cashback-observed);
 const status=observed==null?'INSUFFICIENT_DATA':!m.transaction_count||m.pending_count||m.missing_settlement_count||difference!==0?'UNRESOLVED':'MATCHED_AGGREGATE';
 const report={...m,observed_cashback_total:observed,allocated_actual_cashback:null,difference,evidence_count:es.length,reconciliation_status:status,confidence:status==='MATCHED_AGGREGATE'?'INFERRED':'PENDING',explanation:'按結算曆月與銀行CashBack入賬月比較；日期延遲及未匯入消費可能造成差額。相同總額也不證明逐筆歸屬。'};reports.push(report);
 for(const [t,p] of model.results)if(t.cardId+'|'+p.period===key){p.observed_cashback_total=observed;p.evidence_count=es.length;p.reconciliation_status=status;}
 }
 // Same-day sums and nearby single rows are candidates only; never allocate observed money.
 const daily=new Map();for(const [t,p] of model.results)if(p.settlement_date){const key=t.cardId+'|'+p.settlement_date;const d=daily.get(key)||{cardId:t.cardId,date:p.settlement_date,scenario_cashback:0,transaction_ids:[]};d.scenario_cashback=round(d.scenario_cashback+p.scenario_cashback);d.transaction_ids.push(t.source_id||t.id);daily.set(key,d);}
 const candidates=[];for(const d of daily.values()){const same=[...unique.values()].filter(e=>e.cardId===d.cardId&&e.date===d.date);if(same.length){const actual=round(same.reduce((s,e)=>s+e.amount,0));candidates.push({...d,observed_cashback:actual,difference:round(d.scenario_cashback-actual),status:Math.abs(d.scenario_cashback-actual)<.01?'SAME_DAY_SUM_CANDIDATE':'UNRESOLVED',source_ids:same.map(e=>e.source_id),allocated_actual_cashback:null});}
 else for(const e of unique.values()){const days=(Date.parse(e.date)-Date.parse(d.date))/86400000;if(e.cardId===d.cardId&&days>0&&days<=3&&e.amount===d.scenario_cashback)candidates.push({...d,observed_cashback:e.amount,observed_date:e.date,status:'DELAYED_CANDIDATE',source_ids:[e.source_id],allocated_actual_cashback:null});}}
 return {monthly:reports.sort((a,b)=>a.period.localeCompare(b.period)||a.cardId.localeCompare(b.cardId)),candidates};
}
const api={VERSION,SOURCE,RULES,normalize,predict,calculate,reconcile};if(typeof module!=='undefined')module.exports=api;root.MoxRewards=api;
})(typeof globalThis!=='undefined'?globalThis:this);
