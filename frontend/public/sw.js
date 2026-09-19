/* global self, clients, caches, fetch, Response */
/* eslint-disable no-restricted-globals */
// Hayah Energy - Service Worker (Full offline app shell)
// Fev/2026 - v3: precache + stale-while-revalidate + navigation fallback

const SW_VERSION = 'hayah-v5-2026-09-campo';
const APP_SHELL_CACHE = `${SW_VERSION}-shell`;
const STATIC_CACHE = `${SW_VERSION}-static`;
const IMAGE_CACHE = `${SW_VERSION}-images`;
const API_CACHE = `${SW_VERSION}-api`;

// Recursos essenciais do app shell — permitem carregar o app sem internet
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
];

// ==================== INSTALL ====================
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL_CACHE);
    // Faz precache, ignora falhas individuais (ex: favicon 404)
    await Promise.all(APP_SHELL_URLS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res && (res.ok || res.type === 'opaque')) {
          await cache.put(url, res.clone());
        }
      } catch (_) { /* ignora */ }
    }));
    self.skipWaiting();
  })());
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Remove caches antigos
    const names = await caches.keys();
    await Promise.all(names.map((n) => {
      if (!n.startsWith(SW_VERSION)) return caches.delete(n);
      return null;
    }));
    await self.clients.claim();
    // Avisa clientes que o SW está pronto
    const list = await self.clients.matchAll({ type: 'window' });
    list.forEach((c) => c.postMessage({ type: 'SW_READY', version: SW_VERSION }));
  })());
});

// ==================== FETCH ====================
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Só interceptamos GETs (POST/PUT/DELETE deixamos passar)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) Navegação (HTML) → network-first com fallback pro index em cache
  if (req.mode === 'navigate' || (req.destination === 'document')) {
    event.respondWith(handleNavigate(req));
    return;
  }

  // 2) API do backend → network-first com fallback JSON
  //    Detecta tanto /api/* mesmo domínio quanto backend externo com /api
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) {
    event.respondWith(handleApi(req));
    return;
  }

  // 3) Imagens (mesma origem ou backend) → cache-first
  if (req.destination === 'image') {
    event.respondWith(handleImage(req));
    return;
  }

  // 4) Assets estáticos (JS, CSS, fontes) → stale-while-revalidate
  if (sameOrigin && (
    url.pathname.startsWith('/static/') ||
    ['script', 'style', 'font'].includes(req.destination)
  )) {
    event.respondWith(handleStatic(req));
    return;
  }

  // 5) Fontes externas (Google Fonts) → SWR
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(handleStatic(req));
    return;
  }

  // 6) Default: network com fallback pro cache
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

// -------- Handlers --------
async function handleNavigate(req) {
  try {
    const net = await fetch(req);
    if (net && net.ok) {
      const cache = await caches.open(APP_SHELL_CACHE);
      cache.put('/index.html', net.clone()).catch(() => {});
      return net;
    }
    throw new Error('network not ok');
  } catch (_) {
    // Offline: retorna o shell cacheado
    const cached = await caches.match('/index.html') || await caches.match('/');
    if (cached) return cached;
    return new Response(
      '<!doctype html><html><body style="background:#050505;color:#fff;font-family:sans-serif;padding:2rem"><h2>Sem conexão</h2><p>Abra o app quando estiver online ao menos uma vez para habilitar o modo offline.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function handleApi(req) {
  const url = new URL(req.url);
  // GETs de leitura de projetos/dashboard/etc: cache leve
  try {
    const net = await fetch(req);
    if (net && net.ok) {
      // Cacheia apenas endpoints "seguros" para leitura offline
      if (isCacheableApi(url.pathname)) {
        const cache = await caches.open(API_CACHE);
        cache.put(req, net.clone()).catch(() => {});
      }
      return net;
    }
    // Erro de borda/servidor (502/503/504/52x) em leitura: serve a última cópia boa em cache, se houver
    if (req.method === 'GET' && net && net.status >= 500) {
      const cached = await caches.match(req);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set('X-From-Cache', 'true');
        headers.set('X-Upstream-Status', String(net.status));
        return new Response(await cached.blob(), { status: cached.status, headers });
      }
    }
    return net;
  } catch (_) {
    // Offline: tenta servir do cache
    const cached = await caches.match(req);
    if (cached) {
      // Adiciona header pra frontend saber que veio do cache offline
      const headers = new Headers(cached.headers);
      headers.set('X-From-Cache', 'true');
      const body = await cached.blob();
      return new Response(body, { status: cached.status, headers });
    }
    return new Response(
      JSON.stringify({ offline: true, error: 'Sem conexão. Dados serão sincronizados quando voltar online.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

function isCacheableApi(pathname) {
  // Cacheia listas de leitura essenciais (+ Set/2026: pacote do dia do Modo Campo, checklist/fotos/APRs da obra)
  const patterns = [
    '/api/projects',
    '/api/teams',
    '/api/materials',
    '/api/equipamentos',
    '/api/schedule/calendar',
    '/api/dashboard',
    '/api/analytics',
    '/api/auth/me',
    '/api/campo',
    '/api/operacional',
    '/api/aprs',
  ];
  return patterns.some((p) => pathname.includes(p));
}

async function handleImage(req) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = (await cache.match(req)) || (await caches.match(req));
  if (cached) {
    // Revalida em background
    fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    }).catch(() => {});
    return cached;
  }
  try {
    const net = await fetch(req);
    if (net && (net.ok || net.type === 'opaque')) {
      cache.put(req, net.clone()).catch(() => {});
    }
    return net;
  } catch (_) {
    // Placeholder mínimo para imagens offline
    return new Response('', { status: 504 });
  }
}

async function handleStatic(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// ==================== PUSH NOTIFICATIONS ====================
self.addEventListener('push', (event) => {
  let data = { title: 'Hayah Energy', body: 'Nova notificação', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/logo192.png',
      badge: '/logo192.png',
      tag: data.tag || 'hayah-notification',
      data: { url: data.url || '/' },
      vibrate: [180, 80, 180],
      requireInteraction: !!data.requireInteraction,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.postMessage({ type: 'PUSH_NAV', url: target });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// ==================== BACKGROUND SYNC ====================
self.addEventListener('sync', (event) => {
  if (event.tag === 'hayah-sync-checklists' || event.tag === 'hayah-sync-photos') {
    event.waitUntil(notifyClientsToSync());
  }
});

async function notifyClientsToSync() {
  try {
    const list = await self.clients.matchAll();
    list.forEach((c) => c.postMessage({ type: 'SYNC_REQUEST' }));
  } catch (e) {
    console.error('Sync notify error', e);
  }
}

// Permite forçar update pelo cliente
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
