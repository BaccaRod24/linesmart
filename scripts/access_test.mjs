// Props and stats are one tap from the nav, the home slate, and the top of a game.
// No Odds API: this test unsets ODDS_API_KEY and fails if the page calls one.
// Usage: env -u ODDS_API_KEY node scripts/access_test.mjs
import { createRequire } from "module";
import { chromium } from "playwright";
import fs from "fs";
import http from "http";
import path from "path";

const require = createRequire(import.meta.url);
const AC = require("../site/assets/access-core.js");

let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) fail++; };

// ---------- pure helpers
check(AC.propsControl("nfl", { nfl: true, nba: true }) === "link", "props link when the league file is present");
check(AC.propsControl("nhl", { nfl: true }) === "off" && AC.propsControl("nhl", new Set(["nfl", "nba"])) === "off", "props off when the league has no file");
check(AC.propsControl("nba", null) === "off" && AC.propsControl("", {}) === "off", "props off with no file map");
const games = [{ id: "a", day: "2026-10-29" }, { id: "b", day: "2026-10-30" }, { id: "c", day: "2026-10-29" }];
check(AC.gamesOnDay(games, "2026-10-29").map(g => g.id).join() === "a,c", "today's games only");
check(AC.gamesOnDay(null, "2026-10-29").length === 0 && AC.gamesOnDay([{ id: "z" }], "d", g => g.id).length === 0, "empty day list");
const order = ["nfl", "nba", "nhl"];
check(AC.pickLeague(order, "nba", "nfl") === "nba", "requested league wins");
check(AC.pickLeague(order, "", "nhl") === "nhl" && AC.pickLeague(order, "mlb", "nfl") === "nfl", "current league when the request isn't real");
check(AC.pickLeague(order, "", "") === "nfl" && AC.pickLeague([], "nfl", "nfl") === "", "fallback to the first league, or none");
const players = [
  { k: "p", name: "Jordan Love", w: ["jordan", "love"] },
  { k: "p", name: "Jordan Addison", w: ["jordan", "addison"] },
  { k: "t", name: "Green Bay Packers", w: ["green", "bay", "packers"] },
  { k: "p", name: "CeeDee Lamb" },
];
check(AC.searchPlayers(players, "love").map(p => p.name).join() === "Jordan Love", "search matches a last name and skips teams");
check(AC.searchPlayers(players, "jordan a").map(p => p.name).join() === "Jordan Addison", "every word must match");
check(AC.searchPlayers(players, "lamb").length === 1 && AC.searchPlayers(players, "").length === 0 && AC.searchPlayers(players, "zzzz").length === 0, "plain name, empty query, no match");
check(AC.leaderNumber("24.0") === 24 && AC.leaderNumber(".291") === 0.291 && AC.leaderNumber("143/233, 1,487 YDS, 12 TD, 5 INT") === 1487, "leader number reads a rate, an average, and yards");
check(AC.leaderNumber("Matches: 8, Goals: 2") === 2 && AC.leaderNumber("") === null && AC.leaderNumber("no number") === null, "leader number reads the stat after Matches, or nothing");
check(AC.leaderLabel("143/233, 1,487 YDS, 12 TD, 5 INT") === "1,487 YDS · 12 TD · 5 INT" && AC.leaderLabel("Matches: 11, Goals: 13") === "13 · 11 GP" && AC.leaderLabel("24.0") === "24.0", "leader label shortens a long line and keeps a short one");
const boards = AC.seasonBoards([
  { cat: "Points", player: "A", teamId: "1", value: "20.0" },
  { cat: "Points", player: "A", teamId: "1", value: "20.0" },
  { cat: "Points", player: "B", teamId: "2", value: "30" },
  { cat: "Earned Run Average", player: "C", teamId: "3", value: "2.67" },
  { cat: "Earned Run Average", player: "D", teamId: "4", value: "1.80" },
  { cat: "Passing Yards", player: "E", teamId: "5", value: "111/174, 1,174 YDS, 7 TD, 2 INT" },
  { cat: "Passing Yards", player: "F", teamId: "6", value: "84 CAR, 460 YDS, 1 TD" },
], 8);
const pts = boards.find(b => b.cat === "Points"), era = boards.find(b => b.cat === "Earned Run Average"), yds = boards.find(b => b.cat === "Passing Yards");
check(pts.rows.map(r => r.player).join() === "B,A" && pts.rows.length === 2, "points board ranks high to low and drops the duplicate team");
check(era.rows.map(r => r.player).join() === "D,C", "earned run average ranks low to high");
check(yds.rows.map(r => r.player).join() === "E,F", "passing yards ranks on the YDS number, not the attempts");
check(AC.seasonBoards(null).length === 0 && AC.seasonBoards([{ cat: "Points" }]).length === 0, "empty or nameless leaders make no board");
const cover = AC.leaderGameOrder([
  { id: "1", home: { id: "h" }, away: { id: "a" } },
  { id: "2", home: { id: "h" }, away: { id: "a" } },
  { id: "3", home: { id: "c" }, away: { id: "a" } },
  { id: "x" },
]);
check(cover.map(g => g.id).join() === "1,3", `leader files cover new teams only (${cover.map(g => g.id)})`);
check(AC.playerHref("nba", "Ty Jerome", [{ id: "4242", name: "Ty Jerome" }]) === "#/p/nba/4242" && AC.playerHref("nba", "Nobody", [{ id: "1", name: "Ty Jerome" }]) === "" && AC.playerHref("nba", "", []) === "", "player link when the index has that name");

// ---------- static wiring
const idx = fs.readFileSync("site/index.html", "utf8");
const sw = fs.readFileSync("site/sw.js", "utf8");
const app = fs.readFileSync("site/assets/app.js", "utf8");
const bnav = (idx.match(/<nav class="bnav"[\s\S]*?<\/nav>/) || [""])[0];
check(/id="propsBtn" href="#\/props"/.test(idx) && /id="statsBtn" href="#\/stats"/.test(idx), "desktop nav has Props and Stats");
check(/data-nav="props"/.test(bnav) && /data-nav="stats"/.test(bnav) && /href="#\/props"/.test(bnav) && /href="#\/stats"/.test(bnav), "mobile menu has Props and Stats");
check(/id="i-stats"/.test(idx) && /id="statsBtn"[\s\S]*?#i-stats/.test(idx) && /data-nav="stats"[\s\S]*?#i-stats/.test(bnav), "Stats uses its own sprite in the header and the mobile menu");
check(!/#i-stats/.test((idx.match(/id="valueBtn"[\s\S]*?<\/a>/) || [""])[0]) && /M3 17l6-6/.test((bnav.match(/data-nav="value"[\s\S]*?<\/a>/) || [""])[0]), "Value keeps the trend arrow");
check(!/data-nav="pro"/.test(bnav), "Pro stays off the mobile menu");
check(idx.includes('src="assets/access-core.js"') && idx.indexOf("access-core.js") < idx.indexOf('src="assets/app.js"'), "access-core.js loads before app.js");
check(sw.includes('"assets/access-core.js"'), "service worker caches access-core.js");
check(/h\[0\] === "props" \|\| h\[0\] === "stats"/.test(app) && /viewGame\(h\[1\], h\[2\], h\[3\]\)/.test(app), "router opens the landing and game props/stats");
check(/function tileLinks\(/.test(app) && /function gameJump\(/.test(app), "slate links and game tabs are in app.js");
const foot = idx.slice(idx.indexOf('<footer class="footer"'));
check(/age-pill">21\+</.test(foot) && /1-800-GAMBLER/.test(foot) && /1-833-PLAYWISE/.test(foot), "footer 21+ notice and helplines unchanged");
const promo = /\b(free bets?|risk[- ]free|guaranteed|bonus bets?|no[- ]sweat|free plays?)\b/i;
for (const f of ["site/assets/access-core.js", "site/assets/app.js", "site/assets/ufc.js"]) {
  const m = fs.readFileSync(f, "utf8").match(promo);
  check(!m, `${f}: no promo wording${m ? " (" + m[0] + ")" : ""}`);
}
check(!/api\.the-odds-api|ODDS_API/.test(fs.readFileSync("site/assets/access-core.js", "utf8") + app.slice(app.indexOf("props / stats access"))), "new props/stats code does not call the Odds API");

// ---------- browser
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const srv = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) rel += "index.html";
  const f = path.normalize(path.join("site", rel));
  if (f !== "site" && !f.startsWith("site" + path.sep)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("missing"); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
}).listen(0);
const BASE = `http://127.0.0.1:${srv.address().port}/`;
const nfl = JSON.parse(fs.readFileSync("site/data/nfl/index.json", "utf8"));
const nhl = JSON.parse(fs.readFileSync("site/data/nhl/index.json", "utf8"));
const nflId = (nfl.games.find(g => g.state === "pre") || nfl.games[0]).id;
const nhlId = (nhl.games[0] || {}).id;
const browser = await chromium.launch();
const odds = [], pageErrs = [];
async function open(width, height, hash, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: height }, deviceScaleFactor: width < 500 ? 2 : 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem("ls-age-ok", "1"); localStorage.setItem("ls-state", "FL"); } catch (e) {} });
  await ctx.route(/the-odds-api|api\.the-odds-api|ipdata\.info|cloudflareinsights|site\.web\.api\.espn|site\.api\.espn/, r => {
    if (/the-odds-api|api\.the-odds-api/.test(r.request().url())) odds.push(r.request().url());
    return r.abort();
  });
  if (opts.propsFile) await ctx.route("**/data/props/nfl.json", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, lg: "nfl", games: { [nflId]: { props: [] } }, players: { p: { n: "Jordan Love" } } }) }));
  if (opts.propsBody) await ctx.route(`**/data/props/${opts.propsLeague || "nba"}.json`, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(opts.propsBody) }));
  if (opts.searchNba) await ctx.route("**/data/search/nba.json", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ v: 1, lg: "nba", kind: "basketball", name: "NBA", path: "basketball/nba", hs: "", teams: [["1", "Test Team", "TST", "Test", "", "", "", "", 1]], players: [[String(opts.searchNba.id), opts.searchNba.name, 0, "", "", 0]] }) }));
  const page = await ctx.newPage();
  page.on("pageerror", e => pageErrs.push(hash + ": " + e.message));
  await page.goto(BASE + hash, { waitUntil: "domcontentloaded", timeout: 20000 });
  return { ctx, page };
}
try {
  const desk = await open(1280, 800, "#/");
  await desk.page.waitForSelector("#propsBtn", { timeout: 15000 });
  const nav = await desk.page.evaluate(() => {
    const box = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { w: r.width, h: r.height, shown: s.display !== "none" && r.width > 0 }; };
    return {
      props: box(document.getElementById("propsBtn")),
      stats: box(document.getElementById("statsBtn")),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      foot: document.getElementById("siteFooter").innerText,
    };
  });
  check(nav.props.shown && nav.stats.shown, `desktop nav shows Props and Stats (${nav.props.w}x${nav.props.h}, ${nav.stats.w}x${nav.stats.h})`);
  check(nav.overflow <= 1, `desktop 1280 does not scroll sideways (${nav.overflow}px)`);
  check(/21\+/.test(nav.foot) && /GAMBLER/.test(nav.foot) && /PLAYWISE/.test(nav.foot), "home footer keeps 21+ and both helplines");
  await desk.page.locator(".grid .ps-links").first().scrollIntoViewIfNeeded();
  const tiles = await desk.page.evaluate(() => [...document.querySelectorAll(".grid .gwrap.has-ps")].slice(0, 3).map(w => ({
    props: (w.querySelector(".ps-links a[href$='/props'], .ps-links span.ps-link") || {}).tagName || "",
    stats: !!(w.querySelector("a[href$='/stats']")),
  })));
  check(tiles.length > 0 && tiles.every(t => t.stats) && tiles.every(t => t.props === "A"), `home slate tiles link Props and Stats (${JSON.stringify(tiles[0])})`);
  await desk.ctx.close();

  const phone = await open(375, 812, "#/");
  await phone.page.waitForSelector("#bnav [data-nav='props']", { timeout: 15000 });
  const mob = await phone.page.evaluate(() => {
    const nav = document.getElementById("bnav");
    const item = name => { const a = nav.querySelector(`[data-nav="${name}"]`); a.scrollIntoView({ inline: "nearest", block: "nearest" }); const r = a.getBoundingClientRect(); const nr = nav.getBoundingClientRect(); return { text: a.textContent.trim(), inBar: r.left >= nr.left - 1 && r.right <= nr.right + 1 && r.width > 20 }; };
    return { props: item("props"), stats: item("stats"), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, topHidden: getComputedStyle(document.getElementById("propsBtn")).display };
  });
  check(mob.props.inBar && mob.props.text === "Props" && mob.stats.inBar && mob.stats.text === "Stats", `mobile menu shows Props and Stats (${mob.props.text}, ${mob.stats.text})`);
  check(mob.overflow <= 1, `mobile 375 does not scroll sideways (${mob.overflow}px)`);
  check(mob.topHidden === "none", "desktop Props button is hidden on a phone (the menu has it)");
  await phone.ctx.close();

  const land = await open(1280, 800, "#/props");
  await land.page.waitForSelector("#psq", { timeout: 15000 });
  await land.page.waitForSelector("#psGames", { timeout: 15000 });
  const landing = await land.page.evaluate(() => ({
    h: document.querySelector("#app h1") && document.querySelector("#app h1").textContent,
    games: document.querySelectorAll("#psGames .ps-row").length,
    empty: document.querySelector("#psGames h3") ? document.querySelector("#psGames h3").textContent : "",
    off: document.querySelectorAll("#psGames .ps-go span.ps-link.off").length,
    stats: document.querySelectorAll("#psGames a[href$='/stats']").length,
    note: (document.querySelector(".ps-note") || {}).textContent || "",
    nhlOff: document.querySelector(".ps-lgs .chip.off") ? true : false,
  }));
  check(landing.h === "Player props" && (landing.games > 0 || landing.empty), `props landing lists games or says why not (${landing.games} games)`);
  check(landing.stats === landing.games && landing.off === landing.games, `missing props file disables Props and keeps Stats (${landing.off} off, ${landing.stats} stats)`);
  check(/no player-props file|aren't in this data update/.test(landing.note), `props landing explains a missing file (${landing.note.slice(0, 80)})`);
  check(landing.nhlOff, "leagues without a props file are disabled in the props league row");
  await land.page.fill("#psq", "zzzzqq");
  await land.page.waitForTimeout(200);
  const searched = await land.page.evaluate(() => document.getElementById("psres").innerText);
  check(/player index|No players match/.test(searched), `search box answers instead of going blank (${searched.slice(0, 70)})`);
  check(!/legal in Florida|available in Florida/i.test(await land.page.locator("#app").innerText()) || /isn't available|not available/i.test(await land.page.locator("#app").innerText()), "props landing does not call DraftKings or FanDuel legal in Florida");
  const appText = await land.page.locator("#app").innerText();
  check(!/DraftKings is legal|FanDuel is legal|legal online sportsbook is DraftKings|legal online sportsbook is FanDuel/i.test(appText), "no claim that DraftKings or FanDuel are a legal Florida book");
  await land.ctx.close();

  const withFile = await open(1280, 700, "#/props", { propsFile: true });
  await withFile.page.waitForSelector("#psGames .ps-row a[href$='/props']", { timeout: 15000 });
  const nProps = await withFile.page.locator("#psGames a[href$='/props']").count();
  check(nProps > 0, `a props file turns the row links on (${nProps})`);
  await withFile.ctx.close();

  const nhlLand = await open(375, 812, "#/props/nhl");
  await nhlLand.page.waitForSelector(".ps-note", { timeout: 15000 });
  const nhlView = await nhlLand.page.evaluate(() => ({
    note: document.querySelector(".ps-note").textContent,
    propLinks: document.querySelectorAll("#psGames a[href$='/props']").length,
    body: document.querySelector("#app").innerText.length,
  }));
  check(/NHL/.test(nhlView.note) && /no player-props file/.test(nhlView.note) && nhlView.propLinks === 0 && nhlView.body > 40, "NHL props landing is a note, not a blank page");
  await nhlLand.ctx.close();

  const game = await open(1280, 800, `#/g/nfl/${nflId}`);
  await game.page.waitForSelector(".gjump", { timeout: 15000 });
  const jump = await game.page.evaluate(() => {
    const j = document.querySelector(".gjump").getBoundingClientRect();
    const m = document.querySelector(".match").getBoundingClientRect();
    return { jTop: j.top, mTop: m.top, labels: [...document.querySelectorAll(".gjump a, .gjump span")].map(el => el.textContent.trim()) };
  });
  check(jump.labels.join(",") === "Lines,Props,Stats" && jump.jTop < jump.mTop && jump.jTop < 700, `game tabs sit above the matchup (${jump.jTop} vs ${jump.mTop})`);
  await game.ctx.close();

  const gProps = await open(375, 812, `#/g/nfl/${nflId}/props`);
  await gProps.page.waitForSelector(".gjump a.on, .gjump span.on", { timeout: 15000 });
  const gp = await gProps.page.evaluate(() => {
    const on = document.querySelector(".gjump .on");
    const pane = document.querySelector("#props, .na-card");
    const jr = document.querySelector(".gjump").getBoundingClientRect();
    const pr = pane.getBoundingClientRect();
    return { on: on && on.textContent.trim(), paneTop: pr.top, jumpTop: jr.top, text: pane.innerText.slice(0, 80), h: window.innerHeight };
  });
  check(gp.on === "Props" && gp.paneTop < gp.h && gp.jumpTop < 220, `mobile game props open at the top (${gp.jumpTop}, pane ${gp.paneTop})`);
  await gProps.ctx.close();

  const gStats = await open(1280, 800, `#/g/nfl/${nflId}/stats`);
  await gStats.page.waitForSelector("#stats", { timeout: 15000 });
  const gs = await gStats.page.evaluate(() => {
    const s = document.getElementById("stats").getBoundingClientRect();
    const m = document.querySelector(".match").getBoundingClientRect();
    return { top: s.top, beforeMatch: s.top < m.top, text: document.getElementById("stats").parentElement.innerText.slice(0, 40) };
  });
  check(gs.beforeMatch && gs.top < 500, `game stats sit above the matchup (${gs.top})`);
  await gStats.ctx.close();

  if (nhlId) {
    const nhlg = await open(1280, 700, `#/g/nhl/${nhlId}/props`);
    await nhlg.page.waitForSelector(".na-card", { timeout: 15000 });
    const nh = await nhlg.page.evaluate(() => ({
      off: !!document.querySelector(".gjump span.off"),
      text: document.querySelector(".na-card").innerText,
    }));
    check(nh.off && /no player-props file/.test(nh.text), "NHL game props tab is off and the page says why");
    await nhlg.ctx.close();
  } else check(false, "nhl game id missing");

  const dayOf = iso => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const nbaIdx = JSON.parse(fs.readFileSync("site/data/nba/index.json", "utf8"));
  const todayET = dayOf(new Date().toISOString());
  let nbaSlate = nbaIdx.games.filter(g => dayOf(g.date) === todayET);
  if (!nbaSlate.length) {
    const next = nbaIdx.games.filter(g => g.state !== "post").sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    nbaSlate = next ? nbaIdx.games.filter(g => dayOf(g.date) === dayOf(next.date)) : [];
  }
  const propGame = nbaSlate.find(g => g.state === "pre") || nbaSlate[0];
  check(!!propGame, "nba slate has a game to hang a props fixture on");
  if (propGame) {
    const propDoc = {
      v: 1, lg: "nba", gen: "2026-10-30T12:00:00Z", source: "ESPN", book: "DraftKings", books: ["draftkings"],
      markets: { points: ["Points", "Pts"], rebounds: ["Rebounds", "Reb"] },
      games: { [propGame.id]: { props: [["p1", "points", 24.5, 23.5, [3, 1, 0, 4]], ["p1", "rebounds", 8.5, null, [2, 2, 0, 4]]] } },
      players: { p1: { n: "Test Guard", pos: "G", t: String(propGame.away.id), ta: propGame.away.abbr, log: [["2026-10-28", "BOS", "@", { points: 30, rebounds: 10 }], ["2026-10-26", "NY", "vs", { points: 18, rebounds: 6 }]] } },
    };
    const shown = await open(375, 812, "#/props/nba", { propsBody: propDoc, propsLeague: "nba" });
    await shown.page.waitForSelector("#psProps", { timeout: 15000 });
    await shown.page.waitForSelector(".ps-prop-g .pp-card", { timeout: 15000 });
    const propView = await shown.page.evaluate(() => {
      const card = document.querySelector(".ps-prop-g .pp-card");
      return {
        h: document.querySelector("#app h1").textContent,
        who: card.querySelector(".pp-h").innerText,
        line: card.innerText,
        games: document.querySelectorAll("#psGames .ps-row").length,
        search: !!document.getElementById("psq"),
        groups: document.querySelectorAll(".ps-prop-g").length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        statsH: !!document.querySelector("#psStats"),
      };
    });
    check(propView.h === "Player props" && /Test Guard/.test(propView.who) && /O\/U 24\.5/.test(propView.line) && propView.groups >= 1, `props landing shows today's lines grouped by game (${propView.who.split("\n")[0]})`);
    check(propView.search && propView.games > 0 && !propView.statsH, `props landing keeps search and the game list (${propView.games} games)`);
    check(propView.overflow <= 1, `props landing at 375 does not scroll sideways (${propView.overflow}px)`);
    const propFoot = await shown.page.locator("#app").innerText();
    check(!/DraftKings is legal|FanDuel is legal|legal in Florida/i.test(propFoot), "props lines do not call DraftKings or FanDuel legal in Florida");
    await shown.ctx.close();
  }

  async function featureText(hash, ready) {
    const o = await open(375, 812, hash);
    await o.page.waitForSelector("#psq", { timeout: 15000 });
    await o.page.waitForFunction(ready, { timeout: 20000 });
    const info = await o.page.evaluate(() => ({
      h: document.querySelector("#app h1").textContent,
      kind: document.querySelector(".ps-page").getAttribute("data-ps"),
      feat: (document.getElementById("psFeature") || {}).innerText || "",
      note: (document.querySelector(".ps-note") || {}).innerText || "",
      games: document.querySelectorAll("#psGames .ps-row").length,
      search: !!document.getElementById("psq"),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      leaders: document.querySelectorAll("#psStats .ps-lead li").length,
      linked: document.querySelectorAll("#psStats a[href^='#/p/']").length,
      plain: document.querySelectorAll("#psStats [data-leader]").length,
    }));
    await o.ctx.close();
    return info;
  }
  const nbaProps = await featureText("#/props/nba", () => !!document.querySelector(".ps-note"));
  const nbaStats = await featureText("#/stats/nba", () => !!document.querySelector("#psStats"));
  check(nbaProps.h === "Player props" && nbaProps.kind === "props" && /aren't in this data update|no player-props file/.test(nbaProps.note), `nba props explains a missing file (${nbaProps.note.slice(0, 70)})`);
  check(nbaStats.h === "Player stats" && nbaStats.kind === "stats" && nbaStats.leaders > 0 && /Points/.test(nbaStats.feat), `nba stats shows season leaders (${nbaStats.leaders} rows)`);
  check(nbaProps.feat !== nbaStats.feat && !/Season leaders/.test(nbaProps.feat) && nbaProps.h !== nbaStats.h, "props and stats landings are not the same view");
  check(nbaProps.search && nbaStats.search && nbaProps.games > 0 && nbaStats.games > 0, `both landings keep search and the game list (${nbaProps.games}, ${nbaStats.games})`);
  check(nbaProps.overflow <= 1 && nbaStats.overflow <= 1, `nba landings at 375 do not scroll sideways (${nbaProps.overflow}, ${nbaStats.overflow})`);

  const nflProps = await featureText("#/props/nfl", () => !!document.querySelector(".ps-note, #psProps"));
  const nflStats = await featureText("#/stats/nfl", () => !!document.querySelector("#psStats"));
  check(nflProps.kind === "props" && nflStats.kind === "stats" && nflProps.feat !== nflStats.feat, "nfl props and stats landings differ");
  check(nflStats.leaders > 0 && /Passing Yards/.test(nflStats.feat), `nfl stats shows passing leaders (${nflStats.leaders} rows)`);
  check(nflProps.search && nflStats.search && nflProps.games > 0 && nflStats.games > 0, `nfl landings keep the search box and a game list (${nflProps.games}, ${nflStats.games})`);
  check(nflProps.overflow <= 1 && nflStats.overflow <= 1, `nfl landings at 375 do not scroll sideways (${nflProps.overflow}, ${nflStats.overflow})`);

  const nbaGames = JSON.parse(fs.readFileSync("site/data/nba/index.json", "utf8")).games;
  const nbaRecs = [];
  for (const g of AC.leaderGameOrder(nbaGames).slice(0, 40)) {
    const d = JSON.parse(fs.readFileSync(`site/data/nba/games/${g.id}.json`, "utf8"));
    for (const x of ((d.detail || {}).leaders) || []) nbaRecs.push(x);
  }
  const topPts = AC.seasonBoards(nbaRecs, 8).find(b => b.cat === "Points").rows[0];
  const linked = await open(375, 812, "#/stats/nba", { searchNba: { name: topPts.player, id: "4242" } });
  await linked.page.waitForFunction(() => [...document.querySelectorAll("#psStats a")].some(a => /\/p\/nba\/4242/.test(a.getAttribute("href") || "") || /\/p\/nba\/4242/.test(a.href)), { timeout: 20000 });
  const linkInfo = await linked.page.evaluate(() => {
    const a = [...document.querySelectorAll("#psStats a")].find(x => /\/p\/nba\/4242/.test(x.getAttribute("href") || "") || /\/p\/nba\/4242/.test(x.href));
    return { text: a ? a.textContent : "" };
  });
  check(linkInfo.text === topPts.player, `a season leader links to the player page (${linkInfo.text || "missing"}, expected ${topPts.player})`);
  await linked.ctx.close();

  const ncaab = await featureText("#/stats/ncaab", () => !!document.querySelector("#psStats"));
  check(/don't include season leaders/.test(ncaab.feat) && ncaab.search && ncaab.h === "Player stats", "a league without leader data says so instead of going blank");
  check(ncaab.overflow <= 1, `ncaab stats at 375 does not scroll sideways (${ncaab.overflow}px)`);

  const phoneNav = await open(375, 812, "#/");
  await phoneNav.page.waitForSelector("#bnav [data-nav='stats']", { timeout: 15000 });
  const icons = await phoneNav.page.evaluate(() => {
    const use = sel => { const u = document.querySelector(sel); return u ? u.getAttribute("href") : ""; };
    const stats = (document.getElementById("i-stats") || {}).innerHTML || "";
    const trend = (document.getElementById("i-trend") || {}).innerHTML || "";
    const value = (document.querySelector("#bnav [data-nav='value'] svg") || {}).innerHTML || "";
    return { nav: use("#bnav [data-nav='stats'] use"), head: use("#statsBtn use"), stats: stats.replace(/\s/g, ""), trend: trend.replace(/\s/g, ""), value: value.replace(/\s/g, "") };
  });
  check(icons.nav === "#i-stats" && icons.head === "#i-stats" && icons.stats && icons.stats !== icons.trend && icons.value !== icons.stats, "mobile Stats icon is not the Value trend arrow");
  await phoneNav.ctx.close();

  check(odds.length === 0, `no Odds API or geo calls (${odds.length})`);
  check(!pageErrs.length, `no page errors (${pageErrs.slice(0, 3).join(" | ")})`);
} finally {
  await browser.close();
  srv.close();
}

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
