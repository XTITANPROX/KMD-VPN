// Static inlined assets: PWA manifest, service worker, SVG icon.

// KALFETELA mark — a hexagonal shield with a stylized lightning/N
// monogram in cyan→violet gradient. Designed as a 512×512 SVG so it
// scales crisply from favicon to PWA icon without raster assets.
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="ng-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1020"/>
      <stop offset="100%" stop-color="#05070f"/>
    </linearGradient>
    <linearGradient id="ng-hex" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="55%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>
    <linearGradient id="ng-mark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#a5f3fc"/>
      <stop offset="100%" stop-color="#67e8f9"/>
    </linearGradient>
    <radialGradient id="ng-glow" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
    <filter id="ng-blur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#ng-bg)"/>
  <circle cx="256" cy="236" r="180" fill="url(#ng-glow)"/>
  <!-- outer hexagon -->
  <path d="M256 56 L428 152 L428 360 L256 456 L84 360 L84 152 Z"
        fill="none" stroke="url(#ng-hex)" stroke-width="6" stroke-linejoin="round" opacity="0.85"/>
  <!-- inner accent hex -->
  <path d="M256 104 L390 180 L390 332 L256 408 L122 332 L122 180 Z"
        fill="url(#ng-hex)" opacity="0.10"/>
  <!-- lightning / N mark -->
  <g filter="url(#ng-blur)" opacity="0.55">
    <path d="M214 150 L306 150 L250 246 L320 246 L210 380 L240 282 L178 282 Z"
          fill="#22d3ee"/>
  </g>
  <path d="M214 150 L306 150 L250 246 L320 246 L210 380 L240 282 L178 282 Z"
        fill="url(#ng-mark)"/>
  <!-- orbit dot -->
  <circle cx="394" cy="170" r="9" fill="#a855f7"/>
  <circle cx="118" cy="342" r="6" fill="#22d3ee"/>
</svg>`;

export const PWA_MANIFEST = JSON.stringify({
  name: "KALFETELA",
  short_name: "KALFETELA",
  description: "پنل اختصاصی پروکسی روی Cloudflare Worker",
  start_url: "/panel",
  scope: "/",
  display: "standalone",
  background_color: "#05070f",
  theme_color: "#05070f",
  dir: "rtl",
  lang: "fa-IR",
  orientation: "any",
  icons: [
    { src: "/icon.svg", sizes: "192x192 512x512", type: "image/svg+xml", purpose: "any maskable" },
  ],
  categories: ["utilities", "productivity"],
});

export const SW_JS = `
const CACHE = "kalfetela-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/sub/")) return;
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      const run = fetch(e.request).then((res) => {
        if (res && res.status === 200) cache.put(e.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || run;
    })
  );
});
`;
