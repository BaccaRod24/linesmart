// Browser test for the game preview pages: state-aware books/offers (reusing assets/geo.js) and the app's Preview links.
// Builds previews from the committed site/data snapshot (or DATA_DIR) into a temp copy of site/, serves it locally and
// drives Chromium. Offline apart from the local server; geo-IP lookup is never called (state is picked via localStorage).
// Usage: node scripts/previews_test.mjs            (needs playwright; DATA_DIR=/path/to/data to test with fresher data)
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { execFileSync } from "child_process";

let fail = 0, pass = 0;
const check = (ok, msg) => { ok ? pass++ : (fail++, console.log(`FAIL ${msg}`)); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pvjs-"));
const site = path.join(tmp, "site");
fs.cpSync("site", site, { recursive: true, filter: s => !/[\\/]site[\\/](preview|\.preview\.(tmp|old))([\\/]|$)/.test(s) });
if (process.env.DATA_DIR) { fs.rmSync(path.join(site, "data"), { recursive: true, force: true }); fs.cpSync(process.env.DATA_DIR, path.join(site, "data"), { recursive: true }); }
// The committed snapshot may only carry DraftKings (no Odds API key in local builds): give the first priced game of each
// league Hard Rock Bet and FanDuel lines in the temp copy, so the three-book state logic is exercised.
for (const lg of ["nfl", "nba"]) {
  const f = path.join(site, "data", lg, "index.json"); if (!fs.existsSync(f)) continue;
  const ix = JSON.parse(fs.readFileSync(f)); const g = ix.games.find(x => x.state === "pre" && x.books && x.books.draftkings);
  if (!g) continue;
  const dk = g.books.draftkings, bump = (v, d) => (typeof v === "number" ? v + d : v);
  g.books.hardrockbet ||= { ...dk, homeML: bump(dk.homeML, -10), awayML: bump(dk.awayML, 12) };
  g.books.fanduel ||= { ...dk, homeML: bump(dk.homeML, 6), awayML: bump(dk.awayML, -6) };
  fs.writeFileSync(f, JSON.stringify(ix));
}
const meta = JSON.parse(fs.readFileSync(path.join(site, "data/meta.json")));
const now = new Date(Date.parse(meta.generated) || Date.now()).toISOString();
const env = { ...process.env }; delete env.ODDS_API_KEY;
console.log(execFileSync("python3", ["scripts/previews.py", "--site", site, "--now", now], { env }).toString().trim());
const man = JSON.parse(fs.readFileSync(path.join(site, "data/previews.json")));
// pick a page whose table has all three books, preferring NFL
let pick = null;
for (const lg of ["nfl", "nba", "nhl", "ncaaf", "mlb"]) for (const [id, p] of Object.entries(man.leagues[lg] || {})) {
  if (pick) break;
  const h = fs.readFileSync(path.join(site, p, "index.html"), "utf8");
  if (/th data-book="draftkings"/.test(h) && /th data-book="hardrockbet"/.test(h) && /th data-book="fanduel"/.test(h)) pick = { lg, id, p };
}
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
  check(pick, "found a preview page with DraftKings, Hard Rock Bet and FanDuel columns");
  if (pick) {
    const ctx = await browser.newContext();
    await ctx.route(/ipdata\.info|cloudflareinsights|espncdn|googleapis|gstatic/, r => r.abort());
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", e => errs.push(e.message));
    const geoCalls = []; page.on("request", r => { if (/ipdata\.info/.test(r.url())) geoCalls.push(r.url()); });
    const view = async st => {
      await page.goto(BASE);   // same origin, set the manual state pick then open the preview
      await page.evaluate(s => { localStorage.clear(); if (s) localStorage.setItem("ls-state", s); }, st);
      await page.goto(BASE + pick.p);
      await page.waitForFunction(() => window.LSGeo && document.getElementById("pvOffers"));
      await page.waitForTimeout(400);
      return page.evaluate(() => {
        const col = k => [...document.querySelectorAll(`table.pv-books [data-book="${k}"]`)];
        return {
          dim: Object.fromEntries(["draftkings", "hardrockbet", "fanduel"].map(k => [k, col(k).length > 0 && col(k).every(e => e.classList.contains("na-col"))])),
          best: [...document.querySelectorAll("table.pv-books td.best")].map(td => td.dataset.book),
          offers: document.getElementById("pvOffers").innerText, note: (document.querySelector(".pv-na") || {}).textContent || "",
        };
      });
    };
    const fl = await view("FL");
    check(!fl.dim.hardrockbet && fl.dim.draftkings && fl.dim.fanduel, `FL: only Hard Rock Bet legal (${JSON.stringify(fl.dim)})`);
    check(fl.best.every(b => b === "hardrockbet"), `FL: no best-price highlight on non-legal books (${fl.best})`);
    check(!/DraftKings|FanDuel|BetMGM|Caesars|Fanatics/i.test(fl.offers), `FL: offers show Hard Rock Bet only (${fl.offers.slice(0, 120)})`);
    check(/Florida/.test(fl.note), "FL: note explains dimmed books");
    const nv = await view("NV");
    check(!/BetMGM/i.test(nv.offers), `NV: no BetMGM offer (${nv.offers.slice(0, 120)})`);
    const nj = await view("NJ");
    check(!nj.dim.draftkings && !nj.dim.fanduel, "NJ: DraftKings and FanDuel legal");
    check(nj.best.length > 0, "NJ: best prices highlighted");
    const un = await view(null);
    check(Object.values(un.dim).every(v => !v), "unknown state: nothing dimmed");
    check(!errs.length, `no page errors ${errs.join(" | ")}`);
    check(!geoCalls.length, "no geo-IP lookup when a state is picked");

    // app integration: Preview pill on the league tile and on the game page
    const app = await ctx.newPage(); const aerr = []; app.on("pageerror", e => aerr.push(e.message));
    await app.goto(BASE + `#/l/${pick.lg}`);
    await app.waitForSelector(`a.pv-tile[href="${pick.p}"]`, { timeout: 15000 }).catch(() => {});
    check(await app.locator(`a.pv-tile[href="${pick.p}"]`).count() === 1, "league page tile links its preview");
    await app.goto(BASE + `#/g/${pick.lg}/${pick.id}`);
    await app.waitForSelector("a.pv-back", { timeout: 15000 }).catch(() => {});
    check(await app.locator(`a.pv-back[href="${pick.p}"]`).count() === 1, "game page links its preview");
    check(!aerr.length, `app: no page errors ${aerr.join(" | ")}`);
    // a removed preview URL falls back to the league page
    await app.goto(BASE + `preview/${pick.lg}/no-such-game-2020-01-01/`);
    await app.waitForURL(u => u.hash === `#/l/${pick.lg}`, { timeout: 10000 }).catch(() => {});
    check(new URL(app.url()).hash === `#/l/${pick.lg}`, `404 sends stale preview URLs to the league page (${app.url()})`);
  }
} finally {
  await browser.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`${fail ? "FAIL" : "PASS"} previews (browser): ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
