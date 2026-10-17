'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {TextEncoder,TextDecoder}=require('node:util');
const vaultScript=fs.readFileSync(path.join(__dirname,'..','vault.js'),'utf8');
const oldKey='SOL_WALLET_V2_ENCRYPTED';
const newKey='SOL_WALLET_NEW_V1_ENCRYPTED';
const slotKey='SOL_WALLET_ACTIVE_SLOT_V1';
const sampleOld=JSON.stringify({
  format:'sol-wallet-vault',version:2,cipher:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:310000,
  salt:Buffer.alloc(16).toString('base64'),iv:Buffer.alloc(12).toString('base64'),
  ciphertext:Buffer.alloc(16).toString('base64')
});
function fakeStore(initial={}){
  const values=new Map(Object.entries(initial));
  return {
    getItem(key){return values.has(key)?values.get(key):null;},
    setItem(key,value){values.set(key,String(value));},
    removeItem(key){values.delete(key);},
    keys(){return [...values.keys()];}
  };
}
function harness(){
  const local=fakeStore({[oldKey]:sampleOld}),session=fakeStore();
  const nodes={
    vaultGate:{classList:{toggle(){}}},
    vaultGateContent:{innerHTML:''},
    vaultGateMessage:{textContent:'',classList:{toggle(){}}},
    vaultStatus:{textContent:''},
    syncInfo:{textContent:''},
    confirmSeparate:{checked:true},
    separatePass:{value:'new-local-unique-secret-2026'},
    separatePass2:{value:'new-local-unique-secret-2026'}
  };
  const events={},downloads=[],seen=[],alerts=[];
  const doc={
    getElementById(id){return nodes[id]||null;},
    querySelector(selector){return selector==='.app'?{classList:{toggle(){}}}:null;},
    addEventListener(name,callback){events[name]=callback;},
    createElement(){return {download:'',href:'',click(){downloads.push(this.download)}};}
  };
  const ctx={
    window:{SOL_CONFIG:{},addEventListener(){}},
    document:doc,
    localStorage:local,
    sessionStorage:session,
    crypto:webcrypto,
    TextEncoder,TextDecoder,
    atob, btoa,
    Blob, URL:{createObjectURL(){return 'blob:synthetic'},revokeObjectURL(){}},
    setTimeout(){return 1},clearTimeout(){},
    confirm(){return true},alert(x){alerts.push(x)}
  };
  vm.runInNewContext(vaultScript,ctx,{filename:'vault.js'});
  const baseline=()=>({version:1,transactions:[],wallets:{personal:{categories:[{id:'reserve'}]},business:{categories:[{id:'owner'}]}}});
  let current=baseline();
  const model={
    snapshot(){return JSON.parse(JSON.stringify(current));},
    validate(data){assert.equal(data.version,1);},
    loadSnapshot(data){current=JSON.parse(JSON.stringify(data));seen.push(data);},
    legacyData(){return null;},onLock(){current=baseline();}
  };
  ctx.window.SOLVault.init(model);
  async function click(id){const b={id,disabled:false};await events.click({target:{closest(){return b}}})}
  async function submitIsolated(){
    const form={dataset:{vaultForm:'create-isolated'},querySelector(){return {disabled:false}}};
    await events.submit({target:{closest(){return form}},preventDefault(){}});
  }
  return {local,session,nodes,events,downloads,seen,alerts,model,api:ctx.window.SOLVault,click,submitIsolated};
}
test('Original encrypted data can be downloaded while locked; new vault uses another key',async()=>{
  const t=harness();
  assert.match(t.nodes.vaultGateContent.innerHTML,/gateForgot/);
  await t.click('gateForgot');
  await t.click('archiveOriginal');
  assert.equal(t.downloads.length,1);
  assert.match(t.downloads[0],/^SOL_Wallet_OLD_ENCRYPTED_/);
  assert.equal(t.local.getItem(oldKey),sampleOld);
  await t.click('createIsolated');
  assert.match(t.nodes.vaultGateContent.innerHTML,/data-vault-form="create-isolated"/);
  await t.submitIsolated();
  assert.equal(t.nodes.vaultGateMessage.textContent,'');
  const fresh=JSON.parse(t.local.getItem(newKey));
  assert.equal(fresh.cipher,'AES-256-GCM');
  assert.ok(fresh.ciphertext&&fresh.salt&&fresh.iv);
  assert.equal(t.local.getItem(oldKey),sampleOld);
  assert.equal(t.local.getItem(slotKey),'new');
  await t.api.persist(t.model.snapshot());
  assert.equal(t.local.getItem(oldKey),sampleOld,'writes in new wallet cannot overwrite original');
  await t.api.lock();
  assert.match(t.nodes.vaultGateContent.innerHTML,/switchOld/);
  await t.click('switchOld');
  assert.match(t.nodes.vaultGateContent.innerHTML,/switchNew/);
  assert.equal(t.local.getItem(oldKey),sampleOld);
  await t.click('switchNew');
  assert.match(t.nodes.vaultGateContent.innerHTML,/data-vault-form="unlock"/);
});
test('Cannot create new wallet without explicitly requesting old encrypted backup',async()=>{
  const t=harness();
  await t.click('gateForgot');
  await t.click('createIsolated');
  assert.match(t.nodes.vaultGateMessage.textContent,/Спочатку завантаж/);
  assert.equal(t.local.getItem(newKey),null);
  assert.equal(t.local.getItem(oldKey),sampleOld);
});
test('Existing new encrypted vault is never overwritten on a second reset attempt',async()=>{
  const t=harness();
  t.local.setItem(newKey,'existing-unrelated-encrypted-wallet');
  await t.click('gateForgot');
  await t.click('archiveOriginal');
  await t.click('createIsolated');
  await t.submitIsolated();
  assert.match(t.nodes.vaultGateMessage.textContent,/уже існує/);
  assert.equal(t.local.getItem(newKey),'existing-unrelated-encrypted-wallet');
  assert.equal(t.local.getItem(oldKey),sampleOld);
});
