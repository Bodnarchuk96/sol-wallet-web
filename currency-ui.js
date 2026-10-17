/* SOL Wallet 8: dual-currency user interface. The EUR ledger and encrypted vault remain intact. */
(function(root){
'use strict';
if(!root||!root.document||!root.SOLCurrency||!root.SOLWalletAPI||!root.SOLVault)return;
const d=root.document,C=root.SOLCurrency,api=root.SOLWalletAPI,vault=root.SOLVault;
const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const labels={business:'🏢 Бізнес BMH',personal:'🏠 Сім’я',EUR:'€ Євро',UAH:'₴ Гривня'};
let wallet='business',currency='EUR',mode='income',panel,busy=false;
const sn=()=>api.snapshot(), catName=(s,w,id)=>s.wallets[w].categories.find(c=>c.id===id)?.name||id;
const accountName=(s,id)=>C.ledger(s).accounts.find(a=>a.id===id)?.name||'Не вказано';
const dateField=()=>'<label class="mc-field">Дата<input name="date" type="date" value="'+esc(C.dateNow())+'" required></label>';
const noteField=(placeholder='Джерело, призначення чи коментар')=>'<label class="mc-field">Коментар<input name="note" type="text" maxlength="250" placeholder="'+esc(placeholder)+'"></label>';
const moneyField=(name,label)=>'<label class="mc-field">'+label+'<input name="'+name+'" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" required></label>';
function accountOptions(s,w,c,name,title,required=false){
 const arr=C.ledger(s).accounts.filter(a=>a.wallet===w&&a.currency===c);
 return '<label class="mc-field">'+esc(title)+'<select name="'+name+'">'+(required?'':'<option value="">Не вказувати рахунок</option>')+arr.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>').join('')+'</select></label>';
}
function catOptions(s,w,name,title,b){
 return '<label class="mc-field">'+esc(title)+'<select name="'+name+'">'+s.wallets[w].categories.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.icon)+' '+esc(c.name)+' · '+esc(C.money((b[c.id]||0),currency))+'</option>').join('')+'</select></label>';
}
function partOptions(s,w,name,title){
 return '<label class="mc-field">'+esc(title)+'<select name="'+name+'">'+s.wallets[w].categories.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.icon)+' '+esc(c.name)+'</option>').join('')+'</select></label>';
}
function tiles(s,b){return ['business','personal'].map(w=>['EUR','UAH'].map(c=>'<button type="button" class="mc-total" data-mc-wallet="'+w+'" data-mc-currency="'+c+'" aria-pressed="'+(w===wallet&&c===currency)+'"><small>'+labels[w]+' · '+labels[c]+'</small><strong>'+C.money(C.sumWallet(b,c,w),c)+'</strong></button>').join('')).join('');}
function accountsBlock(s){
 const ab=C.accountBalances(s)[currency][wallet],items=C.ledger(s).accounts.filter(a=>a.wallet===wallet&&a.currency===currency);
 return '<section class="mc-card"><h3>💳 Картки та рахунки</h3><p class="mc-tip">Це назви для ручного обліку, не підключення до банку. Старі єврові операції залишаються в «Без прив’язки».</p>'
 + '<div class="mc-account"><span>Без прив’язки</span><strong>'+C.money(ab['']||0,currency)+'</strong></div>'
 + items.map(a=>'<div class="mc-account"><span>'+(a.kind==='cash'?'💵 ':'💳 ')+esc(a.name)+'</span><strong>'+C.money(ab[a.id]||0,currency)+'</strong></div>').join('')
 + '<button class="mc-action" data-mc-action="account">＋ Додати картку / рахунок</button></section>';
}
function sourceOptions(s,w,c){
 const sources=(C.ledger(s).sources||[]).filter(q=>q.wallet===w&&q.currency===c);
 return '<label class="mc-field">Звідки прийшли кошти<select name="source"><option value="">Інше / разове надходження</option>'+sources.map(q=>'<option value="'+esc(q.id)+'">'+esc(q.name)+(q.frequency==='monthly'?' · щомісяця':'')+'</option>').join('')+'</select></label>';
}
function sourcesBlock(s){
 const sources=(C.ledger(s).sources||[]).filter(q=>q.wallet===wallet&&q.currency===currency);
 const projected=sources.filter(q=>q.frequency==='monthly').reduce((sum,q)=>sum+q.expectedCents,0);
 return '<section class="mc-card mc-sources"><h3>📥 Джерела надходжень · '+labels[currency]+'</h3><p class="mc-tip">Збережи клієнта, роботу чи платформу. Планова сума — лише очікування, не баланс. Реальні гроші потрібно записувати вручну.</p>'+
 (sources.length?sources.map(q=>'<div class="mc-account"><span>'+esc(q.name)+'<small style="display:block;color:#8faebc">'+(q.frequency==='monthly'?'Щомісяця':q.frequency==='once'?'Разове':'Нерегулярне')+' · '+esc(accountName(s,q.accountId))+'</small></span><strong>'+(q.expectedCents?C.money(q.expectedCents,currency):'Без плану')+'</strong></div>').join(''):'<p class="mc-tip">Поки що жодного джерела не створено.</p>')+
 (projected?'<p class="mc-tip">Орієнтовні регулярні надходження: '+C.money(projected,currency)+' на місяць. До доступних грошей не додано.</p>':'')+
 '<button type="button" class="mc-action" data-mc-action="source">＋ Додати джерело доходу</button></section>';
}
function rows(s,b){
 return s.wallets[wallet].categories.map(c=>'<div class="mc-cat"><div class="mc-cat-name">'+esc(c.icon)+'<div>'+esc(c.name)+'<span>'+c.pct+'% · '+(c.kind==='protected'?'резерв':'гнучкі кошти')+'</span></div></div><b>'+C.money(b[c.id],currency)+'</b></div>').join('');
}
function history(s){
 const lines=[];
 for(const t of s.transactions){if(currency!=='EUR')continue;
  if(t.type==='owner'&&wallet==='business')lines.push({date:t.date,n:-t.cents,text:'Переказ власнику',extra:t.note});
  else if(t.type==='owner'&&wallet==='personal')lines.push({date:t.date,n:t.cents,text:'Отримано від BMH',extra:t.note});
  else if(t.wallet===wallet)lines.push({date:t.date,n:t.type==='income'?t.cents:t.type==='expense'?-t.cents:0,text:(t.type==='income'?'Надходження':t.type==='expense'?'Витрата':'Перерозподіл')+' · '+(t.category?catName(s,wallet,t.category):''),extra:t.note||''});
 }
 for(const e of C.ledger(s).events){
  if(e.type==='exchange'&&e.wallet===wallet){
   if(e.fromCurrency===currency)lines.push({date:e.date,n:-e.fromCents,text:'Обмін → '+e.toCurrency,extra:e.note});
   if(e.toCurrency===currency)lines.push({date:e.date,n:e.toCents,text:'Обмін ← '+e.fromCurrency,extra:e.note});
  }
  if(e.type==='account_transfer'&&e.wallet===wallet&&e.currency===currency)lines.push({date:e.date,n:0,text:'Між рахунками',extra:accountName(s,e.fromAccountId)+' → '+accountName(s,e.toAccountId)});
  if(currency!=='UAH')continue;
  if(e.type==='uah_owner'&&wallet==='business')lines.push({date:e.date,n:-e.cents,text:'Виплата власнику',extra:e.note});
  if(e.type==='uah_owner'&&wallet==='personal')lines.push({date:e.date,n:e.cents,text:'Отримано від BMH',extra:e.note});
  if(e.wallet===wallet&&['uah_income','uah_expense','uah_move'].includes(e.type))lines.push({date:e.date,n:e.type==='uah_income'?e.cents:e.type==='uah_expense'?-e.cents:0,text:e.type==='uah_income'?'Надходження':e.type==='uah_expense'?'Витрата':'Перерозподіл',extra:e.note+(e.merchantCents?' · чек: '+C.money(e.merchantCents,'EUR'):'')});
 }
 return lines.slice(-40).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,17).map(x=>'<div class="mc-hist"><div>'+esc(x.text)+'<small>'+esc(x.date)+' · '+esc(x.extra||'—')+'</small></div><strong class="'+(x.n>0?'mc-positive':x.n<0?'mc-negative':'mc-zero')+'">'+(x.n>0?'+':'')+C.money(x.n,currency)+'</strong></div>').join('')||'<p class="mc-tip">Операцій у цій валюті ще немає.</p>';
}
function formFor(s,b){
 const other=currency==='EUR'?'UAH':'EUR',ca=s.wallets[wallet].categories,defaultFrom=ca.find(c=>(b[c.id]||0)>0)?.id||ca[0].id;
 const acts=['income','source','expense','move','owner','fx','accountMove','targets','account'];
 const captions={income:'＋ Надходження',source:'＋ Джерело доходу',expense:'− Витрата',move:'⇄ Конверти',owner:'↗ Виплатити собі',fx:'💱 Обмін EUR / UAH',accountMove:'🏦 Між рахунками',targets:'🎯 Місячні цілі ₴',account:'＋ Новий рахунок'};
 let form='',intro='';
 const options='<div class="mc-actions">'+acts.map(k=>'<button type="button" class="mc-action'+(mode===k?' active':'')+'" data-mc-action="'+k+'">'+captions[k]+'</button>').join('')+'</div>';
 if(mode==='income'){
  intro='Отримані гроші будуть автоматично поділені між конвертами <b>'+labels[wallet]+' · '+labels[currency]+'</b>.';
  form=sourceOptions(s,wallet,currency)+(wallet==='personal'?'<label class="mc-field">Тип сімейних коштів<select name="familyKind"><option value="regular">Звичайне сімейне надходження</option><option value="refund">Повернення моїх коштів</option><option value="opening">Початковий баланс (не новий дохід)</option></select></label>':'')+moneyField('amount','Надійшло, '+currency)+'<div class="mc-two">'+dateField()+accountOptions(s,wallet,currency,'account','Куди надійшли')+'</div>'+noteField('Клієнт, виплата, стартовий баланс')+'<div class="mc-allocation" id="mcAllocation">Введи суму для попереднього розподілу.</div>';
 }else if(mode==='source'){
 intro='Джерело — лише шаблон. Реальні надходження зараховуються окремо через кнопку «Надходження». Не заповнюй чужих реквізитів чи номерів карток.';
 form='<label class="mc-field">Назва джерела<input name="sourceName" maxlength="90" required placeholder="Клієнт BMH, платформа, зарплата..."></label>'+
 '<label class="mc-field">Як часто<select name="frequency"><option value="irregular">Нерегулярно</option><option value="monthly">Щомісяця</option><option value="once">Разово</option></select></label>'+
 '<label class="mc-field">Очікувано на місяць, '+currency+' (необов’язково)<input name="expected" inputmode="decimal" placeholder="0,00"></label>'+
 accountOptions(s,wallet,currency,'account','Картка за замовчуванням (за бажанням)')+
 '<div class="mc-note">💡 Шаблон не створює доходу та не змінює суму в гаманці. Сума тут — лише прогноз.</div>';
}else if(mode==='expense'){
  intro='Записана витрата зменшить вибраний конверт <b>лише в '+currency+'</b>.';
  form=catOptions(s,wallet,'category','З якого конверта',b)+moneyField('amount','Фактично списано, '+currency)+'<div class="mc-two">'+dateField()+accountOptions(s,wallet,currency,'account','З якого рахунку')+'</div>'+
 (wallet==='personal'?'<label class="mc-field">Тип витрати<select name="expenseKind"><option value="purchase">Покупка / оплата</option><option value="fee">Банківська комісія</option><option value="other">Інше</option></select></label>':'')+
 (wallet==='personal'&&currency==='UAH'?'<label class="mc-field">Якщо ціна на чеку у € (довідково, необов’язково)<input name="merchantEUR" type="text" inputmode="decimal" autocomplete="off" placeholder="Наприклад, 12,00"></label><div class="mc-tip">У баланс списується тільки реальна сума у ₴. Євро з чека НЕ списуються вдруге.</div>':'')+noteField('Магазин / на що витрачено');
 }else if(mode==='move'){
  intro='Перерозподіл усередині '+currency+'. Загальна сума не змінюється.';
  form=catOptions(s,wallet,'from','З конверта',b)+partOptions(s,wallet,'to','До конверта')+moneyField('amount','Сума, '+currency)+dateField()+noteField();
 }else if(mode==='owner'){
  intro='Приватне вилучення BMH → сім’я <b>без зміни валюти</b>. Це не зарплата власника.';
  form=moneyField('amount','Виплата власнику, '+currency)+'<div class="mc-two">'+accountOptions(s,'business',currency,'fromAccount','Рахунок BMH')+accountOptions(s,'personal',currency,'toAccount','Сімейний рахунок')+'</div>'+dateField()+noteField('Переказ собі')+'<div class="mc-allocation" id="mcAllocation">Введи суму для розподілу сім’ї.</div>';
 }else if(mode==='fx'){
  intro='Записуй тільки <b>фактично виконаний обмін</b>. Дві суми — скільки списано та скільки реально зараховано після комісій. Курсу система не вигадує.';
  form='<div class="mc-two">'+moneyField('fromAmount','Списано, '+currency)+moneyField('toAmount','Отримано, '+other)+'</div>'
  +catOptions(s,wallet,'fromCategory','Де зменшити '+currency,b)+partOptions(s,wallet,'toCategory','Де додати '+other)
  +'<div class="mc-two">'+accountOptions(s,wallet,currency,'fromAccount','Картка списання '+currency)+accountOptions(s,wallet,other,'toAccount','Картка зарахування '+other)+'</div>'
  +dateField()+noteField('Обмін/банк/комісія за курсом')+'<div id="mcRate" class="mc-note">Фактичний курс визначиться з двох сум. Жодного автоматичного обміну немає.</div>';
 }else if(mode==='account'){
  intro='Додай коротку назву (наприклад, «ПриватБанк UAH»). Номер картки чи IBAN не потрібні.';
  form='<label class="mc-field">Назва картки / рахунку<input name="accountName" maxlength="90" placeholder="Наприклад, Моя картка або Готівка €" required></label><label class="mc-field">Тип рахунку<select name="accountKind"><option value="card">Картка / банківський рахунок</option><option value="cash">Готівка</option><option value="other">Інший</option></select></label>';
 }else if(mode==='accountMove'){
  intro='Познач переміщення між двома картками тієї самої валюти. Конверти не зміняться.';
  const a=C.ledger(s).accounts.filter(x=>x.wallet===wallet&&x.currency===currency);
  form=a.length<2?'<div class="mc-warning">Спочатку створи принаймні два рахунки для цієї валюти.</div>':
  '<div class="mc-two">'+accountOptions(s,wallet,currency,'fromAccount','З рахунку',true)+accountOptions(s,wallet,currency,'toAccount','На рахунок',true)+'</div>'+moneyField('amount','Сума, '+currency)+dateField()+noteField();
 }else if(mode==='targets'){
  intro=currency==='UAH'?'Гривневі цілі незалежні від єврових. Обов’язкові цілі ₴ фінансуються перед розподілом решти за відсотками.':'Єврові місячні цілі вже налаштовуються у «Бюджет BMH + сім’я».';
  if(currency==='UAH')form='<div>'+ca.map(c=>'<div class="mc-target-row"><label>'+esc(c.icon)+' '+esc(c.name)+'</label><input class="mc-target" name="target_'+esc(c.id)+'" inputmode="decimal" value="'+C.amt(C.ledger(s).uahTargets[wallet]?.[c.id]||0)+'"></div>').join('')+'</div>';
  else form='<button type="button" class="mc-action" data-mc-budget="1">Відкрити євровий бюджет →</button>';
 }
 const hasSubmit=mode!=='targets'||currency==='UAH';
 return '<div class="mc-card"><h3>Операція · '+esc(captions[mode])+'</h3>'+options+'<div class="mc-tip">'+intro+'</div><div class="mc-msg" id="mcMessage" hidden></div>'
 +'<form id="mcForm">'+form+(hasSubmit?'<button class="mc-submit" type="submit">💾 '+(mode==='account'?'Зберегти рахунок':mode==='targets'?'Зберегти гривневі цілі':mode==='fx'?'Записати обидві сторони обміну':'Зберегти операцію')+'</button>':'')+'</form></div>';
}
function render(message='',error=false){
 if(!panel||panel.hidden)return;
 const s=sn(),b=C.balances(s),now=b[currency][wallet];
 panel.innerHTML='<div class="mc-shell"><div class="mc-header"><div><div class="mc-muted">SOL WALLET · MULTI-CURRENCY 9.0</div><h2>💶 Євро + гривня</h2><p>Дві валюти, дві сфери життя. Жодного змішування сум без реальної конвертації.</p></div><button class="mc-close" data-mc-close aria-label="Закрити">✕</button></div>'
 +'<div class="mc-grid4">'+tiles(s,b)+'</div>'
 +'<div class="mc-controls"><div class="mc-tabs">'+['business','personal'].map(w=>'<button data-mc-wallet="'+w+'" class="'+(w===wallet?'active':'')+'">'+labels[w]+'</button>').join('')+'</div>'
 +'<div class="mc-tabs">'+['EUR','UAH'].map(c=>'<button data-mc-currency="'+c+'" class="'+(c===currency?'active':'')+'">'+labels[c]+'</button>').join('')+'</div></div>'
 +'<div class="mc-note">📌 '+labels[wallet]+' · '+labels[currency]+': <b>'+C.money(C.sumWallet(b,currency,wallet),currency)+'</b>. Євро й гривні не підсумовуються. Введені суми — ручний облік, не залишки банку.</div>'
  +(wallet==='personal'?(root.SOLFamilyBudget?.view(s,currency)||''):'')
  +'<div class="mc-content"><div><section class="mc-card"><h3>📦 Конверти · '+labels[currency]+'</h3>'+rows(s,now)+'</section>'
 +'<div style="margin-top:13px">'+accountsBlock(s)+'</div><div style="margin-top:13px">'+sourcesBlock(s)+'</div></div><div>'+formFor(s,now)+'</div></div>'
 +'<section class="mc-card mc-history"><h3>🧾 Останні записи · '+labels[currency]+'</h3>'+history(s)+'</section>'
 +'<div class="mc-warning">⚠️ Для німецького бухгалтерського та податкового обліку валютні доходи потребують відповідного перерахунку й документів. Тут облік реальних сум за валютами, а не податкова декларація. Ця система не переказує коштів між банками.</div>'
 +'<div class="mc-actions"><button type="button" class="mc-action" data-mc-export="1">⬇️ Експорт усіх операцій (CSV · € + ₴)</button><button type="button" class="mc-action" data-mc-close="1">← Назад до SOL Wallet</button></div></div>';
 if(message){const el=d.getElementById('mcMessage');if(el){el.hidden=false;el.classList.toggle('error',error);el.textContent=message;}}
  updatePreview();if(wallet==='personal')root.SOLFamilyBudget?.updatePreview(panel,s,currency);
}
function field(f,n){return f.elements.namedItem(n)?.value??'';}
function updatePreview(){
 const s=sn(),f=d.getElementById('mcForm');if(!f)return;
 if(mode==='income'||mode==='owner'){
  const box=d.getElementById('mcAllocation');if(!box)return;
  try{const n=C.parse(field(f,'amount')),w=mode==='owner'?'personal':wallet;const al=currency==='EUR'?api.currencyPlan(w,n,field(f,'date')||C.dateNow()):C.allocateUAH(s,w,n,field(f,'date')||C.dateNow());
  box.innerHTML=al.filter(x=>x.cents).map(x=>'<div><span>'+esc(catName(s,w,x.id))+'</span><b>'+C.money(x.cents,currency)+'</b></div>').join('')||'Поки що сума не вказана.';
  }catch(_){box.textContent='Введи суму для попереднього розподілу.';}
 }
 if(mode==='fx'){const box=d.getElementById('mcRate');try{const x=C.parse(field(f,'fromAmount')),y=C.parse(field(f,'toAmount'));const effective=currency==='EUR'?y/x:x/y;box.textContent='Фактичний ефективний курс: 1 € ≈ '+new Intl.NumberFormat('uk-UA',{maximumFractionDigits:6}).format(effective)+' ₴. Комісії вже враховані у фактично отриманій сумі.';}catch(_){box.textContent='Введи списану та отриману суми для розрахунку ефективного курсу.';}}
}
async function write(mut,message){
 if(busy)return;busy=true;let f=d.querySelector('#mcForm .mc-submit');if(f)f.disabled=true;
 try{const s=sn();C.ensure(s);mut(s);api.validate(s);await vault.persist(s);api.afterRestore(s);render(message||'✅ Дані збережено у зашифрованому гаманці.');}
 catch(e){render('⚠️ '+(e.message||String(e)),true);}
 finally{busy=false;}
}
function submit(f){
 const date=field(f,'date')||C.dateNow(),note=field(f,'note').trim().slice(0,250),acct=field(f,'account');
 const c=currency,w=wallet,other=c==='EUR'?'UAH':'EUR';
 if(mode==='source'){
  const name=field(f,'sourceName').trim(),frequency=field(f,'frequency'),accountId=field(f,'account');
  if(!name||name.length>90)throw Error('Напиши назву джерела (до 90 символів)');
  const raw=field(f,'expected').trim(),expectedCents=raw&&Number(raw.replace(',','.'))!==0?C.parse(raw):0;
  return write(s=>{const l=C.ensure(s);if(l.sources.length>=100)throw Error('Занадто багато джерел');
   l.sources.push({id:C.uuid(),wallet:w,currency:c,name,frequency,accountId,expectedCents});
  },'✅ Джерело збережено. Надходження з нього ще не зараховане.');
 }
 if(mode==='income'){
  const n=C.parse(field(f,'amount')),sourceId=field(f,'source'),familyKind=w==='personal'?field(f,'familyKind')||'regular':null;return write(s=>{
   const source=(C.ledger(s).sources||[]).find(q=>q.id===sourceId&&q.wallet===w&&q.currency===c);
   const effectiveNote=note||source?.name||'',effectiveAccount=acct||source?.accountId||'';
   if(c==='EUR')s.transactions.push({id:C.uuid(),type:'income',wallet:w,cents:n,date,note:effectiveNote,accountId:effectiveAccount,sourceId:sourceId||'',...(familyKind?{familyKind}:{}),allocations:api.currencyPlan(w,n,date)});
   else C.ensure(s).events.push({id:C.uuid(),type:'uah_income',wallet:w,cents:n,date,note:effectiveNote,accountId:effectiveAccount,sourceId:sourceId||'',...(familyKind?{familyKind}:{}),allocations:C.allocateUAH(s,w,n,date)});
  },'✅ '+C.money(n,c)+' отримано й розподілено.');
 }
 if(mode==='expense'){
  const n=C.parse(field(f,'amount')),category=field(f,'category'),expenseKind=w==='personal'?(field(f,'expenseKind')||'purchase'):null,receipt=field(f,'merchantEUR').trim(),extra={...(expenseKind?{expenseKind}:{}),...(receipt&&c==='UAH'&&w==='personal'?{merchantCents:C.parse(receipt)}:{})};return write(s=>{
   if(c==='EUR')s.transactions.push({id:C.uuid(),type:'expense',wallet:w,cents:n,date,note,category,accountId:acct,...extra});
   else C.ensure(s).events.push({id:C.uuid(),type:'uah_expense',wallet:w,cents:n,date,note,category,accountId:acct,...extra});
  },'✅ Витрату '+C.money(n,c)+' записано.');
 }
 if(mode==='move'){
  const n=C.parse(field(f,'amount')),from=field(f,'from'),to=field(f,'to');if(from===to)throw Error('Обери різні конверти.');
  return write(s=>{if(c==='EUR')s.transactions.push({id:C.uuid(),type:'move',wallet:w,cents:n,date,note,from,to});
    else C.ensure(s).events.push({id:C.uuid(),type:'uah_move',wallet:w,cents:n,date,note,from,to});},'✅ Перерозподілено '+C.money(n,c));
 }
 if(mode==='owner'){
  const n=C.parse(field(f,'amount')),fromAccountId=field(f,'fromAccount'),toAccountId=field(f,'toAccount');return write(s=>{
   if(c==='EUR')s.transactions.push({id:C.uuid(),type:'owner',cents:n,date,note,fromAccountId,toAccountId,allocations:api.currencyPlan('personal',n,date)});
   else C.ensure(s).events.push({id:C.uuid(),type:'uah_owner',cents:n,date,note,fromAccountId,toAccountId,allocations:C.allocateUAH(s,'personal',n,date)});
  },'✅ Переказ собі: '+C.money(n,c)+'; бізнес і сім’я враховані окремо.');
 }
 if(mode==='fx'){
  const fromCents=C.parse(field(f,'fromAmount')),toCents=C.parse(field(f,'toAmount'));
  if(!root.confirm('Підтверди, що обмін ФАКТИЧНО відбувся: списано '+C.money(fromCents,c)+' і отримано '+C.money(toCents,other)+'? Жодного реального переказу через SOL не здійснюється.'))return;
  return write(s=>C.ensure(s).events.push({id:C.uuid(),type:'exchange',wallet:w,fromCurrency:c,toCurrency:other,fromCategory:field(f,'fromCategory'),toCategory:field(f,'toCategory'),fromCents,toCents,fromAccountId:field(f,'fromAccount'),toAccountId:field(f,'toAccount'),date,note}), '✅ Обмін відображено в обох валютах, без подвійного обліку.');
 }
 if(mode==='account'){
  const name=field(f,'accountName').trim(),kind=field(f,'accountKind')||'card';if(!name||name.length>90)throw Error('Введи назву рахунку від 1 до 90 символів');
   return write(s=>C.ensure(s).accounts.push({id:C.uuid(),wallet:w,currency:c,name,kind}),'✅ Рахунок/картку додано.');
 }
 if(mode==='accountMove'){
  const n=C.parse(field(f,'amount')),fromAccountId=field(f,'fromAccount'),toAccountId=field(f,'toAccount');if(!fromAccountId||!toAccountId||fromAccountId===toAccountId)throw Error('Обери два різні рахунки.');
  return write(s=>{if((C.accountBalances(s)[c][w][fromAccountId]||0)<n)throw Error('На цьому рахунку за записами недостатньо коштів.');C.ensure(s).events.push({id:C.uuid(),type:'account_transfer',wallet:w,currency:c,cents:n,fromAccountId,toAccountId,date,note});},'✅ Переміщення між рахунками зафіксоване.');
 }
 if(mode==='targets'){
  if(c!=='UAH')return;
  return write(s=>{const t=C.ensure(s).uahTargets[w];for(const cat of s.wallets[w].categories){const v=field(f,'target_'+cat.id).trim()||'0';const n=Number(v.replace(',','.'));if(!Number.isFinite(n)||n<0)throw Error('Неправильна місячна ціль');const cents=Math.round(n*100);if(!Number.isSafeInteger(cents)||cents>100000000000)throw Error('Завелика місячна ціль');t[cat.id]=cents;}},'✅ Гривневі місячні цілі збережено.');
 }
}
function exportAllCsv(s){
 if(!root.confirm('CSV не шифрується та міститиме фінансову історію в обох валютах. Завантажити на цей пристрій?'))return;
 const rows=[['Дата','Гаманець','Валюта','Тип','Сума','Рахунок','Категорія / дія','Примітка']];
 function add(date,w,c,type,n,acct,cat,note){rows.push([date,w,c,type,(n/100).toFixed(2),acct,cat,note]);}
 for(const t of s.transactions){
 if(t.type==='owner'){add(t.date,'business','EUR','Privatentnahme',-t.cents,accountName(s,t.fromAccountId),'Виплата собі',t.note);add(t.date,'personal','EUR','Переказ власника',t.cents,accountName(s,t.toAccountId),'BMH → сім’я',t.note);}
 else add(t.date,t.wallet,'EUR',t.type,t.type==='income'?t.cents:t.type==='expense'?-t.cents:0,accountName(s,t.accountId),t.category?catName(s,t.wallet,t.category):t.type==='move'?'Конверти':'Надходження',t.note);
 }
 for(const e of C.ledger(s).events){
 if(e.type==='uah_owner'){add(e.date,'business','UAH','Privatentnahme',-e.cents,accountName(s,e.fromAccountId),'Виплата собі',e.note);add(e.date,'personal','UAH','Переказ власника',e.cents,accountName(s,e.toAccountId),'BMH → сім’я',e.note);}
 if(e.type==='uah_income'||e.type==='uah_expense'||e.type==='uah_move')add(e.date,e.wallet,'UAH',e.type,e.type==='uah_income'?e.cents:e.type==='uah_expense'?-e.cents:0,accountName(s,e.accountId),e.category?catName(s,e.wallet,e.category):'Конверти',e.note);
 if(e.type==='exchange'){add(e.date,e.wallet,e.fromCurrency,'Обмін',-e.fromCents,accountName(s,e.fromAccountId),catName(s,e.wallet,e.fromCategory),e.note);add(e.date,e.wallet,e.toCurrency,'Обмін',e.toCents,accountName(s,e.toAccountId),catName(s,e.wallet,e.toCategory),e.note);}
 if(e.type==='account_transfer')add(e.date,e.wallet,e.currency,'Рахунки',0,accountName(s,e.fromAccountId)+' → '+accountName(s,e.toAccountId),'Між рахунками',e.note);
 }
 const quote=x=>{let str=String(x??'');if(/^[=+\-@]/.test(str))str="'"+str;return '"'+str.replace(/"/g,'""')+'"';};
 const csv='\ufeff'+rows.map(row=>row.map(quote).join(';')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=d.createElement('a');a.href=url;a.download='SOL_Wallet_EUR_UAH_'+C.dateNow()+'.csv';d.body.appendChild(a);a.click();a.remove();root.setTimeout(()=>URL.revokeObjectURL(url),5000);
}
C.exportAllCsv=exportAllCsv;
function open(){if(d.querySelector('.app.locked'))return;panel.hidden=false;d.body.classList.add('mc-open');render();panel.focus();}
function close(){panel.hidden=true;panel.textContent='';d.body.classList.remove('mc-open');}
function mount(){
 const nav=d.querySelector('.side .nav');if(nav&&!d.getElementById('openCurrencies')){
  const btn=d.createElement('button');btn.id='openCurrencies';btn.type='button';btn.innerHTML='<span class="ico">💶</span> Валюти € / ₴';nav.insertBefore(btn,d.getElementById('openBudgetPlan')||nav.querySelector('[data-page="rules"]')||nav.lastElementChild);btn.addEventListener('click',open);
 }
  if(nav&&!d.getElementById('openFamilyCalculator')){const btn=d.createElement('button');btn.type='button';btn.id='openFamilyCalculator';btn.innerHTML='<span class="ico">🏠</span> Сімейний калькулятор';nav.insertBefore(btn,d.getElementById('openBudgetPlan')||nav.lastElementChild);btn.addEventListener('click',()=>{wallet='personal';currency='UAH';open()});}
  for(const name of ['openCurrenciesMobile','openCurrenciesDashboard'])d.getElementById(name)?.addEventListener('click',open);
  d.getElementById('openFamilyDashboard')?.addEventListener('click',()=>{wallet='personal';currency='UAH';open();});
 panel=d.createElement('section');panel.id='solCurrencyPanel';panel.hidden=true;panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Валютні гаманці EUR та UAH');d.body.appendChild(panel);
 panel.addEventListener('click',e=>{const btn=e.target.closest('button');if(!btn)return;
  if(btn.hasAttribute('data-mc-close')){close();return;}
   if(btn.dataset.sfGo){wallet='personal';const action=btn.dataset.sfGo,preview=root.SOLFamilyBudget?.getScenario();if(action==='cash'){currency='UAH';mode='fx';}else{mode=action;}render();const f=d.getElementById('mcForm');if(f&&action!=='cash'&&preview?.amount){const amount=f.elements.namedItem('amount');if(amount)amount.value=preview.amount;if(action==='expense'){const cat=f.elements.namedItem('category');if(cat)cat.value=preview.category;}else{const kind=f.elements.namedItem('familyKind'),note=f.elements.namedItem('note');if(kind)kind.value='refund';if(note&&!note.value)note.value='Повернення власних коштів';}updatePreview();}f?.scrollIntoView({behavior:'smooth',block:'start'});return;}
   if(btn.dataset.mcWallet){wallet=btn.dataset.mcWallet;if(btn.dataset.mcCurrency)currency=btn.dataset.mcCurrency;render();return;}
  if(btn.dataset.mcCurrency){currency=btn.dataset.mcCurrency;render();return;}
  if(btn.dataset.mcAction){mode=btn.dataset.mcAction;if(mode==='owner')wallet='business';render();return;}
  if(btn.dataset.mcBudget){close();d.getElementById('openBudgetPlan')?.click();return;}
  if(btn.dataset.mcExport){exportAllCsv(sn());return;}
 });
  panel.addEventListener('input',e=>{if(['amount','fromAmount','toAmount'].includes(e.target.name))updatePreview();if(e.target.closest('#sfScenarioForm'))root.SOLFamilyBudget?.updatePreview(panel,sn(),currency)});
  panel.addEventListener('change',e=>{if(e.target.name==='sfMonth'){try{root.SOLFamilyBudget?.setMonth(e.target.value);render();}catch(err){root.alert(err.message);}return;}if(['sfKind','sfCategory'].includes(e.target.name)){root.SOLFamilyBudget?.updatePreview(panel,sn(),currency);return;}if(e.target.name!=='source')return;const s=sn(),f=d.getElementById('mcForm'),source=(C.ledger(s).sources||[]).find(x=>x.id===e.target.value);if(!f||!source)return;
  const a=f.elements.namedItem('account'),n=f.elements.namedItem('note');if(a&&source.accountId)a.value=source.accountId;if(n&&!n.value)n.value=source.name;
 });
  panel.addEventListener('submit',e=>{if(e.target.id==='sfLimitsForm'){e.preventDefault();root.SOLFamilyBudget?.saveLimits(e.target,currency,render);return;}if(e.target.id!=='mcForm')return;e.preventDefault();try{submit(e.target)}catch(err){const msg=d.getElementById('mcMessage');if(msg){msg.hidden=false;msg.classList.add('error');msg.textContent='⚠️ '+err.message;}}});
 d.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)close()});
 const oldLoad=api.loadSnapshot;api.loadSnapshot=function(){const value=oldLoad.apply(this,arguments);if(new URLSearchParams(root.location.search).get('wallets')==='1'||root.location.hash==='#currencies')root.setTimeout(open,80);return value;};
 const oldLock=api.onLock;api.onLock=function(){close();return oldLock.apply(this,arguments)};
 const oldRestore=api.afterRestore;api.afterRestore=function(){const result=oldRestore.apply(this,arguments);if(!panel.hidden)render();return result;};
}
mount();
})(typeof window==='object'?window:null);