/* Prediction adapter: derived data only. Keep statement fields and bank-paid amounts untouched. */
function recalculatePredictions(data){
 const ids=(data.cards||[]).filter(c=>c.id==='card-boc-chill'||/chill/i.test(c.name||'')).map(c=>c.id);
 let changed=false;
 const migrateMarker=r=>{if(!r)return;const marker=r.transaction_marker||r.merchant_marker||(/^\s*##/.test(r.raw_description||r.merchant||'')?'##':null);if(r.transaction_marker!==marker||r.marker_meaning!=='UNKNOWN'||r.marker_confidence!=='PENDING'||Object.hasOwn(r,'merchant_marker')){r.transaction_marker=marker;r.marker_meaning='UNKNOWN';r.marker_confidence='PENDING';delete r.merchant_marker;changed=true;}};
 for(const r of [...(data.transactions||[]),...(data.credits||[])])migrateMarker(r);
 for(const st of data.statementImports||[])for(const r of [...(st.rows||[]),...(st.reviewed_rows||[])])migrateMarker(r);
 for(const r of data.rewardMonths||[])for(const row of r.source_rows||[])migrateMarker(row);
 if(!data.chillEvidence){data.chillEvidence=[];changed=true;}
 if(ids.includes('card-boc-chill')&&!data.chillEvidence.some(e=>e.source_id==='user-confirmed-chill-2026-07-cap')){data.chillEvidence.push({cardId:'card-boc-chill',period:'2026-07',amount:150,source_id:'user-confirmed-chill-2026-07-cap',source_type:'user_confirmation'});changed=true;}
 const observations=[],covered=new Set();
 for(const st of data.statementImports||[]){
  const rows=(st.reviewed_rows||st.rows||[]).filter(r=>ids.includes(r.cardId)&&r.kind==='rebate'&&r.cashback_period&&(!r.currency||r.currency==='HKD'));
  for(const r of rows){observations.push({cardId:r.cardId,period:r.cashback_period,amount:num(r.amount),source_id:r.source_id||st.fp+'|'+rows.indexOf(r),source_type:'statement'});covered.add(st.fp+'|'+r.cardId+'|'+r.cashback_period);}
 }
 for(const r of data.rewardMonths||[]){if(ids.includes(r.cardId)&&!r.reward_unit&&r.amount!=null&&!r.demo&&!covered.has(r.fp+'|'+r.cardId+'|'+r.month))observations.push({cardId:r.cardId,period:r.month,amount:num(r.amount),source_id:r.id||r.fp,source_type:r.fp?'statement':'manual_record'});}
 observations.push(...data.chillEvidence.filter(e=>ids.includes(e.cardId)));
 const model=ChillRewards.calculate(data.transactions||[],ids),reconciliation=ChillRewards.reconcile(model,observations);
 for(const [tx,p] of model.results){
  if(JSON.stringify(tx.prediction)!==JSON.stringify(p)||tx.expectedReward!==p.total_hkd){
   tx.prediction=p;tx.expectedReward=p.total_hkd;tx.expected_cashback=p.bonus_hkd;
   tx.expected_points=p.base_points;tx.expected_points_hkd=p.base_hkd;
   tx.chill_merchant=p.chill_merchant;tx.online_status=p.online_status;tx.cashback_category=p.cashback_category;
   tx.confidence=p.confidence;tx.evidence_count=p.evidence_count;tx.reconciliation_status=p.reconciliation_status;
   tx.observed_cashback_total=p.observed_cashback_total??null;tx.allocated_actual_cashback=null;
   tx.bonus=p.bonus_hkd;tx.ruleName=p.label;tx.ruleId=p.version;changed=true;
  }
 }
 if(JSON.stringify(data.chillPredictionMonths)!==JSON.stringify(model.monthly)){data.chillPredictionMonths=model.monthly;changed=true;}
 if(JSON.stringify(data.chillReconciliation)!==JSON.stringify(reconciliation)){data.chillReconciliation=reconciliation;changed=true;}
 return changed;
}
const prePredictionMigration=migrateData;
migrateData=function(){const changed=prePredictionMigration();return recalculatePredictions(S.data)||changed;};
const prePredictionMutate=mutate;
mutate=function(fn){return prePredictionMutate(dd=>{fn(dd);recalculatePredictions(dd);});};
// Render also covers demo removal and UI paths that mutate without the common helper.
const prePredictionRender=render;
render=function(keep){if(S.data&&recalculatePredictions(S.data))saveLocal();return prePredictionRender(keep);};
const prePredictionRecords=recordsHTML;
recordsHTML=function(){recalculatePredictions(S.data);return prePredictionRecords();};
const prePredictionAnalysis=analysisHTML;
analysisHTML=function(){recalculatePredictions(S.data);return prePredictionAnalysis();};
// Theory is not scaled to match observed rebates. The existing calibration remains available for other cards.
const prePredictionCredibility=credibilityFor;
credibilityFor=function(cardId){return cardId==='card-boc-chill'||/chill/i.test(cardById(cardId)?.name||'')?null:prePredictionCredibility(cardId);};
function predictionBreakdownHTML(p){
 return `<div class="panel"><b>理論回贈 ≈${fmtHKD(p.total_hkd)}</b><div class="kv"><span>預計額外現金</span><b>${fmtHKD(p.bonus_hkd)}</b></div><div class="kv"><span>預計基本積分 ${p.base_points} 分</span><b>≈${fmtHKD(p.base_hkd)}</b></div><p class="mini">${esc(p.label)} · 回贈計算月 ${esc(p.period)}</p><p class="mini">${p.notes.map(esc).join('<br>')}</p><p class="mini">250分≈HK$1；若選擇8／18／28日以220分兌換，同一批預計積分約值為 ${fmtHKD(p.base_points/220)}。現金預測保留小數，銀行整元入賬可能不同。</p></div>`;
}
const prePredictionTxSheet=txSheet;
txSheet=function(id,pref){
 recalculatePredictions(S.data);
 const t=S.data.transactions.find(t=>t.id===id),p=t?.prediction;
 if(!p)return prePredictionTxSheet(id,pref);
 const options=[['auto','自動推算'],['online','網上交易'],['offline','實體零售'],['chill','指定 Chill 商戶'],['excluded','不合資格／增值繳費']];
 return prePredictionTxSheet(id,pref)+predictionBreakdownHTML(p)+`<div class="field"><label class="f-lbl">調整這筆交易的預測分類（立即補算整月）</label><select data-change="prediction-channel" data-id="${esc(id)}">${options.map(([v,n])=>`<option value="${v}" ${(t.prediction_channel||'auto')===v?'selected':''}>${n}</option>`).join('')}</select></div>`;
};
ACTIONS['prediction-channel']=(d,t)=>{mutate(dd=>{const tx=dd.transactions.find(x=>x.id===d.id);if(tx)tx.prediction_channel=t.value;});openSheet(txSheet(d.id));};
ACTIONS['prediction-summary']=()=>{
 recalculatePredictions(S.data);
 const txs=txsOfMonth(UI.recMonth).filter(t=>t.prediction&&(UI.recCard==='all'||t.cardId===UI.recCard)&&(UI.recCat==='all'||t.category===UI.recCat));
 const cash=txs.reduce((s,t)=>s+t.prediction.bonus_hkd,0),base=txs.reduce((s,t)=>s+t.prediction.base_hkd,0);
 const periods=new Set(txs.map(t=>t.prediction.period));
 const months=(S.data.chillReconciliation||[]).filter(m=>periods.has(m.period)&&(UI.recCard==='all'||m.cardId===UI.recCard));
 openSheet(`<div class="s-head">${monthLabel(UI.recMonth)} · 理論回贈</div><div class="kv"><span>本分欄消費的預計現金</span><b>${fmtHKD(cash)}</b></div><div class="kv"><span>本分欄消費的預計積分約值</span><b>≈${fmtHKD(base)}</b></div><div class="kv"><b>預計合計</b><b>≈${fmtHKD(cash+base)}</b></div><p class="mini">月結單分欄保持不變。以下門檻、上限與銀行 CASH REBATE 對比，則依交易日的曆月計算，會包含相鄰月結單內的交易。</p>${months.map(m=>{const observed=m.observed_cashback_total;return `<section class="panel"><b>${esc(m.period)} · 回贈計算月 · ${esc(m.reconciliation_status)}</b><p class="mini">${esc(m.explanation)}<br>證據來源：${esc(m.evidence_sources.join('、')||'未取得')}<br>封頂前理論現金 ${fmtHKD(m.raw_bonus_hkd)}<br>已匯入實體零售 ${fmtHKD(m.physical_spend)}／門檻HK$1,500<br>額外現金預計 ${fmtHKD(m.bonus_hkd)}（若按月四捨五入：${fmtHKD(m.rounded_bonus_hkd)}；實際整元方法仍待歷史驗證）<br>${observed!=null?'銀行已入賬現金 '+fmtHKD(observed)+' · 差額 '+fmtHKD(m.bonus_hkd-observed):'尚未取得該月銀行現金回贈'}<br>每曆月額外現金共用HK$150上限；補入相鄰月結單後會重新計算。</p></section>`;}).join('')}<p class="mini">分類按商戶及渠道推算，##不等於優惠資格。2026以外資料沿用v2規則作情境估算。<a href="https://www.bochk.com/dam/boccreditcard/chillcard/chill_offer_tnc_tc.pdf" target="_blank" rel="noopener">查看規則來源</a></p>`);
};
// The reward tab has no category selector; retain the filter when that control is absent.
ACTIONS['rec-filter']=()=>{UI.recCard=$('f-card').value;UI.recCat=$('f-cat')?.value||'all';render(true);};
