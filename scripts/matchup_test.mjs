// Unit tests for player-matchup math (site/assets/matchup-core.js). No browser or network needed.
// Usage: node scripts/matchup_test.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const M = require("../site/assets/matchup-core.js");
const fails = [];
const check = (ok, msg, tag = "matchup") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };

// ---------- synthetic ESPN gamelog (same shape as common/v3/.../athletes/{id}/gamelog)
const opp = (id, ab) => ({ id, abbreviation: ab, displayName: ab + " Team", logo: "" });
const log = (season, games, extra = []) => ({
  names: ["receptions", "receivingYards", "receivingTouchdowns", "fieldGoalsMade-fieldGoalsAttempted"],
  labels: ["REC", "YDS", "TD", "FG"],
  filters: [{ name: "season", value: season, options: [{ value: "2026" }, { value: "2025" }, { value: "2024" }] }],
  events: Object.fromEntries([...games, ...extra].map(g => [g.id, { gameDate: g.d, atVs: g.at, opponent: opp(g.o, g.ab), gameResult: g.r || "W", score: "24-21" }])),
  seasonTypes: [
    { displayName: `${season} Regular Season`, categories: [{ events: games.map(g => ({ eventId: g.id, stats: g.s })) }] },
    ...(extra.length ? [{ displayName: `${season} Preseason`, categories: [{ events: extra.map(g => ({ eventId: g.id, stats: g.s })) }] }] : []),
  ],
});
const cur = log("2026", [
  { id: "c1", d: "2026-09-10T00:00Z", at: "vs", o: "21", ab: "PHI", s: ["5", "60", "0", "1-2"] },
  { id: "c2", d: "2026-09-17T00:00Z", at: "@", o: "9", ab: "GB", s: ["8", "110", "1", "0-0"] },
  { id: "c3", d: "2026-09-24T00:00Z", at: "vs", o: "4", ab: "NYG", s: ["10", "130", "2", "3-4"] },
], [{ id: "pre1", d: "2026-08-20T00:00Z", at: "vs", o: "5", ab: "LV", s: ["2", "20", "0", "0-0"] }]);
const prev = log("2025", [
  { id: "p1", d: "2025-11-23T00:00Z", at: "@", o: "21", ab: "PHI", s: ["4", "75", "1", "0-0"], r: "L" },
  { id: "p2", d: "2025-12-01T00:00Z", at: "vs", o: "4", ab: "NYG", s: ["6", "--", "0", "0-0"] },
]);

const a = M.parseLog(cur, "2026"), b = M.parseLog(prev, "2025");
check(a.length === 3, "parseLog drops preseason games (3 regular-season rows)", "parse");
check(a[0].id === "c3" && a[2].id === "c1", "rows are newest first", "parse");
check(a[0].v.fieldGoalsMade === 3 && a[0].v.fieldGoalsAttempted === 4, "paired 'a-b' columns split into both stat names", "parse");
check(a[2].home === true && a[1].home === false, "home/away read from atVs (vs/@)", "parse");
check(b[0].v.receivingYards === null, "'--' parses as null, not 0", "parse");
check(M.parseLog(null).length === 0 && M.parseLog({}).length === 0, "missing gamelog → no rows (rookie / ESPN down)", "parse");
const rows = M.mergeRows(a, b, a);
check(rows.length === 5 && rows[0].id === "c3" && rows[4].id === "p1", "mergeRows de-dupes and sorts across seasons", "parse");
check(M.seasonsOf(cur).join() === "2026,2025,2024" && M.currentSeason(cur) === "2026", "season filter options and current season", "parse");

// ---------- averages, trend, splits, vs opponent
check(M.avg(a, "receptions") === 7.7, "season average (5,8,10 → 7.7)", "form");
check(M.avg(b, "receivingYards") === 75, "average skips null games", "form");
check(M.avg([], "x") === null, "average of nothing is null", "form");
check(M.trend(12, 10) === "up" && M.trend(8, 10) === "down" && M.trend(10.5, 10) === "flat", "trend ±10% band", "form");
check(M.trend(1, 0.6) === "flat" && M.trend(1.2, 0.6) === "up", "trend has a 0.5 absolute floor for small stats", "form");
check(M.trend(null, 10) === null, "trend needs both values", "form");
const ha = M.splitHA(rows, "receptions");
check(ha.home === 7 && ha.away === 6 && ha.nh === 3 && ha.na === 2, "home/away split (home 5,10,6 / away 8,4)", "form");
const vs = M.vsOpp(rows, "21");
check(vs.length === 2 && M.avg(vs, "receivingYards") === 67.5, "history vs PHI spans seasons (60, 75)", "form");
check(M.vsOpp(rows, "99").length === 0, "no prior meetings → empty", "form");
check(M.lastN(rows, 2).map(r => r.id).join() === "c3,c2", "lastN takes the newest games", "form");
const sr = M.seasonRows(rows, "2026"), sr2 = M.seasonRows(b, "2026");
check(sr.rows.length === 3 && !sr.fallback, "season baseline = current season rows", "form");
check(sr2.key === "2025" && sr2.fallback === true, "no games this season → latest season stands in (offseason/injury)", "form");

// ---------- hit rate
const hr = M.hitRate(rows, "receptions", 5.5);
check(hr.n === 5 && hr.over === 3 && hr.pct === 60, "hit rate over 5.5 rec: 3 of 5 (60%)", "hit");
const hp = M.hitRate(rows, "receptions", 5);
check(hp.push === 1 && hp.over === 3, "exact value counts as a push, not over", "hit");
check(M.hitRate(rows, "receivingYards", 70).n === 4, "games missing the stat are skipped", "hit");
check(M.hitRate(rows, "receptions", 5.5, 2).n === 2, "hit rate window n", "hit");
check(M.hitRate([], "receptions", 5.5).pct === null, "no games → pct null", "hit");
check(M.defaultLine(72.4) === 71.5 && M.defaultLine(7.7) === 7.5 && M.defaultLine(8) === 7.5 && M.defaultLine(0.2) === 0.5 && M.defaultLine(null) === 0.5, "default threshold rounds below the average", "hit");

// ---------- positions and headline stats
check(M.posBucket("nfl", "wr") === "WR" && M.posBucket("nfl", "FB") === "RB" && M.posBucket("nfl", "K") === null, "NFL position buckets", "pos");
check(M.posBucket("nba", "PG") === "G" && M.posBucket("nba", "PF") === "F" && M.posBucket("nba", "C") === "C", "NBA position buckets", "pos");
const defs = M.statDefs("nfl", "WR", cur, rows);
check(defs.map(d => d[0]).join() === "receptions,receivingYards,receivingTouchdowns", "WR headline stats limited to stats present in the log", "pos");
check(M.statDefs("nfl", "K", cur, rows).length > 0, "unknown position falls back to log columns", "pos");

// ---------- next game + lines
const games = [
  { id: "g0", date: "2026-10-20T00:00Z", state: "post", home: { id: "6" }, away: { id: "21" } },
  { id: "g2", date: "2026-11-02T00:00Z", state: "pre", home: { id: "9" }, away: { id: "6" } },
  { id: "g1", date: "2026-10-27T00:15Z", state: "pre", home: { id: "21", abbr: "PHI" }, away: { id: "6", abbr: "DAL" },
    odds: { provider: "ESPN BET", awaySpread: -4.5, total: 43.5 },
    books: { draftkings: { awaySpread: -4.5, awayML: -225, total: 43.5 }, hardrockbet: { awaySpread: -4, total: 44, stale: true } } },
];
const ng = M.nextGame(games, "6");
check(ng && ng.game.id === "g1" && ng.home === false && ng.opp.abbr === "PHI", "next game = earliest unfinished game; away side", "next");
check(M.nextGame(games, "77") === null && M.nextGame(games, "") === null, "no scheduled game → null (bye/offseason)", "next");
const ln = M.linesFor(ng.game, false);
check(ln.length === 1 && ln[0].book === "DraftKings" && ln[0].spread === -4.5 && ln[0].ml === -225, "lines: DK for the player's side; stale Hard Rock skipped", "next");
check(M.linesFor({ odds: { provider: "ESPN BET", homeSpread: 3, total: 40 } }, true)[0].book === "ESPN BET", "lines fall back to ESPN odds", "next");
check(M.linesFor({}, true).length === 0, "no odds → no lines", "next");

// ---------- opponent defense
const mu = { nTeams: 30, posStats: { G: [["pts", "Pts"], ["ast", "Ast"]] }, teamStats: [["pts", "Opp PPG"], ["pace", "Pace"]],
  teams: { "2": { gp: 3, team: { pts: [118, 25], pace: [101, 3] }, pos: { G: { pts: [50, 2], ast: [12, 15] } } } } };
const od = M.oppDefense(mu, "2", "G");
check(od.gp === 3 && od.pos.length === 2 && od.pos[0].tier === "tough" && od.pos[1].tier === "mid", "defense vs guards with tiers", "def");
check(od.team[0].tier === "soft" && od.team[1].tier === null, "team stats tiered; pace not tiered", "def");
check(M.oppDefense(mu, "2", null).pos.length === 0 && M.oppDefense(mu, "2", null).team.length === 2, "no position bucket → team-level only", "def");
check(M.oppDefense(mu, "404", "G") === null && M.oppDefense(null, "2", "G") === null, "unknown team / no data → null", "def");
check(M.ordinal(1) === "1st" && M.ordinal(2) === "2nd" && M.ordinal(3) === "3rd" && M.ordinal(11) === "11th" && M.ordinal(22) === "22nd" && M.ordinal(13) === "13th", "ordinals", "def");
check(M.tier(1, 32) === "tough" && M.tier(11, 32) === "tough" && M.tier(12, 32) === "mid" && M.tier(22, 32) === "soft", "tier thirds for 32 teams", "def");
check(String(M.leaderKey("nfl", "Receiving Yards", "TE")) === "TE,recy" && String(M.leaderKey("nfl", "Passing Yards")) === "QB,py" && M.leaderKey("nfl", "Sacks") === null, "game-page leader → defense stat (NFL)", "def");
check(String(M.leaderKey("nba", "Points", "C")) === "C,pts" && M.leaderKey("nba", "Points", null) === null, "game-page leader → defense stat (NBA)", "def");

// ---------- key matchups skip unavailable leaders and backfill
const avail = s => M.injuryAvailability(s);
for (const s of ["Out", "OUT", "out", "Out for season"]) check(avail(s) === "skip", `Out variant skipped (${s})`, "inj");
for (const s of ["Doubtful", "DOUBTFUL", "doubtful"]) check(avail(s) === "skip", `Doubtful skipped (${s})`, "inj");
for (const s of ["IR", "ir", "I.R.", "i.r", "Injured Reserve", "injured-reserve", "INJURED RESERVE", "60-Day-IL", "10-Day IL"]) check(avail(s) === "skip", `IR/IL variant skipped (${s})`, "inj");
for (const s of ["Questionable", "questionable", "Day-To-Day", "day to day", "DTD"]) check(avail(s) === "badge", `kept with a badge (${s})`, "inj");
check(avail("") === "ok" && avail("Probable") === "ok" && avail(null) === "ok", "blank and probable are not holds", "inj");
check(M.injuryByName("Luka Doncic", [{ player: "luka doncic", status: "Out" }])?.status === "Out", "injury name match is case-insensitive, like the player page", "inj");
check(M.injuryByName("Luka Doncic", [{ player: "Luka Doncic Jr", status: "Out" }]) == null, "a different name does not match", "inj");

const lakerInj = {
  "13": [
    { player: "Quentin Grimes", pos: "G", status: "Day-To-Day", type: "Finger" },
    { player: "Luka Doncic", pos: "G", status: "Out", type: "Back", detail: "Soreness" },
  ],
};
const lakerLeaders = [
  { teamId: "13", cat: "Points", player: "Luka Doncic", value: "40.1", id: "3945274", pos: "G" },
  { teamId: "13", cat: "Assists", player: "Luka Doncic", value: "7.7", id: "3945274", pos: "G" },
  { teamId: "13", cat: "Rebounds", player: "Walker Kessler", value: "10.4", id: "4433136", pos: "C" },
];
const lakers = M.pickKeyPlayers("nba", lakerLeaders, lakerInj, "13");
check(lakers.map(p => p.name).join("|") === "Walker Kessler|Quentin Grimes", `Out leader skipped and day-to-day athlete backfills (${lakers.map(p => p.name).join("|")})`, "inj");
check(!lakers.some(p => /luka/i.test(p.name)), "Luka is not a key player while Out", "inj");
check(lakers[1].badge === "Day-To-Day" && lakers[1].tone === "q" && lakers[0].badge === "", "day-to-day backfill is badged; healthy leader is not", "inj");
check(lakers.length === 2, "stop at the players who are actually available (fewer than 3)", "inj");

const catBackfill = M.pickKeyPlayers("nba", [
  { teamId: "13", cat: "Points", player: "Luka Doncic", value: "40.1", id: "1", pos: "G" },
  { teamId: "13", cat: "Points", player: "Austin Reaves", value: "28.0", id: "3", pos: "G" },
  { teamId: "13", cat: "Assists", player: "Austin Reaves", value: "8.0", id: "3", pos: "G" },
  { teamId: "13", cat: "Rebounds", player: "Walker Kessler", value: "10.4", id: "2", pos: "C" },
], { "13": [{ player: "Luka Doncic", status: "Out" }] }, "13");
check(catBackfill.map(p => p.name).join("|") === "Austin Reaves|Walker Kessler", `next leader in the category fills the Out slot (${catBackfill.map(p => p.name).join("|")})`, "inj");
const fromOther = M.pickKeyPlayers("nba", [
  { teamId: "2", cat: "Points", player: "Only Points", value: "30", id: "p", pos: "G" },
], { "2": [] }, "2", { athletes: [{ player: "Other Athlete", id: "a", pos: "F", cat: "Rebounds", value: "9", teamId: "2" }] });
check(fromOther.map(p => p.name).join("|") === "Only Points|Other Athlete", "one leader per category backfills from another athlete the data offers", "inj");

const doubtful = M.pickKeyPlayers("nba", [
  { teamId: "8", cat: "Points", player: "Doubt Guy", value: "22", id: "d", pos: "F" },
  { teamId: "8", cat: "Points", player: "Next Points", value: "18", id: "n", pos: "G" },
  { teamId: "8", cat: "Assists", player: "Playmaker", value: "8", id: "p", pos: "G" },
  { teamId: "8", cat: "Rebounds", player: "Board Man", value: "9", id: "b", pos: "C" },
], { "8": [{ player: "doubt guy", status: "Doubtful" }] }, "8");
check(doubtful.map(p => p.name).join("|") === "Next Points|Playmaker|Board Man" && !doubtful.some(p => /doubt/i.test(p.name)), "Doubtful skipped, next leader used", "inj");

const ir = M.pickKeyPlayers("nfl", [
  { teamId: "4", cat: "Receiving Yards", player: "IR Guy", value: "80", id: "i", pos: "WR" },
  { teamId: "4", cat: "Receiving Yards", player: "Next Rec", value: "60", id: "n2", pos: "WR" },
  { teamId: "4", cat: "Passing Yards", player: "Reserve QB", value: "200", id: "q", pos: "QB" },
  { teamId: "4", cat: "Rushing Yards", player: "Healthy RB", value: "90", id: "r", pos: "RB" },
], { "4": [{ player: "IR Guy", status: "IR" }, { player: "Reserve QB", status: "Injured Reserve" }] }, "4");
check(ir.map(p => p.name).join("|") === "Next Rec|Healthy RB", `IR and Injured Reserve skipped (${ir.map(p => p.name).join("|")})`, "inj");
check(M.pickKeyPlayers("nfl", [
  { teamId: "4", cat: "Passing Yards", player: "Dot IR", value: "10", id: "z", pos: "QB" },
], { "4": [{ player: "Dot IR", status: "I.R." }] }, "4").length === 0, "I.R. variant skipped and nobody is invented", "inj");

const qGame = M.pickKeyPlayers("nfl", [
  { teamId: "12", cat: "Passing Yards", player: "Patrick Mahomes", value: "1795", id: "3139477", pos: "QB" },
  { teamId: "12", cat: "Rushing Yards", player: "Kenneth Walker III", value: "770", id: "4567048", pos: "RB" },
  { teamId: "12", cat: "Receiving Yards", player: "Travis Kelce", value: "410", id: "15847", pos: "TE" },
  { teamId: "12", cat: "Sacks", player: "George Karlaftis", value: "2", id: "4426659", pos: "DE" },
], { "12": [{ player: "Patrick Mahomes", pos: "QB", status: "Questionable" }] }, "12");
check(qGame.map(p => p.name).join("|") === "Patrick Mahomes|Kenneth Walker III|Travis Kelce", "Questionable leader stays in the three", "inj");
check(qGame[0].badge === "Questionable" && qGame[0].tone === "q" && qGame[1].badge === "", "Questionable gets the q badge; teammates do not", "inj");

const none = M.pickKeyPlayers("nba", [
  { teamId: "1", cat: "Points", player: "Only Out", value: "20", id: "o", pos: "G" },
], { "1": [{ player: "Only Out", status: "Out" }] }, "1");
check(none.length === 0, "when nobody healthy is left, the side is empty rather than showing the Out player", "inj");

const vis = M.visibleLeaders(lakerLeaders, lakerInj);
check(vis.map(p => p.name).join("|") === "Walker Kessler" && !vis.some(p => /luka/i.test(p.name)), "season-leader table drops Out rows and does not invent a category", "inj");
const visQ = M.visibleLeaders([{ teamId: "12", cat: "Passing Yards", player: "Patrick Mahomes", value: "1795", id: "1", pos: "QB" }], { "12": [{ player: "Patrick Mahomes", status: "Questionable" }] });
check(visQ.length === 1 && visQ[0].badge === "Questionable", "season-leader table badges Questionable", "inj");

// ---------- no betting-encouragement language in the shipped UI copy
const fs = await import("fs");
const ui = fs.readFileSync(new URL("../site/assets/matchup.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../site/assets/matchup-core.js", import.meta.url), "utf8");
const banned = /\b(lock|sure thing|can't lose|guaranteed|bet now|smash|hammer|value play|best bet|easy money)\b/i;
check(!banned.test(ui), "no betting-encouragement wording in matchup UI", "copy");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall matchup tests passed");
process.exit(fails.length ? 1 : 0);
