// OphirPay Service Worker
// Caching strategies for PWA offline support

const CACHE_VERSION = "ophirpay-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const API_CACHE = `${CACHE_VERSION}-api`;

// Static assets to precache on install
const PRECACHE_URLS = ["/", "/manifest.json", "/offline.html"];

// ── Install — precache static assets ────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate — clean old caches ─────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch — strategy-based routing ──────────────────────────

function isStaticAsset(request) {
  const url = new URL(request.url);
  return (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/) ||
    url.pathname.startsWith("/_next/static")
  );
}

function isApiRequest(request) {
  const url = new URL(request.url);
  return url.pathname.startsWith("/api/");
}

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // ── API: Network first, fallback to cache ────────────────
  if (isApiRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(API_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // ── Static assets: Cache first ───────────────────────────
  if (isStaticAsset(request)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          return response;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // ── Navigation: Network first, offline fallback ──────────
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || (await caches.match("/offline.html"));
        })
    );
    return;
  }

  // ── Default: Network first ───────────────────────────────
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ── Push notifications (placeholder) ────────────────────────

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title || "OphirPay";
  const options = {
    body: data.body || "New payment event",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: data.url || "/",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data));
});
