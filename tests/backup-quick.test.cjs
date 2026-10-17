'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
test('Backup quick button is visible and labeled for encrypted-only export',()=>{
 assert.match(html,/id="walletBackupQuick"/);
 assert.match(html,/Зберегти зашифровану копію/);
 assert.match(html,/id="backupQuickStatus"/);
});
test('Backup action uses the established encrypted exporter, never CSV',()=>{
 assert.match(html,/document.getElementById\('walletBackupQuick'\)\?\.addEventListener\('click',async function/);
 assert.match(html,/await window.SOLVault.exportEncrypted\(\)/);
 assert.match(html,/if\(document.querySelector\('\.app.locked'\)\)return/);
 const block=html.match(/document.getElementById\('walletBackupQuick'\)\?\.addEventListener\('click',async function\(\)\{([\s\S]*?)\n \}\);/)?.[1]||'';
 assert.ok(block&&!block.includes('exportCsv'),'Backup click should not export plaintext CSV');
});
test('Backup download source reads existing sealed vault, not decrypted state',()=>{
 assert.match(html,/async function exportEncrypted\(\)\{await queue;const blob=readLocal\(\);/);
 assert.match(html,/SOL_Wallet_ENCRYPTED_/);
 assert.match(html,/ciphertext:/);
});
