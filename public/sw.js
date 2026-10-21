// Service Worker - MyWallet PWA
// Supports offline mode + caching of static assets

const CACHE_NAME = 'mywallet-v2';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// Install - pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter(c => c !== CACHE_NAME).map(c => caches.delete(c))
      );
    })
  );
  self.clients.claim();
});

// Fetch - cache-first for static, NETWORK-ONLY for API (avoid stale data)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Don't intercept non-GET
  if (req.method !== 'GET') return;

  // Skip Next.js HMR and dev requests
  if (url.pathname.startsWith('/_next/webpack-hmr') || url.pathname.includes('hot-update')) return;

  // API requests - NETWORK-ONLY (no cache) to always get fresh data
  if (url.pathname.startsWith('/api/')) {
    // In dev mode, never intercept API calls (return undefined to let browser handle it)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return;
    }
    // Production: try network first, fall back to cache only if offline
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // Static assets - cache-first (then update in background)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Revalidate in background
        fetch(req).then((res) => {
          if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
            caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((res) => {
        if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

// Handle messages from page
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
