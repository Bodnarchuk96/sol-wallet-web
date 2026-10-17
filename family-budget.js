/* SOL Wallet 10 — family spending assistant, without personal financial data in source.
 * All real entries go through the existing encrypted SOL Wallet ledger.
 * Preview and the 40/30/20/10 proposal NEVER create bank or ledger transactions.
 */
(function(root){
'use strict';
const C=root?.SOLCurrency||(typeof module==='object'&&module.exports?require('./currency-core.js'):null);
const esc=x=>String(x??'').replace(/[&<>"']/g,t=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[t]));
const validMonth=x=>typeof x==='string'&&/^(20[2-9]\d)-(0[1-9]|1[0-2])$/.test(x);
const zero=n=>Math.max(0,n||0);
let month=C?C.dateNow().slice(0,7):'2026-10';
let scenario={amount:'',kind:'income',category:''};
let saving=false;
function propose(cents){
 if(!Number.isSafeInteger(cents)||cents<0)throw Error('Неправильна сума для розподілу');
 const parts=[40,30,20,10].map(p=>Math.floor(cents*p/100));
 let left=cents-parts.reduce((a,n)=>a+n,0);
 for(let i=0;left>0;i=(i+1)%parts.length,left--)parts[i]++;
 return parts;
}
function summarize(s,c,period){
 if(!C||!s||!s.wallets?.personal||!['EUR','UAH'].includes(c)||!validMonth(period))throw Error('Неправильний сімейний період або валюта');
 const cats=s.wallets.personal.categories;
 const balances=C.balances(s)[c].personal;
 const accounts=C.accountBalances(s)[c].personal;
 const l=C.ledger(s);
 const limits=l.familyLimits?.[c]||{};
 const spend=Object.fromEntries(cats.map(x=>[x.id,0]));
 let income=0,opening=0,owner=0,expense=0,exchangeOut=0,exchangeIn=0,commissions=0;
 const personalIncome=x=>{if(x.familyKind==='opening')opening+=x.cents;else income+=x.cents;};
 if(c==='EUR')for(const t of s.transactions){
  if(!t.date.startsWith(period))continue;
  if(t.type==='income'&&t.wallet==='personal')personalIncome(t);
  if(t.type==='owner')owner+=t.cents;
  if(t.type==='expense'&&t.wallet==='personal'){
   expense+=t.cents;spend[t.category]=(spend[t.category]||0)+t.cents;
   if(t.expenseKind==='fee')commissions+=t.cents;
  }
 }
 for(const e of l.events){
  if(!e.date.startsWith(period))continue;
  if(e.type==='exchange'&&e.wallet==='personal'){
   if(e.fromCurrency===c)exchangeOut+=e.fromCents;
   if(e.toCurrency===c)exchangeIn+=e.toCents;
  }
  if(c!=='UAH')continue;
  if(e.type==='uah_income'&&e.wallet==='personal')personalIncome(e);
  if(e.type==='uah_owner')owner+=e.cents;
  if(e.type==='uah_expense'&&e.wallet==='personal'){
   expense+=e.cents;spend[e.category]=(spend[e.category]||0)+e.cents;
   if(e.expenseKind==='fee')commissions+=e.cents;
  }
 }
 const catRows=cats.map(cat=>{
  const spent=spend[cat.id]||0,available=zero(balances[cat.id]);
  const limit=limits[cat.id]||0;
  const remaining=limit?Math.max(0,limit-spent):null;
  return {id:cat.id,name:cat.name,icon:cat.icon,kind:cat.kind,pct:cat.pct,spent,available,limit,remaining,overspent:limit>0&&spent>limit,maySpend:Math.min(available,remaining===null?available:remaining)};
 });
 const accountInfo={card:0,cash:0,unassigned:accounts['']||0};
 for(const a of l.accounts.filter(x=>x.wallet==='personal'&&x.currency===c)){
  if(a.kind==='cash')accountInfo.cash+=accounts[a.id]||0;
  else accountInfo.card+=accounts[a.id]||0;
 }
 const available=C.sumWallet(C.balances(s),c,'personal');
 return {currency:c,month:period,income,opening,owner,expense,commissions,exchangeOut,exchangeIn,available,accounts:accountInfo,
  reserve:catRows.filter(x=>x.id==='reserve'||/резерв|подушк/i.test(x.name)).reduce((n,x)=>n+x.available,0),
  categories:catRows,overspends:catRows.filter(x=>x.overspent),proposal:propose(zero(available))};
}
function htmlRows(s,c){
 const z=summarize(s,c,month),m=n=>C.money(n,c);
 return z.categories.map(x=>'<div class="sf-limit-row'+(x.overspent?' sf-exceeded':'')+'"><div class="sf-limit-name"><strong>'+esc(x.icon)+' '+esc(x.name)+'</strong><small>Витрачено: '+esc(m(x.spent))+' · конверт: '+esc(m(x.available))+'</small>'+
 (x.overspent?'<small class="sf-alert">Перевищення: '+esc(m(x.spent-x.limit))+'</small>':'')+
 (x.limit?'<small>Ще в межах ліміту: '+esc(m(x.maySpend))+'</small>':'<small>Ліміт не встановлено</small>')+
 '</div><label class="sf-input-small">Ліміт / місяць<input type="text" inputmode="decimal" autocomplete="off" name="lim_'+esc(x.id)+'" value="'+(x.limit?C.amt(x.limit):'')+'" placeholder="Без ліміту"></label></div>').join('');
}
function view(s,c){
 if(!root?.document)return '';
 const z=summarize(s,c,month),m=n=>C.money(n,c);
 if(!s.wallets.personal.categories.some(q=>q.id===scenario.category))scenario.category=s.wallets.personal.categories.find(q=>q.id==='groceries')?.id||s.wallets.personal.categories[0].id;
 const categoryOptions=s.wallets.personal.categories.map(cat=>'<option value="'+esc(cat.id)+'"'+(scenario.category===cat.id?' selected':'')+'>'+esc(cat.name)+'</option>').join('');
 const headings=['🛟 Резерв','🛒 Продукти й побут','📋 Обов’язкові платежі','👧 Діти та необхідне'];
 const split=headings.map((txt,i)=>'<div class="sf-smallrow"><span>'+txt+'</span><strong>'+esc(m(z.proposal[i]))+'</strong></div>').join('');
 return '<section class="mc-card sf-card" id="familyBudget"><div class="sf-top"><div><h3>🏠 Живий сімейний бюджет · '+esc(c)+'</h3><p class="mc-tip">Тільки сім’я; BMH не враховується. Дані із зашифрованого гаманця, не прямий доступ до банку.</p></div><label class="sf-month">Місяць<input type="month" name="sfMonth" min="2020-01" max="2099-12" value="'+esc(month)+'"></label></div>'+
 '<div class="sf-metrics"><div><small>Надійшло за місяць</small><strong>'+esc(m(z.income))+'</strong></div><div><small>Покупки й оплати</small><strong>'+esc(m(z.expense))+'</strong></div><div><small>Залишок у гаманці</small><strong>'+esc(m(z.available))+'</strong></div><div><small>Понад ліміт</small><strong class="'+(z.overspends.length?'sf-alert':'')+'">'+z.overspends.length+' категорій</strong></div></div>'+
 '<div class="sf-smallrow"><span>На картках/рахунках (записи)</span><strong>'+esc(m(z.accounts.card))+'</strong></div>'+
 '<div class="sf-smallrow"><span>Готівка (позначені готівкові рахунки)</span><strong>'+esc(m(z.accounts.cash))+'</strong></div>'+
 '<div class="sf-smallrow"><span>Ще не прив’язано до рахунку</span><strong>'+esc(m(z.accounts.unassigned))+'</strong></div>'+
 (z.opening?'<p class="mc-tip">Початковий баланс '+esc(m(z.opening))+' не врахований як новий дохід.</p>':'')+
 (z.owner?'<p class="mc-tip">Перекази BMH → сім’я: '+esc(m(z.owner))+' (не додаються вдруге до сімейного доходу).</p>':'')+
 (z.exchangeOut||z.exchangeIn?'<p class="mc-tip">Обмін / зняття готівки: −'+esc(m(z.exchangeOut))+' / +'+esc(m(z.exchangeIn))+' у цій валюті. Це не покупки.</p>':'')+
 '<div class="sf-divider"></div><h4>🧮 Вкажи суму — отримай розрахунок</h4>'+
 '<div class="sf-scenario" id="sfScenarioForm"><label class="mc-field">Сума, '+esc(c)+'<input name="sfAmount" type="text" inputmode="decimal" autocomplete="off" placeholder="Наприклад, 1000,00" value="'+esc(scenario.amount)+'"></label>'+
 '<label class="mc-field">Що перевіряємо?<select name="sfKind"><option value="income"'+(scenario.kind==='income'?' selected':'')+'>Повернення коштів / нове надходження</option><option value="expense"'+(scenario.kind==='expense'?' selected':'')+'>Майбутня покупка / оплата</option></select></label>'+
 '<label class="mc-field" id="sfCategoryRow">Категорія покупки<select name="sfCategory">'+categoryOptions+'</select></label></div>'+
 '<div id="sfScenarioPreview" class="sf-preview" aria-live="polite">Введи суму, щоб побачити результат без запису операції.</div>'+
 '<div class="sf-buttons"><button type="button" class="mc-action" data-sf-go="income">＋ Записати надходження</button><button type="button" class="mc-action" data-sf-go="expense">− Записати покупку</button><button type="button" class="mc-action" data-sf-go="cash">💶 Зняття / обмін</button></div>'+
 '<div class="sf-divider"></div><h4>📌 Пропозиція розподілу поточного залишку</h4>'+split+
 '<p class="mc-tip">40% резерв / 30% побут / 20% платежі / 10% діти — лише рекомендований сценарій для залишку '+esc(c)+', не нові гроші й не переказ між конвертами. Перевір обов’язкові рахунки окремо.</p>'+
 '<div class="sf-divider"></div><details class="sf-details"><summary>🚦 Налаштувати місячні ліміти витрат</summary><form id="sfLimitsForm"><h4>🚦 Ліміти витрат за категоріями</h4><p class="mc-tip">Залиш порожнім — ліміту немає. Перевитрата показується лише після встановлення ліміту; фактичні витрати беруться з історії.</p>'+
 htmlRows(s,c)+'<button type="submit" class="mc-submit">💾 Зберегти сімейні ліміти · '+esc(c)+'</button><div id="sfSaveMsg" class="mc-msg" hidden role="status"></div></form></details>'+
 '<p class="mc-tip">💡 При оплаті українською карткою у євро запиши фактичне списання у ₴ лише один раз; суму з чека € можна вказати додатково. Готівку записуй через обмін на рахунок типу «Готівка».</p></section>';
}
function updatePreview(panel,s,c){
 const form=panel?.querySelector('#sfScenarioForm'),out=panel?.querySelector('#sfScenarioPreview');
 if(!form||!out)return;
 const a=form.querySelector('[name="sfAmount"]'),k=form.querySelector('[name="sfKind"]'),ct=form.querySelector('[name="sfCategory"]');
 scenario={amount:a.value,kind:k.value,category:ct.value};
 panel.querySelector('#sfCategoryRow').hidden=scenario.kind!=='expense';
 if(!scenario.amount.trim()){out.textContent='Введи суму, щоб отримати миттєвий розрахунок. Поки що баланс не змінено.';return;}
 try{
  const n=C.parse(scenario.amount),z=summarize(s,c,month),m=x=>C.money(x,c);
  if(scenario.kind==='income'){
   const plan=c==='UAH'?C.allocateUAH(s,'personal',n,C.dateNow()):root?.SOLWalletAPI?.currencyPlan('personal',n,C.dateNow());
   if(!plan)throw Error('Спочатку розблокуй гаманець');
   out.innerHTML='<strong>Після надходження буде '+esc(m(z.available+n))+'</strong><p class="mc-tip">Розподіл за чинними правилами твоїх конвертів:</p>'+
    plan.filter(x=>x.cents>0).map(x=>'<div class="sf-smallrow"><span>'+esc(s.wallets.personal.categories.find(v=>v.id===x.id)?.name||x.id)+'</span><strong>'+esc(m(x.cents))+'</strong></div>').join('')+
    '<p class="mc-tip">Це лише перегляд. Щоб зарахувати гроші, натисни «Записати надходження», вибери рахунок і збережи.</p>';
  }else{
   const row=z.categories.find(x=>x.id===scenario.category);
   if(!row)throw Error('Обери категорію');
   const alerts=[];
   if(n>row.available)alerts.push('У конверті недостатньо коштів.');
   if(row.limit&&n>Math.max(0,row.limit-row.spent))alerts.push('Ця покупка перевищить місячний ліміт.');
   out.innerHTML='<strong>Після покупки залишиться '+esc(m(z.available-n))+'</strong><p>Категорія: '+esc(row.name)+'. Зараз доступно '+esc(m(row.available))+'</p>'+
     (alerts.length?'<p class="sf-alert">'+esc(alerts.join(' '))+'</p>':'<p class="mc-tip">Сума вкладається у залишок конверта'+(row.limit?' та встановлений ліміт':' (ліміт не встановлено)')+'.</p>')+
     '<p class="mc-tip">Прогноз не списує гроші. Реальну покупку запиши окремо з фактичною сумою банківського списання.</p>';
  }
 }catch(err){out.textContent=err.message||'Введи коректну суму';}
}
function setMonth(value){if(!validMonth(value))throw Error('Оберіть правильний місяць');month=value;}
function getScenario(){return {...scenario};}
async function saveLimits(form,c,render){
 if(saving)return;
 const message=form.querySelector('#sfSaveMsg'),btn=form.querySelector('[type="submit"]');
 saving=true;if(btn)btn.disabled=true;
 try{
  const s=root.SOLWalletAPI.snapshot(),l=C.ensure(s);
  if(!l.familyLimits)l.familyLimits={EUR:{},UAH:{}};
  if(!l.familyLimits[c])l.familyLimits[c]={};
  for(const cat of s.wallets.personal.categories){
   const input=form.elements.namedItem('lim_'+cat.id),raw=String(input?.value||'').trim();
   const n=raw===''||/^0+(?:[,.]0{1,2})?$/.test(raw)?0:C.parse(raw);
   if(n)l.familyLimits[c][cat.id]=n;else delete l.familyLimits[c][cat.id];
  }
  root.SOLWalletAPI.validate(s);
  await root.SOLVault.persist(s);
  root.SOLWalletAPI.afterRestore(s);
  render();
 }catch(err){
  if(message){message.hidden=false;message.classList.add('error');message.textContent='⚠️ '+(err.message||String(err));}
 }finally{saving=false;if(btn)btn.disabled=false;}
}
const exported={summarize,propose,view,updatePreview,setMonth,getScenario,saveLimits};
if(typeof module==='object'&&module.exports)module.exports=exported;
if(root)root.SOLFamilyBudget=exported;
})(typeof window==='object'?window:null);
