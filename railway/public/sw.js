/* Minimal service worker: keeps the panel installable and caches the shell. */
const SHELL = ["/KalFetela", "/app.js", "/style.css", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("kalfetela-v2").then((cache) => cache.addAll(SHELL).catch(() => undefined)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/sub/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && SHELL.includes(url.pathname)) {
          const clone = response.clone();
          caches.open("kalfetela-v2").then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || new Response("offline", { status: 503 })))
  );
});
