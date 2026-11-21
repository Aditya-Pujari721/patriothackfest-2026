const CACHE = 'aquaspec-v6';
const files = ['./index.html', './manifest.json', './captures.js'];
const absolute = file => new URL(file, self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(files.map(file => new Request(absolute(file), {cache: 'reload'})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('hollownet-edge-') || (name.startsWith('aquaspec-') && name !== CACHE)) {
        await caches.delete(name);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data !== 'check-cache') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const entries = await Promise.all(files.map(file => cache.match(absolute(file))));
    event.ports[0].postMessage(entries.every(Boolean) ? 'cached' : 'missing');
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const page = url.pathname === new URL(self.registration.scope).pathname;
  const asset = page ? './index.html' : files.find(file => absolute(file) === url.origin + url.pathname);
  if (!asset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(absolute(asset)) || fetch(event.request);
  })());
});
