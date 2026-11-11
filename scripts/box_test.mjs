// Box score render + compact, and week grouping / links. No browser, no network.
// Run: node scripts/box_test.mjs
import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(import.meta.url);
const B = require("../site/assets/box-core.js");
const W = require("../site/assets/week-core.js");

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) fails.push(msg); };

const ath = (id, name, stats) => ({ athlete: { id, shortName: name }, stats });
const summary = {
  header: { competitions: [{ competitors: [
    { id: "33", homeAway: "away", score: "10", team: { id: "33", abbreviation: "BAL", displayName: "Baltimore Ravens" }, linescores: [{ displayValue: "3" }, { displayValue: "7" }] },
    { id: "2", homeAway: "home", score: "36", team: { id: "2", abbreviation: "BUF", displayName: "Buffalo Bills" }, linescores: [{ displayValue: "14" }, { displayValue: "22" }] },
  ] }] },
  boxscore: {
    teams: [
      { team: { id: "33" }, statistics: [{ name: "totalYards", label: "Total Yards", displayValue: "210" }, { name: "firstDowns", label: "1st Downs", displayValue: "12" }] },
      { team: { id: "2" }, statistics: [{ name: "totalYards", label: "Total Yards", displayValue: "420" }] },
    ],
    players: [
      { team: { id: "33" }, statistics: [
        { name: "passing", labels: ["C/ATT", "YDS", "TD", "INT"], athletes: [ath("1", "L.Jackson", ["18/25", "210", "1", "1"])], totals: ["18/25", "210", "1", "1"] },
        { name: "receiving", labels: ["REC", "YDS"], athletes: Array.from({ length: 12 }, (_, i) => ath(String(100 + i), "W" + i, ["1", "10"])) },
        { name: "fumbles", labels: ["FUM"], athletes: [ath("9", "X", ["1"])] },
      ] },
      { team: { id: "2" }, statistics: [
        { name: "rushing", labels: ["CAR", "YDS", "TD"], athletes: [ath("7", "J.Cook", ["20", "110", "1"])] },
      ] },
    ],
  },
};

const box = B.compact("football", summary);
check(box && box.away.lines.join() === "3,7" && box.away.stats[0].label === "1st Downs", "compact: lines and team-stat order");
check(box.away.players.map(g => g.name).join() === "passing,receiving" && box.away.players[1].rows.length === 10 && box.away.players[1].more === 2, "compact: fumbles dropped, receiving capped");
check(B.compact("mma", summary) === null && B.compact("football", {}) === null, "UFC and empty summaries have no box");

const A = { abbr: "BAL", short: "Ravens", name: "Baltimore Ravens", score: "10" };
const H = { abbr: "BUF", short: "Bills", name: "Buffalo Bills", score: "36" };
const html = B.html(box, A, H, "football", "nfl");
check(html.includes('data-box="1"') && html.includes("bx-scroll") && html.includes("bx-players"), "render: scrollable player table");
check(html.includes('data-bx-team="away"') && html.includes('class="on"') && html.includes('data-bx-panel="home" hidden'), "render: team toggle, home panel starts hidden");
check(html.includes('href="#/p/nfl/1"') && html.includes("L.Jackson") && html.includes("J.Cook"), "render: player link and both teams' names in the markup");
check(html.includes("<th>Player</th>") && html.includes(">C/ATT<") && html.includes(">Total Yards<"), "render: sticky-column header and team stat");
check(B.html(null, A, H, "football", "nfl").includes('data-box="empty"'), "render: missing box is a plain note");
check(!B.html({ away: { stats: [], players: [] }, home: { stats: [], players: [] } }, A, H, "mma", "ufc").includes("bx-players"), "render: empty UFC box does not invent a table");

const games = [
  { id: "sun", date: "2026-11-09T01:20Z", state: "post" },
  { id: "mnf", date: "2026-11-10T01:15Z", state: "pre" },
  { id: "thu", date: "2026-11-06T01:15Z", state: "post" },
];
const asc = W.group(games, "asc");
check(asc.map(d => d.games.map(g => g.id).join()).join("|") === "thu|sun|mnf", "week group: football order is earliest day first");
const desc = W.group(games, "desc");
check(desc.map(d => d.games[0].id).join() === "mnf,sun,thu", "week group: daily order is newest day first");
check(W.href("nfl", games[0]) === "#/g/nfl/sun/box" && W.href("nfl", games[1]) === "#/g/nfl/mnf", "finals link to the box tab; upcoming games link to the line page");
check(W.href("nba", { id: "a b", state: "post" }) === "#/g/nba/a%20b/box", "ids are encoded");
check(W.dayKey("2026-11-09T01:20Z") === "2026-11-08" && W.dayKey("2026-11-10T01:15Z") === "2026-11-09", "Sunday night and Monday night stay on their ET dates");

const index = { games: [{ id: "401873052" }, { id: 12 }], week: { games: [{ id: "401873037", state: "post" }] } };
check(B.hasFile(index, "401873052") && B.hasFile(index, 12), "a game in the index has a file");
check(!B.hasFile(index, "401873037") && !B.hasFile(index, "") && !B.hasFile(null, "1") && !B.hasFile({}, "1"), "week-only and missing ids have no game file");
const app = readFileSync(new URL("../site/assets/app.js", import.meta.url), "utf8");
const view = app.slice(app.indexOf("async function viewGame"), app.indexOf("async function viewGame") + 1600);
check(view.includes("BoxCore.hasFile") && view.indexOf("hasFile") < view.indexOf("getJSON(file)"), "the box route checks the index before it requests a game file");

if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nbox_test: all passed");
