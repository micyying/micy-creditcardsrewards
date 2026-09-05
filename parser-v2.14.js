/* Statement extraction v2.14.0. No reward-rate inference or network access. */
(function(root){
'use strict';
const MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const amount=s=>Math.round(Number(String(s).replace(/[,\s]|CR/gi,''))*100);
const mo=s=>MONTHS.indexOf(String(s).toUpperCase().slice(0,3))+1;
const pad=n=>String(n).padStart(2,'0');
function date(d,m,y){const dt=new Date(Date.UTC(+y,+m-1,+d));return m>0&&dt.getUTCMonth()===+m-1&&dt.getUTCDate()===+d?`${y}-${pad(m)}-${pad(d)}`:null;}
function shortDate(d,m,ref){m=mo(m);return date(d,m,+ref.slice(0,4)-(m>+ref.slice(5,7)?1:0));}
function fingerprint(text){ // Two independent 32-bit hashes; raw source remains available for collision checks.
 let a=2166136261,b=5381;for(const c of text){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}return (a>>>0).toString(16)+(b>>>0).toString(16);
}
function linesOf(text){let page=1,line=0;return text.split('\n').map(raw=>{if(raw.includes('\f')){page++;line=0;}return {s:raw.replace(/\s+/g,' ').trim(),raw,page,line:++line};});}
function type(desc,credit){
 if(/ODD CENTS/i.test(desc))return 'odd_cent';
 if(/WAKU COIN (REDEMPTION|REBATE)|Offset Spending with Points|積分兌換/i.test(desc))return 'reward_offset';
 if(/\b(FEE|CHARGE|INTEREST)\b|利息|逾期費/i.test(desc))return credit?'fee_refund':'fee';
 if(/PAYMENT THANK|AUTOPAY INGROUP|DIRECT DEBIT|REPAYMENT|REPAY MOX|PAYMENT RECEIVED|還款/i.test(desc))return 'payment';
 if(/invitation reward|welcome reward|迎新/i.test(desc))return 'welcome_reward';
 if(/CASH\s*REBATE|CASHBACK/i.test(desc))return credit?'cashback':'cashback_reversal';
 return credit?'refund':'purchase';
}
const kinds={purchase:'tx',payment:'payment',cashback:'rebate',refund:'credit',reward_offset:'reward_offset',odd_cent:'odd_cent',fee:'fee',fee_refund:'fee_refund',welcome_reward:'welcome_reward',cashback_reversal:'cashback_reversal',transfer:'transfer'};
function meta(text){
 const m={bank:null,statement_date:null,statement_month:null,document_type:'credit',card_type:null};
 if(/\bMOX\b/i.test(text)){m.bank='mox';m.document_type=/Mox Bank statement/i.test(text)?'bank':'credit';m.card_type='mox';}
 else if(/Credit Card Consolidated Statement|AEON Visa Credit Card|AEON CARD WAKUWAKU/i.test(text)){m.bank='aeon';m.card_type='aeon';}
 else if(/Chill|BOC|中銀/i.test(text)){m.bank='boc';m.card_type=/CHILL/i.test(text)?'chill':/Diamond|鑽石/i.test(text)?'go_diamond':'go_platinum';}
 else if(/CATHAY|國泰|STANDARD CHARTERED|渣打/i.test(text)){m.bank='sc';m.card_type='cathay';if(!/CATHAY|國泰/i.test(text))m.document_type='unsupported';}
 else if(/HSBC|滙豐/i.test(text)){m.bank='hsbc';}
 const sd=/Statement\s*Date[\s\S]{0,85}?(\d{1,2})[-\s]+([A-Za-z]{3})[-\s]+(\d{4})/i.exec(text)||/結單日期[\s\S]{0,85}?(\d{1,2})[-\s]+([A-Za-z]{3})[-\s]+(\d{4})/i.exec(text);
 if(sd)m.statement_date=date(sd[1],mo(sd[2]),+sd[3]);
 const numeric=/Statement\s*Date[^\d]{0,65}(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);
 if(numeric)m.statement_date=date(numeric[1],+numeric[2],+numeric[3]);
 if(m.bank==='mox'){
  const period=/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/i.exec(text);
  if(period){m.period_start=date(period[1],mo(period[2]),+period[3]);m.period_end=date(period[4],mo(period[5]),+period[6]);}
 }
 m.statement_month=(m.period_end||m.statement_date||'').slice(0,7)||null;
 return m;
}
function parse(text,options={}){
 const m=meta(text),lines=linesOf(text),rows=[],rewards=[],warnings=[],checks=[];
 const fp='v2.14|'+(m.bank||'unknown')+'|'+fingerprint(text.replace(/\r/g,''));
 const ref=m.period_end||m.statement_date;
 const card=(kind)=>{const ids={chill:'card-boc-chill',go_platinum:'card-boc-go',go_diamond:'card-boc-go-dia',cathay:'card-sc-cathay',mox:'card-mox',purple:'card-aeon-purple',waku:'card-aeon-waku'};return ids[kind]||null;};
 function emit(src,desc,rawAmount,txDate,postDate,currency='HKD',cardId=card(m.card_type),extra={}){
  const credit=/CR\s*$/i.test(rawAmount)||/^\+/.test(rawAmount);
  let signed=amount(rawAmount);if(m.bank==='mox')signed=-signed;else if(credit)signed=-Math.abs(signed);
  const t=extra.transaction_type||type(desc,signed<0);
  const row={date:txDate||postDate||ref,post_date:postDate,transaction_date:txDate,raw_description:desc,merchant:desc.replace(/^##\s*/,'').trim(),merchant_marker:desc.startsWith('##')?'##':null,raw_amount:rawAmount,amount:Math.abs(signed)/100,amount_minor:signed,currency,credit_debit_indicator:signed<0?'CR':'DEBIT',transaction_type:t,kind:kinds[t]||'unknown',cardId,online:null,category:'other',source_page:src.page,source_line:src.line,raw_line:src.raw,statement_date:m.statement_date,statement_month:m.statement_month,document_type:m.document_type,fp,parser_version:'2.14.0',expected_cashback:null,confidence:'PENDING',...extra};
  if(t==='cashback'){
   const period=/\(([A-Za-z]{3})\)/.exec(desc);
   row.cashback_period=m.bank==='mox'?(postDate||txDate).slice(0,7):period?shortDate(1,period[1],postDate||ref)?.slice(0,7):null;
   if(!row.cashback_period)warnings.push('回贈未列消費月份，保留入賬日；歸屬月份待核實。');
  }
  if(!txDate&&t!=='odd_cent')warnings.push(`第 ${src.page} 頁有賬項缺交易日期。`);
  if(/APPLE\s*PAY/i.test(desc))row.payment_method='apple_pay';
  else if(/BoC Pay\+/i.test(desc))row.payment_method='boc_pay_plus';
  if(!desc)warnings.push(`第 ${src.page} 頁有賬項缺商戶名稱。`);
  row.source_id=fp+'|'+src.page+'|'+src.line+'|'+rows.length;
  rows.push(row);return row;
 }
 if(!m.bank||!ref||m.document_type==='unsupported')return {meta:m,fp,rows,rewards,checks,warnings:['未能確認信用卡種類或結單日期；不會以今天日期代替。'],raw_text:text};
 if(m.bank==='boc'){
  let currency=/Chill/i.test(text)?'HKD':null,last4=null;
  const rx=/^(\d{1,2})-([A-Za-z]{3})\s+(\d{1,2})-([A-Za-z]{3})\s+(.+?)\s+([\d,]+\.\d{2}\s*(?:CR)?)$/i;
  for(const l of lines){
   const h=/(HKD|CNY) Account No\.:\s*([\d -]+)/i.exec(l.s);if(h){currency=h[1].toUpperCase();last4=h[2].replace(/\D/g,'').slice(-4);continue;}
   const x=rx.exec(l.s);
   if(x){if(!currency){warnings.push('賬項缺少幣種，未匯入。');continue;}const post=shortDate(x[1],x[2],ref),tx=shortDate(x[3],x[4],post||ref);emit(l,x[5],x[6],tx,post,currency,card(m.card_type),{account_last4:last4});}
   else if(/^ODD CENTS (TO NEXT BILL|FROM LAST BILL)/i.test(l.s)){const a=/([\d,]+\.\d{2}\s*(?:CR)?)$/i.exec(l.s);if(a&&currency)emit(l,l.s.slice(0,a.index).trim(),a[1],null,null,currency,card(m.card_type),{account_last4:last4});}
   else if(/^\d{1,2}-[A-Za-z]{3}\s+\d{1,2}-[A-Za-z]{3}/.test(l.s)){
    const gp=/(?:GP Rebate.*|GP)\s*=\s*([\d,]+)/i.exec(l.s);if(gp)rewards.push({unit:'gift_points',adjustment:+gp[1].replace(/,/g,''),raw_line:l.raw,source_page:l.page,cardId:card(m.card_type)});else warnings.push(`第 ${l.page} 頁未解析日期行：${l.s}`);
   }
  }
  const gp=lines.findIndex(l=>/Year\(s\) of Cardholding Gift Points Adjustment Current Gift Points Expiry/.test(l.s));
  if(gp>=0){const l=lines[gp+1],v=/^(?:\d+\s+)?(-?[\d,]+)\s+([\d,]+)\s+(\d{2}-[A-Z]{3}-\d{4})$/.exec(l?.s||'');if(v)rewards.push({cardId:card(m.card_type),unit:'gift_points',earned:null,redeemed:null,adjustment:+v[1].replace(/,/g,''),balance:+v[2].replace(/,/g,''),expiry:v[3],source_page:l.page,raw_line:l.raw,statement_month:m.statement_month});}
  for(const currency of ['HKD','CNY']){
   const summary=lines.find(l=>(l.s.match(new RegExp(currency+'\\s+[\\d,]+\\.\\d{2}','g'))||[]).length>=4&&/\d{4}-\d{4}/.test(l.s));
   if(!summary)continue;const values=[...summary.s.matchAll(new RegExp(currency+'\\s+([\\d,]+\\.\\d{2}(?:\\s*CR)?)','g'))].map(x=>amount(x[1])*(/CR/.test(x[1])?-1:1));
   const mine=rows.filter(r=>r.currency===currency),debits=mine.reduce((s,r)=>s+Math.max(0,r.amount_minor),0),credits=mine.reduce((s,r)=>s-Math.min(0,r.amount_minor),0);
   checks.push({currency,opening:values[0],declared_debits:values[1],declared_credits:values[2],closing:values[3],debits,credits,ok:debits===values[1]&&credits===values[2]&&values[0]+debits-credits===values[3]});
  }
 }
 if(m.bank==='mox'){
  const rx=/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{1,2})\s+([A-Za-z]{3})\s*(.*?)\s*([+\-]?[\d,]+\.\d{2})$/;
  const isDate=s=>/^\d{1,2}\s+[A-Za-z]{3}\s+\d{1,2}\s+[A-Za-z]{3}/.test(s);
  const boundary=s=>!s||/Activity|Settlement|Description|Amount|交易|結算|Page |Important Notice|Opening balance|Closing balance|markup|外匯溢價|^\d|^\f/i.test(s);
  for(let i=0;i<lines.length;i++){
   const l=lines[i],x=rx.exec(l.s);if(!x){if(isDate(l.s)&&!/(Opening|Closing) balance/i.test(l.s))warnings.push(`第 ${l.page} 頁未解析日期行：${l.s}`);continue;}
   let desc=x[5].trim();const before=lines[i-1],after=lines[i+1];
   const fx=/([+\-][\d,]+\.\d{2})\s+([A-Z]{3})/.exec(desc);const extra={};if(fx){extra.original_currency=fx[2];extra.original_amount=Number(fx[1].replace(/,/g,''));}
   const exchange=/1\s+[A-Z]{3}\s*=/.test(desc);
   if(!desc||exchange){const pre=before&&before.page===l.page&&!isDate(before.s)&&!boundary(before.s)?before.s:'';const post=after&&after.page===l.page&&!isDate(after.s)&&!boundary(after.s)?after.s:'';desc=[pre,exchange?'':desc,post].filter(Boolean).join(' ');if(exchange)extra.exchange_rate_raw=x[5];}
   if(/(Opening|Closing) balance/i.test(desc))continue;
   const post=shortDate(x[3],x[4],ref),tx=shortDate(x[1],x[2],post||ref);
   if(m.document_type==='bank'&&!/CashBack|invitation reward|welcome reward/i.test(desc))extra.transaction_type='transfer';
   if(m.document_type==='credit'&&/PAYMENT|TRANSFER.*MOX|MOX.*TRANSFER|REPAY/i.test(desc))extra.transaction_type='payment';
   emit(l,desc,x[6],tx,post,'HKD',card('mox'),extra);
  }
  if(m.document_type==='bank'){
   const summary=/CashBack\s*\n\s*([\d,]+\.\d{2})\s*HKD/i.exec(text);
   if(summary){const got=rows.filter(r=>r.transaction_type==='cashback').reduce((s,r)=>s-r.amount_minor,0);checks.push({currency:'HKD',label:'CashBack 明細',declared:amount(summary[1]),actual:got,ok:got===amount(summary[1])});}
  }
 }
 if(m.bank==='sc'){
  let reference=null;
  for(const l of lines){
   const rr=/Transaction Ref\s+(\d+)/i.exec(l.s);if(rr&&!/^\d{2}\/\d{2}/.test(l.s)){reference=rr[1];continue;}
   const x=/^(\d{2})\/(\d{2})\s+(.+?)\s+([\d,]+\.\d{2})\s*(CR)?$/.exec(l.s);
   if(!x){if(/^\d{2}\/\d{2}/.test(l.s))warnings.push(`第 ${l.page} 頁未解析國泰日期行：${l.s}`);continue;}
   const tx=date(+x[2],+x[1],+ref.slice(0,4)-(+x[1]>+ref.slice(5,7)?1:0));
   const desc=x[3].replace(/Transaction Ref\s+\d+/i,'').trim();
   const kind=/SC IBANKING CREDIT CARD REPAYMEN\s*T/i.test(desc)?'payment':undefined;
   emit(l,desc,x[4]+(x[5]?' CR':''),tx,null,'HKD',card('cathay'),{...(kind?{transaction_type:kind}:{}),transaction_reference:reference});reference=null;
  }
  const miles=lines.find(l=>/^\d{4}-\d{2}XX-XXXX-\d{4}\s+[\d,]+\s+\d+/.test(l.s));
  if(miles){const n=/^\S+\s+([\d,]+)\s+\d+/.exec(miles.s);rewards.push({cardId:card('cathay'),unit:'asia_miles',earned:+n[1].replace(/,/g,''),statement_date:ref,statement_month:m.statement_month,source_page:miles.page,raw_line:miles.raw,valuation_hkd:null});}
  const summary=lines.find(l=>/^(?:[\d,]+\.\d{2}\s+){6}[\d,]+\.\d{2}$/.test(l.s));
  if(summary){const v=summary.s.split(/\s+/).map(amount);const debits=rows.reduce((s,r)=>s+Math.max(0,r.amount_minor),0),credits=rows.reduce((s,r)=>s-Math.min(0,r.amount_minor),0);checks.push({currency:'HKD',opening:v[0],declared_debits:v[3]+v[4]+v[5],declared_credits:v[1]+v[2],closing:v[6],debits,credits,ok:debits===v[3]+v[4]+v[5]&&credits===v[1]+v[2]&&v[0]+debits-credits===v[6]});}
 }
 if(m.bank==='aeon'){
  let cur=null,last4=null;
  const head=/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(.*)$/;
  const end=/([\d,]+\.\d{2})\s*(CR)?$/i;
  for(let i=0;i<lines.length;i++){
   const l=lines[i];if(/^AEON\b/i.test(l.s)&&/CARD|VISA|WAKU/i.test(l.s)){cur=card(/WAKU/i.test(l.s)?'waku':'purple');last4=/\d{4}-\d{4}-\d{4}-(\d{4})/.exec(l.s)?.[1]||null;continue;}
   const h=head.exec(l.s);if(!h)continue;let body=h[7],raw=l.raw;
   if(!end.test(body)){const nx=lines[i+1];if(nx&&nx.page===l.page&&!head.test(nx.s)&&end.test(nx.s)&&!/^(HKD|CNY|STATEMENT|PREVIOUS|MINIMUM|Note)/i.test(nx.s)){body+=' '+nx.s;raw+='\n'+nx.raw;i++;}}
   const a=end.exec(body);if(!a){warnings.push(`第 ${l.page} 頁未解析日期行：${l.s}`);continue;}
   let desc=body.slice(0,a.index).trim();
   if(!desc){const prev=lines[i-1];if(prev&&prev.page===l.page&&!head.test(prev.s)&&!/(BALANCE|PAYMENT|CARD ACTIVITIES|Note:|^\d|^HKD|^CNY)/i.test(prev.s))desc=prev.s;}
   emit({...l,raw},desc,a[0],date(h[1],mo(h[2]),+h[3]),date(h[4],mo(h[5]),+h[6]),'HKD',cur,{account_last4:last4});
  }
  let summaryCard=null;
  for(const l of lines){
   if(/^AEON\b/i.test(l.s)&&/CARD|VISA|WAKU/i.test(l.s))summaryCard=card(/WAKU/i.test(l.s)?'waku':'purple');
   const a=[...l.s.matchAll(/HKD\s+([\d,]+\.\d{2}(?:\s*CR)?)/g)];
   if(a.length!==7||!summaryCard)continue;
   const v=a.map(x=>amount(x[1])*(/CR/.test(x[1])?-1:1));
   const mine=rows.filter(r=>r.cardId===summaryCard),net=mine.reduce((s,r)=>s+r.amount_minor,0);
   checks.push({currency:'HKD',cardId:summaryCard,label:'卡戶口淨額',opening:v[0],closing:v[6],actual:net,declared:v[6]-v[0],ok:v[0]+net===v[6]&&v[0]+v[1]+v[2]+v[3]+v[4]+v[5]===v[6]});
  }
  for(let i=0;i<lines.length;i++){
   const s=lines[i].s;const unit=/WAKU COIN Reward Program/i.test(s)?'waku_coin':/Bonus Point Program/i.test(s)?'aeon_points':null;if(!unit)continue;
   for(let k=i+1;k<Math.min(i+10,lines.length);k++){
    if(/Reward Program|Bonus Point Program/.test(lines[k].s))break;
    const n=/^([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)$/.exec(lines[k].s);if(!n)continue;
    const [earned,redeemed,balance,expiring]=n.slice(1).map(x=>+x.replace(/,/g,''));
    rewards.push({cardId:card(unit==='waku_coin'?'waku':'purple'),unit,earned,redeemed,balance,expiring,statement_date:ref,statement_month:m.statement_month,source_page:lines[k].page,raw_line:lines[k].raw,valuation_hkd:earned*(unit==='waku_coin'?1:0.004),valuation_basis:'user_selected_redemption_value'});break;
   }
  }
 }
 if(m.bank==='hsbc'&&options.legacyHSBC){rows.push(...options.legacyHSBC(text,+ref.slice(0,4),+ref.slice(5,7)).map((r,i)=>({...r,parser_version:'legacy-hsbc',fp,source_id:fp+'|'+i})));warnings.push('HSBC 沿用原解析器，本版未以 HSBC 原单驗證。');}
 if(!rows.length)warnings.push('未提取到交易；掃描件或其他版面需要人工核對。');
 if(checks.some(c=>!c.ok))warnings.push('交易明細與結單摘要不符，請核對遺漏或誤讀。');
 return {meta:m,fp,rows,rewards,checks,warnings:[...new Set(warnings)],raw_text:text};
}
function layoutText(items){
 const rows=[];
 for(const item of items){if(!item.str?.trim())continue;const y=item.transform[5];let row=rows.find(r=>Math.abs(r.y-y)<1.5);if(!row){row={y,items:[]};rows.push(row);}row.items.push(item);}
 return rows.sort((a,b)=>b.y-a.y).map(r=>{let end=null,out='';for(const i of r.items.sort((a,b)=>a.transform[4]-b.transform[4])){const x=i.transform[4];if(end!==null&&x-end>1.2)out+=' ';out+=i.str;end=Math.max(end??x,x+(i.width||0));}return out.replace(/\s+/g,' ').trim();}).join('\n');
}
const api={parse,meta,type,amount,date,fingerprint,layoutText};if(typeof module!=='undefined')module.exports=api;root.StatementParser=api;
})(typeof globalThis!=='undefined'?globalThis:this);
