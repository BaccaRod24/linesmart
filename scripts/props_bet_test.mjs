// Unit tests for player-prop bets in the My Bets tracker (site/assets/bets-core.js): box-score parsing,
// prop grading (over/under/push, anytime TD, DNP, missing player, name match), book quotes and auto-settle.
// Fixtures: trimmed ESPN summary responses (scripts/fixtures/espn_summary_{nfl,nba}.json). No browser or network.
// Usage: node scripts/props_bet_test.mjs
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const C = require("../site/assets/bets-core.js");
const PC = require("../site/assets/props-core.js");
const fails = [];
const check = (ok, msg, tag = "props-bet") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };
const fx = n => JSON.parse(fs.readFileSync(new URL(`./fixtures/espn_summary_${n}.json`, import.meta.url)));
const NFL = C.boxScore(fx("nfl"), "nfl"), NBA = C.boxScore(fx("nba"), "nba");
const byName = (box, n) => Object.entries(box.players).find(([, p]) => p.name === n) || [];

// ---------- box score parsing
check(NFL.final && NFL.final.completed && NFL.final.home === 10 && NFL.final.away === 16, "NFL final PIT@NO 16-10, completed", "box");
check(NBA.final && NBA.final.completed && NBA.final.home === 123 && NBA.final.away === 132, "NBA final LAL@UTA 132-123, completed", "box");
const [, warren] = byName(NFL, "Jaylen Warren"), [, vele] = byName(NFL, "Devaughn Vele"), [, rodgers] = byName(NFL, "Aaron Rodgers");
check(warren && warren.st.ry === 101, "NFL rushing yards (Warren 101)", "box");
check(vele && vele.st.rec === 5 && vele.st.recy === 54 && vele.st.rectd === 1, "NFL receiving (Vele 5 rec, 54 yds, 1 TD)", "box");
check(rodgers && rodgers.st.py === 212 && rodgers.st.cmp === 19 && rodgers.st.att === 30 && rodgers.st.ptd === 1, "NFL passing (Rodgers 19/30, 212, 1 TD) incl. 'C/ATT' split", "box");
const [lukaId, luka] = byName(NBA, "Luka Doncic");
check(luka && luka.st.pts === 52 && luka.st.reb === 8 && luka.st.ast === 10 && luka.st.tpm === 8, "NBA line (Doncic 52/8/10, 8 threes from 'M-A')", "box");
const [, bronny] = byName(NBA, "Bronny James");
check(bronny && bronny.dnp === true, "NBA didNotPlay row -> dnp", "box");
check(!C.boxScore(null, "nba").final && !C.boxScore({}, "nfl").hasBox, "empty / missing summary is safe", "box");

// ---------- grading
const fN = { ...NFL.final, box: NFL }, fB = { ...NBA.final, box: NBA };
const nfl = (pr, extra = {}) => ({ type: "prop", league: "nfl", event: { id: "401873011", lg: "nfl" }, prop: pr, ...extra });
const nba = pr => ({ type: "prop", league: "nba", event: { id: "401909861", lg: "nba" }, prop: pr });
const g = (s, f) => C.gradeProp(s, f) || {};
check(g(nfl({ mk: "rush_yds", player: "Jaylen Warren", line: 85.5, side: "over" }), fN).result === "won", "over 85.5 rush yds, 101 -> won", "grade");
check(g(nfl({ mk: "rush_yds", player: "Jaylen Warren", line: 85.5, side: "under" }), fN).result === "lost", "under 85.5 rush yds, 101 -> lost", "grade");
check(g(nfl({ mk: "receptions", player: "Devaughn Vele", line: 5, side: "over" }), fN).result === "push", "whole-number line equal to stat -> push", "grade");
check(g(nfl({ mk: "rec_yds", player: "Devaughn Vele", line: 54.5, side: "under" }), fN).value === 54, "returns the stat value (54)", "grade");
check(g(nfl({ mk: "pass_yds", player: "Aaron Rodgers", line: 225.5, side: "under" }), fN).result === "won", "pass yds under", "grade");
check(g(nfl({ mk: "pass_rush_yds", player: "Aaron Rodgers", line: 200.5, side: "over" }), fN).result === "won", "combo market (pass + rush)", "grade");
check(g(nfl({ mk: "anytime_td", player: "Devaughn Vele", side: "over" }), fN).result === "won", "anytime TD yes (receiving TD), no line needed", "grade");
check(g(nfl({ mk: "anytime_td", player: "Aaron Rodgers", side: "under" }), fN).result === "won", "anytime TD no: passing TDs don't count for the passer", "grade");
check(g(nfl({ mk: "anytime_td", player: "Jaylen Warren", side: "over" }), fN).result === "lost", "anytime TD yes, no TD -> lost", "grade");
check(g(nba({ mk: "points", pid: lukaId, player: "Luka Dončić", line: 33.5, side: "over" }), fB).result === "won", "NBA points by ESPN id", "grade");
check(g(nba({ mk: "points", player: "luka doncic", line: 33.5, side: "over" }), fB).result === "won", "name match ignores case and accents", "grade");
check(g(nba({ mk: "pra", player: "Luka Doncic", line: 70, side: "over" }), fB).result === "push", "PRA 52+8+10 = 70 -> push", "grade");
check(g(nba({ mk: "threes", player: "Luka Doncic", line: 4.5, side: "under" }), fB).result === "lost", "threes under", "grade");
const dnp = g(nba({ mk: "points", player: "Bronny James", line: 2.5, side: "over" }), fB);
check(dnp.result === "review" && /didn't play/.test(dnp.reason), "DNP -> needs review (books usually void)", "grade");
const miss = g(nfl({ mk: "rush_yds", player: "Not A Player", line: 10.5, side: "over" }), fN);
check(miss.result === "review" && /isn't in the box score/.test(miss.reason), "player not in box score -> needs review", "grade");
check(g(nfl({ mk: "first_td", player: "Jaylen Warren", line: 0.5, side: "over" }), fN).result === "review", "unknown prop type -> needs review", "grade");
check(g(nfl({ mk: "rush_yds", player: "Jaylen Warren", line: 85.5 }), fN).result === "review", "missing Over/Under -> needs review", "grade");
check(C.gradeProp(nfl({ mk: "rush_yds", player: "Jaylen Warren", line: 85.5, side: "over" }), { ...fN, completed: false }) === null, "not final yet -> null (try later)", "grade");
check(g(nfl({ mk: "rush_yds", player: "Jaylen Warren", line: 85.5, side: "over" }), { ...fN, status: "STATUS_POSTPONED" }).result === "review", "postponed -> review", "grade");
check(g(nfl({ mk: "rush_yds", player: "Jaylen Warren", line: 85.5, side: "over" }), { ...NFL.final }).result === "review", "final without box score -> review", "grade");
// every props-feed market has a settlement getter (keys match scripts/props.py NFL_MARKETS / NBA_MARKETS)
const PY = fs.readFileSync(new URL("./props.py", import.meta.url), "utf8");
for (const lg of ["nfl", "nba"]) {
  const block = PY.split(`${lg.toUpperCase()}_MARKETS = [`)[1].split("\n]")[0];
  const feed = [...block.matchAll(/^\s*\("([a-z_]+)",/gm)].map(m => m[1]);
  const missing = feed.filter(k => !C.PROP_MARKETS[lg][k]);
  check(feed.length >= 8 && !missing.length, `${lg}: all ${feed.length} props-feed markets can auto-settle${missing.length ? ` (missing ${missing})` : ""}`, "markets");
}

// ---------- describe / quote
check(C.describeProp({ league: "nfl", prop: { mk: "pass_yds", player: "Jordan Love", line: 259.5, side: "over" } }) === "Jordan Love Over 259.5 Passing yards", "describe over/under prop", "ui");
check(C.describeProp({ league: "nfl", prop: { mk: "anytime_td", player: "A.J. Brown", side: "over" } }) === "A.J. Brown Anytime TD: Yes", "describe anytime TD", "ui");
const books = [{ key: "draftkings", line: 24.5, over: -115, under: -105 }, { key: "hardrockbet", line: 25.5, over: -110, under: -120 }];
const q1 = C.propQuote(books, "hardrock", "under", 24.5);
check(q1.posted && q1.line === 25.5 && q1.odds === -120, "quote uses the chosen book's own line and price (Hard Rock)", "ui");
const q2 = C.propQuote(books, "fanduel", "over", 24.5);
check(!q2.posted && q2.line === 24.5 && q2.odds === null, "book without the prop: feed line, odds left to type", "ui");
// PropsCore.rowBooks shape feeds propQuote directly
const rb = PC.rowBooks(["p1", "points", 24.5, 24.5, null, { draftkings: [24.5, -115, -105, null], hardrockbet: [25.5, -110, -120, null] }], PC.BOOK_ORDER);
check(C.propQuote(rb, "hardrock", "over", 24.5).odds === -110, "works on PropsCore.rowBooks() output", "ui");

// ---------- auto-settle
const NOW = "2026-10-27T03:00:00.000Z";
const finals = { "nfl:401873011": fN, "nba:401909861": fB };
const single = { id: "a", stake: 20, odds: -110, status: "pending", book: "hardrock", ...nfl({ mk: "rush_yds", pid: "", player: "Jaylen Warren", line: 85.5, side: "over" }) };
check(C.canAutoSettle(single) && C.pendingEvents(single)[0].box === true, "prop bet asks for the box score", "settle");
const s1 = C.autoSettle(single, finals, NOW);
check(s1 && s1.status === "won" && s1.settledBy === "auto" && s1.statValue === 101, "single prop auto-settles won with stat value", "settle");
const rv = C.autoSettle({ ...single, prop: { ...single.prop, player: "Ghost" } }, finals, NOW);
check(rv && rv.status === "pending" && rv.review && C.needsReview(rv), "unmatched player -> stays pending + needs review", "settle");
check(!C.canAutoSettle(rv) && C.autoSettle(rv, finals, NOW) === null, "reviewed bet isn't re-graded on every visit", "settle");
check(C.autoSettle({ ...single, manual: true }, finals, NOW) === null, "hand-settled bets untouched", "settle");
check(C.autoSettle(single, {}, NOW) === null, "no final yet -> unchanged", "settle");
const legacy = { id: "old", stake: 10, odds: 150, status: "pending", type: "prop", selection: "Jalen Hurts over 1.5 pass TD", event: { id: "401873011", lg: "nfl" }, league: "nfl" };
check(!C.canAutoSettle(legacy) && C.autoSettle(legacy, finals, NOW) === null && C.pendingEvents(legacy).length === 0, "old free-text prop bets stay manual (no migration needed)", "settle");
const par = { id: "p", stake: 10, status: "pending", type: "parlay", legs: [
  { type: "ml", league: "nfl", event: { id: "401873011", lg: "nfl" }, side: "away", odds: -150 },
  { ...nba({ mk: "points", player: "Luka Doncic", line: 33.5, side: "over" }), odds: -110 },
  { ...nfl({ mk: "receptions", player: "Devaughn Vele", line: 4.5, side: "over" }), odds: 120 }] };
const p1 = C.autoSettle(par, finals, NOW);
check(p1 && p1.status === "won" && p1.legs[1].result === "won" && p1.legs[1].statValue === 52, "parlay with prop legs settles", "settle");
const par2 = { ...par, legs: [par.legs[0], { ...par.legs[1], prop: { ...par.legs[1].prop, player: "Bronny James" } }] };
const p2 = C.autoSettle(par2, finals, NOW);
check(p2 && p2.status === "pending" && p2.legs[1].review && C.needsReview(p2) && p2.legs[0].result === "won", "parlay leg that can't be graded -> parlay needs review", "settle");
const p3 = C.autoSettle({ ...par, legs: [par.legs[0], { ...par.legs[2], prop: { ...par.legs[2].prop, side: "under" } }] }, finals, NOW);
check(p3 && p3.status === "lost", "parlay loses on a lost prop leg", "settle");
// round trip through export/import keeps the prop + review fields
const rt = C.parseImport(JSON.stringify({ bets: [s1, rv] }));
check(rt[0].prop && rt[0].statValue === 101 && rt[1].review && rt[1].prop.player === "Ghost", "export/import keeps prop, statValue and review", "settle");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall prop-bet unit tests passed");
process.exit(fails.length ? 1 : 0);
