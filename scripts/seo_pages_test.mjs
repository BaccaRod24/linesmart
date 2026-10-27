// Browser test for the crawlable SEO pages (scripts/seo_pages.py) and how the app uses them: #/ routes are replaced by
// their real URL, tiles link real URLs, state-aware books/offers on game pages (JS only, nothing hard-coded),
// old /preview/ URLs redirect, and the 404 page handles expired pages. (Successor of previews_test.mjs.)
// Builds from the committed site/data snapshot (or DATA_DIR) into a temp copy of site/, serves it locally and drives
// Chromium. Offline apart from the local server; geo-IP lookup is never called (state is picked via localStorage).
// Usage: node scripts/seo_pages_test.mjs            (needs playwright; DATA_DIR=/path/to/data to test with fresher data)
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { execFileSync } from "child_process";

let fail = 0, pass = 0;
const check = (ok, msg) => { ok ? pass++ : (fail++, console.log(`FAIL ${msg}`)); };
const GEN = ["nfl", "nba", "mlb", "nhl", "ncaaf", "ncaab", "ufc", "preview"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seojs-"));
const site = path.join(tmp, "site");
fs.cpSync("site", site, { recursive: true, filter: s => { const r = path.relative("site", s).split(path.sep); return !(r.length && (GEN.includes(r[0]) || /^\.(seo\.tmp|.*\.old)$/.test(r[0]))); } });
if (process.env.DATA_DIR) { fs.rmSync(path.join(site, "data"), { recursive: true, force: true }); fs.cpSync(process.env.DATA_DIR, path.join(site, "data"), { recursive: true }); }
// The committed snapshot may only carry DraftKings (no Odds API key in local builds): give the first priced game of each
// league Hard Rock Bet and FanDuel lines in the temp copy, so the three-book state logic is exercised.
const picked = {};
for (const lg of ["nfl", "nba", "nhl"]) {
  const f = path.join(site, "data", lg, "index.json"); if (!fs.existsSync(f)) continue;
  const ix = JSON.parse(fs.readFileSync(f)); const g = ix.games.find(x => x.state === "pre" && x.books && x.books.draftkings);
  if (!g) continue;
  const dk = g.books.draftkings, bump = (v, d) => (typeof v === "number" ? v + d : v);
  g.books.hardrockbet ||= { ...dk, homeML: bump(dk.homeML, -10), awayML: bump(dk.awayML, 12) };
  g.books.fanduel ||= { ...dk, homeML: bump(dk.homeML, 6), awayML: bump(dk.awayML, -6) };
  picked[lg] = g.id;
  // and the latest finished game a DraftKings line (closing lines on its past-game page)
  const fin = ix.games.filter(x => x.state === "post").pop();
  if (fin && !(fin.books && Object.keys(fin.books).length)) fin.books = { draftkings: { ...dk } };
  fs.writeFileSync(f, JSON.stringify(ix));
}
const meta = JSON.parse(fs.readFileSync(path.join(site, "data/meta.json")));
const now = new Date(Date.parse(meta.generated) || Date.now()).toISOString();
const env = { ...process.env }; delete env.ODDS_API_KEY;
console.log(execFileSync("python3", ["scripts/seo_pages.py", "--site", site, "--now", now], { env }).toString().trim());
const man = JSON.parse(fs.readFileSync(path.join(site, "data/pages.json")));
const lg = Object.keys(picked).find(k => man.g[k] && man.g[k][picked[k]]);
const gid = lg && picked[lg], gpath = lg && man.g[lg][gid];
const read = p => fs.readFileSync(path.join(site, p, "index.html"), "utf8");
const past = (() => { for (const [l, gs] of Object.entries(man.g)) for (const [id, p] of Object.entries(gs)) { const h = read(p); if (/Final Score/.test(h) && /th data-book="draftkings"/.test(h)) return { lg: l, id, p }; } return null; })();
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".xml": "application/xml", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((req, res) => {
  let f = path.join(site, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404, { "content-type": "text/html" }); return res.end(fs.readFileSync(path.join(site, "404.html"))); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
}).listen(0);
const BASE = `http://localhost:${srv.address().port}/`;
const browser = await chromium.launch();
try {
  check(gpath, "found an upcoming game page with DraftKings, Hard Rock Bet and FanDuel lines");
  if (process.env.DATA_DIR && !past) console.log("note: no finished game with lines in DATA_DIR; past-game checks skipped");
  else check(past, "found a past-game page with closing lines");
  // ---- static HTML (no JS, i.e. what a crawler without JS sees): content but no offers
  {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(BASE + gpath);
    const s = await page.evaluate(() => ({ h1: (document.querySelector("h1") || {}).textContent || "", offers: document.querySelectorAll("section.offers, .of-book").length,
      books: document.querySelectorAll("table.pv-books th[data-book]").length, gambler: /1-800-GAMBLER/.test(document.body.innerText) }));
    check(/odds/i.test(s.h1) && s.books >= 3, `static game page has its odds table (${s.h1}, ${s.books} books)`);
    check(s.offers === 0, "static game page: no hard-coded offers");
    check(s.gambler, "static game page: 1-800-GAMBLER");
    await ctx.close();
  }
  const ctx = await browser.newContext();
  await ctx.route(/ipdata\.info|cloudflareinsights|espncdn|googleapis|gstatic/, r => r.abort());
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  const geoCalls = [], cf = []; page.on("request", r => { if (/ipdata\.info/.test(r.url())) geoCalls.push(r.url()); if (/cloudflareinsights/.test(r.url())) cf.push(r.url()); });
  const setState = async st => { await page.goto(BASE + "about.html"); await page.evaluate(s => { localStorage.clear(); localStorage.setItem("ls-age-ok", "1"); if (s) localStorage.setItem("ls-state", s); }, st); };
  // ---- upcoming game page hydrates into the app view, state-aware offers come from JS
  if (gpath) {
    const view = async st => {
      await setState(st);
      await page.goto(BASE + gpath);
      await page.waitForSelector("#app .books, #app section.offers, #app .offers", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
      return page.evaluate(() => ({ offers: [...document.querySelectorAll("section.offers")].map(e => e.innerText).join(" | "), path: location.pathname, hash: location.hash,
        title: document.title, canon: (document.querySelector('link[rel="canonical"]') || {}).href }));
    };
    const fl = await view("FL");
    check(fl.path === "/" + gpath && fl.hash === "", `game page stays on its real URL (${fl.path}${fl.hash})`);
    check(/Hard Rock/.test(fl.offers) && !/DraftKings|FanDuel|BetMGM|Caesars|Fanatics/i.test(fl.offers), `FL: offers show Hard Rock Bet only (${fl.offers.slice(0, 140)})`);
    const nv = await view("NV");
    check(!/BetMGM/i.test(nv.offers), `NV: no BetMGM offer (${nv.offers.slice(0, 120)})`);
    const nj = await view("NJ");
    check(/DraftKings|FanDuel/.test(nj.offers), `NJ: DraftKings/FanDuel offers (${nj.offers.slice(0, 120)})`);
    check(nj.canon === BASE.replace(/\/$/, "").replace(/^http:\/\/localhost:\d+/, "https://linesmart.app") + "/" + gpath || /linesmart\.app/.test(nj.canon), `canonical stays the real URL (${nj.canon})`);
    // #/ route with a real URL -> location replaced by that URL
    await page.goto(BASE + `#/g/${lg}/${gid}`);
    await page.waitForURL(u => u.pathname === "/" + gpath, { timeout: 10000 }).catch(() => {});
    check(new URL(page.url()).pathname === "/" + gpath && !new URL(page.url()).hash, `#/g/${lg}/${gid} is replaced by its real URL (${page.url()})`);
    await page.goto(BASE + `#/l/${lg}`);
    await page.waitForURL(u => u.pathname === `/${lg}/`, { timeout: 10000 }).catch(() => {});
    check(new URL(page.url()).pathname === `/${lg}/`, `#/l/${lg} is replaced by the hub URL (${page.url()})`);
    // tiles on the (hydrated) hub link the real game URLs
    await page.waitForSelector("#app a.game", { timeout: 15000 }).catch(() => {});
    const tiles = await page.evaluate(() => [...document.querySelectorAll("#app a.game")].map(a => [a.getAttribute("href"), a.dataset.h || a.getAttribute("href")]));
    const wrong = tiles.filter(([h, orig]) => { const id = orig.split("/").pop(); return man.g[lg][id] ? h !== man.g[lg][id] : h !== orig; });
    check(tiles.length && !wrong.length, `hub tiles link the real URL when a page exists, else stay in the app (${JSON.stringify(wrong.slice(0, 3))})`);
    check(tiles.some(([h]) => !h.startsWith("#/")), "some hub tiles link real URLs");
    tiles.splice(0, tiles.length, ...tiles.map(([h]) => h));
    check(tiles.includes(gpath), `hub tile links ${gpath}`);
    // tapping a tile goes to the game's page
    await page.click(`#app a.game[href="${gpath}"]`);
    await page.waitForURL(u => u.pathname === "/" + gpath, { timeout: 10000 }).catch(() => {});
    check(new URL(page.url()).pathname === "/" + gpath, "tapping a game opens its real URL");
    // app-only sub-routes stay in the app
    await page.goto(BASE + `#/l/${lg}/all`);
    await page.waitForTimeout(800);
    check(new URL(page.url()).hash === `#/l/${lg}/all`, `sub-routes stay hash routes (${page.url()})`);
    // player pages: #/p/ -> real URL
    const pl = man.p[lg] && Object.entries(man.p[lg])[0];
    if (pl && lg !== "ufc") {
      await page.goto(BASE + `#/p/${lg}/${pl[0]}`);
      await page.waitForURL(u => u.pathname === "/" + pl[1], { timeout: 10000 }).catch(() => {});
      check(new URL(page.url()).pathname === "/" + pl[1], `#/p/${lg}/${pl[0]} is replaced by the player page (${page.url()})`);
    }
  }
  // ---- past game: static closing lines, state-aware dimming by preview.js
  if (past) {
    const dims = async st => {
      await setState(st); await page.goto(BASE + past.p); await page.waitForFunction(() => window.LSGeo); await page.waitForTimeout(400);
      return page.evaluate(() => ({ dk: [...document.querySelectorAll('table.pv-books [data-book="draftkings"]')].every(e => e.classList.contains("na-col")),
        route: document.body.dataset.route || "", h1: document.querySelector("h1").textContent, more: document.querySelectorAll(".seo-more a").length }));
    };
    const fl = await dims("FL"), nj = await dims("NJ");
    check(fl.dk && !nj.dk, `past game: DraftKings closing line dimmed in FL only (FL ${fl.dk}, NJ ${nj.dk})`);
    check(!fl.route && /final score/i.test(fl.h1), `past game stays static (${fl.h1})`);
    check(fl.more > 2, "past game: related links stay visible");
  }
  // ---- old /preview/ URLs and the 404 page
  const pv = fs.existsSync(path.join(site, "preview", lg || "nfl")) && fs.readdirSync(path.join(site, "preview", lg || "nfl")).find(d => d !== "index.html");
  if (pv) {
    await page.goto(BASE + `preview/${lg}/${pv}/`);
    await page.waitForURL(u => !u.pathname.startsWith("/preview/"), { timeout: 10000 }).catch(() => {});
    check(!new URL(page.url()).pathname.startsWith("/preview/") && new URL(page.url()).pathname.startsWith(`/${lg}/`), `old preview URL redirects (${page.url()})`);
  }
  await page.goto(BASE + "preview/");
  await page.waitForURL(u => u.pathname === "/", { timeout: 10000 }).catch(() => {});
  check(new URL(page.url()).pathname === "/", `preview/ redirects home (${page.url()})`);
  await page.goto(BASE + "preview/nfl/no-such-game-2020-01-01/");
  await page.waitForURL(u => u.pathname === "/nfl/", { timeout: 10000 }).catch(() => {});
  check(new URL(page.url()).pathname === "/nfl/", `404: unknown preview URL goes to the hub (${page.url()})`);
  await page.goto(BASE + "nfl/games/no-such-game-2020-01-01/");
  const nf = await page.evaluate(() => ({ t: document.body.innerText, hub: [...document.querySelectorAll("a")].some(a => /\/nfl\/$/.test(a.href)) }));
  check(/expired/i.test(nf.t) && nf.hub, "404: expired game page explains and links the hub");
  check(/1-800-GAMBLER/.test(nf.t), "404: 1-800-GAMBLER");
  // ---- homepage cards
  await setState("NJ"); await page.goto(BASE);
  const hc = await page.evaluate(() => [...document.querySelectorAll(".home-cards a")].map(a => a.getAttribute("href")));
  check(hc.length > 0 && hc.every(h => !h.startsWith("#/")), `homepage cards link real pages (${hc.length})`);
  check(!errs.length, `no page errors ${errs.join(" | ")}`);
  check(!geoCalls.length, "no geo-IP lookup when a state is picked");
  check(!cf.length, "no Cloudflare analytics off the production host");
  // ---- 21+ notice shows on a fresh visit to a generated page
  const c2 = await browser.newContext(); const p2 = await c2.newPage();
  await c2.route(/ipdata\.info|cloudflareinsights|espncdn/, r => r.abort());
  await p2.goto(BASE + (past ? past.p : gpath));
  await p2.waitForSelector(".age-sheet", { timeout: 5000 }).catch(() => {});
  check(await p2.locator(".age-sheet").count() === 1, "21+ notice on first visit to a generated page");
  await c2.close();
} finally {
  await browser.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`${fail ? "FAIL" : "PASS"} seo pages (browser): ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
