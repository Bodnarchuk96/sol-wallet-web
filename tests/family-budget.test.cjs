'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../currency-core.js');
const F=require('../family-budget.js');
const root=path.join(__dirname,'..');
const cat=(id,name,pct,kind='flex')=>({id,name,pct,icon:'•',kind,target:0,due:0});
function fixture(){
 const personal=[
  cat('reserve','Сімейний резерв',40,'protected'),
  cat('groceries','Продукти',30),
  cat('bills','Обов’язкові',20,'protected'),
  cat('children','Діти',10)
 ];
 const business=[cat('owner','Виплата власнику',100,'protected')];
 const s={version:1,transactions:[],wallets:{personal:{name:'Сім’я',categories:personal},business:{name:'BMH',categories:business}},currencyLedger:C.fresh()};
 const l=s.currencyLedger;
 l.accounts.push({id:'UAH_CARD',name:'Тестова картка',wallet:'personal',currency:'UAH',kind:'card'});
 l.accounts.push({id:'EUR_CASH',name:'Тестова готівка',wallet:'personal',currency:'EUR',kind:'cash'});
 l.events.push({id:'I1',type:'uah_income',wallet:'personal',date:'2026-10-16',note:'Повернення власних коштів',cents:100000,familyKind:'refund',accountId:'UAH_CARD',allocations:[{id:'reserve',cents:40000},{id:'groceries',cents:30000},{id:'bills',cents:20000},{id:'children',cents:10000}]});
 l.events.push({id:'E1',type:'uah_expense',wallet:'personal',date:'2026-10-16',note:'Покупка у валюті магазину',cents:12500,category:'groceries',accountId:'UAH_CARD',merchantCents:250,expenseKind:'purchase'});
 l.events.push({id:'E2',type:'uah_expense',wallet:'personal',date:'2026-10-16',note:'Друга покупка',cents:4000,category:'groceries',accountId:'UAH_CARD',expenseKind:'purchase'});
 l.events.push({id:'F1',type:'uah_expense',wallet:'personal',date:'2026-10-16',note:'Комісія',cents:40,category:'bills',accountId:'UAH_CARD',expenseKind:'fee'});
 l.events.push({id:'FX',type:'exchange',wallet:'personal',date:'2026-10-16',note:'Тест зняття готівки',fromCurrency:'UAH',toCurrency:'EUR',fromCategory:'groceries',toCategory:'reserve',fromCents:10000,toCents:2000,fromAccountId:'UAH_CARD',toAccountId:'EUR_CASH'});
 return s;
}
test('family UAH sum counts purchases and fee, not a cash withdrawal or receipt EUR twice',()=>{
 const s=fixture();C.validate(s);
 const v=F.summarize(s,'UAH','2026-10');
 assert.equal(v.income,100000);
 assert.equal(v.expense,16540);
 assert.equal(v.commissions,40);
 assert.equal(v.available,73460);
 assert.equal(v.accounts.card,73460);
 assert.equal(v.accounts.cash,0);
 assert.equal(v.exchangeOut,10000);
 assert.equal(v.categories.find(x=>x.id==='groceries').spent,16500);
});
test('cash remains real EUR asset after conversion, business wallet independent',()=>{
 const s=fixture();
 s.transactions.push({id:'B1',type:'income',wallet:'business',date:'2026-10-16',cents:500000,note:'Test',allocations:[{id:'owner',cents:500000}]});
 C.validate(s);
 const v=F.summarize(s,'EUR','2026-10');
 assert.equal(v.income,0);
 assert.equal(v.available,2000);
 assert.equal(v.accounts.cash,2000);
 assert.equal(v.accounts.card,0);
 assert.equal(v.exchangeIn,2000);
 assert.equal(F.summarize(s,'UAH','2026-10').income,100000);
});
test('opening balance is not classified as household income',()=>{
 const s=fixture();
 s.currencyLedger.events.push({id:'OPEN',type:'uah_income',wallet:'personal',date:'2026-10-16',note:'Початковий залишок',cents:3954,familyKind:'opening',accountId:'UAH_CARD',allocations:[{id:'reserve',cents:3954}]});
 C.validate(s);
 const v=F.summarize(s,'UAH','2026-10');
 assert.equal(v.income,100000);
 assert.equal(v.opening,3954);
 assert.equal(v.available,77414);
});
test('family category limits flag only genuine overruns and never invent unset limits',()=>{
 const s=fixture();s.currencyLedger.familyLimits.UAH.groceries=15000;C.validate(s);
 const v=F.summarize(s,'UAH','2026-10');
 assert.equal(v.overspends.length,1);
 const food=v.categories.find(x=>x.id==='groceries');
 assert.equal(food.overspent,true);
 assert.equal(food.spent-food.limit,1500);
 assert.equal(food.maySpend,0);
 assert.equal(v.categories.find(x=>x.id==='bills').limit,0);
 assert.equal(v.categories.find(x=>x.id==='bills').overspent,false);
});
test('planned allocation totals exactly 100% at smallest cent precision',()=>{
 for(const n of [0,1,2,3,7,99,10001,100000000]){
  const parts=F.propose(n);
  assert.equal(parts.reduce((a,b)=>a+b,0),n);
 }
 assert.deepEqual(F.propose(10000),[4000,3000,2000,1000]);
});
test('backward compatible ledger and strict category/account checks',()=>{
 const s=fixture();delete s.currencyLedger.familyLimits;
 C.validate(s);assert.equal(F.summarize(s,'UAH','2026-10').overspends.length,0);
 C.ensure(s).familyLimits.UAH.bad_category=100;
 assert.throws(()=>C.validate(s),/Некоректний сімейний ліміт/);
 delete s.currencyLedger.familyLimits.UAH.bad_category;
 s.currencyLedger.accounts[0].kind='fake';
 assert.throws(()=>C.validate(s),/Невірний рахунок/);
});
test('no real transactions stored in public application source',()=>{
 for(const file of ['family-budget.js','currency-ui.js','currency-core.js','README.md']){
  const content=fs.readFileSync(path.join(root,file),'utf8');
  assert.doesNotMatch(content,/7\s?354[,.]08|k kiosk 2117|24 SIEBEN SHOP|DESKTOP COMMANDER|Банкомат 257273/i);
 }
});
test('new assets integrated into CSP-compatible static app and offline cache',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 assert.match(html,/family-budget\.js\?v=10/);
 assert.match(html,/family-budget\.css\?v=10/);
 assert.match(html, /script-src 'self'/);
 assert.match(sw,/family-budget\.js/);
 assert.match(sw,/family-budget\.css/);
});
