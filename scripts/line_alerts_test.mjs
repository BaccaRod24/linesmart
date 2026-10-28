// Unit tests for line alerts: trigger rules (alerts-core.js), the sheet's validation, the Florida book filter, the checker
// (scripts/line_alerts.mjs) on fixture data with the database mocked, and the workflow's safe defaults. No network.
// Usage: env -u ODDS_API_KEY node scripts/line_alerts_test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { run, loadData, DEFAULTS } from "./line_alerts.mjs";
const require = createRequire(import.meta.url);
const C = require("../site/assets/alerts-core.js");
let n = 0; const fails = [];
const ok = (c, m) => { n++; if (!c) { fails.push(m); console.log("FAIL " + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const NOW = Date.parse("2026-10-27T18:00:00Z");
const book = (o = {}) => ({ homeSpread: -3.5, awaySpread: 3.5, homeSpreadOdds: -110, awaySpreadOdds: -110, homeML: -180, awayML: 150, total: 47.5, overOdds: -110, underOdds: -110, asOf: "2026-10-27T17:30:00Z", ...o });
const game = (o = {}) => ({ id: "4010", date: "2026-10-28T00:15Z", state: "pre", home: { abbr: "GB", name: "Green Bay Packers" }, away: { abbr: "CAR", name: "Carolina Panthers" },
  books: { hardrockbet: book(), draftkings: book({ homeSpread: -3, awaySpread: 3 }), fanduel: book({ total: 48 }) }, ...o });
const G = (g = game()) => new Map([["nfl/" + g.id, g]]);
const A = o => ({ id: "x1", league: "nfl", game_id: "4010", starts_at: "2026-10-28T00:15:00Z", books: ["hardrockbet", "draftkings", "fanduel"], ...o });

// ---------- formatting
eq([C.fmtLine(-3.5), C.fmtLine(3), C.fmtLine(0), C.fmtOdds(150), C.fmtOdds(-110), C.fmtTotal(47.5)], ["-3.5", "+3", "PK", "+150", "-110", "47.5"], "formatting");
ok(Math.abs(C.dec(150) - 2.5) < 1e-9 && Math.abs(C.dec(-200) - 1.5) < 1e-9 && isNaN(C.dec(50)), "American -> decimal");

// ---------- state rules: Florida = Hard Rock Bet only
eq(C.allowedBooks(k => k === "hardrockbet"), ["hardrockbet"], "FL: Hard Rock only");
eq(C.allowedBooks(() => true), ["hardrockbet", "draftkings", "fanduel"], "NJ-like: all three");
eq(C.allowedBooks(() => false), [], "not legal: none");
eq(C.allowedBooks(null), C.BOOKS, "no geo: all");

// ---------- values
eq(C.gameValue(game(), "hardrockbet", "spread_target", "home"), { value: -3.5, price: -110 }, "spread value");
eq(C.gameValue(game(), "fanduel", "total_target", "under"), { value: 48, price: -110 }, "total value + under price");
eq(C.gameValue(game(), "hardrockbet", "ml_target", "away"), { value: 150, price: null }, "ML value");
eq(C.gameValue(game({ books: { hardrockbet: { stale: true } } }), "hardrockbet", "total_move"), null, "stale book ignored");
eq(C.gameValue(game({ books: { hardrockbet: book({ homeSpread: 1.5, awaySpread: -1.5 }) } }), "hardrockbet", "spread_move", "home"), null, "spreadOk: spread contradicting ML is dropped");
ok(C.spreadOk(book()) && !C.spreadOk(book({ homeSpread: 2.5 })), "spreadOk");
const PROPS = { games: { "4010": { props: [["77", "pass_yds", 250.5, 245.5, [1, 0, 0, 1], { hardrockbet: [252.5, -115, -105, [1, 0, 0, 1]], draftkings: [250.5, -110, -110, [1, 0, 0, 1]] }], ["78", "rush_yds", 60.5, 58.5, [0, 1, 0, 1]]] } } };
eq(C.propValue(PROPS, "4010", "77", "pass_yds", "hardrockbet"), { value: 252.5, price: -115 }, "prop value at Hard Rock");
eq(C.propValue(PROPS, "4010", "78", "rush_yds", "draftkings"), { value: 60.5, price: null }, "DK-only prop row");
eq(C.propValue(PROPS, "4010", "78", "rush_yds", "hardrockbet"), null, "DK-only row has no Hard Rock line");

// ---------- trigger rules
const cond = (a, v, bk = "hardrockbet") => C.condition(A(a), bk, v);
ok(cond({ kind: "spread_move", points: 1, baseline: { hardrockbet: -3.5 } }, -2.5) && cond({ kind: "spread_move", points: 1, baseline: { hardrockbet: -3.5 } }, -4.5), "spread move either way");
ok(!cond({ kind: "spread_move", points: 1, baseline: { hardrockbet: -3.5 } }, -3), "spread move: 0.5 < 1");
ok(!cond({ kind: "total_move", points: 1, baseline: { draftkings: 47 } }, 49), "move needs a baseline for that book");
ok(cond({ kind: "spread_target", target: -2.5 }, -2.5) && cond({ kind: "spread_target", target: -2.5 }, -1) && !cond({ kind: "spread_target", target: -2.5 }, -3), "spread target = that number or better");
ok(cond({ kind: "spread_target", target: 7 }, 7.5) && !cond({ kind: "spread_target", target: 7 }, 6.5), "underdog spread target");
ok(cond({ kind: "total_target", side: "over", target: 46.5 }, 46) && !cond({ kind: "total_target", side: "over", target: 46.5 }, 47), "over target: total at or below");
ok(cond({ kind: "total_target", side: "under", target: 48.5 }, 49) && !cond({ kind: "total_target", side: "under", target: 48.5 }, 48), "under target: total at or above");
ok(cond({ kind: "ml_target", target: 160 }, 165) && !cond({ kind: "ml_target", target: 160 }, 150), "ML plus price");
ok(cond({ kind: "ml_target", target: -150 }, -140) && cond({ kind: "ml_target", target: -150 }, 105) && !cond({ kind: "ml_target", target: -150 }, -160), "ML minus price: pays at least as much");
ok(cond({ kind: "prop_move", points: 2, baseline: { hardrockbet: 250.5 } }, 252.5), "prop move");
ok(!cond({ kind: "bogus" }, 1) && !cond({ kind: "spread_target", target: 1 }, null), "unknown kind / missing value");

// ---------- evaluate / checkAll
eq(C.evaluate(A({ kind: "spread_target", side: "home", target: -3 }), G(), {}, NOW), { id: "x1", book: "draftkings", value: -3, price: -110 }, "first matching book");
eq(C.evaluate(A({ kind: "total_move", points: 0.5, baseline: { hardrockbet: 46.5, fanduel: 47.5 } }), G(), {}, NOW).book, "hardrockbet", "move: biggest move wins");
eq(C.evaluate(A({ kind: "spread_target", side: "home", target: -3, books: ["hardrockbet"] }), G(), {}, NOW), { skip: "not-met" }, "only the alert's books count (FL alert ignores DraftKings)");
eq(C.evaluate(A({ kind: "total_move", points: 1, baseline: {} }), G(game({ state: "in" })), {}, NOW), { skip: "started" }, "started game skipped");
eq(C.evaluate(A({ kind: "total_move", points: 1, baseline: {}, starts_at: "2026-10-27T17:00:00Z" }), G(), {}, NOW), { skip: "expired" }, "past start: expired");
eq(C.evaluate(A({ kind: "total_move", points: 1, baseline: {}, game_id: "999" }), G(), {}, NOW), { skip: "no-game" }, "game gone");
eq(C.evaluate(A({ kind: "prop_move", points: 2, player_id: "77", prop_market: "pass_yds", baseline: { hardrockbet: 250.5 } }), G(), { nfl: PROPS }, NOW).value, 252.5, "prop alert fires");
ok(C.evaluate(A({ kind: "spread_target", side: "home", target: -3, books: ["evilbook"] }), G(), {}, NOW).skip === "not-met", "unknown book ignored");
{
  const many = Array.from({ length: 45 }, (_, i) => A({ id: "m" + i, kind: "total_move", points: 0.5, baseline: { hardrockbet: 46 } }));
  const r = C.checkAll(many.concat([A({ id: "z", kind: "total_move", points: 5, baseline: { hardrockbet: 47.5 } })]), G(), {}, NOW, 40);
  ok(r.hits.length === 40 && r.skipped["over-limit"] === 5 && r.skipped["not-met"] === 1, "checkAll: hit limit + skip counts");
}

// ---------- the sheet's validation (build)
const ctx = (o = {}) => ({ league: "nfl", game: game(), props: PROPS, allowed: C.BOOKS, now: NOW, ...o });
{
  const r = C.build({ kind: "spread_move", side: "home", points: 1, books: C.BOOKS }, ctx());
  ok(r.ok && r.row.game_id === "4010" && r.row.game_label === "CAR @ GB" && r.row.side_label === "GB" && r.row.baseline.draftkings === -3 && r.row.starts_at === "2026-10-28T00:15:00.000Z", "build spread move");
  ok(!("user_id" in r.row) && !("status" in r.row), "build: no user_id/status (database sets them)");
  const fl = C.build({ kind: "total_move", points: 1, books: C.BOOKS }, ctx({ allowed: ["hardrockbet"] }));
  eq(fl.row.books, ["hardrockbet"], "FL: books outside the state are dropped");
  ok(fl.row.side === null, "total move has no side");
  ok(!C.build({ kind: "total_move", points: 1, books: ["fanduel"] }, ctx({ allowed: ["hardrockbet"] })).ok, "FL: FanDuel-only alert refused");
  ok(!C.build({ kind: "spread_move", points: 0.3, side: "home", books: C.BOOKS }, ctx()).ok && !C.build({ kind: "spread_move", points: 25, side: "home", books: C.BOOKS }, ctx()).ok, "points range / half steps");
  ok(/already there/.test(C.build({ kind: "spread_target", side: "home", target: -4, books: C.BOOKS }, ctx()).error), "target already met refused");
  ok(C.build({ kind: "spread_target", side: "home", target: -2.5, books: C.BOOKS }, ctx()).ok, "target not yet met ok");
  ok(!C.build({ kind: "ml_target", side: "home", target: 50, books: C.BOOKS }, ctx()).ok && !C.build({ kind: "ml_target", side: "home", target: 150.5, books: C.BOOKS }, ctx()).ok, "ML price validation");
  ok(C.build({ kind: "ml_target", side: "away", target: 170, books: C.BOOKS }, ctx()).ok, "ML target ok");
  ok(!C.build({ kind: "total_target", side: "sideways", target: 45.5, books: C.BOOKS }, ctx()).ok, "total target needs over/under");
  ok(!C.build({ kind: "spread_move", points: 1, side: "home", books: C.BOOKS }, ctx({ game: game({ state: "in" }) })).ok, "no alerts on started games");
  ok(!C.build({ kind: "spread_move", points: 1, side: "home", books: C.BOOKS }, ctx({ now: Date.parse("2026-10-28T01:00:00Z") })).ok, "no alerts after kickoff");
  ok(!C.build({ kind: "spread_move", points: 1, side: "x", books: C.BOOKS }, ctx()).ok, "spread needs a team");
  const p = C.build({ kind: "prop_move", points: 1, player_id: "77", prop_market: "pass_yds", player_name: "<b>Bryce</b> Young\u0007", prop_label: "Pass yds", books: C.BOOKS }, ctx());
  ok(p.ok && p.row.side_label === "bBryce/b Young" && p.row.prop_label === "Pass yds" && Object.keys(p.row.baseline).join() === "hardrockbet,draftkings" && p.row.books.join() === "hardrockbet,draftkings", "prop build: names clipped, books with a line only");
  ok(!C.build({ kind: "prop_move", points: 1, player_id: "78", prop_market: "rush_yds", books: ["hardrockbet"] }, ctx()).ok, "prop with no line at the allowed book refused");
}
// ---------- text
ok(C.describe(A({ kind: "spread_target", side_label: "GB", target: -2.5 })) === "GB spread reaches -2.5 or better at any of Hard Rock Bet, DraftKings, FanDuel", "describe target");
ok(C.describe(A({ kind: "total_move", points: 1, books: ["hardrockbet"] })) === "Total moves 1 pt at Hard Rock Bet", "describe move");
ok(/line moves 2 pts at/.test(C.describe(A({ kind: "prop_move", points: 2, side_label: "Bryce Young", prop_label: "Pass yds" }))), "describe prop");
eq([C.status({ status: "fired" }, NOW).key, C.status({ status: "active", starts_at: "2026-10-27T17:00:00Z" }, NOW).key, C.status({ status: "active", starts_at: "2026-10-28T00:15:00Z" }, NOW).key], ["fired", "expired", "active"], "status");
ok(/10 active/.test(C.insertError({ message: "alert_limit" })) && /started/.test(C.insertError({ message: "alert_started" })) && /sign-in expired/.test(C.insertError({ message: "JWT expired" })), "insert errors in plain words");
const BANNED = /\block\b|guarantee|can't lose|can.t lose|free money|promo code|bonus code/i;
for (const f of ["site/assets/alerts.js", "site/assets/alerts-core.js", "supabase/migrations/20261027_line_alerts.sql"]) {
  const t = fs.readFileSync(f, "utf8").replace(/advisory_xact_lock|pg_advisory|row-lock|lock(ed|s)? the|for update/gi, "");
  ok(!BANNED.test(t.replace(/--.*$/gm, "")), `no banned words in ${f}`);
}
// The sheet no longer hardcodes the number (commit 1f73147): it renders LSGeo.rgSpan(), i.e. GeoCore.rgCallHTML for the
// visitor's state, which always includes 1-800-GAMBLER (state line first where there is one).
const GC = require("../site/assets/geo-core.js");
ok(/21\+ \| Gambling problem\? \$\{window\.LSGeo\.rgSpan\(\)\}/.test(fs.readFileSync("site/assets/alerts.js", "utf8")), "sheet shows 21+ and the state helpline span");
ok([null, "FL", "NY", "NJ"].every(st => /tel:18004262537">1-800-GAMBLER/.test(GC.rgCallHTML(st ? { status: "ok", state: st, stateName: st } : null))), "sheet shows 1-800-GAMBLER (any state)");

// ---------- alert email helplines (SQL template) match the site's mapping in geo-core.js
{
  const sql = fs.readFileSync("supabase/migrations/20261027_line_alerts.sql", "utf8");
  const fn = (sql.match(/function public\.line_alert_helpline[\s\S]*?end \$\$;/) || [""])[0];
  const arr = name => ((fn.match(new RegExp(`${name} constant text\\[\\] := array\\[([^\\]]*)\\]`)) || [])[1] || "").split(",").map(x => x.trim().replace(/^'|'$/g, ""));
  const st = arr("st"), ph = arr("ph"), tl = arr("tl");
  eq([...st].sort(), Object.keys(GC.HELPLINES).sort(), "alert email covers the site's state helplines");
  ok(st.length > 0 && st.every((c, i) => GC.HELPLINES[c].name === ph[i] && GC.HELPLINES[c].tel === tl[i]), "alert email helpline numbers match geo-core.js");
  ok(fn.includes(`tel:${GC.GAMBLER.tel}`) && fn.includes(GC.GAMBLER.name) && fn.includes("/responsible-gambling.html"), "alert email: 1-800-GAMBLER fallback + helplines link");
  ok(/%12\$s<br>LineSmart is a free odds and stats site/.test(sql) && /\(rg ->> 'text'\) \|\| chr\(10\)/.test(sql), "alert email footer uses the helpline line (HTML and text)");
  ok(!/Call 1-800-GAMBLER\. Florida: 1-833-PLAYWISE/.test(sql), "alert email: old fixed helpline sentence gone");
}

// ---------- checker on fixture data, database mocked
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "la-"));
const write = (rel, o) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), JSON.stringify(o)); };
const meta = gen => ({ generated: gen, leagues: { nfl: {}, nba: {} }, hardrock: { asOf: gen, leagues: { nfl: gen, nba: "2026-10-26T00:00:00Z" } } });
write("meta.json", meta("2026-10-27T17:40:00Z")); write("nfl/index.json", { games: [game()] }); write("props/nfl.json", PROPS); write("nba/index.json", { games: [] });
const alerts = [A({ id: "aaaaaaaa-1", kind: "spread_target", side: "home", target: -3 }), A({ id: "bbbbbbbb-2", kind: "total_move", points: 3, baseline: { hardrockbet: 47.5 } }), A({ id: "cccccccc-3", league: "nba", kind: "total_move", points: 1, baseline: {} }),
  A({ id: "dddddddd-4", kind: "prop_move", points: 2, player_id: "77", prop_market: "pass_yds", baseline: { hardrockbet: 250.5 } })];
const KEY = "k".repeat(64);
const realFetch = globalThis.fetch; let rpcCalls = [];
globalThis.fetch = async (url, init) => {
  const fn = String(url).split("/rpc/")[1]; rpcCalls.push({ url: String(url), fn, body: JSON.parse(init.body), headers: init.headers });
  if (!String(url).startsWith(DEFAULTS.supabaseUrl + "/rest/v1/rpc/")) throw new Error("unexpected fetch " + url);
  const body = fn === "line_alerts_pending" ? alerts : { status: "disabled", sent: 0 };
  return { ok: true, text: async () => JSON.stringify(body) };
};
{
  const out = []; const log = s => out.push(s);
  const r = await run({ mode: "dry-run", data: dir, now: NOW }, { LINE_ALERTS_KEY: KEY }, log);
  eq(r.hits.map(h => h.id).sort(), ["aaaaaaaa-1", "dddddddd-4"], "dry run: matches");
  ok(r.skipped["stale-odds"] === 1 && r.skipped["not-met"] === 1, "dry run: stale NBA odds skipped, unmet counted");
  ok(rpcCalls.length === 1 && rpcCalls[0].fn === "line_alerts_pending", "dry run: never calls line_alerts_fire");
  ok(!out.join("\n").includes(KEY) && out.some(l => /dry run: nothing sent/.test(l)), "dry run: key never printed");
  ok(rpcCalls[0].headers.apikey === DEFAULTS.publishable && !rpcCalls[0].headers.authorization, "uses only the publishable key + the alerts key");
  rpcCalls = [];
  const s = await run({ mode: "send", data: dir, now: NOW }, { LINE_ALERTS_KEY: KEY }, () => {});
  ok(rpcCalls.map(c => c.fn).join() === "line_alerts_pending,line_alerts_fire" && rpcCalls[1].body.p_hits.length === 2 && rpcCalls[1].body.p_key === KEY, "send: posts hits to line_alerts_fire");
  ok(s.res.status === "disabled", "send: database switch reported");
  rpcCalls = [];
  const off = await run({ mode: "off", data: dir, now: NOW }, { LINE_ALERTS_KEY: KEY }, () => {});
  ok(off.hits.length === 0 && rpcCalls.length === 0, "mode off: does nothing");
  const nokey = await run({ mode: "send", data: dir, now: NOW }, {}, () => {});
  ok(nokey.skipped === "no-key" && rpcCalls.length === 0, "no key: skip without calling the database");
  write("meta.json", meta("2026-10-27T15:00:00Z"));
  let err = null; try { await run({ mode: "send", data: dir, now: NOW }, { LINE_ALERTS_KEY: KEY }, () => {}); } catch (e) { err = e; }
  ok(err && /stale lines/.test(err.message) && !rpcCalls.some(c => c.fn === "line_alerts_fire"), "stale site data: refuses, sends nothing");
  let e2 = null; try { await loadData(dir, alerts, NOW); } catch (e) { e2 = e; } ok(!!e2, "loadData refuses stale meta");
}
globalThis.fetch = realFetch;
fs.rmSync(dir, { recursive: true, force: true });

// ---------- workflow defaults
{
  const wf = fs.readFileSync(".github/workflows/line-alerts.yml", "utf8");
  ok(/vars\.ALERTS_ENABLED == '1' \|\| vars\.ALERTS_ENABLED == 'dry-run'/.test(wf), "workflow: scheduled runs only when ALERTS_ENABLED is 1 or dry-run");
  // run the real "Pick mode" shell step for each setting
  const m = wf.match(/id: mode[\s\S]*?run: \|\n([\s\S]*?)\n\n/);
  ok(!!m, "workflow: found the Pick mode step");
  if (m) {
    const script = m[1].replace(/^ {10}/gm, "");
    const { execFileSync } = await import("child_process");
    const pick = (EVENT, ENABLED, INPUT_MODE) => { const f = path.join(os.tmpdir(), "la-mode-" + process.pid); fs.writeFileSync(f, "");
      execFileSync("bash", ["-c", script], { env: { PATH: process.env.PATH, EVENT, ENABLED, INPUT_MODE, GITHUB_OUTPUT: f }, stdio: "pipe" });
      const v = fs.readFileSync(f, "utf8").trim(); fs.rmSync(f); return v; };
    eq([pick("workflow_run", "", ""), pick("workflow_run", "dry-run", ""), pick("workflow_run", "1", ""), pick("workflow_dispatch", "", "send"), pick("workflow_dispatch", "", ""), pick("workflow_dispatch", "1", "send")],
      ["mode=dry-run", "mode=dry-run", "mode=send", "mode=dry-run", "mode=dry-run", "mode=send"], "workflow: mode picking (send only with ALERTS_ENABLED=1)");
  }
  ok(!/ODDS_API_KEY/.test(wf) && !/RESEND_API_KEY/.test(wf), "workflow: no Odds API or Resend key");
  ok(/contents: read/.test(wf) && /workflow_run/.test(wf) && /Refresh data and deploy to GitHub Pages/.test(wf), "workflow: read-only, runs after the refresh");
  ok(/vars\.ALERTS_ENABLED/.test(wf), "workflow: gated by ALERTS_ENABLED (unset = off)");
  const sql = fs.readFileSync("supabase/migrations/20261027_line_alerts.sql", "utf8");
  ok(/enabled\s+boolean\s+not null\s+default\s+false/i.test(sql), "database switch defaults to off");
}

console.log(fails.length ? `\n${fails.length}/${n} FAILED` : `line alerts: ${n}/${n} passed`);
process.exit(fails.length ? 1 : 0);
