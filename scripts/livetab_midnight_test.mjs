// Live tab after midnight ET, with the games ESPN still had in progress at 12:21 AM ET
// on Sat Oct 31 2026. The static files are a fixture of what build_data.py writes once
// it also reads the previous ET scoreboard: LAL @ GS and DEN @ PHX (4th quarter) and
// Kent State @ Sacramento State (halftime, FBS). No network, no Odds API.
// Usage: python3 -m http.server 8841 -d site &
//        env -u ODDS_API_KEY BASE=http://localhost:8841/ SHOTS=/tmp/live-midnight node scripts/livetab_midnight_test.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:8841/";
const SHOTS = process.env.SHOTS || "";
const NOW = "2026-10-31T04:21:00.000Z"; // 12:21 AM ET
const GEN = "2026-10-31T04:16:00.000Z";
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} midnight-live: ${msg}`); if (!ok) fails.push(msg); };

const team = (id, abbr, name, short, logo, score) => ({ id, abbr, name, short, logo, score, record: null, form: null });
const game = (id, date, state, det, away, home) => ({
  id, date, state, statusDetail: det, completed: state === "post",
  name: `${away.name} at ${home.name}`, shortName: `${away.abbr} @ ${home.abbr}`, home, away,
});
const LAL = team("13", "LAL", "Los Angeles Lakers", "Lakers", "https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/lal.png", "80");
const GS = team("9", "GS", "Golden State Warriors", "Warriors", "https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/gs.png", "90");
const DEN = team("7", "DEN", "Denver Nuggets", "Nuggets", "https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/den.png", "123");
const PHX = team("21", "PHX", "Phoenix Suns", "Suns", "https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/phx.png", "117");
const KENT = team("2309", "KENT", "Kent State Golden Flashes", "Kent State", "https://a.espncdn.com/i/teamlogos/ncaa/500/2309.png", "10");
const SAC = team("16", "SAC", "Sacramento State Hornets", "Sacramento St", "https://a.espncdn.com/i/teamlogos/ncaa/500/16.png", "6");
const POR = team("22", "POR", "Portland Trail Blazers", "Trail Blazers", "https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/por.png", "0");
const UTAH = team("26", "UTAH", "Utah Jazz", "Jazz", "https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/utah.png", "0");

const ORDER = ["nfl", "nba", "ncaaf", "ncaab", "nhl", "mlb", "epl", "mls", "ucl", "ufc"];
const NAMES = { nfl: ["NFL", "National Football League"], nba: ["NBA", "National Basketball Association"], ncaaf: ["NCAAF", "College Football"], ncaab: ["NCAAB", "College Basketball"], nhl: ["NHL", "National Hockey League"], mlb: ["MLB", "Major League Baseball"], epl: ["EPL", "English Premier League"], mls: ["MLS", "Major League Soccer"], ucl: ["UCL", "UEFA Champions League"], ufc: ["UFC", "UFC"] };
const KIND = { nfl: "football", nba: "basketball", ncaaf: "football", ncaab: "basketball", nhl: "hockey", mlb: "baseball", epl: "soccer", mls: "soccer", ucl: "soccer", ufc: "mma" };
const games = {
  nba: [
    game("401909285", "2026-10-31T02:00:00Z", "in", "8:50 - 4th", LAL, GS),
    game("401909286", "2026-10-31T02:00:00Z", "in", "35.4 - 4th", DEN, PHX),
    game("401909896", "2026-10-31T19:00:00Z", "pre", "10/31 - 3:00 PM EDT", POR, UTAH),
  ],
  ncaaf: [
    game("401866451", "2026-10-31T02:30:00Z", "in", "Halftime", KENT, SAC),
  ],
};
const meta = {
  generated: GEN, order: ORDER,
  leagues: Object.fromEntries(ORDER.map(k => [k, { name: NAMES[k][0], full: NAMES[k][1], games: (games[k] || []).length, upcoming: (games[k] || []).filter(g => g.state === "pre").length }])),
  // The 12:15 AM ET refresh reported live: 0 because those games had already been dropped.
  slate: { generated: GEN, day: "2026-10-31", ticker: [], totals: { today: 1, live: 0, upcoming: 1, props: 0, hot: 0, wxWatch: 0 },
           leagues: { nba: { today: 1, live: 0 }, ncaaf: { today: 0, live: 0 } } },
};
const idx = Object.fromEntries(ORDER.map(k => [k, {
  league: { key: k, name: NAMES[k][0], full: NAMES[k][1], kind: KIND[k] },
  generated: GEN, windowDays: 10, games: games[k] || [], teams: {},
  report: { upcoming: (games[k] || []).filter(g => g.state === "pre").length, withOdds: 0, providers: [] },
}]));

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(() => localStorage.setItem("ls-age-ok", "1"));
  const errors = [], espn = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route(/\/data\//, r => r.fulfill({ status: 404, body: "" }));
  await page.route(/\/data\/meta\.json/, r => r.fulfill({ json: meta }));
  await page.route(/\/data\/(nba|ncaaf)\/index\.json/, r => {
    const lg = /\/data\/([a-z]+)\/index\.json/.exec(r.request().url())[1];
    return r.fulfill({ json: idx[lg] });
  });
  await page.route(/site\.api\.espn\.com|site\.web\.api\.espn\.com|the-odds-api|ipdata\.info|supabase/, r => {
    espn.push(r.request().url());
    return r.fulfill({ json: { events: [] }, headers: { "access-control-allow-origin": "*" } });
  });
  await page.goto(BASE + "#/live", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".lt-page", { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll(".lt-row.lt-in").length >= 3, null, { timeout: 15000 });
  await page.waitForTimeout(500);

  const rows = await page.$$eval(".lt-sec[aria-label='In progress'] .lt-row", els => els.map(e => ({ href: e.getAttribute("href"), text: e.innerText.replace(/\s+/g, " ") })));
  const lgs = await page.$$eval(".lt-sec[aria-label='In progress'] .lt-lgh a", els => els.map(e => e.textContent.trim()));
  check(rows.length === 3, `3 games in progress (got ${rows.length})`);
  check(lgs.join() === "NBA,NCAAF", `NBA then college football (${lgs.join()})`);
  const lal = rows.find(r => r.href === "#/g/nba/401909285");
  const den = rows.find(r => r.href === "#/g/nba/401909286");
  const kent = rows.find(r => r.href === "#/g/ncaaf/401866451");
  check(!!lal && /Lakers/.test(lal.text) && /Warriors/.test(lal.text) && /80/.test(lal.text) && /90/.test(lal.text) && /Q4 · 8:50/.test(lal.text), `LAL @ GS: ${lal && lal.text}`);
  check(!!den && /Nuggets/.test(den.text) && /Suns/.test(den.text) && /123/.test(den.text) && /117/.test(den.text) && /Q4 · 35\.4/.test(den.text), `DEN @ PHX: ${den && den.text}`);
  check(!!kent && /Kent State/.test(kent.text) && /Sacramento/.test(kent.text) && /Halftime/.test(kent.text), `Kent State @ Sacramento State: ${kent && kent.text}`);
  check(!rows.some(r => /Trail Blazers|Jazz/.test(r.text)), "a game that starts this afternoon is not listed as live");
  const empty = await page.$(".lt-empty");
  check(!empty, "the empty state is not shown");
  const badge = await page.$eval("#liveBtn [data-live-badge]", e => ({ t: e.textContent.trim(), hidden: e.hidden }));
  check(badge.t === "3" && !badge.hidden, `header badge is 3 (slate said 0): ${JSON.stringify(badge)}`);
  const foot = await page.$eval("#siteFooter", e => e.innerText.replace(/\s+/g, " "));
  check(/21\+/.test(foot) && /1-800-GAMBLER/.test(foot), "footer still has the 21+ notice and 1-800-GAMBLER");
  check(/1-833-PLAYWISE/.test(foot) && /1-888-ADMIT-IT/.test(foot), "footer still has the Florida helplines");
  const polled = espn.filter(u => /scoreboard/.test(u));
  check(polled.length > 0 && polled.every(u => /dates=20261030/.test(u)) && polled.some(u => /college-football/.test(u) && /groups=80/.test(u)) && polled.every(u => !/groups=81/.test(u)),
    `poll is yesterday's ET board, FBS only (${[...new Set(polled)].join(" | ")})`);
  check(!espn.some(u => /the-odds-api/.test(u)), "the Odds API is not called");
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(" | ")})`);
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/live-tab-after-midnight.png` });
    console.log("saved", `${SHOTS}/live-tab-after-midnight.png`);
  }
  await ctx.close();
} finally {
  await browser.close();
}
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall midnight live checks passed");
process.exit(fails.length ? 1 : 0);
