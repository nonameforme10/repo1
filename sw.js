"use strict";

const IS_SERVICE_WORKER_CONTEXT =
  typeof ServiceWorkerGlobalScope !== "undefined" &&
  self instanceof ServiceWorkerGlobalScope;

if (IS_SERVICE_WORKER_CONTEXT) {
  const VERSION = "v11.0";
  const CORE_CACHE = `eduventure-core-${VERSION}`;
  const RUNTIME_CACHE = `eduventure-runtime-${VERSION}`;
  const MAX_RUNTIME_ENTRIES = 120;
  const MAX_CACHED_RESPONSE_BYTES = 1_500_000;

  const SCOPE = self.registration ? self.registration.scope : self.location.origin + "/";
  const abs = (path) => new URL(path, SCOPE).toString();

  const OFFLINE_FALLBACK = abs("index.html");
  const CORE_ASSETS = [
    abs("./"),
    abs("index.html"),
    abs("manifest.webmanifest"),
    abs("style.css"),
    abs("script.js"),
    abs("favicon.png"),
    abs("assets/pwa-icon-180.png"),
    abs("assets/pwa-icon-192.png"),
    abs("assets/pwa-icon-512.png"),
    abs("assets/logo.png"),
    abs("assets/UI.js"),
    abs("elements/UI.js"),
    abs("pages/home/home%20page.html"),
    abs("pages/home/script.js"),
    abs("pages/home/pwa-install.js"),
    abs("pages/elements/style.css"),
    abs("pages/elements/script.js"),
    abs("ping.txt"),
  ];

  const STATIC_DESTINATIONS = new Set(["script", "style", "image", "font"]);
  const STATIC_EXT_RE =
    /\.(?:css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|json|webmanifest|txt)$/i;
  const AUTH_NETWORK_ONLY_PREFIXES = ["/pages/auth/", "/auth/", "/__/auth/"];
  const AUTH_NETWORK_ONLY_PATHS = new Set([
    "/elements/firebase.js",
    "/sw.js",
    "/pages/home/sw.js",
  ]);

  function isAuthCriticalPath(url) {
    const pathname = url.pathname || "/";
    if (AUTH_NETWORK_ONLY_PATHS.has(pathname)) return true;
    return AUTH_NETWORK_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  }

  function isNetworkOnlyRequest(request, url) {
    return (
      isAuthCriticalPath(url) ||
      request.cache === "no-store" ||
      url.searchParams.has("sw-network-only") ||
      request.headers.get("x-sw-network-only") === "1"
    );
  }

  function isCacheableResponse(request, response, url) {
    if (!response || response.status !== 200) return false;
    if (url.origin !== self.location.origin) return false;
    if (request.destination === "audio" || request.destination === "video") return false;

    const cacheControl = (response.headers.get("cache-control") || "").toLowerCase();
    if (cacheControl.includes("no-store") || cacheControl.includes("private")) return false;

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_CACHED_RESPONSE_BYTES) return false;

    if (request.mode !== "navigate" && url.search) return false;

    return true;
  }

  async function trimRuntimeCache() {
    const cache = await caches.open(RUNTIME_CACHE);
    const keys = await cache.keys();
    if (keys.length <= MAX_RUNTIME_ENTRIES) return;

    const removals = keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES).map((key) => cache.delete(key));
    await Promise.all(removals);
  }

  async function putRuntime(request, response) {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response);
    await trimRuntimeCache();
  }

  async function addAllSafe(cache, urls) {
    for (const url of urls) {
      try {
        const response = await fetch(new Request(url, { cache: "reload" }));
        if (response && response.ok) {
          await cache.put(url, response.clone());
        }
      } catch {}
    }
  }

  self.addEventListener("install", (event) => {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CORE_CACHE);
        await addAllSafe(cache, CORE_ASSETS);
      })()
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        if (self.registration.navigationPreload) {
          try {
            await self.registration.navigationPreload.enable();
          } catch {}
        }

        const names = await caches.keys();
        await Promise.all(
          names.map((name) => {
            if (
              (
                name.startsWith("eduventure-core-") ||
                name.startsWith("eduventure-runtime-") ||
                name.startsWith("eduventure-cache-")
              ) &&
              name !== CORE_CACHE &&
              name !== RUNTIME_CACHE
            ) {
              return caches.delete(name);
            }
            return null;
          })
        );

        await self.clients.claim();
      })()
    );
  });

  async function handleNavigation(event) {
    const request = event.request;

    try {
      const preload = await event.preloadResponse;
      if (preload) {
        const preloadUrl = new URL(request.url);
        if (isCacheableResponse(request, preload, preloadUrl)) {
          event.waitUntil(putRuntime(request, preload.clone()));
        }
        return preload;
      }

      const network = await fetch(request);
      const networkUrl = new URL(request.url);
      if (isCacheableResponse(request, network, networkUrl)) {
        event.waitUntil(putRuntime(request, network.clone()));
      }
      return network;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;

      const fallback = await caches.match(OFFLINE_FALLBACK);
      if (fallback) return fallback;

      return new Response("Offline", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  }

  async function handleStatic(event) {
    const request = event.request;
    const cached = await caches.match(request);

    const networkPromise = fetch(request)
      .then(async (response) => {
        const url = new URL(request.url);
        if (isCacheableResponse(request, response, url)) {
          event.waitUntil(putRuntime(request, response.clone()));
        }
        return response;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(networkPromise);
      return cached;
    }

    const network = await networkPromise;
    if (network) return network;

    return new Response("Offline", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  async function handleManifest(event) {
    const request = event.request;

    try {
      const network = await fetch(request);
      const url = new URL(request.url);
      if (isCacheableResponse(request, network, url)) {
        event.waitUntil(putRuntime(request, network.clone()));
      }
      return network;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;

      return new Response("Offline", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  }

  self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    if (url.origin !== self.location.origin) return;

    if (url.pathname.endsWith("/ping.txt")) {
      event.respondWith(
        fetch(new Request(request, { cache: "no-store" })).catch(
          () => new Response("", { status: 503 })
        )
      );
      return;
    }

    if (isNetworkOnlyRequest(request, url)) {
      event.respondWith(fetch(request).catch(() => new Response("", { status: 503 })));
      return;
    }

    if (request.mode === "navigate") {
      event.respondWith(handleNavigation(event));
      return;
    }

    if (request.destination === "manifest" || /\.webmanifest$/i.test(url.pathname)) {
      event.respondWith(handleManifest(event));
      return;
    }

    if (STATIC_DESTINATIONS.has(request.destination) || STATIC_EXT_RE.test(url.pathname)) {
      event.respondWith(handleStatic(event));
      return;
    }
  });

  self.addEventListener("message", (event) => {
    const data = event.data;
    if (data && (data.action === "skipWaiting" || data.type === "SKIP_WAITING")) {
      self.skipWaiting();
      return;
    }
    if (data === "SKIP_WAITING") {
      self.skipWaiting();
    }
  });
}
