'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')+'\n'+fs.readFileSync(path.join(root,'vault.js'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase','sol_wallets_mfa.sql'),'utf8');
test('Every inline script compiles and has a valid SHA-256 in the CSP, no unsafe eval',()=>{
 const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
 assert.ok(policy);assert.doesNotMatch(policy,/unsafe-eval|script-src [^;]*unsafe-inline/);
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/\bsrc\s*=/.test(m[1]));
 assert.ok(scripts.length>=5);
 for(const s of scripts){
  new vm.Script(s[2]);
  const hash="'sha256-"+crypto.createHash('sha256').update(s[2].replace(/\r\n?/g,'\n')).digest('base64')+"'";
  assert.ok(policy.includes(hash),'inline script CSP mismatch');
 }
});
test('Cloud wallet read and write require elevated AAL2 in the active session',()=>{
 assert.match(html,/async function authorizedToken/);
 assert.ok(html.includes("if(jwtAal(t)!=='aal2')"),'token AAL2 check exists');
 assert.match(html,/async function remoteRead\(\)\{\s*mfaRequired\(\)/);
 assert.match(html,/const rows=await readApi\(route,\{token:await authorizedToken\(\)\}\)/);
 assert.match(html,/const t=await authorizedToken\(\)/);
 assert.match(html,/async function cloudOpen\(\)\{\s*mfaRequired\(\)/);
});
test('Server-backed authenticator flow with enrollment, challenge, verify, and confirmed AAL2 only',()=>{
 assert.match(html,/\/auth\/v1\/factors/);
 assert.match(html,/\/challenge/);
 assert.match(html,/\/verify/);
 assert.match(html,/factor_type:'totp'/);
 assert.match(html,/jwtAal\(verified.access_token\)!=='aal2'/);
 assert.match(html,/task==='mfa-setup'\|\|task==='mfa-verify'/);
});
test('Private cloud migration has both owner and AAL2 restrictive policies',()=>{
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/as restrictive for all to authenticated/g);
 assert.match(sql,/user_id = \(select auth.uid\(\)\)/);
 assert.match(sql,/auth.jwt\(\) ->> 'aal'\) = 'aal2'/);
 assert.match(sql,/revoke all on public.sol_wallets from public, anon/i);
});
test('Sensitive MFA values never written to storage or public git placeholders',()=>{
 assert.doesNotMatch(html,/localStorage\.setItem\(.+pendingEnrollment|sessionStorage\.setItem\(.+mfaFactor/);
 assert.match(html,/function clearPendingMfa/);
 assert.match(html,/clearPendingMfa\(\);await cloudOpen\(\)/);
});
