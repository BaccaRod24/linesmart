// Unit tests for the Value finder math (site/assets/value-core.js): no-vig consensus, EV, minimum books, state filtering,
// stale / started guards, bad-data caps, player-prop consensus, UFC single-book exclusion. Pure fixtures: no network.
//   node scripts/value_test.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const V = require("../site/assets/value-core.js");
const fails = [];
const check = (ok, msg, tag = "value") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const NOW = Date.parse("2026-10-27T12:00:00Z");
const GEN = "2026-10-27T11:30:00Z";
const START = "2026-10-27T23:00:00Z";
const bk = (o = {}) => ({ homeML: -150, awayML: 130, homeSpread: -3.5, homeSpreadOdds: -110, awaySpread: 3.5, awaySpreadOdds: -110,
  total: 44.5, overOdds: -110, underOdds: -110, asOf: GEN, ...o });
const game = (books, o = {}) => ({ id: "g1", date: START, state: "pre", home: { abbr: "PHI", short: "Eagles" }, away: { abbr: "WSH", short: "Commanders" }, books, ...o });

// ---- core math
check(near(V.implied(-110), 110 / 210), "implied(-110) = 0.5238", "math");
check(near(V.implied(150), 0.4), "implied(+150) = 0.4", "math");
const nv = V.noVig([-110, -110]);
check(near(nv[0], 0.5) && near(nv[1], 0.5), "noVig(-110/-110) = 50/50", "math");
const nv2 = V.noVig([-150, 130]);
check(near(nv2[0] + nv2[1], 1) && near(nv2[0], 0.6 / (0.6 + 100 / 230)), "noVig proportional and sums to 1", "math");
check(near(V.edge(0.5, 110), 0.05), "edge(50%, +110) = +5%", "math");
check(near(V.edge(0.5, -110), 0.5 * (1 + 100 / 110) - 1), "edge(50%, -110) = -4.55%", "math");
check(V.toAmerican(0.5) === 100 || V.toAmerican(0.5) === -100, "toAmerican(0.5) = even", "math");
check(V.toAmerican(0.4) === 150 && V.toAmerican(0.6) === -150, "toAmerican(40%) = +150, (60%) = -150", "math");
check(V.plausible([-110, -110]) && !V.plausible([110, 110]) && !V.plausible([-300, -300]) && !V.plausible([-110, 50]), "plausible: hold range and |price|>=100", "math");

// ---- game consensus: 3 books, one with a better total Over price
const g1 = game({ draftkings: bk(), fanduel: bk(), hardrockbet: bk({ overOdds: 105, underOdds: -125 }) });
const r1 = V.gameRows("nfl", "football", g1, GEN, NOW);
const over = r1.rows.find(r => r.mk === "total" && r.side === "over");
check(!!over, "total over row exists with 3 books", "game");
const hrNv = 1 / (1 + 100 / 205) / (1 / (1 + 100 / 205) + 125 / 225);  // HR no-vig over
const fairOver = (0.5 + 0.5 + V.noVig([105, -125])[0]) / 3;
check(over && near(over.fairP, fairOver), `fair over = mean of 3 no-vig probabilities (${fairOver.toFixed(4)})`, "game");
check(over && over.top.book === "hardrockbet" && over.top.price === 105, "best offer = Hard Rock +105", "game");
check(over && near(over.top.edge, V.edge(fairOver, 105)), `EV = fair x decimal - 1 (${over && (100 * over.top.edge).toFixed(2)}%)`, "game");
check(over && over.top.edge > 0 && over.top.best, "+105 at fair ~48.8% is +EV and flagged best price", "game");
check(over && over.top.out === true, "HR over is a price outlier (>= 3 pts better than the others' mean)", "game");
check(over && over.n === 3 && over.label === "Over 44.5" && over.line === 44.5, "row carries n books, label and line", "game");
check(isFinite(hrNv), "fixture sanity", "game");
const sp = r1.rows.find(r => r.mk === "spread" && r.side === "away");
check(sp && sp.label === "Commanders +3.5" && sp.line === 3.5, "away spread label/line uses the away number", "game");
check(r1.rows.every(r => r.offers.every((o, i, a) => i === 0 || a[i - 1].edge >= o.edge)), "offers sorted best EV first", "game");

// ---- minimum books
const g2 = game({ draftkings: bk(), hardrockbet: bk({ overOdds: 105, underOdds: -125 }) });
check(V.gameRows("nfl", "football", g2, GEN, NOW).rows.length === 0, "2 books: no consensus rows (min 3)", "minbooks");
const g2b = game({ draftkings: bk(), fanduel: bk({ total: 45.5 }), hardrockbet: bk({ total: 43.5 }) });
check(!V.gameRows("nfl", "football", g2b, GEN, NOW).rows.some(r => r.mk === "total"), "3 books on 3 different totals: no total consensus", "minbooks");

// ---- UFC: DraftKings only -> nothing
const ufc = game({ draftkings: { homeML: -200, awayML: 170, asOf: GEN } });
check(V.gameRows("ufc", "mma", ufc, GEN, NOW).rows.length === 0, "UFC single-book (DraftKings only): no consensus", "ufc");
const ufc3 = game({ draftkings: { homeML: -200, awayML: 170, asOf: GEN }, fanduel: { homeML: -190, awayML: 160, asOf: GEN }, hardrockbet: { homeML: -210, awayML: 180, asOf: GEN } });
check(V.gameRows("ufc", "mma", ufc3, GEN, NOW).rows.filter(r => r.mk === "ml").length === 2, "UFC with 3 books posting: consensus allowed", "ufc");

// ---- stale / started guards
check(V.gameRows("nfl", "football", game(g1.books, { state: "in" }), GEN, NOW).rows.length === 0, "in-progress game skipped", "stale");
check(V.gameRows("nfl", "football", game(g1.books, { date: "2026-10-27T11:00:00Z" }), GEN, NOW).rows.length === 0, "start time passed (state still pre): skipped", "stale");
const oldIso = "2026-10-26T17:00:00Z";   // 19 h old > 18 h last-good window
const gOld = game({ draftkings: bk({ asOf: oldIso }), fanduel: bk(), hardrockbet: bk({ overOdds: 105, underOdds: -125 }) });
check(V.gameRows("nfl", "football", gOld, GEN, NOW).rows.length === 0, "one book older than 18 h dropped -> under 3 books -> no rows", "stale");
check(V.gameRows("nfl", "football", game({ draftkings: bk(), fanduel: bk(), hardrockbet: bk() }), oldIso.replace("17", "10"), NOW).rows.length > 0, "book asOf beats an old file stamp", "stale");
const gNoAs = game({ draftkings: bk({ asOf: undefined }), fanduel: bk({ asOf: undefined }), hardrockbet: bk({ asOf: undefined }) });
check(V.gameRows("nfl", "football", gNoAs, oldIso, NOW).rows.length === 0, "no asOf + file older than 18 h: skipped", "stale");
const gSt = game({ draftkings: bk(), fanduel: bk(), hardrockbet: { ...bk(), stale: true } });
check(V.gameRows("nfl", "football", gSt, GEN, NOW).rows.length === 0, "book flagged stale (kept from last-good) not used", "stale");
check(V.fresh(GEN, NOW) && !V.fresh(oldIso, NOW) && !V.fresh("2026-10-28T00:00:00Z", NOW) && !V.fresh(null, NOW), "fresh(): window, future and missing stamps", "stale");

// ---- bad-data caps
const gBad = game({ draftkings: bk(), fanduel: bk(), hardrockbet: bk({ overOdds: 150, underOdds: 150 }) });
const rb = V.gameRows("nfl", "football", gBad, GEN, NOW);
check(!rb.rows.some(r => r.mk === "total"), "negative-hold market (+150/+150) dropped -> total has only 2 books", "baddata");
const gTyp = game({ draftkings: bk(), fanduel: bk(), hardrockbet: bk({ homeML: -150, awayML: 13 }) });
check(V.gameRows("nfl", "football", gTyp, GEN, NOW).rows.filter(r => r.mk === "ml").every(r => r.offers.length <= 2 || r.offers.every(o => o.book !== "hardrockbet")), "mistyped price (+13) market dropped", "baddata");
const lng = { draftkings: bk({ homeML: -800, awayML: 550 }), fanduel: bk({ homeML: -800, awayML: 550 }), hardrockbet: bk({ homeML: -800, awayML: 550 }) };
const rl = V.gameRows("nfl", "football", game(lng), GEN, NOW).rows.filter(r => r.mk === "ml");
check(rl.length === 1 && rl[0].side === "home", `long shot past +${V.MAX_PRICE} left out (favorite at -800 kept)`, "baddata");
// > MAX_EDGE: 5 books impossible here, so feed a big edge via a bad-but-plausible line: DK/FD -400/+300, HR +150/-180
const huge = game({ draftkings: bk({ homeML: -400, awayML: 300 }), fanduel: bk({ homeML: -400, awayML: 300 }), hardrockbet: bk({ homeML: 150, awayML: -180 }) });
const rh = V.gameRows("nfl", "football", huge, GEN, NOW);
const hm = rh.rows.find(r => r.mk === "ml" && r.side === "home");
check(rh.suspect >= 1 || (hm && hm.offers.every(o => o.edge <= V.MAX_EDGE)), `edge above +${100 * V.MAX_EDGE}% treated as bad data (suspect=${rh.suspect})`, "baddata");
check(!rh.rows.some(r => r.offers.some(o => o.edge > V.MAX_EDGE)), "no visible offer above MAX_EDGE", "baddata");

// ---- state filtering (Florida = Hard Rock Bet only; Nevada none)
const all = r1.rows;
const fl = V.forState(all, k => k === "hardrockbet");
check(fl.length === all.length && fl.every(r => r.offers.every(o => o.book === "hardrockbet") && r.top.book === "hardrockbet"), "Florida: only Hard Rock Bet offers listed", "state");
check(fl.every(r => near(r.fairP, all.find(a => a.mk === r.mk && a.side === r.side).fairP)), "Florida: fair price still uses all 3 books", "state");
check(fl.every(r => r.hidden === 2), "Florida: 2 hidden books counted", "state");
check(V.forState(all, () => false).length === 0, "Nevada / not legal (no available book): nothing listed", "state");
const nj = V.forState(all, () => true);
check(nj.every(r => r.offers.length === 3 && r.hidden === 0), "all-books state: every offer listed", "state");
const ny = V.forState(all, k => k !== "hardrockbet");
const nyOver = ny.find(r => r.mk === "total" && r.side === "over");
check(nyOver && nyOver.top.book !== "hardrockbet" && nyOver.top.edge < 0, "NY (no Hard Rock): best legal over is DK/FD at -110 (negative EV)", "state");

// ---- filters / sort
const fr = V.filterRows(nj, { min: 0 }, NOW);
check(fr.every(r => r.top.edge >= 0) && fr.some(r => r.mk === "total"), "min 0% keeps only prices at or above fair", "filter");
check(V.filterRows(nj, { mk: "spread", min: -1 }, NOW).every(r => r.mk === "spread"), "market filter", "filter");
check(V.filterRows(nj, { lg: "nba", min: -1 }, NOW).length === 0, "league filter", "filter");
check(V.filterRows(nj, { min: -1, hours: 6 }, NOW).length === 0 && V.filterRows(nj, { min: -1, hours: 24 }, NOW).length > 0, "time window filter (game in 11 h)", "filter");
const srt = V.filterRows(nj, { min: -1 }, NOW);
check(srt.every((r, i) => i === 0 || srt[i - 1].top.edge >= r.top.edge), "sorted by EV desc", "filter");

const outRow = { ...nj[0], top: { ...nj[0].top, edge: -0.02, out: true } }, plainRow = { ...nj[0], top: { ...nj[0].top, edge: -0.02, out: false } };
check(V.filterRows([outRow, plainRow], { min: 0, outliers: true }, NOW).length === 1, "outlier at -2% kept with outliers on; plain -2% row dropped", "filter");
check(V.filterRows([outRow], { min: 0.01, outliers: true }, NOW).length === 0, "positive min edge overrides the outlier allowance", "filter");
check(V.filterRows([{ ...outRow, top: { ...outRow.top, edge: -0.05 } }], { min: 0, outliers: true }, NOW).length === 0, "outlier below -3% floor dropped", "filter");

// ---- off-consensus lines
const gl = game({ draftkings: bk(), fanduel: bk(), hardrockbet: bk({ homeSpread: -1.5, awaySpread: 1.5 }) });
const rL = V.gameRows("nfl", "football", gl, GEN, NOW);
check(rL.lines.some(x => x.book === "hardrockbet" && x.mk === "spread" && x.side === "home" && x.gap === 2), "HR -1.5 vs consensus -3.5 flagged as better home line (2 pts)", "lines");
check(!rL.rows.some(r => r.mk === "spread" && r.n < 3), "off-line book excluded from 2-book spread consensus", "lines");

// ---- player props
const players = { p1: { n: "Jalen Hurts", ta: "PHI" } }, markets = { pass_yds: ["Passing Yards", "Pass Yds"], td: ["Anytime TD", "TD"] };
const pg = { upd: GEN, props: [
  ["p1", "pass_yds", 230.5, null, [], { draftkings: [230.5, -115, -115], fanduel: [230.5, -112, -118], hardrockbet: [230.5, 110, -140] }],
  ["p1", "td", 0.5, null, [], { draftkings: [0.5, 120, null], fanduel: [0.5, 115, null], hardrockbet: [0.5, 125, null] }],
  ["p1", "rush_yds", 30.5, null, [], { draftkings: [30.5, -115, -115], fanduel: [31.5, -115, -115], hardrockbet: [29.5, -115, -115] }],
] };
const pr = V.propRows("nfl", "football", game({}), pg, players, markets, GEN, NOW);
const po = pr.rows.find(r => r.pmk === "pass_yds" && r.side === "over");
const fairPO = (0.5 + V.noVig([-112, -118])[0] + V.noVig([110, -140])[0]) / 3;
check(po && near(po.fairP, fairPO), "prop over fair = mean no-vig of 3 books on 230.5", "props");
check(po && po.top.book === "hardrockbet" && po.top.price === 110 && near(po.top.edge, V.edge(fairPO, 110)) && po.top.edge > 0, "HR Over 230.5 +110 is +EV vs consensus", "props");
check(po && po.label === "Jalen Hurts Over 230.5 Passing Yards" && po.pid === "p1" && po.pmk === "pass_yds", "prop row label / ids", "props");
check(!pr.rows.some(r => r.pmk === "td"), "one-sided (anytime TD, no under) props skipped", "props");
check(!pr.rows.some(r => r.pmk === "rush_yds"), "props on 3 different lines: no consensus", "props");
const prFl = V.forState(pr.rows, k => k === "hardrockbet");
check(prFl.length === pr.rows.length && prFl.every(r => r.top.book === "hardrockbet"), "props: Florida lists Hard Rock only", "props");
check(V.propRows("nfl", "football", game({}, { state: "in" }), pg, players, markets, GEN, NOW).rows.length === 0, "props: started game skipped", "props");
check(V.propRows("nfl", "football", game({}), { ...pg, upd: oldIso }, players, markets, oldIso, NOW).rows.length === 0, "props: stale file skipped", "props");
const pg2 = { upd: GEN, props: [["p1", "pass_yds", 230.5, null, [], { draftkings: [230.5, -115, -115], fanduel: [230.5, -112, -118] }]] };
check(V.propRows("nfl", "football", game({}), pg2, players, markets, GEN, NOW).rows.length === 0, "props: 2 books -> none", "props");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall value tests passed");
process.exit(fails.length ? 1 : 0);
