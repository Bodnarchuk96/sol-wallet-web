'use strict';
// Rebuild CSP SHA-256 for exact inline script bytes. No inline script can silently lose its CSP permission.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const target=path.join(__dirname,'..','index.html');
const html=fs.readFileSync(target,'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/\bsrc\s*=/.test(m[1]));
if(scripts.length<5||scripts.length>25)throw Error('Unexpected inline script count '+scripts.length);
const hashes=scripts.map(m=>"'sha256-"+crypto.createHash('sha256').update(m[2].replace(/\r\n?/g,'\n'),'utf8').digest('base64')+"'");
const meta=/\bhttp-equiv="Content-Security-Policy" content="([^"]+)"/;
const match=html.match(meta);if(!match)throw Error('CSP meta header missing');
const rewritten=match[1].replace(/script-src [^;]+;/,"script-src 'self' "+hashes.join(' ')+';');
if(rewritten===match[1]&&!match[1].includes(hashes[0]))throw Error('CSP could not be updated');
const output=html.replace(match[0],match[0].replace(match[1],rewritten));
fs.writeFileSync(target,output,'utf8');
console.log('CSP hashes updated for '+scripts.length+' inline scripts.');
