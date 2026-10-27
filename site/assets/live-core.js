/* LineSmart live scores: pure logic (no DOM, no fetch). Browser: window.LiveCore. Node: require("./live-core.js").
 * The static site data (data/*.json) is rebuilt by GitHub Actions about every 15-30 min, which is far too slow for a game
 * in progress. While a game is live, assets/live.js polls ESPN's public scoreboard / summary JSON straight from the browser
 * (site.web.api.espn.com sends Access-Control-Allow-Origin; site.api.espn.com does NOT, so never use that host here) and
 * this module turns those responses into small overlays the page can merge onto the static game objects.
 *
 * Bandwidth (gzip, measured Oct 26 2026): scoreboard?dates=<one day> is ~3 KB for one NFL game, ~10-15 KB for a full NBA
 * night; a game summary (box score) is ~30 KB. Scoreboards are polled only for leagues that have a live game, summaries only
 * on an open game page, and nothing at all when no game is live or the tab is hidden. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LiveCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const HOST = "https://site.web.api.espn.com/apis/site/v2/sports/";
  // ESPN path, extra scoreboard params (same groups as scripts/build_data.py) and sport kind. UFC is not polled (fight cards).
  const LEAGUES = {
    nfl: ["football/nfl", "", "football"], ncaaf: ["football/college-football", "&groups=80&limit=300", "football"],
    nba: ["basketball/nba", "", "basketball"], ncaab: ["basketball/mens-college-basketball", "&groups=50&limit=300", "basketball"],
    nhl: ["hockey/nhl", "", "hockey"], mlb: ["baseball/mlb", "", "baseball"],
    epl: ["soccer/eng.1", "", "soccer"], mls: ["soccer/usa.1", "", "soccer"], ucl: ["soccer/uefa.champions", "", "soccer"],
  };
  const SCORE_MS = 25000;        // scoreboard poll while something is live and the tab is visible
  const SUMMARY_MS = 30000;      // box score poll on an open live game page
  const SAVE_DATA_SUMMARY_MS = 60000;  // Data Saver / 2G-3G: box score less often
  const MAX_BACKOFF_MS = 300000; // ESPN failing: 25s, 50s, 100s, 200s, 300s ...
  const START_GRACE_MS = 2 * 60e3;     // treat a "pre" game as possibly live from 2 min before its listed start
  const MAX_GAME_MS = 7 * 3600e3;      // ...until 7 h after it (extra innings, delays); after that trust the static data

  const num = v => (v === null || v === undefined || v === "" || isNaN(v) ? null : Number(v));
  const str = v => (v === null || v === undefined ? null : String(v));
  const supported = lg => Object.prototype.hasOwnProperty.call(LEAGUES, lg);
  const kindOf = lg => (supported(lg) ? LEAGUES[lg][2] : null);

  // ESPN's scoreboard "dates" are US Eastern days; a 7:30 PM ET game is on that ET day even though it is the next UTC day.
  function etDay(iso) {
    const d = new Date(iso); if (isNaN(d)) return null;
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const g = t => (p.find(x => x.type === t) || {}).value;
    return `${g("year")}${g("month")}${g("day")}`;
  }
  const scoreboardUrl = (lg, day) => (supported(lg) ? `${HOST}${LEAGUES[lg][0]}/scoreboard?dates=${day}${LEAGUES[lg][1]}` : null);
  const summaryUrl = (lg, id) => (supported(lg) ? `${HOST}${LEAGUES[lg][0]}/summary?event=${encodeURIComponent(id)}` : null);

  // Does this game need live polling right now? g = {lg, id, state, date}; ov = latest live overlay for it (if any).
  function needsLive(g, now = Date.now(), ov = null) {
    if (!g || !supported(g.lg)) return false;
    const st = (ov && ov.state) || g.state;
    if (st === "post") return false;
    if (st === "in") return true;
    const t = Date.parse(g.date);
    return st === "pre" && !isNaN(t) && now >= t - START_GRACE_MS && now - t < MAX_GAME_MS;   // static file may predate kickoff
  }
  // Which scoreboards to poll: { lg: Set(days) } for the games that need it.
  function plan(games, now = Date.now(), overlays = {}) {
    const out = {};
    for (const g of games || []) {
      if (!needsLive(g, now, overlays[key(g.lg, g.id)])) continue;
      const day = etDay(g.date); if (!day) continue;
      (out[g.lg] ||= new Set()).add(day);
    }
    return out;
  }
  const key = (lg, id) => `${lg}/${id}`;

  // ---------- situation (down & distance, possession, bases/count)
  function situation(kind, sit, comps) {
    if (!sit) return null;
    const lp = sit.lastPlay && sit.lastPlay.text ? String(sit.lastPlay.text) : null;
    if (kind === "football") {
      const poss = str(sit.possession);
      const abbr = poss && comps ? (comps.find(c => c.id === poss) || {}).abbr : null;
      const dd = sit.downDistanceText || sit.shortDownDistanceText || null;
      return { text: dd ? dd + (abbr ? ` · ${abbr} ball` : "") : abbr ? `${abbr} ball` : null, possession: poss, redZone: !!sit.isRedZone, lastPlay: lp };
    }
    if (kind === "baseball") {
      if (((sit.lastPlay || {}).type || {}).type === "end-inning") return { text: null, possession: null, redZone: false, lastPlay: lp };   // between half-innings
      const on = [sit.onFirst && "1st", sit.onSecond && "2nd", sit.onThird && "3rd"].filter(Boolean);
      const outs = num(sit.outs), b = num(sit.balls), s = num(sit.strikes);
      const parts = [];
      if (outs !== null) parts.push(`${outs} out`);
      if (on.length) parts.push(on.length === 3 ? "bases loaded" : `on ${on.join(", ")}`);
      if (b !== null && s !== null && (b || s)) parts.push(`${b}-${s}`);
      const bat = sit.batter && sit.batter.athlete ? sit.batter.athlete.shortName || sit.batter.athlete.displayName : null;
      if (bat) parts.push(`AB: ${bat}`);
      return { text: parts.join(" · ") || null, possession: null, redZone: false, lastPlay: lp, outs, bases: [!!sit.onFirst, !!sit.onSecond, !!sit.onThird] };
    }
    return lp ? { text: null, possession: null, redZone: false, lastPlay: lp } : null;
  }

  // ---------- scoreboard -> overlays
  function competitor(c) {
    const t = c.team || {};
    const ls = (c.linescores || []).map(x => (x.displayValue !== undefined ? String(x.displayValue) : x.value !== undefined ? String(x.value) : ""));
    return { id: str(c.id || t.id), abbr: t.abbreviation || "", score: c.score === undefined || c.score === null ? null : String(typeof c.score === "object" ? c.score.displayValue ?? c.score.value : c.score),
             winner: c.winner === undefined ? null : !!c.winner, linescores: ls, hits: num(c.hits), errors: num(c.errors) };
  }
  function overlayFromCompetition(lg, id, status, comp, asOf) {
    const st = (status || {}).type || {};
    const cs = (comp.competitors || []).map(c => Object.assign(competitor(c), { homeAway: c.homeAway }));
    const home = cs.find(c => c.homeAway === "home"), away = cs.find(c => c.homeAway === "away");
    if (!home || !away || !st.state) return null;
    delete home.homeAway; delete away.homeAway;
    const kind = kindOf(lg);
    return {
      lg, id: String(id), asOf, state: st.state, completed: !!st.completed,
      detail: st.shortDetail || st.detail || st.description || "", clock: status.displayClock || null, period: num(status.period),
      home, away, situation: situation(kind, comp.situation, [home, away]),
    };
  }
  function parseScoreboard(lg, sb, asOf = new Date().toISOString()) {
    const out = {};
    for (const e of (sb && sb.events) || []) {
      const comp = (e.competitions || [])[0]; if (!comp) continue;
      const ov = overlayFromCompetition(lg, e.id, e.status || comp.status, comp, asOf);
      if (ov) out[key(lg, ov.id)] = ov;
    }
    return out;
  }

  // ---------- summary -> box score model
  const COLS = {   // columns kept per player-stat group (ESPN sends up to ~21); anything not listed keeps its first 9
    basketball: ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-"],
    "hockey:forwards": ["G", "A", "SOG", "+/-", "TOI", "HT", "BS", "PIM"], "hockey:defenses": ["G", "A", "SOG", "+/-", "TOI", "HT", "BS", "PIM"],
    "hockey:skaters": ["G", "A", "SOG", "+/-", "TOI", "HT", "BS", "PIM"], "hockey:goalies": ["SA", "GA", "SV", "SV%", "TOI"],
    "baseball:batting": ["AB", "R", "H", "RBI", "HR", "BB", "K", "AVG"], "baseball:pitching": ["IP", "H", "R", "ER", "BB", "K", "HR", "PC-ST", "ERA"],
  };
  const ROWS = { football: 4, basketball: 15, hockey: 14, baseball: 12, soccer: 14 };
  const GROUP_NAME = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", fumbles: "Fumbles", defensive: "Defense", interceptions: "Interceptions",
    kickReturns: "Kick returns", puntReturns: "Punt returns", kicking: "Kicking", punting: "Punting", forwards: "Forwards", defenses: "Defense", skaters: "Skaters",
    goalies: "Goalies", batting: "Batting", pitching: "Pitching" };
  const FB_SKIP = new Set(["fumbles", "interceptions", "kickReturns", "puntReturns", "punting"]);   // keep the football box short

  const MLB_TEAM = { batting: [["R", "Runs"], ["H", "Hits"], ["HR", "Home runs"], ["RBI", "RBI"], ["BB", "Walks"], ["SO", "Strikeouts"], ["LOB", "Left on base"], ["AVG", "Batting avg"]],
    pitching: [["K", "Pitcher strikeouts"], ["BB", "Walks allowed"], ["ER", "Earned runs"], ["P", "Pitches"]], fielding: [["E", "Errors"]] };
  function teamStats(bt) {
    const out = [];
    for (const s of (bt && bt.statistics) || []) {
      if (Array.isArray(s.stats)) {   // grouped (MLB): batting / pitching / fielding with nested stats
        const want = MLB_TEAM[s.name] || [];   // ESPN sends ~60 season-style stats per group; keep the few that matter tonight
        for (const [ab, label] of want) { const x = s.stats.find(y => y && y.abbreviation === ab); if (x && x.displayValue !== undefined) out.push({ label, value: String(x.displayValue) }); }
      } else if (s.displayValue !== undefined) out.push({ label: s.label || s.displayName || s.name || "", value: String(s.displayValue) });
    }
    // de-duplicate labels (ESPN repeats "Interceptions thrown" in the NFL box)
    const seen = new Set(); return out.filter(r => r.label && !seen.has(r.label) && seen.add(r.label));
  }
  function playerGroups(kind, team) {
    const groups = [];
    for (const s of (team && team.statistics) || []) {
      const name = s.name || s.type || "", ath = (s.athletes || []).filter(a => a && a.athlete && !a.didNotPlay && (a.stats || []).length);
      if (!ath.length || (kind === "football" && FB_SKIP.has(name))) continue;
      const labels = s.labels || [];
      const want = COLS[kind] || COLS[`${kind}:${name}`];
      const idx = want ? want.map(l => labels.indexOf(l)).filter(i => i >= 0) : labels.slice(0, 9).map((_, i) => i);
      if (!idx.length) continue;
      const lim = ROWS[kind] || 10;
      groups.push({
        name, title: GROUP_NAME[name] || s.text || (kind === "basketball" ? "Players" : name || "Players"),
        labels: idx.map(i => labels[i]),
        rows: ath.slice(0, lim).map(a => ({ name: a.athlete.shortName || a.athlete.displayName || "", id: str(a.athlete.id), starter: !!a.starter, stats: idx.map(i => (a.stats[i] === undefined ? "" : String(a.stats[i]))) })),
        more: Math.max(0, ath.length - lim),
        totals: (s.totals || []).length ? idx.map(i => (s.totals[i] === undefined ? "" : String(s.totals[i]))) : null,
      });
    }
    return groups;
  }
  function parseSummary(lg, sm, asOf = new Date().toISOString()) {
    if (!sm || !sm.header) return null;
    const comp = (sm.header.competitions || [])[0]; if (!comp) return null;
    const ov = overlayFromCompetition(lg, sm.header.id || comp.id, comp.status, comp, asOf);
    if (!ov) return null;
    // the summary header marks possession on the competitor (no down & distance; the scoreboard overlay supplies that)
    const pc = (comp.competitors || []).find(c => c.possession);
    if (pc && kindOf(lg) === "football") ov.situation = Object.assign({ text: null, redZone: false, lastPlay: null }, ov.situation || {}, { possession: str(pc.id) });
    else if (!ov.situation) ov.situation = null;
    const kind = kindOf(lg), box = sm.boxscore || {};
    const byId = id => (box.teams || []).find(t => str((t.team || {}).id) === id);
    const pById = id => (box.players || []).find(t => str((t.team || {}).id) === id);
    const team = side => ({ id: ov[side].id, abbr: ov[side].abbr, stats: teamStats(byId(ov[side].id)), players: playerGroups(kind, pById(ov[side].id)) });
    return { overlay: ov, box: { away: team("away"), home: team("home"), periods: Math.max(ov.home.linescores.length, ov.away.linescores.length, ov.state === "in" ? ov.period || 0 : 0) } };
  }

  // ---------- merging onto the static data
  // Live data wins only when it is newer than the static file it would replace.
  const fresher = (ov, generated) => !!ov && (!generated || Date.parse(ov.asOf) > Date.parse(generated));
  function mergeGame(g, ov, generated) {
    if (!g || !fresher(ov, generated)) return g;
    const t = (side) => Object.assign({}, g[side], ov[side].score !== null ? { score: ov[side].score } : {}, ov[side].winner !== null && ov.state === "post" ? { winner: ov[side].winner } : {});
    return Object.assign({}, g, { state: ov.state, statusDetail: ov.detail || g.statusDetail, completed: ov.completed, home: t("home"), away: t("away"), live: ov });
  }
  // ticker item {lg,id,st,d,det,a:{a,s},h:{a,s}}
  function mergeTicker(t, ov, generated) {
    if (!t || !fresher(ov, generated)) return t;
    return Object.assign({}, t, { st: ov.state, det: ov.detail || t.det, a: Object.assign({}, t.a, { s: ov.away.score ?? t.a.s }), h: Object.assign({}, t.h, { s: ov.home.score ?? t.h.s }) });
  }
  // Fingerprint of what's on screen: skip DOM work when a poll changed nothing visible.
  const sig = ov => (!ov ? "" : [ov.state, ov.detail, ov.home.score, ov.away.score, ov.situation && ov.situation.text, ov.situation && ov.situation.possession].join("|"));

  // Poll cadence. saveData = navigator.connection.saveData or a 2g/3g effectiveType.
  function intervals({ saveData = false, failures = 0 } = {}) {
    const back = failures > 0 ? Math.min(MAX_BACKOFF_MS, SCORE_MS * 2 ** Math.min(failures, 8)) : 0;
    return { score: back || SCORE_MS, summary: back || (saveData ? SAVE_DATA_SUMMARY_MS : SUMMARY_MS) };
  }

  return { HOST, LEAGUES, SCORE_MS, SUMMARY_MS, SAVE_DATA_SUMMARY_MS, MAX_BACKOFF_MS, supported, kindOf, etDay, scoreboardUrl, summaryUrl, needsLive, plan, key,
           situation, parseScoreboard, parseSummary, mergeGame, mergeTicker, sig, intervals, fresher };
});
