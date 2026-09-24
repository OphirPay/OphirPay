// OphirPay Service Worker
// Caching strategies for PWA offline support with precached offline shell

const CACHE_VERSION = "ophirpay-v3";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const API_CACHE = `${CACHE_VERSION}-api`;

// Offline fallback document
const OFFLINE_FALLBACK_URL = "/offline.html";

// Static assets to precache on install
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  OFFLINE_FALLBACK_URL,
  "/icon.svg",
];

// ── Install — precache static assets and offline fallback ──

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate — clean old caches on version bump ─────────────

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
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          // 1. Exact cached navigation match
          const cached = await caches.match(request);
          if (cached) return cached;

          // 2. Precached offline fallback document
          const offlineFallback = await caches.match(OFFLINE_FALLBACK_URL);
          if (offlineFallback) return offlineFallback;

          // 3. Cached root app shell
          const rootCached = await caches.match("/");
          if (rootCached) return rootCached;

          // 4. Standalone markup fallback
          return new Response(
            `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OphirPay — Offline</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0a0a1a; color: #e2e8f0;
      display: flex; flex-direction: column; min-height: 100vh;
    }
    .banner {
      background: #f59e0b; color: #fff; text-align: center;
      padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500;
    }
    .main {
      flex: 1; display: flex; align-items: center; justify-content: center;
      text-align: center; padding: 2rem;
    }
    .card {
      background: #1e1e3a; border-radius: 1rem; padding: 2.5rem;
      max-width: 420px; border: 1px solid #2d2d5e;
    }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #7B68EE; }
    p { font-size: 0.875rem; color: #94a3b8; margin-bottom: 1.5rem; line-height: 1.5; }
    button {
      background: #7B68EE; color: white; border: none; padding: 0.75rem 1.5rem;
      border-radius: 0.5rem; font-size: 0.875rem; cursor: pointer; font-weight: 600;
    }
    button:hover { background: #6a57de; }
  </style>
</head>
<body>
  <div class="banner" role="status" aria-live="polite">You are offline — some features may be unavailable.</div>
  <div class="main">
    <div class="card">
      <h1>You're Offline</h1>
      <p>OphirPay requires an internet connection to process payments and sync blockchain data.</p>
      <button onclick="location.reload()">Retry Connection</button>
    </div>
  </div>
</body>
</html>`,
            {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }
          );
        })
    );
    return;
  }

  // ── Default: Network first ───────────────────────────────
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ── Client messages & service worker control ────────────────

self.addEventListener("message", (event) => {
  if (event.data?.type === "GET_VERSION") {
    event.ports?.[0]?.postMessage({
      version: CACHE_VERSION,
      staticCache: STATIC_CACHE,
      dynamicCache: DYNAMIC_CACHE,
      apiCache: API_CACHE,
      precacheUrls: PRECACHE_URLS,
      offlineFallbackUrl: OFFLINE_FALLBACK_URL,
    });
  }
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ── Push notifications ──────────────────────────────────────

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
