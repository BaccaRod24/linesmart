// Screenshots of the Pro Rankings tab. No Odds API calls.
// Usage: env -u ODDS_API_KEY node scripts/rankings_screens.mjs
import { spawnSync } from "child_process";
import fs from "fs";
import http from "http";
import path from "path";
import { chromium } from "playwright";

const OUT = process.env.OUT || "/opt/cursor/artifacts";
fs.mkdirSync(OUT, { recursive: true });
const pack = spawnSync(process.execPath, ["scripts/pack_pro_bundle.mjs"], { encoding: "utf8" });
if (pack.status !== 0) { console.error(pack.stdout, pack.stderr); process.exit(1); }
const bundle = fs.readFileSync("pro/dist/pro-app.js");

const OWNER_TOKEN = "test-owner-token";
const session = {
  access_token: OWNER_TOKEN, refresh_token: "rt-owner", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "pro-owner-test@example.com" },
};
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const root = path.resolve("site");
const srv = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (rel === "/") rel = "/index.html";
  const f = path.join(root, rel);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404, { "content-type": "text/html" }); return res.end("missing");
  }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
}).listen(0);
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const SB = "https://ctklbryattbbsqdmteny.supabase.co";
const browser = await chromium.launch();
const fails = [];

async function make(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(s => { localStorage.setItem("ls-age-ok", "1"); localStorage.setItem("ls-state", "FL"); localStorage.setItem("ls-sb-auth", JSON.stringify(s)); }, session);
  await ctx.route(/the-odds-api|ipdata\.info|cloudflareinsights|espncdn|site\.web\.api\.espn|site\.api\.espn/, r => r.abort());
  await ctx.route(SB + "/**", async route => {
    const req = route.request();
    const u = new URL(req.url());
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const owner = (req.headers()["authorization"] || "") === "Bearer " + OWNER_TOKEN;
    if (u.pathname.endsWith("/rpc/is_pro")) return json(200, owner);
    if (u.pathname.includes("/storage/v1/object/pro-private/pro-app.js")) {
      if (!owner) return json(403, {});
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/javascript" }, body: bundle });
    }
    if (u.pathname.startsWith("/auth/v1/token")) return json(200, session);
    if (u.pathname.startsWith("/auth/v1/user")) return json(200, session.user);
    return json(200, []);
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => fails.push(e.message));
  return { ctx, page };
}

const shots = [
  ["rankings_nfl_season_desktop.png", 1280, 900, "#/pro/rankings?lg=nfl&pos=QB&view=season", "season", "NFL", /pass yds|passing yards|ppg/i],
  ["rankings_nfl_season_mobile.png", 390, 844, "#/pro/rankings?lg=nfl&pos=QB&view=season", "season", "NFL", /pass yds|passing yards|ppg/i],
  ["rankings_nfl_hit_desktop.png", 1280, 900, "#/pro/rankings?lg=nfl&pos=QB&view=hit", "hit", "NFL"],
  ["rankings_nfl_hit_mobile.png", 390, 844, "#/pro/rankings?lg=nfl&pos=QB&view=hit", "hit", "NFL"],
  ["rankings_nba_season_desktop.png", 1280, 900, "#/pro/rankings?lg=nba&pos=G&view=season", "season", "NBA", /ppg/i],
  ["rankings_nba_season_mobile.png", 390, 844, "#/pro/rankings?lg=nba&pos=G&view=season", "season", "NBA", /ppg/i],
  ["rankings_nba_hit_desktop.png", 1280, 900, "#/pro/rankings?lg=nba&pos=G&view=hit", "hit", "NBA"],
  ["rankings_nba_hit_mobile.png", 390, 844, "#/pro/rankings?lg=nba&pos=G&view=hit", "hit", "NBA"],
  ["rankings_nfl_wr_receptions_desktop.png", 1280, 900, "#/pro/rankings?lg=nfl&pos=WR&view=season&stat=rec", "season", "NFL", /receptions/i],
  ["rankings_nfl_rb_tds_desktop.png", 1280, 900, "#/pro/rankings?lg=nfl&pos=RB&view=season&stat=td", "season", "NFL", /Rushing TDs plus receiving/],
  ["rankings_nfl_qb_yards_desktop.png", 1280, 900, "#/pro/rankings?lg=nfl&pos=QB&view=season&stat=yds", "season", "NFL", /Passing yards/],
  ["rankings_nfl_wr_receptions_mobile.png", 390, 844, "#/pro/rankings?lg=nfl&pos=WR&view=season&stat=rec", "season", "NFL", /receptions/i],
];

for (const [file, width, height, hash, view, lg, need] of shots) {
  const { ctx, page } = await make(width, height);
  await page.goto(BASE + hash, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`#proRankings[data-rk-view='${view}']`, { timeout: 20000 });
  await page.waitForSelector("#proRankings .rk-table tbody tr", { timeout: 10000 });
  const text = await page.locator("[data-pro-owner]").innerText();
  const table = await page.locator("#proRankings").innerText();
  if (!/21\+/.test(text)) fails.push(file + " missing 21+");
  if (!/1-800-GAMBLER|1-833-PLAYWISE/.test(text)) fails.push(file + " missing helpline");
  if (!/Hard Rock Bet is the only legal online sportsbook/.test(text)) fails.push(file + " missing Florida line");
  if (/DraftKings and FanDuel are available in Florida|legal in Florida/.test(text) && !/not available in Florida/.test(text)) fails.push(file + " implies DK/FD are legal");
  if (await page.locator("[data-ad-label]").count() < 1) fails.push(file + " missing Ad label");
  if (view === "season" && need && !need.test(table)) fails.push(file + " missing the ranked stat");
  if (view === "season" && await page.locator("#proRankings th.rk-on").count() !== 1) fails.push(file + " should highlight one stat column");
  if (/pos=QB/.test(hash) && view === "season") {
    const labels = await page.locator("[aria-label='Rank by'] a").allInnerTexts();
    if (labels.some(t => /Receptions/i.test(t))) fails.push(file + " offers quarterback receptions");
    if (!labels.includes("Yards") || !labels.includes("TDs")) fails.push(file + " missing the quarterback stat picker");
  }
  if (view === "hit" && !/This season vs the current line/.test(table)) fails.push(file + " missing hit label");
  if (view === "hit" && !/\d+\/\d+/.test(table)) fails.push(file + " missing sample");
  if (!table.includes(lg)) fails.push(file + " missing league");
  const lines = await page.locator("#proRankings .rk-table small").allInnerTexts();
  if (view === "hit" && lines.some(t => /DraftKings|FanDuel/.test(t))) fails.push(file + " graded a Florida-illegal book");
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  console.log("saved", file);
  await ctx.close();
}

await browser.close();
srv.close();
if (fails.length) { console.error(fails.join("\n")); process.exit(1); }
console.log("screens ok");
