/* LineSmart player matchups: pure logic (no DOM). Loaded in the browser as window.MatchCore and in Node tests via require().
 * Input is ESPN's athlete gamelog (site.web.api common/v3 .../athletes/{id}/gamelog[?season=YYYY]) and our own
 * data/<lg>/index.json games + data/matchups/<lg>.json (opponent defense vs position, built by scripts/matchups.py). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MatchCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const isNum = v => v !== null && v !== undefined && v !== "" && !isNaN(v) && isFinite(v);
  const r1 = v => (isNum(v) ? Math.round(v * 10) / 10 : null);

  // "1,077" -> 1077, "-" / "" -> null
  const num = s => { if (s === null || s === undefined) return null; const t = String(s).replace(/,/g, "").trim(); return t === "" || t === "-" || t === "--" || isNaN(t) ? null : Number(t); };

  /** Flatten one gamelog into rows, newest first. Preseason / All-Star blocks are dropped.
   *  Paired columns ("fieldGoalsMade-fieldGoalsAttempted": "4-11") are split into both names. */
  function parseLog(gl, seasonKey) {
    if (!gl || !gl.events) return [];
    const sk = String(seasonKey || currentSeason(gl) || "");
    const names = gl.names || [], out = {};
    for (const st of gl.seasonTypes || []) {
      const label = st.displayName || "";
      if (/pre.?season|all.?star/i.test(label)) continue;
      const post = /post|playoff/i.test(label);
      for (const c of st.categories || []) for (const e of c.events || []) {
        const ev = gl.events[e.eventId];
        if (!e.eventId || !ev || !ev.gameDate || out[e.eventId]) continue;
        const v = {};
        (e.stats || []).forEach((raw, i) => {
          const n = names[i]; if (!n) return;
          if (n.includes("-") && /^\s*\d+\s*-\s*\d+\s*$/.test(String(raw))) {
            const [a, b] = n.split("-"), [x, y] = String(raw).split("-").map(Number);
            v[a] = x; v[b] = y;
          } else v[n] = num(raw);
        });
        const o = ev.opponent || {};
        const home = ev.atVs === "@" ? false : ev.atVs === "vs" ? true : null;
        out[e.eventId] = { id: String(e.eventId), date: ev.gameDate, oppId: String(o.id || ""), opp: o.abbreviation || o.displayName || "", oppName: o.displayName || "",
          oppLogo: o.logo || "", home, atVs: ev.atVs || "", res: ev.gameResult || "", score: ev.score || "", post, season: label, seasonKey: sk, v };
      }
    }
    return Object.values(out).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  /** Merge several parsed logs (different seasons), de-duplicated by event id, newest first. */
  function mergeRows(...lists) {
    const m = {}; lists.flat().forEach(r => { if (r && !m[r.id]) m[r.id] = r; });
    return Object.values(m).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  /** Season values listed in a gamelog's filter (newest first), e.g. ["2027","2026",...] */
  const seasonsOf = gl => (((gl && gl.filters) || []).find(f => f.name === "season") || {}).options?.map(o => String(o.value)) || [];
  const currentSeason = gl => String((((gl && gl.filters) || []).find(f => f.name === "season") || {}).value || "");

  // ---------- positions and the stats we headline
  const NFL_POS = { QB: "QB", RB: "RB", FB: "RB", HB: "RB", WR: "WR", TE: "TE" };
  const NBA_POS = { PG: "G", SG: "G", G: "G", SF: "F", PF: "F", F: "F", C: "C", "G-F": "G", "F-G": "F", "F-C": "F", "C-F": "C" };
  function posBucket(lg, pos) {
    const p = String(pos || "").toUpperCase();
    if (lg === "nfl") return NFL_POS[p] || null;
    if (lg === "nba") return NBA_POS[p] || null;
    return null;
  }
  // [gamelog stat name, label, defense-vs-position key (data/matchups) or null]
  const STATS = {
    nfl: {
      QB: [["passingYards", "Pass yds", "py"], ["passingTouchdowns", "Pass TD", "ptd"], ["interceptions", "INT", "int"], ["rushingYards", "Rush yds", "ry"], ["completions", "Cmp", null]],
      RB: [["rushingYards", "Rush yds", "ry"], ["rushingAttempts", "Carries", null], ["receptions", "Rec", "rec"], ["receivingYards", "Rec yds", "recy"], ["rushingTouchdowns", "Rush TD", "rtd"]],
      WR: [["receptions", "Rec", "rec"], ["receivingYards", "Rec yds", "recy"], ["receivingTouchdowns", "Rec TD", "rectd"], ["receivingTargets", "Targets", "tgt"]],
      TE: [["receptions", "Rec", "rec"], ["receivingYards", "Rec yds", "recy"], ["receivingTouchdowns", "Rec TD", "rectd"], ["receivingTargets", "Targets", "tgt"]],
    },
    nba: { _: [["points", "Pts", "pts"], ["totalRebounds", "Reb", "reb"], ["assists", "Ast", "ast"], ["threePointFieldGoalsMade", "3PM", "tpm"], ["minutes", "Min", null]] },
    nhl: { _: [["goals", "G", null], ["assists", "A", null], ["points", "Pts", null], ["shotsTotal", "SOG", null]] },
  };
  /** Headline stats for a player: league/position table, else the first few numeric columns of the log. */
  function statDefs(lg, pos, gl, rows) {
    const L = STATS[lg] || {}, b = posBucket(lg, pos);
    let defs = (b && L[b]) || L._ || null;
    const have = k => (rows || []).some(r => isNum(r.v[k]));
    if (defs) { defs = defs.filter(d => have(d[0])); if (defs.length) return defs; }
    const labels = (gl && gl.labels) || [], names = (gl && gl.names) || [];
    return names.map((n, i) => [n.includes("-") ? n.split("-")[0] : n, labels[i] || n, null]).filter(d => have(d[0]) && !/pct|percent|avg|long|rating|qbr/i.test(d[0])).slice(0, 4);
  }

  // ---------- averages, form, splits, hit rate
  function avg(rows, key) {
    const v = (rows || []).map(r => r.v[key]).filter(isNum);
    return v.length ? r1(v.reduce((s, x) => s + x, 0) / v.length) : null;
  }
  const lastN = (rows, n) => (rows || []).slice(0, n);
  /** "up" / "down" / "flat" comparing a recent average to the baseline (±tol relative, with a small absolute floor). */
  function trend(recent, base, tol = 0.1) {
    if (!isNum(recent) || !isNum(base)) return null;
    const d = recent - base, band = Math.max(Math.abs(base) * tol, 0.5);
    return d > band ? "up" : d < -band ? "down" : "flat";
  }
  function splitHA(rows, key) {
    const h = (rows || []).filter(r => r.home === true), a = (rows || []).filter(r => r.home === false);
    return { home: avg(h, key), away: avg(a, key), nh: h.length, na: a.length };
  }
  const vsOpp = (rows, oppId) => (rows || []).filter(r => oppId && r.oppId === String(oppId));
  /** Share of the last n games where the stat went over `line` (games without the stat are skipped). */
  function hitRate(rows, key, line, n = 10) {
    const g = (rows || []).filter(r => isNum(r.v[key])).slice(0, n);
    if (!g.length || !isNum(line)) return { n: g.length, over: 0, push: 0, pct: null, games: [] };
    const over = g.filter(r => r.v[key] > line).length, push = g.filter(r => r.v[key] === Number(line)).length;
    return { n: g.length, over, push, pct: Math.round(100 * over / g.length), games: g.map(r => ({ id: r.id, date: r.date, opp: r.opp, val: r.v[key], over: r.v[key] > line, push: r.v[key] === Number(line) })) };
  }
  /** Neutral default threshold: the season average rounded down to the nearest .5 below it (e.g. 72.4 -> 71.5). */
  const defaultLine = a => (isNum(a) ? Math.max(0.5, Math.floor(a - 0.5) + 0.5) : 0.5);

  /** Baseline "season" rows: this season's games (regular + post); if there are none yet, the latest season with games. */
  function seasonRows(rows, cur) {
    const by = {}; (rows || []).forEach(r => (by[r.seasonKey] ||= []).push(r));
    if (cur && by[cur] && by[cur].length) return { key: cur, rows: by[cur] };
    const first = (rows || [])[0];
    return first ? { key: first.seasonKey, rows: by[first.seasonKey], fallback: true } : { key: null, rows: [] };
  }

  // ---------- next game + opponent defense
  /** The team's next game (not finished) from our data/<lg>/index.json games list. */
  function nextGame(games, teamId) {
    const id = String(teamId || "");
    if (!id) return null;
    const g = (games || []).filter(x => x.state !== "post" && (String(x.home.id) === id || String(x.away.id) === id)).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    if (!g) return null;
    const home = String(g.home.id) === id;
    return { game: g, home, team: home ? g.home : g.away, opp: home ? g.away : g.home };
  }
  /** Spread (for the player's team) and total per book for a game, from ESPN odds + tracked books. */
  function linesFor(g, home) {
    if (!g) return [];
    const side = home ? "home" : "away", out = [];
    const add = (name, o, asOf, key) => { if (o && (isNum(o[side + "Spread"]) || isNum(o.total) || isNum(o[side + "ML"]))) out.push({ book: name, key: key || null, spread: isNum(o[side + "Spread"]) ? Number(o[side + "Spread"]) : null, ml: isNum(o[side + "ML"]) ? Number(o[side + "ML"]) : null, total: isNum(o.total) ? Number(o.total) : null, asOf: asOf || null }); };
    const B = g.books || {};
    if (B.draftkings && !B.draftkings.stale) add("DraftKings", B.draftkings, B.draftkings.asOf, "draftkings");
    if (B.hardrockbet && !B.hardrockbet.stale) add("Hard Rock Bet", B.hardrockbet, B.hardrockbet.asOf, "hardrockbet");
    if (B.fanduel && !B.fanduel.stale) add("FanDuel", B.fanduel, B.fanduel.asOf, "fanduel");
    if (!out.length && g.odds) add(g.odds.provider || "ESPN", g.odds);
    return out;
  }
  const ordinal = n => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  /** Defense tier from a rank (1 = fewest allowed): "tough" top third, "soft" bottom third. */
  function tier(rank, n) {
    if (!isNum(rank) || !isNum(n) || n < 3) return null;
    return rank <= Math.ceil(n / 3) ? "tough" : rank > n - Math.ceil(n / 3) ? "soft" : "mid";
  }
  /** Opponent's allowed stats for a position bucket: [{key,label,val,rank,tier}] (or team-level when no bucket). */
  function oppDefense(mu, oppId, bucket) {
    const t = mu && mu.teams && mu.teams[String(oppId)];
    if (!t) return null;
    const n = mu.nTeams || Object.keys(mu.teams).length;
    const mk = (defs, src) => (defs || []).map(([k, label]) => { const x = src && src[k]; return x ? { key: k, label, val: x[0], rank: x[1], tier: k === "pace" ? null : tier(x[1], n) } : null; }).filter(Boolean);
    return { gp: t.gp, n, bucket: bucket && t.pos[bucket] ? bucket : null, pos: bucket && t.pos[bucket] ? mk(mu.posStats[bucket], t.pos[bucket]) : [], team: mk(mu.teamStats, t.team) };
  }
  /** The defense-vs-position stat behind a "season leaders" category on the game page. */
  function leaderKey(lg, cat, bucket) {
    const c = String(cat || "").toLowerCase();
    if (lg === "nfl") return /pass/.test(c) ? ["QB", "py"] : /rush/.test(c) ? ["RB", "ry"] : /rec/.test(c) ? [bucket === "TE" ? "TE" : "WR", "recy"] : null;
    if (lg === "nba") return !bucket ? null : /point/.test(c) ? [bucket, "pts"] : /rebound/.test(c) ? [bucket, "reb"] : /assist/.test(c) ? [bucket, "ast"] : null;
    return null;
  }

  return { isNum, num, parseLog, mergeRows, seasonsOf, currentSeason, posBucket, STATS, statDefs, avg, lastN, trend, splitHA, vsOpp, hitRate, defaultLine,
    seasonRows, nextGame, linesFor, ordinal, tier, oppDefense, leaderKey };
});
