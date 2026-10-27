/* LineSmart service worker.
 * App shell (HTML/CSS/JS/icons): cache-first from a versioned cache; navigations are network-first so a
 * fresh deploy's HTML is picked up immediately. Data JSON (data/**): network-first, cached copy only when
 * the network fails, flagged with an `X-LineSmart-Offline` header so the page can show a note.
 * VERSION is stamped at deploy time by the workflow (content hash of the shell + build time), so every
 * deploy installs a new worker and drops the old shell cache. Paths are relative to the SW scope (/ on linesmart.app, /linesmart/ under a subpath).
 * Team/player pages read ESPN's site.web.api host live; those responses are also network-first, kept in a small
 * separate cache so recently opened team/player pages still work offline.
 * Live score polls (assets/live.js) fetch ESPN scoreboards with cache:"no-store" every ~25 s: those skip the worker
 * entirely (nothing to gain from caching a score that is stale in 25 s, and a cached fallback would hide an outage).
 * Live box-score (summary) polls go network-first like other ESPN reads; live.js treats an X-LineSmart-Offline reply as a failure. */
const VERSION = "dev";
const SHELL = `linesmart-shell-${VERSION}`;
const DATA = "linesmart-data-v1";
const DATA_MAX = 400; // cap stored data responses (game pages add up)
const ESPN = "linesmart-espn-v1";
const ESPN_MAX = 150;
const ESPN_HOST = "site.web.api.espn.com";
const SHELL_FILES = [
  "./", "index.html", "manifest.webmanifest", "favicon.ico",
  "responsible-gambling.html", "privacy.html", "terms.html", "affiliate-disclosure.html", "about.html", "subscribed.html", "unsubscribe.html",
  "assets/styles.css", "assets/theme.js", "assets/config.js", "assets/site.js", "assets/books-by-state.js", "assets/geo-core.js", "assets/geo.js", "assets/app.js", "assets/bets-core.js", "assets/slip-core.js", "assets/bets.js", "assets/matchup-core.js", "assets/matchup.js", "assets/weather-core.js", "assets/weather.js", "assets/props-core.js", "assets/props.js", "assets/ufc.js", "assets/pickem-core.js", "assets/adv-core.js", "assets/adv.js", "assets/value-core.js", "assets/value.js", "assets/news-core.js", "assets/news.js", "assets/live-core.js", "assets/live.js", "assets/livetab-core.js", "assets/alerts-core.js", "assets/alerts.js", "assets/pro-core.js", "assets/pro.js", "assets/fonts/inter-latin-var.woff2",
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

async function networkFirstData(req, name = DATA, max = DATA_MAX) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) {
      cache.put(req, res.clone()).then(async () => {
        const keys = await cache.keys();
        for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
      });
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: name === DATA });
    if (!hit) throw err;
    const h = new Headers(hit.headers); h.set("X-LineSmart-Offline", "1");
    return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers: h });
  }
}
// Navigations: network-first. Each shell page is cached under its own path (the app under index.html), so the
// legal pages work offline too and never overwrite the cached app. Unknown paths fall back to the app.
const PAGE_FILES = SHELL_FILES.filter(f => f.endsWith(".html"));
async function networkFirstPage(req) {
  const p = rel(new URL(req.url)) || "index.html";
  const key = PAGE_FILES.includes(p) ? p : null;
  try {
    const res = await fetch(req);
    if (res.ok && key) (await caches.open(SHELL)).put(key, res.clone());
    return res;
  } catch (err) {
    return (key && (await caches.match(key, { cacheName: SHELL }))) || (await caches.match("index.html", { cacheName: SHELL })) || Response.error();
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
  if (url.hostname === ESPN_HOST && req.cache === "no-store" && url.pathname.endsWith("/scoreboard")) return;   // live poll: straight to network
  if (url.hostname === ESPN_HOST && url.pathname.startsWith("/apis/")) return e.respondWith(networkFirstData(req, ESPN, ESPN_MAX));
  if (url.origin !== scopeURL.origin || !url.pathname.startsWith(scopeURL.pathname)) return; // ESPN logos etc.: browser default
  const p = rel(url);
  if (p === "sw.js") return;
  if (p.startsWith("data/")) return e.respondWith(networkFirstData(req));
  if (req.mode === "navigate") return e.respondWith(networkFirstPage(req));
  e.respondWith(cacheFirst(req));
});
