const V='nutri-v1';
const FILES=['./','index.html','style.css','app.js','excel.js','datos.js','xlsx.mini.min.js','manifest.webmanifest','icon-192.png','icon-180.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;
 e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(hit=>{const net=fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(V).then(ch=>ch.put(e.request,c));}return r;}).catch(()=>hit);return hit||net;}));});
