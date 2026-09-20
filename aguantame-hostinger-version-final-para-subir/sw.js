const CACHE='aguantame-v12';
const ASSETS=['./','./index.html','./styles.css','./app.js','./logo_aguantame.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>Promise.all(ASSETS.map(asset=>fetch(asset,{cache:'reload'}).then(response=>cache.put(asset,response))))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('aguantame-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>event.respondWith(caches.match(event.request).then(response=>response||fetch(event.request))));
