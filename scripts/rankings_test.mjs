// Rankings: season totals and prop hit rate. No network, no Odds API.
// Usage: env -u ODDS_API_KEY node scripts/rankings_test.mjs
import { createRequire } from "module";
import fs from "fs";

const require = createRequire(import.meta.url);
const R = require("../pro/rankings-core.js");
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} rankings: ${msg}`); if (!ok) fails.push(msg); };

check(R.bucket("nfl", "FB") === "RB" && R.bucket("nfl", "WR") === "WR" && R.bucket("nfl", "K") === null, "NFL buckets: fullback with running back, kicker left out");
check(R.bucket("nba", "PG") === "G" && R.bucket("nba", "PF") === "F" && R.bucket("nba", "C") === "C", "NBA buckets are G/F/C");
check(R.specsFor("nhl").length === 0 && R.specsFor("mlb").length === 0, "leagues without a box-score cache have no positions");
check(R.normPlayer("Kenneth Walker III") === "kenneth walker" && R.normPlayer("Luka Dončić") === "luka doncic", "player names fold the same way as the props matcher");
check(R.playerHash("nfl", "4036378") === "#/p/nfl/4036378", "a player links to the existing player page");
check(R.sampleText(8, 10) === "8/10", "the sample reads as overs out of games");
check(R.basisLabel("l10") === "Last 10 games vs the current line", "a last-10 sample is labeled as last 10");
check(R.basisLabel("season") === "This season vs the current line", "a season tally is labeled as this season");

{
  const games = {
    a: { d: "2026-10-01T17:00Z", h: "1", a: "2", b: { "1": { "10": { py: 300, ptd: 2, att: 30, _c: ["pass"] }, "11": { ry: 80, rtd: 1, _c: ["rush"] } } } },
    b: { d: "2026-10-08T17:00Z", h: "2", a: "1", b: { "1": { "10": { py: 100, ptd: 1, att: 20, _c: ["pass"] }, "11": { ry: 20, rtd: 0, rec: 3, recy: 40, _c: ["rush", "rece"] } } } },
  };
  const roster = { "10": { n: "QB One", pos: "QB", t: "1" }, "11": { n: "RB One", pos: "RB", t: "1" }, "12": { n: "Kicker", pos: "K", t: "1" } };
  const players = R.aggregateSeason("nfl", games, roster, { "1": "AAA" });
  check(players.length === 2 && !players.some(p => p.n === "Kicker"), "a kicker with no skill line is not ranked");
  const qb = players.find(p => p.id === "10");
  check(qb && qb.gp === 2 && qb.py === 400 && qb.ptd === 3 && qb.ta === "AAA" && qb.pos === "QB", "passing yards add across the cached games");
  const board = R.seasonBoard(players, R.specById("nfl", "QB"));
  check(board.rows.length === 1 && board.rows[0].name === "QB One" && board.rows[0].cells[0].text === "400" && board.rows[0].cells[0].on, "the season board shows the passing total and games");
  check(R.statModes("nfl", "QB").map(m => m.id).join() === "yds,td" && R.resolveStat("nfl", "QB", "rec").id === "yds", "quarterbacks have no receptions rank");
  const qbs = [
    { id: "a", n: "Pass Only", pos: "QB", gp: 2, py: 100, ptd: 4, ry: 0, rtd: 0 },
    { id: "b", n: "Legs", pos: "QB", gp: 2, py: 90, ptd: 1, ry: 40, rtd: 4 },
  ];
  const qtd = R.seasonBoard(qbs, R.specById("nfl", "QB"), 10, "td");
  check(qtd.rows[0].name === "Legs" && qtd.rows[0].cells.find(c => c.on).text === "5", "quarterback TDs add rushing TDs and highlight that column");
  const rbs = [
    { id: "a", n: "Rusher", pos: "RB", gp: 2, ry: 100, recy: 10, rtd: 1, rectd: 0, rec: 2 },
    { id: "b", n: "Catcher", pos: "RB", gp: 2, ry: 40, recy: 90, rtd: 0, rectd: 3, rec: 8 },
  ];
  const ryd = R.seasonBoard(rbs, R.specById("nfl", "RB"), 10, "yds");
  check(ryd.rows[0].name === "Rusher" && ryd.rows[0].cells.some(c => c.key === "scrim" && !c.on), "running back yards rank by rushing yards and still show scrimmage");
  const rtd = R.seasonBoard(rbs, R.specById("nfl", "RB"), 10, "td");
  check(rtd.rows[0].name === "Catcher" && rtd.rows[0].cells.find(c => c.on).text === "3", "running back TDs are rush plus receiving");
  const wrs = [
    { id: "a", n: "Deep", pos: "WR", gp: 2, recy: 200, rec: 4, rectd: 1 },
    { id: "b", n: "Slot", pos: "WR", gp: 2, recy: 80, rec: 12, rectd: 0 },
  ];
  const wrec = R.seasonBoard(wrs, R.specById("nfl", "WR"), 10, "rec");
  check(wrec.rows[0].name === "Slot" && wrec.stat === "rec" && wrec.rows[0].cells.find(c => c.on).key === "rec", "wide receivers can be ranked by receptions");
  check(R.statModes("nba", "G", [{ id: "1", pos: "G", gp: 4, pts: 10 }]).map(m => m.id).join() === "pts,reb,ast", "3PM stays hidden until the rows actually include threes");
  const withThrees = [{ id: "1", n: "A", pos: "G", gp: 4, pts: 40, reb: 8, ast: 20, tpm: 8 }];
  check(R.statModes("nba", "G", withThrees).map(m => m.id).join() === "pts,reb,ast,3pm", "3PM is offered when the cache stored threes made");
  check(R.resolveStat("nba", "F", "3pm", [{ id: "1", pos: "F", gp: 4, pts: 10 }]).id === "pts", "a 3PM choice falls back to points when threes were not stored");
  const nbaRows = [
    { id: "hot", n: "One Game", pos: "G", gp: 1, pts: 50, reb: 2, ast: 2, tpm: 1 },
    { id: "ast", n: "Passer", pos: "G", gp: 4, pts: 40, reb: 8, ast: 40, tpm: 4 },
    { id: "pts", n: "Scorer", pos: "G", gp: 4, pts: 120, reb: 12, ast: 8, tpm: 8 },
  ];
  const byAst = R.seasonBoard(nbaRows, R.specById("nba", "G"), 10, "ast");
  check(byAst.minGp === 3 && byAst.rows.length === 2 && byAst.rows[0].name === "Passer" && byAst.rows[0].cells.find(c => c.on).key === "ast", "assists per game skips a one-game outlier and highlights assists");
  const by3 = R.seasonBoard(nbaRows, R.specById("nba", "G"), 10, "3pm");
  check(by3.rows[0].name === "Scorer" && by3.rows[0].cells.find(c => c.key === "tpm" && c.on).text === "2.0", "3PM is threes per game from the stored total");
  const no3 = R.seasonBoard(nbaRows.map(p => { const q = { ...p }; delete q.tpm; return q; }), R.specById("nba", "G"), 10, "3pm");
  check(no3.stat === "pts" && !no3.cols.some(c => c.key === "tpm"), "without threes the board does not invent a 3PM column");
  const box = { g1: { d: "2026-10-22T00:00Z", h: "1", a: "2", b: { "1": { p: [["9", "SG", 20, 4, 6, 3, 30, 10, 2, 1]], t: [8, 20, 4, 2, 3] } } } };
  const agg = R.aggregateSeason("nba", box, { "9": { n: "Shooter", pos: "SG", t: "1" } }, { "1": "BOS" });
  check(agg[0] && agg[0].pos === "G" && agg[0].tpm === 3 && agg[0].pts === 20, "NBA aggregation keeps threes made from the box row");
}

{
  const many = [];
  for (let i = 0; i < 12; i++) many.push({ id: String(i), n: "P" + String(i).padStart(2, "0"), pos: "G", ta: "X", gp: 4, pts: (i + 1) * 4, reb: i, ast: 1 });
  const board = R.seasonBoard(many, R.specById("nba", "G"));
  check(board.total === 12 && board.rows.length === 10 && board.rows[0].name === "P11" && board.rows[0].cells[0].text === "12.0", "NBA top 10 is points per game, and it stops at 10");
  check(board.rows.every((r, i) => i === 0 || Number(r.cells[0].text) <= Number(board.rows[i - 1].cells[0].text)), "the board stays sorted");
}

{
  const log = [30, 28, 22, 18, 16, 14, 12, 10].map((v, i) => [`2026-10-${String(20 - i).padStart(2, "0")}`, "OPP", "vs", { points: v }]);
  const doc = {
    lg: "nba",
    markets: { points: ["Points", "Pts"] },
    games: { "9": { props: [
      ["a", "points", 20.5, null, [8, 2, 0, 10], { hardrockbet: [19.5, -110, -110, [6, 2, 0, 8]], draftkings: [20.5, -115, -105, null] }],
      ["b", "points", 15.5, null, [2, 1, 0, 3], { hardrockbet: [15.5, -110, -110, null] }],
      ["c", "points", 10.5, null, null, { hardrockbet: [10.5, -110, -110, null] }],
    ] } },
    players: {
      a: { n: "Alex", pos: "PG", t: "1", ta: "BOS", log },
      b: { n: "Blake", pos: "PG", t: "1", ta: "BOS", log: log.slice(0, 3) },
      c: { n: "Casey", pos: "PG", t: "1", ta: "BOS", log },
    },
  };
  const fl = R.fromProps(doc, R.specById("nba", "G"), ["hardrockbet"]);
  const ranked = R.rankHits(fl.entries);
  check(fl.entries.find(e => e.id === "a").line === 19.5 && fl.entries.find(e => e.id === "a").basis === "season", "Florida grades the Hard Rock line, and a season tally stays a season tally");
  check(!fl.entries.some(e => e.book === "draftkings"), "a Florida list does not keep a DraftKings line");
  check(ranked.rows.length === 2 && ranked.rows.every(r => r.n >= 5) && !ranked.rows.some(r => r.id === "b"), "fewer than 5 games is left off");
  const casey = ranked.rows.find(r => r.id === "c");
  check(casey && casey.basis === "l10" && casey.text === "7/8" && casey.n === 8, "without a season tally the row is the last 10 logged games");
  check(ranked.basis === "mixed", "a mix of season and last-10 rows is not given one window");
  const none = R.fromProps({ lg: "nhl", games: {} }, null, ["hardrockbet"]);
  check(none.saw === false && none.entries.length === 0, "a league with no props file produces no rows");
}

{
  const rows = [
    { id: "1", n: "High", pos: "QB", ta: "GB", mk: "pass_yds", lines: { hardrockbet: 200.5, draftkings: 10 }, sample: [300, 280, 100, 90, 80], scope: "season" },
    { id: "2", n: "Low", pos: "QB", ta: "GB", mk: "pass_yds", lines: { draftkings: 10 }, sample: [300, 280, 100, 90, 80], scope: "season" },
    { id: "3", n: "Short", pos: "QB", ta: "GB", mk: "pass_yds", lines: { hardrockbet: 1 }, sample: [9, 8, 7], scope: "season" },
  ];
  const fl = R.fromPack(rows, R.specById("nfl", "QB"), ["hardrockbet"]);
  const ranked = R.rankHits(fl.entries);
  check(ranked.rows.length === 1 && ranked.rows[0].id === "1" && ranked.rows[0].text === "2/5" && ranked.rows[0].line === 200.5, "the pack uses the legal book's line and shows the sample");
  check(!ranked.rows.some(r => r.id === "2" || r.id === "3"), "a DraftKings-only line and a 3-game sample stay off a Florida board");
  check(R.rankHits([]).rows.length === 0, "an empty list stays empty");
}

{
  const roster = { "7": { n: "Only One", pos: "QB", t: "1" }, "8": { n: "Only One", pos: "QB", t: "2" }, "9": { n: "Unique Back", pos: "RB", t: "1" } };
  const games = { g: { d: "2026-10-01", h: "1", a: "2", b: { "1": { "7": { py: 10, att: 5, _c: ["pass"] }, "9": { ry: 40, _c: ["rush"] } }, "2": { "8": { py: 10, att: 5, _c: ["pass"] } } } } };
  const odds = { "55": { date: "2026-11-01T00:00Z", books: { hardrockbet: { pass_yds: { "Only One": [200, -110, -110] }, rush_yds: { "Unique Back": [40.5, -110, -110] } } } } };
  const index = [{ id: "55", date: "2026-11-01T00:00Z", home: { id: "1", abbr: "AAA" }, away: { id: "2", abbr: "BBB" } }];
  const rows = R.propRowsFromOdds("nfl", games, roster, odds, index, { "1": "AAA", "2": "BBB" });
  check(!rows.some(r => r.n === "Only One"), "a name on both teams is skipped");
  check(rows.length === 1 && rows[0].id === "9" && rows[0].mk === "rush_yds" && rows[0].sample.length === 1, "a unique name keeps that player's real games only");
}

{
  const src = fs.readFileSync(new URL("../pro/rankings-core.js", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../pro/pro-ui.js", import.meta.url), "utf8");
  const pub = ["site/index.html", "site/assets/app.js", "site/assets/pro.js", "site/assets/pro-gate.js"].map(f => fs.readFileSync(f, "utf8")).join("\n");
  check(!/fetch\s*\(|the-odds-api|ODDS_API|apiKey/i.test(src), "rankings logic has no network call");
  check(/href\("rankings"\)/.test(ui) && /Prop hit rate/.test(ui) && /Season stats/.test(ui), "the Pro hub links to both views");
  check(!/Prop hit rate|data-screen="rankings"|proRankings/.test(pub), "the free site does not render rankings");
  const data = fs.readFileSync(new URL("../pro/rankings-data.js", import.meta.url), "utf8");
  check(!/apiKey|ODDS_API|the-odds-api|copenhaver|@yahoo/i.test(data), "the snapshot has no key and no account");
  const D = require("../pro/rankings-data.js");
  for (const lg of ["nfl", "nba"]) {
    const L = D.leagues[lg];
    check(L && L.boxGames > 0 && L.players.length > 40, `${lg} snapshot has a real season`);
    const poss = new Set(R.specsFor(lg).map(s => s.id));
    check(L.players.every(p => poss.has(p.pos) && p.n && p.gp >= 1), `${lg} players are named, positioned, and have a game`);
    for (const spec of R.specsFor(lg)) {
      const board = R.seasonBoard(L.players, spec);
      check(board.rows.length > 0 && board.rows.length <= 10, `${lg} ${spec.id} season board is a real top 10`);
      const hit = R.rankHits(R.fromPack(L.props, spec, ["hardrockbet"]).entries);
      check(hit.rows.every(r => r.n >= 5 && r.o <= r.n && r.text === `${r.o}/${r.n}`), `${lg} ${spec.id} hit rate keeps the minimum sample`);
    }
  }
  check(!D.leagues.nhl && !D.leagues.mlb && !D.leagues.ncaaf && !D.leagues.ncaab, "the snapshot does not invent other leagues");
  check(D.leagues.nba.players.some(p => typeof p.tpm === "number" && p.tpm > 0), "the NBA snapshot includes threes made from the box scores");
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);
