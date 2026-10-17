/* SOL Wallet 8 — EUR and UAH are separate balances, never added without an actual exchange. */
(function(root){
'use strict';
const CUR=['EUR','UAH'], W=['business','personal'], MAX=100000000000;
const fresh=()=>({version:1,accounts:[],events:[],sources:[],uahTargets:{business:{},personal:{}},familyLimits:{EUR:{},UAH:{}}});
const ledger=s=>s.currencyLedger||fresh();
const ensure=s=>{const l=s.currencyLedger||(s.currencyLedger=fresh());if(!Array.isArray(l.sources))l.sources=[];if(!l.familyLimits)l.familyLimits={EUR:{},UAH:{}};return l};
const clone=x=>JSON.parse(JSON.stringify(x));
const valid=n=>Number.isSafeInteger(n)&&n>0&&n<=MAX;
const money=(n,c)=>new Intl.NumberFormat('uk-UA',{style:'currency',currency:c,minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100);
const amt=n=>(n/100).toFixed(2);
const parse=v=>{const s=String(v??'').replace(/\s/g,'').replace(',','.');if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(s))throw Error('Вкажи суму, наприклад 1200 або 1200,50');const n=Math.round(Number(s)*100);if(!valid(n))throw Error('Вкажи додатну суму, допустиму для обліку');return n;};
const dateOk=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const dateNow=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const uuid=()=>root?.crypto?.randomUUID?.()||('id-'+Date.now()+'-'+Math.random().toString(36).slice(2));
const cats=(s,w)=>s.wallets[w].categories;
function buckets(s){const o={EUR:{business:{},personal:{}},UAH:{business:{},personal:{}}};for(const c of CUR)for(const w of W)for(const x of cats(s,w))o[c][w][x.id]=0;return o;}
function baseEuro(s,b){for(const t of s.transactions){
 if(t.type==='income')for(const a of t.allocations)b.business&& (b[t.wallet][a.id]+=a.cents);
 if(t.type==='expense')b[t.wallet][t.category]-=t.cents;
 if(t.type==='move'){b[t.wallet][t.from]-=t.cents;b[t.wallet][t.to]+=t.cents;}
 if(t.type==='owner'){b.business.owner-=t.cents;for(const a of t.allocations)b.personal[a.id]+=a.cents;}
}return b;}
function applyEvent(b,e){
 if(e.type==='uah_income')for(const a of e.allocations)b.UAH[e.wallet][a.id]+=a.cents;
 if(e.type==='uah_expense')b.UAH[e.wallet][e.category]-=e.cents;
 if(e.type==='uah_move'){b.UAH[e.wallet][e.from]-=e.cents;b.UAH[e.wallet][e.to]+=e.cents;}
 if(e.type==='uah_owner'){b.UAH.business.owner-=e.cents;for(const a of e.allocations)b.UAH.personal[a.id]+=a.cents;}
 if(e.type==='exchange'){b[e.fromCurrency][e.wallet][e.fromCategory]-=e.fromCents;b[e.toCurrency][e.wallet][e.toCategory]+=e.toCents;}
}
function balances(s){const b=buckets(s);baseEuro(s,b.EUR);for(const e of ledger(s).events)applyEvent(b,e);return b;}
function augmentEURBalances(b,s){for(const e of ledger(s).events){if(e.type!=='exchange')continue;if(e.fromCurrency==='EUR')b[e.wallet][e.fromCategory]-=e.fromCents;if(e.toCurrency==='EUR')b[e.wallet][e.toCategory]+=e.toCents;}return b;}
function allocByPct(total,arr){let v=arr.map((c,i)=>({id:c.id,cents:Math.floor(total*c.pct/100),r:total*c.pct%100,i}));let left=total-v.reduce((a,x)=>a+x.cents,0);for(const x of [...v].sort((a,b)=>b.r-a.r||a.i-b.i).slice(0,left))x.cents++;return v.map(({id,cents})=>({id,cents}));}
function monthFundedUAH(s,w,month){const m=Object.fromEntries(cats(s,w).map(c=>[c.id,0]));for(const e of ledger(s).events){if(!e.date.startsWith(month))continue;
 if(e.type==='uah_income'&&e.wallet===w||e.type==='uah_owner'&&w==='personal')for(const a of e.allocations)m[a.id]+=a.cents;
 if(e.type==='uah_move'&&e.wallet===w){m[e.from]-=e.cents;m[e.to]+=e.cents;}
 if(e.type==='exchange'&&e.wallet===w){if(e.fromCurrency==='UAH')m[e.fromCategory]-=e.fromCents;if(e.toCurrency==='UAH')m[e.toCategory]+=e.toCents;}
}return m;}
function allocateUAH(s,w,cents,date=dateNow()){
 const ca=cats(s,w),target=ledger(s).uahTargets?.[w]||{},fund=monthFundedUAH(s,w,date.slice(0,7));
 const out=ca.map(c=>({id:c.id,cents:0}));let rest=cents;
 const ordered=ca.map((c,i)=>({...c,i})).filter(c=>c.kind==='protected'&&(target[c.id]||0)>0).sort((a,b)=>(a.due||32)-(b.due||32)||a.i-b.i);
 for(const c of ordered){const n=Math.min(rest,Math.max(0,(target[c.id]||0)-(fund[c.id]||0)));out[c.i].cents+=n;rest-=n;if(!rest)break;}
 if(rest){let eligible=ca.filter(c=>!(c.kind==='protected'&&(target[c.id]||0)>0));if(!eligible.length)eligible=ca;let total=eligible.reduce((a,c)=>a+c.pct,0);if(!total)eligible=eligible.map(c=>({...c,pct:1})),total=eligible.length;const raw=eligible.map((c,i)=>({id:c.id,cents:Math.floor(rest*c.pct/total),r:rest*c.pct/total-Math.floor(rest*c.pct/total),i}));let remain=rest-raw.reduce((a,c)=>a+c.cents,0);for(const x of [...raw].sort((a,b)=>b.r-a.r||a.i-b.i).slice(0,remain))x.cents++;for(const e of raw)out[ca.findIndex(c=>c.id===e.id)].cents+=e.cents;}
 return out;
}
function validate(s){
 if(s.currencyLedger===undefined)return;
 const l=s.currencyLedger;
 if(!l||l.version!==1||!Array.isArray(l.events)||l.events.length>20000||!Array.isArray(l.accounts)||l.accounts.length>80||!l.uahTargets||typeof l.uahTargets!=='object')throw Error('Неправильна структура валютного гаманця');
 const acct=new Map();
 for(const a of l.accounts){if(!a||typeof a.id!=='string'||a.id.length<1||a.id.length>80||acct.has(a.id)||!W.includes(a.wallet)||!CUR.includes(a.currency)||typeof a.name!=='string'||!a.name.trim()||a.name.length>90||(a.kind!==undefined&&!['card','cash','other'].includes(a.kind)))throw Error('Невірний рахунок/картка');acct.set(a.id,a);}
 if(l.sources!==undefined){if(!Array.isArray(l.sources)||l.sources.length>100)throw Error('Неправильний список джерел доходів');const srcids=new Set();for(const q of l.sources){if(!q||typeof q.id!=='string'||q.id.length<1||q.id.length>90||srcids.has(q.id)||!W.includes(q.wallet)||!CUR.includes(q.currency)||typeof q.name!=='string'||!q.name.trim()||q.name.length>90||!['once','monthly','irregular'].includes(q.frequency)||!Number.isSafeInteger(q.expectedCents)||q.expectedCents<0||q.expectedCents>MAX||!account(q.accountId,q.wallet,q.currency))throw Error('Некоректне джерело надходжень');srcids.add(q.id);}}
 for(const w of W){const t=l.uahTargets[w];if(!t||typeof t!=='object'||Array.isArray(t))throw Error('Помилка гривневих цілей');for(const [k,v] of Object.entries(t)){if(!cats(s,w).some(c=>c.id===k)||!Number.isSafeInteger(v)||v<0||v>MAX)throw Error('Гривнева ціль пошкоджена');}}
 if(l.familyLimits!==undefined){if(!l.familyLimits||typeof l.familyLimits!=='object'||Array.isArray(l.familyLimits))throw Error('Некоректні сімейні ліміти');for(const currency of CUR){const limits=l.familyLimits[currency];if(!limits||typeof limits!=='object'||Array.isArray(limits))throw Error('Некоректні ліміти '+currency);for(const [k,n] of Object.entries(limits))if(!cats(s,'personal').some(x=>x.id===k)||!Number.isSafeInteger(n)||n<0||n>MAX)throw Error('Некоректний сімейний ліміт');}}
 const cat=(w,k)=>typeof k==='string'&&cats(s,w).some(c=>c.id===k);
 function account(id,w,c){return id===undefined||id===''||id===null||acct.has(id)&&acct.get(id).wallet===w&&acct.get(id).currency===c;}
 function validSource(id,w,c){return !id||(l.sources||[]).some(q=>q.id===id&&q.wallet===w&&q.currency===c);}
 function alloc(a,w,n){return Array.isArray(a)&&a.length<=45&&a.reduce((v,x)=>v+(Number.isSafeInteger(x.cents)?x.cents:0),0)===n&&a.every(x=>cat(w,x.id)&&Number.isSafeInteger(x.cents)&&x.cents>=0);}
 const all=new Set(),b=buckets(s);baseEuro(s,b.EUR);
 for(const t of s.transactions){if(t.accountId&&!account(t.accountId,t.wallet,'EUR'))throw Error('Рахунок єврової операції не знайдено');if(t.type==='income'&&!validSource(t.sourceId,t.wallet,'EUR'))throw Error('Джерело єврового доходу не знайдено');if(t.familyKind!==undefined&&(!['regular','refund','opening'].includes(t.familyKind)||t.wallet!=='personal'||t.type!=='income'))throw Error('Неправильний тип сімейного надходження');if(t.merchantCents!==undefined&&(!valid(t.merchantCents)||t.type!=='expense'))throw Error('Невірна валюта покупки');if(t.expenseKind!==undefined&&(!['purchase','fee','other'].includes(t.expenseKind)||t.type!=='expense'))throw Error('Невірний тип витрати');if(t.type==='owner'){if(t.fromAccountId&&!account(t.fromAccountId,'business','EUR'))throw Error('Рахунок BMH не знайдено');if(t.toAccountId&&!account(t.toAccountId,'personal','EUR'))throw Error('Сімейний рахунок не знайдено');}}
 for(const e of l.events){
  if(!e||typeof e.id!=='string'||e.id.length<1||e.id.length>100||all.has(e.id)||!dateOk(e.date)||typeof e.note!=='string'||e.note.length>250)throw Error('Некоректна валютна операція');all.add(e.id);
  if(e.type==='uah_income'){if(!W.includes(e.wallet)||!valid(e.cents)||!alloc(e.allocations,e.wallet,e.cents)||!account(e.accountId,e.wallet,'UAH')||!validSource(e.sourceId,e.wallet,'UAH')||(e.familyKind!==undefined&&(!['regular','refund','opening'].includes(e.familyKind)||e.wallet!=='personal')))throw Error('Неправильне надходження ₴');}
  else if(e.type==='uah_expense'){if(!W.includes(e.wallet)||!valid(e.cents)||!cat(e.wallet,e.category)||!account(e.accountId,e.wallet,'UAH')||(e.merchantCents!==undefined&&!valid(e.merchantCents))||(e.expenseKind!==undefined&&!['purchase','fee','other'].includes(e.expenseKind)))throw Error('Неправильна витрата ₴');}
  else if(e.type==='uah_move'){if(!W.includes(e.wallet)||!valid(e.cents)||!cat(e.wallet,e.from)||!cat(e.wallet,e.to)||e.from===e.to)throw Error('Неправильне переміщення ₴');}
  else if(e.type==='uah_owner'){if(!valid(e.cents)||!cat('business','owner')||!alloc(e.allocations,'personal',e.cents)||!account(e.fromAccountId,'business','UAH')||!account(e.toAccountId,'personal','UAH'))throw Error('Неправильний переказ собі ₴');}
  else if(e.type==='exchange'){if(!W.includes(e.wallet)||!CUR.includes(e.fromCurrency)||!CUR.includes(e.toCurrency)||e.fromCurrency===e.toCurrency||!cat(e.wallet,e.fromCategory)||!cat(e.wallet,e.toCategory)||!valid(e.fromCents)||!valid(e.toCents)||!account(e.fromAccountId,e.wallet,e.fromCurrency)||!account(e.toAccountId,e.wallet,e.toCurrency))throw Error('Неправильна валютна конвертація');}
  else if(e.type==='account_transfer'){if(!W.includes(e.wallet)||!CUR.includes(e.currency)||!valid(e.cents)||!e.fromAccountId||!e.toAccountId||e.fromAccountId===e.toAccountId||!account(e.fromAccountId,e.wallet,e.currency)||!account(e.toAccountId,e.wallet,e.currency))throw Error('Неправильний переказ між рахунками');}
  else throw Error('Невідомий тип валютної операції');
  applyEvent(b,e);
  for(const w of W)if(Object.values(b.UAH[w]).some(v=>!Number.isSafeInteger(v)||v<0))throw Error('Недостатньо гривень у конверті ('+w+')');
 }
 for(const w of W)for(const c of CUR)if(Object.values(b[c][w]).some(v=>!Number.isSafeInteger(v)||v<0))throw Error('Недостатньо грошей у конверті ('+w+', '+c+')');
}
function accountBalances(s){
 const l=ledger(s),b={EUR:{business:{'':0},personal:{'':0}},UAH:{business:{'':0},personal:{'':0}}};
 for(const a of l.accounts)b[a.currency][a.wallet][a.id]=0;
 const change=(c,w,id,n)=>{const target=b[c]?.[w];if(target)target[id||'']=(target[id||'']||0)+n};
 for(const t of s.transactions){
  if(t.type==='income')change('EUR',t.wallet,t.accountId,t.cents);
  if(t.type==='expense')change('EUR',t.wallet,t.accountId,-t.cents);
  if(t.type==='owner'){change('EUR','business',t.fromAccountId,-t.cents);change('EUR','personal',t.toAccountId,t.cents);}
 }
 for(const e of l.events){
  if(e.type==='uah_income')change('UAH',e.wallet,e.accountId,e.cents);
  if(e.type==='uah_expense')change('UAH',e.wallet,e.accountId,-e.cents);
  if(e.type==='uah_owner'){change('UAH','business',e.fromAccountId,-e.cents);change('UAH','personal',e.toAccountId,e.cents);}
  if(e.type==='exchange'){change(e.fromCurrency,e.wallet,e.fromAccountId,-e.fromCents);change(e.toCurrency,e.wallet,e.toAccountId,e.toCents);}
  if(e.type==='account_transfer'){change(e.currency,e.wallet,e.fromAccountId,-e.cents);change(e.currency,e.wallet,e.toAccountId,e.cents);}
 }
 return b;
}
const sumWallet=(b,c,w)=>Object.values(b[c][w]).reduce((a,n)=>a+n,0);
const api={fresh,ledger,ensure,validate,balances,augmentEURBalances,allocateUAH,accountBalances,sumWallet,parse,money,amt,uuid,dateNow};
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.SOLCurrency=api;
})(typeof window==='object'?window:null);