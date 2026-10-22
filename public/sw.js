// Service Worker - MyWallet PWA v3
// - NO HTML caching (always network-first)
// - Static assets only (CSS, JS, icons)
// - API requests never cached in dev

const CACHE_NAME = 'mywallet-v3';
const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => Promise.resolve()))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      // Delete ALL old caches (including v2 and any other version)
      return Promise.all(
        cacheNames.filter(c => c !== CACHE_NAME).map(c => {
          console.log('SW: Deleting old cache:', c);
          return caches.delete(c);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // Skip Next.js HMR and dev requests
  if (url.pathname.startsWith('/_next/webpack-hmr') || url.pathname.includes('hot-update')) return;

  // API requests - NEVER cache, always network
  if (url.pathname.startsWith('/api/')) {
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return; // dev mode - let browser handle
    }
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // HTML pages (root /, etc.) - NETWORK FIRST
  // Never serve HTML from cache, always get latest from server
  const isHTML = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html') ||
                 url.pathname === '/' ||
                 url.pathname.endsWith('.html');

  if (isHTML) {
    event.respondWith(
      fetch(req).then((res) => {
        // Don't cache HTML responses, but return them
        return res;
      }).catch(() => {
        // Only fall back to cache if network fails
        return caches.match(req).then(cached => cached || new Response(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline</title></head><body style="font-family:sans-serif;text-align:center;padding:50px"><h1>أنت غير متصل</h1><p>تأكد من اتصالك بالإنترنت</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        ));
      })
    );
    return;
  }

  // Static assets (JS, CSS, images) - cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Revalidate in background
        fetch(req).then((res) => {
          if (res && res.ok) {
            caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
