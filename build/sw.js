// public/service-worker.js
const CACHE_NAME = 'smashers-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo192.png',
  '/logo512.png',
  // Add other essential assets here (e.g., your bundled JS/CSS files once built)
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
  const data = event.data.json();
  console.log('Push received:', data);

  const title = data.title || 'Smashers Badminton Notification';
  const options = {
    body: data.body || 'You have a new update!',
    icon: '/logo192.png', // Or a specific notification icon
    badge: '/logo192.png', // Badge for Android
    data: {
      url: data.url || '/' // URL to open when notification is clicked
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close(); // Close the notification

  event.waitUntil(
    clients.openWindow(event.notification.data.url) // Open the URL specified in the notification
  );
});