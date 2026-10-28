// Filter, ranking and saved-filter tests for the private Hot props preview.
// No network. Usage: node scripts/hot_props_test.mjs
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const H = require("../site/assets/hot-props-core.js");
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} hot: ${msg}`); if (!ok) fails.push(msg); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const logHot = vals => vals.map((v, i) => [`2026-10-${String(20 - i).padStart(2, "0")}`, "OPP", "vs", v === null ? null : { points: v, rebounds: v }]);
const docs = {
  nba: {
    lg: "nba", gen: "2026-10-26T02:00:00Z",
    markets: { points: ["Points", "Pts"], rebounds: ["Rebounds", "Reb"] },
    games: { "5": { props: [
      ["a", "points", 24.5, 22.5, [4, 1, 0, 5], { hardrockbet: [24.5, -110, -110, null], fanduel: [24.5, -150, -110, null], draftkings: [24.5, -130, -110, null] }],
      ["b", "points", 10.5, 10, [2, 3, 0, 5], { hardrockbet: [10.5, -105, -115, null], fanduel: [10.5, -110, -110, null] }],
      ["c", "points", 30.5, null, [1, 1, 0, 2], { hardrockbet: [30.5, -110, -110, null], fanduel: [31.5, -110, -110, null] }],
      ["a", "rebounds", 8.5, 6.5, [3, 2, 0, 5], { hardrockbet: [8.5, -115, -105, null] }],
    ] } },
    players: {
      a: { n: "Alex Sample", pos: "G", t: "1", ta: "BUF", log: logHot([30, 30, 30, 30, 10]) },
      b: { n: "Blake Sample", pos: "F", t: "2", ta: "KC", log: logHot([30, 30, 30, 10, 10]) },
      c: { n: "Casey Sample", pos: "C", t: "1", ta: "BUF", log: [] },
    },
  },
  ufc: { lg: "ufc", games: { "1": { props: [] } }, players: {} },
  nfl: { lg: "nfl", games: {}, players: {} },
};

check(eq(H.sportList(docs), ["nba", "ufc"]), `sport order puts named leagues first, skips an empty file: ${H.sportList(docs)}`);
check(eq(H.sportList({ mlb: docs.nba, ncaab: docs.nba, nba: docs.nba }), ["nba", "mlb", "ncaab"]), "NHL/MLB/NCAAF/NCAAB follow the named order when a file exists");

const rows = H.collect(docs);
check(rows.length === 4, `collect flattens props and skips missing players: ${rows.length}`);
check(rows.find(r => r.pid === "a" && r.mk === "points").open === 22.5 && rows.find(r => r.pid === "c").open === null, "opening line kept only when the file has a number");

{
  const f = H.applyFilters(rows, { lg: "nba", team: "BUF", player: "alex", mk: "points" });
  check(f.length === 1 && f[0].pid === "a" && f[0].mk === "points", "filter: sport, then team, player, prop type");
  check(H.applyFilters(rows, { lg: "nba", team: "1" }).every(r => r.teamId === "1"), "team id matches as well as the abbreviation");
  check(H.applyFilters(rows, { lg: "nfl" }).length === 0, "a sport with no props matches nothing");
  check(H.applyFilters(rows, { lg: "nba", mk: "rebounds" }).length === 1, "prop type narrows the list");
}

{
  const gaps = H.priceGaps(rows);
  check(gaps[0].pid === "a" && gaps[0].mk === "points" && gaps[0].side === "over" && gaps[0].line === 24.5, "widest same-line price gap ranks first");
  check(gaps[0].gap > gaps[1].gap && gaps[1].pid === "b", "smaller same-line gap ranks second");
  check(!gaps.some(g => g.pid === "c"), "books on different lines are not a price gap");
  check(!H.priceGaps([{ ...rows[0], books: [{ key: "hardrockbet", line: 24.5, over: -110, under: -110 }] }]).length, "one priced book is not a gap");
  const same = H.gapOf([{ key: "hardrockbet", line: 24.5, over: -110, under: -110 }, { key: "fanduel", line: 24.5, over: -110, under: -110 }]);
  check(same === null, "identical prices are not a gap");
  const fl = gaps[0].quotes.map(q => q.key);
  check(fl.includes("hardrockbet") && fl.includes("fanduel") && fl.includes("draftkings"), "the gap lists every book on that line");
}

{
  check(H.hasOpen(rows) === true, "this fixture has opening lines");
  const moves = H.lineMoves(rows);
  check(moves[0].pid === "a" && moves[0].mk === "points" && moves[0].abs === 2 && moves[0].text === "opened 22.5 ▲", `biggest line move first: ${moves.map(m => m.mk + ":" + m.abs).join(",")}`);
  check(moves[1].mk === "rebounds" && moves[1].abs === 2 && moves[2].abs === 0.5 && moves[0].abs >= moves[1].abs && moves[1].abs >= moves[2].abs, "moves sort by size, then name and prop");
  check(!moves.some(m => m.pid === "c"), "a row with no opening line is left out of the move list");
  check(H.hasOpen([{ open: null, line: 1 }]) === false && H.lineMoves([{ open: null, line: 1, name: "X", mk: "a" }]).length === 0, "no opening line means no move list");
  check(H.lineMoves([{ open: 5, line: 5, name: "X", mk: "a" }]).length === 0, "an unchanged line is not a move");
}

{
  const none = H.hotStreaks(rows.map(r => ({ ...r, log: [] })), ["hardrockbet"]);
  check(none.available === false && none.rows.length === 0, "no game logs: hot streaks are unavailable");
  const hot = H.hotStreaks(H.applyFilters(rows, { lg: "nba", team: "buf", mk: "points" }), ["hardrockbet"]);
  check(hot.available === true && hot.rows.length === 1 && hot.rows[0].pid === "a" && hot.rows[0].mk === "points", "4/5 over is a hot streak; 3/5 and an empty log are not");
  check(H.hotStreaks(H.applyFilters(rows, { team: "KC" }), null).rows.length === 0, "3/5 over is not a hot streak");
  check(hot.rows[0].gradedBook === "hardrockbet" && hot.rows[0].gradedLine === 24.5, "streak uses the preferred legal book's line");
  const dk = H.hotStreaks(rows.filter(r => r.pid === "a" && r.mk === "points"), ["draftkings"]);
  check(dk.rows[0].gradedBook === "draftkings", "a different preferred book is recorded on the row");
}

{
  const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
  const store = mem();
  check(H.readSaved(store).length === 0 && H.readSaved({ getItem: () => "{" }).length === 0, "empty or broken storage reads as no filters");
  let r = H.addSaved(store, { name: "  ", lg: "nba" });
  check(!r.ok, "a blank name is rejected");
  r = H.addSaved(store, { id: "s1", name: "  BUF points ", lg: "nba", team: "BUF", player: "a", mk: "points" });
  check(r.ok && r.row.name === "BUF points" && r.row.team === "BUF" && r.row.mk === "points", "save trims the name and keeps the filter");
  check(H.readSaved(store).length === 1 && H.readSaved(store)[0].id === "s1", "saved filter round-trips through the store");
  check(JSON.parse(store.getItem(H.KEY))[0].lg === "nba", "the store is the only place the filter is written");
  H.addSaved(store, { id: "s1", name: "BUF points renamed", lg: "nba", team: "BUF", mk: "points" });
  check(H.readSaved(store).length === 1 && H.readSaved(store)[0].name === "BUF points renamed", "saving the same id replaces it");
  check(eq(H.removeSaved(store, "s1"), []) && H.readSaved(store).length === 0, "delete removes it");
  const full = mem();
  for (let i = 0; i < 12; i++) H.addSaved(full, { id: "n" + i, name: "F" + i, lg: "nfl" });
  check(!H.addSaved(full, { id: "extra", name: "One more", lg: "nfl" }).ok, "12 saved filters is the limit");
  const src = fs.readFileSync(new URL("../site/assets/hot-props-core.js", import.meta.url), "utf8");
  check(!/fetch\s*\(|supabase|the-odds-api|ODDS_API/i.test(src), "hot-props logic has no network call");
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);
