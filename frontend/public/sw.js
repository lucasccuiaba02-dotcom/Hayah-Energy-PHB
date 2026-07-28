/* global self, clients, caches */
// Service Worker - Hayah Energy PWA
const CACHE_NAME = 'hayah-v1';
const OFFLINE_QUEUE_KEY = 'hayah_offline_queue';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Network-first strategy for API, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) {
    // API requests: network-first
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ offline: true, error: 'Sem conexão' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }
  // Static: network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Background sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'hayah-sync-checklists') {
    event.waitUntil(syncOfflineQueue());
  }
});

async function syncOfflineQueue() {
  try {
    const clients_list = await self.clients.matchAll();
    clients_list.forEach((c) => c.postMessage({ type: 'SYNC_REQUEST' }));
  } catch (e) {
    console.error('Sync error', e);
  }
}
