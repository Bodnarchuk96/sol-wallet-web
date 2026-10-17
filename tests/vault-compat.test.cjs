'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const page=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

test('Existing wallet sign-in permits short historic phrases',()=>{
 assert.match(page,/exists\?'minlength="1" maxlength="200"':'minlength="12" maxlength="200"'/);
 assert.match(page,/exists\?'Поточна секретна фраза':'Мінімум 12 символів'/);
});
test('New wallet setup requires at least twelve characters',()=>{
 assert.match(page,/function createLocal\(password,migrate\)\s*\{\s*if\(password\.length<12\)/);
 assert.match(page,/field\('password','vaultPass2','Повтори точно','minlength="12" maxlength="200"'\)/);
});
test('Recovery and cloud unlock also accept old phrase lengths',()=>{
 assert.match(page,/field\('password','vaultPass','Твоя окрема секретна фраза','minlength="1" maxlength="200"'\)/);
 assert.match(page,/field\('password','vaultPass','Фраза від резервної копії','minlength="1" maxlength="200"'\)/);
});
test('Cryptographic phrase verification still uses the encrypted snapshot',()=>{
 assert.match(page,/async function unlockLocal\(password,blob=readLocal\(\)\)/);
 assert.match(page,/await openSealed\(blob,password\)/);
 assert.match(page,/AES-GCM/);
});
