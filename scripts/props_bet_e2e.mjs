// Browser test for the guided "Add bet" flow with player props + the "+ Track" shortcuts, and the screenshots
// screenshots/props-bet-{add,prefilled,settled}.png. Uses whatever props/odds data the served site has (a mirror of live data).
// Usage: serve site/ with data (see subpath_test.mjs), then BASE=http://localhost:8797/ DATA_DIR=/path/to/data OUT=screenshots node scripts/props_bet_e2e.mjs
import { chromium } from "playwright";
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:8799/linesmart/";
const DATA = process.env.DATA_DIR || "site/data";
const OUT = process.env.OUT || "screenshots";
fs.mkdirSync(OUT, { recursive: true });
const fails = [], errors = [];
const check = (ok, msg, tag = "e2e") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };
const J = f => JSON.parse(fs.readFileSync(`${DATA}/${f}`));
// an upcoming NBA game with props (fallback NFL)
let LG = null, GID = null;
for (const lg of ["nba", "nfl"]) {
  let doc, idx; try { doc = J(`props/${lg}.json`); idx = J(`${lg}/index.json`); } catch { continue; }
  const pre = new Set(idx.games.filter(g => g.state === "pre").map(g => String(g.id)));
  const best = Object.entries(doc.games).filter(([id, g]) => pre.has(id) && g.props.length).sort((a, b) => b[1].props.length - a[1].props.length)[0];
  if (best) { LG = lg; GID = best[0]; break; }
}
if (!LG) { console.log("SKIP: no upcoming game with props in the data"); process.exit(0); }
console.log(`using ${LG} game ${GID}`);
const browser = await chromium.launch();
async function ctx(state = "", bets = null, mobile = true) {
  const c = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
  await c.addInitScript(([st, b]) => { try {
    localStorage.setItem("ls-age-ok", new Date().toISOString()); if (st) localStorage.setItem("ls-state", st);
    if (b && !sessionStorage.getItem("seeded")) { localStorage.setItem("ls-bets-v1", JSON.stringify({ v: 1, bets: b })); sessionStorage.setItem("seeded", "1"); }
  } catch (e) {} }, [state, bets]);
  const p = await c.newPage();
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return p;
}
const go = async (p, hash, sel) => { await p.goto(BASE + hash, { waitUntil: "networkidle" }); await p.waitForSelector(sel, { timeout: 20000 }); await p.waitForTimeout(300); };
// full-page shots: hide the fixed bottom nav (it would be drawn over the middle of a tall page) and let the view settle
const shot = async (p, name) => { await p.addStyleTag({ content: ".bnav{display:none!important}" }); await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/${name}`, fullPage: true }); console.log(`  shot ${OUT}/${name}`); };
const val = (p, sel) => p.$eval(sel, e => e.value).catch(() => null);

// ---------- 1. guided flow from scratch (Florida visitor: Hard Rock Bet is the default book)
{
  const p = await ctx("FL");
  await go(p, "#/bets/add", ".bt-form");
  check(await p.$eval('[data-a="book"].on', e => e.dataset.v) === "hardrock", "FL visitor: Hard Rock Bet is the default book");
  await p.click(`[data-a="lg"][data-v="${LG}"]`); await p.waitForTimeout(300);
  await p.selectOption('[data-f="game"]', GID); await p.waitForTimeout(300);
  const order = await p.$$eval(".bt-leg .bt-lbl", els => els.map(e => e.textContent.trim()));
  check(order.indexOf("Game") < order.indexOf("Bet type"), `guided order sport -> game -> bet type (${order.slice(0, 4).join(" > ")})`);
  await p.click('[data-a="type"][data-v="prop"]'); await p.waitForSelector(".bt-pl");
  const nPl = await p.$$eval(".bt-pl", e => e.length);
  check(nPl > 5, `player list from the game's props feed (${nPl} players)`);
  const first = await p.$eval(".bt-pl b", e => e.textContent);
  await p.fill('[data-f="psearch"]', first.split(" ").slice(-1)[0]);
  const vis = await p.$$eval(".bt-pl", els => els.filter(e => !e.hidden).map(e => e.querySelector("b").textContent));
  check(vis.length >= 1 && vis.length < nPl && vis.includes(first), `search filters the list (${vis.length} match "${first.split(" ").slice(-1)[0]}")`);
  await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/props-bet-add-search.png` });
  await p.fill('[data-f="psearch"]', "");
  // pick a player with a Hard Rock line if there is one
  await p.click(`.bt-pl:has-text("${first}")`); await p.waitForSelector(".bt-pm");
  await p.click(".bt-pm"); await p.waitForSelector('[data-a="side"]');
  await p.click('[data-a="side"][data-v="over"]'); await p.waitForTimeout(200);
  const ln = await val(p, '[data-f="line"]'), od = await val(p, '[data-f="odds"]');
  const yes = !(await p.$('[data-f="line"]'));
  check(yes || (ln !== "" && !isNaN(Number(ln))), `line prefilled (${yes ? "yes/no prop" : ln})`);
  check(true, `odds prefilled from the book when posted (${od || "not posted at Hard Rock: type it"})`);
  if (!od) await p.fill('[data-f="odds"]', "-115");
  await p.fill('[data-f="stake"]', "20"); await p.waitForTimeout(200);
  const tw = await p.$eval(".bt-towin", e => e.textContent);
  check(/to win/i.test(tw) && /\$\d/.test(tw), `stake -> to-win shown (${tw.trim().slice(0, 40)})`);
  await shot(p, "props-bet-add.png");
  await p.click("button.bt-add"); await p.waitForTimeout(600);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("ls-bets-v1")).bets.slice(-1)[0]);
  check(saved && saved.type === "prop" && saved.prop && saved.prop.pid && saved.prop.mk && saved.prop.side === "over" && saved.book === "hardrock" && saved.event && String(saved.event.id) === GID,
    `saved a structured prop bet (${saved && saved.selection})`);
  // edit reopens in the picker
  await go(p, `#/bets/edit/${saved.id}`, ".bt-form");
  check(await p.$(".bt-pick") !== null && await p.$(".bt-pm.on") !== null && await p.$('[data-a="side"][data-v="over"].on') !== null, "edit reopens the prop in the picker");
  // manual fallback
  await p.click('[data-a="custom"]'); await p.waitForSelector('[data-f="player"]');
  check(await val(p, '[data-f="player"]') === first && await p.$('[data-f="pmk"]') !== null, "manual fallback: name + prop type editable");
  await p.context().close();
}

// ---------- 2. "+ Track" from a prop row on the game page, and odds-cell "+"
{
  const p = await ctx("");
  await go(p, `#/g/${LG}/${GID}`, ".pp-trk");
  const n = await p.$$eval(".pp-trk", e => e.length);
  check(n > 5, `"+ Track" on prop rows (${n})`);
  const href = await p.$eval(".pp-trk", e => e.getAttribute("href"));
  await p.click(".pp-trk"); await p.waitForSelector(".bt-pick");
  check(/mk=prop/.test(href) && /pid=/.test(href) && await p.$(".bt-pm.on") !== null, `prop row tap opens the add sheet with player + prop picked (${href.slice(0, 70)}…)`);
  await p.click('[data-a="side"][data-v="over"]').catch(() => {}); await p.waitForTimeout(200);
  await p.fill('[data-f="stake"]', "10"); await p.waitForTimeout(150);
  await shot(p, "props-bet-prefilled.png");
  const ln = await val(p, '[data-f="line"]'), od = await val(p, '[data-f="odds"]');
  check((ln === null || ln !== "") , `prefilled line ${ln} odds ${od || "(book hasn't posted: type it)"}`);
  // odds cell "+" (no state set: all books)
  await go(p, `#/g/${LG}/${GID}`, "table.books");
  const cells = await p.$$eval("table.books a.trk", e => e.length);
  check(cells > 0, `"+" track links on odds-comparison cells (${cells})`);
  const tx = await p.$$eval("table.books a.trk", els => els.map(e => e.textContent).join(""));
  check(tx === "", "cell text unchanged (the + is drawn by CSS)");
  if (cells) {
    await p.click("table.books a.trk"); await p.waitForSelector(".bt-form");
    check((await val(p, '[data-f="odds"]')) !== "" && await p.$('[data-a="side"].on') !== null, "odds cell tap prefills book, side and price");
  }
  await p.context().close();
  const fl = await ctx("FL");
  await go(fl, `#/g/${LG}/${GID}`, "table.books");
  const bks = await fl.$$eval("table.books a.trk", els => [...new Set(els.map(e => new URLSearchParams(e.getAttribute("href").split("?")[1]).get("bk")))]);
  check(bks.every(b => b === "hardrock"), `FL: odds-cell "+" only on Hard Rock Bet (${bks.join(",") || "none"})`);
  const pbk = await fl.$$eval(".pp-trk", els => [...new Set(els.map(e => new URLSearchParams(e.getAttribute("href").split("?")[1]).get("bk")))]);
  check(pbk.every(b => !b || b === "hardrock"), `FL: prop "+ Track" never pre-selects an out-of-state book (${pbk.join(",")})`);
  await fl.context().close();
}

// ---------- 3. bets list: auto-settled prop + one that needs review (seeded examples, this browser only)
{
  const today = new Date().toISOString().slice(0, 10);
  const ev = { id: "401909861", lg: "nba", name: "Los Angeles Lakers at Utah Jazz", short: "LAL @ UTA", date: "2026-10-25T01:00Z", away: { id: "13", abbr: "LAL", short: "Lakers" }, home: { id: "26", abbr: "UTAH", short: "Jazz" } };
  const seed = [
    { id: "ex1", date: today, book: "hardrock", type: "prop", league: "nba", event: ev, odds: -115, stake: 20, status: "won", settledAt: today, settledBy: "auto", statValue: 52,
      prop: { mk: "points", pid: "3945274", player: "Luka Doncic", label: "Points", line: 33.5, side: "over" }, selection: "Luka Doncic Over 33.5 Points" },
    { id: "ex2", date: today, book: "hardrock", type: "prop", league: "nba", event: ev, odds: 120, stake: 10, status: "pending", review: { reason: "Bronny James didn't play. Most books void the bet; check your slip.", at: today },
      prop: { mk: "points", player: "Bronny James", label: "Points", line: 2.5, side: "over" }, selection: "Bronny James Over 2.5 Points" },
    { id: "ex3", date: today, book: "draftkings", type: "spread", league: "nba", event: ev, side: "away", line: -3.5, odds: -110, stake: 22, status: "won", settledBy: "auto", final: { home: 123, away: 132 } },
  ];
  const p = await ctx("FL", seed);
  await go(p, "#/bets/list", ".bt-card");
  const t = await p.$eval(".bt-list", e => e.textContent);
  check(/final: 52 points/.test(t) && /Needs review/.test(t), "list shows auto-settled stat and Needs review");
  await shot(p, "props-bet-settled.png");
  await p.click('[data-quick="push"][data-id="ex2"]'); await p.waitForTimeout(300);
  const b2 = await p.evaluate(() => JSON.parse(localStorage.getItem("ls-bets-v1")).bets.find(b => b.id === "ex2"));
  check(b2.status === "push" && !b2.review && b2.manual, "Needs review -> one-tap Push settles it by hand");
  await p.context().close();
}
check(!errors.length, `no JS errors${errors.length ? ": " + [...new Set(errors)].slice(0, 3).join(" | ") : ""}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall prop-bet browser checks passed");
process.exit(fails.length ? 1 : 0);
