// Unit tests for the Live tab (site/assets/livetab-core.js): bucketing into in progress / starting soon / just finished,
// league grouping, period-clock labels, "You have a bet" keys and which data files to load. Uses the ESPN scoreboards
// captured during MNF Oct 26 2026 (scripts/fixtures/live). No browser or network needed.
// Usage: node scripts/livetab_test.mjs
import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(import.meta.url);
const T = require("../site/assets/livetab-core.js");
const L = require("../site/assets/live-core.js");
const fx = n => JSON.parse(readFileSync(new URL(`./fixtures/live/${n}.json`, import.meta.url)));
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} livetab: ${msg}`); if (!ok) fails.push(msg); };
const AS_OF = "2026-10-27T01:10:00.000Z", NOW = Date.parse(AS_OF);
const at = min => new Date(NOW + min * 60e3).toISOString();
const G = (id, state, date, extra = {}) => ({ id, state, date, statusDetail: extra.det || "", home: { id: "h" + id, abbr: "H" + id, score: extra.hs ?? "0" }, away: { id: "a" + id, abbr: "A" + id, score: extra.as ?? "0" }, ...extra });

// ---------- classify
const items = [
  { lg: "nfl", g: G("1", "in", at(-55)) },
  { lg: "nba", g: G("2", "in", at(-130)) },
  { lg: "nba", g: G("3", "pre", at(30)) },            // soon
  { lg: "nba", g: G("4", "pre", at(119)) },           // soon (edge)
  { lg: "nba", g: G("5", "pre", at(125)) },           // too far
  { lg: "nhl", g: G("6", "pre", at(-10)) },           // listed start passed, static still pre: "starting"
  { lg: "nhl", g: G("7", "pre", at(-90)) },           // long past and still pre: hidden (stale / postponed)
  { lg: "epl", g: G("8", "post", at(-140), { det: "FT" }) },   // 1.9 h typical: ended ~26 min ago
  { lg: "nfl", g: G("9", "post", at(-600), { det: "Final" }) },// yesterday's final: hidden
  { lg: "mlb", g: G("10", "post", at(-200), { det: "Postponed" }) },
  { lg: "nfl", g: G("1", "in", at(-55)) },            // duplicate key ignored
];
const B = T.classify(items, NOW);
check(B.live.map(x => x.g.id).join() === "2,1", "live: in-progress games, earliest start first, deduped");
check(B.soon.map(x => x.g.id).join() === "6,3,4", "soon: next 2 h, plus a game whose start just passed");
check(B.soon[0].starting === true && !B.soon[1].starting, "a game past its listed start is flagged 'starting'");
check(B.recent.map(x => x.g.id).join() === "8", "recent: finals within the last hour only; postponed and old finals skipped");
const seenFin = T.classify([{ lg: "nfl", g: G("9", "post", at(-600)) }], NOW, { finishedAt: { "nfl/9": NOW - 20 * 60e3 } });
check(seenFin.recent.length === 1 && seenFin.recent[0].at === NOW - 20 * 60e3, "a game we saw go final this session uses that time");
const oldFin = T.classify([{ lg: "nfl", g: G("9", "post", at(-120)) }], NOW, { finishedAt: { "nfl/9": NOW - 61 * 60e3 } });
check(oldFin.recent.length === 0, "final more than an hour ago drops off");
check(T.classify([], NOW).live.length === 0 && T.classify(null, NOW).soon.length === 0, "empty input");
check(T.classify([{ lg: "nba", g: { id: "x", state: "pre", date: "bad" } }], NOW).soon.length === 0, "bad dates are skipped");

// ---------- group
const order = ["nfl", "nba", "ncaaf", "ncaab", "nhl", "mlb", "epl", "mls", "ucl", "ufc"];
const grp = T.group([{ lg: "ufc" }, { lg: "nba" }, { lg: "zzz" }, { lg: "nfl" }, { lg: "nba" }], order);
check(grp.map(x => x.lg).join() === "nfl,nba,ufc,zzz" && grp[1].items.length === 2, "grouped in site league order, unknown leagues last");

// ---------- clock labels (statusDetail as ESPN sends it)
const ck = (lg, det, kind) => T.clockText(lg, { state: "in", statusDetail: det }, kind);
check(ck("nfl", "8:35 - 2nd") === "Q2 · 8:35", "NFL: Q2 · 8:35");
check(ck("ncaaf", "0:42 - 4th") === "Q4 · 0:42", "NCAAF quarter");
check(ck("nba", "5:15 - 4th") === "Q4 · 5:15" && ck("nba", "Halftime") === "Halftime", "NBA quarter / halftime");
check(ck("ncaab", "12:01 - 2nd") === "2nd half · 12:01" && ck("ncaab", "2:01 - 3rd") === "OT · 2:01" && ck("ncaab", "1:00 - 4th") === "OT2 · 1:00", "NCAAB halves and overtimes");
check(ck("nhl", "18:47 - 3rd") === "3rd · 18:47" && ck("nhl", "End of 2nd") === "End of 2nd", "NHL period / intermission");
check(ck("mlb", "Mid 4th") === "Mid 4th" && ck("mlb", "Top 7th") === "Top 7th", "MLB inning text as-is");
check(ck("epl", "67'") === "67'" && ck("ucl", "HT") === "HT", "soccer minute / HT");
check(ck("ufc", "R2, 2:14", "mma") === "R2 · 2:14" && ck("ufc", "Round 3 - 4:01", "mma") === "R3 · 4:01", "UFC round");
check(T.clockText("ufc", { state: "in", statusDetail: "", live: { period: 1, clock: "3:30" } }, "mma") === "R1 · 3:30", "UFC from live period/clock");
check(T.clockText("nfl", { state: "post", statusDetail: "Final/OT" }) === "Final/OT", "finals pass through");
// live overlay detail wins over the static statusDetail
check(T.clockText("nfl", { state: "in", statusDetail: "10/26 - 8:15 PM EDT", live: { detail: "8:35 - 2nd" } }) === "Q2 · 8:35", "overlay detail beats stale static detail");

// ---------- real ESPN scoreboards through live-core, then the Live tab buckets
const gen = "2026-10-27T00:45:49Z", all = [];
for (const lg of ["nfl", "nba", "nhl", "mlb"]) {
  const sb = fx("sb_" + lg), ov = L.parseScoreboard(lg, sb, AS_OF);
  for (const e of sb.events) {
    const c = e.competitions[0], side = h => c.competitors.find(x => x.homeAway === h);
    const g0 = { id: e.id, date: e.date, state: "pre", statusDetail: "stale", home: { id: side("home").id, abbr: side("home").team.abbreviation, score: "0" }, away: { id: side("away").id, abbr: side("away").team.abbreviation, score: "0" } };
    all.push({ lg, g: L.mergeGame(g0, ov[L.key(lg, e.id)], gen) });
  }
}
const R = T.classify(all, NOW);
const want = all.filter(x => x.g.state === "in").length;
check(R.live.length === want && want >= 10, `fixture night: ${want} games in progress across NFL/NBA/NHL/MLB`);
check(R.soon.some(x => x.lg === "nhl" && x.g.id === "401892584"), "fixture night: EDM-DET (9:30 PM ET) is starting soon");
const mnf = R.live.find(x => x.g.id === "401873009");
check(mnf && mnf.g.home.score === "14" && mnf.g.away.score === "10" && T.clockText("nfl", mnf.g, "football") === "Q2 · 8:35", "MNF: 10-14, Q2 · 8:35 from the live overlay");
check(mnf && mnf.g.live.situation && /ball/.test(mnf.g.live.situation.text || "") && !!mnf.g.live.situation.possession, "MNF: down & distance with possession");
check(T.group(R.live, order).map(x => x.lg).join() === "nfl,nba,nhl,mlb", "fixture night grouped NFL, NBA, NHL, MLB");

// ---------- bet keys
const bets = [
  { status: "pending", type: "spread", league: "nfl", event: { id: "401873009", lg: "nfl" } },
  { status: "won", type: "ml", league: "nba", event: { id: "1" } },
  { status: "pending", type: "parlay", legs: [{ result: "won", league: "nba", event: { id: "2" } }, { league: "nhl", event: { id: "3", lg: "nhl" } }, { result: "pending", event: { id: "4", lg: "mlb" } }] },
  { status: "pending", type: "prop", event: { id: 55, lg: "nba" } },
  { status: "pending", type: "future" },          // no event: ignored
  null,
];
const K = T.betKeys(bets);
check(K.has("nfl/401873009") && K.has("nhl/3") && K.has("mlb/4") && K.has("nba/55"), "pending straight bets, props and open parlay legs");
check(!K.has("nba/1") && !K.has("nba/2") && K.size === 4, "settled bets and settled legs excluded");

// ---------- which data files to load
const meta = { order, leagues: Object.fromEntries(order.map(k => [k, { games: k === "mls" ? 0 : 5 }])), slate: { leagues: { nfl: { today: 1 }, nba: { today: 9 }, nhl: { today: 0, live: 1 }, ufc: { today: 0 } } } };
check(T.leaguesToLoad(meta, Date.parse("2026-10-26T20:00:00Z")).join() === "nfl,nba,nhl", "afternoon: leagues playing today or live");
check(T.leaguesToLoad(meta, Date.parse("2026-10-27T05:30:00Z")).join() === order.filter(k => k !== "mls").join(), "after midnight ET: every league with games (late games from yesterday)");
check(T.leaguesToLoad({ order }).join() === order.join(), "no slate: every league");

// ---------- UFC cards collapse to one row per event for soon / recent
const f = (id, ev, main) => ({ lg: "ufc", g: { id, state: "pre", date: at(60), event: { id: ev, name: "UFC " + ev }, mainEvent: !!main, home: {}, away: {} }, at: NOW + 3600e3 });
const col = T.collapseFights([f("1", "E1"), f("2", "E1", true), f("3", "E1"), { lg: "nba", g: G("9", "pre", at(30)) }]);
check(col.length === 2 && col[0].fights === 3 && col[0].main.id === "2" && col[1].lg === "nba", "UFC fights collapse per event, main event kept");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall livetab tests passed");
process.exit(fails.length ? 1 : 0);
