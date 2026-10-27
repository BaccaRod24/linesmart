// Unit tests for the My Bets tracker math (site/assets/bets-core.js). No browser needed.
// Usage: node scripts/bets_test.mjs
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const C = require("../site/assets/bets-core.js");
const fails = [];
const check = (ok, msg, tag = "bets") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };
const near = (a, b, eps = 0.005) => a !== null && b !== null && Math.abs(a - b) <= eps;
const bet = o => ({ id: "t", stake: 100, status: "pending", type: "ml", ...o });

// ---------- American odds payouts
check(near(C.winProfit(100, -110), 90.91), "-110: $100 wins $90.91", "odds");
check(near(C.winProfit(110, -110), 100), "-110: $110 wins $100", "odds");
check(near(C.winProfit(100, 150), 150), "+150: $100 wins $150", "odds");
check(near(C.winProfit(25, -250), 10), "-250: $25 wins $10", "odds");
check(near(C.winProfit(10, 100), 10) && near(C.winProfit(10, -100), 10), "even money ±100", "odds");
check(near(C.toDecimal(-200), 1.5) && near(C.toDecimal(300), 4), "decimal conversion (-200→1.5, +300→4.0)", "odds");
check(C.toAmerican(2.5) === 150 && C.toAmerican(1.5) === -200 && C.toAmerican(2) === 100, "decimal→American round trip", "odds");
check(!C.validAmerican(50) && !C.validAmerican(-99) && !C.validAmerican("abc") && C.validAmerican("-110"), "rejects invalid American odds (|odds|<100, text)", "odds");
check(near(C.impliedProb(-110), 0.5238, 0.0001) && near(C.impliedProb(100), 0.5), "implied probability", "odds");
check(near(C.netResult(bet({ status: "won", odds: -110 })), 90.91) && near(C.payout(bet({ status: "won", odds: -110 })), 190.91), "won -110 bet: net +90.91, payout 190.91", "odds");
check(C.netResult(bet({ status: "won", odds: 250, stake: 20 })) === 50, "won +250 bet ($20) nets +$50", "odds");
check(C.netResult(bet({ status: "lost", odds: 250, stake: 20 })) === -20, "lost bet nets −stake", "odds");
check(C.netResult(bet({ status: "pending", odds: -110 })) === 0, "pending bet nets 0", "odds");
check(C.netResult(bet({ status: "cashout", cashout: 62.5, odds: 200, stake: 50 })) === 12.5 && C.netResult(bet({ status: "cashout", cashout: 20, stake: 50 })) === -30, "cash-out nets cashout − stake (profit or loss)", "odds");
check(C.toWin(bet({ odds: -120, stake: 24 })) === 20, "to-win for pending -120 $24 = $20", "odds");

// ---------- push / void
check(C.netResult(bet({ status: "push", odds: -110 })) === 0 && C.payout(bet({ status: "push", odds: -110 })) === 100, "push: net 0, stake returned", "push");
check(C.netResult(bet({ status: "void", odds: 300 })) === 0 && C.payout(bet({ status: "void", odds: 300 })) === 100, "void: net 0, stake returned", "push");
{
  const s = C.summarize([bet({ status: "won", odds: 100 }), bet({ status: "lost", odds: 100 }), bet({ status: "push", odds: 100 }), bet({ status: "void", odds: 100 })]);
  check(s.won === 1 && s.lost === 1 && s.push === 1 && s.winRate === 0.5, "win rate excludes pushes (1-1-1 → 50%)", "push");
  check(s.staked === 300 && s.net === 0, "void excluded from staked; push included (staked 300, net 0)", "push");
}

// ---------- parlays
const L = (odds, result) => ({ odds, result });
check(C.parlayAmerican([L(-110), L(-110)]) === 264, "2 × -110 = +264", "parlay");
check(C.parlayAmerican([L(-110), L(-110), L(-110)]) === 596, "3 × -110 = +596", "parlay");
check(C.parlayAmerican([L(150), L(-200)]) === 275, "+150 × -200 = +275", "parlay");
check(C.parlayAmerican([L(-110), L(null)]) === null, "missing leg odds → no combined price", "parlay");
check(C.parlayStatus([L(-110, "won"), L(-110, "lost")]) === "lost", "any lost leg → lost", "parlay");
check(C.parlayStatus([L(-110, "won"), L(-110)]) === "pending", "open leg → pending", "parlay");
check(C.parlayStatus([L(-110, "won"), L(-110, "won")]) === "won", "all legs won → won", "parlay");
check(C.parlayStatus([L(-110, "push"), L(-110, "void")]) === "push", "all legs push/void → push", "parlay");
check(C.parlayStatus([L(-110, "won"), L(-110, "push")]) === "won", "won + push → won (reduced)", "parlay");
{
  const p = { type: "parlay", stake: 10, status: "won", odds: 596, legs: [L(-110, "won"), L(-110, "won"), L(-110, "won")] };
  check(near(C.netResult(p), 59.6), "3-leg -110 parlay ($10) wins $59.60", "parlay");
  const pr = { ...p, legs: [L(-110, "won"), L(-110, "push"), L(-110, "won")] };
  check(near(C.netResult(pr), 26.45, 0.01), "pushed leg drops out: re-priced to 2 legs (+264) → $26.45", "parlay");
  const pm = { type: "parlay", stake: 10, status: "won", odds: 700, oddsManual: true, legs: [L(-110, "won"), L(-110, "won"), L(-110, "won")] };
  check(near(C.netResult(pm), 70), "manual ticket odds (boost +700) used when no leg pushes", "parlay");
  const pp = { type: "parlay", stake: 10, status: "push", legs: [L(-110, "push"), L(-110, "push")] };
  check(C.netResult(pp) === 0 && C.payout(pp) === 10, "all-push parlay refunds stake", "parlay");
  check(near(C.toWin({ type: "parlay", stake: 10, legs: [L(-110), L(-110)] }), 26.45, 0.01), "to-win from legs when no ticket odds", "parlay");
}

// ---------- settlement: ML / spread / total
const F = (home, away, extra = {}) => ({ home, away, completed: true, status: "STATUS_FINAL", ...extra });
const G = (sel, f) => C.gradeSelection({ league: "nfl", ...sel }, f);
check(G({ type: "ml", side: "home" }, F(24, 17)) === "won" && G({ type: "ml", side: "away" }, F(24, 17)) === "lost", "ML: winner won, loser lost", "settle");
check(G({ type: "ml", side: "home" }, F(20, 20)) === "push", "ML tie (NFL) → push", "settle");
check(C.gradeSelection({ league: "epl", type: "ml", side: "home" }, F(1, 1)) === "lost" && C.gradeSelection({ league: "epl", type: "ml", side: "draw" }, F(1, 1)) === "won", "soccer 3-way: home loses on draw, draw wins", "settle");
check(C.gradeSelection({ league: "epl", type: "ml", side: "draw" }, F(2, 1)) === "lost", "soccer draw pick loses on decision", "settle");
check(C.gradeSelection({ league: "ucl", type: "ml", side: "home" }, F(2, 1, { status: "STATUS_FINAL_PEN" })) === null, "soccer after penalties → manual", "settle");
check(G({ type: "spread", side: "home", line: -3.5 }, F(24, 20)) === "won", "home -3.5 wins by 4 → won", "settle");
check(G({ type: "spread", side: "home", line: -3.5 }, F(23, 20)) === "lost", "home -3.5 wins by 3 → lost", "settle");
check(G({ type: "spread", side: "home", line: -3 }, F(23, 20)) === "push", "home -3 wins by 3 → push", "settle");
check(G({ type: "spread", side: "away", line: 3.5 }, F(23, 20)) === "won" && G({ type: "spread", side: "away", line: 3 }, F(23, 20)) === "push", "away +3.5 loses by 3 → won; +3 → push", "settle");
check(G({ type: "spread", side: "away", line: -1.5 }, F(2, 4)) === "won" && G({ type: "spread", side: "away", line: -1.5 }, F(3, 4)) === "lost", "puck/run line -1.5", "settle");
check(C.gradeSelection({ league: "epl", type: "spread", side: "home", line: -0.25 }, F(1, 1)) === null, "quarter (Asian) line → manual", "settle");
check(G({ type: "total", side: "over", line: 44.5 }, F(24, 21)) === "won" && G({ type: "total", side: "under", line: 44.5 }, F(24, 21)) === "lost", "total 45 vs 44.5: over won, under lost", "settle");
check(G({ type: "total", side: "over", line: 45 }, F(24, 21)) === "push" && G({ type: "total", side: "under", line: 45 }, F(24, 21)) === "push", "total lands on 45 → push both sides", "settle");
check(G({ type: "total", side: "under", line: 220.5 }, F(104, 110)) === "won", "NBA under 220.5 (214) won", "settle");
check(G({ type: "ml", side: "home" }, { home: 10, away: 3, completed: false }) === null, "game not final → not graded", "settle");
check(G({ type: "ml", side: "home" }, F(0, 0, { status: "STATUS_POSTPONED" })) === null, "postponed → not graded", "settle");
check(G({ type: "prop", side: "home" }, F(1, 0)) === null, "props are never auto-graded", "settle");
{
  const ev = { id: "401", lg: "nfl" };
  const b = { id: "a", type: "spread", league: "nfl", event: ev, side: "home", line: -3, odds: -110, stake: 50, status: "pending" };
  const finals = { "nfl:401": F(27, 20) };
  const s = C.autoSettle(b, finals, "2026-10-26");
  check(s && s.status === "won" && s.settledBy === "auto" && s.final.home === 27, "autoSettle: pending spread → won with final attached", "settle");
  check(C.autoSettle({ ...b, manual: true }, finals) === null, "autoSettle never overrides a manual result", "settle");
  check(C.autoSettle({ ...b, status: "lost" }, finals) === null, "autoSettle skips settled bets", "settle");
  check(C.autoSettle(b, {}) === null, "autoSettle no-op without a final", "settle");
  check(JSON.stringify(C.pendingEvents(b)) === JSON.stringify([{ league: "nfl", id: "401", date: undefined }]), "pendingEvents lists the game to look up", "settle");
  const par = { id: "p", type: "parlay", stake: 10, status: "pending", legs: [
    { league: "nfl", type: "ml", event: ev, side: "home", odds: -150 },
    { league: "nba", type: "total", event: { id: "9", lg: "nba" }, side: "over", line: 220.5, odds: -110 }] };
  const p1 = C.autoSettle(par, finals);
  check(p1 && p1.status === "pending" && p1.legs[0].result === "won" && !p1.legs[1].result, "parlay: one leg graded, still pending", "settle");
  const p2 = C.autoSettle(p1, { "nba:9": F(110, 112) });
  check(p2 && p2.status === "won" && near(C.netResult(p2), 10 * (C.toDecimal(-150) * C.toDecimal(-110) - 1), 0.01), "parlay: both legs won → won at combined price", "settle");
  const p3 = C.autoSettle(par, { ...finals, "nba:9": F(100, 100) });
  check(p3 && p3.status === "lost", "parlay: a losing leg → lost", "settle");
}

// ---------- ROI / stats
{
  const list = [bet({ status: "won", odds: -110, stake: 110 }), bet({ status: "lost", odds: -110, stake: 110 }), bet({ status: "won", odds: 200, stake: 50 }), bet({ status: "pending", odds: 150, stake: 40 })];
  const s = C.summarize(list);
  check(s.net === 90 && s.staked === 270, `net +$90 on $270 staked (+100 −110 +100) (got ${s.net} / ${s.staked})`, "roi");
  check(near(s.roi, 90 / 270, 1e-9), `ROI = net/staked = ${(s.roi * 100).toFixed(2)}%`, "roi");
  check(s.exposure === 40 && s.toWinPending === 60 && s.pending === 1, "pending exposure $40, to win $60", "roi");
  check(near(s.winRate, 2 / 3, 1e-9), "win rate 2/3", "roi");
  check(C.roi(-50, 200) === -0.25 && C.roi(10, 0) === null, "roi helper (negative, zero staked → n/a)", "roi");
  check(s.avgOdds === C.toAmerican((C.toDecimal(-110) * 2 + 3 + 2.5) / 4), `avg odds from mean decimal price (${s.avgOdds})`, "roi");
  const cum = C.cumulative([{ ...list[0], date: "2026-10-01" }, { ...list[1], date: "2026-10-03" }, { ...list[2], date: "2026-10-02" }, list[3]]);
  check(cum.length === 3 && cum.map(p => p.v).join() === "100,200,90", `cumulative P/L in date order (${cum.map(p => p.v)})`, "roi");
  const g = C.groupBy([{ ...list[0], book: "draftkings" }, { ...list[1], book: "fanduel" }, { ...list[2], book: "draftkings" }], b => b.book);
  const dk = g.find(r => r.key === "draftkings");
  check(dk.n === 2 && dk.net === 200 && near(dk.roi, 200 / 160, 1e-9), "groupBy book: DraftKings 2 bets, +$200, ROI 125%", "roi");
  const now = new Date("2026-10-26T12:00:00");
  const dated = [{ ...list[0], date: "2026-10-24" }, { ...list[1], date: "2026-10-05" }, { ...list[2], date: "2026-07-20" }];
  check(C.filterBets(dated, { range: "7d" }, now).length === 1 && C.filterBets(dated, { range: "30d" }, now).length === 2 && C.filterBets(dated, { range: "season" }, now).length === 2 && C.filterBets(dated, { range: "all" }, now).length === 3, "date filters 7d / 30d / season (Aug 1) / all", "roi");
}

// ---------- storage / import / export
{
  const demo = JSON.parse(fs.readFileSync(new URL("./fixtures/demo-bets.json", import.meta.url)));
  const bets = C.parseImport(JSON.stringify(demo));
  check(bets.length === demo.bets.length && bets.every(b => b.id && C.STATUS[b.status]), `import demo fixture (${bets.length} bets)`, "data");
  check(C.parseImport(JSON.stringify(demo.bets)).length === bets.length, "import accepts a bare array", "data");
  let threw = false; try { C.parseImport('{"x":1}'); } catch { threw = true; }
  check(threw, "import rejects files without bets", "data");
  const m = C.mergeBets(bets.slice(0, 5), bets.slice(3));
  check(m.bets.length === bets.length && m.added === bets.length - 5 && m.updated === 2, "merge by id (added/updated)", "data");
  const csv = C.toCSV([{ id: "x", date: "2026-10-01", book: "other", bookOther: 'Book, "Q"', type: "prop", selection: "a", odds: -110, stake: 10, status: "won" }], b => b.selection);
  check(csv.split("\r\n")[1].includes('"Book, ""Q"""') && csv.startsWith("id,date,sportsbook"), "CSV quoting/escaping", "data");
  check(C.normalizeBet({ stake: "abc" }) === null && C.normalizeBet({ stake: 5, status: "bogus", type: "x" }).status === "pending", "normalize rejects bad stake, defaults unknown status", "data");
  check(!fs.readdirSync(new URL("../site/", import.meta.url), { recursive: true }).some(f => /demo-bets/.test(String(f))), "demo fixture is not shipped in site/", "data");
}

// ---------- deeper stats (summary tiles, chart, breakdowns, heatmap, units)
{
  const S = (status, day, o = {}) => bet({ status, odds: 100, settledAt: day, date: day, ...o });
  const list = [
    S("won", "2026-10-01"), S("won", "2026-10-02"), S("push", "2026-10-03"), S("cashout", "2026-10-03", { cashout: 40 }),
    S("won", "2026-10-04"), S("lost", "2026-10-05"), S("lost", "2026-10-06"), S("void", "2026-10-06"), S("pending", "2026-10-07"),
  ];
  const st = C.streaks(list);
  check(st.longestWin === 3 && st.longestLoss === 2 && st.current.kind === "L" && st.current.n === 2, "streaks: push / cash-out / void don't break a run (W3, L2, current L2)", "stats");
  check(C.streaks([]).current === null && C.streaks([S("pending", "2026-10-01"), S("void", "2026-10-01")]).current === null, "streaks: none with no settled W/L", "stats");
  const x = C.stats([...list, S("won", "2026-10-08", { odds: 250 }), S("lost", "2026-10-09", { stake: 300 })]);
  check(x.biggestWin.net === 250 && x.biggestLoss.net === -300, "biggest win / loss", "stats");
  check(C.stats([S("lost", "2026-10-01")]).biggestWin === null, "no biggest win when nothing won", "stats");

  const ser = C.dailySeries(list, "all");
  check(ser.length === 6 && ser.map(p => p.v).join() === "100,200,140,240,140,40", "daily cumulative series (push 0, cash-out −60, void & pending skipped)", "stats");
  check(ser[2].n === 2 && ser[2].net === -60, "same-day bets merge into one point", "stats");
  const now = new Date("2026-10-26T14:00:00");
  const r7 = C.dailySeries([S("won", "2026-10-25"), S("lost", "2026-10-10")], "7d", now);
  check(r7.length === 1 && r7[0].v === 100, "7D range restarts at $0 and drops older days", "stats");
  check(C.dayInRange("2026-10-20", "7d", now) && !C.dayInRange("2026-10-10", "7d", now) && C.dayInRange("2026-10-01", "30d", now) && !C.dayInRange("2026-09-01", "30d", now) && C.dayInRange("2020-01-01", "all", now), "dayInRange 7d / 30d / all", "stats");
  const dd = C.drawdown([{ v: 100 }, { v: 300 }, { v: 50 }, { v: 200 }, { v: -20 }]);
  check(dd.peak === 300 && dd.maxDrawdown === 320, "drawdown: peak 300, max drop 320", "stats");
  check(C.drawdown([{ v: -50 }, { v: -80 }]).maxDrawdown === 80 && C.drawdown([]).peak === 0, "drawdown measured from a $0 start", "stats");

  const wd = C.byWeekday([S("won", "2026-10-26"), S("lost", "2026-10-26"), S("won", "2026-10-25")]);   // Mon, Mon, Sun
  check(wd[1].won === 1 && wd[1].lost === 1 && wd[0].won === 1 && wd[0].net === 100 && wd[3].n === 0, "byWeekday groups by settle day", "stats");
  const bd = C.byDay(list);
  check(bd["2026-10-03"].n === 2 && bd["2026-10-03"].net === -60 && !bd["2026-10-07"], "byDay heatmap cells (pending excluded)", "stats");
  check(C.settleDay({ settledAt: "2026-10-03" }) === "2026-10-03" && C.settleDay({ date: "2026-10-02" }) === "2026-10-02", "settleDay falls back to the placed date", "stats");

  check(C.sportOf(bet({ league: "nba" })) === "basketball" && C.sportOf(bet({ league: "ncaaf" })) === "football" && C.sportOf(bet({})) === "other", "sportOf single bets", "stats");
  check(C.sportOf(bet({ type: "parlay", legs: [{ league: "nfl" }, { league: "nba" }] })) === "multi" && C.sportOf(bet({ type: "parlay", legs: [{ league: "nfl" }, { league: "ncaaf" }] })) === "football", "sportOf parlays: mixed → multi, same sport kept", "stats");
  check(C.propMarket(bet({ type: "prop", league: "nba", prop: { mk: "points" } })) === "nba:points" && C.propMarket(bet({ type: "prop", prop: { mk: "other" } })) === "other" && C.propMarket(bet({ type: "prop" })) === "other" && C.propMarket(bet({ type: "parlay" })) === null && C.propMarket(bet({})) === null, "propMarket keys (custom → other, non-props → null)", "stats");
  check(C.propMarketLabel("other") === "Other / custom" && typeof C.propMarketLabel("nba:points") === "string", "propMarketLabel", "stats");

  check(C.toUnits(50, 25) === 2 && C.toUnits(-12.5, 25) === -0.5 && C.toUnits(50, 0) === null && C.toUnits(50, "") === null, "toUnits (null without a unit size)", "stats");
  const rows = [{ key: "a", name: "B", net: 10, roi: null, n: 2 }, { key: "b", name: "a", net: -5, roi: -0.1, n: 5 }, { key: "c", name: "C", net: 30, roi: 0.3, n: 1 }];
  check(C.sortRows(rows, "net").map(r => r.key).join() === "c,a,b" && C.sortRows(rows, "net", "asc").map(r => r.key).join() === "b,a,c", "sortRows by profit desc / asc", "stats");
  check(C.sortRows(rows, "roi").map(r => r.key).join() === "c,b,a" && C.sortRows(rows, "roi", "asc").map(r => r.key).join() === "b,c,a", "sortRows puts nulls last both ways", "stats");
  check(C.sortRows(rows, "name", "asc").map(r => r.key).join() === "b,a,c" && rows[0].key === "a", "sortRows by name (case-insensitive) without mutating", "stats");

  // parlay that pushes / voids counts as a push, not a win; a void straight bet adds nothing to staked
  const pp = bet({ type: "parlay", odds: 264, stake: 20, legs: [{ odds: -110, result: "push" }, { odds: -110, result: "void" }], status: "push", settledAt: "2026-10-04" });
  const ss = C.stats([pp, S("void", "2026-10-04", { stake: 50 }), S("won", "2026-10-04", { stake: 30 })]);
  check(ss.push === 1 && ss.won === 1 && ss.winRate === 1 && ss.staked === 50 && ss.net === 30, "parlay push + void straight bet in stats", "stats");
  // fixture sanity (example data used for screenshots; not shipped)
  const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/stats-bets.json", import.meta.url)));
  const fs2 = C.stats(C.parseImport(JSON.stringify(fx)));
  const last = C.dailySeries(fx.bets).at(-1).v;
  check(near(last, fs2.net) && fs2.n === fx.bets.length, `stats fixture: series ends at net (${fs2.net})`, "stats");
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall bet-tracker unit tests passed");
process.exit(fails.length ? 1 : 0);
