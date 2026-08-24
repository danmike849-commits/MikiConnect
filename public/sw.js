// Neutral Service Worker - Prevents local static caching
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => self.clients.claim());
self.addEventListener('fetch', (e) => {
  // Always fetch fresh data directly from the network
  e.respondWith(fetch(e.request));
});
