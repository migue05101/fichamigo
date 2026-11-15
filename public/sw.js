// Service worker mínimo: permite instalar la app (Android/Chrome) y abrirla sin conexión si ya se cargó antes.
const CACHE="fichamigo-v5";
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["/","/manifest.webmanifest","/icon-192.png","/icon-512.png"])).catch(()=>{}))});
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{const u=new URL(e.request.url);
  if(e.request.method!=="GET"||u.origin!==location.origin||u.pathname.startsWith("/api/"))return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok&&(u.pathname==="/"||u.pathname==="/index.html")){const cp=r.clone();caches.open(CACHE).then(c=>c.put("/",cp))}return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match("/"))))});

// Notificaciones: vibran y llevan a la app al tocarlas
self.addEventListener("push",e=>{let d={};try{d=e.data?e.data.json():{}}catch(_){d={title:"Fichamigo",body:e.data&&e.data.text()}}
  e.waitUntil(self.registration.showNotification(d.title||"Fichamigo",{body:d.body||"",icon:"/icon-192.png",badge:"/icon-192.png",tag:d.tag||"fichamigo",renotify:true,vibrate:[200,100,200,100,300],data:{url:d.url||"/"}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();const url=(e.notification.data&&e.notification.data.url)||"/";
  e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(ws=>{for(const w of ws){if("focus" in w)return w.focus()}return clients.openWindow(url)}))});
