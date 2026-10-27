// Browser test for line alerts (bell on game cards / game page / prop rows, the alert sheet, the Account list) with
// Supabase mocked: no real sign-in, no database, no emails. Also writes screenshots/alert-*.png.
// Usage: serve site/ with data (see subpath_test.mjs), then BASE=http://127.0.0.1:8841/linesmart/ OUT=screenshots node scripts/alerts_e2e.mjs
// Needs a pre-game NFL game with odds + props in the served data (GAME=lg/id to pick one; default: first NFL pre-game with props).
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://127.0.0.1:8841/linesmart/";
const OUT = process.env.OUT || "screenshots";
const SB = "https://ctklbryattbbsqdmteny.supabase.co";
fs.mkdirSync(OUT, { recursive: true });
const fails = [], errors = [];
const check = (ok, msg, tag = "alerts-e2e") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };

const UID = "4b1c2d3e-0000-4000-8000-00000000abcd", EMAIL = "user@example.com";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = () => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: UID, email: EMAIL, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })}.c2ln`;
const USER = { id: UID, aud: "authenticated", role: "authenticated", email: EMAIL, email_confirmed_at: "2026-10-26T22:00:00Z", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-26T22:00:00Z" };
const SESSION = () => ({ access_token: jwt(), refresh_token: "rt-x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });

// ---------- pick a game from the served data
const getJ = async p => (await fetch(BASE + p)).json();
let LG = "nfl", GID = null, G = null;
{
  const idx = await getJ("data/nfl/index.json"), pr = await getJ("data/props/nfl.json").catch(() => ({ games: {} }));
  const pre = idx.games.filter(g => g.state === "pre" && g.books && Date.parse(g.date) > Date.now() + 3600e3);
  G = process.env.GAME ? idx.games.find(g => g.id === process.env.GAME.split("/")[1]) : pre.find(g => pr.games[g.id] && (pr.games[g.id].props || []).length) || pre[0];
  if (!G) { console.log("SKIP: no pre-game NFL game with odds in the served data"); process.exit(0); }
  GID = G.id;
}
const starts = new Date(Date.parse(G.date)).toISOString();

// ---------- fake Supabase: auth + PostgREST for user_bets (empty) and line_alerts (RLS-like: own rows)
const ALERTS = new Map(); const calls = []; let n = 0; let insertErr = null;
const seed = () => {
  ALERTS.clear();
  const base = { user_id: UID, league: LG, game_id: GID, starts_at: starts, game_label: `${G.away.abbr} @ ${G.home.abbr}`, created_at: "2026-10-26T20:00:00Z" };
  ALERTS.set("a-1", { ...base, id: "a-1", kind: "total_move", books: ["hardrockbet"], points: 1.5, baseline: { hardrockbet: 47.5 }, status: "active" });
  ALERTS.set("a-2", { ...base, id: "a-2", kind: "ml_target", side: "home", side_label: G.home.abbr, books: ["hardrockbet"], target: -150, baseline: { hardrockbet: -185 }, status: "fired", fired_at: "2026-10-26T23:31:00Z", fired_book: "hardrockbet", fired_value: -148, created_at: "2026-10-25T20:00:00Z" });
  ALERTS.set("a-3", { ...base, id: "a-3", game_id: "401873000", game_label: "MIA @ NE", starts_at: "2026-10-26T17:00:00Z", kind: "spread_move", side: "away", side_label: "MIA", books: ["hardrockbet"], points: 1, baseline: { hardrockbet: 6.5 }, status: "expired", created_at: "2026-10-24T20:00:00Z" });
};
async function mock(ctx) {
  await ctx.route(SB + "/**", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-expose-headers": "*" };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: body === undefined ? "" : JSON.stringify(body) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ m, path: u.pathname, q: u.search, body, auth: req.headers()["authorization"] || "" });
    const p = u.pathname;
    if (p === "/auth/v1/user") return json(200, USER);
    if (p === "/auth/v1/token") return json(200, SESSION());
    if (p === "/auth/v1/logout") return route.fulfill({ status: 204, headers: cors });
    if (p === "/rest/v1/user_bets") return m === "GET" ? json(200, []) : json(201);
    if (p === "/rest/v1/line_alerts") {
      if (!/^Bearer ey/.test(calls.at(-1).auth)) return json(401, { message: "JWT expected" });
      if (m === "GET") return json(200, [...ALERTS.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)));
      if (m === "POST") {
        if (insertErr) return json(400, insertErr);
        for (const r of [].concat(body)) { const id = "new-" + (++n); ALERTS.set(id, { ...r, id, user_id: UID, status: "active", created_at: new Date().toISOString() }); }
        return json(201);
      }
      if (m === "DELETE") {
        const id = u.searchParams.get("id"), uid = u.searchParams.get("user_id");
        if (id) ALERTS.delete(id.replace(/^eq\./, "")); else if (uid === "eq." + UID) ALERTS.clear();
        return json(204);
      }
    }
    return json(404, { message: "not mocked: " + m + " " + p });
  });
}
const browser = await chromium.launch();
async function page({ mobile = false, signedIn = true, state = "FL" } = {}) {
  const c = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
  await mock(c);
  await c.addInitScript(([s, st, sess]) => { try {
    localStorage.setItem("ls-age-ok", new Date().toISOString()); localStorage.setItem("ls-state", st);
    if (s && !sessionStorage.getItem("seeded")) { localStorage.setItem("ls-sb-auth", JSON.stringify(sess)); sessionStorage.setItem("seeded", "1"); }
  } catch (e) {} }, [signedIn, state, SESSION()]);
  const p = await c.newPage();
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  p.on("dialog", d => d.accept());
  return p;
}
const text = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
const shotDlg = async (p, name) => { await p.waitForTimeout(400); await p.locator("#alDlg").screenshot({ path: `${OUT}/${name}` }); };
const lastPost = () => calls.filter(c => c.m === "POST" && c.path === "/rest/v1/line_alerts").at(-1);
const BANNED = /\block\b|guarantee|can't lose|can.t lose|free money|promo code/i;

// ---------- 1. signed out: bells on game cards, sheet asks to sign in, nothing sent
{
  seed();
  const p = await page({ signedIn: false });
  await p.goto(BASE + "#/nfl", { waitUntil: "networkidle" }); await p.waitForSelector(".game");
  const tiles = await p.$$eval(".gwrap", w => w.map(x => ({ a: !!x.querySelector(":scope > a.game"), b: !!x.querySelector(":scope > button.al-bell"), nested: !!x.querySelector("a.game button") })));
  check(tiles.length > 0 && tiles.every(t => t.a && t.b && !t.nested), `game cards: ${tiles.length} bells, each a sibling of the card link (no button inside <a>)`, "tiles");
  check(await p.$$eval(".game", gs => gs.filter(g => g.closest(".gwrap")).every(g => !/is-live/.test(g.className))), "bells only on pre-game cards", "tiles");
  await p.click(`.gwrap button[data-al="nfl/${GID}"]`);
  await p.waitForSelector("#alDlg[open]");
  check(/Sign in to get an email/.test(await text(p, "#alDlg")), "signed out: sheet asks to sign in", "signedout");
  check(p.url().includes("#/nfl"), "clicking the bell doesn't open the game page", "tiles");
  check(!calls.some(c => c.path.startsWith("/rest/")), "signed out: no database requests", "signedout");
  await p.click("#alDlg a[href='#/account']");
  await p.waitForTimeout(300);
  check(/#\/account/.test(p.url()), "Sign in button goes to Account", "signedout");
  await p.context().close();
}

// ---------- 2. Florida, desktop: game page bell -> Hard Rock Bet only; target alert; insert body is clean
{
  seed();
  const p = await page({ state: "FL" });
  await p.goto(BASE + `#/g/nfl/${GID}`, { waitUntil: "networkidle" });
  await p.waitForSelector(".section-title .al-txt");
  await p.click(".section-title .al-txt");
  await p.waitForSelector("#alDlg .al-bks");
  const bks = await p.$$eval("#alDlg input[name=bk]", xs => xs.map(x => x.value));
  check(bks.join() === "hardrockbet", `FL: only Hard Rock Bet offered (${bks.join()})`, "geo");
  check(/only Hard Rock Bet runs a legal online sportsbook/.test(await text(p, "#alDlg")), "FL: note explains why", "geo");
  await p.click('#alDlg [data-k="spread_target"]');
  await p.click(`#alDlg [data-s="home"]`);
  const hr = G.books.hardrockbet || {};
  const tgt = (hr.homeSpread ?? -3.5) + 1;
  await p.fill("#alN", String(tgt)); await p.press("#alN", "Tab");
  await p.waitForTimeout(200);
  const prev = await text(p, "#alDlg .al-prev");
  check(new RegExp(`${G.home.abbr} spread reaches`).test(prev) && /Hard Rock Bet/.test(prev), `preview: ${prev.split("\n")[0]}`, "sheet");
  check(!BANNED.test(await text(p, "#alDlg")) && /1-800-GAMBLER/.test(await text(p, "#alDlg")), "sheet: 21+ / 1-800-GAMBLER, no banned words", "sheet");
  await shotDlg(p, "alert-sheet-desktop.png");
  await p.screenshot({ path: `${OUT}/alert-sheet-desktop-page.png` });
  await p.click('#alDlg button[type=submit]');
  await p.waitForSelector("#alDlg h3:has-text('Alert set')");
  const b = lastPost().body;
  check(b && b.kind === "spread_target" && b.side === "home" && b.target === tgt && b.books.join() === "hardrockbet" && b.game_id === GID && b.league === "nfl", "insert: kind/side/target/books/game", "insert");
  check(b && !("user_id" in b) && !("status" in b) && !("fired_at" in b) && !("id" in b), "insert: no user_id/status/fired/id (the database sets those)", "insert");
  check(b && b.starts_at === starts && typeof b.baseline === "object" && b.baseline.hardrockbet === hr.homeSpread, "insert: starts_at = kickoff, baseline = current line", "insert");
  check(/user@example\.com/.test(await text(p, "#alDlg")), "confirmation names the email it goes to", "insert");
  await p.click("#alDlg [data-x].bt-add");
  // already-met target is refused before sending
  await p.click(".section-title .al-txt"); await p.waitForSelector("#alDlg .al-bks");
  await p.click('#alDlg [data-k="spread_target"]'); await p.click(`#alDlg [data-s="home"]`);
  await p.fill("#alN", String((hr.homeSpread ?? -3.5) - 1)); await p.press("#alN", "Tab"); await p.waitForTimeout(200);
  check(/already there/.test(await text(p, "#alDlg .al-prev")) && await p.$eval('#alDlg button[type=submit]', x => x.disabled), "target already reached: refused, Set alert disabled", "sheet");
  // cap error from the database is explained
  insertErr = { code: "P0001", message: "alert_limit" };
  await p.click('#alDlg [data-k="total_move"]'); await p.waitForTimeout(150);
  await p.click('#alDlg button[type=submit]'); await p.waitForTimeout(500);
  check(/already have 10 active alerts/.test(await text(p, "#alDlg")), "10-alert cap from the database shown in plain words", "cap");
  insertErr = null;
  await p.keyboard.press("Escape");
  await p.context().close();
}

// ---------- 3. Other state (NJ): all three books, desktop sheet screenshot with every book
{
  const p = await page({ state: "NJ" });
  await p.goto(BASE + `#/g/nfl/${GID}`, { waitUntil: "networkidle" });
  await p.click(".section-title .al-txt"); await p.waitForSelector("#alDlg .al-bks");
  const bks = await p.$$eval("#alDlg input[name=bk]:checked", xs => xs.map(x => x.value));
  check(bks.length === 3, `NJ: Hard Rock Bet, DraftKings, FanDuel offered (${bks.join()})`, "geo");
  await p.uncheck('#alDlg input[value=fanduel]'); await p.waitForTimeout(150);
  check(/at Hard Rock Bet or DraftKings/.test(await text(p, "#alDlg .al-prev")), "unticking a book updates the preview", "sheet");
  await shotDlg(p, "alert-sheet-nj-desktop.png");
  await p.keyboard.press("Escape");
  // prop row bell (NJ: DraftKings-only props count too)
  const pb = await p.waitForSelector(".pp-al", { timeout: 8000 }).catch(() => null);
  if (pb) {
    await pb.scrollIntoViewIfNeeded(); await pb.click();
    await p.waitForSelector("#alDlg .al-bks");
    const t = await text(p, "#alDlg");
    check(/Email me when the line moves/.test(t) && !/data-k/.test(await p.innerHTML("#alDlg")), "prop sheet: line-move alert", "props");
    await p.click('#alDlg button[type=submit]'); await p.waitForSelector("#alDlg h3:has-text('Alert set')");
    const pbody = lastPost().body;
    check(pbody.kind === "prop_move" && pbody.player_id && pbody.prop_market && pbody.side_label && pbody.prop_label && pbody.points === 1, `prop insert: ${pbody.side_label} ${pbody.prop_label}`, "props");
    await p.keyboard.press("Escape");
  } else check(false, "prop rows have a bell", "props");
  await p.context().close();
}

// ---------- 4. Account list: desktop + mobile, delete one, delete all
for (const mobile of [false, true]) {
  seed();
  const p = await page({ mobile });
  await p.goto(BASE + "#/account", { waitUntil: "networkidle" });
  await p.waitForSelector(".al-list");
  const t = await text(p, "#acAlerts");
  check(/1 of 10 active/.test(t) && /Active/.test(t) && /Sent/.test(t) && /Expired at start/.test(t), `${mobile ? "mobile" : "desktop"} account: list with status + count`, "account");
  check(/Total moves 1\.5 pts at Hard Rock Bet/.test(t) && /moneyline reaches -150 or better/.test(t), "account: plain-English rows", "account");
  await p.evaluate(() => document.querySelector("#acAlerts").scrollIntoView());
  await p.waitForTimeout(300);
  await p.locator("#acAlerts").screenshot({ path: `${OUT}/alert-account-${mobile ? "mobile" : "desktop"}.png` });
  if (mobile) {
    // a mobile sheet as well
    await p.goto(BASE + `#/g/nfl/${GID}`, { waitUntil: "networkidle" });
    await p.click(".section-title .al-txt"); await p.waitForSelector("#alDlg .al-bks");
    await p.click('#alDlg [data-k="ml_target"]'); await p.click(`#alDlg [data-s="away"]`); await p.waitForTimeout(200);
    await p.screenshot({ path: `${OUT}/alert-sheet-mobile.png` });
    await p.keyboard.press("Escape");
    await p.goto(BASE + "#/account", { waitUntil: "networkidle" }); await p.waitForSelector(".al-list");
  }
  await p.click('[data-al-del="a-1"]'); await p.waitForTimeout(400);
  check(calls.some(c => c.m === "DELETE" && c.path === "/rest/v1/line_alerts" && /id=eq\.a-1/.test(c.q)) && !ALERTS.has("a-1") && !/Total moves 1\.5/.test(await text(p, "#acAlerts")), "delete one alert", "account");
  await p.click("[data-al-delall]"); await p.waitForTimeout(400);
  check(ALERTS.size === 0 && /No alerts yet/.test(await text(p, "#acAlerts")), "delete all alerts", "account");
  await p.context().close();
}

// ---------- 5. a mobile game list with bells
{
  const p = await page({ mobile: true });
  await p.goto(BASE + "#/nfl", { waitUntil: "networkidle" }); await p.waitForSelector(".gwrap");
  await p.evaluate(() => document.querySelector(".gwrap").scrollIntoView({ block: "center" })); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/alert-bells-mobile.png` });
  const w = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check(w, "mobile: no horizontal scroll with bells", "layout");
  await p.context().close();
}

await browser.close();
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`, "errors");
console.log(fails.length ? `\n${fails.length} FAIL` : "\nall alerts e2e checks passed");
process.exit(fails.length ? 1 : 0);
