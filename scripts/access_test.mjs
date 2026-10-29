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

// ---------- static wiring
const idx = fs.readFileSync("site/index.html", "utf8");
const sw = fs.readFileSync("site/sw.js", "utf8");
const app = fs.readFileSync("site/assets/app.js", "utf8");
const bnav = (idx.match(/<nav class="bnav"[\s\S]*?<\/nav>/) || [""])[0];
check(/id="propsBtn" href="#\/props"/.test(idx) && /id="statsBtn" href="#\/stats"/.test(idx), "desktop nav has Props and Stats");
check(/data-nav="props"/.test(bnav) && /data-nav="stats"/.test(bnav) && /href="#\/props"/.test(bnav) && /href="#\/stats"/.test(bnav), "mobile menu has Props and Stats");
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

  check(odds.length === 0, `no Odds API or geo calls (${odds.length})`);
  check(!pageErrs.length, `no page errors (${pageErrs.slice(0, 3).join(" | ")})`);
} finally {
  await browser.close();
  srv.close();
}

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
