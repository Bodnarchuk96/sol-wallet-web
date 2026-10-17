
/* SOL Wallet 7.0: client-side encrypted vault + optional authenticated, revision-checked Supabase sync.
   No plaintext balances are uploaded. No bank connections. */
'use strict';
(function(){
  // Two independent encrypted vault slots. The original slot is NEVER repurposed.
  const ORIGINAL_STORAGE='SOL_WALLET_V2_ENCRYPTED';
  const NEW_STORAGE='SOL_WALLET_NEW_V1_ENCRYPTED';
  const ACTIVE_SLOT_STORAGE='SOL_WALLET_ACTIVE_SLOT_V1';
  const ORIGINAL_RECOVERY='SOL_WALLET_V6_ENCRYPTED_RECOVERY';
  const NEW_RECOVERY='SOL_WALLET_NEW_V1_RECOVERY';
  let activeSlot=localStorage.getItem(ACTIVE_SLOT_STORAGE)==='new'?'new':'old';
  let STORAGE=activeSlot==='new'?NEW_STORAGE:ORIGINAL_STORAGE;
  const AUTH_STORAGE='SOL_WALLET_V2_AUTH';
  const LAST_SERVER='SOL_WALLET_V2_CLOUD_REV';
  let RECOVERY_STORAGE=activeSlot==='new'?NEW_RECOVERY:ORIGINAL_RECOVERY;
  let oldArchiveRequested=false;
  const MAX_RECOVERY=5;
  const ROUNDS=310000;
  const te=new TextEncoder(),td=new TextDecoder();
  let wallet=null,key=null,salt=null,iterations=ROUNDS,sealed=null,active=false;
  let gateMode='start', pendingRemote=null,remoteRevision=null,cloudEnabled=false,account=null,auth=null;
  let mfaFactor=null,pendingEnrollment=null;
  let queue=Promise.resolve(),syncBlocked=false,syncState='local',inFlight=false;
  let idleTimer=null;
  const config=window.SOL_CONFIG||{};
  const baseUrl=typeof config.supabaseUrl==='string'?config.supabaseUrl.trim().replace(/\/+$/,''):'';
  const publishable=typeof config.publishableKey==='string'?config.publishableKey.trim():'';
  const hasCloud=/^https:\/\/[a-zA-Z0-9.-]+$/.test(baseUrl)&&/^https:\/\//.test(baseUrl)
     &&((publishable.startsWith('sb_publishable_')&&publishable.length>30) || (()=>{try{const parts=publishable.split('.');if(parts.length!==3)return false;const claims=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));return claims.role==='anon'}catch(_){return false}})());
  function byId(s){return document.getElementById(s)}
  function setMessage(message,error=false){const n=byId('vaultGateMessage');n.textContent=message||'';n.classList.toggle('error',error)}
  function htmlEscape(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function bytesToBase64(bytes){let raw='';for(let i=0;i<bytes.length;i+=8192){raw+=String.fromCharCode(...bytes.subarray(i,i+8192))}return btoa(raw)}
  function base64ToBytes(text){if(typeof text!=='string'||!text||text.length>20000000)throw Error('Некоректна захищена копія');return Uint8Array.from(atob(text),c=>c.charCodeAt(0))}
  function random(n){return crypto.getRandomValues(new Uint8Array(n))}
  function supportsCrypto(){return !!(globalThis.crypto?.subtle&&globalThis.crypto?.getRandomValues)}
  function checkPayload(blob){
    if(!blob||blob.format!=='sol-wallet-vault'||blob.version!==2||blob.cipher!=='AES-256-GCM'||blob.kdf!=='PBKDF2-SHA256'||blob.iterations<250000||blob.iterations>1000000)throw Error('Цей файл не є підтримуваною зашифрованою копією SOL Wallet v2');
    const s=base64ToBytes(blob.salt),iv=base64ToBytes(blob.iv),ct=base64ToBytes(blob.ciphertext);
    if(s.length!==16||iv.length!==12||ct.length<16||ct.length>10000000)throw Error('Помилка формату шифрованого файлу');
    return {s,iv,ct};
  }
  async function derive(password,s,rounds){
    if(!supportsCrypto())throw Error('Цей браузер не підтримує потрібне захищене шифрування. Відкрийте застосунок у сучасному Chrome / Safari / Firefox через HTTPS.');
    const raw=await crypto.subtle.importKey('raw',te.encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:s,iterations:rounds,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function seal(snapshot,cryptoKey,s,rounds){
    const iv=random(12);
    const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:te.encode('SOL-WALLET-v2')},cryptoKey,te.encode(JSON.stringify(snapshot)));
    return {format:'sol-wallet-vault',version:2,cipher:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:rounds,salt:bytesToBase64(s),iv:bytesToBase64(iv),ciphertext:bytesToBase64(new Uint8Array(ct))};
  }
  async function openSealed(blob,password){
    const {s,iv,ct}=checkPayload(blob);
    const derived=await derive(password,s,blob.iterations);
    try{
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:te.encode('SOL-WALLET-v2')},derived,ct);
      const data=JSON.parse(td.decode(plain));wallet.validate(data);
      return {data,derived,s,rounds:blob.iterations};
    }catch(e){throw Error('Неправильна секретна фраза або пошкоджений файл.')} 
  }
  function readLocal(){try{const x=localStorage.getItem(STORAGE);if(!x)return null;const obj=JSON.parse(x);checkPayload(obj);return obj}catch(e){setMessage('Локальне сховище пошкоджене. Віднови зашифровану резервну копію.',true);return null}}
  function storeLocal(blob){checkPayload(blob);localStorage.setItem(STORAGE,JSON.stringify(blob));sealed=blob}

  // Never discard a different encrypted wallet during import/cloud conflict resolution.
  // The recovery journal stores only encrypted envelopes, not the secret phrase or transactions.
  function recoveryJournal(){
    let raw;
    try{raw=localStorage.getItem(RECOVERY_STORAGE)}catch(_){throw Error('Неможливо прочитати аварійний архів у браузері')}
    if(!raw)return [];
    let list;
    try{list=JSON.parse(raw)}catch(_){throw Error('Аварійний архів пошкоджено. Не замінюй дані, доки не зробиш зовнішню резервну копію.')}
    if(!Array.isArray(list)||list.length>MAX_RECOVERY)throw Error('Некоректний аварійний архів: перезапис скасовано');
    for(const record of list){
      if(!record||typeof record.at!=='string'||!['before-cloud-replace','before-local-replace','before-import'].includes(record.reason))throw Error('Некоректний аварійний архів: перезапис скасовано');
      checkPayload(record.payload);
    }
    return list;
  }
  function sameEnvelope(a,b){return !!(a&&b&&a.iv===b.iv&&a.salt===b.salt&&a.ciphertext===b.ciphertext)}
  function protectVersion(blob,reason){
    checkPayload(blob);
    const history=recoveryJournal();
    if(history.some(row=>sameEnvelope(row.payload,blob)))return;
    const fresh={at:new Date().toISOString(),reason,payload:blob};
    try{localStorage.setItem(RECOVERY_STORAGE,JSON.stringify([fresh,...history].slice(0,MAX_RECOVERY)))}
    catch(_){throw Error('Не вистачає місця для аварійної зашифрованої копії. Перезапис скасовано. Експортуй захищений JSON.')}
  }
  function recoveryCopies(){return recoveryJournal().map((row,i)=>({index:i,at:row.at,reason:row.reason}))}
  function downloadRecovery(index){
    if(!Number.isSafeInteger(index)||index<0)throw Error('Некоректний номер копії');
    const rec=recoveryJournal()[index];if(!rec)throw Error('Копію не знайдено');
    checkPayload(rec.payload);
    download('SOL_Wallet_RECOVERY_'+rec.at.slice(0,10)+'_'+(index+1)+'.json',JSON.stringify(rec.payload,null,2));
  }

  function remember(){
    clearTimeout(idleTimer);
    if(!active)return;
    idleTimer=setTimeout(()=>{lock()},15*60*1000);
  }
  function statusText(){return syncState==='synced'?'☁️ Хмара синхронізована':syncState==='saving'?'☁️ Збереження…':syncState==='conflict'?'⚠️ Розбіжність із хмарою; копія збережена локально':syncState==='offline'?'⚠️ Немає синхронізації, але дані захищені на пристрої':syncState==='online'?'☁️ Під’єднано до хмари':'🔐 Тільки цей пристрій · хмара не підключена'}
  function updateStatus(){let label=byId('vaultStatus');if(label)label.textContent=statusText();let info=byId('syncInfo');if(info)info.textContent=statusText()}
  function displayWallet(){
    toggleGate(false);
    active=true;wallet.loadSnapshot(currentData);updateStatus();remember();
    // Reconnect only to the same verified account after a normal page reload.
    // Never auto-merge divergent encrypted revisions or overwrite another device.
    if(activeSlot==='old'&&hasCloud&&!cloudEnabled&&getAuth())reconnectSession().catch(()=>{});
  }
  async function reconnectSession(){
    if(!active||!hasCloud)return;
    const remembered=getAuth();if(!remembered)return;
    try{
      auth=remembered;const user=await getUser();
      if(jwtAal(auth.access_token)!=='aal2'){await beginMfa(user);return;}
      const remote=await remoteRead();pendingRemote=remote;remoteRevision=remote?.revision??null;
      const local=readLocal();
      if(!remote){syncState='online';cloudEnabled=false;updateStatus();renderGate('cloud-upload');return}
      if(local&&local.ciphertext===remote.payload.ciphertext&&local.iv===remote.payload.iv&&local.salt===remote.payload.salt){
        cloudEnabled=true;syncBlocked=false;syncState='synced';updateStatus();return;
      }
      cloudEnabled=false;syncBlocked=true;syncState='conflict';updateStatus();renderGate('cloud-choice');
    }catch(_){cloudEnabled=false;syncState='offline';updateStatus()}
  }
  let currentData=null;
  function activate(result,blob){
    currentData=result.data;key=result.derived;salt=result.s;iterations=result.rounds;sealed=blob;
    storeLocal(blob);displayWallet();
  }
  function toggleGate(on){if(!on){const c=byId('vaultGateContent');if(c)c.innerHTML=''}byId('vaultGate').classList.toggle('hidden',!on);document.querySelector('.app').classList.toggle('locked',on)}
  function getGateContent(){return byId('vaultGateContent')}
  const field=(type,id,placeholder='',extra='')=>`<input class="field" id="${id}" type="${type}" ${type==='password'?'autocomplete="off"':''} ${extra} placeholder="${placeholder}" required>`;
  const localIntro=()=>`<div class="gate-panel"><h2>🔐 Локальний захищений гаманець</h2><p>Локальний режим захищений секретною фразою; серверна 2FA діє тільки для окремого хмарного акаунта. Зашифровані записи залишаються у браузері.</p>`;
  function archivedOriginal(){
    const raw=localStorage.getItem(ORIGINAL_STORAGE);
    if(!raw)throw Error('Зашифрований старий гаманець у цьому браузері не знайдено. Перевір інший пристрій або браузер.');
    let blob;try{blob=JSON.parse(raw);checkPayload(blob)}catch(_){throw Error('Стара зашифрована копія пошкоджена. Нічого не замінено. Збережи дані браузера.');}
    return {raw,blob};
  }
  function downloadOriginalLocked(){
    const {raw}=archivedOriginal();
    download('SOL_Wallet_OLD_ENCRYPTED_'+new Date().toISOString().slice(0,10)+'.json',raw);
    oldArchiveRequested=true;
  }
  function switchVaultSlot(next){
    if(active)throw Error('Спочатку заблокуй відкритий гаманець.');
    if(next!=='new'&&next!=='old')throw Error('Невідомий слот гаманця.');
    const slot=next==='new'?NEW_STORAGE:ORIGINAL_STORAGE;
    if(!localStorage.getItem(slot))throw Error('Вибраний гаманець у цьому браузері не знайдено.');
    localStorage.setItem(ACTIVE_SLOT_STORAGE,next);
    activeSlot=next;STORAGE=slot;RECOVERY_STORAGE=next==='new'?NEW_RECOVERY:ORIGINAL_RECOVERY;
    oldArchiveRequested=false;renderGate('start');
  }
  async function createIsolatedWallet(password){
    if(active)throw Error('Новий слот можна створити лише із заблокованого гаманця.');
    if(!oldArchiveRequested)throw Error('Спочатку завантаж зашифровану копію старого гаманця.');
    if(typeof password!=='string'||password.length<12||password.length>200)throw Error('Нова секретна фраза має містити 12–200 символів.');
    if(localStorage.getItem(NEW_STORAGE))throw Error('Новий гаманець уже існує! Його не можна перезаписувати. Перейди до нього через перемикач.');
    if(account||auth||getAuth()||cloudEnabled)throw Error('Хмарна сесія активна. Вийди з акаунта перед створенням нового окремого гаманця.');
    await queue;
    const old=archivedOriginal();
    const state=wallet.snapshot();wallet.validate(state);
    const nextSalt=random(16),nextKey=await derive(password,nextSalt,ROUNDS);
    const newBlob=await seal(state,nextKey,nextSalt,ROUNDS);
    const tested=await openSealed(newBlob,password);
    if(localStorage.getItem(ORIGINAL_STORAGE)!==old.raw)throw Error('Старий запис змінився під час підготовки. Нічого не замінено.');
    if(localStorage.getItem(NEW_STORAGE))throw Error('Новий запис з’явився в іншій вкладці. Перезапис заборонено.');
    localStorage.setItem(NEW_STORAGE,JSON.stringify(newBlob));
    if(localStorage.getItem(ORIGINAL_STORAGE)!==old.raw)throw Error('Старий запис змінився. Перевір копії перед наступними діями.');
    localStorage.setItem(ACTIVE_SLOT_STORAGE,'new');
    activeSlot='new';STORAGE=NEW_STORAGE;RECOVERY_STORAGE=NEW_RECOVERY;
    oldArchiveRequested=false;
    activate(tested,newBlob);
  }
  function renderGate(mode='start'){
    gateMode=mode;toggleGate(true);setMessage('');const exists=!!readLocal();
    if(mode==='start'){
      const msg=exists?'Введи свою секретну фразу, щоб побачити баланс і конверти.':'Створи приватний гаманець. Секретна фраза потрібна для доступу та відновлення резервних копій.';
      const slotActions=!active?(activeSlot==='old'
        ? (localStorage.getItem(ORIGINAL_STORAGE)?'<button class="btn soft" id="gateForgot" type="button">🔑 Забув фразу? Зберегти старий гаманець</button>':'')
          +(localStorage.getItem(NEW_STORAGE)?'<button class="btn" id="switchNew" type="button">🆕 Перейти до нового гаманця</button>':'')
        : (localStorage.getItem(ORIGINAL_STORAGE)?'<button class="btn" id="switchOld" type="button">🔐 Старий зашифрований гаманець</button>':'')):'';
      getGateContent().innerHTML=localIntro()+`<form data-vault-form="${exists?'unlock':'create'}">${msg}<label class="fieldlabel" for="vaultPass">Секретна фраза</label>${field('password','vaultPass',exists?'Поточна секретна фраза':'Мінімум 12 символів',exists?'minlength="1" maxlength="200"':'minlength="12" maxlength="200"')}${!exists?`<label class="fieldlabel" for="vaultPass2">Повтори секретну фразу</label>${field('password','vaultPass2','Повтори точно','minlength="12" maxlength="200"')}${wallet.legacyData()?'<label class="gate-option"><input type="checkbox" id="migrateOld" checked> Перенести записи з незахищеної версії v1</label>':''}`:''}<button class="btn primary" type="submit">${exists?'🔓 Відкрити гаманець':'🔐 Створити захищений гаманець'}</button></form><p class="helper">${exists?'Введи саме ту фразу, якою був зашифрований цей гаманець — навіть якщо вона коротша за 12 символів. Фраза не зберігається й не надсилається.':'Для нового гаманця потрібна секретна фраза від 12 символів. Якщо втратиш її, відновити вміст буде неможливо.'}</p></div><div class="gate-actions">${slotActions}<button class="btn" id="gateRestore" type="button">📥 Відновити захищений JSON</button>${hasCloud?'<button class="btn soft" id="gateCloud" type="button">🛡️ Мій акаунт: email · пароль · 2FA</button>':'<div class="gate-option">☁️ Синхронізація буде доступна після підключення приватної бази даних.</div>'}${active?'<button class="btn ghost" id="gateReturn" type="button">← Повернутися до гаманця</button>':''}</div><input id="gateFile" type="file" accept=".json,application/json" hidden>`;
      byId('vaultPass')?.focus();return;
    }
    if(mode==='cloud' || mode==='cloud-signup'){
      if(!hasCloud){getGateContent().innerHTML='<div class="gate-panel"><h2>☁️ Хмара не налаштована</h2><p>Локальний зашифрований гаманець працює. Щоб синхронізувати його між пристроями, спершу треба налаштувати захищену базу та Auth.</p><button id="gateReturn" class="btn primary" type="button">← Повернутися</button></div>';return}
      getGateContent().innerHTML=`<div class="gate-panel"><h2>☁️ ${mode==='cloud'?'Вхід у приватну хмару':'Новий хмарний акаунт'}</h2><p>Спочатку email і пароль, потім код Authenticator (TOTP). Секретна фраза гаманця — окремий локальний ключ, який нікуди не надсилається.</p><form data-vault-form="${mode==='cloud'?'signin':'signup'}"><label class="fieldlabel" for="accountEmail">Email</label>${field('email','accountEmail','email@example.com','autocomplete="email" maxlength="254"')}<label class="fieldlabel" for="accountPassword">Пароль хмарного акаунта</label>${field('password','accountPassword','Мінімум 12 символів','autocomplete="current-password" minlength="12" maxlength="200"')}<button class="btn primary" type="submit">${mode==='cloud'?'Увійти':'Створити акаунт'}</button></form><button class="btn ghost" id="${mode==='cloud'?'gateSignup':'gateSignin'}" type="button">${mode==='cloud'?'Створити новий акаунт':'Уже маю акаунт'}</button><button class="btn ghost" id="gateReturn" type="button">← Назад</button></div>`;
      return;
    }
    if(mode==='mfa-verify'||mode==='mfa-setup'){
      if(!hasCloud||!auth||!mfaFactor){renderGate('cloud');setMessage('Спочатку увійди до хмарного акаунта.',true);return}
      const setup=mode==='mfa-setup',qr=setup&&pendingEnrollment?.qr;
      let image='';
      if(qr&&qr.length<50000){
        const svg=qr.trim();let src='';
        if(svg.startsWith('<svg')&&svg.includes('</svg>'))src='data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg);
        else if(svg.startsWith('data:image/svg+xml'))src=svg;
        if(src)image='<img alt="QR-код для Authenticator" style="display:block;max-width:240px;width:100%;margin:14px auto;background:#fff;padding:8px;border-radius:12px" src="'+htmlEscape(src)+'">';
      }
      const secret=setup?'<p class="helper">Якщо QR не зчитується, додай код налаштування вручну (нікому його не передавай):</p><code style="display:block;overflow-wrap:anywhere;padding:12px;margin:10px 0;background:#081c29;border-radius:9px">'+htmlEscape(pendingEnrollment.secret)+'</code>':'';
      getGateContent().innerHTML='<div class="gate-panel"><h2>'+(setup?'🛡️ Підключити двофакторний захист':'🛡️ Підтвердити другий фактор')+'</h2><p>'+(setup?'Відскануй QR через Google Authenticator / Microsoft Authenticator та введи 6 цифр. Хмара залишається заблокованою до успішної перевірки.':'Відкрий Authenticator і введи поточні 6 цифр. Другий фактор перевіряє сервер.')+'</p>'+image+secret+
      '<form data-vault-form="'+(setup?'mfa-setup':'mfa-verify')+'"><label class="fieldlabel" for="mfaCode">Код із Authenticator</label>'+field('text','mfaCode','6 цифр','inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6"')+'<button class="btn primary" type="submit">'+(setup?'✅ Активувати 2FA':'🔓 Підтвердити вхід')+'</button></form><p class="helper">Код перевіряється Supabase Auth. Секрет налаштування не зберігається у фінансовому журналі.</p></div>'+
      '<div class="gate-actions"><button id="gateReturn" class="btn ghost" type="button">← Назад</button></div>';
      byId('mfaCode')?.focus();return;
    }
    if(mode==='remote-unlock'){
      getGateContent().innerHTML=`<div class="gate-panel"><h2>🔑 Відкрити хмарні дані</h2><p>Хмарний акаунт підтверджений. Тепер введи секретну фразу гаманця для розшифрування. Вона не передається серверу.</p><form data-vault-form="remote-unlock"><label class="fieldlabel" for="vaultPass">Секретна фраза гаманця</label>${field('password','vaultPass','Твоя окрема секретна фраза','minlength="1" maxlength="200"')}<button class="btn primary" type="submit">🔓 Розшифрувати й відкрити</button></form><button class="btn ghost" id="gateReturn" type="button">← Назад</button></div>`;return;
    }
    if(mode==='cloud-choice'){
      getGateContent().innerHTML=`<div class="gate-panel"><h2>📲 Дві різні версії гаманця</h2><p>На цьому пристрої вже є гаманець, а в хмарі — інша версія. Нічого не буде перезаписано без твого вибору.</p><div class="gate-actions"><button id="chooseRemote" class="btn primary" type="button">☁️ Відкрити версію з хмари</button><button id="chooseLocal" class="btn" type="button">📤 Замінити хмару локальною копією</button><button id="gateReturn" class="btn ghost" type="button">Назад, нічого не змінювати</button></div><p class="gate-warning">Перед заміною хмарної версії зроби зашифровану резервну копію іншого пристрою.</p></div>`;return;
    }
    if(mode==='cloud-upload'){
      getGateContent().innerHTML=`<div class="gate-panel"><h2>☁️ Синхронізація готова до запуску</h2><p>У хмарі ще немає гаманця цього акаунта. Перенести туди зашифровану копію з цього пристрою?</p><button id="confirmUpload" class="btn primary" type="button">🔐 Так, завантажити зашифровані дані</button><button id="gateReturn" class="btn ghost" type="button">Поки тільки локально</button></div>`;return;
    }
    if(mode==='forgot'){
      if(active||!localStorage.getItem(ORIGINAL_STORAGE)){renderGate('start');return;}
      getGateContent().innerHTML=localIntro()+
        '<h2>🔑 Стара фраза забута</h2><p>Без первісної фрази зашифровані старі суми й операції неможливо відновити. Ми не видалятимемо їх і не будемо їх перезаписувати.</p>'+
        '<p><strong>Крок 1.</strong> Завантаж зашифрований оригінал. Файл не відкриється без старої фрази, але збереже можливість майбутнього відновлення.</p>'+
        '<button class="btn primary" type="button" id="archiveOriginal">📥 Зберегти старий зашифрований JSON</button>'+
        '<p class="helper">Перевір у Завантаженнях файл SOL_Wallet_OLD_ENCRYPTED_*.json. Пароль не вводь і файл нікому не надсилай.</p>'+
        '<button class="btn soft" type="button" id="createIsolated">Крок 2: новий порожній гаманець →</button></div>'+
        '<div class="gate-actions"><button class="btn ghost" type="button" id="gateReturn">← Залишити все без змін</button></div>';return;
    }
    if(mode==='create-isolated'){
      if(active||!oldArchiveRequested){renderGate('forgot');return;}
      getGateContent().innerHTML=localIntro()+
        '<h2>🆕 Окремий порожній гаманець</h2><div class="gate-warning"><strong>Старі гроші не перенесуться.</strong> Новий гаманець збереже всі свої записи в окремому зашифрованому сховищі. Старий запис і його архів залишаться незмінними.</div>'+
        '<form data-vault-form="create-isolated"><label class="fieldlabel" for="separatePass">Нова секретна фраза</label>'+
        field('password','separatePass','Від 12 символів','minlength="12" maxlength="200"')+
        '<label class="fieldlabel" for="separatePass2">Повтори нову фразу</label>'+
        field('password','separatePass2','Повтори точно','minlength="12" maxlength="200"')+
        '<label class="gate-option"><input type="checkbox" id="confirmSeparate" required> Я перевірив, що старий зашифрований файл завантажився. Розумію, що новий гаманець буде порожнім, а для старого потрібна колишня секретна фраза.</label>'+
        '<button class="btn primary" type="submit">✅ Створити окремий порожній гаманець</button></form></div>'+
        '<div class="gate-actions"><button class="btn ghost" type="button" id="gateReturn">← Скасувати</button></div>';return;
    }
    if(mode==='restore'){
      getGateContent().innerHTML=`<div class="gate-panel"><h2>📥 Відновити приватний гаманець</h2><p>Обери зашифровану копію у форматі SOL Wallet v2. Дані цього пристрою будуть замінені.</p><form data-vault-form="restore"><label class="fieldlabel" for="gateRestoreFile">Файл .json</label><input class="field" id="gateRestoreFile" type="file" accept=".json,application/json" required><label class="fieldlabel" for="vaultPass">Секретна фраза копії</label>${field('password','vaultPass','Фраза від резервної копії','minlength="1" maxlength="200"')}<button class="btn primary" type="submit">Перевірити та відновити</button></form><button class="btn ghost" id="gateReturn" type="button">← Назад</button></div>`;return;
    }
  }
  async function createLocal(password,migrate){
    if(password.length<12)throw Error('Секретна фраза повинна мати щонайменше 12 символів.');
    if(localStorage.getItem(STORAGE))throw Error('Тут уже є зашифрований гаманець. Щоб його не знищити, створення в цьому сховищі заборонене.');
    let data=migrate?wallet.legacyData():null;
    if(!data)data=wallet.snapshot();wallet.validate(data);
    const s=random(16),k=await derive(password,s,ROUNDS),blob=await seal(data,k,s,ROUNDS);
    const decoded={data,derived:k,s,rounds:ROUNDS};activate(decoded,blob);
    if(migrate)wallet.removeLegacy();
    if(cloudEnabled && account){
      try{await remoteWrite(blob);syncState='synced';updateStatus()}catch(e){syncState='offline';updateStatus()}
    }
  }
  async function unlockLocal(password,blob=readLocal()){
    if(!blob)throw Error('Захищений гаманець не знайдено');const result=await openSealed(blob,password);
    activate(result,blob);
    if(cloudEnabled && pendingRemote && pendingRemote.payload?.salt===blob.salt && pendingRemote.payload?.ciphertext===blob.ciphertext){syncState='synced';updateStatus()}
  }
  async function encryptedRestore(blob,password){
    const result=await openSealed(blob,password);
    if(localStorage.getItem(STORAGE)&&!confirm('Відновити копію та замінити зашифровані дані цього пристрою?'))return;
    const existing=readLocal();
    if(existing&&!sameEnvelope(existing,blob))protectVersion(existing,'before-import');
    active=false;cloudEnabled=false;syncBlocked=false;syncState='local';pendingRemote=null;remoteRevision=null;
    activate(result,blob);
  }
  function bearerHeaders(token,json=true){const h={'apikey':publishable};if(token&&token!==publishable)h.Authorization=`Bearer ${token}`;if(json)h['Content-Type']='application/json';return h}
  async function readApi(path,{method='GET',payload=null,token=null,prefer=null}={}){
    if(!hasCloud)throw Error('Сервер синхронізації ще не налаштований');
    const headers=bearerHeaders(token||publishable,!!payload);
    if(prefer)headers.Prefer=prefer;
    const response=await fetch(baseUrl+path,{method,headers,body:payload?JSON.stringify(payload):undefined,cache:'no-store'});
    let content;try{content=await response.json()}catch(_){content=null}
    if(!response.ok){
      let reason=content?.msg||content?.message||content?.error_description||content?.error||`HTTP ${response.status}`;
      if(response.status===401)reason='Сесія завершилась або неправильний пароль.';
      if(response.status===404&&path.startsWith('/rest/'))reason='Таблиця хмарного гаманця ще не створена або недоступна (SQL migration).';
      const err=new Error(String(reason).slice(0,210));err.status=response.status;if(response.status===409)err.conflict=true;throw err;
    }
    return content;
  }
  function setAuth(tokens){
    if(!tokens?.access_token||!tokens?.refresh_token)throw Error('Сервер не повернув підтверджену сесію');
    auth={access_token:tokens.access_token,refresh_token:tokens.refresh_token,expires_at:Math.floor(Date.now()/1000)+(Number(tokens.expires_in)||3600)};
    sessionStorage.setItem(AUTH_STORAGE,JSON.stringify(auth));
    localStorage.removeItem(AUTH_STORAGE); // Discard persistent tokens left by old app versions.
  }
  function getAuth(){try{const cached=JSON.parse(sessionStorage.getItem(AUTH_STORAGE)||'null');if(!cached?.refresh_token||!cached?.access_token)return null;return cached}catch(e){return null}}
  async function token(){
    if(!auth)auth=getAuth();if(!auth)throw Error('Спочатку увійди в хмарний акаунт');
    if(auth.expires_at>Math.floor(Date.now()/1000)+60)return auth.access_token;
    try{const next=await readApi('/auth/v1/token?grant_type=refresh_token',{method:'POST',payload:{refresh_token:auth.refresh_token}});setAuth(next);return auth.access_token}
    catch(e){auth=null;try{sessionStorage.removeItem(AUTH_STORAGE)}catch(_){};localStorage.removeItem(AUTH_STORAGE);cloudEnabled=false;syncState='offline';updateStatus();throw Error('Хмарна сесія завершилася. Увійди знову. Локальні дані збережені.')}
  }
  async function getUser(){
    const u=await readApi('/auth/v1/user',{token:await token()});
    if(!/^[0-9a-f-]{36}$/i.test(u?.id||''))throw Error('Помилка перевірки власника акаунта');
    account={id:u.id,email:u.email||'',factors:Array.isArray(u.factors)?u.factors:[]};return account;
  }
  function jwtAal(access){
    if(typeof access!=='string')return 'aal1';
    try{const part=access.split('.')[1];if(!part)return 'aal1';const value=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));return value?.aal==='aal2'?'aal2':'aal1'}
    catch(_){return 'aal1'}
  }
  function verifiedFactors(user=account){return (user?.factors||[]).filter(f=>f?.factor_type==='totp'&&f?.status==='verified'&&/^[\w-]{10,80}$/.test(f.id));}
  function mfaRequired(){
    // This local AAL check is defense in depth. Real authorization must be enforced by signed-JWT RLS on the server.
    if(jwtAal(auth?.access_token)!=='aal2')throw Error('Другий фактор ще не підтверджено. Доступ до хмари закритий.');
  }
  async function authorizedToken(){const t=await token();if(jwtAal(t)!=='aal2')throw Error('Сесія потребує повторного підтвердження 2FA.');return t;}
  function clearPendingMfa(){mfaFactor=null;pendingEnrollment=null;}
  async function beginMfa(user=account){
    const factors=verifiedFactors(user);clearPendingMfa();
    if(factors.length){mfaFactor=factors[0].id;renderGate('mfa-verify');return;}
    const enrolled=await readApi('/auth/v1/factors',{method:'POST',token:await token(),payload:{factor_type:'totp',friendly_name:'SOL Wallet'}});
    if(!enrolled||typeof enrolled.id!=='string'||enrolled.type!=='totp'||typeof enrolled.totp?.secret!=='string'||!enrolled.totp.secret||typeof enrolled.totp?.qr_code!=='string')throw Error('Сервер не надав дані для підключення Authenticator.');
    mfaFactor=enrolled.id;pendingEnrollment={id:enrolled.id,secret:enrolled.totp.secret,qr:enrolled.totp.qr_code};
    renderGate('mfa-setup');
  }
  async function verifyMfa(code){
    if(!/^\d{6}$/.test(code))throw Error('Введи шість цифр із застосунку Authenticator.');
    if(!mfaFactor||!auth)throw Error('Сеанс 2FA не знайдено. Увійди ще раз.');
    const factor=encodeURIComponent(mfaFactor);
    const challenge=await readApi('/auth/v1/factors/'+factor+'/challenge',{method:'POST',token:await token(),payload:{}});
    if(!challenge||typeof challenge.id!=='string')throw Error('Сервер не створив перевірку 2FA.');
    const verified=await readApi('/auth/v1/factors/'+factor+'/verify',{method:'POST',token:await token(),payload:{challenge_id:challenge.id,code}});
    if(!verified?.access_token||!verified?.refresh_token||jwtAal(verified.access_token)!=='aal2')throw Error('Другий фактор не підтверджено сервером.');
    setAuth(verified);const user=await getUser();
    if(!verifiedFactors(user).length)throw Error('Authenticator ще не підтверджений у профілі. Хмарний доступ закрито.');
    clearPendingMfa();await cloudOpen();
  }
  async function signin(email,password){
    if(!email.includes('@')||password.length<12)throw Error('Перевір email і пароль');
    const result=await readApi('/auth/v1/token?grant_type=password',{method:'POST',payload:{email,password}});
    setAuth(result);const user=await getUser();if(jwtAal(result.access_token)==='aal2'&&verifiedFactors(user).length)await cloudOpen();else await beginMfa(user);
  }
  async function signup(email,password){
    if(!email.includes('@')||password.length<12)throw Error('Введи email і пароль від 12 символів');
    const result=await readApi('/auth/v1/signup',{method:'POST',payload:{email,password}});
    if(result?.access_token&&result?.refresh_token){setAuth(result);const user=await getUser();await beginMfa(user);return}
    renderGate('cloud');setMessage('Перевір пошту й підтвердь створення акаунта. Після цього увійди. Якщо реєстрацію вимкнено, акаунт додає адміністратор.');
  }
  async function remoteRead(){
    mfaRequired();
    const route='/rest/v1/sol_wallets?select=revision,payload,updated_at&user_id=eq.'+encodeURIComponent(account.id);
    const rows=await readApi(route,{token:await authorizedToken()});
    if(!Array.isArray(rows))throw Error('Неправильна відповідь хмарного сховища');
    if(!rows.length)return null;
    if(rows.length!==1||!Number.isSafeInteger(rows[0].revision)||rows[0].revision<1)throw Error('Хмара повернула некоректну версію даних');
    checkPayload(rows[0].payload);return rows[0];
  }
  async function cloudOpen(){
    mfaRequired();
    pendingRemote=await remoteRead();remoteRevision=pendingRemote?.revision??null;
    const local=readLocal();
    if(!pendingRemote){
      if(local){renderGate('cloud-upload');return}
      cloudEnabled=true;syncState='online';renderGate('start');setMessage('Акаунт підключено. Створи новий секретний гаманець — він буде синхронізуватися після першого запису.');return;
    }
    if(local){
      if(local.salt===pendingRemote.payload.salt && local.iv===pendingRemote.payload.iv && local.ciphertext===pendingRemote.payload.ciphertext){
        cloudEnabled=true;syncState='synced';
        if(active){toggleGate(false);updateStatus()}else renderGate('start');return;
      }
      renderGate('cloud-choice');return;
    }
    renderGate('remote-unlock');
  }
  async function remoteWrite(blob,{replace=false}={}){
    checkPayload(blob);
    const t=await authorizedToken();
    if(remoteRevision===null){
      const results=await readApi('/rest/v1/sol_wallets',{method:'POST',token:t,prefer:'return=representation',payload:{user_id:account.id,revision:1,payload:blob}});
      if(!Array.isArray(results)||results.length!==1||results[0].revision!==1||!sameEnvelope(results[0].payload,blob))throw Error('Не вдалося перевірити запис у хмару');remoteRevision=1;return;
    }
    const old=remoteRevision;
    const path='/rest/v1/sol_wallets?user_id=eq.'+encodeURIComponent(account.id)+'&revision=eq.'+encodeURIComponent(old);
    const updated=await readApi(path,{method:'PATCH',token:t,prefer:'return=representation',payload:{revision:old+1,payload:blob}});
    if(!Array.isArray(updated)||updated.length!==1){const error=new Error('Інший пристрій уже оновив гаманець; локальна версія захищена, потрібно вручну обрати актуальну.');error.conflict=true;throw error}
    if(updated[0].revision!==old+1||!sameEnvelope(updated[0].payload,blob))throw Error('Сервер не підтвердив точну зашифровану версію; перевір синхронізацію');
    remoteRevision=old+1;
  }
  async function forceReplaceRemote(blob){
    const row=await remoteRead();remoteRevision=row?.revision??null;
    if(row&&!sameEnvelope(row.payload,blob))protectVersion(row.payload,'before-cloud-replace');
    await remoteWrite(blob);cloudEnabled=true;syncBlocked=false;syncState='synced';updateStatus();
  }
  async function cloudUpload(){
    const blob=readLocal();if(!blob)throw Error('Немає локальної копії');
    mfaRequired();await remoteWrite(blob);cloudEnabled=true;syncBlocked=false;syncState='synced';
    if(active){toggleGate(false);updateStatus()}else renderGate('start');
  }
  function persist(snapshot){
    if(!active||!key)return Promise.reject(Error('Спочатку відкрий гаманець'));
    const data=JSON.parse(JSON.stringify(snapshot));wallet.validate(data);
    queue=queue.catch(()=>{}).then(async()=>{
      const blob=await seal(data,key,salt,iterations);storeLocal(blob);
      if(cloudEnabled&&!syncBlocked){
        syncState='saving';updateStatus();
        try{await remoteWrite(blob);syncState='synced'}
        catch(e){syncState=e.conflict?'conflict':'offline';if(e.conflict){syncBlocked=true;cloudEnabled=false} console.warn('SOL sync unavailable',e?.status||e?.conflict||'network');}
      }
      updateStatus();
    });
    return queue;
  }
  async function syncNow(){
    if(!active)throw Error('Спочатку відкрий гаманець');
    if(account)mfaRequired();
    if(!hasCloud)throw Error('Хмара поки не налаштована. Заповни поля нижче у «Дані та безпека».');
    if(!account){renderGate('cloud');return 'signin'}
    await queue;
    const remote=await remoteRead();
    pendingRemote=remote;
    remoteRevision=remote?.revision??null;
    if(!remote){renderGate('cloud-upload');return 'upload-choice'}
    const local=readLocal();
    if(!local)throw Error('Не знайшла локальну захищену копію.');
    if(local.ciphertext===remote.payload.ciphertext&&local.iv===remote.payload.iv&&local.salt===remote.payload.salt){
      syncBlocked=false;cloudEnabled=true;syncState='synced';updateStatus();return 'synced';
    }
    // Never make an unsafe last-writer-wins decision for money data.
    syncBlocked=true;cloudEnabled=false;syncState='conflict';updateStatus();renderGate('cloud-choice');
    return 'conflict-choice';
  }
  async function lock(){
    if(!active){
      auth=null;account=null;clearPendingMfa();pendingRemote=null;remoteRevision=null;cloudEnabled=false;syncBlocked=false;syncState='local';
      try{sessionStorage.removeItem(AUTH_STORAGE)}catch(_){};try{localStorage.removeItem(AUTH_STORAGE)}catch(_){};
      renderGate('start');updateStatus();return;
    }
    try{await queue}catch(e){}
    active=false;key=null;salt=null;currentData=null;
    auth=null;account=null;clearPendingMfa();try{sessionStorage.removeItem(AUTH_STORAGE)}catch(_){};localStorage.removeItem(AUTH_STORAGE);
    clearTimeout(idleTimer);
    cloudEnabled=false;syncState='local';pendingRemote=null;remoteRevision=null;syncBlocked=false;
    wallet.onLock();renderGate('start');updateStatus();
  }
  function download(filename,content){const blob=new Blob([content],{type:'application/json;charset=utf-8'});const href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(href),2500)}
  async function exportEncrypted(){await queue;const blob=readLocal();if(!blob)throw Error('Немає захищеної копії');download('SOL_Wallet_ENCRYPTED_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(blob,null,2))}
  async function restoreEncrypted(blob,validate){checkPayload(blob);
    if(!active)throw Error('Спочатку відкрий гаманець');
    // Importing another vault requires locking, entering its own password and decrypting.
    if(blob.salt!==sealed?.salt)throw Error('Ця копія має іншу секретну фразу. Заблокуй гаманець і вибери «Відновити захищений JSON».');
    try{
      const {iv,ct}=checkPayload(blob);
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:te.encode('SOL-WALLET-v2')},key,ct);
      const data=JSON.parse(td.decode(plain));validate(data);
      if(!confirm('Замінити записи поточного гаманця даними з цієї захищеної копії?'))return;
      await queue;const existing=readLocal();
      if(existing&&!sameEnvelope(existing,blob))protectVersion(existing,'before-import');
      storeLocal(blob);currentData=data;wallet.afterRestore(data);syncBlocked=true;cloudEnabled=false;syncState='local';updateStatus();
    }catch(e){if(e.name==='OperationError')throw Error('Файл не розшифровується поточним ключем. Заблокуй і віднови з секретною фразою копії.');throw e}
  }
  function showCloud(){if(!active)return;
    if(!hasCloud){const where=byId('syncInfo');if(where)where.textContent='☁️ Для хмарної синхронізації потрібна власна база Supabase і налаштований конфігураційний файл. Поки що дані залишаються захищеними локально.';return}
    renderGate('cloud');
  }
  async function handleForm(e){
    const f=e.target.closest('form[data-vault-form]');if(!f)return;e.preventDefault();const task=f.dataset.vaultForm;
    const button=f.querySelector('button[type=submit]');button.disabled=true;setMessage('Перевіряю…');
    try{
      if(task==='create'){
        const pass=byId('vaultPass').value;if(pass!==byId('vaultPass2').value)throw Error('Секретні фрази не збігаються');
        await createLocal(pass,!!byId('migrateOld')?.checked);
        if(cloudEnabled){syncState='online';updateStatus()}
      }else if(task==='unlock'){await unlockLocal(byId('vaultPass').value)}
      else if(task==='create-isolated'){
        if(!byId('confirmSeparate')?.checked||!oldArchiveRequested)throw Error('Потрібно підтвердити збереження старого архіву.');
        const pass=byId('separatePass').value;
        if(pass!==byId('separatePass2').value)throw Error('Нові секретні фрази не збігаються.');
        if(!confirm('Створити окремий ПОРОЖНІЙ гаманець? Старі записи залишаться зашифровані та НЕ перейдуть у новий.'))return;
        await createIsolatedWallet(pass);
        alert('Новий порожній гаманець створено. Старий зашифрований запис не змінено. Збережи нову фразу у менеджері паролів.');
      }
      else if(task==='signup'){await signup(byId('accountEmail').value.trim(),byId('accountPassword').value)}
      else if(task==='signin'){await signin(byId('accountEmail').value.trim(),byId('accountPassword').value)}
      else if(task==='mfa-setup'||task==='mfa-verify'){await verifyMfa(byId('mfaCode').value.trim())}
      else if(task==='remote-unlock'){
        const remote=pendingRemote;
        if(!remote)throw Error('Хмарна копія недоступна');const result=await openSealed(remote.payload,byId('vaultPass').value);
        const existing=readLocal();
        if(existing&&!sameEnvelope(existing,remote.payload))protectVersion(existing,'before-local-replace');
        mfaRequired();cloudEnabled=true;syncBlocked=false;syncState='synced';activate(result,remote.payload);
      }
      else if(task==='restore'){
        const file=byId('gateRestoreFile').files[0];if(!file||file.size>10000000)throw Error('Обери коректний файл до 10 МБ');
        const blob=JSON.parse(await file.text());await encryptedRestore(blob,byId('vaultPass').value);
      }
      setMessage('');
    }catch(err){setMessage(err.message||'Не вдалося виконати операцію',true)}
    finally{button.disabled=false}
  }
  async function handleClick(e){
    const element=e.target.closest('button');if(!element)return;
    const v=element.id;
    if(!['gateRestore','gateCloud','gateReturn','gateSignup','gateSignin','chooseRemote','chooseLocal','confirmUpload','gateForgot','archiveOriginal','createIsolated','switchNew','switchOld'].includes(v))return;
    try{
      if(v==='gateRestore')renderGate('restore');
      if(v==='gateForgot'){oldArchiveRequested=false;renderGate('forgot');}
      if(v==='archiveOriginal'){downloadOriginalLocked();setMessage('Запит на завантаження надісланий. Перевір, що старий JSON-файл справді є в Завантаженнях.');}
      if(v==='createIsolated'){if(!oldArchiveRequested)throw Error('Спочатку завантаж стару зашифровану копію.');renderGate('create-isolated');}
      if(v==='switchNew')switchVaultSlot('new');
      if(v==='switchOld')switchVaultSlot('old');
      if(v==='gateCloud')renderGate('cloud');
      if(v==='gateReturn'){
        if(active){
          // Cancel an unfinished cloud-link flow without leaving an unused session token behind.
          if(!cloudEnabled&&account){auth=null;account=null;clearPendingMfa();pendingRemote=null;remoteRevision=null;syncBlocked=false;syncState='local';
            try{sessionStorage.removeItem(AUTH_STORAGE)}catch(_){};try{localStorage.removeItem(AUTH_STORAGE)}catch(_){};updateStatus()}
          toggleGate(false);
        }else await lock();
      }
      if(v==='gateSignup')renderGate('cloud-signup');
      if(v==='gateSignin')renderGate('cloud');
      if(v==='confirmUpload'){element.disabled=true;await cloudUpload()}
      if(v==='chooseRemote'){mfaRequired();
        if(!confirm('Хмарна версія замінить локальні записи на цьому пристрої. Зроби резервну копію, якщо вони потрібні. Продовжити?'))return;
        active=false;key=null;salt=null;currentData=null;wallet.onLock();
        // The old encrypted local copy stays untouched until the remote vault is successfully decrypted.
        renderGate('remote-unlock');
      }
      if(v==='chooseLocal'){mfaRequired();
        if(!confirm('Зашифрована локальна версія замінить хмарну. Цю дію не можна скасувати. Продовжити?'))return;
        element.disabled=true;await forceReplaceRemote(readLocal());
        if(active){toggleGate(false)}else renderGate('start');
      }
    }catch(err){setMessage(err.message||'Помилка',true)}finally{element.disabled=false}
  }
  function init(api){
    wallet=api;try{localStorage.removeItem(AUTH_STORAGE)}catch(_){}; if(!supportsCrypto()) {getGateContent().innerHTML='<div class="gate-panel"><h2>Браузер не підтримує захищений режим</h2><p>Відкрийте застосунок через HTTPS у сучасному браузері. Не вводьте фінансові дані, доки шифрування не працює.</p></div>';return}
    document.addEventListener('submit',handleForm);
    document.addEventListener('click',handleClick);
    for(const event of ['pointerdown','keydown','touchstart'])document.addEventListener(event,remember,{passive:true});
    window.addEventListener('online',()=>{if(active&&account&&syncState==='offline'){syncNow().catch(()=>{})}});
    renderGate('start');
  }
  window.SOLVault={init,persist,exportEncrypted,restoreEncrypted,lock,showCloud,statusText,syncNow,recoveryCopies,downloadRecovery};
})();

