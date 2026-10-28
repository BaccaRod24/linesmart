// Owner and visitor screenshots with Supabase stubbed. No Odds API calls.
// Usage: node scripts/pro_owner_screens.mjs
import { spawnSync } from "child_process";
import fs from "fs";
import http from "http";
import path from "path";
import { chromium } from "playwright";

const OUT = process.env.OUT || "/tmp/pro-owner-screens";
fs.mkdirSync(OUT, { recursive: true });
const pack = spawnSync(process.execPath, ["scripts/pack_pro_bundle.mjs"], { encoding: "utf8" });
if (pack.status !== 0) { console.error(pack.stdout, pack.stderr); process.exit(1); }
const bundle = fs.readFileSync("pro/dist/pro-app.js");

const OWNER_TOKEN = "test-owner-token";
const EMAIL = "pro-owner-test@example.com";
const session = {
  access_token: OWNER_TOKEN, refresh_token: "rt-owner", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: EMAIL },
};

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const root = path.resolve("site");
const read = p => fs.readFileSync(p);
const srv = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (rel === "/") rel = "/index.html";
  const f = path.join(root, rel);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404, { "content-type": "text/html" }); return res.end(fs.existsSync("site/404.html") ? read("site/404.html") : "missing");
  }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  res.end(read(f));
}).listen(0);
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const SB = "https://ctklbryattbbsqdmteny.supabase.co";

const browser = await chromium.launch();
const errors = [];
async function make(width, owner) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 900 : 1000 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((s) => {
    localStorage.setItem("ls-age-ok", "1");
    localStorage.setItem("ls-state", "FL");
    if (s.flags) for (const [k, v] of Object.entries(s.flags)) localStorage.setItem(k, v);
    if (s.session) localStorage.setItem("ls-sb-auth", JSON.stringify(s.session));
  }, owner ? { session } : { flags: { "ls-pro": "1", isPro: "true", pro: "1" } });
  await ctx.route(/the-odds-api|ipdata\.info|cloudflareinsights|espncdn|site\.web\.api\.espn|site\.api\.espn/, r => r.abort());
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
    if (u.pathname.startsWith("/auth/v1/token")) return json(200, session);
    if (u.pathname.startsWith("/auth/v1/user")) return json(200, session.user);
    if (u.pathname.includes("/user_bets") || u.pathname.includes("/line_alerts")) return json(200, []);
    return json(404, {});
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${width}: ${e.message}`));
  return { ctx, page };
}
async function shot(page, hash, file, sel) {
  await page.goto(BASE + hash, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(sel, { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  console.log("saved", file);
}

const visitor = await make(1280, false);
await shot(visitor.page, "#/", "visitor_home.png", ".game, .page-head");
await shot(visitor.page, "#/owner", "visitor_owner_url.png", ".game, .page-head, #intro");
const vText = await visitor.page.locator("body").innerText();
if (/Hot props|LineSmart Pro/.test(vText) && !/join the waitlist/.test(vText)) errors.push("visitor page shows Pro UI");
if (await visitor.page.locator("[data-pro-owner]").count()) errors.push("visitor has Pro UI");
await visitor.ctx.close();

const desk = await make(1280, true);
const phone = await make(390, true);
const screens = [
  ["overview", "#/owner", "[data-screen=''] .ppv-card, [data-pro-owner] .ppv-grid"],
  ["value", "#/owner/value", "[data-screen='value']"],
  ["alerts", "#/owner/alerts", "[data-screen='alerts']"],
  ["tracker", "#/owner/tracker", "[data-screen='tracker']"],
  ["books", "#/owner/books", "[data-screen='books']"],
  ["history", "#/owner/history", "[data-screen='history']"],
  ["refresh", "#/owner/refresh", "[data-screen='refresh']"],
];
for (const [name, hash, sel] of screens) {
  await shot(desk.page, hash, `owner_${name}.png`, sel);
  if (name === "overview" || name === "hot") await shot(phone.page, hash, `owner_${name}_mobile.png`, sel);
}
await shot(desk.page, "#/owner/hot?lg=nfl", "owner_hot.png", "[data-screen='hot']");
await desk.page.locator("#ppvHotSave input").fill("NFL props");
await desk.page.locator("#ppvHotSave button").click();
await desk.page.waitForSelector(".ppv-saved-chip", { timeout: 10000 });
await desk.page.waitForTimeout(300);
await desk.page.screenshot({ path: path.join(OUT, "owner_hot_saved.png"), fullPage: true });
console.log("saved owner_hot_saved.png");
const hot = await desk.page.locator("[data-pro-owner]").innerText();
if (!/21\+/.test(hot)) errors.push("hot missing 21+");
if (!/Hard Rock Bet is the only legal online sportsbook/.test(hot)) errors.push("hot missing Florida line");
const books = await desk.page.locator("[data-offers] [data-book]").evaluateAll(els => els.map(e => e.dataset.book));
if (books.some(b => b !== "hardrockbet")) errors.push("hot offer books " + books.join(","));
await shot(phone.page, "#/owner/hot?lg=nfl", "owner_hot_mobile.png", "[data-screen='hot']");
await desk.ctx.close();
await phone.ctx.close();
await browser.close();
srv.close();
console.log(errors.length ? "ERRORS\n" + errors.join("\n") : "errors: none");
process.exit(errors.length ? 1 : 0);
