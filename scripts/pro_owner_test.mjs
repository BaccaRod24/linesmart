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
  check(G.verdict(true, true) === "yes" && G.verdict(false, true) === "no", "verdict is yes or no only for real booleans");
  check(G.verdict("true", true) === "unknown" && G.verdict(null, true) === "unknown" && G.verdict({ ok: true }, true) === "unknown", "a weird body is not a decision");
  check(G.verdict(true, false) === "unknown" && G.verdict(false, false) === "unknown", "an HTTP failure is unknown, not a no");
  check(G.shouldHide(false, "yes") === true && G.shouldHide(true, "no") === true, "sign-out and a definite false hide Pro");
  check(G.shouldHide(true, "unknown") === false && G.shouldHide(true, "yes") === false, "a blip or a yes does not hide Pro");
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
  const hist = F.historyMarkets({
    open: { draftkings: { hs: -3, tot: 48.5, aml: 136, hml: -162 } },
    books: { draftkings: [["2026-10-26T02:36:55Z", { hs: 4.5, tot: 43.5, aml: -225, hml: 185 }]] },
  });
  check(hist.length === 1 && hist[0].spread.open === -3 && hist[0].spread.current === 4.5 && hist[0].spread.points.length === 2, "line history keeps the open and the recorded spread");
  check(hist[0].total.current === 43.5 && hist[0].awayML.open === 136 && hist[0].homeML.current === 185, "total and both moneylines come from the file");
  check(F.historyMarkets({ books: { draftkings: [] }, open: {} })[0].spread === null, "a market with no number stays empty");
  const clv = F.clvSummary([{ id: "b1", type: "spread", line: -3, closeLine: -1.5 }, { id: "b2", type: "spread", line: 7 }]);
  check(clv.available === true && clv.n === 1 && clv.mean === 1.5, "CLV averages only bets that have a closing number");
  check(F.clvSummary([{ id: "b2", type: "spread", line: 7 }]).available === false, "no closing number means CLV stays unavailable");
  const groups = F.tagGroups([{ id: "b1" }, { id: "b2" }], { b1: ["prime"] });
  check(groups.find(g => g.tag === "prime").bets.length === 1 && groups.find(g => g.tag === "untagged").bets[0].id === "b2", "tag splits keep untagged bets in their own group");
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
  check(idx.includes("assets/pro-gate.js") && idx.includes("assets/pro-gate-core.js") && !idx.includes("pro/pro-ui.js") && !idx.includes("hot-props-core.js"), "the public page loads only the tiny gate");
  const ui = read("pro/pro-ui.js");
  check(!/href="#\/g\//.test(ui) && /gameHref/.test(ui), "Pro rows stay on the owner line-history screen");
  const appJs = read("site/assets/app.js");
  check(/\[data-pro-owner\]/.test(appJs) && appJs.includes("#/owner/history/"), "a public game link tapped inside Pro is sent to line history");
  const gateJs = read("site/assets/pro-gate.js");
  check(/shouldHide/.test(gateJs) && /\.allow\(/.test(gateJs) && /LSProApp\.enhance/.test(gateJs), "the loader asks allow(), hides only through shouldHide, and enhances after yes");
  const shellFn = read("scripts/seo_pages.py");
  const shell = shellFn.slice(shellFn.indexOf("class Shell"), shellFn.indexOf("def crumbs("));
  check(shell.includes("preview.js") && !shell.includes("pro-ui.js") && !shell.includes("hot-props"), "generated pages keep index scripts and do not inline Pro");
  check(!/data-pro-owner|pro-app\.js/.test(read("site/sitemap-core.xml") + read("site/robots.txt")), "core sitemap and robots stay clear of Pro");
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
const PROPS_DOC = {
  lg: "nba", gen: "2026-10-26T02:00:00Z",
  markets: { points: ["Points", "Pts"] },
  games: { "5": { props: [
    ["a", "points", 24.5, 22.5, [4, 1, 0, 5], { hardrockbet: [24.5, -110, -110, null], fanduel: [24.5, -150, -110, null], draftkings: [24.5, -130, -110, null] }],
  ] } },
  players: { a: { n: "Alex Sample", pos: "G", t: "1", ta: "BUF", log: [30, 30, 30, 30, 10].map((v, i) => [`2026-10-${String(20 - i).padStart(2, "0")}`, "OPP", "vs", { points: v }]) } },
};
function playerPage() {
  let t = read("site/index.html");
  t = t.replace("<head>", '<head>\n<base href="/">');
  t = t.replace('<body class="app">', '<body class="app seo-page" data-page="player" data-lg="nba">');
  t = t.replace(/<main class="wrap" id="app">[\s\S]*?<\/main>/, '<main class="wrap" id="app"><article class="pv sx-player"><h1>Alex Sample props</h1><div id="lines-s"></div><p class="pv-cta"><a class="pv-live" href="#/p/nba/a/log">Open in the app</a></p></article></main>');
  return t;
}
async function open(seed) {
  const calls = [];
  const gate = { mode: "pass" };
  const ctx = await browser.newContext();
  await ctx.addInitScript(s => {
    localStorage.setItem("ls-age-ok", "1");
    localStorage.setItem("ls-state", "FL");
    for (const [k, v] of Object.entries(s.flags || {})) localStorage.setItem(k, v);
    if (s.session) localStorage.setItem("ls-sb-auth", JSON.stringify(s.session));
    if (s.bets) localStorage.setItem("ls-bets-v1", JSON.stringify({ bets: s.bets }));
    if (s.tags) localStorage.setItem("ls-pro-tags-v1", JSON.stringify(s.tags));
  }, seed);
  await ctx.route("**/data/meta.json", async route => {
    const res = await route.fetch();
    const j = await res.json();
    j.pages = { generated: "pro-test" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) });
  });
  await ctx.route("**/data/pages.json", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ generated: "pro-test", l: { nfl: "nfl/" }, g: { nfl: { "401873023": "nfl/games/carolina-at-green-bay/" } }, t: {}, p: {} }),
  }));
  await ctx.route("**/props-fixture/", route => route.fulfill({ status: 200, contentType: "text/html", body: playerPage() }));
  await ctx.route("**/data/props/nba.json", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROPS_DOC) }));
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
    if (u.pathname.endsWith("/rpc/is_pro")) {
      if (gate.mode === "err") return json(503, { message: "unavailable" });
      if (gate.mode === "no") return json(200, false);
      if (gate.mode === "junk") return json(200, { ok: true });
      return json(200, owner);
    }
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
  return { ctx, page, calls, errors, gate };
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
  check(!calls.some(c => c.includes("is_pro")), "signed out: is_pro is not called");
  await page.goto(BASE + "#/g/nfl/401873026", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".match, .empty", { timeout: 15000 });
  await page.waitForTimeout(400);
  check(await page.locator("#pro-game-panel, [data-pro-badge], [data-pro-owner-nav], [data-pro-enhance]").count() === 0, "flags do not add Pro to a game page");
  await page.goto(BASE + "props-fixture/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  check(await page.locator("[data-pro-enhance]").count() === 0 && !/Price gaps on the same line/.test(await page.locator("body").innerText()), "visitor props page has no hot filters");
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
  await page.goto(BASE + "#/g/nfl/401873026", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".match, .empty", { timeout: 15000 });
  await page.waitForTimeout(500);
  const enhanceRan = await page.evaluate(() => !!window.LSProApp);
  check(!enhanceRan && await page.locator("[data-pro-enhance]").count() === 0, "non-owner: enhancers never run");
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
  const badges = await page.locator("[data-pro-badge]").count();
  check(badges > 0, "home slate marks sharp-move tiles for the owner");
  check(!errors.length, `owner page errors ${errors.join(" | ")}`);
  await ctx.close();
}

{
  const bets = [
    { id: "b1", stake: 110, odds: -110, status: "won", type: "spread", book: "hardrock", line: -3, closeLine: -1.5, selection: "GB -3", date: "2026-10-20", event: { name: "CAR @ GB", lg: "nfl" } },
    { id: "b2", stake: 50, odds: -110, status: "lost", type: "total", book: "hardrock", line: 47.5, selection: "Over 47.5", date: "2026-10-21", event: { name: "BAL @ BUF", lg: "nfl" } },
  ];
  const { ctx, page, errors, gate } = await open({ session: session(OWNER_TOKEN, OWNER_EMAIL, "rt-owner"), bets, tags: { b1: ["prime"] } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + "#/owner/alerts", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-pro-owner] a.ppv-line", { timeout: 15000 });
  const row = page.locator("[data-pro-owner] a.ppv-line").first();
  const href = await row.getAttribute("href");
  check(/^#\/owner\/history\/[a-z0-9]+\/[^/?#]+$/.test(href || ""), `alert row stays inside Pro (${href})`);
  await row.click();
  await page.waitForTimeout(800);
  let ui = await quiet(page);
  check(ui.pro && ui.hash.startsWith("#/owner/history/"), `tapping a row keeps Pro (${ui.hash})`);
  gate.mode = "err";
  await page.evaluate(() => window.dispatchEvent(new Event("ls-auth")));
  await page.waitForTimeout(700);
  ui = await quiet(page);
  check(ui.pro && ui.bundle && ui.hash.startsWith("#/owner"), `a failed is_pro() does not hide Pro (${ui.hash})`);
  gate.mode = "junk";
  await page.evaluate(() => window.dispatchEvent(new Event("ls-auth")));
  await page.waitForTimeout(500);
  ui = await quiet(page);
  check(ui.pro, "a non-boolean is_pro() body does not hide Pro");
  gate.mode = "no";
  await page.evaluate(() => window.dispatchEvent(new Event("ls-auth")));
  await page.waitForFunction(() => !document.querySelector("[data-pro-owner]") && (location.hash === "#/" || location.hash === ""), null, { timeout: 8000 });
  check(await page.locator("[data-pro-enhance], [data-pro-owner-nav]").count() === 0, "a definite false removes Pro");
  gate.mode = "pass";
  await page.evaluate(() => window.dispatchEvent(new Event("ls-auth")));
  await page.waitForSelector("[data-pro-owner-nav]", { timeout: 8000 });
  await page.goto(BASE + "#/g/nfl/401873026", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#pro-game-panel", { timeout: 15000 });
  const game = await page.locator("#pro-game-panel").innerText();
  check(/Sharp move/.test(game) && /Line history/.test(game) && /All books/.test(game) && /File age/.test(game), "game page shows Pro panels");
  check(/DraftKings/.test(game) && /21\+/.test(game), "game panel names a real book and keeps 21+");
  const pageText = await page.locator("body").innerText();
  check(/1-800-GAMBLER|1-833-PLAYWISE/.test(pageText), "state helpline stays on the game page");
  await page.goto(BASE + "#/bets", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#pro-bets-panel", { timeout: 15000 });
  const betsText = await page.locator("#pro-bets-panel").innerText();
  check(/closing line/i.test(betsText) && /prime/.test(betsText) && /Spread/.test(betsText), "My Bets shows CLV, tags, and splits");
  await page.goto(BASE + "props-fixture/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#pro-props-panel", { timeout: 15000 });
  const propsText = await page.locator("#pro-props-panel").innerText();
  check(/Hot props/.test(propsText) && /Price gaps/.test(propsText) && /Alex Sample/.test(propsText) && /Saved filters/.test(propsText), "props page shows hot filters");
  await page.evaluate(() => { localStorage.removeItem("ls-sb-auth"); window.dispatchEvent(new Event("ls-auth")); });
  await page.waitForFunction(() => !document.querySelector("[data-pro-owner-nav]") && !document.querySelector("[data-pro-enhance]"), null, { timeout: 8000 });
  check(true, "sign-out removes Pro panels and the nav link");
  check(!errors.filter(e => !/supabase|session/i.test(e)).length, `owner flow page errors ${errors.join(" | ")}`);
  await ctx.close();
}

await browser.close();
srv.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);
