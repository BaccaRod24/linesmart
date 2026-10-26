// Unit tests for the player-props logic (site/assets/props-core.js). No browser needed.
// Usage: node scripts/props_test.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const P = require("../site/assets/props-core.js");

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} props-core: ${msg}`); if (!ok) fails++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

check(P.grade(26, 24.5) === "o" && P.grade(20, 24.5) === "u" && P.grade(25, 25) === "p" && P.grade(null, 3) === null, "grade over/under/push/none");

const log = [["2026-10-25", "DDD", "vs", null], ["2026-10-24", "CCC", "@", { points: 20 }], ["2026-10-22", "BBB", "vs", { points: 30 }],
  ["2026-10-20", "EEE", "@", { points: 24.5 }], ["2026-10-18", "FFF", "vs", { points: 28 }], ["2026-10-16", "GGG", "vs", { points: 10 }],
  ["2026-10-14", "HHH", "@", { points: 40 }]];
const s = P.strip(log, "points", 24.5);
check(s.length === 5 && eq(s.map(b => b.r), ["x", "u", "o", "p", "o"]), `strip classes latest first: ${s.map(b => b.r)}`);
check(s[2].v === 30 && s[2].opp === "BBB" && s[2].ha === "vs" && s[0].v === null, "strip keeps values + opponent");
const sm = P.summary(log, "points", 24.5);
check(sm.text === "2/4 over" && sm.missed === 1 && sm.p === 1, `x/5 summary counts games played: ${sm.text}`);
check(P.rate(log, "points", 24.5, 10).o === 3 && P.rate(log, "points", 24.5, 10).n === 6 && P.rate(log, "points", 24.5, 10).pct === 50, "L10 rate");
check(P.summary([], "points", 1).text === "No recent games" && P.strip(null, "points", 1).length === 0, "empty log");
check(P.strip([["2026-10-01", "X", "@", { rebounds: 3 }]], "points", 1)[0].r === "x", "missing market value -> grey");
check(P.season([6, 3, 0, 9]).text === "6/9 (67%)" && P.season([0, 0, 0, 0]).text === "—" && P.season(null).pct === null, "season tally text");
check(P.lineText("pass_yds", 266.5) === "O/U 266.5" && P.lineText("anytime_td", 0.5) === "Scores a TD", "line labels");
check(P.moveText(25.5, 24.5) === "opened 24.5 ▲" && P.moveText(23.5, 24.5) === "opened 24.5 ▼" && P.moveText(24.5, 24.5) === "" && P.moveText(24.5, null) === "", "opening line move");
check(P.fmtNum(3) === "3" && P.fmtNum(2.25) === "2.3" && P.fmtNum(null) === "—", "fmtNum");

// ---------- "Hot" filter: over in >= 4 of last 5 played, or the same share (80%) with fewer games; min 2 games
check([1, 2, 3, 4, 5].map(P.hotNeed).join() === "1,2,3,4,4", `hotNeed by games played: ${[1, 2, 3, 4, 5].map(P.hotNeed)}`);
const L = vals => vals.map((v, i) => [`2026-10-${20 - i}`, "OPP", "vs", v === null ? null : { points: v }]);
check(P.isHot(L([30, 30, 30, 30, 10]), "points", 24.5) === true, "4/5 over is hot");
check(P.isHot(L([30, 30, 30, 10, 10]), "points", 24.5) === false, "3/5 over is not hot");
check(P.isHot(L([30, 30, 30]), "points", 24.5) === true && P.isHot(L([30, 30, 10]), "points", 24.5) === false, "3/3 hot, 2/3 not");
check(P.isHot(L([30, null, 30, 30, 30]), "points", 24.5) === true && P.isHot(L([30, null, 30, 30, 10]), "points", 24.5) === false, "DNP skipped: 4/4 hot, 3/4 not");
check(P.isHot(L([30]), "points", 24.5) === false && P.isHot([], "points", 1) === false, "one game is not enough");
check(P.isHot(L([25, 25, 25, 25, 25]), "points", 25) === false, "pushes are not overs");
check(P.isHot(L([30, 30, 30, 30, 10, 10, 10, 10]), "points", 24.5) === true, "only the last 5 count");

const doc = {
  lg: "nfl", markets: { pass_yds: ["Passing yards", "Pass yds"], rec_yds: ["Receiving yards", "Rec yds"], anytime_td: ["Anytime TD", "Any TD"] },
  games: { "9": { props: [["wr", "rec_yds", 60.5, null, [1, 1, 0, 2]], ["qb", "pass_yds", 250.5, 245.5, [2, 0, 0, 2]], ["wr", "anytime_td", 0.5, null, [0, 2, 0, 2]],
    ["hwr", "rec_yds", 80.5, null, [0, 0, 0, 0]], ["ghost", "rec_yds", 9.5, null, [0, 0, 0, 0]]] } },
  players: { wr: { n: "Away WR", pos: "WR", t: "2", ta: "BBB", log: [] }, qb: { n: "Away QB", pos: "QB", t: "2", ta: "BBB", log: [] }, hwr: { n: "Home WR", pos: "WR", t: "1", ta: "AAA", log: [] } },
};
const g = P.byPlayer(doc, 9, ["2", "1"]);
check(eq(g.map(p => p.pid), ["qb", "wr", "hwr"]), `grouped by player: away first, QB before WR: ${g.map(p => p.pid)}`);
check(eq(g[1].props.map(p => p.mk), ["rec_yds", "anytime_td"]) && g[1].props[0].label === "Receiving yards" && eq(g[1].props[0].tally, [1, 1, 0, 2]), "props per player in market order");
check(P.byPlayer(doc, 1).length === 0 && P.byPlayer(null, 9).length === 0, "unknown game / no doc");
const fp = P.forPlayer(doc, "wr");
check(fp.length === 1 && fp[0].gid === "9" && fp[0].props.length === 2 && P.forPlayer(doc, "nobody").length === 0, "forPlayer");

// ---------- multi-book rows (paid Odds API plan): 6th element {book: [line, over, under, tally|null]}
const mdoc = {
  lg: "nba", books: ["draftkings", "hardrockbet", "fanduel"], markets: { points: ["Points", "Pts"] },
  games: { "5": { props: [
    ["a", "points", 24.5, 23.5, [3, 2, 0, 5], { draftkings: [24.5, null, null, null], hardrockbet: [25.5, -110, -110, [2, 3, 0, 5]], fanduel: [24.5, -105, -120, null] }],
    ["b", "points", 10.5, null, [1, 1, 0, 2], { hardrockbet: [10.5, 100, -130, null] }],
    ["c", "points", 7.5, null, [0, 0, 0, 0]]] } },
  players: { a: { n: "A", t: "1", log: [] }, b: { n: "B", t: "1", log: [] }, c: { n: "C", t: "1", log: [] } },
};
const pa = gid => (pref) => Object.fromEntries(P.byPlayer(mdoc, gid, [], pref).map(p => [p.pid, p.props[0]]));
const dflt = pa(5)(null), fl = pa(5)(["hardrockbet"]), nj = pa(5)(["draftkings", "fanduel", "hardrockbet"]);
check(dflt.a.line === 24.5 && dflt.a.open === 23.5 && dflt.a.book === "draftkings" && eq(dflt.a.tally, [3, 2, 0, 5]), "no prefer: row (DraftKings) line + tally");
check(eq(dflt.a.books.map(b => b.key), ["hardrockbet", "draftkings", "fanduel"]) && dflt.a.books[2].over === -105 && dflt.a.books[1].over === null, "books listed with prices (DK line only)");
check(eq(dflt.a.books[2].tally, [3, 2, 0, 5]) && eq(dflt.a.books[0].tally, [2, 3, 0, 5]), "same-line book reuses row tally, other line keeps its own");
check(fl.a.line === 25.5 && fl.a.book === "hardrockbet" && fl.a.open === null && eq(fl.a.tally, [2, 3, 0, 5]), "Florida (Hard Rock only): graded on Hard Rock's line + tally, no DK opener");
check(nj.a.line === 24.5 && nj.a.book === "draftkings" && nj.a.open === 23.5, "state order DK first: DK line");
check(fl.b.line === 10.5 && fl.b.book === "hardrockbet" && dflt.b.books.length === 1, "Hard Rock-only prop");
check(fl.c.book === "draftkings" && fl.c.line === 7.5 && eq(fl.c.books.map(b => b.key), ["draftkings"]), "legacy 5-element row = DraftKings only; no legal book -> row (DK) line");
const bp = P.bestPrice(dflt.a.books, 24.5);
check(bp.over === null && bp.under === null, "best price needs 2+ priced books on the same line");
const bks = [{ key: "hardrockbet", line: 24.5, over: -110, under: -110 }, { key: "fanduel", line: 24.5, over: -105, under: -120 }];
check(eq(P.bestPrice(bks, 24.5), { over: "fanduel", under: "hardrockbet" }), "best over / under price");
check(eq(P.bestPrice(bks, 24.5, k => k !== "fanduel"), { over: null, under: null }), "best price ignores books not legal in the state");
check(P.forPlayer(mdoc, "a", ["hardrockbet"])[0].props[0].line === 25.5, "forPlayer honours prefer");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
