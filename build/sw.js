// public/service-worker.js
const CACHE_NAME = 'smashers-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo192.png',
  '/logo512.png',
  '/static/js/bundle.js',
  '/static/css/main.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
      caches.open(CACHE_NAME)
          .then((cache) => {
              console.log('Opened cache');
              return cache.addAll(urlsToCache);
          })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// --- Placeholder for Push Notification Logic ---
self.addEventListener('push', function(event) {
  let data;
  try {
      data = event.data.json();
  } catch (e) {
      console.error('Invalid push data:', e);
      data = { title: 'Error', body: 'Notification data invalid.' };
  }
  const title = data.title || 'Smashers Badminton Notification';
  const options = {
      body: data.body || 'You have a new update!',
      icon: '/logo192.png',
      badge: '/logo192.png',
      data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});