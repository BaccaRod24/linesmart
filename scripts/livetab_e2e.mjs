// Browser test for the Live tab (#/live) with a mocked live night: the browser clock is pinned to MNF Oct 26 2026
// 9:10 PM ET, data/*.json are served from fixtures built here, and every ESPN request is answered from the captured
// scoreboards in scripts/fixtures/live (no network, no Odds API, nothing saved anywhere).
// Usage: python3 -m http.server 8840 -d site &   BASE=http://localhost:8840/ node scripts/livetab_e2e.mjs
//        SHOTS=/path/to/dir also saves desktop (1366x900) and mobile (390x844) screenshots.
import { chromium } from "playwright";
import { readFileSync } from "fs";
const BASE = process.env.BASE || "http://localhost:8840/";
const SHOTS = process.env.SHOTS || "";
const AS_OF = "2026-10-27T01:10:00.000Z", NOW = Date.parse(AS_OF), GEN = "2026-10-27T00:45:49Z";
const at = min => new Date(NOW + min * 60e3).toISOString().replace(/:\d\d\.\d+Z$/, "Z");
const fx = n => JSON.parse(readFileSync(new URL(`./fixtures/live/${n}.json`, import.meta.url)));
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} livetab-e2e: ${msg}`); if (!ok) fails.push(msg); };

// ---------- fixture data: what the static files said at 8:45 PM ET (everything still "pre"), live scores come from ESPN
const KIND = { nfl: "football", ncaaf: "football", nba: "basketball", ncaab: "basketball", nhl: "hockey", mlb: "baseball", epl: "soccer", mls: "soccer", ucl: "soccer", ufc: "mma" };
const NAMES = { nfl: ["NFL", "National Football League"], nba: ["NBA", "National Basketball Association"], ncaaf: ["NCAAF", "College Football"], ncaab: ["NCAAB", "College Basketball"], nhl: ["NHL", "National Hockey League"], mlb: ["MLB", "Major League Baseball"], epl: ["EPL", "English Premier League"], mls: ["MLS", "Major League Soccer"], ucl: ["UCL", "UEFA Champions League"], ufc: ["UFC", "UFC"] };
const ORDER = Object.keys(NAMES);
const team = (id, abbr, name, short, logo, score = "0", extra = {}) => ({ id, abbr, name, short, logo: logo || "", score, record: null, form: null, ...extra });
const game = (id, date, state, det, away, home, extra = {}) => ({ id, date, state, statusDetail: det, completed: state === "post", name: `${away.name} at ${home.name}`, home, away, ...extra });
function fromScoreboard(lg) {
  return fx("sb_" + lg).events.map(e => {
    const c = e.competitions[0], t = h => { const x = c.competitors.find(y => y.homeAway === h); return team(x.id, x.team.abbreviation, x.team.displayName, x.team.shortDisplayName, x.team.logo); };
    return game(e.id, e.date, "pre", "stale", t("away"), t("home"));
  });
}
function fixtureData({ empty = false } = {}) {
  const games = Object.fromEntries(ORDER.map(k => [k, []]));
  if (!empty) {
    for (const lg of ["nfl", "nba", "nhl", "mlb"]) games[lg] = fromScoreboard(lg);
    games.ncaab = [game("ncb1", at(80), "pre", "", team("2", "DUKE", "Duke Blue Devils", "Duke", "https://a.espncdn.com/i/teamlogos/ncaa/500/150.png", "0", { rank: 3 }), team("1", "UNC", "North Carolina Tar Heels", "North Carolina", "https://a.espncdn.com/i/teamlogos/ncaa/500/153.png"))];
    games.epl = [game("epl1", at(-145), "post", "FT", team("359", "ARS", "Arsenal", "Arsenal", "https://a.espncdn.com/i/teamlogos/soccer/500/359.png", "2", { winner: true }), team("364", "LIV", "Liverpool", "Liverpool", "https://a.espncdn.com/i/teamlogos/soccer/500/364.png", "1"))];
    const ev = { id: "600060900", name: "UFC Fight Night: Royval vs. Kape", short: "UFC Fight Night" };
    const fighter = (id, name, short, country) => team(id, short.toUpperCase(), name, short, `https://a.espncdn.com/i/teamlogos/countries/500/${country}.png`, "0");
    games.ufc = [
      game("f1", at(-25), "in", "R2, 2:14", fighter("11", "Brandon Royval", "B. Royval", "usa"), fighter("12", "Manel Kape", "M. Kape", "por"), { event: ev, weightClass: "Flyweight", mainEvent: true, segment: "main" }),
      game("f2", at(-60), "post", "Final", fighter("13", "Jean Silva", "J. Silva", "bra"), fighter("14", "Dan Ige", "D. Ige", "usa"), { event: ev, weightClass: "Featherweight", segment: "main" }),
    ];
  }
  const today = lg => games[lg].filter(g => g.state !== "post" || true).length;
  const meta = {
    generated: GEN, order: ORDER,
    leagues: Object.fromEntries(ORDER.map(k => [k, { name: NAMES[k][0], full: NAMES[k][1], games: games[k].length || 5, upcoming: games[k].filter(g => g.state === "pre").length }])),
    slate: { generated: GEN, day: "2026-10-26", ticker: [], totals: { today: Object.values(games).flat().length, live: 0, upcoming: 40, props: 0, hot: 0, wxWatch: 0 },
             leagues: Object.fromEntries(ORDER.map(k => [k, { today: today(k), live: 0 }])) },
  };
  const idx = Object.fromEntries(ORDER.map(k => [k, { league: { key: k, name: NAMES[k][0], full: NAMES[k][1], kind: KIND[k] }, generated: GEN, windowDays: 7, games: games[k], teams: [], report: { upcoming: games[k].length, withOdds: 0, providers: [] } }]));
  return { meta, idx };
}
const SB = { nfl: "football/nfl", nba: "basketball/nba", nhl: "hockey/nhl", mlb: "baseball/mlb" };

async function setup(browser, { viewport, empty = false, bets = true }) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block", deviceScaleFactor: 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(AS_OF));
  const D = fixtureData({ empty }), espn = [], errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.route(/\/data\/meta\.json/, r => r.fulfill({ json: D.meta }));
  await page.route(/\/data\/previews\.json/, r => r.fulfill({ status: 404, body: "" }));
  await page.route(/\/data\/([a-z]+)\/index\.json/, r => { const lg = /\/data\/([a-z]+)\/index\.json/.exec(r.request().url())[1]; return D.idx[lg] ? r.fulfill({ json: D.idx[lg] }) : r.fulfill({ status: 404, body: "" }); });
  await page.route(/espn\.com\//, r => {
    const u = r.request().url(); espn.push(u);
    const m = /sports\/([a-z-]+\/[a-z.0-9-]+)\/scoreboard/.exec(u), lg = m && Object.keys(SB).find(k => SB[k] === m[1]);
    if (lg && !empty) return r.fulfill({ json: fx("sb_" + lg), headers: { "access-control-allow-origin": "*" } });
    if (/\.png|\.svg/.test(u)) return r.continue();   // team logos (images only)
    return r.fulfill({ json: { events: [] }, headers: { "access-control-allow-origin": "*" } });
  });
  await page.route(/cloudflareinsights|ipdata\.info|the-odds-api|supabase/, r => r.abort());
  if (bets) await page.addInitScript(() => {   // this test browser only: a pending bet on MNF and a parlay leg on CHA-WSH
    localStorage.setItem("ls-bets-v1", JSON.stringify({ v: 1, saved: "2026-10-26T23:00:00Z", bets: [
      { id: "t1", status: "pending", type: "spread", book: "draftkings", stake: 10, odds: -110, league: "nfl", side: "home", line: -3.5, event: { id: "401873009", lg: "nfl", date: "2026-10-27T00:15Z", home: "PHI", away: "DAL" } },
      { id: "t2", status: "pending", type: "parlay", book: "fanduel", stake: 5, odds: 260, legs: [{ type: "ml", league: "nba", side: "home", event: { id: "401909868", lg: "nba" } }, { type: "ml", league: "nhl", side: "away", result: "won", event: { id: "401892582", lg: "nhl" } }] },
    ] }));
  });
  await page.addInitScript(() => localStorage.setItem("ls-age-ok", "1"));   // the one-time 21+ notice
  return { ctx, page, espn, errors };
}
const settle = async page => { await page.waitForSelector(".lt-page", { timeout: 15000 }); await page.waitForFunction(() => document.querySelectorAll(".lt-row.lt-in").length > 0 || document.querySelector(".lt-empty"), null, { timeout: 15000 }); await page.waitForTimeout(800); };
const hideAgeGate = page => page.evaluate(() => document.querySelectorAll(".age-gate,#ageGate,[data-age-gate]").forEach(e => e.remove())).catch(() => {});

const browser = await chromium.launch();
try {
  // ---------- desktop, live night
  {
    const { ctx, page, espn, errors } = await setup(browser, { viewport: { width: 1366, height: 900 } });
    await page.goto(BASE + "#/live"); await settle(page); await hideAgeGate(page);
    const rows = await page.$$eval(".lt-sec[aria-label='In progress'] .lt-row", els => els.map(e => ({ href: e.getAttribute("href"), text: e.innerText.replace(/\s+/g, " "), state: e.className })));
    const lgs = await page.$$eval(".lt-sec[aria-label='In progress'] .lt-lgh a", els => els.map(e => e.textContent));
    check(rows.length === 12, `12 live rows (11 from ESPN + 1 UFC fight), got ${rows.length}`);
    check(lgs.join() === "NFL,NBA,NHL,MLB,UFC", `grouped by league in site order: ${lgs.join()}`);
    const mnf = rows.find(r => r.href === "#/g/nfl/401873009");
    check(!!mnf && /Q2 · 8:35/.test(mnf.text) && /Cowboys 10/.test(mnf.text) && /Eagles 14/.test(mnf.text), `MNF row: clock + score (${mnf && mnf.text})`);
    check(!!mnf && /ball/.test(mnf.text), "MNF row: down & distance / possession");
    check(await page.$('a[href="#/g/nfl/401873009"] .lt-poss') !== null, "possession dot on the team with the ball");
    check(!!mnf && /You have a bet/.test(mnf.text), "MNF: 'You have a bet' (pending spread)");
    const cha = rows.find(r => r.href === "#/g/nba/401909868"), nyr = rows.find(r => r.href === "#/g/nhl/401892582");
    check(!!cha && /You have a bet/.test(cha.text) && !!nyr && !/You have a bet/.test(nyr.text), "open parlay leg tagged; settled leg not");
    const ufc = rows.find(r => r.href === "#/g/ufc/f1");
    check(!!ufc && /R2 · 2:14/.test(ufc.text) && /Royval/.test(ufc.text), "UFC fight: round + clock");
    const soon = await page.$$eval(".lt-sec[aria-label='Starting soon'] .lt-row", els => els.map(e => e.innerText.replace(/\s+/g, " ")));
    check(soon.some(t => /Oilers|Edmonton/.test(t) && /9:30/.test(t)) && soon.some(t => /Duke/.test(t) && /in 1h 20m/.test(t)), `starting soon: EDM-DET 9:30 and Duke-UNC in 1h 20m (${soon.join(" | ")})`);
    const recent = await page.$$eval(".lt-sec[aria-label='Just finished'] .lt-row", els => els.map(e => e.innerText.replace(/\s+/g, " ")));
    check(recent.some(t => /Arsenal 2/.test(t) && /FT/.test(t)) && recent.some(t => /UFC Fight Night/.test(t)), `just finished: Arsenal-Liverpool FT, UFC card (${recent.join(" | ")})`);
    const badge = await page.$eval("#liveBtn [data-live-badge]", e => ({ t: e.textContent, hidden: e.hidden }));
    check(badge.t === "12" && !badge.hidden, `header live badge shows 12 (static said 0): ${JSON.stringify(badge)}`);
    check(await page.$eval("#liveBtn", e => e.classList.contains("on") && e.classList.contains("has-live")), "header Live button active + pulsing");
    check(await page.$eval(".lt-count", e => e.textContent.trim()) === "12", "page heading count");
    // polling: only leagues with games on, via site.web.api.espn.com; never UFC, never pre-only leagues
    const polled = [...new Set(espn.filter(u => /scoreboard/.test(u)).map(u => /sports\/[a-z-]+\/([a-z.0-9-]+)\/scoreboard/.exec(u)[1]))].sort();
    check(polled.join() === "mlb,nba,nfl,nhl", `polled scoreboards: ${polled.join()}`);
    check(espn.filter(u => /scoreboard|summary/.test(u)).every(u => u.startsWith("https://site.web.api.espn.com/")), "ESPN host is site.web.api.espn.com");
    // background tab: polling stops
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    check(await page.evaluate(() => !window.LSLive.status().polling), "hidden tab: no poll scheduled");
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForTimeout(600);
    check(await page.evaluate(() => window.LSLive.status().watching), "visible again: polling resumes");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/fixture-live-desktop.png`, fullPage: true });
    // home "Live now" tile links here
    await page.goto(BASE + "#/"); await page.waitForSelector(".sl-stats", { timeout: 15000 });
    check(await page.$eval('.sl-stats a.st[href="#/live"]', e => /Live now/.test(e.textContent)).catch(() => false), "home 'Live now' tile links to #/live");
    check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(" | ")})`);
    await ctx.close();
  }
  // ---------- mobile, live night
  {
    const { ctx, page, errors } = await setup(browser, { viewport: { width: 390, height: 844 } });
    await page.goto(BASE + "#/live"); await settle(page); await hideAgeGate(page);
    const nav = await page.$$eval("#bnav a", els => els.map(e => ({ nav: e.dataset.nav, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, cur: e.getAttribute("aria-current") })));
    check(nav.map(n => n.nav).join() === "home,live,search,bets,value,account", `bottom nav: ${nav.map(n => n.nav).join()}`);
    check(nav.every(n => n.w >= 44 && n.h >= 44), `tap targets >= 44px (${nav.map(n => Math.round(n.w) + "x" + Math.round(n.h)).join(" ")})`);
    check(nav.find(n => n.nav === "live").cur === "page", "Live is the current bottom-nav item");
    const mb = await page.$eval("#bnav [data-nav=live] [data-live-badge]", e => ({ t: e.textContent, shown: !e.hidden && e.getBoundingClientRect().width > 0 }));
    check(mb.t === "12" && mb.shown, `bottom-nav badge: ${JSON.stringify(mb)}`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 0, `no horizontal overflow (${over}px)`);
    check(await page.$$eval("#siteFooter a", els => els.some(a => /about\.html$/.test(a.getAttribute("href")))), "About still reachable from the footer");
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/fixture-live-mobile.png` });
      await page.screenshot({ path: `${SHOTS}/fixture-live-mobile-full.png`, fullPage: true });
    }
    check(errors.length === 0, `mobile: no page errors (${errors.slice(0, 3).join(" | ")})`);
    await ctx.close();
  }
  // ---------- nothing on: friendly empty state
  for (const vp of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    const { ctx, page, espn, errors } = await setup(browser, { viewport: vp, empty: true, bets: false });
    await page.goto(BASE + "#/live"); await settle(page); await hideAgeGate(page);
    check(await page.$eval(".lt-empty h3", e => e.textContent) === "Nothing live right now", `${vp.width}px: empty state`);
    check(await page.$eval("#liveBtn [data-live-badge]", e => e.hidden), `${vp.width}px: badge hidden at 0`);
    check(espn.filter(u => /scoreboard/.test(u)).length === 0, `${vp.width}px: no ESPN polling when nothing is on`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/fixture-empty-${vp.width < 500 ? "mobile" : "desktop"}.png` });
    check(errors.length === 0, `${vp.width}px empty: no page errors (${errors.slice(0, 3).join(" | ")})`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall livetab e2e checks passed");
process.exit(fails.length ? 1 : 0);
