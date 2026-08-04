/* Majesty Web Design — Service Worker v4
   Strategy:
   - HTML pages  → network-first (always fresh, no caching headaches)
   - JS/CSS/fonts → cache-first  (versioned URLs, safe to cache forever)
   - Images       → cache-first  (long-lived, rarely change)
*/
const CACHE = 'mwd-v5';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  // Only handle GET, same-origin
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  const isHTML = req.headers.get('Accept') && req.headers.get('Accept').includes('text/html');
  const isAsset = /\.(js|css|woff2?|ttf|otf)(\?.*)?$/.test(url.pathname);
  const isImage = /\.(webp|png|jpg|jpeg|gif|svg|ico)(\?.*)?$/.test(url.pathname);

  if (isHTML) {
    // HTML: network-first — always get fresh page, fall back to cache if offline
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => caches.match(req))
    );
  } else if (isAsset || isImage) {
    // Assets/images: cache-first — fast repeat visits
    e.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(req, clone));
          }
          return res;
        });
      })
    );
  }
  // Everything else (analytics, APIs, etc.) — let it pass through
});
