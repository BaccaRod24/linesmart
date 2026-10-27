// Browser test for the Account tab (email code + magic-link sign-in, bet sync, sign out, delete) with Supabase mocked
// (no real emails or network). Also writes screenshots/acct-*.png.
// Usage: serve site/ with data (see subpath_test.mjs), then BASE=http://localhost:8796/ OUT=screenshots node scripts/account_e2e.mjs
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8799/linesmart/";
const OUT = process.env.OUT || "screenshots";
const SB = "https://ctklbryattbbsqdmteny.supabase.co";
fs.mkdirSync(OUT, { recursive: true });
const fails = [], errors = [];
const check = (ok, msg, tag = "acct-e2e") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };

// ---------- fake Supabase (auth + PostgREST for user_bets), shared by every browser context = "the cloud"
const UID = "4b1c2d3e-0000-4000-8000-00000000abcd", EMAIL = "user@example.com";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = () => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: UID, email: EMAIL, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })}.c2ln`;
const USER = { id: UID, aud: "authenticated", role: "authenticated", email: EMAIL, email_confirmed_at: "2026-10-26T22:00:00Z", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-26T22:00:00Z" };
const session = () => ({ access_token: jwt(), refresh_token: "rt-" + Math.random().toString(36).slice(2), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });
const CLOUD = new Map();           // id -> row
const calls = [];
let otpMode = "ok";                // "429" | "ok"
async function mockSupabase(ctx) {
  await ctx.route(SB + "/**", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-expose-headers": "*" };
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: body === undefined ? "" : JSON.stringify(body) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ m, path: u.pathname, q: u.search, body, auth: req.headers()["authorization"] || "", apikey: req.headers()["apikey"] || "" });
    const p = u.pathname;
    if (p === "/auth/v1/otp") {
      if (otpMode === "429") { otpMode = "ok"; return json(429, { code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" }); }
      return json(200, {});
    }
    if (p === "/auth/v1/verify") return body && body.token === "48213907" ? json(200, session()) : json(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
    if (p === "/auth/v1/user") return json(200, USER);
    if (p === "/auth/v1/token") return u.searchParams.get("grant_type") === "pkce" && !(body && body.code_verifier) ? json(400, { code: 400, error_code: "validation_failed", msg: "invalid request: both auth code and code verifier should be non-empty" }) : json(200, session());
    if (p === "/auth/v1/logout") return route.fulfill({ status: 204, headers: cors });
    if (p === "/rest/v1/user_bets") {
      if (!/^Bearer ey/.test(calls.at(-1).auth)) return json(401, { message: "JWT expected" });
      if (m === "GET") return json(200, [...CLOUD.values()].map(({ id, bet, deleted, updated_at }) => ({ id, bet, deleted, updated_at })));
      if (m === "POST") { for (const r of [].concat(body)) CLOUD.set(r.id, { ...r }); return json(201); }
      if (m === "DELETE") { if (u.searchParams.get("user_id") === "eq." + UID) CLOUD.clear(); return json(204); }
    }
    return json(404, { message: "not mocked: " + m + " " + p });
  });
}

const browser = await chromium.launch();
const vendorLoads = [];
async function ctx(bets = null, mobile = true) {
  const c = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
  await mockSupabase(c);
  await c.addInitScript(b => { try {
    localStorage.setItem("ls-age-ok", new Date().toISOString()); localStorage.setItem("ls-state", "FL");
    if (b && !sessionStorage.getItem("seeded")) { localStorage.setItem("ls-bets-v1", JSON.stringify({ v: 1, bets: b })); sessionStorage.setItem("seeded", "1"); }
  } catch (e) {} }, bets);
  const p = await c.newPage();
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  p.on("request", r => { if (/vendor\/supabase-js/.test(r.url())) vendorLoads.push(p); });
  p.on("dialog", d => d.accept());
  return p;
}
const shot = async (p, name, full = true) => { await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(500); if (full) await p.addStyleTag({ content: ".bnav{display:none!important}" }); await p.screenshot({ path: `${OUT}/${name}`, fullPage: full }); console.log("shot", name); };
const localBets = p => p.evaluate(() => (JSON.parse(localStorage.getItem("ls-bets-v1") || "{}").bets || []));
const text = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");

const SEED = [
  { id: "seed-bills", type: "ml", sel: "Buffalo Bills", odds: -120, stake: 50, status: "pending", date: "2026-10-26", league: "nfl", book: "hardrock", homeTeam: "Buffalo Bills", awayTeam: "Miami Dolphins", createdAt: "2026-10-20T15:00:00Z", review: { reason: "Check the final score." } },
  { id: "seed-heat", type: "spread", sel: "Miami Heat", line: 4.5, odds: -110, stake: 25, status: "won", date: "2026-10-24", league: "nba", book: "hardrock", homeTeam: "Miami Heat", awayTeam: "Boston Celtics", createdAt: "2026-10-23T15:00:00Z" },
];

// ---------- 0. signed-out visitors never download the Supabase library on normal pages
{
  const p = await ctx(SEED);
  await p.goto(BASE + "#/", { waitUntil: "networkidle" }); await p.waitForSelector("#bnav [data-nav=account]");
  await p.goto(BASE + "#/bets", { waitUntil: "networkidle" }); await p.waitForTimeout(500);
  check(!vendorLoads.includes(p), "home + My Bets (signed out): supabase-js not loaded", "lazy");
  check(calls.length === 0, "signed out: no Supabase requests", "lazy");
  check(await p.$eval("#bnav [data-nav=account]", e => e.getAttribute("href")) === "#/account", "Account item in the mobile bottom nav", "nav");
  const migrated = await localBets(p);
  check(migrated.every(b => b.id && b.updatedAt), "existing bets migrated: stable id + updatedAt", "migrate");
  await p.context().close();
}

// ---------- 1. email code sign-in on a phone (first sign-in uploads existing bets)
let phone;
{
  const p = phone = await ctx(SEED);
  await p.goto(BASE + "#/account", { waitUntil: "networkidle" }); await p.waitForSelector("#acEmail");
  check(vendorLoads.includes(p), "Account tab lazy-loads the vendored supabase-js", "lazy");
  check(await p.$eval("#bnav [data-nav=account]", e => e.classList.contains("on")), "Account nav item highlighted", "nav");
  check(/2 bets already on this device/.test(await text(p, "#app")), "signed out: says the bets here will be added on sign-in", "ui");
  await shot(p, "acct-signed-out.png", false);
  await p.fill("#acEmail", "not-an-email"); await p.click("#acEmailForm button[type=submit]");
  check(/valid email/.test(await text(p, ".ac-err")) && !calls.some(c => c.path === "/auth/v1/otp"), "invalid email caught before sending", "ui");
  otpMode = "429";
  await p.fill("#acEmail", EMAIL); await p.click("#acEmailForm button[type=submit]");
  await p.waitForSelector(".ac-err");
  check(/too many requests, try again later/i.test(await text(p, ".ac-err")), "429 rate limit shows 'Too many requests, try again later'", "errors");
  check(await p.$eval(".ac-err", e => e.getAttribute("role")) === "alert", "error is announced (role=alert)", "a11y");
  await p.click("#acEmailForm button[type=submit]");
  await p.waitForSelector("#acCode");
  const otp = calls.filter(c => c.path === "/auth/v1/otp").at(-1);
  check(otp && otp.body.email === EMAIL && otp.body.create_user === true, "signInWithOtp sent with shouldCreateUser", "auth");
  const redirect = otp && new URL(otp.q, "http://x").searchParams.get("redirect_to");
  check(redirect === new URL(BASE).origin + new URL(BASE).pathname + "#/account", `emailRedirectTo = origin + path + #/account (${redirect})`, "auth");
  check(otp && otp.apikey.startsWith("sb_publishable_"), "requests use the publishable key", "auth");
  check(/We emailed you a sign-in code \(or link\)/.test(await text(p, "#app")), "copy: 'We emailed you a sign-in code (or link)'", "ui");
  const code = await p.$eval("#acCode", e => ({ im: e.inputMode, ac: e.autocomplete }));
  check(code.im === "numeric" && code.ac === "one-time-code", "code field: numeric keypad + one-time-code autofill", "ui");
  check(/Resend in \d+s/.test(await text(p, "#acResend")) && await p.$eval("#acResend", e => e.disabled), "resend has a cooldown", "ui");
  await p.fill("#acCode", "12345"); await p.click("#acCodeForm button[type=submit]");
  check(/6 to 10 digits/.test(await text(p, ".ac-err")), "too-short code rejected locally", "ui");
  await p.fill("#acCode", "11112222"); await p.click("#acCodeForm button[type=submit]");
  await p.waitForFunction(() => /wrong or has expired/.test(document.querySelector(".ac-err")?.innerText || ""));
  check(true, "wrong 8-digit code -> 'wrong or has expired'", "errors");
  await p.fill("#acCode", "48213907");
  check(!(await p.$(".ac-err")), "typing a new code clears the old error", "ui");
  await shot(p, "acct-code.png", false);
  await p.click("#acCodeForm button[type=submit]");
  await p.waitForFunction(() => /Synced/.test(document.querySelector(".ac-sync")?.innerText || ""), null, { timeout: 15000 });
  const v = calls.filter(c => c.path === "/auth/v1/verify").at(-1);
  check(v && v.body.type === "email" && v.body.token === "48213907", "verifyOtp({type:'email'}) with the 8-digit code", "auth");
  check(CLOUD.size === 2 && CLOUD.get("seed-bills").bet.sel === "Buffalo Bills" && CLOUD.get("seed-bills").user_id === UID, "first sign-in uploaded the 2 existing bets with user_id", "sync");
  check(calls.some(c => c.m === "POST" && c.path === "/rest/v1/user_bets" && /on_conflict=user_id%2Cid|on_conflict=user_id,id/.test(c.q)), "upsert uses on_conflict=user_id,id", "sync");
  check((await text(p, ".ac-email")) === EMAIL && /last synced .* ET/.test(await text(p, ".ac-sync")), "signed in: email + last synced (ET) shown", "ui");
  // another device added a bet -> Sync now pulls it
  CLOUD.set("other-1", { id: "other-1", bet: { id: "other-1", type: "total", sel: "Over", line: 47.5, odds: -105, stake: 20, status: "pending", date: "2026-10-27", league: "nfl", book: "hardrock", homeTeam: "Kansas City Chiefs", awayTeam: "Denver Broncos", createdAt: "2026-10-26T20:00:00Z", updatedAt: "2026-10-26T20:00:00Z" }, deleted: false, updated_at: "2026-10-26T20:00:00Z", user_id: UID });
  await p.click("#acSync");
  await p.waitForFunction(() => /3 bets in your account/.test(document.querySelector(".ac-sync")?.innerText || ""), null, { timeout: 10000 });
  check((await localBets(p)).some(b => b.id === "other-1"), "Sync now pulls a bet added on another device", "sync");
  await shot(p, "acct-signed-in.png", false);
  // delete a bet in My Bets -> soft delete synced (debounced)
  await p.goto(BASE + "#/bets/list", { waitUntil: "networkidle" }); await p.waitForSelector('[data-del="seed-heat"]');
  check(/synced to your account/.test(await text(p, "#app")), "My Bets says it's synced when signed in", "ui");
  await p.click('[data-del="seed-heat"]');
  await p.waitForFunction(() => !JSON.parse(localStorage.getItem("ls-bets-tomb-v1") || "{}")["seed-heat"], null, { timeout: 10000 });
  check(CLOUD.get("seed-heat").deleted === true && !CLOUD.get("seed-heat").bet.sel, "delete synced as soft-delete (deleted=true, id only)", "sync");
  // settle a bet -> pushed with a newer updated_at
  const before = CLOUD.get("seed-bills").updated_at;
  await p.click('[data-quick="won"][data-id="seed-bills"]');
  await p.waitForTimeout(4000);
  check(CLOUD.get("seed-bills").bet.status !== "pending" && CLOUD.get("seed-bills").updated_at > before, "settling a bet syncs it (debounced) with a newer updated_at", "sync");
}

// ---------- 2. magic link on a second device (empty): lands back with tokens, finishes sign-in, downloads bets
{
  const p = await ctx(null);
  await p.goto(BASE + "#/account#access_token=" + jwt() + "&expires_at=" + (Math.floor(Date.now() / 1000) + 3600) + "&expires_in=3600&refresh_token=rt-link&token_type=bearer&type=magiclink", { waitUntil: "networkidle" });
  await p.waitForFunction(() => /Synced/.test(document.querySelector(".ac-sync")?.innerText || ""), null, { timeout: 15000 });
  check(new URL(p.url()).hash === "#/account" && !/access_token/.test(p.url()), "magic-link tokens removed from the URL, Account tab shown", "link");
  const lb = await localBets(p);
  check(lb.length === 2 && lb.some(b => b.id === "other-1") && !lb.some(b => b.id === "seed-heat"), "second device gets the synced bets (deleted one excluded)", "link");
  check((await text(p, ".ac-email")) === EMAIL, "second device shows signed in", "link");
  // reload: session persists, sync on load
  const n0 = calls.length;
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(2500);
  check(calls.slice(n0).some(c => c.m === "GET" && c.path === "/rest/v1/user_bets"), "signed-in device syncs on app load", "sync");
  await p.context().close();
}
// expired link -> friendly error, still signed out
{
  const p = await ctx(null);
  await p.goto(BASE + "#/account#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", { waitUntil: "networkidle" });
  await p.waitForSelector(".ac-err");
  check(/expired or was already used/.test(await text(p, ".ac-err")) && await p.$("#acEmail"), "expired magic link -> clear error + email form", "link");
  check(!/error_code/.test(p.url()), "error params removed from the URL", "link");
  await p.context().close();
}
// PKCE ?code= landing without a verifier on this browser -> explains, no crash
{
  const p = await ctx(null);
  await p.goto(BASE + "?code=abc123#/account", { waitUntil: "networkidle" });
  await p.waitForSelector(".ac-err", { timeout: 10000 });
  check(/same browser|code from the email/.test(await text(p, ".ac-err")) && !/code=/.test(p.url()), "?code= without a verifier -> explains to use the code; URL cleaned", "link");
  await p.context().close();
}

// ---------- 3. desktop view (topbar Account button), then sign out keeps the local copy
{
  const p = await ctx(null, false);
  await p.goto(BASE + "#/account#access_token=" + jwt() + "&refresh_token=rt-d&expires_in=3600&token_type=bearer&type=magiclink", { waitUntil: "networkidle" });
  await p.waitForFunction(() => /Synced/.test(document.querySelector(".ac-sync")?.innerText || ""), null, { timeout: 15000 });
  check(await p.$eval("#acctBtn", e => e.classList.contains("on") && getComputedStyle(e).display !== "none"), "desktop: Account button in the top bar, highlighted", "nav");
  await shot(p, "acct-desktop.png", false);
  await p.context().close();
}
{
  const p = phone;
  await p.goto(BASE + "#/account", { waitUntil: "networkidle" }); await p.waitForSelector("#acOut");
  await p.click("#acOut"); await p.waitForSelector("#acEmail");
  check(/still saved on this device/.test(await text(p, ".ac-info")), "sign out: note that bets stay on this device", "signout");
  check((await localBets(p)).length === 2 && !(await p.evaluate(() => localStorage.getItem("ls-sb-auth"))), "sign out keeps local bets, clears the session", "signout");
  check(calls.some(c => c.path === "/auth/v1/logout" && /scope=local/.test(c.q)), "sign out is local-scope (other devices stay signed in)", "signout");
  // sign back in, then Delete my account and bets
  await p.fill("#acEmail", EMAIL); await p.click("#acEmailForm button[type=submit]"); await p.waitForSelector("#acCode");
  await p.fill("#acCode", "4821 3907"); await p.click("#acCodeForm button[type=submit]");
  await p.waitForSelector("#acDel", { timeout: 10000 }); await p.waitForTimeout(1500);
  check(CLOUD.size > 0, "cloud has rows before delete", "delete");
  await p.click("#acDel"); await p.waitForSelector("#acEmail", { timeout: 10000 });
  check(CLOUD.size === 0 && calls.some(c => c.m === "DELETE" && c.path === "/rest/v1/user_bets" && c.q.includes("user_id=eq." + UID)), "Delete my account and bets removes all user_bets rows", "delete");
  check(/contact@linesmart\.app/.test(await text(p, ".ac-info")) && (await localBets(p)).length === 2, "after delete: signed out, local bets kept, email route for full deletion explained", "delete");
  await p.context().close();
}

// ---------- 4. privacy page section
{
  const p = await ctx(null);
  await p.goto(BASE + "privacy.html#accounts", { waitUntil: "networkidle" });
  const t = await text(p, "main") || await text(p, "body");
  check(/Supabase/.test(t) && /United States/.test(t) && /email address/.test(t) && /never sell/i.test(t) && /contact@linesmart\.app/.test(t) && /sign-in code/.test(t), "privacy: Supabase (US), email + bets, never sell, delete by email", "privacy");
  check(/Delete my account and bets/.test(t), "privacy: Delete my account and bets", "privacy");
  check(!/Rod|Baccar/i.test(t), "privacy: business-only wording (no personal name)", "privacy");
  const h = await p.$eval("#accounts", e => e.getBoundingClientRect().top + scrollY);
  await p.evaluate(y => scrollTo(0, y - 70), h); await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/acct-privacy.png` }); console.log("shot acct-privacy.png");
  await p.context().close();
}

await browser.close();
check(!calls.some(c => /sb_secret|service_role/.test(c.apikey + c.auth)), "never sent a secret key", "config");
check(errors.length === 0, "no JS errors" + (errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""), "errors");
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join("\n- ")}` : "\nall account e2e checks passed");
process.exit(fails.length ? 1 : 0);
