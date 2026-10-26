// Screenshots of every color theme + labeled comparison sheets.
// Usage: serve the site (e.g. at http://localhost:8811/linesmart/), then
//        BASE=http://localhost:8811/linesmart/ DATA_DIR=/path/to/data node scripts/theme_screenshots.mjs
// Output: screenshots/themes/<theme>-<view>.png and screenshots/themes-compare-{mobile,desktop,team,search,game}.png
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
const BASE = process.env.BASE || "http://localhost:8765/";
const DATA = process.env.DATA_DIR || "site/data";
const OUT = path.resolve("screenshots"), DIR = path.join(OUT, "themes");
fs.mkdirSync(DIR, { recursive: true });
const THEMES = [["linesmart", "LineSmart (current)"], ["sportsbook", "Sportsbook Green"], ["midnight", "Midnight Blue"], ["daylight", "Daylight"], ["vegas", "Vegas Gold"]];
const only = process.env.THEMES ? process.env.THEMES.split(",") : null;
const nfl = JSON.parse(fs.readFileSync(`${DATA}/nfl/index.json`));
// a game with both books (so best-price highlighting shows), else any pre-game game with odds
const hasHR = g => { try { const d = JSON.parse(fs.readFileSync(`${DATA}/nfl/games/${g.id}.json`)); return d.game && d.game.books && d.game.books.hardrockbet && !d.game.books.hardrockbet.stale && d.game.books.draftkings; } catch { return false; } };
const game = nfl.games.find(g => g.state === "pre" && hasHR(g)) || nfl.games.find(g => g.state === "pre" && g.odds) || nfl.games[0];
const team = (game.home || {}).id;
console.log("game", game.id, "team", team);
const VIEWS = [
  { key: "mobile", vp: { width: 390, height: 844 }, mobile: true, route: "#/l/nfl" },
  { key: "desktop", vp: { width: 1280, height: 800 }, mobile: false, route: "#/l/nfl" },
  { key: "team", vp: { width: 390, height: 844 }, mobile: true, route: `#/t/nfl/${team}`, wait: ".phero" },
  { key: "search", vp: { width: 390, height: 844 }, mobile: true, route: "#/search/Eagles", wait: ".sr" },
  { key: "game", vp: { width: 390, height: 844 }, mobile: true, route: `#/g/nfl/${game.id}`, wait: ".books", scrollTo: ".books" },
];
const browser = await chromium.launch();
const errors = [];
for (const [t, label] of THEMES) {
  if (only && !only.includes(t)) continue;
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: v.vp, deviceScaleFactor: 2, isMobile: v.mobile, hasTouch: v.mobile, serviceWorkers: "block" });
    const page = await ctx.newPage();
    page.on("pageerror", e => errors.push(`${t}/${v.key}: ${e.message}`));
    await page.goto(`${BASE}?theme=${t}${v.route}`, { waitUntil: "networkidle" });
    await page.waitForSelector(v.wait || ".game, .empty", { timeout: 20000 }).catch(() => console.log(`  ${t}/${v.key}: ${v.wait} not found`));
    await page.waitForLoadState("networkidle").catch(() => {});
    if (v.scrollTo) await page.evaluate(sel => { const e = document.querySelector(sel); if (e) { const c = e.closest(".card") || e; window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 130); } }, v.scrollTo);
    await page.waitForTimeout(700);
    const got = await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "linesmart");
    if (got !== t) errors.push(`${t}/${v.key}: data-theme=${got}`);
    await page.screenshot({ path: path.join(DIR, `${t}-${v.key}.png`) });
    await ctx.close();
  }
  console.log("shot", t);
}
// comparison sheets: lay the screenshots out in a page and screenshot it (no extra image deps)
async function sheet(view, file, cols, cellW, title) {
  const shots = THEMES.filter(([t]) => fs.existsSync(path.join(DIR, `${t}-${view}.png`)));
  const cells = shots.map(([t, l]) => `<figure><figcaption>${l}<small>?theme=${t}</small></figcaption><img src="data:image/png;base64,${fs.readFileSync(path.join(DIR, `${t}-${view}.png`)).toString("base64")}"></figure>`).join("");
  const html = `<!doctype html><style>@font-face{font-family:I;src:url(${BASE}assets/fonts/inter-latin-var.woff2)}
    body{margin:0;padding:28px;background:#2a2e35;font-family:I,sans-serif;color:#fff;width:max-content}
    h1{margin:0 0 18px;font-size:26px;font-weight:800;letter-spacing:-.02em}
    .g{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:24px}
    figure{margin:0}figcaption{font-size:20px;font-weight:750;margin:0 0 10px;display:flex;justify-content:space-between;align-items:baseline}
    small{font-size:13px;font-weight:500;color:#b7bcc6}img{width:${cellW}px;display:block;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.45)}</style>
    <h1>${title}</h1><div class="g">${cells}</div>`;
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); await p.setContent(html, { waitUntil: "load" }); await p.waitForTimeout(300);
  const out = path.join(OUT, file);
  await p.screenshot({ path: out, fullPage: true });
  await ctx.close();
  console.log(out, (fs.statSync(out).size / 1048576).toFixed(2) + " MB");
}
await sheet("mobile", "themes-compare-mobile.png", 5, 390, "LineSmart color themes — mobile, NFL odds (390×844)");
await sheet("desktop", "themes-compare-desktop.png", 2, 960, "LineSmart color themes — desktop, NFL odds (1280×800)");
await sheet("team", "themes-compare-team.png", 5, 390, "LineSmart color themes — team page, mobile");
await sheet("game", "themes-compare-game.png", 5, 390, "LineSmart color themes — game page sportsbook table (best price highlighted), mobile");
await sheet("search", "themes-compare-search.png", 5, 390, "LineSmart color themes — search results (team/player), mobile");
await browser.close();
console.log("errors:", errors.length ? errors : "none");
process.exit(errors.length ? 1 : 0);
