/* LineSmart service worker.
 * App shell (HTML/CSS/JS/icons): cache-first from a versioned cache; navigations are network-first so a
 * fresh deploy's HTML is picked up immediately. Data JSON (data/**): network-first, cached copy only when
 * the network fails, flagged with an `X-LineSmart-Offline` header so the page can show a note.
 * VERSION is stamped at deploy time by the workflow (content hash of the shell + build time), so every
 * deploy installs a new worker and drops the old shell cache. Paths are relative to the SW scope (/linesmart/). */
const VERSION = "dev";
const SHELL = `linesmart-shell-${VERSION}`;
const DATA = "linesmart-data-v1";
const DATA_MAX = 400; // cap stored data responses (game pages add up)
const SHELL_FILES = [
  "./", "index.html", "manifest.webmanifest", "favicon.ico",
  "assets/styles.css", "assets/config.js", "assets/app.js",
  "assets/brand/logo.svg", "assets/brand/icon.svg", "assets/brand/apple-touch-icon.png",
  "assets/brand/favicon-32.png", "assets/brand/favicon-16.png",
  "assets/brand/icon-192.png", "assets/brand/icon-512.png", "assets/brand/icon-maskable-512.png",
];
const scopeURL = new URL(self.registration.scope);
const rel = u => u.pathname.slice(scopeURL.pathname.length);

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("linesmart-shell-") && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirstData(req) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) {
      cache.put(req, res.clone()).then(async () => {
        const keys = await cache.keys();
        for (let i = 0; i < keys.length - DATA_MAX; i++) await cache.delete(keys[i]);
      });
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (!hit) throw err;
    const h = new Headers(hit.headers); h.set("X-LineSmart-Offline", "1");
    return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers: h });
  }
}
async function networkFirstPage(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(SHELL)).put("index.html", res.clone());
    return res;
  } catch (err) {
    return (await caches.match("index.html", { cacheName: SHELL })) || Response.error();
  }
}
async function cacheFirst(req) {
  const hit = await caches.match(req, { cacheName: SHELL, ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
  return res;
}
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== scopeURL.origin || !url.pathname.startsWith(scopeURL.pathname)) return; // ESPN logos etc.: browser default
  const p = rel(url);
  if (p === "sw.js") return;
  if (p.startsWith("data/")) return e.respondWith(networkFirstData(req));
  if (req.mode === "navigate") return e.respondWith(networkFirstPage(req));
  e.respondWith(cacheFirst(req));
});
