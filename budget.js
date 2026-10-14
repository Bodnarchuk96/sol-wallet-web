/* SOL Wallet Budget Planner 7 — distinct from accounting/tax returns.
 * All settings are stored only in the existing encrypted vault via SOLVault.persist.
 * Template application is explicit, backward compatible, and never deletes ledger categories.
 */
(function(root){
'use strict';
const PRESETS={
 business:[
  ['business_tax','🧾','Резерв на податки (попередній)',25,'protected',0],
  ['vat','📑','ПДВ (лише якщо застосовується)',0,'protected',0],
  ['codex','🤖','OpenAI / ChatGPT / Codex',5,'protected',0],
  ['video_ai','🎬','AI-відео / монтаж / дизайн',7,'protected',0],
  ['hosting','🌐','Сайт / домени / хостинг',3,'protected',0],
  ['ads','📣','Реклама / просування',8,'flex',0],
  ['payroll','👥','Працівники + внески роботодавця',0,'protected',0],
  ['contractors','🤝','Автори / фрилансери / підрядники',5,'protected',0],
  ['operations','🗂️','Робочі витрати / підписки',5,'protected',0],
  ['bank_accountant','🏦','Банк / бухгалтерія / IHK',3,'protected',0],
  ['equipment','📷','Техніка / інтернет для роботи',4,'protected',0],
  ['client_projects','🎞️','Виробництво клієнтських проєктів',5,'protected',0],
  ['business_reserve','🛟','Фінансова подушка бізнесу',10,'protected',0],
  ['owner','💚','Переказ власнику (Privatentnahme)',20,'protected',0]
 ],
 personal:[
  ['rent','🏠','Оренда житла',30,'protected',1],
  ['utilities','💡','Комунальні / електроенергія',10,'protected',10],
  ['groceries','🛒','Продукти і побут',18,'protected',0],
  ['debts','📋','Мінімальні внески за боргами',12,'protected',0],
  ['children','🧸','Діти / одяг / необхідне',8,'protected',0],
  ['transport','🚍','Транспорт',6,'protected',0],
  ['health','❤️','Здоров’я / страховка',3,'protected',0],
  ['school','🎒','Школа / навчання',3,'protected',0],
  ['communications','📱','Телефон / інтернет / підписки',2,'protected',0],
  ['cafe','☕','Кафе',2,'flex',0],
  ['fun','🎉','Розваги',1,'flex',0],
  ['reserve','🛟','Сімейний резерв',5,'protected',0],
  ['private_tax','🧾','Особисті податки / інші збори',0,'protected',0]
 ]
};
const PRESET_CATEGORIES=Object.fromEntries(Object.entries(PRESETS).map(([w,list])=>[w,list.map(([id,icon,name,pct,kind,due])=>({id,icon,name,pct,kind,due,target:0}))]));
const MODEL_DEFAULT={version:1,monthlyRevenueCents:100000,otherFamilyIncomeCents:0,vatMode:'unknown',incomeTaxEstimatePercent:25};
const validInt=(n,max=1e11)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const centsToStr=n=>(n/100).toFixed(2);
const format=n=>new Intl.NumberFormat('uk-UA',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100);
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const asCents=v=>{const s=String(v??'').trim().replace(/\s/g,'').replace(',','.');if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(s))throw Error('Введи суму у форматі 1000 або 1000,50');const n=Math.round(Number(s)*100);if(!validInt(n))throw Error('Завелика сума');return n};
const getModel=s=>{const x=s?.budgetModel||{};return {...MODEL_DEFAULT,...Object.fromEntries(Object.entries(x).filter(([k,v])=>Object.hasOwn(MODEL_DEFAULT,k)))};};
function mergePreset(existing,w){
 if(!Array.isArray(existing))throw Error('Категорії недоступні');
 const byId=new Map(existing.map(x=>[x.id,x]));
 const tpl=PRESET_CATEGORIES[w];if(!tpl)throw Error('Невідомий гаманець');
 const updated=tpl.map(c=>{const old=byId.get(c.id);return {...c,target:old&&validInt(old.target)?old.target:0,due:old?.due||c.due};});
 const used=new Set(updated.map(c=>c.id));
 for(const old of existing)if(!used.has(old.id))updated.push({...old,pct:0});
 if(updated.length>45)throw Error('Досягнуто межі 45 категорій');
 if(updated.reduce((s,c)=>s+c.pct,0)!==100)throw Error('Помилка 100%');
 return updated;
}
function safePreview(amount,categories,transactions,w,date){
 if(!validInt(amount)||!Array.isArray(categories))throw Error('Некоректна сума');
 const monthly=String(date).slice(0,7);
 const funded=Object.fromEntries(categories.map(c=>[c.id,0]));
 for(const t of transactions||[]){if(!t.date?.startsWith(monthly))continue;
  if(t.type==='income'&&t.wallet===w || t.type==='owner'&&w==='personal')for(const a of t.allocations||[])if(Object.hasOwn(funded,a.id))funded[a.id]+=a.cents;
  if(t.type==='move'&&t.wallet===w){if(Object.hasOwn(funded,t.from))funded[t.from]-=t.cents;if(Object.hasOwn(funded,t.to))funded[t.to]+=t.cents;}
 }
 const plan=categories.map(c=>({id:c.id,cents:0}));let remaining=amount;
 const priority=categories.map((c,i)=>({...c,i})).filter(c=>c.kind==='protected'&&c.target>0).sort((a,b)=>(a.due||32)-(b.due||32)||a.i-b.i);
 for(const c of priority){const n=Math.min(remaining,Math.max(0,c.target-(funded[c.id]||0)));plan[c.i].cents+=n;remaining-=n;if(!remaining)break;}
 if(remaining){let eligible=categories.filter(c=>!(c.kind==='protected'&&c.target>0));if(!eligible.length)eligible=categories;
  let divisor=eligible.reduce((s,c)=>s+c.pct,0);
  if(!divisor){eligible=eligible.map(c=>({...c,pct:1}));divisor=eligible.length;}
  const weights=eligible.map((c,i)=>{const exact=remaining*c.pct/divisor;const n=Math.floor(exact);return {id:c.id,n,r:exact-n,i};});
  let residue=remaining-weights.reduce((s,a)=>s+a.n,0);for(const a of weights.slice().sort((a,b)=>b.r-a.r||a.i-b.i).slice(0,residue))a.n++;
  for(const a of weights)plan[categories.findIndex(c=>c.id===a.id)].cents+=a.n;
 }
 if(plan.reduce((s,a)=>s+a.cents,0)!==amount)throw Error('Помилка розподілу');return plan;
}
function projection(input){
 const {revenueCents,otherFamilyIncomeCents,rate,vatMode,businessCats,personalCats,businessTx=[],personalTx=[],today}=input;
 if(!validInt(revenueCents)||!validInt(otherFamilyIncomeCents)||!Number.isInteger(rate)||rate<0||rate>60||!['unknown','small','standard19'].includes(vatMode))throw Error('Параметри фінансової моделі некоректні');
 const vatCents=vatMode==='standard19'?Math.round(revenueCents*19/119):0;
 const netCents=revenueCents-vatCents;
 // Budget cash income is not an accounting tax base. This is solely an editable cash-flow scenario.
 const expenses=businessCats.filter(c=>!['business_tax','vat','business_reserve','owner'].includes(c.id)).reduce((s,c)=>s+(c.target||0),0);
 const profit=Math.max(0,netCents-expenses);
 const estimatedIncomeTax=Math.round(profit*rate/100);
 const reserveTarget=businessCats.find(c=>c.id==='business_reserve')?.target||0;
 const businessBuffer=reserveTarget||Math.round(netCents*0.10);
 const ownerMax=Math.max(0,netCents-expenses-estimatedIncomeTax-businessBuffer);
 const projectedBusiness= safePreview(revenueCents,businessCats,businessTx,'business',today);
 const ownerEnvelope=projectedBusiness.find(a=>a.id==='owner')?.cents||0;
 const taxEnvelope=projectedBusiness.find(a=>a.id==='business_tax')?.cents||0;
 const vatEnvelope=projectedBusiness.find(a=>a.id==='vat')?.cents||0;
 const ownerSuggestion=Math.min(ownerMax,ownerEnvelope);
 const famIncome=ownerSuggestion+otherFamilyIncomeCents;
 const familyProtectedNeeds=personalCats.filter(c=>c.kind==='protected').reduce((s,c)=>s+(c.target||0),0);
 const familyBalance=famIncome-familyProtectedNeeds;
 const familyPreview=safePreview(famIncome,personalCats,personalTx,'personal',today);
 const estimatedVatDifference=vatMode==='standard19'?Math.max(0,vatCents-vatEnvelope):0;
 return {revenueCents,netCents,vatCents,estimatedVatDifference,expenses,profit,estimatedIncomeTax,businessBuffer,ownerMax,ownerEnvelope,taxEnvelope,vatEnvelope,ownerSuggestion,projectedBusiness,famIncome,familyProtectedNeeds,familyBalance,familyPreview};
}
if(typeof module==='object'&&module.exports)module.exports={PRESET_CATEGORIES,MODEL_DEFAULT,mergePreset,safePreview,projection,asCents};
if(!root||!root.document)return;
const doc=root.document,api=root.SOLWalletAPI,vault=root.SOLVault;
if(!api||!vault)return;
let currentWallet='business',panel=null,previewOnly=false,templateMode={business:false,personal:false},workingModel=null;
function snapshot(){return api.snapshot();}
function toDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function stateWallet(){return currentWallet==='business'?'Бізнес BMH':'Сім’я';}
function mount(){
 const nav=doc.querySelector('.side .nav');if(nav&&!doc.getElementById('openBudgetPlan')){
  const btn=doc.createElement('button');btn.type='button';btn.id='openBudgetPlan';btn.innerHTML='<span class="ico">💶</span> Бюджет BMH + сім’я';
  nav.insertBefore(btn,nav.querySelector('[data-page="rules"]')||nav.lastElementChild);
  btn.addEventListener('click',openPanel);
 }
 panel=doc.createElement('section');panel.id='solBudgetOverlay';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Бюджет BMH і сім’ї');doc.body.appendChild(panel);
 panel.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  try{if(b.dataset.budgetClose!==undefined){closePanel();return;}
   if(b.dataset.budgetTab){collectInputs();currentWallet=b.dataset.budgetTab;renderPanel();return;}
   if(b.dataset.budgetAction==='showTemplate'){collectInputs();templateMode[currentWallet]=!templateMode[currentWallet];renderPanel();return;}
   if(b.dataset.budgetAction==='applyPreset')applyPreset().catch(showError);
   if(b.dataset.budgetAction==='savePlan')savePlan().catch(showError);
   if(b.dataset.budgetAction==='calc'){collectInputs();renderCalculation();}
  }catch(err){showError(err)}
 });
 panel.addEventListener('input',e=>{if(e.target.matches('[data-budget-value]')){try{collectInputs();renderCalculation()}catch(err){showError(err)}}});
 panel.addEventListener('change',e=>{if(e.target.matches('[data-budget-target]')){try{collectInputs();renderCalculation()}catch(err){showError(err)}}});
 doc.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)closePanel()});
 const originalLock=api.onLock;api.onLock=function(){closePanel();return originalLock.apply(this,arguments)};
}
function showError(err){const el=doc.getElementById('budgetError');if(el){el.textContent=err?.message||String(err);el.hidden=false;}}
function openPanel(){if(doc.querySelector('.app.locked'))return;currentWallet='business';templateMode={business:false,personal:false};workingModel=getModel(snapshot());panel.hidden=false;doc.body.classList.add('budget-open');renderPanel();panel.focus();}
function closePanel(){if(panel){panel.hidden=true;panel.textContent='';}doc.body.classList.remove('budget-open');workingModel=null;}
function visibleCategories(s,w){return templateMode[w]?mergePreset(s.wallets[w].categories,w):s.wallets[w].categories;}
function collectInputs(){
 if(!panel||panel.hidden||!workingModel)return;
 const rev=doc.getElementById('budgetRevenue');const family=doc.getElementById('budgetFamilyOther'),rate=doc.getElementById('budgetTaxRate'),vat=doc.getElementById('budgetVAT');
 if(rev&&rev.value.trim()!=='')workingModel.monthlyRevenueCents=asCents(rev.value);
 if(family&&family.value.trim()!=='')workingModel.otherFamilyIncomeCents=asCents(family.value);
 if(rate&&rate.value.trim()!==''){const n=Number(rate.value);if(!Number.isInteger(n)||n<0||n>60)throw Error('Для сценарію податку обери 0–60%.');workingModel.incomeTaxEstimatePercent=n;}
 if(vat)workingModel.vatMode=vat.value;
}
function allInputTargets(){const m={};for(const row of panel.querySelectorAll('[data-budget-category]')){const id=row.dataset.budgetCategory;const n=asCents(row.querySelector('[data-budget-target]').value||'0');m[id]=n;}return m;}
function modelContext(s){
 const b=visibleCategories(s,'business').map(c=>({...c})),f=visibleCategories(s,'personal').map(c=>({...c}));
 if(currentWallet==='business'&&panel.querySelector('[data-budget-category]')){const m=allInputTargets();for(const c of b)if(Object.hasOwn(m,c.id))c.target=m[c.id];}
 if(currentWallet==='personal'&&panel.querySelector('[data-budget-category]')){const m=allInputTargets();for(const c of f)if(Object.hasOwn(m,c.id))c.target=m[c.id];}
 return {businessCats:b,personalCats:f};
}
function renderPanel(){
 const s=snapshot();const cats=visibleCategories(s,currentWallet),isBusiness=currentWallet==='business';const p=workingModel||getModel(s);
 panel.innerHTML=`<div class="sol-budget-wrap" tabindex="-1">
 <div class="budget-top"><div><div class="eyebrow">SOL WALLET · БЮДЖЕТ 7.0</div><h2>Євровий бюджет BMH і сім’ї</h2><p>Цей розрахунок лише в євро. Гривневі надходження та цілі — у вкладці «Валюти € / ₴».</p></div><button class="budget-close" data-budget-close aria-label="Закрити бюджет">✕</button></div>
 <div class="budget-tabbar"><button data-budget-tab="business" class="${isBusiness?'selected':''}">🏢 Бізнес BMH</button><button data-budget-tab="personal" class="${!isBusiness?'selected':''}">🏠 Сім’я</button></div>
 <div class="budget-note">💡 0 € у місячній цілі означає <strong>«суму ще не внесено»</strong>, а не «це безкоштовно». Це план, не рух коштів. Фактичні гроші записуй у звичайному розділі «Надходження».</div>
 <div class="budget-grid"><section class="budget-card"><h3>1. Планові надходження</h3>
 <div class="budget-field"><label for="budgetRevenue">BMH: сума оплати від клієнтів за місяць, €</label><input id="budgetRevenue" data-budget-value type="number" min="0" step="0.01" inputmode="decimal" value="${centsToStr(p.monthlyRevenueCents)}"><small>За замовчуванням 1 000 € — лише приклад, не факт доходу</small></div>
 <div class="budget-field"><label for="budgetFamilyOther">Інші сімейні надходження, €</label><input id="budgetFamilyOther" data-budget-value type="number" min="0" step="0.01" inputmode="decimal" value="${centsToStr(p.otherFamilyIncomeCents)}"><small>Внось реальні зарплати, виплати та інші кошти окремо від переказу BMH</small></div>
 <div class="budget-field"><label for="budgetVAT">Режим ПДВ — тільки для моделювання</label><select id="budgetVAT" data-budget-value><option value="unknown" ${p.vatMode==='unknown'?'selected':''}>Не підтверджено</option><option value="small" ${p.vatMode==='small'?'selected':''}>Kleinunternehmer (§19 UStG)</option><option value="standard19" ${p.vatMode==='standard19'?'selected':''}>Звичайний продаж із 19% ПДВ</option></select><small>Міжнародні послуги й reverse charge можуть мати інші правила</small></div>
 <div class="budget-field"><label for="budgetTaxRate">Орієнтир резерву податку з прибутку, %</label><input id="budgetTaxRate" data-budget-value type="number" min="0" max="60" step="1" inputmode="numeric" value="${p.incomeTaxEstimatePercent}"><small>25% — лише сценарій, а не встановлена податкова ставка</small></div>
 </section>
 <section class="budget-card"><div class="budget-title-row"><h3>2. Категорії та щомісячні витрати</h3><button class="budget-minibtn" data-budget-action="showTemplate">${templateMode[currentWallet]?'↩ Мої категорії':'👀 Переглянути структуру'}</button></div>
 <p class="budget-small">${templateMode[currentWallet]?'Це попередній перегляд — зміни ще не застосовані.':'Редагуй реальні суми у своїх конвертах. Нові надходження будуть розподілятися за чинними правилами.'}</p>
 <div class="budget-rows">${cats.map(c=>`<div class="budget-row" data-budget-category="${escapeHTML(c.id)}"><div class="budget-cat"><span>${escapeHTML(c.icon)}</span><div><strong>${escapeHTML(c.name)}</strong><small>${c.pct}% від нових надходжень ${c.kind==='protected'?'· резерв':'· гнучкі'}</small></div></div><div class="budget-target"><label>€/міс.</label><input data-budget-target type="number" min="0" step="0.01" inputmode="decimal" value="${centsToStr(c.target)}"></div></div>`).join('')}</div>
 ${templateMode[currentWallet]?'<button class="budget-primary" data-budget-action="applyPreset">✅ Застосувати цю структуру</button>':'<button class="budget-primary" data-budget-action="savePlan">💾 Зберегти мої місячні суми та модель</button>'}
 <p class="budget-small">Для конкретних дат рахунків додай записи в «Календар платежів». Налаштування зберігаються в зашифрованому гаманці.</p>
 </section></div>
 <section class="budget-card budget-results"><h3>3. Розрахунок надходження і доступних грошей</h3><div id="budgetError" class="budget-error" hidden></div><div id="budgetNumbers"></div></section>
 <div class="budget-disclaimer">⚠️ Фінансове планування, не Steuerbescheid і не бухгалтерська EÜR. Зарплата працівників рахується з внесками роботодавця, виплата власнику BMH — окрема Privatentnahme. Податок залежить від реального прибутку й особистих обставин.</div>
 </div>`;
 renderCalculation();
}
function renderCalculation(){const out=doc.getElementById('budgetNumbers');if(!out||!workingModel)return;const s=snapshot();try{
 const {businessCats,personalCats}=modelContext(s);const ctx=projection({revenueCents:workingModel.monthlyRevenueCents,otherFamilyIncomeCents:workingModel.otherFamilyIncomeCents,rate:workingModel.incomeTaxEstimatePercent,vatMode:workingModel.vatMode,businessCats,personalCats,businessTx:s.transactions,personalTx:s.transactions,today:toDate()});
 const bs=businessCats.find(c=>c.id==='business_tax')?.name||'Резерв податку';const tiny=(txt)=>escapeHTML(txt);
 const businessRows=ctx.projectedBusiness.filter(x=>x.cents>0).map(x=>{const c=businessCats.find(z=>z.id===x.id);return `<div class="budget-calc-row"><span>${tiny(c?.icon||'📦')} ${tiny(c?.name||x.id)}</span><strong>${format(x.cents)}</strong></div>`}).join('');
 const personalRows=ctx.familyPreview.filter(x=>x.cents>0).map(x=>{const c=personalCats.find(z=>z.id===x.id);return `<div class="budget-calc-row"><span>${tiny(c?.icon||'📦')} ${tiny(c?.name||x.id)}</span><strong>${format(x.cents)}</strong></div>`}).join('');
 const vatMsg=workingModel.vatMode==='unknown'?'<div class="budget-warn">⚠️ ПДВ не підтверджено: розрахунок зараз вважає всю суму надходження доступною до розподілу. Це не підтвердження, що ПДВ не потрібно платити.</div>':workingModel.vatMode==='standard19'?`<div class="budget-warn">⚠️ Із ${format(ctx.revenueCents)} приблизно ${format(ctx.vatCents)} — ПДВ (для продажу з включеними 19%). Зараз у конверті ПДВ за планом ${format(ctx.vatEnvelope)}. ${ctx.estimatedVatDifference?'Не вистачає резерву — '+format(ctx.estimatedVatDifference)+'. ':''}Перед фактичним доходом налаштуй його окремо в правилах; розрахунок не враховує Vorsteuer.</div>`:'<div class="budget-tip">Режим Kleinunternehmer вибраний лише для моделі. Деякі іноземні послуги й придбання можуть створювати окремі ПДВ-зобов’язання.</div>';
 out.innerHTML=`<div class="budget-tiles"><div><small>Надходження BMH, приклад</small><strong>${format(ctx.revenueCents)}</strong></div><div><small>Бізнесові місячні цілі (без податків і резерву)</small><strong>${format(ctx.expenses)}</strong></div><div><small>Орієнтир податку з прогнозного прибутку</small><strong>${format(ctx.estimatedIncomeTax)}</strong></div><div><small>Сімейні фіксовані цілі</small><strong>${format(ctx.familyProtectedNeeds)}</strong></div></div>
 ${vatMsg}
 <div class="budget-calccols"><section><h4>🏢 Розподіл BMH за конвертами</h4>${businessRows||'<div class="budget-empty">Надходжень немає</div>'}<div class="budget-calc-total"><span>До конверта «Виплата собі»</span><strong>${format(ctx.ownerEnvelope)}</strong></div><p class="budget-small">За прогнозом прибутку й видатків верхня розрахункова межа вилучення — ${format(ctx.ownerMax)}. Рекомендований консервативний ліміт — ${format(ctx.ownerSuggestion)}. Це НЕ записаний переказ.</p><p class="budget-small">${tiny(bs)} за фактичним розподілом: ${format(ctx.taxEnvelope)}. Порівняй із орієнтовним розрахунком вище.</p></section>
 <section><h4>🏠 Сімейний бюджет: сценарій</h4>${personalRows||'<div class="budget-empty">Спочатку забезпеч сімейні надходження</div>'}<div class="budget-calc-total"><span>BMH → сім’я (можливий ліміт)</span><strong>${format(ctx.ownerSuggestion)}</strong></div><div class="budget-calc-total"><span>Інші сімейні надходження</span><strong>${format(workingModel.otherFamilyIncomeCents)}</strong></div><div class="budget-calc-total"><span>Після обов’язкових сімейних цілей</span><strong class="${ctx.familyBalance<0?'budget-bad':'budget-good'}">${format(ctx.familyBalance)}</strong></div><p class="budget-small">Теоретичні суми з моделі не переносяться в сім’ю автоматично. Зроби реальний «Виплатити собі» після надходження грошей.</p></section></div>
 ${ctx.familyBalance<0?`<div class="budget-warn">Планова нестача сім’ї — ${format(-ctx.familyBalance)}. Спочатку покрий оренду, продукти та обов’язкові внески; кафе й розваги не фінансуємо понад залишок.</div>`:''}
 ${ctx.expenses>ctx.netCents?'<div class="budget-warn">Витрати бізнесу перевищують поточне надходження. Не виводь кошти власнику, доки не уточниш покриття.</div>':''}
 <div class="budget-tip">Розподіл за конвертами — це правило для надходжень. Оцінка прибутку й податків — окремий сценарій. Щоб вони збігалися, налаштуй реальні місячні суми та ставки в правилах. Операції й баланс від перегляду не змінюються.</div>`;
 const err=doc.getElementById('budgetError');if(err)err.hidden=true;
 }catch(e){out.textContent='Уточни суми, щоб перерахувати сценарій.';showError(e)}
}
async function persistState(s){api.validate(s);await vault.persist(s);api.afterRestore(s);}
async function savePlan(){collectInputs();const s=snapshot();const rows=panel.querySelectorAll('[data-budget-category]');if(!rows.length)throw Error('Немає категорій');const map=allInputTargets();for(const cat of s.wallets[currentWallet].categories)if(Object.hasOwn(map,cat.id))cat.target=map[cat.id];s.budgetModel={...workingModel,version:1};await persistState(s);renderPanel();const el=doc.getElementById('budgetError');if(el){el.textContent='✅ План збережено зашифровано. Старі операції не змінені.';el.hidden=false;}}
async function applyPreset(){collectInputs();if(!templateMode[currentWallet])return;const w=currentWallet;if(!root.confirm('Додати й оновити бюджетні категорії '+stateWallet()+'? Відсотки зміняться тільки для МАЙБУТНІХ надходжень. Усі старі операції та суми у конвертах залишаться.'))return;const s=snapshot();const cats=mergePreset(s.wallets[w].categories,w),input=allInputTargets();for(const c of cats)if(Object.hasOwn(input,c.id))c.target=input[c.id];s.wallets[w].categories=cats;s.budgetModel={...workingModel,version:1};await persistState(s);templateMode[w]=false;renderPanel();const el=doc.getElementById('budgetError');if(el){el.textContent='✅ Структуру оновлено. Старі кошти й операції не змінено.';el.hidden=false;}}
mount();
})(typeof window==='object'?window:null);