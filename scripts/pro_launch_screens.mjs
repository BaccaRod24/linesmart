// Phone and iPad screenshots of each Pro page. Local server, is_pro stubbed.
// No Odds API calls and no production Supabase writes.
// Usage: env -u ODDS_API_KEY node scripts/pro_launch_screens.mjs
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

const TOKEN = "test-owner-token";
const sessionFor = email => ({
  access_token: TOKEN, refresh_token: "rt-owner", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "00000000-0000-4000-8000-000000000002", aud: "authenticated", role: "authenticated", email },
});
const RANK = { v: 1, leagues: { nfl: { season: 2026, boxGames: 8, through: "2026-11-01T18:00Z", players: [
  { id: "1", n: "Pat Fixture", pos: "QB", t: "2", ta: "BUF", gp: 8, py: 2100, ptd: 16, ry: 40, rtd: 1, rec: 0, recy: 0, rectd: 0 },
  { id: "2", n: "Sam Fixture", pos: "QB", t: "1", ta: "KC", gp: 8, py: 1900, ptd: 12, ry: 10, rtd: 0, rec: 0, recy: 0, rectd: 0 },
], props: [] } } };

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
const fails = [];

const browser = await chromium.launch();
async function make(width, height, email) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(email => {
    localStorage.setItem("ls-age-ok", "1");
    localStorage.setItem("ls-state", "FL");
    if (email) localStorage.setItem("ls-sb-auth", JSON.stringify({
      access_token: "test-owner-token", refresh_token: "rt-owner", token_type: "bearer", expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "00000000-0000-4000-8000-000000000002", aud: "authenticated", role: "authenticated", email },
    }));
    localStorage.setItem("ls-bets-v1", JSON.stringify({ bets: [
      { id: "b1", stake: 50, odds: -110, status: "won", type: "spread", book: "hardrockbet", line: -3.5, closeLine: -1.5, selection: "BUF -3.5", date: "2026-10-20", event: { name: "BAL @ BUF", lg: "nfl" } },
    ] }));
  }, email);
  await ctx.route(/the-odds-api|ipdata\.info|cloudflareinsights|espncdn|site\.web\.api\.espn|site\.api\.espn/, r => r.abort());
  await ctx.route(SB + "/**", async route => {
    const req = route.request();
    const u = new URL(req.url());
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const owner = (req.headers()["authorization"] || "") === "Bearer " + TOKEN;
    if (u.pathname.endsWith("/rpc/is_pro")) return json(200, owner);
    if (u.pathname.includes("/storage/v1/object/pro-private/pro-app.js")) {
      if (!owner) return json(403, {});
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/javascript" }, body: bundle });
    }
    if (u.pathname.includes("/storage/v1/object/pro-private/rankings.json")) {
      if (!owner) return json(403, {});
      return json(200, RANK);
    }
    if (u.pathname.startsWith("/auth/v1/")) return json(200, sessionFor(email));
    if (u.pathname.includes("/user_bets") || u.pathname.includes("/line_alerts")) return json(200, []);
    return json(404, {});
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => fails.push(`${width} ${e.message}`));
  return { ctx, page };
}

const pages = [
  ["overview", "#/owner", "[data-screen=''] #proGuide"],
  ["value", "#/owner/value", "[data-screen='value']"],
  ["alerts", "#/owner/alerts", "[data-screen='alerts']"],
  ["tracker", "#/owner/tracker", "[data-screen='tracker']"],
  ["books", "#/owner/books", "[data-screen='books']"],
  ["history", "#/owner/history", "[data-screen='history']"],
  ["refresh", "#/owner/refresh", "[data-screen='refresh']"],
  ["hot", "#/owner/hot?lg=nfl", "[data-screen='hot']"],
  ["rankings", "#/owner/rankings?lg=nfl&pos=QB&view=season", "#proRankings"],
];

async function overflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const nodes = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right > vw + 2 || r.left < -2) nodes.push((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || el.tagName) + " @" + Math.round(r.right));
    }
    return { delta: document.documentElement.scrollWidth - vw, nodes: nodes.slice(0, 8) };
  });
}

async function shot(page, hash, file, sel, width) {
  await page.goto(BASE + hash, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(sel, { timeout: 20000 });
  await page.waitForTimeout(400);
  const text = await page.locator("[data-pro-owner], body").first().innerText();
  if (!/21\+/.test(text)) fails.push(file + " missing 21+");
  const over = await overflow(page);
  if (over.delta > 2) fails.push(`${file} overflow ${over.delta}px ${over.nodes.join(" | ")}`);
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  console.log("saved", file, over.delta > 2 ? "OVERFLOW" : "fit");
}

const widths = [["phone", 390, 844], ["ipad", 834, 1194]];
for (const [name, width, height] of widths) {
  const { ctx, page } = await make(width, height, "betting@linesmart.app");
  for (const [id, hash, sel] of pages) await shot(page, hash, `pro-${id}-${name}.png`, sel, width);
  await shot(page, "#/", `pro-slate-${name}.png`, "a.game .pro-sharp", width);
  const role = await page.evaluate(() => {
    location.hash = "#/owner";
    return null;
  });
  await page.waitForSelector("[data-pro-role='pro']", { timeout: 15000 });
  const badge = await page.locator("[data-pro-role]").first().innerText();
  if (badge !== "PRO") fails.push(name + " betting account badge " + badge);
  await ctx.close();
  void role;
}

const owner = await make(390, 844, "copenhaverrodney24@yahoo.com");
await shot(owner.page, "#/owner", "pro-overview-owner-phone.png", "[data-pro-role='owner']", 390);
const ownerBadge = await owner.page.locator("[data-pro-role]").first().innerText();
if (ownerBadge !== "OWNER") fails.push("owner badge " + ownerBadge);
await owner.ctx.close();

const visitor = await make(390, 844, "");
await visitor.page.goto(BASE + "#/owner", { waitUntil: "domcontentloaded" });
await visitor.page.waitForTimeout(800);
if (await visitor.page.locator("[data-pro-owner]").count()) fails.push("empty session saw Pro");
await visitor.ctx.close();

await browser.close();
srv.close();
console.log(fails.length ? "ERRORS\n" + fails.join("\n") : "errors: none");
process.exit(fails.length ? 1 : 0);
