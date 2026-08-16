/* Pipeline Push service worker — offline boot support.
   Put this file in the repo root, next to the app's HTML file.

   Strategy:
   - The app page itself: network-first (deploys still land immediately when
     online), falling back to the cached copy when there's no service.
   - CDN scripts (React, Babel, Supabase): cache-first with a background
     refresh — they must be available offline or the app can't boot at all.
   - Everything else (Supabase data, Google APIs, Overpass): straight to the
     network, untouched. Freshness is handled by the app's own offline queues. */

const SHELL_CACHE = "pp-shell-v1";
const CDN_CACHE = "pp-cdn-v1";
const CDN_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keep = [SHELL_CACHE, CDN_CACHE];
    for (const k of await caches.keys()) {
      if (!keep.includes(k)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // App page (any navigation): network-first, cache fallback.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put("app-shell", fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await cache.match("app-shell");
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  // Core CDN scripts: cache-first, refresh in the background.
  let host = "";
  try { host = new URL(req.url).hostname; } catch (err) { return; }
  if (CDN_HOSTS.includes(host)) {
    e.respondWith((async () => {
      const cache = await caches.open(CDN_CACHE);
      const cached = await cache.match(req);
      const refresh = fetch(req).then((res) => {
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await refresh) || Response.error();
    })());
  }
  // Everything else: default network handling.
});
