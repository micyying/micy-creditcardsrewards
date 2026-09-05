/* Runs inside the original app's script scope, before boot. */
Object.assign(KINDS,{
 reward_offset:{n:'獎賞兌換',bg:'#7155A5'},odd_cent:{n:'零數結轉',bg:'#667085'},fee:{n:'費用',bg:'#AD4337'},fee_refund:{n:'費用退回',bg:'#367763'},welcome_reward:{n:'迎新獎賞',bg:'#7155A5'},transfer:{n:'銀行轉賬',bg:'#667085'},foreign_tx:{n:'外幣消費',bg:'#45739A'},cashback_reversal:{n:'回贈扣回',bg:'#AD4337'},unknown:{n:'待核實',bg:'#667085'}
});
const parserMoney=r=>(r.currency==='CNY'?'CN¥':r.currency==='USD'?'US$':'HK$')+num(r.amount).toLocaleString('en-HK',{minimumFractionDigits:2,maximumFractionDigits:2});
const unitNames={aeon_points:'Purple 積分',waku_coin:'WAKU COIN',asia_miles:'亞洲萬里通里數',gift_points:'Gift Points'};
const rewardUnitValue=(unit,quantity)=>unit==='waku_coin'?num(quantity):unit==='asia_miles'?r2(num(quantity)*MILE_HKD):r2(num(quantity)*PT_HKD);
// 新版匯入用來源 ID 去重；同時把已匯入的 v2.14.0 賬項遷移到月結周期，恢復原始商戶全名。
migrateData=function(){
 let changed=false;
 const statements=new Map((S.data.statementImports||[]).map(s=>[s.fp,s]));
 for(const st of statements.values()){
  const target=st.meta?.period_start?.slice(0,7)||st.meta?.statement_month||st.meta?.record_month;
  if(target&&st.meta.record_month!==target){st.meta.record_month=target;changed=true;}
 }
 for(const r of [...(S.data.transactions||[]),...(S.data.credits||[])]){
  if(!r.statement_month&&!r.fp)continue;
  const st=statements.get(r.fp),target=st?.meta?.record_month||r.statement_month||r.record_month;
  if(target&&r.record_month!==target){r.record_month=target;changed=true;}
  if(r.raw_description&&r.merchant!==r.raw_description){r.merchant=r.raw_description;changed=true;}
  if(/^2\.14\.[01]/.test(r.parser_version||'')){r.parser_version='2.14.2-migrated';changed=true;}
 }
 /* v2.14.1 已讀到 Chill 的 Gift Points Adjustment，但因 earned 為空而沒有寫入實際回贈。 */
 for(const st of statements.values())for(const reward of st.rewards||[]){
  const quantity=reward.earned!=null?num(reward.earned):num(reward.adjustment);
  if(!quantity||!reward.unit)continue;
  const cardId=reward.cardId||st.rows?.find(r=>r.cardId)?.cardId;
  if(!cardId)continue;
  let rm=(S.data.rewardMonths||[]).find(r=>r.fp===st.fp&&r.reward_unit===reward.unit);
  const value=reward.valuation_hkd!=null?num(reward.valuation_hkd):rewardUnitValue(reward.unit,quantity);
  if(!rm){S.data.rewardMonths.push({id:uid(),fp:st.fp,cardId,month:st.meta?.statement_month||st.meta?.record_month,amount:0,reward_unit:reward.unit,earned:quantity,adjustment:reward.adjustment,valuation_hkd:value,parser_version:'2.14.2-migrated',note:'結單獎賞 · 與現金分開',sid:st.sid});changed=true;}
  else if(rm.valuation_hkd==null){rm.valuation_hkd=value;changed=true;}
 }
 return changed;
};
txsOfMonth=function(m){return S.data.transactions.filter(t=>(t.record_month||t.date.slice(0,7))===m);};
pageText=StatementParser.layoutText;
buildRows=function(text){
 const parsed=StatementParser.parse(text,{legacyHSBC:parseHSBC});
 IMPPDF.parsed=IMPPDF.parsed||{};IMPPDF.parsed[parsed.fp]=parsed;
 for(const r of parsed.rows){
  r.category=guessCategory(r.raw_description||r.merchant);r.category_confidence='INFERRED';
  // A merchant guess and ## are not bank confirmation of online eligibility.
  r.online=guessOnline(r.raw_description||r.merchant)?true:null;
  if(!r.cardId&&parsed.meta.bank==='hsbc')r.cardId=guessCard(text)||IMPPDF.cardId;
 }
 return parsed.rows.map(r=>({...r}));
};
const oldOpenPdf=ACTIONS['pdft-open'];
ACTIONS['pdft-open']=()=>{IMPPDF.parsed={};IMPPDF.importWarnings=[];oldOpenPdf();};
pdfsToTexts=async function(files){
 const base=(document.querySelector('script[src*="pdf.min.js"]')||{}).src||'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
 pdfjsLib.GlobalWorkerOptions.workerSrc=base.replace('pdf.min.js','pdf.worker.min.js');
 const out=[];
 for(const f of Array.from(files)){
  toast('正在讀取 '+f.name+'…');const arr=await f.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:arr.slice(0),isEvalSupported:false}).promise;
  try{const pages=[];for(let n=1;n<=pdf.numPages;n++){const pg=await pdf.getPage(n);pages.push(pageText((await pg.getTextContent()).items));}out.push({text:pages.join('\n\f\n'),name:f.name,buf:arr,numPages:pdf.numPages});}finally{await pdf.destroy();}
 }
 return out;
};
ACTIONS['pdft-file']=async(d,t)=>{
 const files=Array.from(t.files||[]);if(!files.length)return;
 if(typeof pdfjsLib==='undefined'){toast('PDF 解析器未載入，請檢查網絡後重試','err');return;}
 IMPPDF.rows=[];IMPPDF.stmts=[];IMPPDF.pdfs=[];IMPPDF.parsed={};IMPPDF.importWarnings=[];
 const lib=await pdfAll();
 for(const file of files){
  try{
   const [f]=await pdfsToTexts([file]);const rows=buildRows(f.text),parsed=Object.values(IMPPDF.parsed).at(-1);
   if(!rows.length){IMPPDF.importWarnings.push(f.name+'：'+(parsed?.warnings.join('；')||'未找到交易'));continue;}
   const fp=rows[0].fp;if(IMPPDF.stmts.some(s=>s.fp===fp)){IMPPDF.importWarnings.push(f.name+'：本次已選取相同結單，略過重複檔案');continue;}
   const sid=lib.find(s=>s.fp===fp)?.sid||uid();rows.forEach(r=>{r.sid=sid;});
   IMPPDF.stmts.push({fp,name:f.name,text:f.text});IMPPDF.pdfs.push({sid,name:f.name,buf:f.buf,fp});IMPPDF.rows.push(...rows);
  }catch(e){IMPPDF.importWarnings.push(file.name+'：'+(e.message||e));}
 }
 openSheet(pdfImportSheet(IMPPDF.rows.length?2:1));
};
aiStmtMonth=()=>parsedReports()[0]?.meta.statement_month||'';
const oldRaw=ACTIONS['pdft-raw-go'];
ACTIONS['pdft-raw-go']=()=>{IMPPDF.pdfs=[];IMPPDF.parsed={};IMPPDF.importWarnings=[];oldRaw();};
function parsedReports(){return (IMPPDF.stmts||[]).map(s=>({name:s.name,...IMPPDF.parsed?.[s.fp]})).filter(s=>s.meta);}
function reportHTML(report){
 const checks=report.checks||[],warnings=report.warnings||[];
 return `<div class="panel" style="margin:8px 0"><b>${esc(report.name||report.meta?.statement_month||'結單')}</b>
 <p class="mini">${checks.length?checks.map(c=>`${esc(c.currency)} ${esc(c.label||'賬面')}：${c.ok?'明細與摘要相符':'存在差額，請核對'}`).join('；'):'未完成整份結單賬面核對'}。賬面吻合不代表回贈已給足。</p>
 ${warnings.length?'<p class="mini" style="color:var(--bad)">'+warnings.map(esc).join('<br>')+'</p>':''}
 ${(report.rewards||[]).map(r=>`<p class="mini">${esc(unitNames[r.unit]||r.unit)}：${r.earned==null?'調整 '+num(r.adjustment):'本期賺取 '+r.earned}${r.redeemed!=null?' · 兌換 '+r.redeemed+' · 結餘 '+r.balance:''}${r.valuation_hkd!=null?' · 新賺估值 '+fmtHKD(r.valuation_hkd):''}</p>`).join('')}</div>`;
}
const originalImportSheet=pdfImportSheet;
pdfImportSheet=function(step){
 let html=originalImportSheet(step);
 const notes=(IMPPDF.importWarnings||[]).length?'<div class="panel" style="color:var(--bad)">'+IMPPDF.importWarnings.map(esc).join('<br>')+'</div>':'';
 if(step===1)return notes+html.replace('支援中銀（BOC）與渣打。','支援中銀、AEON、國泰、Mox 信用卡及 Mox 銀行回贈結單。');
 return notes+html.replace('<div class="s-head">確認月結單交易</div>','<div class="s-head">確認月結單交易</div>'+parsedReports().map(reportHTML).join('')+'<p class="mini">原始日期、CR、幣種與來源另存於「結單賬本」。人民幣獨立顯示；費用、兌換和迎新不會加入消費回贈。下方分類只是候選，历史應得回贈待核實。</p>');
};
// Only the original AEON gross-vs-net banner is suppressed; audited parser checks appear above.
aeonVerifyLive=()=>[];
ACTIONS['pdft-save']=async()=>{
 if(!IMPPDF.rows.length)return;
 if(IMPPDF.rows.some(r=>!r.cardId||!S.data.cards.some(c=>c.id===r.cardId))){toast('有賬項未確認卡片，請先選擇正確卡片。','err');return;}
 for(const r of IMPPDF.rows){if(!r.source_id){r.source_id='review:'+uid();r.parser_version='manual-review';r.currency=r.currency||'HKD';r.provenance='review_addition';if(!r.fp&&IMPPDF.stmts?.length===1)r.fp=IMPPDF.stmts[0].fp;}}
 const before=JSON.parse(JSON.stringify(S.data));
 try{
  for(const p of IMPPDF.pdfs||[])await pdfPut(p.sid,{name:p.name,data:p.buf,fp:p.fp,importedAt:Date.now(),size:p.buf.byteLength});
  const dd=JSON.parse(JSON.stringify(S.data));
  dd.statementImports=dd.statementImports||[];dd.statementRewards=dd.statementRewards||[];
  let added=0,duplicates=0;
  const sourceIds=new Set([...dd.transactions,...dd.credits].map(x=>x.source_id).filter(Boolean));
  for(const r of IMPPDF.rows){
   if(r.kind==='rebate')continue;
   if(sourceIds.has(r.source_id)){duplicates++;continue;}
   const copy={...r,id:uid(),note:'月結單 v2.14.0',category:r.category||'other',actualReward:null,actualDate:null,expectedReward:null,bonus:0,ruleId:null,ruleName:'歷史資格待核實'};
   if(r.kind==='tx'&&(!r.currency||r.currency==='HKD'))dd.transactions.push(copy);
   else dd.credits.push({...copy,kind:r.kind==='tx'?'foreign_tx':r.kind});
   sourceIds.add(r.source_id);added++;
  }
  for(const report of parsedReports()){
   const mine=IMPPDF.rows.filter(r=>r.fp===report.fp);
   dd.statementImports=dd.statementImports.filter(x=>x.fp!==report.fp);
   dd.statementImports.push({fp:report.fp,name:report.name,meta:report.meta,rows:report.rows.map(r=>({...r})),reviewed_rows:mine.map(r=>({...r})),rewards:report.rewards,checks:report.checks,warnings:report.warnings,sid:mine[0]?.sid||null});
   dd.statementRewards=dd.statementRewards.filter(x=>x.fp!==report.fp);
   dd.statementRewards.push(...report.rewards.map(r=>({...r,fp:report.fp})));
   // Cash only. Miles/points/coins stay in the reward ledger with their original units.
   dd.rewardMonths=dd.rewardMonths.filter(x=>x.fp!==report.fp);
   const groups=new Map();
   for(const r of mine.filter(r=>r.kind==='rebate'&&r.currency==='HKD')){
    const month=r.cashback_period||(r.post_date||r.date).slice(0,7),key=r.cardId+'|'+month;
    const g=groups.get(key)||{id:uid(),fp:report.fp,cardId:r.cardId,month,amount:0,note:r.cashback_period?'結單現金回贈':'結單現金回贈 · 消費月份未明（按入賬月顯示）',sid:r.sid,source_rows:[]};
    g.amount=r2(g.amount+r.amount);g.source_rows.push({...r});groups.set(key,g);
   }
   dd.rewardMonths.push(...groups.values());
   for(const r of report.rewards){const quantity=r.earned!=null?num(r.earned):num(r.adjustment);if(!quantity)continue;
    dd.rewardMonths.push({id:uid(),fp:report.fp,cardId:r.cardId,month:report.meta.statement_month||report.meta.record_month,amount:0,reward_unit:r.unit,earned:quantity,adjustment:r.adjustment,valuation_hkd:r.valuation_hkd!=null?r.valuation_hkd:rewardUnitValue(r.unit,quantity),parser_version:'2.14.2',note:'結單獎賞 · 與現金分開',sid:mine[0]?.sid});
   }
  }
  dd.meta={...dd.meta,rev:(dd.meta?.rev||0)+1,savedAt:Date.now()};
  // A failed storage write must not report successful import or discard the review.
  localStorage.setItem(LS_DATA,JSON.stringify(dd));S.data=dd;schedulePush();
  closeSheet();IMPPDF.rows=[];IMPPDF.stmts=[];IMPPDF.pdfs=[];IMPPDF.parsed={};IMPPDF.chat=null;
  UI.screen='records';render();toast('已保存 '+added+' 筆賬項，略過 '+duplicates+' 筆已匯入賬項；獎賞與原始來源可在結單賬本查看。','ok');
 }catch(e){S.data=before;toast('未能保存帳本：'+(e.message||e)+'；確認頁仍保留，請重試。','err');}
};
function statementLedgerHTML(){
 const list=(S.data.statementImports||[]).slice().sort((a,b)=>(b.meta.statement_month||'').localeCompare(a.meta.statement_month||''));
 return `<div class="s-head">結單賬本 · v2.14.2</div><p class="s-sub">原始提取與候選分類分開。金額依原幣種顯示，CR 為入賬。國泰里數、AEON 積分和 COIN 以原單位保存，再折算港幣顯示。</p>`+
 list.map(st=>`<details class="panel"><summary>${esc(st.name)} · ${st.rows.length} 筆</summary>${reportHTML(st)}
 <div style="overflow-x:auto"><table style="min-width:850px;width:100%;font-size:14px;text-align:left"><thead><tr><th>交易日</th><th>記賬／結算日</th><th>原始描述</th><th>金額</th><th>類型</th><th>來源頁</th></tr></thead><tbody>${st.rows.map(r=>`<tr style="color:${r.credit_debit_indicator==='CR'?'#168253':'inherit'}"><td>${esc(r.transaction_date||'未列')}</td><td>${esc(r.post_date||'未列')}</td><td>${esc(r.raw_description||r.merchant)}</td><td style="white-space:nowrap">${parserMoney(r)} ${r.credit_debit_indicator==='CR'?'CR':''}</td><td>${esc(KINDS[r.kind]?.n||r.transaction_type)}</td><td>${r.source_page||'—'}</td></tr>`).join('')}</tbody></table></div>
 ${st.sid?`<button class="btn btn-ghost" data-action="pdf-lib-open" data-sid="${st.sid}">查看原 PDF</button>`:''}</details>`).join('')+
 (!list.length?'<p>尚未匯入新版結單。</p>':'')+'<button class="btn btn-ghost" data-action="sheet-close">關閉</button>';
}
ACTIONS['statement-ledger']=()=>openSheet(statementLedgerHTML());
const originalRmEdit=ACTIONS['rm-edit'];
ACTIONS['rm-edit']=d=>S.data.rewardMonths.find(r=>r.id===d.id)?.reward_unit?ACTIONS['statement-ledger']():originalRmEdit(d);
const originalRecordsHTML=recordsHTML;
recordsHTML=function(){let html=originalRecordsHTML();const cny=(S.data.credits||[]).filter(r=>r.kind==='foreign_tx'&&r.currency==='CNY'&&(r.record_month||r.date?.slice(0,7))===UI.recMonth&&(UI.recCard==='all'||r.cardId===UI.recCard));
 return `<section class="panel"><button class="btn btn-ghost btn-block" data-action="statement-ledger">結單賬本 · 原始帳項／積分／里數</button>${cny.length?'<p class="mini">本月人民幣消費 '+cny.length+' 筆：CN¥'+r2(cny.reduce((s,r)=>s+r.amount,0))+'，與港幣總消費分開。</p>':''}</section>`+html;};
const originalRmTotal=rmTotal;
rmTotal=function(rm){return rm.reward_unit?num(rm.valuation_hkd):originalRmTotal(rm);};
function actualRewardDetailHTML(){
 const month=UI.recMonth,cardId=UI.recCard;
 const rows=(S.data.rewardMonths||[]).filter(r=>!r.demo&&r.month===month&&(cardId==='all'||r.cardId===cardId));
 const manual=txsOfMonth(month).filter(t=>(cardId==='all'||t.cardId===cardId)&&t.actualReward>0);
 let total=rows.reduce((s,r)=>s+rmTotal(r),0)+manual.reduce((s,t)=>s+num(t.actualReward),0);
 const line=r=>{const card=cardById(r.cardId),value=rmTotal(r);let quantity='現金回贈 '+fmtHKD(r.amount||0);
  if(r.reward_unit==='gift_points')quantity=num(r.earned).toLocaleString('en-HK')+' Gift Points（250分≈HK$1；每月8、18、28日兌換可按220分≈HK$1）';
  if(r.reward_unit==='aeon_points')quantity=num(r.earned).toLocaleString('en-HK')+' Purple 積分（25,000分≈HK$100消費券）';
  if(r.reward_unit==='waku_coin')quantity=num(r.earned).toLocaleString('en-HK')+' WAKU COIN（1 COIN=HK$1）';
  if(r.reward_unit==='asia_miles')quantity=num(r.earned).toLocaleString('en-HK')+' 亞洲萬里通里數';
  return `<div class="kv"><div><b>${esc(card?.name||'已刪卡片')}</b><br><span class="mini">${esc(quantity)}${r.note?' · '+esc(r.note):''}</span></div><b>≈${fmtHKD(value)}</b></div>`;};
 return `<div class="s-head">${monthLabel(month)} · 實際回贈明細</div><p class="s-sub">月結單中的現金、積分、WAKU COIN 及里數分開保存；外面的數字是各項約值合計。</p>${rows.map(line).join('')}${manual.map(t=>`<div class="kv"><span>${esc(t.merchant)} · 逐筆實際回贈</span><b>${fmtHKD(t.actualReward)}</b></div>`).join('')||''}${rows.length||manual.length?'':'<div class="empty">這個月份未有實際回贈記錄</div>'}<div class="divider"></div><div class="kv"><b>折合港幣合計</b><b>≈${fmtHKD(total)}</b></div><button class="btn btn-primary btn-block" data-action="rm-add">新增／補充實際回贈</button>`;
}
ACTIONS['actual-detail']=()=>openSheet(actualRewardDetailHTML());
const originalSettingsHTML=settingsHTML;
settingsHTML=function(){return '<section class="panel"><b>v2.14.2 · 月結總額與多維回贈</b><p class="mini">港幣總消費按月結單 New Charges 口徑，包括銀行費用；實際回贈分開保存現金、積分、WAKU COIN 和里數，外層顯示折合港幣約值。</p><a href="../v2.14.1/">開啟 v2.14.1</a></section>'+originalSettingsHTML();};
