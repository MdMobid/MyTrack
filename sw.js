const CACHE_NAME = 'mytrack-v2.4';
const ASSETS = [
  './',
  './index.html',
  './habits.html',
  './todos.html',
  './expenses.html',
  './logs.html',
  './css/shared.css',
  './css/today.css',
  './css/habits.css',
  './css/todos.css',
  './css/expenses.css',
  './css/logs.css',
  './js/db.js',
  './js/today.js',
  './js/habits.js',
  './js/todos.js',
  './js/expenses.js',
  './js/logs.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Only cache GET requests — POST/PUT/etc. are unsupported by Cache API
  if (e.request.method !== 'GET') return;

  // Do not cache API requests to MongoDB
  if (e.request.url.includes('mongodb-api.com')) {
    return; // Pass through to browser fetch
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      // Return cached version or fetch from network and cache
      return cached || fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, resClone));
        return res;
      });
    })
  );
});
