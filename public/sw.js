const CACHE_NAME = "motocast-shell-v3";
const SHELL = ["/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const sensitivePath = ["/share", "/api/", "/auth/", "/invite/", "/admin/", "/login"]
    .some((prefix) => url.pathname.startsWith(prefix));
  if (event.request.method !== "GET" || url.origin !== self.location.origin || sensitivePath) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const cacheControl = response.headers.get("cache-control") ?? "";
        if (response.ok && !/(?:no-store|private)/i.test(cacheControl)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? new Response(
        "오프라인 상태입니다. 네트워크 연결 후 다시 시도해 주세요.",
        { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } },
      ))),
  );
});
