/* Extend the existing app; do not calibrate theory to observed Mox deposits. */
const isMoxCard=id=>id==='card-mox'||/mox/i.test(cardById(id)?.name||'');
function moxEvidence(data,ids){
 const rows=[],covered=new Set(),complete=[];
 for(const st of data.statementImports||[]){
  const mine=st.reviewed_rows||st.rows||[];
  for(const r of mine)if(ids.includes(r.cardId)&&['rebate','cashback_reversal'].includes(r.kind)&&(!r.currency||r.currency==='HKD')){
   const date=r.settlement_date||r.post_date||r.date,period=r.cashback_period||String(date||'').slice(0,7);
   rows.push({cardId:r.cardId,date,period,amount:num(r.amount)*(r.kind==='cashback_reversal'?-1:1),source_id:r.source_id||st.fp+'|'+mine.indexOf(r),kind:'rebate'});covered.add(st.fp+'|'+r.cardId+'|'+period);
  }
  if(st.meta?.bank==='mox'&&st.meta?.document_type==='bank'&&(st.checks||[]).some(c=>c.label==='CashBack 明細'&&c.ok))for(const id of ids)if(mine.some(r=>r.cardId===id))complete.push(id+'|'+st.meta.statement_month);
 }
 for(const r of data.rewardMonths||[])if(ids.includes(r.cardId)&&!r.reward_unit&&!r.demo&&!covered.has(r.fp+'|'+r.cardId+'|'+r.month)){
  if(r.source_rows?.length)for(const e of r.source_rows){if(e.kind!=='rebate')continue;rows.push({cardId:r.cardId,date:e.settlement_date||e.post_date||e.date,period:e.cashback_period||r.month,amount:num(e.amount),source_id:e.source_id||r.id+'|'+r.source_rows.indexOf(e),kind:'rebate'});}
  else rows.push({cardId:r.cardId,date:null,period:r.month,amount:num(r.amount),source_id:r.id||r.fp,kind:'rebate'});
 }
 return {rows,complete};
}
const preMoxRecalculate=recalculatePredictions;
recalculatePredictions=function(data){
 let changed=migrateAccountRecords(data);
 changed=preMoxRecalculate(data)||changed;
 const ids=(data.cards||[]).filter(c=>c.id==='card-mox'||/mox/i.test(c.name||'')).map(c=>c.id);
 if(!ids.length)return changed;
 data.settings=data.settings||{};data.settings.moxRules=data.settings.moxRules||{};
 for(const id of ids)if(!data.settings.moxRules[id]){data.settings.moxRules[id]={reward_plan:'cashback',plus_status:'no',plus_status_source:'user_confirmation_2026-09-06',welcome_start:null,welcome_end:null};changed=true;}
 const statements=new Map((data.statementImports||[]).map(s=>[s.fp,s]));
 for(const t of [...(data.transactions||[]),...(data.credits||[])])if(ids.includes(t.cardId)){
  const meta=statements.get(t.fp)?.meta;
  const fields={activity_date:t.transaction_date||t.date||null,settlement_date:t.post_date||null,statement_period:meta?.period_start?{start:meta.period_start,end:meta.period_end}:t.statement_period||null};
  for(const [k,v] of Object.entries(fields))if(JSON.stringify(t[k])!==JSON.stringify(v)){t[k]=v;changed=true;}
 }
 const model=MoxRewards.calculate(data.transactions||[],data.settings?.moxRules||{},ids),e=moxEvidence(data,ids),reports=MoxRewards.reconcile(model,e.rows,e.complete);
 for(const [t,p] of model.results){
  const values={prediction:p,expectedReward:p.scenario_cashback,expected_cashback:p.expected_cashback,scenario_cashback:p.scenario_cashback,expected_points:0,expected_points_hkd:0,confidence:p.confidence,evidence_count:p.evidence_count,reconciliation_status:p.reconciliation_status,observed_cashback_total:p.observed_cashback_total,allocated_actual_cashback:null,bonus:p.scenario_cashback,ruleId:p.rule_id,ruleName:p.label};
  for(const [k,v] of Object.entries(values))if(JSON.stringify(t[k])!==JSON.stringify(v)){t[k]=v;changed=true;}
 }
 for(const [k,v] of Object.entries({moxPredictionMonths:model.monthly,moxReconciliation:reports.monthly,moxReconciliationCandidates:reports.candidates}))if(JSON.stringify(data[k])!==JSON.stringify(v)){data[k]=v;changed=true;}
 return changed;
};
const preMoxCredibility=credibilityFor;
credibilityFor=function(id){return isMoxCard(id)?null:preMoxCredibility(id);};
const preMoxEval=evalCardFor;
evalCardFor=function(card,ctx){
 if(!isMoxCard(card.id))return preMoxEval(card,ctx);
 const p=MoxRewards.predict({...ctx,cardId:card.id,merchant:ctx.merchant||ctx.desc||'',kind:'tx',mox_classification:ctx.category==='grocery'?'supermarket':'auto'},S.data.settings?.moxRules?.[card.id]||{reward_plan:'cashback',plus_status:'no'});
 return {card,base:p.scenario_cashback,bonus:0,reward:p.scenario_cashback,ruleId:p.rule_id,ruleName:p.label,rate:p.rate,capLeft:Infinity,capped:false,reason:p.label+' · '+p.notes[0],prediction:p};
};
function predictionRowHTML(t){
 const p=t.prediction;if(!p)return '';
 if(p.engine==='mox')return `<small class="amt-dim">現金 ${fmtHKD(p.scenario_cashback)}${p.confidence==='PENDING'?'<br>情境範圍 '+fmtHKD(p.expected_min)+'–'+fmtHKD(p.expected_max):''}</small>`;
 return `<small class="amt-dim">現金 ${fmtHKD(p.bonus_hkd)}<br>積分 ${p.base_points}分 ≈${fmtHKD(p.base_hkd)}${t.actualReward!=null?'<br>實際 '+fmtHKD(t.actualReward):''}</small>`;
}
function moxMonthHTML(m){
 return `<section class="panel"><b>${esc(m.period)} · Mox 結算曆月</b><p class="mini">${esc(m.reconciliation_status)} · ${esc(m.explanation)}</p><div class="kv"><span>消費現金情境預測</span><b>${fmtHKD(m.scenario_cashback)}</b></div>${m.pending_count?`<p class="mini">${m.pending_count}筆資格／日期待確認；情境範圍 ${fmtHKD(m.expected_min)}–${fmtHKD(m.expected_max)}</p>`:''}<div class="kv"><span>銀行 CashBack（不含迎新）</span><b>${m.observed_cashback_total==null?'未取得':fmtHKD(m.observed_cashback_total)}</b></div>${m.difference!=null?`<div class="kv"><span>情境−銀行實際</span><b>${fmtHKD(m.difference)}</b></div>`:''}<p class="mini">${m.evidence_count}筆入賬證據；逐筆實際回贈不強行分攤。</p></section>`;
}
function moxSummaryPanels(txs){
 const keys=new Set(txs.filter(t=>t.prediction?.engine==='mox').map(t=>t.cardId+'|'+t.prediction.period));
 return (S.data.moxReconciliation||[]).filter(m=>keys.has(m.cardId+'|'+m.period)).map(moxMonthHTML).join('');
}
const preMoxTxSheet=txSheet;
txSheet=function(id,pref){
 const html=preMoxTxSheet(id,pref),t=S.data.transactions.find(t=>t.id===id),p=t?.prediction;
 if(p?.engine!=='mox')return html;
 return html+`<section class="panel"><b>Mox 現金回贈預測 ${fmtHKD(p.scenario_cashback)}</b><p class="mini">${esc(p.label)} · ${esc(p.confidence)}<br>交易日 ${esc(p.activity_date)} · 結算日 ${esc(p.settlement_date||'未列')}<br>情境範圍 ${fmtHKD(p.expected_min)}–${fmtHKD(p.expected_max)}</p><p class="mini">${p.notes.map(esc).join('<br>')}</p><p class="mini">${esc(p.reconciliation_status)}；${p.evidence_count}筆月度入賬證據。逐筆銀行實際未分配。</p></section><div class="field"><label class="f-lbl">Mox 交易資格（只影響預測）</label><select data-change="mox-classification" data-id="${esc(id)}">${[['auto','按商戶候選推算'],['ordinary','一般合資格消費'],['supermarket','超市／雜貨店'],['excluded','不合資格']].map(([v,n])=>`<option value="${v}" ${(t.mox_classification||'auto')===v?'selected':''}>${n}</option>`).join('')}</select></div><button class="btn btn-ghost btn-block" data-action="mox-settings" data-id="${esc(t.cardId)}">Mox 迎新／Mox+ 設定</button>`;
};
ACTIONS['mox-classification']=(d,t)=>{mutate(dd=>{const row=dd.transactions.find(x=>x.id===d.id);if(row)row.mox_classification=t.value;});openSheet(txSheet(d.id));};
ACTIONS['mox-reconciliation']=()=>{
 recalculatePredictions(S.data);
 const ids=S.data.cards.filter(c=>isMoxCard(c.id)&&(UI.recCard==='all'||c.id===UI.recCard)).map(c=>c.id);
 const months=(S.data.moxReconciliation||[]).filter(m=>ids.includes(m.cardId));
 const welcomes=(S.data.credits||[]).filter(t=>ids.includes(t.cardId)&&t.kind==='welcome_reward'&&!t.demo);
 const candidates=(S.data.moxReconciliationCandidates||[]).filter(m=>ids.includes(m.cardId));
 openSheet(ledgerNavigationHTML('mox')+`<div class="s-head">原始帳本 · Mox CashBack 對帳</div><p class="s-sub">消費按信用卡月結周期分欄；現金按銀行結算／入賬曆月核對。</p>${months.map(moxMonthHTML).join('')||'<p>尚未匯入Mox資料</p>'}<section class="panel"><b>迎新獎賞（獨立）</b>${welcomes.map(t=>`<div class="kv"><span>${esc(t.date)} · ${esc(t.merchant)}</span><b>${fmtHKD(t.amount)}</b></div>`).join('')||'<p class="mini">未取得迎新入賬紀錄</p>'}</section><details class="panel"><summary>日期／金額候選配對（${candidates.length}組）</summary><p class="mini">同日合計或延遲1–3日的金額候選，可能重疊；不等同銀行逐筆確認，不分配實際回贈。</p>${candidates.map(c=>`<p class="mini">${esc(c.date)}${c.observed_date?' → '+esc(c.observed_date):''} · ${c.transaction_ids.length}筆 · 預測${fmtHKD(c.scenario_cashback)}／實收${fmtHKD(c.observed_cashback)} · ${esc(c.status)}</p>`).join('')}</details>${ids.map(id=>`<button class="btn btn-ghost btn-block" data-action="mox-settings" data-id="${esc(id)}">${esc(cardById(id)?.name)} · 規則設定</button>`).join('')}`);
};
ACTIONS['mox-settings']=d=>{
 const id=d.id||S.data.cards.find(c=>isMoxCard(c.id))?.id;if(!id)return;const c=S.data.settings?.moxRules?.[id]||{};
 openSheet(`<div class="s-head">Mox 現金回贈規則</div><p class="s-sub">首期普通消費2%；迎新日期未設定時採用歷史情境。超市候選3%，其後普通1%。9月起Mox+分支按你設定的有效期生效。</p><div class="frow"><div class="field"><label class="f-lbl">已確認迎新開始（可留空）</label><input type="date" id="mox-welcome-start" value="${esc(c.welcome_start||'')}"></div><div class="field"><label class="f-lbl">已確認迎新最後一天（可留空）</label><input type="date" id="mox-welcome-end" value="${esc(c.welcome_end||'')}"></div></div><div class="field"><label class="f-lbl">2026-09-01起 Mox+ 狀態</label><select id="mox-plus-status">${[['unknown','未確認：1%／2%情境'],['no','沒有 Mox+'],['yes','有 Mox+（填有效期）']].map(([v,n])=>`<option value="${v}" ${(c.plus_status||'unknown')===v?'selected':''}>${n}</option>`).join('')}</select></div><div class="frow"><div class="field"><label class="f-lbl">Mox+ 生效日</label><input type="date" id="mox-plus-from" value="${esc(c.plus_from||'')}"></div><div class="field"><label class="f-lbl">Mox+ 最後一天（仍有效可留空）</label><input type="date" id="mox-plus-to" value="${esc(c.plus_to||'')}"></div></div><p class="mini">不會修改原始消費或银行實收；目前只計算你選擇的CashBack計劃。</p><button class="btn btn-primary btn-block" data-action="mox-settings-save" data-id="${esc(id)}">儲存並重算</button>`);
};
ACTIONS['mox-settings-save']=d=>{
 const c={reward_plan:'cashback',welcome_start:$('mox-welcome-start').value||null,welcome_end:$('mox-welcome-end').value||null,plus_status:$('mox-plus-status').value,plus_from:$('mox-plus-from').value||null,plus_to:$('mox-plus-to').value||null};
 if(!!c.welcome_start!==!!c.welcome_end||c.welcome_start&&c.welcome_start>c.welcome_end||c.plus_status==='yes'&&!c.plus_from||c.plus_from&&c.plus_to&&c.plus_from>c.plus_to){toast('請填完整有效的日期範圍；有Mox+需填生效日。','err');return;}
 mutate(dd=>{dd.settings.moxRules=dd.settings.moxRules||{};dd.settings.moxRules[d.id]=c;});ACTIONS['mox-settings'](d);toast('Mox預測已重新計算','ok');
};
const preMoxSettings=settingsHTML;
settingsHTML=function(){return preMoxSettings()+S.data.cards.filter(c=>isMoxCard(c.id)).map(c=>`<section class="panel"><button class="btn btn-ghost btn-block" data-action="mox-settings" data-id="${esc(c.id)}">Mox 現金回贈規則</button></section>`).join('');};
