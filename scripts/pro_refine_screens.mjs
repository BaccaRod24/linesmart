// Pro refine screenshots. Local server, is_pro stubbed true, local bundle. No Odds API calls.
// Usage: OUT=/opt/cursor/artifacts/pro-refine node scripts/pro_refine_screens.mjs
import { spawnSync } from "child_process";
import fs from "fs";
import http from "http";
import path from "path";
import { chromium } from "playwright";

const OUT = process.env.OUT || "/tmp/pro-refine-screens";
fs.mkdirSync(OUT, { recursive: true });
const pack = spawnSync(process.execPath, ["scripts/pack_pro_bundle.mjs"], { encoding: "utf8" });
if (pack.status !== 0) { console.error(pack.stdout, pack.stderr); process.exit(1); }
console.log(pack.stdout.trim());
const bundle = fs.readFileSync("pro/dist/pro-app.js");

const OWNER_TOKEN = "test-owner-token";
const session = {
  access_token: OWNER_TOKEN, refresh_token: "rt-owner", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "pro-owner-test@example.com" },
};
const bets = [
  { id: "b1", stake: 110, odds: -110, status: "won", type: "spread", book: "hardrock", line: -3, closeLine: -6, selection: "GB -3", date: "2026-10-20", event: { name: "CAR @ GB", lg: "nfl" } },
  { id: "b2", stake: 50, odds: -110, status: "lost", type: "total", book: "hardrock", line: 45, closeLine: 48, side: "over", selection: "Over 45", date: "2026-10-21", event: { name: "DAL @ PHI", lg: "nfl" } },
];
const PROPS_DOC = {
  lg: "nba", gen: "2026-10-26T02:00:00Z",
  markets: { points: ["Points", "Pts"] },
  games: { "5": { props: [
    ["a", "points", 24.5, 22.5, [4, 1, 0, 5], { hardrockbet: [24.5, -110, -110, null], fanduel: [24.5, -150, -110, null], draftkings: [24.5, -130, -110, null] }],
  ] } },
  players: { a: { n: "Alex Sample", pos: "G", t: "1", ta: "BUF", log: [30, 30, 30, 30, 10].map((v, i) => [`2026-10-${String(20 - i).padStart(2, "0")}`, "OPP", "vs", { points: v }]) } },
};

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const root = path.resolve("site");
const read = p => fs.readFileSync(p, "utf8");
function playerPage() {
  let t = read("site/index.html");
  t = t.replace("<head>", '<head>\n<base href="/">');
  t = t.replace('<body class="app">', '<body class="app seo-page" data-page="player" data-lg="nba">');
  t = t.replace(/<main class="wrap" id="app">[\s\S]*?<\/main>/, '<main class="wrap" id="app"><article class="pv sx-player"><h1>Alex Sample props</h1><div id="lines-s"></div><p class="pv-cta"><a class="pv-live" href="#/p/nba/a/log">Open in the app</a></p></article></main>');
  return t;
}
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/props-fixture" || u.pathname === "/props-fixture/") {
    res.writeHead(200, { "content-type": "text/html" }); return res.end(playerPage());
  }
  let rel = decodeURIComponent(u.pathname);
  if (rel === "/") rel = "/index.html";
  const f = path.join(root, rel);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404, { "content-type": "text/html" }); return res.end(fs.existsSync("site/404.html") ? read("site/404.html") : "missing");
  }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
}).listen(0);
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const SB = "https://ctklbryattbbsqdmteny.supabase.co";

const browser = await chromium.launch();
const errors = [];
async function make(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(s => {
    localStorage.setItem("ls-age-ok", "1");
    localStorage.setItem("ls-state", "FL");
    localStorage.setItem("ls-bets-demo", "1");
    localStorage.setItem("ls-sb-auth", JSON.stringify(s.session));
    localStorage.setItem("ls-bets-v1", JSON.stringify({ v: 1, bets: s.bets }));
  }, { session, bets });
  await ctx.route(/the-odds-api|ipdata\.info|cloudflareinsights|espncdn|site\.web\.api\.espn|site\.api\.espn/, r => r.abort());
  await ctx.route("**/data/props/nba.json", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROPS_DOC) }));
  await ctx.route(SB + "/**", async route => {
    const req = route.request();
    const u = new URL(req.url());
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const ownerAuth = (req.headers()["authorization"] || "") === "Bearer " + OWNER_TOKEN;
    if (u.pathname.endsWith("/rpc/is_pro")) return json(200, ownerAuth);
    if (u.pathname.includes("/storage/v1/object/pro-private/pro-app.js")) {
      if (!ownerAuth) return json(403, {});
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/javascript" }, body: bundle });
    }
    if (u.pathname.startsWith("/auth/v1/")) return json(200, u.pathname.includes("/user") ? session.user : session);
    if (u.pathname.includes("/user_bets") || u.pathname.includes("/line_alerts")) return json(200, []);
    return json(404, {});
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${width}: ${e.message}`));
  return { ctx, page };
}
async function shot(page, url, file, sel) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(sel, { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  console.log("saved", file);
}

const pages = (process.env.SHOTS === "game"
  ? [["game", "#/g/nfl/401873023", ".pro-insights"]]
  : [
    ["slate", "#/", "[data-pro-badge]"],
    ["game", "#/g/nfl/401873023", ".pro-insights"],
    ["props", "props-fixture/", "#pro-props-panel"],
    ["bets", "#/bets", "#pro-bets-panel"],
    ["hub", "#/pro", "#proMoves"],
  ]);
for (const [width, height, tag] of [[1280, 900, "desktop"], [375, 812, "mobile"]]) {
  const { ctx, page } = await make(width, height);
  for (const [name, url, sel] of pages) await shot(page, url, `${name}-${tag}.png`, sel);
  await ctx.close();
}
if (process.env.SHOTS !== "game") {
  const { ctx, page } = await make(1280, 900);
  await shot(page, "?theme=daylight#/pro", "hub-daylight-desktop.png", "#proMoves");
  await shot(page, "?theme=daylight#/g/nfl/401873023", "game-daylight-desktop.png", ".pro-insights");
  await ctx.close();
}

const hub = fs.existsSync(path.join(OUT, "hub-desktop.png"));
if (!hub) errors.push("hub shot missing");
await browser.close();
srv.close();
console.log(errors.length ? "ERRORS\n" + errors.join("\n") : "errors: none");
process.exit(errors.length ? 1 : 0);
