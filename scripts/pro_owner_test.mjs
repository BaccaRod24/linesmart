// Owner gate: non-owners see no Pro UI, browser flags don't unlock it, sitemap/SEO stay clear,
// and the feature helpers don't invent missing numbers.
// Usage: node scripts/pro_owner_test.mjs
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import http from "http";
import { chromium } from "playwright";
import { spawnSync } from "child_process";

const require = createRequire(import.meta.url);
const G = require("../site/assets/pro-gate-core.js");
const F = require("../pro/pro-features.js");
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} gate: ${msg}`); if (!ok) fails.push(msg); };
const read = p => fs.readFileSync(p, "utf8");

const OWNER_EMAIL = "pro-owner-test@example.com";
const MEMBER_EMAIL = "pro-member-test@example.com";
const OWNER_TOKEN = "test-owner-token";
const MEMBER_TOKEN = "test-member-token";

{
  check(G.allow(true) === true, "boolean true from is_pro() is the only yes");
  check(G.allow("true") === false && G.allow(1) === false && G.allow({ ok: true }) === false && G.allow(null) === false, "strings, numbers and objects do not unlock");
  check(G.tokenOf(null) === "" && G.tokenOf("not-json") === "" && G.tokenOf("{}") === "", "a missing session has no token");
  check(G.tokenOf(JSON.stringify({ access_token: OWNER_TOKEN })) === OWNER_TOKEN, "session JSON yields the access token");
  check(G.isOwnerHash("#/owner") && G.isOwnerHash("#/owner/hot?lg=nfl") && !G.isOwnerHash("#/") && !G.isOwnerHash("#/pro"), "owner hash is #/owner only");
  check(!G.IGNORED_FLAGS.some(k => G.allow(k) || G.allow(true) === k), "flag names are not an allow() input");
  const gate = read("site/assets/pro-gate.js");
  check(/\.allow\(/.test(gate) && !/localStorage\.getItem\(\s*[\"']ls-pro/.test(gate) && !/localStorage\.getItem\(\s*[\"']isPro/.test(gate), "the loader asks allow() and does not read a pro flag");
  check(!/Hot props|Sharp move|Closing-line|ppv-banner/.test(gate + read("site/assets/pro-gate-core.js")), "public loader has no Pro screens");
  check(!fs.existsSync("site/assets/pro-app.js") && !fs.existsSync("site/assets/hot-props-core.js") && !fs.existsSync("site/assets/pro-ui.js"), "Pages directory does not ship the Pro bundle");
}

{
  const sql = read("supabase/migrations/20261028_pro_access.sql");
  check(/create table if not exists public\.pro_access/.test(sql), "pro_access table");
  check(/enable row level security/.test(sql), "RLS on");
  check(/pro_access_select_own[\s\S]*for select to authenticated[\s\S]*user_id = \(select auth\.uid\(\)\)/.test(sql), "select own row only");
  check(!/for insert|for update|for delete|grant insert|grant update|grant delete/i.test(sql), "no client insert, update, or delete");
  check(/function public\.is_pro\(\)/.test(sql) && /security definer/.test(sql) && /auth\.uid\(\)/.test(sql), "is_pro() is security definer and uses auth.uid()");
  check(/grant execute on function public\.is_pro\(\) to anon, authenticated/.test(sql), "is_pro() is callable");
  check(/pro-private/.test(sql) && /public = false/.test(sql) && /public\.is_pro\(\)/.test(sql), "private bucket readable only by is_pro()");
  check(/when public\.is_pro\(\) then 25/.test(sql), "25 active alerts only inside is_pro()");
  check(!/user_daily_cap\s*(int|integer)?\s*[^;\n]*25/.test(sql) && !/set user_daily_cap/.test(sql), "email daily cap is not raised");
  check(!/@/.test(sql), "migration has no email address");
  const docs = read("docs/pro-owner.md");
  const insert = docs.match(/insert into public\.pro_access \(user_id\) select id from auth\.users where email = '([^']+)' on conflict \(user_id\) do nothing;/);
  check(!!insert, "docs hold the one-line owner insert");
  const ownerEmail = insert ? insert[1] : "";
  check(ownerEmail.includes("@") && !/example\.(com|org|net)/.test(ownerEmail) && ownerEmail !== OWNER_EMAIL, "owner insert is a real account, not the test account");
  const shipped = ["site/assets/pro-gate.js", "site/assets/pro-gate-core.js", "site/owner.html", "pro/pro-ui.js", "pro/pro-features.js", "pro/hot-props-core.js", "supabase/migrations/20261028_pro_access.sql", "scripts/pro_owner_test.mjs", "scripts/hot_props_test.mjs", "scripts/pro_owner_screens.mjs"];
  for (const f of shipped) {
    if (!fs.existsSync(f)) continue;
    const t = read(f);
    check(!ownerEmail || !t.includes(ownerEmail), `${f} has no owner email`);
    check(!/contact@linesmart\.app/.test(t), `${f} does not use the contact address as a sign-in`);
  }
}

{
  const now = Date.parse("2026-10-28T12:00:00Z");
  const moves = F.sharpMoves({
    nfl: [
      { id: "1", state: "pre", date: "2026-10-30T00:00:00Z", move: { notable: ["Spread moved 2 pts"], spread: { delta: 2 }, book: "draftkings" } },
      { id: "2", state: "pre", date: "2026-10-30T00:00:00Z", move: { notable: [], spread: { delta: 9 } } },
      { id: "3", state: "post", date: "2026-10-20T00:00:00Z", move: { notable: ["Total moved 4"], total: { delta: 4 } } },
    ],
  }, now);
  check(moves.length === 1 && moves[0].id === "1", "sharp flags keep upcoming games that already have a note");
  const board = [
    { lg: "nfl", mk: "spread", label: "DAL +3.5", matchup: "DAL @ PHI", edge: 0.03 },
    { lg: "nba", mk: "ml", label: "BOS ML", matchup: "NYK @ BOS", edge: 0.004 },
  ];
  check(F.filterBoard(board, { lg: "nfl", mk: "spread", q: "dal", min: 2 }).length === 1, "custom filter: sport, market, search, min edge");
  check(F.filterBoard(board, { lg: "nba", min: 1 }).length === 0, "a row under the minimum is left out");
  check(JSON.stringify(F.bookColumns({ books: { draftkings: { homeML: -110 }, fanduel: {}, hardrockbet: null } })) === '["draftkings"]', "only a book that posted a number is a column");
  const ref = F.refreshInfo("2026-10-28T00:00:00Z", Date.parse("2026-10-28T06:00:00Z"));
  check(ref.cadenceMin === 30 && ref.fasterMin === null && Math.abs(ref.ageHours - 6) < 0.01, "refresh shows file age; faster pull stays empty");
  check(F.clvPoints({ type: "spread", line: -3 }, null).available === false, "CLV is unavailable without a closing number");
  check(F.clvPoints({ type: "spread", line: -3 }, -1.5).available === true && F.clvPoints({ type: "spread", line: -3 }, -1.5).delta === 1.5, "CLV is the close minus the bet line when both exist");
  const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
  const store = mem();
  check(F.setTag(store, "b1", "prime", true).ok && F.readTags(store).b1[0] === "prime", "a tag saves in its own store");
  check(G.allow(store.getItem(F.TAG_KEY)) === false, "a saved tag is not an unlock");
}

{
  const blob = ["robots.txt", ...fs.readdirSync("site").filter(f => f.startsWith("sitemap"))].map(f => read(path.join("site", f))).join("\n");
  check(!/owner\.html|pro-app|pro-private|hot-props|#\/owner/.test(blob), "sitemap and robots have no Pro owner URLs");
  const seo = read("scripts/seo_pages.py");
  check(!/owner\.html|pro-app|pro-private/.test(seo), "SEO builder does not emit Pro");
  const html = fs.readdirSync("site").filter(f => f.endsWith(".html") && f !== "owner.html");
  for (const f of html) {
    const t = read(path.join("site", f));
    check(!/owner\.html|#\/owner|pro-app\.js|data-pro-owner/.test(t), `${f} does not link Pro`);
  }
  const owner = read("site/owner.html");
  check(/noindex/.test(owner) && !/<a\s/i.test(owner), "owner page is noindex and has no link");
  const idx = read("site/index.html");
  check(idx.includes("assets/pro-gate.js") && !idx.includes("pro/pro-ui.js") && !idx.includes("hot-props-core.js"), "the public page loads only the tiny gate");
}

const packed = spawnSync(process.execPath, ["scripts/pack_pro_bundle.mjs"], { encoding: "utf8" });
check(packed.status === 0 && fs.existsSync("pro/dist/pro-app.js"), "bundle packs");
const bundle = read("pro/dist/pro-app.js");
check(bundle.includes("window.LSProApp") && bundle.includes("window.HotProps"), "bundle contains the screens and hot props");

function session(token, email, refresh) {
  return {
    access_token: token, refresh_token: refresh, token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "00000000-0000-4000-8000-" + (token === OWNER_TOKEN ? "000000000001" : "000000000002"), aud: "authenticated", role: "authenticated", email },
  };
}

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const root = path.resolve("site");
const srv = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
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
async function open(seed) {
  const calls = [];
  const ctx = await browser.newContext();
  await ctx.addInitScript(s => {
    localStorage.setItem("ls-age-ok", "1");
    localStorage.setItem("ls-state", "FL");
    for (const [k, v] of Object.entries(s.flags || {})) localStorage.setItem(k, v);
    if (s.session) localStorage.setItem("ls-sb-auth", JSON.stringify(s.session));
  }, seed);
  await ctx.route(/the-odds-api|ipdata\.info|cloudflareinsights|espncdn|site\.web\.api\.espn|site\.api\.espn/, r => r.abort());
  await ctx.route(SB + "/**", async route => {
    const req = route.request();
    const u = new URL(req.url());
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const auth = req.headers()["authorization"] || "";
    const owner = auth === "Bearer " + OWNER_TOKEN;
    calls.push(u.pathname + " " + (owner ? "owner" : "other"));
    if (u.pathname.endsWith("/rpc/is_pro")) return json(200, owner);
    if (u.pathname.includes("/storage/v1/object/pro-private/pro-app.js")) {
      if (!owner) return json(403, { error: "forbidden" });
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/javascript" }, body: bundle });
    }
    let posted = null;
    try { posted = req.postDataJSON(); } catch (e) { posted = null; }
    if (u.pathname.startsWith("/auth/v1/token")) {
      const who = posted && posted.refresh_token === "rt-owner" ? session(OWNER_TOKEN, OWNER_EMAIL, "rt-owner") : session(MEMBER_TOKEN, MEMBER_EMAIL, "rt-member");
      return json(200, who);
    }
    if (u.pathname.startsWith("/auth/v1/user")) {
      return json(200, (owner ? session(OWNER_TOKEN, OWNER_EMAIL, "rt-owner") : session(MEMBER_TOKEN, MEMBER_EMAIL, "rt-member")).user);
    }
    if (u.pathname.includes("/user_bets") || u.pathname.includes("/line_alerts")) return json(200, []);
    return json(404, { message: "unmocked" });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  return { ctx, page, calls, errors };
}
async function quiet(page) {
  await page.waitForTimeout(600);
  const ui = await page.evaluate(() => ({
    pro: !!document.querySelector("[data-pro-owner]"),
    hot: /Hot props/.test(document.body.innerText),
    nav: !!document.querySelector("[data-pro-owner-nav]"),
    robots: (document.querySelector('meta[name="robots"][data-pro-gate]') || {}).content || "",
    hash: location.hash,
    bundle: !!document.querySelector("script[data-pro-bundle]"),
  }));
  return ui;
}

{
  const { ctx, page, calls, errors } = await open({ flags: { "ls-pro": "1", isPro: "true", pro: "1", "linesmart-pro": "1", "ls-pro-access": "true" } });
  await page.goto(BASE + "#/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".game, .empty, .page-head", { timeout: 15000 });
  let ui = await quiet(page);
  check(!ui.pro && !ui.hot && !ui.nav && !ui.bundle, "signed out, even with flags: no Pro UI");
  check(!calls.some(c => c.includes("pro-app")), "signed out: the bundle is not fetched");
  await page.goto(BASE + "#/owner", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  ui = await quiet(page);
  check(!ui.pro && !ui.hot && (ui.hash === "#/" || ui.hash === ""), `signed-out #/owner falls back to the free site (${ui.hash})`);
  check(!errors.length, `signed out: no page errors ${errors.join(" | ")}`);
  await ctx.close();
}

{
  const { ctx, page, calls, errors } = await open({
    flags: { "ls-pro": "1", isPro: "true" },
    session: session(MEMBER_TOKEN, MEMBER_EMAIL, "rt-member"),
  });
  await page.goto(BASE + "#/owner", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const ui = await quiet(page);
  check(calls.some(c => c.startsWith("/rest/v1/rpc/is_pro")), "signed-in non-owner calls is_pro()");
  check(!calls.some(c => c.includes("pro-app")), "signed-in non-owner does not download the bundle");
  check(!ui.pro && !ui.hot && !ui.bundle, "signed-in non-owner gets no Pro UI");
  check(!errors.filter(e => !/supabase|session/i.test(e)).length, `non-owner page errors ${errors.join(" | ")}`);
  await ctx.close();
}

{
  const { ctx, page, calls, errors } = await open({ session: session(OWNER_TOKEN, OWNER_EMAIL, "rt-owner") });
  await page.goto(BASE + "#/owner", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-pro-owner] .of-21", { timeout: 15000 });
  const ui = await quiet(page);
  check(ui.pro && ui.nav && ui.bundle, "owner: Pro UI and nav appear");
  check(calls.some(c => c.includes("pro-app") && c.endsWith("owner")), "owner: bundle fetched with the owner token");
  const text = await page.locator("[data-pro-owner]").innerText();
  check(/21\+/.test(text) && /Hard Rock Bet is the only legal online sportsbook/.test(text), "owner home: 21+ and Florida line");
  await page.goto(BASE + "#/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".game, .page-head", { timeout: 15000 });
  const home = await quiet(page);
  check(home.nav && !home.pro && home.robots === "", "owner on the free home still has the Pro link and no noindex");
  check(!errors.length, `owner page errors ${errors.join(" | ")}`);
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);
