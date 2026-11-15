// Service worker mínimo: permite instalar la app (Android/Chrome) y abrirla sin conexión si ya se cargó antes.
const CACHE="fichamigo-v1";
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["/","/manifest.webmanifest","/icon-192.png","/icon-512.png"])).catch(()=>{}))});
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);
  if(e.request.method!=="GET"||u.origin!==location.origin||u.pathname.startsWith("/api/"))return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok&&(u.pathname==="/"||u.pathname==="/index.html")){const cp=r.clone();caches.open(CACHE).then(c=>c.put("/",cp))}return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match("/"))))});
