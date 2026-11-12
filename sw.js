/* 排氨 2.0｜路徑隔離的 PWA 離線快取；可同時安裝單元版與整合入口版。 */
const VERSION='2.0.2-2026-11-12';
const SAFE_SCOPE=new URL(self.registration.scope).pathname.replace(/[^a-zA-Z0-9]/g,'_');
const PREFIX='bio-anomi-'+SAFE_SCOPE+'-';
const CACHE_NAME=PREFIX+VERSION;
const SHELL=[
  './','./index.html','./styles.css','./app.js','./manifest.webmanifest','./unit.json',
  './icons/icon-192.png','./icons/icon-512.png',
  './icons/icon-maskable-512.png','./icons/apple-touch-icon.png','./icons/favicon-96.png'
];
self.addEventListener('install',event=>{
  // 所有必要檔案都成功下載才完成安裝；避免錯把部分快取標成離線可用。
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE_NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url),scope=new URL(self.registration.scope);
  if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    if(event.request.mode==='navigate'){
      const hit=await cache.match(event.request,{ignoreSearch:true});
      if(hit)return hit;
      const fallback=await cache.match('./index.html');
      if(fallback)return fallback;
    }
    return await cache.match(event.request,{ignoreSearch:true})||fetch(event.request);
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type!=='CHECK_OFFLINE'||!event.ports?.[0])return;
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const existing=await Promise.all(SHELL.map(p=>cache.match(p)));
    event.ports[0].postMessage({ready:existing.every(Boolean),version:VERSION});
  })());
});
