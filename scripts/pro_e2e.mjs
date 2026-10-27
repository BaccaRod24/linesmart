// Browser test for the LineSmart Pro waitlist (#/pro) and its teasers, with Supabase mocked: no real sign-in, no
// database, no emails. Also writes screenshots (pro-*.png) to OUT.
// Usage: serve site/ (see subpath_test.mjs), then BASE=http://127.0.0.1:8841/linesmart/ OUT=screenshots node scripts/pro_e2e.mjs
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://127.0.0.1:8841/linesmart/";
const OUT = process.env.OUT || "screenshots";
const SB = "https://ctklbryattbbsqdmteny.supabase.co";
fs.mkdirSync(OUT, { recursive: true });
const fails = [], errors = [];
const check = (ok, msg, tag = "pro-e2e") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };

const UID = "4b1c2d3e-0000-4000-8000-00000000abcd", EMAIL = "user@example.com";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = () => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: UID, email: EMAIL, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })}.c2ln`;
const USER = { id: UID, aud: "authenticated", role: "authenticated", email: EMAIL, email_confirmed_at: "2026-10-26T22:00:00Z", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-26T22:00:00Z" };
const SESSION = () => ({ access_token: jwt(), refresh_token: "rt-x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });
const BETS = [
  { id: "t1", status: "won", type: "spread", book: "draftkings", stake: 10, odds: -110, league: "nfl", side: "home", line: -3.5, date: "2026-10-20", createdAt: "2026-10-20T18:00:00Z", settledAt: "2026-10-20", event: { id: "401873001", lg: "nfl", date: "2026-10-20T17:00Z", home: "PHI", away: "DAL" } },
  { id: "t2", status: "lost", type: "ml", book: "fanduel", stake: 10, odds: 120, league: "nba", side: "away", date: "2026-10-22", createdAt: "2026-10-22T18:00:00Z", settledAt: "2026-10-22", event: { id: "401909001", lg: "nba", date: "2026-10-22T23:00Z", home: "BOS", away: "NYK" } },
];

const calls = []; let reply = "ok", replyStatus = 200;
async function mock(ctx) {
  await ctx.route(/cloudflareinsights|ipdata\.info|the-odds-api/, r => r.abort());
  await ctx.route(SB + "/**", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-expose-headers": "*" };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: body === undefined ? "" : JSON.stringify(body) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ m, path: u.pathname, body, auth: req.headers()["authorization"] || "", apikey: req.headers()["apikey"] || "" });
    const p = u.pathname;
    if (p === "/auth/v1/user") return json(200, USER);
    if (p === "/auth/v1/token") return json(200, SESSION());
    if (p === "/rest/v1/user_bets" || p === "/rest/v1/line_alerts") return m === "GET" ? json(200, []) : json(201);
    if (p === "/rest/v1/rpc/pro_waitlist_join") return json(replyStatus, reply);
    return json(404, { message: "not mocked: " + m + " " + p });
  });
}
const browser = await chromium.launch();
async function page({ mobile = false, signedIn = false, state = "FL", bets = null, extra = {} } = {}) {
  const c = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
  await mock(c);
  await c.addInitScript(([s, st, sess, b, ex]) => { try {
    if (sessionStorage.getItem("seeded")) return;
    localStorage.setItem("ls-age-ok", new Date().toISOString()); localStorage.setItem("ls-state", st);
    if (s) localStorage.setItem("ls-sb-auth", JSON.stringify(sess));
    if (b) localStorage.setItem("ls-bets-v1", JSON.stringify({ v: 1, saved: "2026-10-26T23:00:00Z", bets: b }));
    for (const [k, v] of Object.entries(ex)) localStorage.setItem(k, v);
    sessionStorage.setItem("seeded", "1");
  } catch (e) {} }, [signedIn, state, SESSION(), bets, extra]);
  const p = await c.newPage();
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return p;
}
const text = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
const rpcCalls = () => calls.filter(c => c.path === "/rest/v1/rpc/pro_waitlist_join");
const BANNED = /\block(s)?\b|guarantee|can't lose|sure thing|free money|income|winning picks|expert picks/i;

// ---------- 1. desktop, signed out, Florida: page content, validation, payload
{
  const p = await page({});
  await p.goto(BASE + "#/pro?from=value", { waitUntil: "networkidle" }); await p.waitForSelector("#proForm");
  const all = await text(p, "#app");
  check(/LineSmart\s*Pro/i.test(await text(p, "#app h1")), "page title", "page");
  check(/Everything free today stays free/.test(all) && /What Pro adds/.test(all), "free vs Pro lists", "page");
  check(await p.$$eval(".pro-adds li", l => l.length) === 6, "6 Pro features listed", "page");
  const outsideSurvey = await p.$eval("#app", a => { const c = a.cloneNode(true); c.querySelectorAll("fieldset").forEach(f => f.remove()); return c.innerText; });
  check(/Founding members get a lower launch price/.test(all) && !/\$\d/.test(outsideSurvey), "launch-price line; dollar amounts only in the price survey question", "copy");
  check(!BANNED.test(all), "no guarantee / locks / income / picks claims", "copy");
  check(/data and software subscription/.test(all) && /Most bets lose/.test(all), "data/software framing, most bets lose", "copy");
  check(/21\+/.test(all) && /1-800-GAMBLER/.test(all), "21+ and 1-800-GAMBLER notice", "copy");
  check(await p.$$eval("#proForm input[name=features]", x => x.length) === 6 && await p.$$eval("#proForm input[name=sports]", x => x.map(i => i.value).join()) === "nfl,nba,mlb,nhl,ncaaf,ncaab,ufc" && await p.$$eval("#proForm input[name=price]", x => x.map(i => i.value).join()) === "4.99,9.99,14.99,more", "3-question survey: features, sports, price", "form");
  check(!(await p.$eval("#bnav", n => n.innerHTML)).includes("#/pro"), "no new bottom-nav item", "nav");
  await p.screenshot({ path: `${OUT}/pro-top-desktop.png` });
  await p.locator("#proForm").screenshot({ path: `${OUT}/pro-form-desktop.png` });
  await p.screenshot({ path: `${OUT}/pro-full-desktop.png`, fullPage: true });

  await p.fill("#proEmail", "fan@example.com");
  await p.click("#proForm button[type=submit]");
  await p.waitForTimeout(200);
  check(/21/.test(await text(p, "#proMsg")) && rpcCalls().length === 0, "21+ box required, nothing sent", "form");
  await p.fill("#proEmail", "nope"); await p.check("#proForm input[name=age]");
  await p.click("#proForm button[type=submit]"); await p.waitForTimeout(200);
  check(await p.$eval("#proEmail", e => e.getAttribute("aria-invalid")) === "true" && rpcCalls().length === 0, "bad email caught client-side", "form");
  await p.fill("#proEmail", " Fan@Example.com ");
  for (const v of ["props_ev", "line_history"]) await p.check(`#proForm input[name=features][value=${v}]`);
  for (const v of ["nfl", "nba"]) await p.check(`#proForm input[name=sports][value=${v}]`);
  await p.check(`#proForm input[name=price][value="9.99"]`);
  await p.click("#proForm button[type=submit]");
  await p.waitForFunction(() => /on the list|waitlist/i.test(document.querySelector("#proMsg").innerText) && document.querySelector("#proMsg").classList.contains("ok"));
  const c = rpcCalls().at(-1);
  check(c && JSON.stringify(c.body) === JSON.stringify({ p_email: "fan@example.com", p_is_21: true, p_features: ["props_ev", "line_history"], p_sports: ["nfl", "nba"], p_price: "9.99", p_state: "FL", p_source: "value", p_website: "" }), "payload: " + JSON.stringify(c && c.body), "payload");
  check(c && c.apikey.startsWith("sb_publishable_") && !c.auth, "signed out: publishable key, no Bearer token", "payload");
  check(!("p_user_id" in (c ? c.body : {})), "client never sends a user id", "payload");
  await p.locator("#proForm").screenshot({ path: `${OUT}/pro-form-done-desktop.png` });
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("ls-pro-v1") || "null"));
  check(saved && saved.email === "fan@example.com", "remembers it joined (ls-pro-v1)", "form");
  await p.context().close();
}
// ---------- 2. error replies map to friendly messages
{
  const p = await page({});
  await p.goto(BASE + "#/pro", { waitUntil: "networkidle" }); await p.waitForSelector("#proForm");
  for (const [st, r, re] of [[200, "rate_limited", /a lot of sign-ups|try again|later/i], [404, { message: "x" }, /soon|not open|isn't open/i]]) {
    replyStatus = st; reply = r;
    await p.reload({ waitUntil: "networkidle" }); await p.waitForSelector("#proForm");
    await p.fill("#proEmail", "fan2@example.com"); await p.check("#proForm input[name=age]");
    await p.click("#proForm button[type=submit]");
    await p.waitForFunction(() => document.querySelector("#proMsg").innerText.length > 0 && !document.querySelector("#proForm button[type=submit]").disabled);
    const m = await text(p, "#proMsg");
    check(re.test(m) && !/on the waitlist/.test(m), `${st} ${typeof r === "string" ? r : "missing"} -> "${m}"`, "errors");
  }
  replyStatus = 200; reply = "ok";
  await p.context().close();
}
// ---------- 3. signed in, mobile: email prefilled, Bearer token sent
{
  const p = await page({ mobile: true, signedIn: true, extra: { "ls-acct-email": EMAIL } });
  await p.goto(BASE + "#/pro", { waitUntil: "networkidle" }); await p.waitForSelector("#proForm");
  await p.waitForFunction(e => document.querySelector("#proEmail").value === e, EMAIL);
  check(true, "signed in: email prefilled", "signedin");
  await p.screenshot({ path: `${OUT}/pro-top-mobile.png` });
  await p.locator("#proForm").scrollIntoViewIfNeeded();
  await p.locator("#proForm").screenshot({ path: `${OUT}/pro-form-mobile.png` });
  await p.screenshot({ path: `${OUT}/pro-full-mobile.png`, fullPage: true });
  const ow = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(ow, "mobile: no horizontal overflow", "mobile");
  const fs16 = await p.$eval("#proEmail", e => parseFloat(getComputedStyle(e).fontSize));
  check(fs16 >= 16, `mobile: email input ${fs16}px (no iOS zoom)`, "mobile");
  await p.check("#proForm input[name=age]");
  await p.click("#proForm button[type=submit]");
  await p.waitForFunction(() => document.querySelector("#proMsg").classList.contains("ok"));
  const c = rpcCalls().at(-1);
  check(c && /^Bearer ey/.test(c.auth) && c.body.p_email === EMAIL && c.body.p_source === "pro", "signed in: Bearer token sent (server links the account), source pro", "signedin");
  await p.context().close();
}
// ---------- 4. teasers + footer link
{
  const p = await page({ bets: BETS });
  await p.goto(BASE + "#/value", { waitUntil: "networkidle" });
  await p.waitForSelector("[data-pro-tease=value]", { timeout: 15000 }).catch(() => {});
  const tv = p.locator("[data-pro-tease=value]");
  check(await tv.count() === 1 && /Coming soon/.test(await tv.innerText()) && (await tv.getAttribute("href")) === "#/pro?from=value", "Value page teaser", "teaser");
  if (await tv.count()) { await tv.scrollIntoViewIfNeeded(); await p.waitForTimeout(200); await tv.screenshot({ path: `${OUT}/pro-teaser-value-desktop.png` }); await p.screenshot({ path: `${OUT}/pro-teaser-value-page-desktop.png` }); }
  await p.goto(BASE + "#/bets", { waitUntil: "networkidle" }); await p.waitForTimeout(600);
  check(await p.locator("[data-pro-tease=bets]").count() === 1, "My Bets stats teaser", "teaser");
  await p.goto(BASE + "#/account", { waitUntil: "networkidle" }); await p.waitForTimeout(600);
  check(await p.locator("[data-pro-tease=alerts]").count() === 1, "alerts settings teaser (signed out account page)", "teaser");
  const fl = p.locator('#siteFooter a[href="./#/pro"]');
  check(await fl.count() === 1 && /Pro/.test(await fl.innerText()), "footer link", "footer");
  await fl.click(); await p.waitForSelector("#proForm");
  check(/#\/pro/.test(p.url()), "footer link opens the Pro page", "footer");
  await p.context().close();
}
{
  const p = await page({ signedIn: true, mobile: true });
  await p.goto(BASE + "#/account", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  const t = p.locator("[data-pro-tease=alerts]");
  check(await t.count() === 1, "alerts settings teaser (signed in)", "teaser");
  await p.goto(BASE + "#/value", { waitUntil: "networkidle" });
  await p.waitForSelector("[data-pro-tease=value]", { timeout: 15000 }).catch(() => {});
  const tv = p.locator("[data-pro-tease=value]");
  if (await tv.count()) { await tv.scrollIntoViewIfNeeded(); await p.waitForTimeout(200); await tv.screenshot({ path: `${OUT}/pro-teaser-value-mobile.png` }); }
  await p.context().close();
}
await browser.close();
check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""), "errors");
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);
