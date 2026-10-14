/* SOL Wallet offline shell, no user data cached. */
const CACHE='sol-wallet-v6-standalone-2026-10-14';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('sol-wallet-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;let u=new URL(e.request.url);if(u.origin!==self.location.origin||!(['navigate','same-origin'].includes(e.request.mode)))return;
e.respondWith((async()=>{try{const res=await fetch(e.request,{cache:'no-store'});if(res.ok){const c=await caches.open(CACHE);await c.put(e.request,res.clone())}return res}catch(_){return (await caches.match(e.request))||(e.request.mode==='navigate'?await caches.match('./index.html'):Response.error())}})())});