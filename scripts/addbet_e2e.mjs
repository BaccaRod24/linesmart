// Browser test for the Result field on the add-bet form (#/bets/add): single + parlay results, per-leg W/L/P,
// cash-out, re-opening, the finished-game lookup (ESPN scoreboard answered from scripts/fixtures/live/sb_nba.json),
// and that the bet list / overview count a form-settled bet straight away. Clock pinned to Oct 27 2026 noon ET.
// No network for ESPN, the Odds API is blocked, and bets live only in this throwaway browser's localStorage.
// Usage: python3 -m http.server 8845 -d site &   BASE=http://localhost:8845/ node scripts/addbet_e2e.mjs
//        DATA_DIR=/path/to/data serves data/* from there; SHOTS=/dir saves desktop 1366x900 + mobile 390x844 shots.
import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import path from "path";
const BASE = process.env.BASE || "http://localhost:8845/";
const SHOTS = process.env.SHOTS || "", DATA_DIR = process.env.DATA_DIR || "";
const NOW = "2026-10-27T16:00:00.000Z", TODAY = "2026-10-27", PLACED = "2026-10-24";
const fx = n => readFileSync(new URL(`./fixtures/live/${n}.json`, import.meta.url));
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} addbet-e2e: ${msg}`); if (!ok) fails.push(msg); };

async function setup(browser, viewport) {
  const mobile = viewport.width < 500;
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block", deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  const errors = [], net = { sb: [], summary: [], odds: 0 };
  page.on("pageerror", e => errors.push(e.message + (process.env.STACK ? " @" + page.url() + " " + String(e.stack).slice(0,600) : "")));
  page.on("console", m => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.route(/the-odds-api\.com/, r => { net.odds++; return r.abort(); });
  await page.route(/googletagmanager|google-analytics|plausible|cloudflareinsights/, r => r.abort());
  await page.route(/espn\.com\/.*\/scoreboard/, r => { net.sb.push(r.request().url()); return r.fulfill({ body: finals(), contentType: "application/json", headers: { "access-control-allow-origin": "*" } }); });
  await page.route(/espn\.com\/.*\/summary/, r => { net.summary.push(r.request().url()); return r.fulfill({ json: {}, headers: { "access-control-allow-origin": "*" } }); });
  await page.route(/espncdn|espn\.com\/i\//, r => r.abort());
  if (DATA_DIR) await page.route(/\/data\/.+\.json/, r => {
    const rel = new URL(r.request().url()).pathname.split("/data/").pop(), f = path.join(DATA_DIR, rel);
    return existsSync(f) ? r.fulfill({ body: readFileSync(f), contentType: "application/json" }) : r.fulfill({ status: 404, body: "" });
  });
  await page.addInitScript(() => { try { localStorage.setItem("ls-age-ok", "1"); } catch (e) {} });
  return { ctx, page, errors, net };
}
const bets = page => page.evaluate(() => (JSON.parse(localStorage.getItem("ls-bets-v1") || "{}") || {}).bets || []);
const leg = (page, i) => page.locator(`.bt-leg[data-leg="${i}"]`);
async function openForm(page) { await page.goto(BASE + "#/bets/add"); await page.waitForSelector(".bt-form select[data-f=status]"); }
async function notListed(page, i, lg = "nba") {
  const L = leg(page, i);
  await L.locator(`[data-a=lg][data-v=${lg}]`).click();
  await L.locator("select[data-f=game]").selectOption("__manual");
  await L.locator("[data-f=eventText]").waitFor();
}
const save = page => page.locator("button.bt-add").click();
async function shot(page, name) {
  if (!SHOTS) return;
  await page.evaluate(() => document.getElementById("btToast")?.classList.remove("on"));
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false, animations: "disabled" });
}
// the captured scoreboard is mid-night; the lookup is for finished games, so serve it as all Final
function finals() {
  const sb = JSON.parse(fx("sb_nba"));
  sb.events.forEach((e, i) => {
    const st = { type: { state: "post", completed: true, shortDetail: "Final", detail: "Final" } };
    e.status = st; const c = e.competitions[0]; c.status = st;
    c.competitors.forEach((t, j) => { const n = Number(t.score) || 0; t.score = String(n < 80 ? 98 + ((i * 7 + j * 11) % 25) : n + 12 + j * 3); });
  });
  return JSON.stringify(sb);
}

async function desktop(browser) {
  const { ctx, page, errors, net } = await setup(browser, { width: 1366, height: 900 });
  // 1) single bet on a game that's not listed, already won
  await openForm(page);
  check(await page.locator("select[data-f=status]").inputValue() === "", "Result defaults to Open");
  check(await page.locator("[data-f=date]").inputValue() === TODAY, "Date placed defaults to today");
  await notListed(page, 0);
  await page.waitForSelector(".bt-pg");
  check(await page.locator(".bt-pg").count() === 9, "finished-game lookup lists the day's games (9 from the scoreboard)");
  check(net.sb.length === 1 && /dates=20261026/.test(net.sb[0]), "lookup = one scoreboard read for yesterday");
  await leg(page, 0).locator("[data-f=eventText]").fill("Celtics @ Knicks");
  await leg(page, 0).locator("[data-f=selection]").fill("Celtics ML");
  await page.locator(".bt-form > .bt-row [data-f=odds], .bt-form [data-f=odds]").first().fill("+150");
  await page.locator("[data-f=stake]").fill("20");
  await page.locator("[data-f=date]").fill(PLACED);
  await page.locator("select[data-f=status]").selectOption("won");
  check(/counts in your profit/.test(await page.locator(".bt-resrow .bt-hint").textContent()), "hint explains a set result counts right away");
  await page.locator(".bt-resrow").scrollIntoViewIfNeeded();
  await shot(page, "form-single-result-desktop");
  await save(page);
  await page.waitForURL(/#\/bets\/list/);
  let b = (await bets(page)).find(x => x.type !== "parlay" && x.status === "won");
  check(b && b.status === "won" && b.manual === true && b.settledBy === "manual" && b.settledAt === PLACED, `saved Won: manual, settledAt = placed date (${b && b.settledAt})`);
  check(b && b.updatedAt, "bet is stamped for Account sync (updatedAt)");

  // 2) parlay: leg 1 picked from the finished-game lookup, leg 2 typed; W + W -> Won from the legs
  await openForm(page);
  await page.locator("[data-a=type][data-v=parlay]").click();
  await notListed(page, 0);
  await page.waitForSelector('.bt-pg[data-v="401909868"]');
  await page.locator('.bt-pg[data-v="401909868"]').click();
  await leg(page, 0).locator("[data-a=side]").first().waitFor();
  check(await leg(page, 0).locator("select[data-f=game]").inputValue() === "401909868", "picked finished game is linked to the leg");
  await leg(page, 0).locator("[data-a=side]").first().click();
  await leg(page, 0).locator("[data-f=odds]").fill("+100");
  await leg(page, 0).locator('[data-a=lres][data-v=won]').click();
  if (await leg(page, 1).count() === 0) await page.locator("[data-a=addleg]").click();
  await notListed(page, 1);
  await leg(page, 1).locator("[data-f=eventText]").fill("Lakers @ Suns");
  await leg(page, 1).locator("[data-f=selection]").fill("Over 228.5");
  await leg(page, 1).locator("[data-f=odds]").fill("+100");
  await leg(page, 1).locator('[data-a=lres][data-v=won]').click();
  await page.locator("[data-f=stake]").fill("10");
  await page.locator("[data-f=date]").fill(PLACED);
  check(await page.locator("select[data-f=status]").inputValue() === "won", "parlay Result follows the legs (W + W = Won)");
  check(/from the legs/.test(await page.locator(".bt-resrow").textContent()), "labelled as worked out from the legs");
  await leg(page, 1).locator('[data-a=lres][data-v=lost]').click();
  check(await page.locator("select[data-f=status]").inputValue() === "lost", "a lost leg flips it to Lost");
  await page.locator("select[data-f=status]").selectOption("won");
  await save(page);
  check(/Leg 2 is marked Lost/.test(await page.locator(".bt-err").textContent()), "Won with a lost leg is refused with a clear message");
  await leg(page, 1).locator('[data-a=lres][data-v=won]').click();
  await page.locator(".bt-legs-ed").scrollIntoViewIfNeeded();
  await shot(page, "form-parlay-legresults-desktop");
  await save(page);
  await page.waitForURL(/#\/bets\/list/);
  b = (await bets(page)).find(x => x.type === "parlay");
  check(b && b.status === "won" && b.settledBy === "manual" && b.settledAt === PLACED && b.legs.every(l => l.result === "won"), "parlay saved Won with leg results");
  check(b && b.legs[0].event && b.legs[0].event.id === "401909868", "looked-up game saved on the leg");

  // 3) cash-out, then edit it back to Open
  await openForm(page);
  await notListed(page, 0);
  await leg(page, 0).locator("[data-f=eventText]").fill("Chiefs @ Bills");
  await leg(page, 0).locator("[data-f=selection]").fill("Chiefs ML");
  await page.locator(".bt-form [data-f=odds]").first().fill("-110");
  await page.locator("[data-f=stake]").fill("20");
  await page.locator("select[data-f=status]").selectOption("cashout");
  await save(page);
  check(/cash-out amount/i.test(await page.locator(".bt-err").textContent()), "cash-out needs an amount");
  await page.locator("[data-f=cashout]").fill("12");
  await save(page);
  await page.waitForURL(/#\/bets\/list/);
  b = (await bets(page)).find(x => x.status === "cashout");
  check(b && b.cashout === 12 && b.settledAt === TODAY, "cash-out saved ($12, settled on the placed date = today)");
  await page.goto(BASE + `#/bets/edit/${encodeURIComponent(b.id)}`);
  await page.waitForSelector("select[data-f=status]");
  check(await page.locator("select[data-f=status]").inputValue() === "cashout", "edit shows the saved result");
  await page.locator("select[data-f=status]").selectOption("");
  await save(page);
  await page.waitForURL(/#\/bets\/list/);
  const re = (await bets(page)).find(x => x.id === b.id);
  check(re && re.status === "pending" && !re.manual && !re.settledAt && re.cashout == null, "edited back to Open: re-opened");

  // 4) a linked single left Open still auto-settles via ESPN; form-settled bets are never looked up
  await openForm(page);
  await notListed(page, 0);
  await page.locator('.bt-pg[data-v="401909868"]').click();
  await leg(page, 0).locator("[data-a=side]").first().click();
  await page.locator(".bt-form [data-f=odds]").first().fill("+120");
  await page.locator("[data-f=stake]").fill("5");
  await save(page);
  await page.waitForURL(/#\/bets\/list/);
  net.summary.length = 0;
  await page.goto(BASE + "#/bets"); await page.waitForTimeout(1500);
  check(net.summary.length >= 1 && net.summary.every(u => /event=401909868/.test(u)), `open linked bet is checked against ESPN (${net.summary.length} summary read(s))`);
  const all = await bets(page);
  check(all.filter(x => x.settledBy === "manual").every(x => x.status === "won"), "auto-settle left the form results alone");
  // overview: +$30 single, +$30 parlay
  const ov = await page.locator("#app").textContent();
  check(/\+\$60\.00/.test(ov), "overview profit counts both form-settled wins (+$60.00)");
  check(/2-0/.test(ov) || /2\s*W/.test(ov), "record shows 2-0");
  await page.evaluate(() => scrollTo(0, 0)); await shot(page, "overview-desktop");
  await page.goto(BASE + "#/bets/list"); await page.waitForSelector(".bt-card, .bt-bet, [data-id]");
  const lt = await page.locator("#app").textContent();
  check(/Won/.test(lt) && /Celtics ML/.test(lt), "list shows the form-settled bet as Won");
  await page.evaluate(() => scrollTo(0, 0)); await shot(page, "list-desktop");
  check(net.odds === 0, "no Odds API requests");
  check(!errors.length, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
}

async function mobile(browser) {
  const { ctx, page, errors } = await setup(browser, { width: 390, height: 844 });
  await openForm(page);
  await notListed(page, 0);
  await page.waitForSelector(".bt-pg");
  await leg(page, 0).locator("[data-f=eventText]").fill("Celtics @ Knicks");
  await leg(page, 0).locator("[data-f=selection]").fill("Celtics ML");
  await page.locator(".bt-form [data-f=odds]").first().fill("+150");
  await page.locator("[data-f=stake]").fill("20");
  await page.locator("[data-f=date]").fill(PLACED);
  await page.locator("select[data-f=status]").selectOption("won");
  const ow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(ow <= 1, `mobile form has no sideways scroll (${ow}px)`);
  await page.locator(".bt-resrow").scrollIntoViewIfNeeded();
  await shot(page, "form-single-result-mobile");
  await save(page); await page.waitForURL(/#\/bets\/list/);
  await openForm(page);
  await page.locator("[data-a=type][data-v=parlay]").click();
  for (const i of [0, 1]) {
    if (await leg(page, i).count() === 0) await page.locator("[data-a=addleg]").click();
    await notListed(page, i);
    await leg(page, i).locator("[data-f=eventText]").fill(i ? "Lakers @ Suns" : "Nuggets @ Jazz");
    await leg(page, i).locator("[data-f=selection]").fill(i ? "Over 228.5" : "Nuggets -4.5");
    await leg(page, i).locator("[data-f=odds]").fill("+100");
    await leg(page, i).locator(`[data-a=lres][data-v=${i ? "lost" : "won"}]`).click();
  }
  await page.locator("[data-f=stake]").fill("10");
  check(await page.locator("select[data-f=status]").inputValue() === "lost", "mobile: W + L = Lost");
  const tap = await leg(page, 1).locator("[data-a=lres]").first().boundingBox();
  check(tap && tap.width >= 44 && tap.height >= 36, `leg result buttons are tappable (${tap && Math.round(tap.width)}x${tap && Math.round(tap.height)})`);
  await page.evaluate(() => document.querySelector('.bt-leg[data-leg="1"] .bt-legfoot').scrollIntoView({ block: "start" }));
  await page.evaluate(() => scrollBy(0, -120));
  await shot(page, "form-parlay-legresults-mobile");
  await save(page); await page.waitForURL(/#\/bets\/list/);
  await page.waitForTimeout(400);
  await page.evaluate(() => scrollTo(0, 0)); await shot(page, "list-mobile");
  await page.goto(BASE + "#/bets"); await page.waitForTimeout(1200);
  check(/\+\$20\.00/.test(await page.locator("#app").textContent()), "mobile overview: +$30 − $10 = +$20.00");
  await page.evaluate(() => scrollTo(0, 0)); await shot(page, "overview-mobile");
  check(!errors.length, `mobile: no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
}

// "Find it" lookup that fails, then finds nothing: "Try again" reruns the same day's scoreboard read
async function retry(browser, viewport, tag) {
  const { ctx, page, errors, net } = await setup(browser, viewport);
  const answers = ["fail", "empty", "ok"];
  await page.unroute(/espn\.com\/.*\/scoreboard/);
  await page.route(/espn\.com\/.*\/scoreboard/, r => {
    net.sb.push(r.request().url()); const a = answers.shift() || "ok";
    if (a === "fail") return r.fulfill({ status: 503, body: "", headers: { "access-control-allow-origin": "*" } });
    return r.fulfill({ body: a === "empty" ? JSON.stringify({ events: [] }) : finals(), contentType: "application/json", headers: { "access-control-allow-origin": "*" } });
  });
  await openForm(page);
  await notListed(page, 0);
  const btn = page.locator(".bt-past-msg .bt-retry");
  await btn.waitFor();
  check(/Couldn't load games for that day/.test(await page.locator(".bt-past-msg").textContent()) && await btn.count() === 1, `${tag}: failed lookup shows "Try again"`);
  const bb = await btn.boundingBox();
  check(bb && bb.height >= 30, `${tag}: Try again is tappable (${bb && Math.round(bb.height)}px)`);
  await page.locator(".bt-past").scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, -160));
  await shot(page, `findit-failed-${tag}`);
  await btn.click();
  await page.waitForFunction(() => /No NBA games that day/.test(document.querySelector(".bt-past-msg")?.textContent || ""));
  check(net.sb.length === 2 && net.sb[1] === net.sb[0], `${tag}: Try again reruns the same lookup (${net.sb.length} reads)`);
  check(await page.locator(".bt-past-msg .bt-retry").count() === 1, `${tag}: empty result also offers "Try again"`);
  await shot(page, `findit-empty-${tag}`);
  await page.locator(".bt-past-msg .bt-retry").click();
  await page.waitForSelector(".bt-pg");
  check(await page.locator(".bt-pg").count() === 9 && net.sb.length === 3 && !await page.locator(".bt-retry").count(), `${tag}: second retry lists the games, button gone`);
  check(net.odds === 0 && !errors.length, `${tag}: no Odds API requests or page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
}

const browser = await chromium.launch();
try { await desktop(browser); await mobile(browser); await retry(browser, { width: 1366, height: 900 }, "desktop"); await retry(browser, { width: 390, height: 844 }, "mobile"); }
catch (e) { check(false, "crashed: " + e.message.split("\n")[0]); }
finally { await browser.close(); }
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall add-bet result e2e checks passed");
process.exit(fails.length ? 1 : 0);
