// Unit tests for live scores (site/assets/live-core.js) against ESPN responses captured during
// Cowboys @ Eagles MNF, Oct 26 2026 (~9:10 PM ET). No browser or network needed.
// Usage: node scripts/live_test.mjs
import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(import.meta.url);
const C = require("../site/assets/live-core.js");
const fx = n => JSON.parse(readFileSync(new URL(`./fixtures/live/${n}.json`, import.meta.url)));
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} live: ${msg}`); if (!ok) fails.push(msg); };
const AS_OF = "2026-10-27T01:10:00.000Z";   // 9:10 PM ET
const GEN = "2026-10-27T00:45:49Z";         // static data the live site was serving (8:45 PM ET)

// URLs: browser-safe host only (site.api.espn.com fails CORS in Chrome: its OPTIONS preflight is 403)
check(C.scoreboardUrl("nfl", "20261026") === "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261026", "NFL scoreboard URL");
check(C.summaryUrl("nfl", "401873009") === "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873009", "NFL summary URL");
check(Object.keys(C.LEAGUES).every(lg => C.scoreboardUrl(lg, "20261026").startsWith("https://site.web.api.espn.com/") && !C.scoreboardUrl(lg, "1").includes("//site.api.")), "every league uses site.web.api.espn.com");
check(["nfl", "ncaaf", "nba", "ncaab", "nhl", "mlb", "epl", "mls", "ucl"].every(C.supported) && !C.supported("ufc"), "leagues covered (UFC excluded)");
check(C.scoreboardUrl("ncaaf", "20261026").includes("groups=80") && C.scoreboardUrl("ncaab", "20261026").includes("groups=50"), "college groups match the build");

// ET days
check(C.etDay("2026-10-27T00:15:00Z") === "20261026", "8:15 PM ET kickoff (00:15Z next day) is on the Oct 26 ET scoreboard");
check(C.etDay("2026-10-27T04:30:00Z") === "20261027", "12:30 AM ET is the next ET day");
check(C.etDay("2026-03-08T07:30:00Z") === "20260308" && C.etDay("2026-03-08T04:30:00Z") === "20260307", "DST change day");
check(C.etDay("bad") === null, "bad date -> null");

// needsLive / plan
const now = Date.parse(AS_OF);
const g = (lg, id, state, date) => ({ lg, id, state, date });
check(C.needsLive(g("nfl", "1", "in", "2026-10-27T00:15:00Z"), now), "in-progress game polls");
check(!C.needsLive(g("nfl", "1", "post", "2026-10-27T00:15:00Z"), now), "final game does not poll");
check(C.needsLive(g("nfl", "1", "pre", "2026-10-27T00:15:00Z"), now), "stale 'pre' after kickoff polls");
check(C.needsLive(g("nfl", "1", "pre", "2026-10-27T01:11:30Z"), now), "'pre' 90 s before start polls (2 min grace)");
check(!C.needsLive(g("nfl", "1", "pre", "2026-10-27T01:20:00Z"), now), "'pre' 10 min out does not poll");
check(!C.needsLive(g("nfl", "1", "pre", "2026-10-26T17:00:00Z"), now), "'pre' 8 h after start: trust static data");
check(!C.needsLive(g("nfl", "1", "in", "2026-10-27T00:15:00Z"), now, { state: "post" }), "live overlay saying final stops polling");
check(!C.needsLive(g("ufc", "1", "in", "2026-10-27T00:15:00Z"), now), "unsupported league never polls");
const p = C.plan([g("nfl", "1", "in", "2026-10-27T00:15:00Z"), g("nfl", "2", "post", "2026-10-26T17:00:00Z"), g("nba", "3", "in", "2026-10-26T23:00:00Z"),
  g("nba", "4", "pre", "2026-10-27T02:30:00Z"), g("nhl", "5", "post", "2026-10-26T23:00:00Z")], now);
check(JSON.stringify(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [...v]]))) === JSON.stringify({ nfl: ["20261026"], nba: ["20261026"] }), "plan: one scoreboard per live league/day only");
check(Object.keys(C.plan([g("nfl", "2", "post", "2026-10-26T17:00:00Z")], now)).length === 0, "plan: nothing live -> no requests");
// 12:21 AM ET: a game that tipped at 10:00 PM ET is on yesterday's scoreboard, not today's.
const afterMidnight = Date.parse("2026-10-31T04:21:00Z");
const nightPlan = C.plan([
  g("nba", "401909285", "in", "2026-10-31T02:00:00Z"),
  g("nba", "401909286", "in", "2026-10-31T02:00:00Z"),
  g("ncaaf", "401866451", "in", "2026-10-31T02:30:00Z"),
], afterMidnight);
check([...nightPlan.nba].join() === "20261030" && [...nightPlan.ncaaf].join() === "20261030", "after midnight ET: poll yesterday's ET scoreboard, not today's");
check(C.scoreboardUrl("ncaaf", [...nightPlan.ncaaf][0]).includes("groups=80") && !C.scoreboardUrl("ncaaf", [...nightPlan.ncaaf][0]).includes("groups=81"), "after midnight ET: college football poll stays on the FBS group");

// scoreboards
const nfl = C.parseScoreboard("nfl", fx("sb_nfl"), AS_OF), dal = nfl["nfl/401873009"];
check(!!dal && dal.state === "in" && dal.detail === "8:35 - 2nd" && dal.period === 2 && dal.clock === "8:35", "NFL: DAL @ PHI in progress, 8:35 2nd");
check(dal && dal.away.abbr === "DAL" && dal.away.score === "10" && dal.home.abbr === "PHI" && dal.home.score === "14", "NFL: DAL 10, PHI 14");
check(dal && dal.away.linescores.join() === "10,0" && dal.home.linescores.join() === "7,7", "NFL: quarter line scores");
check(dal && dal.situation && dal.situation.text === "2nd & 4 at PHI 34 · DAL ball" && dal.situation.possession === "6" && !dal.situation.redZone, "NFL: down & distance + possession");
check(dal && /Spann-Ford/.test(dal.situation.lastPlay), "NFL: last play");
const nba = C.parseScoreboard("nba", fx("sb_nba"), AS_OF);
check(Object.keys(nba).length === 9 && nba["nba/401909868"].state === "in" && nba["nba/401909868"].home.score === "98", "NBA: 9 games, WSH @ CHA live");
const nhl = C.parseScoreboard("nhl", fx("sb_nhl"), AS_OF)["nhl/401892582"];
check(nhl && nhl.away.abbr === "LA" && nhl.away.score === "5" && nhl.home.score === "2" && nhl.detail === "18:47 - 3rd", "NHL: LA 5 @ NYR 2, 3rd");
const mlb = C.parseScoreboard("mlb", fx("sb_mlb"), AS_OF)["mlb/401908044"];
check(mlb && mlb.detail === "Mid 4th" && mlb.away.score === "2" && mlb.away.hits !== null && mlb.home.errors !== null, "MLB: Mid 4th with hits/errors");
check(mlb && (!mlb.situation || mlb.situation.text === null), "MLB: no outs/count shown between half-innings");
check(Object.keys(C.parseScoreboard("nfl", null)).length === 0 && Object.keys(C.parseScoreboard("nfl", { events: [{}] })).length === 0, "bad scoreboard -> no overlays");

// situations
const sit = C.situation("baseball", { outs: 2, balls: 3, strikes: 2, onFirst: true, onThird: true, batter: { athlete: { shortName: "W. Contreras" } } });
check(sit.text === "2 out · on 1st, 3rd · 3-2 · AB: W. Contreras" && sit.bases.join() === "true,false,true", "MLB situation text");
check(C.situation("baseball", { outs: 3, lastPlay: { text: "End of the 4th", type: { type: "end-inning" } } }).text === null, "MLB end-inning: no stale outs/count");
check(C.situation("baseball", { onFirst: true, onSecond: true, onThird: true, outs: 0 }).text === "0 out · bases loaded", "MLB bases loaded");
check(C.situation("football", { possession: "21", isRedZone: true, downDistanceText: "1st & Goal at DAL 4" }, [{ id: "21", abbr: "PHI" }]).text === "1st & Goal at DAL 4 · PHI ball", "NFL red zone text");
check(C.situation("football", { possession: "21", isRedZone: true }, [{ id: "21", abbr: "PHI" }]).redZone === true, "NFL red zone flag");

// summaries -> box score
const s = C.parseSummary("nfl", fx("sum_nfl"), AS_OF);
check(s && s.overlay.id === "401873009" && s.overlay.state === "in", "NFL summary overlay");
check(s && s.box.away.abbr === "DAL" && s.box.away.stats.length >= 10 && new Set(s.box.away.stats.map(x => x.label)).size === s.box.away.stats.length, "NFL team stats, no duplicate labels");
const titles = s ? s.box.away.players.map(x => x.title) : [];
check(titles.includes("Passing") && titles.includes("Rushing") && titles.includes("Receiving") && !titles.includes("Punting") && !titles.includes("Kick returns"), "NFL player groups (short list)");
check(s && s.box.away.players.every(gr => gr.rows.length <= 4 && gr.rows.every(r => r.stats.length === gr.labels.length)), "NFL rows capped, columns aligned");
check(s && s.box.periods >= 2, "NFL periods");
const b = C.parseSummary("nba", fx("sum_nba"), AS_OF);
check(b && b.box.home.players[0].labels.join("/") === "MIN/PTS/FG/3PT/FT/REB/AST/STL/BLK/TO/PF/+/-" && b.box.home.players[0].rows.length <= 15, "NBA box columns");
const h = C.parseSummary("nhl", fx("sum_nhl"), AS_OF);
check(h && h.box.away.players.map(x => x.title).join() === "Forwards,Defense,Goalies" && h.box.away.players[2].labels.includes("SV%"), "NHL skaters + goalies");
const m = C.parseSummary("mlb", fx("sum_mlb"), AS_OF);
check(m && m.box.away.players.map(x => x.title).join() === "Batting,Pitching", "MLB batting + pitching");
check(m && m.box.away.stats.length <= 16 && m.box.away.stats.some(x => x.label === "Hits") && !m.box.away.stats.some(x => /GP|WAR/.test(x.label)), "MLB team stats: tonight's numbers, not season clutter");
check(C.parseSummary("nfl", {}) === null && C.parseSummary("nfl", null) === null, "bad summary -> null");

// merge: live data wins only when newer than the static file
const sg = { id: "401873009", state: "in", statusDetail: "3:53 - 1st", away: { abbr: "DAL", score: "10" }, home: { abbr: "PHI", score: "7" }, books: { dk: {} } };
const mg = C.mergeGame(sg, dal, GEN);
check(mg.home.score === "14" && mg.statusDetail === "8:35 - 2nd" && mg.live === dal && mg.books === sg.books, "newer live data replaces score/clock, keeps odds");
check(sg.home.score === "7", "static game not mutated");
check(C.mergeGame(sg, dal, "2026-10-27T01:15:00Z") === sg, "static file newer than live data wins");
check(C.mergeGame(sg, null, GEN) === sg, "no live data -> static");
const fin = Object.assign({}, dal, { state: "post", completed: true, detail: "Final", home: Object.assign({}, dal.home, { winner: true }), away: Object.assign({}, dal.away, { winner: false }) });
check(C.mergeGame(sg, fin, GEN).home.winner === true && C.mergeGame(sg, dal, GEN).home.winner === undefined, "winner only set when final");
const tk = { lg: "nfl", id: "401873009", st: "in", det: "3:53 - 1st", a: { a: "DAL", s: "10" }, h: { a: "PHI", s: "7" } };
const mt = C.mergeTicker(tk, dal, GEN);
check(mt.h.s === "14" && mt.a.s === "10" && mt.det === "8:35 - 2nd" && tk.h.s === "7", "ticker merge");
check(C.mergeTicker(tk, dal, "2026-10-27T02:00:00Z") === tk, "ticker: newer static wins");

// change detection + cadence
check(C.sig(dal) === C.sig(JSON.parse(JSON.stringify(dal))) && C.sig(dal) !== C.sig(Object.assign({}, dal, { detail: "8:01 - 2nd" })), "sig changes only when something visible changes");
check(C.sig(null) === "", "sig(null)");
const iv = C.intervals();
check(iv.score === 25000 && iv.summary === 30000, "25 s scores / 30 s box score");
check(C.intervals({ saveData: true }).summary === 60000 && C.intervals({ saveData: true }).score === 25000, "Data Saver: box score every 60 s");
check(C.intervals({ failures: 1 }).score === 50000 && C.intervals({ failures: 2 }).score === 100000, "backoff doubles on failure");
check(C.intervals({ failures: 50 }).score === 300000, "backoff capped at 5 min");

if (fails.length) { console.log(`\n${fails.length} live test(s) failed`); process.exit(1); }
console.log("\nall live tests passed");
