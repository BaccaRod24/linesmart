window.__PRO_BUILD="820f7955cc-2026-10-30T17:59:40Z";
/* Hot props for LineSmart Pro. Pure logic: no DOM, no network.
   Input is data/props/<lg>.json (the shape scripts/props.py writes) plus props-core.js.
   Browser: window.HotProps. Node: require("./hot-props-core.js"). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../site/assets/props-core.js"));
  else root.HotProps = factory(root.PropsCore);
})(typeof self !== "undefined" ? self : this, function (P) {
  "use strict";
  const KEY = "ls-pro-hot-v1";
  const SPORT_FIRST = ["nfl", "nba", "nhl", "mlb", "ncaaf", "ncaab"];
  const SPORT_LABEL = { nfl: "NFL", nba: "NBA", nhl: "NHL", mlb: "MLB", ncaaf: "NCAAF", ncaab: "NCAAB" };
  const isNum = v => typeof v === "number" && isFinite(v);

  /** Implied probability of an American price, or null when it isn't a real price. */
  function implied(a) {
    if (!isNum(a) || Math.abs(a) < 100) return null;
    return a > 0 ? 100 / (a + 100) : -a / (-a + 100);
  }

  /** Leagues that have a props file: NFL, NBA, NHL, MLB, NCAAF, NCAAB first, then any other file. */
  function sportList(docs) {
    const have = Object.keys(docs || {}).filter(k => docs[k] && docs[k].games && Object.keys(docs[k].games).length);
    const named = SPORT_FIRST.filter(k => have.includes(k));
    const rest = have.filter(k => !SPORT_FIRST.includes(k)).sort();
    return [...named, ...rest];
  }

  /** One flat row per prop. `open` is the file's opening line (often null). `books` come from props-core. */
  function collect(docs) {
    const rows = [];
    for (const [lg, doc] of Object.entries(docs || {})) {
      if (!doc || !doc.games) continue;
      const markets = doc.markets || {}, players = doc.players || {};
      for (const [gid, g] of Object.entries(doc.games)) {
        for (const row of g.props || []) {
          const [pid, mk, line, open] = row;
          const pl = players[pid];
          if (!pl || !isNum(line)) continue;
          rows.push({
            lg, gid: String(gid), pid: String(pid),
            name: pl.n || "Player", pos: pl.pos || "", team: pl.ta || "", teamId: String(pl.t || ""),
            mk, label: (markets[mk] || [mk])[0],
            line, open: isNum(open) ? open : null,
            books: P.rowBooks(row), log: pl.log || [],
          });
        }
      }
    }
    return rows;
  }

  function applyFilters(rows, f = {}) {
    const lg = f.lg && f.lg !== "all" ? f.lg : "";
    const team = String(f.team || "").trim().toLowerCase();
    const player = String(f.player || "").trim().toLowerCase();
    const mk = f.mk && f.mk !== "all" ? f.mk : "";
    return rows.filter(r => {
      if (lg && r.lg !== lg) return false;
      if (team && r.team.toLowerCase() !== team && String(r.teamId) !== String(f.team).trim()) return false;
      if (player && String(r.pid).toLowerCase() !== player && !r.name.toLowerCase().includes(player)) return false;
      if (mk && r.mk !== mk) return false;
      return true;
    });
  }

  /** Widest implied-probability gap between two books that posted the same line and a price. Different lines are not a price gap. */
  function gapOf(books) {
    const groups = new Map();
    for (const b of books || []) {
      if (!b || !isNum(b.line)) continue;
      const k = String(b.line);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(b);
    }
    let best = null;
    for (const [line, list] of groups) {
      for (const side of ["over", "under"]) {
        const priced = [];
        for (const b of list) {
          const p = implied(b[side]);
          if (p == null) continue;
          priced.push({ key: b.key, line: b.line, price: b[side], p, side });
        }
        if (priced.length < 2) continue;
        const ps = priced.map(x => x.p);
        const gap = Math.max(...ps) - Math.min(...ps);
        if (gap < 1e-9) continue;
        if (!best || gap > best.gap) best = { line: Number(line), side, gap, quotes: priced };
      }
    }
    return best;
  }

  /** True when any row has a real over or under price. No prices means the gap section stays hidden. */
  function hasPrices(rows) {
    return (rows || []).some(r => (r.books || []).some(b => implied(b && b.over) != null || implied(b && b.under) != null));
  }

  function priceGaps(rows) {
    const out = [];
    for (const r of rows) {
      const g = gapOf(r.books);
      if (g) out.push({ ...r, ...g });
    }
    out.sort((a, b) => b.gap - a.gap || a.name.localeCompare(b.name) || a.mk.localeCompare(b.mk));
    return out;
  }

  const hasOpen = rows => rows.some(r => isNum(r.open));

  /** Opening line to current line. Empty when the file stored no opening line. */
  function lineMoves(rows) {
    const out = [];
    for (const r of rows) {
      if (!isNum(r.open) || r.open === r.line) continue;
      out.push({ ...r, delta: r.line - r.open, abs: Math.abs(r.line - r.open), text: P.moveText(r.line, r.open) });
    }
    out.sort((a, b) => b.abs - a.abs || a.name.localeCompare(b.name) || a.mk.localeCompare(b.mk));
    return out;
  }

  function hasLog(rows) {
    return rows.some(r => (r.log || []).some(g => g && g[3] && typeof g[3] === "object"));
  }

  /** Line the streak is graded on: the first preferred book that posted it, else the row line. */
  function gradedLine(row, prefer) {
    for (const k of prefer || []) {
      const b = (row.books || []).find(x => x.key === k);
      if (b && isNum(b.line)) return { line: b.line, book: k };
    }
    return { line: row.line, book: null };
  }

  /** Players the props page would call hot. `available` is false when no game log is in the rows. */
  function hotStreaks(rows, prefer) {
    if (!hasLog(rows)) return { available: false, rows: [] };
    const out = [];
    for (const r of rows) {
      const g = gradedLine(r, prefer);
      if (!P.isHot(r.log, r.mk, g.line)) continue;
      const sm = P.summary(r.log, r.mk, g.line, 5);
      out.push({ ...r, gradedLine: g.line, gradedBook: g.book, text: sm.text, pct: sm.pct, overs: sm.o, played: sm.n });
    }
    out.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.overs - a.overs || a.name.localeCompare(b.name));
    return { available: true, rows: out };
  }

  function validSaved(x) {
    return !!x && typeof x.id === "string" && x.id.length > 0 && x.id.length <= 40
      && typeof x.name === "string" && x.name.trim().length > 0 && x.name.trim().length <= 40
      && typeof x.lg === "string";
  }
  function readSaved(store) {
    if (!store || !store.getItem) return [];
    let raw;
    try { raw = JSON.parse(store.getItem(KEY) || "[]"); } catch (e) { return []; }
    if (!Array.isArray(raw)) return [];
    return raw.filter(validSaved).slice(0, 12);
  }
  function addSaved(store, entry) {
    const name = String(entry && entry.name || "").trim();
    if (!name) return { ok: false, error: "Name this filter." };
    if (name.length > 40) return { ok: false, error: "Use 40 characters or fewer." };
    const row = {
      id: String(entry.id || Date.now()),
      name,
      lg: String(entry.lg || "nfl"),
      team: String(entry.team || ""),
      player: String(entry.player || ""),
      mk: String(entry.mk || "all"),
    };
    if (!validSaved(row)) return { ok: false, error: "That filter couldn't be saved." };
    const list = readSaved(store).filter(x => x.id !== row.id);
    if (list.length >= 12) return { ok: false, error: "Delete a saved filter first (12 is the limit)." };
    list.push(row);
    store.setItem(KEY, JSON.stringify(list));
    return { ok: true, list, row };
  }
  function removeSaved(store, id) {
    const list = readSaved(store).filter(x => x.id !== id);
    store.setItem(KEY, JSON.stringify(list));
    return list;
  }

  return {
    KEY, SPORT_FIRST, SPORT_LABEL, implied, sportList, collect, applyFilters, gapOf, hasPrices, priceGaps,
    hasOpen, lineMoves, hasLog, gradedLine, hotStreaks, readSaved, addSaved, removeSaved,
  };
});

/* Pro rankings. Pure logic: no DOM, no network.
   Season totals come from the compact box-score cache (scripts/matchups.py).
   Hit rate grades those games against a current prop line (data/props/<lg>.json, or the
   stored props pull in odds/props_oddsapi.json). It is not the line from each past week.
   Browser: window.Rankings. Node: require("./rankings-core.js"). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Rankings = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const TOP_N = 10;
  const HIT_MIN = 5;
  const BOOK_ORDER = ["hardrockbet", "draftkings", "fanduel"];
  const LEAGUES = [["nfl", "NFL"], ["nba", "NBA"], ["nhl", "NHL"], ["mlb", "MLB"], ["ncaaf", "NCAAF"], ["ncaab", "NCAAB"]];
  const NFL_MAP = { QB: "QB", RB: "RB", FB: "RB", HB: "RB", WR: "WR", TE: "TE" };
  const NBA_MAP = { PG: "G", SG: "G", G: "G", SF: "F", PF: "F", F: "F", C: "C", FC: "F", GF: "G" };
  const SPECS = {
    nfl: [
      { id: "QB", label: "QB", key: "py", perGame: false, cols: [["py", "Pass yds"], ["ptd", "Pass TD"]], hitMk: "pass_yds", hitLabel: "Pass yds" },
      { id: "RB", label: "RB", key: "ry", perGame: false, cols: [["ry", "Rush yds"], ["rtd", "Rush TD"]], hitMk: "rush_yds", hitLabel: "Rush yds" },
      { id: "WR", label: "WR", key: "recy", perGame: false, cols: [["recy", "Rec yds"], ["rec", "Rec"]], hitMk: "rec_yds", hitLabel: "Rec yds" },
      { id: "TE", label: "TE", key: "recy", perGame: false, cols: [["recy", "Rec yds"], ["rec", "Rec"]], hitMk: "rec_yds", hitLabel: "Rec yds" },
    ],
    nba: [
      { id: "G", label: "G", key: "pts", perGame: true, cols: [["pts", "PPG"], ["reb", "RPG"], ["ast", "APG"]], hitMk: "points", hitLabel: "Points" },
      { id: "F", label: "F", key: "pts", perGame: true, cols: [["pts", "PPG"], ["reb", "RPG"], ["ast", "APG"]], hitMk: "points", hitLabel: "Points" },
      { id: "C", label: "C", key: "pts", perGame: true, cols: [["pts", "PPG"], ["reb", "RPG"], ["ast", "APG"]], hitMk: "points", hitLabel: "Points" },
    ],
  };
  const NFL_KEYS = ["py", "ptd", "ry", "rtd", "rec", "recy", "rectd"];
  /** NFL season rankers. `sort` is the column that orders the top 10. Receptions are not a quarterback stat. */
  const SKILL_MODES = [
    { id: "yds", label: "Yards", sort: "recy", note: "Receiving yards", cols: [["recy", "Rec yds"], ["rectd", "Rec TD"], ["rec", "Rec"]] },
    { id: "td", label: "TDs", sort: "rectd", note: "Receiving TDs", cols: [["rectd", "Rec TD"], ["recy", "Rec yds"], ["rec", "Rec"]] },
    { id: "rec", label: "Receptions", sort: "rec", note: "Receptions", cols: [["rec", "Rec"], ["recy", "Rec yds"], ["rectd", "Rec TD"]] },
  ];
  const NFL_MODES = {
    QB: [
      { id: "yds", label: "Yards", sort: "py", note: "Passing yards", cols: [["py", "Pass yds"], ["ptd", "Pass TD"], ["ry", "Rush yds"], ["rtd", "Rush TD"]] },
      { id: "td", label: "TDs", sort: "qbtd", note: "Passing TDs plus rushing TDs", cols: [["qbtd", "TD"], ["ptd", "Pass TD"], ["rtd", "Rush TD"], ["py", "Pass yds"]] },
    ],
    RB: [
      { id: "yds", label: "Yards", sort: "ry", note: "Rushing yards", cols: [["ry", "Rush yds"], ["scrim", "Scrim yds"], ["rtd", "Rush TD"], ["rec", "Rec"]] },
      { id: "td", label: "TDs", sort: "rbtd", note: "Rushing TDs plus receiving TDs", cols: [["rbtd", "TD"], ["rtd", "Rush TD"], ["rectd", "Rec TD"], ["ry", "Rush yds"]] },
      { id: "rec", label: "Receptions", sort: "rec", note: "Receptions", cols: [["rec", "Rec"], ["recy", "Rec yds"], ["ry", "Rush yds"]] },
    ],
    WR: SKILL_MODES,
    TE: SKILL_MODES,
  };
  /** Same four per-game columns for every NBA position. 3PM is omitted when the cache has no threes. */
  const NBA_COLS = [["pts", "PPG"], ["reb", "RPG"], ["ast", "APG"], ["tpm", "3PM"]];
  const NBA_MODES = [
    { id: "pts", label: "Points", sort: "pts", note: "Points per game" },
    { id: "reb", label: "Rebounds", sort: "reb", note: "Rebounds per game" },
    { id: "ast", label: "Assists", sort: "ast", note: "Assists per game" },
    { id: "3pm", label: "3PM", sort: "tpm", note: "Threes made per game" },
  ];
  const isNum = v => typeof v === "number" && isFinite(v);
  const num = v => (isNum(v) ? v : 0);
  const clean = n => {
    if (!isNum(n)) return 0;
    const r = Math.round(n * 10) / 10;
    return Math.abs(r - Math.round(r)) < 1e-9 ? Math.round(r) : r;
  };

  function specsFor(lg) { return SPECS[lg] ? SPECS[lg].slice() : []; }
  function specById(lg, id) { return specsFor(lg).find(s => s.id === id) || null; }

  /** Roster or box abbreviation → the ranking bucket, or null when this tab doesn't rank that spot. */
  function bucket(lg, pos) {
    const map = lg === "nfl" ? NFL_MAP : lg === "nba" ? NBA_MAP : null;
    if (!map) return null;
    return map[String(pos || "").toUpperCase()] || null;
  }

  function nflFallback(p) {
    const c = (p && p._c) || [];
    if (c.indexOf("pass") >= 0 && num(p.att) >= 5) return "QB";
    if (c.indexOf("rece") >= 0) return "WR";
    if (c.indexOf("rush") >= 0) return "RB";
    return null;
  }

  function playerHash(lg, id) {
    return "#/p/" + encodeURIComponent(lg) + "/" + encodeURIComponent(String(id));
  }

  /** Same folding as scripts/odds_props.py norm_player, so a stored line matches a roster name. */
  function normPlayer(name) {
    const suf = { jr: 1, sr: 1, ii: 1, iii: 1, iv: 1, v: 1 };
    let s = String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    s = s.toLowerCase().replace(/\./g, "").replace(/'/g, "").replace(/’/g, "");
    return s.split(/[^a-z0-9]+/).filter(t => t && !suf[t]).join(" ");
  }

  function fmtStat(v, perGame) {
    if (!isNum(v)) return "—";
    if (perGame) return (Math.round(v * 10) / 10).toFixed(1);
    return String(Math.round(v));
  }

  function rawStat(p, key) {
    if (key === "qbtd") return num(p && p.ptd) + num(p && p.rtd);
    if (key === "rbtd") return num(p && p.rtd) + num(p && p.rectd);
    if (key === "scrim") return num(p && p.ry) + num(p && p.recy);
    return num(p && p[key]);
  }
  function statValue(p, key, perGame) {
    const raw = rawStat(p, key);
    if (!perGame) return raw;
    const gp = num(p && p.gp);
    return gp ? raw / gp : 0;
  }

  /** True when the player rows actually carry threes made. A missing field is not treated as zero. */
  function nbaThrees(players) {
    return (players || []).some(p => p && typeof p.tpm === "number");
  }
  function copyMode(m, cols) {
    return { id: m.id, label: m.label, sort: m.sort, note: m.note, cols: cols.map(c => c.slice()) };
  }
  /** NFL: yards / TDs / receptions. NBA: points, rebounds, assists, and 3PM when the cache has threes. */
  function statModes(lg, pos, players) {
    if (lg === "nfl") {
      const list = NFL_MODES[pos];
      return list ? list.map(m => copyMode(m, m.cols)) : [];
    }
    if (lg === "nba" && (pos === "G" || pos === "F" || pos === "C")) {
      const hide3 = Array.isArray(players) && !nbaThrees(players);
      const cols = hide3 ? NBA_COLS.filter(c => c[0] !== "tpm") : NBA_COLS;
      return NBA_MODES.filter(m => !(hide3 && m.id === "3pm")).map(m => copyMode(m, cols));
    }
    return [];
  }
  /** The requested mode, or the position's first stat when that choice does not apply. */
  function resolveStat(lg, pos, statId, players) {
    const modes = statModes(lg, pos, players);
    if (!modes.length) return null;
    return modes.find(m => m.id === statId) || modes[0];
  }
  /** Per-game lists need a real sample: at least 3 games, and at least half of the busiest player at this position. */
  function minGamesFor(players, pos) {
    let max = 0;
    for (const p of players || []) if (p && p.pos === pos && num(p.gp) > max) max = num(p.gp);
    if (max < 1) return 1;
    const half = Math.ceil(max / 2);
    return Math.min(max, Math.max(3, half));
  }

  /** Top 10 by the chosen stat. NFL totals, or NBA per game with a games minimum. */
  function seasonBoard(players, spec, limit, statId) {
    const lim = limit || TOP_N;
    if (!spec) return { rows: [], total: 0, stat: "", statNote: "", cols: [], minGp: 1, maxGp: 0 };
    const league = spec.perGame ? "nba" : "nfl";
    const mode = resolveStat(league, spec.id, statId, players);
    const sortKey = mode ? mode.sort : spec.key;
    const cols = mode ? mode.cols : spec.cols;
    const perGame = !!spec.perGame;
    let maxGp = 0;
    for (const p of players || []) if (p && p.pos === spec.id && num(p.gp) > maxGp) maxGp = num(p.gp);
    const minGp = perGame ? minGamesFor(players, spec.id) : 1;
    const all = (players || []).filter(p => p && p.pos === spec.id && num(p.gp) >= minGp && statValue(p, sortKey, perGame) > 0);
    all.sort((a, b) => {
      const d = statValue(b, sortKey, perGame) - statValue(a, sortKey, perGame);
      if (Math.abs(d) > 1e-9) return d;
      for (const [k] of cols) {
        if (k === sortKey) continue;
        const e = statValue(b, k, perGame) - statValue(a, k, perGame);
        if (Math.abs(e) > 1e-9) return e;
      }
      return String(a.n || "").localeCompare(String(b.n || "")) || String(a.id).localeCompare(String(b.id));
    });
    const cell = (p, k, label) => ({ key: k, label, text: fmtStat(statValue(p, k, perGame), perGame), on: k === sortKey });
    const rows = all.slice(0, lim).map((p, i) => ({
      rank: i + 1,
      id: String(p.id),
      name: p.n || "",
      team: p.ta || "",
      gp: num(p.gp),
      cells: cols.map(([k, label]) => cell(p, k, label)),
    }));
    return { rows, total: all.length, stat: mode ? mode.id : "", statNote: mode ? mode.note : (spec.cols[0] ? spec.cols[0][1] : ""), cols: cols.map(([k, label]) => ({ key: k, label, on: k === sortKey })), minGp, maxGp };
  }

  /**
   * Sum one season from compact box scores.
   * games: matchups cache `.games`. roster: {pid: {n, pos, t}}. abbr: {teamId: "GB"}.
   */
  function aggregateSeason(lg, games, roster, abbr) {
    const acc = new Map();
    const touch = (pid, tid, date, posHint) => {
      const r = roster && roster[pid];
      const name = r && r.n;
      if (!name) return null;
      let row = acc.get(pid);
      if (!row) {
        row = { id: String(pid), n: name, rosterPos: bucket(lg, r.pos), posCounts: {}, t: String(tid || r.t || ""), latest: "", gp: 0 };
        for (const k of NFL_KEYS) row[k] = 0;
        row.pts = 0; row.reb = 0; row.ast = 0; row.tpm = 0; row.hasTpm = false;
        acc.set(pid, row);
      }
      if (!row.latest || String(date || "") >= row.latest) {
        row.latest = String(date || "");
        if (tid) row.t = String(tid);
      }
      if (posHint) row.posCounts[posHint] = (row.posCounts[posHint] || 0) + 1;
      return row;
    };
    for (const g of Object.values(games || {})) {
      const b = (g && g.b) || {};
      if (lg === "nfl") {
        for (const [tid, box] of Object.entries(b)) {
          for (const [pid, p] of Object.entries(box || {})) {
            if (!p || pid.startsWith("_")) continue;
            const hint = bucket("nfl", (roster[pid] || {}).pos) || nflFallback(p);
            const row = touch(pid, tid, g.d, hint);
            if (!row) continue;
            row.gp += 1;
            for (const k of NFL_KEYS) row[k] += num(p[k]);
          }
        }
      } else if (lg === "nba") {
        for (const [tid, box] of Object.entries(b)) {
          for (const r of (box && box.p) || []) {
            if (!Array.isArray(r) || !r[0]) continue;
            const hint = bucket("nba", r[1]) || bucket("nba", (roster[r[0]] || {}).pos);
            const row = touch(r[0], tid, g.d, hint);
            if (!row) continue;
            row.gp += 1;
            row.pts += num(r[2]); row.reb += num(r[3]); row.ast += num(r[4]);
            if (r.length > 5 && (isNum(r[5]) || r[5] === 0)) { row.hasTpm = true; row.tpm += num(r[5]); }
          }
        }
      }
    }
    const players = [];
    for (const row of acc.values()) {
      if (!row.gp) continue;
      const counts = row.posCounts;
      const ids = Object.keys(counts).filter(k => counts[k] > 0);
      let pos = row.rosterPos;
      if (ids.length) {
        const n = Math.max(...ids.map(k => counts[k]));
        if (!(pos && counts[pos] === n)) pos = ids.filter(k => counts[k] === n).sort()[0];
      }
      if (!pos) continue;
      const out = {
        id: row.id, n: row.n, pos, t: row.t, ta: (abbr && abbr[row.t]) || "", gp: row.gp,
      };
      if (lg === "nfl") for (const k of NFL_KEYS) out[k] = clean(row[k]);
      else {
        out.pts = clean(row.pts); out.reb = clean(row.reb); out.ast = clean(row.ast);
        if (row.hasTpm) out.tpm = clean(row.tpm);
      }
      players.push(out);
    }
    players.sort((a, b) => a.id.localeCompare(b.id));
    return players;
  }

  function gradeCount(values, line) {
    let o = 0, n = 0;
    if (!isNum(line)) return { o: 0, n: 0, pct: null };
    for (const v of values || []) {
      if (!isNum(v)) continue;
      n += 1;
      if (v > line) o += 1;
    }
    return { o, n, pct: n ? o / n : null };
  }

  function sampleText(o, n) { return n ? `${o}/${n}` : "—"; }

  function basisLabel(basis) {
    if (basis === "season") return "This season vs the current line";
    if (basis === "l10") return "Last 10 games vs the current line";
    if (basis === "mixed") return "Vs the current line";
    return "";
  }

  /** First preferred book that posted a number. An explicit prefer list does not fall through to other books. */
  function pickLine(lines, prefer) {
    const order = (prefer && prefer.length) ? prefer : BOOK_ORDER;
    const src = lines && typeof lines === "object" ? lines : null;
    if (!src) return null;
    for (const k of order) {
      const v = src[k];
      const line = Array.isArray(v) ? v[0] : v;
      if (isNum(line)) return { book: k, line };
    }
    return null;
  }

  function tallyOf(row, picked) {
    if (!picked) return null;
    const books = row.length > 5 && row[5] && typeof row[5] === "object" ? row[5] : null;
    const own = books && Array.isArray(books[picked.book]) ? books[picked.book][3] : null;
    if (Array.isArray(own) && own[3]) return own;
    if (isNum(row[2]) && row[2] === picked.line && Array.isArray(row[4]) && row[4][3]) return row[4];
    return null;
  }

  function linesOfRow(row) {
    const books = row.length > 5 && row[5] && typeof row[5] === "object" ? row[5] : null;
    if (books) {
      const lines = {};
      for (const [k, v] of Object.entries(books)) if (Array.isArray(v) && isNum(v[0])) lines[k] = v[0];
      return lines;
    }
    return isNum(row[2]) ? { draftkings: row[2] } : {};
  }

  function logValues(log, mk) {
    const out = [];
    for (const g of (log || []).slice(0, 10)) {
      const vals = g && g[3];
      if (vals && isNum(vals[mk])) out.push(vals[mk]);
    }
    return out;
  }

  function pushHit(byId, entry, dates) {
    const prev = byId.get(entry.id);
    if (!prev) { byId.set(entry.id, entry); return; }
    const da = dates && dates[prev.gid] || "";
    const db = dates && dates[entry.gid] || "";
    if (da && db && da !== db) { if (db < da) byId.set(entry.id, entry); return; }
    if (entry.n > prev.n || (entry.n === prev.n && entry.pct > prev.pct)) byId.set(entry.id, entry);
  }

  /**
   * One row per player for this position's market, from a props file.
   * Season tally is used when the file has one for that line. Otherwise the last 10 logged games.
   * `prefer` is the book keys the visitor can use. Florida passes ["hardrockbet"] only.
   */
  function fromProps(doc, spec, prefer, dates, lg) {
    const games = doc && doc.games;
    if (!spec || !games) return { saw: false, entries: [] };
    const league = lg || doc.lg || "";
    const players = doc.players || {};
    let saw = false;
    const byId = new Map();
    for (const [gid, g] of Object.entries(games)) {
      for (const row of (g && g.props) || []) {
        saw = true;
        if (!Array.isArray(row) || row[1] !== spec.hitMk) continue;
        const pl = players[row[0]];
        if (!pl || !pl.n) continue;
        const pos = bucket(league, pl.pos) || (pl.pos === spec.id ? spec.id : null);
        if (pos !== spec.id) continue;
        const picked = pickLine(linesOfRow(row), prefer);
        if (!picked) continue;
        const tally = tallyOf(row, picked);
        let o, n, basis, pct;
        if (tally) {
          o = num(tally[0]); n = num(tally[3]); basis = "season"; pct = n ? o / n : null;
        } else {
          const sample = logValues(pl.log, spec.hitMk);
          const graded = gradeCount(sample, picked.line);
          o = graded.o; n = graded.n; pct = graded.pct; basis = "l10";
        }
        if (!n) continue;
        pushHit(byId, {
          id: String(row[0]), name: pl.n, pos: spec.id, team: pl.ta || "",
          line: picked.line, book: picked.book, o, n, pct, basis, gid: String(gid),
        }, dates);
      }
    }
    return { saw, entries: [...byId.values()] };
  }

  /** Stored pack rows: {id,n,pos,ta,mk,lines,sample,scope}. `sample` is every played game in the cache. */
  function fromPack(rows, spec, prefer) {
    if (!spec) return { saw: false, entries: [] };
    const saw = Array.isArray(rows) && rows.length > 0;
    const byId = new Map();
    for (const row of rows || []) {
      if (!row || row.mk !== spec.hitMk || row.pos !== spec.id) continue;
      const picked = pickLine(row.lines, prefer);
      if (!picked) continue;
      const graded = gradeCount(row.sample, picked.line);
      if (!graded.n) continue;
      pushHit(byId, {
        id: String(row.id), name: row.n || "", pos: spec.id, team: row.ta || "",
        line: picked.line, book: picked.book, o: graded.o, n: graded.n, pct: graded.pct,
        basis: row.scope === "l10" ? "l10" : "season", gid: row.gid || "",
      }, null);
    }
    return { saw, entries: [...byId.values()] };
  }

  function rankHits(entries, limit, min) {
    const lim = limit || TOP_N;
    const need = min == null ? HIT_MIN : min;
    const all = (entries || []).filter(e => e && e.n >= need && e.o <= e.n);
    all.sort((a, b) => (b.pct - a.pct) || (b.o - a.o) || (b.n - a.n) || String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
    const rows = all.slice(0, lim).map((e, i) => ({ ...e, rank: i + 1, text: sampleText(e.o, e.n) }));
    const kinds = [...new Set(rows.map(r => r.basis))];
    return { rows, total: all.length, basis: kinds.length === 1 ? kinds[0] : (kinds.length ? "mixed" : null), min: need };
  }

  function matchPid(name, roster, sideIds) {
    const key = normPlayer(name);
    if (!key) return null;
    let found = null;
    for (const [pid, r] of Object.entries(roster || {})) {
      if (sideIds && !sideIds.has(String(r.t))) continue;
      if (normPlayer(r.n) !== key) continue;
      if (found && found !== pid) return null;
      found = pid;
    }
    return found;
  }

  function statSample(lg, games, pid, mk) {
    const out = [];
    for (const g of Object.values(games || {})) {
      const b = (g && g.b) || {};
      if (lg === "nfl") {
        let p = null;
        for (const box of Object.values(b)) if (box && box[pid]) { p = box[pid]; break; }
        if (!p) continue;
        const v = mk === "pass_yds" ? num(p.py) : mk === "rush_yds" ? num(p.ry) : mk === "rec_yds" ? num(p.recy)
          : mk === "receptions" ? num(p.rec) : mk === "anytime_td" ? num(p.rtd) + num(p.rectd) : null;
        if (v == null) continue;
        out.push([g.d || "", clean(v)]);
      } else if (lg === "nba") {
        let row = null;
        for (const box of Object.values(b)) {
          row = ((box && box.p) || []).find(r => r && String(r[0]) === String(pid)) || null;
          if (row) break;
        }
        if (!row) continue;
        const ix = mk === "points" ? 2 : mk === "rebounds" ? 3 : mk === "assists" ? 4 : mk === "threes" ? 5 : -1;
        if (ix < 0) continue;
        out.push([g.d || "", clean(num(row[ix]))]);
      }
    }
    out.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
    return out.map(x => x[1]);
  }

  /**
   * Current lines in an odds-props cache entry → one pack row per player and market.
   * indexGames lets a name match only the two teams in that game. A game missing from the
   * index matches a unique roster name and skips a shared name.
   */
  function propRowsFromOdds(lg, boxGames, roster, oddsGames, indexGames, abbr) {
    const byGame = {};
    for (const g of indexGames || []) if (g && g.id) byGame[String(g.id)] = g;
    const specFor = pos => specsFor(lg).find(s => s.id === pos) || null;
    const best = new Map();
    const take = (prev, date) => !prev || (!!date && (!prev.date || date < prev.date));
    for (const [gid, game] of Object.entries(oddsGames || {})) {
      const idx = byGame[String(gid)];
      const side = idx ? new Set([String((idx.home || {}).id || ""), String((idx.away || {}).id || "")].filter(Boolean)) : null;
      const date = (game && game.date) || (idx && idx.date) || "";
      const found = new Map();
      for (const [book, markets] of Object.entries((game && game.books) || {})) {
        if (BOOK_ORDER.indexOf(book) < 0) continue;
        for (const [mk, names] of Object.entries(markets || {})) {
          for (const [name, val] of Object.entries(names || {})) {
            if (!Array.isArray(val) || !isNum(val[0])) continue;
            const pid = matchPid(name, roster, side && side.size ? side : null);
            if (!pid) continue;
            const r = roster[pid];
            const pos = bucket(lg, r.pos);
            const spec = specFor(pos);
            if (!spec || spec.hitMk !== mk) continue;
            let slot = found.get(pid);
            if (!slot) {
              slot = {
                id: String(pid), n: r.n, pos, ta: (abbr && abbr[String(r.t)]) || "",
                mk, lines: {}, date, gid: String(gid), scope: "season",
              };
              found.set(pid, slot);
            }
            slot.lines[book] = val[0];
          }
        }
      }
      for (const [pid, slot] of found) {
        if (take(best.get(pid), date)) best.set(pid, slot);
      }
    }
    const rows = [];
    for (const row of best.values()) {
      const sample = statSample(lg, boxGames, row.id, row.mk);
      if (!sample.length || !Object.keys(row.lines).length) continue;
      rows.push({ id: row.id, n: row.n, pos: row.pos, ta: row.ta, mk: row.mk, lines: row.lines, sample, scope: "season", gid: row.gid });
    }
    rows.sort((a, b) => a.id.localeCompare(b.id));
    return rows;
  }

  return {
    TOP_N, HIT_MIN, BOOK_ORDER, LEAGUES, SPECS, specsFor, specById, bucket, playerHash, normPlayer,
    seasonBoard, statModes, resolveStat, nbaThrees, minGamesFor, aggregateSeason, gradeCount, sampleText, basisLabel, pickLine,
    fromProps, fromPack, rankHits, propRowsFromOdds, statSample, matchPid,
  };
});

/* Pro rankings snapshot. Built by scripts/build_rankings.mjs from the box-score cache and the stored props pull. No live request. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RankingsData = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return {"v":1,"leagues":{"nfl":{"season":2026,"boxGames":107,"through":"2026-10-27T00:15Z","cacheUpdated":"2026-10-27T03:45:58.905450+00:00","propsPulledAt":"2026-10-29T10:15:19Z","propsGames":1,"players":[{"id":"12483","n":"Matthew Stafford","pos":"QB","t":"14","ta":"LAR","gp":7,"py":1989,"ptd":14,"ry":18,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"14012","n":"Andy Dalton","pos":"QB","t":"21","ta":"PHI","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"14163","n":"Tyrod Taylor","pos":"QB","t":"9","ta":"GB","gp":1,"py":0,"ptd":0,"ry":-2,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"14880","n":"Kirk Cousins","pos":"QB","t":"13","ta":"LV","gp":7,"py":1877,"ptd":16,"ry":4,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"15168","n":"Case Keenum","pos":"QB","t":"3","ta":"CHI","gp":2,"py":355,"ptd":2,"ry":10,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"15818","n":"Keenan Allen","pos":"WR","t":"11","ta":"IND","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":29,"recy":258,"rectd":1},{"id":"15835","n":"Zach Ertz","pos":"TE","t":"21","ta":"PHI","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":22,"rectd":0},{"id":"15847","n":"Travis Kelce","pos":"TE","t":"12","ta":"KC","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":24,"recy":343,"rectd":2},{"id":"15864","n":"Geno Smith","pos":"QB","t":"20","ta":"NYJ","gp":7,"py":1623,"ptd":10,"ry":42,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"16002","n":"Kyle Juszczyk","pos":"RB","t":"25","ta":"SF","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":8,"recy":76,"rectd":2},{"id":"16713","n":"Jake Matthews","pos":"WR","t":"1","ta":"ATL","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"16731","n":"Brandin Cooks","pos":"WR","t":"25","ta":"SF","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":33,"rectd":1},{"id":"16733","n":"Odell Beckham Jr.","pos":"WR","t":"19","ta":"NYG","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"16737","n":"Mike Evans","pos":"WR","t":"25","ta":"SF","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":27,"recy":420,"rectd":3},{"id":"16800","n":"Davante Adams","pos":"WR","t":"14","ta":"LAR","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":30,"recy":480,"rectd":4},{"id":"2515270","n":"Michael Burton","pos":"RB","t":"5","ta":"CLE","gp":2,"py":0,"ptd":0,"ry":2,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"2573079","n":"Carson Wentz","pos":"QB","t":"16","ta":"MIN","gp":2,"py":276,"ptd":3,"ry":5,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"2573401","n":"Tyler Higbee","pos":"TE","t":"14","ta":"LAR","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":26,"recy":260,"rectd":1},{"id":"2576336","n":"Ameer Abdullah","pos":"RB","t":"30","ta":"JAX","gp":3,"py":0,"ptd":0,"ry":45,"rtd":0,"rec":2,"recy":2,"rectd":0},{"id":"2576581","n":"Chris Moore","pos":"WR","t":"33","ta":"BAL","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":63,"rectd":1},{"id":"2576925","n":"Darren Waller","pos":"TE","t":"29","ta":"CAR","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":14,"recy":198,"rectd":3},{"id":"2576980","n":"Marcus Mariota","pos":"QB","t":"28","ta":"WSH","gp":3,"py":340,"ptd":4,"ry":49,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"2577185","n":"Jake Brendel","pos":"WR","t":"25","ta":"SF","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":2,"rectd":0},{"id":"2577417","n":"Dak Prescott","pos":"QB","t":"6","ta":"DAL","gp":7,"py":1851,"ptd":13,"ry":81,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"2578570","n":"Jacoby Brissett","pos":"QB","t":"22","ta":"ARI","gp":7,"py":1600,"ptd":10,"ry":80,"rtd":1,"rec":1,"recy":7,"rectd":0},{"id":"2969939","n":"Jameis Winston","pos":"QB","t":"19","ta":"NYG","gp":6,"py":957,"ptd":7,"ry":50,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"2971281","n":"Pharaoh Brown","pos":"TE","t":"11","ta":"IND","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":7,"rectd":0},{"id":"2973405","n":"Kalif Raymond","pos":"WR","t":"3","ta":"CHI","gp":7,"py":0,"ptd":0,"ry":-2,"rtd":0,"rec":26,"recy":244,"rectd":1},{"id":"2975417","n":"Patrick Ricard","pos":"RB","t":"19","ta":"NYG","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":1,"rectd":0},{"id":"2975674","n":"Robert Tonyan","pos":"TE","t":"23","ta":"PIT","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":2,"rectd":0},{"id":"2975863","n":"Eric Saubert","pos":"TE","t":"26","ta":"SEA","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":20,"rectd":1},{"id":"2976212","n":"Stefon Diggs","pos":"WR","t":"28","ta":"WSH","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":24,"recy":214,"rectd":4},{"id":"2976592","n":"Sterling Shepard","pos":"WR","t":"20","ta":"NYJ","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":3,"rectd":0},{"id":"2977187","n":"Cooper Kupp","pos":"WR","t":"26","ta":"SEA","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":18,"recy":199,"rectd":1},{"id":"2977680","n":"Bradley Pinion","pos":"RB","t":"15","ta":"MIA","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"2991662","n":"Mack Hollins","pos":"WR","t":"17","ta":"NE","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":15,"recy":209,"rectd":0},{"id":"2998565","n":"Mo Alie-Cox","pos":"TE","t":"11","ta":"IND","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":31,"rectd":1},{"id":"3040151","n":"George Kittle","pos":"TE","t":"25","ta":"SF","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":34,"recy":425,"rectd":5},{"id":"3042519","n":"Aaron Jones Sr.","pos":"RB","t":"16","ta":"MIN","gp":6,"py":0,"ptd":0,"ry":436,"rtd":2,"rec":13,"recy":72,"rectd":0},{"id":"3043078","n":"Derrick Henry","pos":"RB","t":"33","ta":"BAL","gp":7,"py":0,"ptd":0,"ry":579,"rtd":7,"rec":10,"recy":68,"rectd":1},{"id":"3043116","n":"Demarcus Robinson","pos":"WR","t":"25","ta":"SF","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":84,"rectd":1},{"id":"3043275","n":"Austin Hooper","pos":"TE","t":"1","ta":"ATL","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":8,"recy":67,"rectd":1},{"id":"3045523","n":"Kendrick Bourne","pos":"WR","t":"22","ta":"ARI","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":25,"recy":234,"rectd":0},{"id":"3046439","n":"Hunter Henry","pos":"TE","t":"17","ta":"NE","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":26,"recy":296,"rectd":2},{"id":"3046779","n":"Jared Goff","pos":"QB","t":"8","ta":"DET","gp":6,"py":1788,"ptd":14,"ry":15,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"3050481","n":"Tanner Hudson","pos":"TE","t":"4","ta":"CIN","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":7,"recy":33,"rectd":1},{"id":"3051738","n":"Marquez Valdes-Scantling","pos":"WR","t":"24","ta":"LAC","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":22,"rectd":0},{"id":"3051876","n":"Evan Engram","pos":"TE","t":"7","ta":"DEN","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":13,"recy":136,"rectd":1},{"id":"3051889","n":"Laquon Treadwell","pos":"WR","t":"11","ta":"IND","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":15,"recy":197,"rectd":0},{"id":"3052096","n":"Johnny Mundt","pos":"TE","t":"21","ta":"PHI","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":16,"rectd":0},{"id":"3052587","n":"Baker Mayfield","pos":"QB","t":"27","ta":"TB","gp":4,"py":679,"ptd":3,"ry":66,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"3052897","n":"Durham Smythe","pos":"TE","t":"33","ta":"BAL","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":4,"rectd":0},{"id":"3054212","n":"Jonnu Smith","pos":"TE","t":"9","ta":"GB","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":6,"recy":94,"rectd":0},{"id":"3054850","n":"Alvin Kamara","pos":"RB","t":"18","ta":"NO","gp":6,"py":0,"ptd":0,"ry":125,"rtd":2,"rec":22,"recy":133,"rectd":1},{"id":"3059989","n":"Nick Mullens","pos":"QB","t":"30","ta":"JAX","gp":1,"py":0,"ptd":0,"ry":-3,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"3068267","n":"Austin Ekeler","pos":"RB","t":"28","ta":"WSH","gp":3,"py":0,"ptd":0,"ry":31,"rtd":0,"rec":4,"recy":30,"rectd":0},{"id":"3116164","n":"Mike Gesicki","pos":"TE","t":"4","ta":"CIN","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":13,"recy":165,"rectd":5},{"id":"3116165","n":"Chris Godwin Jr.","pos":"WR","t":"27","ta":"TB","gp":7,"py":0,"ptd":0,"ry":18,"rtd":0,"rec":27,"recy":243,"rectd":0},{"id":"3116365","n":"Mark Andrews","pos":"TE","t":"33","ta":"BAL","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":26,"recy":204,"rectd":1},{"id":"3116389","n":"Samaje Perine","pos":"RB","t":"4","ta":"CIN","gp":6,"py":0,"ptd":0,"ry":126,"rtd":1,"rec":7,"recy":61,"rectd":1},{"id":"3116407","n":"Mason Rudolph","pos":"QB","t":"23","ta":"PIT","gp":2,"py":0,"ptd":0,"ry":1,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"3117251","n":"Christian McCaffrey","pos":"RB","t":"25","ta":"SF","gp":7,"py":0,"ptd":0,"ry":389,"rtd":8,"rec":34,"recy":251,"rectd":0},{"id":"3117256","n":"Dalton Schultz","pos":"TE","t":"34","ta":"HOU","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":33,"recy":322,"rectd":0},{"id":"3118892","n":"Justin Watson","pos":"WR","t":"12","ta":"KC","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":7,"rectd":0},{"id":"3121023","n":"Dallas Goedert","pos":"TE","t":"21","ta":"PHI","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":22,"recy":228,"rectd":2},{"id":"3121422","n":"Terry McLaurin","pos":"WR","t":"28","ta":"WSH","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":15,"recy":230,"rectd":1},{"id":"3122840","n":"Deshaun Watson","pos":"QB","t":"5","ta":"CLE","gp":7,"py":1482,"ptd":7,"ry":215,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"3123075","n":"Braxton Berrios","pos":"WR","t":"19","ta":"NYG","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"3123076","n":"David Njoku","pos":"TE","t":"24","ta":"LAC","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":6,"recy":67,"rectd":0},{"id":"3125107","n":"Andrew Beck","pos":"RB","t":"20","ta":"NYJ","gp":1,"py":0,"ptd":0,"ry":-1,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"3126486","n":"Deebo Samuel Sr.","pos":"WR","t":"25","ta":"SF","gp":5,"py":0,"ptd":0,"ry":78,"rtd":0,"rec":16,"recy":206,"rectd":3},{"id":"3127310","n":"Drew Sample","pos":"TE","t":"4","ta":"CIN","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":7,"recy":48,"rectd":1},{"id":"3127586","n":"Jeremy McNichols","pos":"RB","t":"28","ta":"WSH","gp":1,"py":0,"ptd":0,"ry":13,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"3128429","n":"Courtland Sutton","pos":"WR","t":"7","ta":"DEN","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":16,"recy":168,"rectd":1},{"id":"3134353","n":"Tim Patrick","pos":"WR","t":"20","ta":"NYJ","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":41,"rectd":0},{"id":"3139477","n":"Patrick Mahomes","pos":"QB","t":"12","ta":"KC","gp":6,"py":1474,"ptd":9,"ry":71,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"3149687","n":"Chris Brooks","pos":"RB","t":"9","ta":"GB","gp":4,"py":0,"ptd":0,"ry":70,"rtd":0,"rec":3,"recy":24,"rectd":0},{"id":"3676833","n":"KaVontae Turpin","pos":"WR","t":"6","ta":"DAL","gp":4,"py":0,"ptd":0,"ry":10,"rtd":1,"rec":4,"recy":39,"rectd":0},{"id":"3843945","n":"Foster Moreau","pos":"TE","t":"34","ta":"HOU","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":11,"recy":72,"rectd":3},{"id":"3886598","n":"Jauan Jennings","pos":"WR","t":"16","ta":"MIN","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":43,"rectd":0},{"id":"3911853","n":"Adam Trautman","pos":"TE","t":"7","ta":"DEN","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":10,"rectd":0},{"id":"3912547","n":"Sam Darnold","pos":"QB","t":"26","ta":"SEA","gp":6,"py":1290,"ptd":8,"ry":52,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"3915411","n":"Ty Johnson","pos":"RB","t":"2","ta":"BUF","gp":4,"py":0,"ptd":0,"ry":6,"rtd":0,"rec":12,"recy":155,"rectd":0},{"id":"3915416","n":"DJ Moore","pos":"WR","t":"2","ta":"BUF","gp":4,"py":0,"ptd":0,"ry":5,"rtd":0,"rec":12,"recy":178,"rectd":1},{"id":"3915486","n":"Tyler Conklin","pos":"TE","t":"8","ta":"DET","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":4,"rectd":0},{"id":"3915511","n":"Joe Burrow","pos":"QB","t":"4","ta":"CIN","gp":6,"py":1653,"ptd":15,"ry":60,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"3916148","n":"Tony Pollard","pos":"RB","t":"10","ta":"TEN","gp":7,"py":0,"ptd":0,"ry":478,"rtd":4,"rec":11,"recy":50,"rectd":0},{"id":"3916387","n":"Lamar Jackson","pos":"QB","t":"33","ta":"BAL","gp":4,"py":967,"ptd":6,"ry":144,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"3916433","n":"Jakobi Meyers","pos":"WR","t":"30","ta":"JAX","gp":6,"py":0,"ptd":0,"ry":2,"rtd":0,"rec":20,"recy":285,"rectd":2},{"id":"3917315","n":"Kyler Murray","pos":"QB","t":"16","ta":"MIN","gp":5,"py":812,"ptd":3,"ry":132,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"3917668","n":"Alec Ingold","pos":"RB","t":"24","ta":"LAC","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":35,"rectd":0},{"id":"3917792","n":"Daniel Jones","pos":"QB","t":"11","ta":"IND","gp":7,"py":1398,"ptd":4,"ry":68,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"3917914","n":"Olamide Zaccheaus","pos":"WR","t":"1","ta":"ATL","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":17,"rectd":0},{"id":"3918298","n":"Josh Allen","pos":"QB","t":"2","ta":"BUF","gp":6,"py":1504,"ptd":9,"ry":240,"rtd":8,"rec":1,"recy":1,"rectd":0},{"id":"3921690","n":"Josh Oliver","pos":"TE","t":"16","ta":"MIN","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":46,"rectd":0},{"id":"3924327","n":"Drew Lock","pos":"QB","t":"26","ta":"SEA","gp":2,"py":422,"ptd":4,"ry":13,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"3925357","n":"Calvin Ridley","pos":"WR","t":"10","ta":"TEN","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":81,"rectd":0},{"id":"3929630","n":"Saquon Barkley","pos":"RB","t":"21","ta":"PHI","gp":5,"py":0,"ptd":0,"ry":244,"rtd":1,"rec":6,"recy":17,"rectd":0},{"id":"3929645","n":"Juwan Johnson","pos":"TE","t":"18","ta":"NO","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":26,"recy":255,"rectd":3},{"id":"3929785","n":"Nick Westbrook-Ikhine","pos":"WR","t":"11","ta":"IND","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"3929914","n":"Adam Prentice","pos":"RB","t":"7","ta":"DEN","gp":2,"py":0,"ptd":0,"ry":3,"rtd":0,"rec":1,"recy":2,"rectd":0},{"id":"3930086","n":"Dawson Knox","pos":"TE","t":"2","ta":"BUF","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":8,"recy":36,"rectd":1},{"id":"4032473","n":"Rashid Shaheed","pos":"WR","t":"26","ta":"SEA","gp":7,"py":0,"ptd":0,"ry":39,"rtd":1,"rec":16,"recy":163,"rectd":0},{"id":"4035020","n":"Charlie Woerner","pos":"TE","t":"1","ta":"ATL","gp":4,"py":0,"ptd":0,"ry":3,"rtd":0,"rec":2,"recy":22,"rectd":0},{"id":"4035538","n":"David Montgomery","pos":"RB","t":"34","ta":"HOU","gp":5,"py":0,"ptd":0,"ry":138,"rtd":2,"rec":7,"recy":67,"rectd":1},{"id":"4035656","n":"Ben Skowronek","pos":"WR","t":"23","ta":"PIT","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":32,"rectd":1},{"id":"4035671","n":"Tyler Huntley","pos":"QB","t":"33","ta":"BAL","gp":4,"py":727,"ptd":4,"ry":76,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"4035687","n":"Michael Pittman Jr.","pos":"WR","t":"23","ta":"PIT","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":7,"recy":89,"rectd":0},{"id":"4035693","n":"Velus Jones Jr.","pos":"RB","t":"26","ta":"SEA","gp":2,"py":0,"ptd":0,"ry":28,"rtd":0,"rec":1,"recy":-1,"rectd":0},{"id":"4035886","n":"Khalil Herbert","pos":"RB","t":"1","ta":"ATL","gp":1,"py":0,"ptd":0,"ry":9,"rtd":0,"rec":1,"recy":19,"rectd":0},{"id":"4036131","n":"Noah Fant","pos":"TE","t":"18","ta":"NO","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":11,"recy":84,"rectd":3},{"id":"4036133","n":"T.J. Hockenson","pos":"TE","t":"16","ta":"MIN","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":27,"recy":237,"rectd":2},{"id":"4036378","n":"Jordan Love","pos":"QB","t":"9","ta":"GB","gp":7,"py":1958,"ptd":13,"ry":10,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"4037457","n":"Travis Homer","pos":"RB","t":"23","ta":"PIT","gp":3,"py":0,"ptd":0,"ry":15,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4038441","n":"Justice Hill","pos":"RB","t":"33","ta":"BAL","gp":7,"py":0,"ptd":0,"ry":140,"rtd":0,"rec":13,"recy":84,"rectd":0},{"id":"4038815","n":"Rico Dowdle","pos":"RB","t":"23","ta":"PIT","gp":4,"py":0,"ptd":0,"ry":118,"rtd":0,"rec":13,"recy":82,"rectd":0},{"id":"4038941","n":"Justin Herbert","pos":"QB","t":"24","ta":"LAC","gp":6,"py":1141,"ptd":5,"ry":168,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4039057","n":"Lil'Jordan Humphrey","pos":"WR","t":"7","ta":"DEN","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":13,"rectd":0},{"id":"4039160","n":"Kylen Granson","pos":"TE","t":"10","ta":"TEN","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4039396","n":"Corey Bojorquez","pos":"RB","t":"5","ta":"CLE","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4039505","n":"Reggie Gilliam","pos":"RB","t":"17","ta":"NE","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":4,"rectd":0},{"id":"4040612","n":"Luke Farrell","pos":"TE","t":"25","ta":"SF","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":33,"rectd":0},{"id":"4040655","n":"Darnell Mooney","pos":"WR","t":"19","ta":"NYG","gp":7,"py":0,"ptd":0,"ry":32,"rtd":0,"rec":9,"recy":113,"rectd":0},{"id":"4040715","n":"Jalen Hurts","pos":"QB","t":"21","ta":"PHI","gp":5,"py":933,"ptd":8,"ry":107,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"4040761","n":"Devin Singletary","pos":"RB","t":"19","ta":"NYG","gp":4,"py":0,"ptd":0,"ry":80,"rtd":1,"rec":8,"recy":55,"rectd":1},{"id":"4045305","n":"Ian Thomas","pos":"TE","t":"13","ta":"LV","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":60,"rectd":1},{"id":"4047365","n":"Josh Jacobs","pos":"RB","t":"9","ta":"GB","gp":1,"py":0,"ptd":0,"ry":36,"rtd":0,"rec":5,"recy":55,"rectd":1},{"id":"4047646","n":"A.J. Brown","pos":"WR","t":"17","ta":"NE","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":101,"rectd":0},{"id":"4047650","n":"DK Metcalf","pos":"WR","t":"23","ta":"PIT","gp":7,"py":0,"ptd":0,"ry":11,"rtd":0,"rec":32,"recy":374,"rectd":1},{"id":"4048228","n":"John Bates","pos":"TE","t":"28","ta":"WSH","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":27,"rectd":0},{"id":"4061956","n":"Ashton Dulin","pos":"WR","t":"11","ta":"IND","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":29,"rectd":0},{"id":"4212909","n":"David Moore","pos":"WR","t":"29","ta":"CAR","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":27,"rectd":0},{"id":"4239934","n":"AJ Dillon","pos":"RB","t":"29","ta":"CAR","gp":4,"py":0,"ptd":0,"ry":43,"rtd":0,"rec":2,"recy":3,"rectd":0},{"id":"4239944","n":"Hunter Long","pos":"TE","t":"22","ta":"ARI","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":15,"rectd":0},{"id":"4239993","n":"Tee Higgins","pos":"WR","t":"4","ta":"CIN","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":33,"recy":571,"rectd":2},{"id":"4239996","n":"Travis Etienne Jr.","pos":"RB","t":"18","ta":"NO","gp":3,"py":0,"ptd":0,"ry":128,"rtd":0,"rec":11,"recy":51,"rectd":0},{"id":"4240391","n":"Tommy DeVito","pos":"QB","t":"17","ta":"NE","gp":1,"py":30,"ptd":0,"ry":2,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4240472","n":"Noah Gray","pos":"TE","t":"12","ta":"KC","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":12,"recy":158,"rectd":0},{"id":"4240577","n":"Brandon Smith","pos":"WR","t":"23","ta":"PIT","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":24,"rectd":0},{"id":"4240631","n":"DeeJay Dallas","pos":"RB","t":"16","ta":"MIN","gp":5,"py":0,"ptd":0,"ry":10,"rtd":0,"rec":4,"recy":34,"rectd":0},{"id":"4240657","n":"Michael Carter","pos":"RB","t":"10","ta":"TEN","gp":1,"py":0,"ptd":0,"ry":7,"rtd":0,"rec":1,"recy":7,"rectd":0},{"id":"4240703","n":"Kenny Pickett","pos":"QB","t":"29","ta":"CAR","gp":3,"py":47,"ptd":0,"ry":35,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4241263","n":"Charlie Kolar","pos":"TE","t":"24","ta":"LAC","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":78,"rectd":0},{"id":"4241372","n":"Hollywood Brown","pos":"WR","t":"21","ta":"PHI","gp":2,"py":0,"ptd":0,"ry":12,"rtd":0,"rec":2,"recy":30,"rectd":0},{"id":"4241389","n":"CeeDee Lamb","pos":"WR","t":"6","ta":"DAL","gp":7,"py":0,"ptd":0,"ry":-6,"rtd":0,"rec":53,"recy":651,"rectd":6},{"id":"4241410","n":"Jelani Woods","pos":"TE","t":"20","ta":"NYJ","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":39,"rectd":0},{"id":"4241416","n":"Chuba Hubbard","pos":"RB","t":"29","ta":"CAR","gp":6,"py":0,"ptd":0,"ry":459,"rtd":4,"rec":15,"recy":112,"rectd":2},{"id":"4241424","n":"Tylan Wallace","pos":"WR","t":"5","ta":"CLE","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":12,"rectd":0},{"id":"4241463","n":"Jerry Jeudy","pos":"WR","t":"5","ta":"CLE","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":16,"recy":171,"rectd":0},{"id":"4241464","n":"Mac Jones","pos":"QB","t":"25","ta":"SF","gp":1,"py":0,"ptd":0,"ry":-2,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4241474","n":"Brian Robinson Jr.","pos":"RB","t":"1","ta":"ATL","gp":6,"py":0,"ptd":0,"ry":211,"rtd":4,"rec":5,"recy":30,"rectd":0},{"id":"4241478","n":"DeVonta Smith","pos":"WR","t":"21","ta":"PHI","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":26,"recy":310,"rectd":2},{"id":"4241479","n":"Tua Tagovailoa","pos":"QB","t":"1","ta":"ATL","gp":1,"py":34,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4241555","n":"Elijah Mitchell","pos":"RB","t":"21","ta":"PHI","gp":1,"py":0,"ptd":0,"ry":11,"rtd":0,"rec":3,"recy":23,"rectd":0},{"id":"4241961","n":"Connor Heyward","pos":"RB","t":"13","ta":"LV","gp":4,"py":0,"ptd":0,"ry":-2,"rtd":0,"rec":2,"recy":22,"rectd":0},{"id":"4241983","n":"Cody White","pos":"WR","t":"13","ta":"LV","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":8,"recy":112,"rectd":3},{"id":"4241985","n":"J.K. Dobbins","pos":"RB","t":"7","ta":"DEN","gp":7,"py":0,"ptd":0,"ry":293,"rtd":3,"rec":8,"recy":27,"rectd":0},{"id":"4242335","n":"Jonathan Taylor","pos":"RB","t":"11","ta":"IND","gp":7,"py":0,"ptd":0,"ry":587,"rtd":8,"rec":17,"recy":178,"rectd":0},{"id":"4242355","n":"Jake Ferguson","pos":"TE","t":"6","ta":"DAL","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":17,"recy":115,"rectd":3},{"id":"4242392","n":"Brock Wright","pos":"TE","t":"8","ta":"DET","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":31,"rectd":0},{"id":"4242433","n":"Joshua Palmer","pos":"WR","t":"2","ta":"BUF","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":117,"rectd":2},{"id":"4242512","n":"Malik Willis","pos":"QB","t":"15","ta":"MIA","gp":6,"py":1057,"ptd":4,"ry":223,"rtd":3,"rec":0,"recy":0,"rectd":0},{"id":"4242557","n":"Colby Parkinson","pos":"TE","t":"14","ta":"LAR","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":14,"recy":103,"rectd":1},{"id":"4243003","n":"Ronnie Rivers","pos":"RB","t":"14","ta":"LAR","gp":1,"py":0,"ptd":0,"ry":19,"rtd":0,"rec":1,"recy":5,"rectd":0},{"id":"4243176","n":"Brady Russell","pos":"RB","t":"26","ta":"SEA","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":40,"rectd":0},{"id":"4243331","n":"Cade Otton","pos":"TE","t":"27","ta":"TB","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":19,"recy":186,"rectd":0},{"id":"4244049","n":"Quintin Morris","pos":"TE","t":"30","ta":"JAX","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":7,"rectd":0},{"id":"4248528","n":"Christian Watson","pos":"WR","t":"9","ta":"GB","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":34,"recy":595,"rectd":6},{"id":"4249417","n":"Jalen Tolbert","pos":"WR","t":"15","ta":"MIA","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":22,"rectd":0},{"id":"4249624","n":"Nick Muse","pos":"TE","t":"1","ta":"ATL","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":2,"rectd":1},{"id":"4249836","n":"Pierre Strong Jr.","pos":"RB","t":"9","ta":"GB","gp":2,"py":0,"ptd":0,"ry":35,"rtd":0,"rec":8,"recy":50,"rectd":0},{"id":"4256074","n":"Khyiris Tonga","pos":"RB","t":"12","ta":"KC","gp":2,"py":0,"ptd":0,"ry":3,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4257188","n":"Charlie Jones","pos":"WR","t":"19","ta":"NYG","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":66,"rectd":0},{"id":"4258173","n":"Nico Collins","pos":"WR","t":"34","ta":"HOU","gp":5,"py":0,"ptd":0,"ry":12,"rtd":0,"rec":24,"recy":329,"rectd":3},{"id":"4258595","n":"Cole Kmet","pos":"TE","t":"3","ta":"CHI","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":10,"recy":87,"rectd":1},{"id":"4259305","n":"Bo Melton","pos":"WR","t":"9","ta":"GB","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":34,"rectd":0},{"id":"4259545","n":"D'Andre Swift","pos":"RB","t":"3","ta":"CHI","gp":7,"py":0,"ptd":0,"ry":476,"rtd":7,"rec":22,"recy":152,"rectd":0},{"id":"4259553","n":"Stetson Bennett IV","pos":"QB","t":"14","ta":"LAR","gp":1,"py":13,"ptd":0,"ry":9,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4262921","n":"Justin Jefferson","pos":"WR","t":"16","ta":"MIN","gp":5,"py":0,"ptd":0,"ry":-11,"rtd":0,"rec":23,"recy":302,"rectd":3},{"id":"4360078","n":"Alec Pierce","pos":"WR","t":"11","ta":"IND","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":72,"rectd":0},{"id":"4360238","n":"Dameon Pierce","pos":"RB","t":"21","ta":"PHI","gp":3,"py":0,"ptd":0,"ry":96,"rtd":2,"rec":7,"recy":14,"rectd":0},{"id":"4360248","n":"Kyle Pitts Sr.","pos":"TE","t":"1","ta":"ATL","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":20,"recy":191,"rectd":4},{"id":"4360310","n":"Trevor Lawrence","pos":"QB","t":"30","ta":"JAX","gp":6,"py":1480,"ptd":14,"ry":70,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4360423","n":"Michael Penix Jr.","pos":"QB","t":"1","ta":"ATL","gp":5,"py":1157,"ptd":9,"ry":4,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4360516","n":"Tyrone Tracy Jr.","pos":"RB","t":"19","ta":"NYG","gp":6,"py":0,"ptd":0,"ry":55,"rtd":2,"rec":5,"recy":54,"rectd":1},{"id":"4360569","n":"Jordan Mason","pos":"RB","t":"16","ta":"MIN","gp":2,"py":0,"ptd":0,"ry":127,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"4360635","n":"Chig Okonkwo","pos":"TE","t":"28","ta":"WSH","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":15,"recy":150,"rectd":0},{"id":"4360637","n":"Jeshaun Jones","pos":"WR","t":"16","ta":"MIN","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":32,"rectd":0},{"id":"4360689","n":"Tyler Shough","pos":"QB","t":"18","ta":"NO","gp":7,"py":1721,"ptd":13,"ry":111,"rtd":2,"rec":0,"recy":0,"rectd":0},{"id":"4360761","n":"Michael Wilson","pos":"WR","t":"22","ta":"ARI","gp":7,"py":7,"ptd":0,"ry":11,"rtd":0,"rec":37,"recy":375,"rectd":1},{"id":"4360763","n":"Brycen Tremayne","pos":"WR","t":"29","ta":"CAR","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":6,"recy":115,"rectd":0},{"id":"4360797","n":"Tutu Atwell","pos":"WR","t":"14","ta":"LAR","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":31,"rectd":0},{"id":"4360939","n":"Rashod Bateman","pos":"WR","t":"33","ta":"BAL","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":18,"recy":266,"rectd":1},{"id":"4360967","n":"Brevyn Spann-Ford","pos":"TE","t":"6","ta":"DAL","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":79,"rectd":0},{"id":"4361050","n":"Isaiah Likely","pos":"TE","t":"19","ta":"NYG","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":41,"recy":395,"rectd":5},{"id":"4361088","n":"Colson Yankoff","pos":"TE","t":"28","ta":"WSH","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":16,"rectd":0},{"id":"4361307","n":"Trey McBride","pos":"TE","t":"22","ta":"ARI","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":59,"recy":472,"rectd":4},{"id":"4361370","n":"Chris Olave","pos":"WR","t":"18","ta":"NO","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":49,"recy":636,"rectd":2},{"id":"4361372","n":"Jeremy Ruckert","pos":"TE","t":"20","ta":"NYJ","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":8,"recy":48,"rectd":1},{"id":"4361409","n":"Jahan Dotson","pos":"WR","t":"1","ta":"ATL","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":12,"recy":242,"rectd":2},{"id":"4361411","n":"Pat Freiermuth","pos":"TE","t":"23","ta":"PIT","gp":7,"py":0,"ptd":0,"ry":4,"rtd":0,"rec":23,"recy":200,"rectd":4},{"id":"4361432","n":"Romeo Doubs","pos":"WR","t":"17","ta":"NE","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":14,"recy":261,"rectd":3},{"id":"4361496","n":"Matt Araiza","pos":"RB","t":"12","ta":"KC","gp":1,"py":0,"ptd":0,"ry":12,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4361516","n":"Daniel Bellinger","pos":"TE","t":"10","ta":"TEN","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":6,"recy":34,"rectd":0},{"id":"4361577","n":"Dyami Brown","pos":"WR","t":"28","ta":"WSH","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":94,"rectd":0},{"id":"4361579","n":"Javonte Williams","pos":"RB","t":"6","ta":"DAL","gp":7,"py":0,"ptd":0,"ry":472,"rtd":8,"rec":19,"recy":103,"rectd":1},{"id":"4361741","n":"Brock Purdy","pos":"QB","t":"25","ta":"SF","gp":7,"py":1748,"ptd":15,"ry":161,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"4362018","n":"Blake Whiteheart","pos":"TE","t":"5","ta":"CLE","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":39,"rectd":1},{"id":"4362238","n":"Chase Brown","pos":"RB","t":"4","ta":"CIN","gp":6,"py":0,"ptd":0,"ry":285,"rtd":1,"rec":28,"recy":143,"rectd":0},{"id":"4362249","n":"Jayden Reed","pos":"WR","t":"9","ta":"GB","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":24,"rectd":0},{"id":"4362477","n":"Derius Davis","pos":"WR","t":"24","ta":"LAC","gp":4,"py":0,"ptd":0,"ry":4,"rtd":0,"rec":1,"recy":6,"rectd":0},{"id":"4362504","n":"Brevin Jordan","pos":"TE","t":"34","ta":"HOU","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":12,"rectd":0},{"id":"4362523","n":"Will Mallory","pos":"TE","t":"11","ta":"IND","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":20,"rectd":0},{"id":"4362619","n":"Chris Rodriguez Jr.","pos":"RB","t":"30","ta":"JAX","gp":6,"py":0,"ptd":0,"ry":168,"rtd":2,"rec":1,"recy":6,"rectd":0},{"id":"4362628","n":"Ja'Marr Chase","pos":"WR","t":"4","ta":"CIN","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":32,"recy":351,"rectd":5},{"id":"4362748","n":"Tyler Badie","pos":"RB","t":"7","ta":"DEN","gp":5,"py":0,"ptd":0,"ry":22,"rtd":0,"rec":6,"recy":67,"rectd":0},{"id":"4362921","n":"Tyquan Thornton","pos":"WR","t":"12","ta":"KC","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":11,"recy":219,"rectd":2},{"id":"4366031","n":"Tank Dell","pos":"WR","t":"34","ta":"HOU","gp":1,"py":0,"ptd":0,"ry":2,"rtd":0,"rec":1,"recy":43,"rectd":0},{"id":"4366963","n":"Dylan Laube","pos":"RB","t":"13","ta":"LV","gp":2,"py":0,"ptd":0,"ry":9,"rtd":1,"rec":4,"recy":15,"rectd":0},{"id":"4367209","n":"Greg Dulcich","pos":"TE","t":"15","ta":"MIA","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":18,"recy":213,"rectd":0},{"id":"4368003","n":"Andrei Iosivas","pos":"WR","t":"4","ta":"CIN","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":19,"rectd":0},{"id":"4369466","n":"Ryan Miller","pos":"WR","t":"15","ta":"MIA","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":92,"rectd":1},{"id":"4369886","n":"Chris Blair","pos":"WR","t":"1","ta":"ATL","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":6,"rectd":0},{"id":"4371733","n":"Kenny Gainwell","pos":"RB","t":"27","ta":"TB","gp":7,"py":0,"ptd":0,"ry":149,"rtd":0,"rec":12,"recy":61,"rectd":1},{"id":"4372016","n":"Jaylen Waddle","pos":"WR","t":"7","ta":"DEN","gp":7,"py":0,"ptd":0,"ry":23,"rtd":0,"rec":26,"recy":276,"rectd":1},{"id":"4372096","n":"Luke Schoonmaker","pos":"TE","t":"6","ta":"DAL","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":30,"rectd":0},{"id":"4372414","n":"Elijah Moore","pos":"WR","t":"21","ta":"PHI","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":20,"rectd":0},{"id":"4372505","n":"Payne Durham","pos":"TE","t":"27","ta":"TB","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":5,"rectd":0},{"id":"4372758","n":"Kevin Austin Jr.","pos":"WR","t":"18","ta":"NO","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":7,"rectd":0},{"id":"4372780","n":"Tommy Tremble","pos":"TE","t":"29","ta":"CAR","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":16,"recy":136,"rectd":2},{"id":"4373626","n":"Tyler Allgeier","pos":"RB","t":"22","ta":"ARI","gp":7,"py":0,"ptd":0,"ry":176,"rtd":1,"rec":16,"recy":84,"rectd":0},{"id":"4373678","n":"Khalil Shakir","pos":"WR","t":"2","ta":"BUF","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":22,"recy":290,"rectd":1},{"id":"4374045","n":"Teagan Quitoriano","pos":"TE","t":"22","ta":"ARI","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":15,"rectd":2},{"id":"4374187","n":"Deven Thompkins","pos":"WR","t":"13","ta":"LV","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":8,"rectd":0},{"id":"4374302","n":"Amon-Ra St. Brown","pos":"WR","t":"8","ta":"DET","gp":6,"py":0,"ptd":0,"ry":-1,"rtd":0,"rec":46,"recy":525,"rectd":5},{"id":"4379399","n":"James Cook III","pos":"RB","t":"2","ta":"BUF","gp":6,"py":0,"ptd":0,"ry":627,"rtd":6,"rec":10,"recy":89,"rectd":0},{"id":"4382466","n":"Jalen Nailor","pos":"WR","t":"13","ta":"LV","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":8,"recy":75,"rectd":0},{"id":"4383396","n":"Hunter Luepke","pos":"RB","t":"6","ta":"DAL","gp":6,"py":0,"ptd":0,"ry":16,"rtd":0,"rec":4,"recy":11,"rectd":0},{"id":"4383440","n":"Nate Adkins","pos":"TE","t":"7","ta":"DEN","gp":2,"py":0,"ptd":0,"ry":6,"rtd":0,"rec":4,"recy":40,"rectd":2},{"id":"4384852","n":"Dohnte Meyers","pos":"WR","t":"4","ta":"CIN","gp":6,"py":0,"ptd":0,"ry":10,"rtd":0,"rec":13,"recy":141,"rectd":0},{"id":"4385690","n":"Dalton Kincaid","pos":"TE","t":"2","ta":"BUF","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":23,"recy":315,"rectd":1},{"id":"4386544","n":"Xavier Smith","pos":"WR","t":"14","ta":"LAR","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4401805","n":"Dareke Young","pos":"WR","t":"13","ta":"LV","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":36,"rectd":0},{"id":"4421446","n":"Craig Reynolds","pos":"RB","t":"28","ta":"WSH","gp":1,"py":0,"ptd":0,"ry":4,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4426338","n":"Bo Nix","pos":"QB","t":"7","ta":"DEN","gp":7,"py":1271,"ptd":7,"ry":110,"rtd":2,"rec":0,"recy":0,"rectd":0},{"id":"4426348","n":"Jayden Daniels","pos":"QB","t":"28","ta":"WSH","gp":4,"py":759,"ptd":5,"ry":213,"rtd":2,"rec":0,"recy":0,"rectd":0},{"id":"4426354","n":"George Pickens","pos":"WR","t":"6","ta":"DAL","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":37,"recy":485,"rectd":2},{"id":"4426386","n":"Roschon Johnson","pos":"RB","t":"3","ta":"CHI","gp":4,"py":0,"ptd":0,"ry":86,"rtd":1,"rec":8,"recy":75,"rectd":0},{"id":"4426388","n":"Jameson Williams","pos":"WR","t":"8","ta":"DET","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":23,"recy":367,"rectd":4},{"id":"4426485","n":"Jonathan Mingo","pos":"WR","t":"6","ta":"DAL","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":30,"rectd":0},{"id":"4426496","n":"Cade Stover","pos":"TE","t":"34","ta":"HOU","gp":4,"py":0,"ptd":0,"ry":5,"rtd":0,"rec":3,"recy":17,"rectd":0},{"id":"4426502","n":"Drake London","pos":"WR","t":"1","ta":"ATL","gp":7,"py":0,"ptd":0,"ry":4,"rtd":0,"rec":38,"recy":616,"rectd":1},{"id":"4426515","n":"Puka Nacua","pos":"WR","t":"14","ta":"LAR","gp":5,"py":0,"ptd":0,"ry":21,"rtd":1,"rec":45,"recy":485,"rectd":2},{"id":"4426535","n":"Theo Wease Jr.","pos":"WR","t":"24","ta":"LAC","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":37,"rectd":0},{"id":"4426553","n":"Davis Allen","pos":"TE","t":"14","ta":"LAR","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":10,"recy":83,"rectd":2},{"id":"4426844","n":"Elijah Higgins","pos":"TE","t":"22","ta":"ARI","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":14,"recy":141,"rectd":1},{"id":"4426948","n":"Luke McCaffrey","pos":"WR","t":"28","ta":"WSH","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4427095","n":"DeMario Douglas","pos":"WR","t":"17","ta":"NE","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":23,"recy":256,"rectd":3},{"id":"4427366","n":"Breece Hall","pos":"RB","t":"20","ta":"NYJ","gp":3,"py":0,"ptd":0,"ry":163,"rtd":1,"rec":10,"recy":102,"rectd":0},{"id":"4427728","n":"Bam Knight","pos":"RB","t":"22","ta":"ARI","gp":4,"py":0,"ptd":0,"ry":160,"rtd":0,"rec":5,"recy":33,"rectd":0},{"id":"4427834","n":"Erick All Jr.","pos":"TE","t":"4","ta":"CIN","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":8,"recy":56,"rectd":0},{"id":"4428119","n":"Lew Nichols","pos":"RB","t":"23","ta":"PIT","gp":2,"py":0,"ptd":0,"ry":6,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4428331","n":"Rashee Rice","pos":"WR","t":"12","ta":"KC","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":13,"recy":190,"rectd":1},{"id":"4428396","n":"Hayden Rucci","pos":"TE","t":"24","ta":"LAC","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":7,"rectd":1},{"id":"4428557","n":"Tyjae Spears","pos":"RB","t":"10","ta":"TEN","gp":6,"py":0,"ptd":0,"ry":66,"rtd":0,"rec":15,"recy":75,"rectd":0},{"id":"4428718","n":"Tre Tucker","pos":"WR","t":"13","ta":"LV","gp":7,"py":0,"ptd":0,"ry":-6,"rtd":0,"rec":29,"recy":474,"rectd":4},{"id":"4428850","n":"Dontayvion Wicks","pos":"WR","t":"21","ta":"PHI","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":19,"recy":284,"rectd":1},{"id":"4429013","n":"Tank Bigsby","pos":"RB","t":"21","ta":"PHI","gp":4,"py":0,"ptd":0,"ry":91,"rtd":1,"rec":3,"recy":10,"rectd":0},{"id":"4429022","n":"Kayshon Boutte","pos":"WR","t":"34","ta":"HOU","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":15,"recy":194,"rectd":0},{"id":"4429023","n":"MarShawn Lloyd","pos":"RB","t":"9","ta":"GB","gp":7,"py":0,"ptd":0,"ry":142,"rtd":2,"rec":12,"recy":70,"rectd":1},{"id":"4429025","n":"Quentin Johnston","pos":"WR","t":"24","ta":"LAC","gp":5,"py":0,"ptd":0,"ry":3,"rtd":0,"rec":8,"recy":165,"rectd":0},{"id":"4429059","n":"Woody Marks","pos":"RB","t":"34","ta":"HOU","gp":7,"py":0,"ptd":0,"ry":271,"rtd":2,"rec":14,"recy":94,"rectd":0},{"id":"4429086","n":"Michael Mayer","pos":"TE","t":"13","ta":"LV","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":31,"recy":298,"rectd":1},{"id":"4429096","n":"Blake Corum","pos":"RB","t":"14","ta":"LAR","gp":7,"py":0,"ptd":0,"ry":316,"rtd":2,"rec":10,"recy":99,"rectd":1},{"id":"4429105","n":"Arian Smith","pos":"WR","t":"20","ta":"NYJ","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4429121","n":"Kalel Mullings","pos":"RB","t":"10","ta":"TEN","gp":1,"py":0,"ptd":0,"ry":3,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4429148","n":"Theo Johnson","pos":"TE","t":"19","ta":"NYG","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":55,"rectd":1},{"id":"4429160","n":"De'Von Achane","pos":"RB","t":"15","ta":"MIA","gp":3,"py":0,"ptd":0,"ry":127,"rtd":0,"rec":7,"recy":49,"rectd":0},{"id":"4429205","n":"Jordan Addison","pos":"WR","t":"16","ta":"MIN","gp":5,"py":0,"ptd":0,"ry":2,"rtd":0,"rec":13,"recy":183,"rectd":1},{"id":"4429299","n":"Tahj Brooks","pos":"RB","t":"4","ta":"CIN","gp":1,"py":0,"ptd":0,"ry":6,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4429501","n":"Ray Davis","pos":"RB","t":"2","ta":"BUF","gp":4,"py":0,"ptd":0,"ry":12,"rtd":0,"rec":3,"recy":40,"rectd":0},{"id":"4429615","n":"Zay Flowers","pos":"WR","t":"33","ta":"BAL","gp":6,"py":0,"ptd":0,"ry":34,"rtd":0,"rec":40,"recy":608,"rectd":3},{"id":"4429676","n":"Tyler Goodson","pos":"RB","t":"6","ta":"DAL","gp":4,"py":0,"ptd":0,"ry":72,"rtd":0,"rec":2,"recy":4,"rectd":0},{"id":"4429795","n":"Jahmyr Gibbs","pos":"RB","t":"8","ta":"DET","gp":6,"py":0,"ptd":0,"ry":620,"rtd":7,"rec":32,"recy":270,"rectd":2},{"id":"4429805","n":"Frank Gore Jr.","pos":"RB","t":"2","ta":"BUF","gp":1,"py":0,"ptd":0,"ry":3,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4429835","n":"George Holani","pos":"RB","t":"26","ta":"SEA","gp":7,"py":0,"ptd":0,"ry":108,"rtd":1,"rec":12,"recy":88,"rectd":0},{"id":"4429939","n":"Jawhar Jordan","pos":"RB","t":"34","ta":"HOU","gp":1,"py":0,"ptd":0,"ry":43,"rtd":1,"rec":1,"recy":7,"rectd":0},{"id":"4430027","n":"Sam LaPorta","pos":"TE","t":"8","ta":"DET","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":28,"recy":334,"rectd":3},{"id":"4430034","n":"Xavier Legette","pos":"WR","t":"29","ta":"CAR","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":64,"rectd":0},{"id":"4430191","n":"Skyy Moore","pos":"WR","t":"9","ta":"GB","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":7,"recy":35,"rectd":0},{"id":"4430539","n":"Brenton Strange","pos":"TE","t":"30","ta":"JAX","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":26,"recy":279,"rectd":1},{"id":"4430656","n":"Myles Price","pos":"WR","t":"16","ta":"MIN","gp":3,"py":0,"ptd":0,"ry":2,"rtd":0,"rec":5,"recy":26,"rectd":0},{"id":"4430681","n":"Jared Wayne","pos":"WR","t":"34","ta":"HOU","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":65,"rectd":0},{"id":"4430684","n":"Treyton Welch","pos":"TE","t":"18","ta":"NO","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4430737","n":"Kyren Williams","pos":"RB","t":"14","ta":"LAR","gp":7,"py":0,"ptd":0,"ry":492,"rtd":5,"rec":32,"recy":239,"rectd":1},{"id":"4430802","n":"Darnell Washington","pos":"TE","t":"23","ta":"PIT","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":16,"recy":160,"rectd":3},{"id":"4430807","n":"Bijan Robinson","pos":"RB","t":"1","ta":"ATL","gp":7,"py":0,"ptd":0,"ry":704,"rtd":4,"rec":25,"recy":203,"rectd":1},{"id":"4430834","n":"Jalen McMillan","pos":"WR","t":"27","ta":"TB","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4430870","n":"KeAndre Lambert-Smith","pos":"WR","t":"24","ta":"LAC","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":32,"rectd":0},{"id":"4430871","n":"Sean Tucker","pos":"RB","t":"27","ta":"TB","gp":3,"py":0,"ptd":0,"ry":80,"rtd":2,"rec":0,"recy":0,"rectd":0},{"id":"4430878","n":"Jaxon Smith-Njigba","pos":"WR","t":"26","ta":"SEA","gp":7,"py":14,"ptd":0,"ry":29,"rtd":0,"rec":58,"recy":867,"rectd":8},{"id":"4430968","n":"Kimani Vidal","pos":"RB","t":"24","ta":"LAC","gp":4,"py":0,"ptd":0,"ry":109,"rtd":1,"rec":7,"recy":43,"rectd":1},{"id":"4431196","n":"Jake Briningstool","pos":"TE","t":"12","ta":"KC","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":9,"rectd":0},{"id":"4431268","n":"Chimere Dike","pos":"WR","t":"10","ta":"TEN","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":6,"recy":53,"rectd":0},{"id":"4431280","n":"Troy Franklin","pos":"WR","t":"7","ta":"DEN","gp":6,"py":0,"ptd":0,"ry":5,"rtd":0,"rec":5,"recy":66,"rectd":0},{"id":"4431299","n":"Rome Odunze","pos":"WR","t":"3","ta":"CHI","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":24,"recy":381,"rectd":0},{"id":"4431346","n":"Mark Redman","pos":"TE","t":"9","ta":"GB","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":29,"rectd":0},{"id":"4431431","n":"Corey Kiner","pos":"RB","t":"17","ta":"NE","gp":6,"py":0,"ptd":0,"ry":151,"rtd":0,"rec":2,"recy":16,"rectd":0},{"id":"4431452","n":"Drake Maye","pos":"QB","t":"17","ta":"NE","gp":7,"py":1784,"ptd":13,"ry":211,"rtd":2,"rec":0,"recy":0,"rectd":0},{"id":"4431459","n":"Tyler Warren","pos":"TE","t":"11","ta":"IND","gp":5,"py":0,"ptd":0,"ry":6,"rtd":1,"rec":30,"recy":213,"rectd":2},{"id":"4431466","n":"Jordan Watkins","pos":"WR","t":"25","ta":"SF","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":6,"recy":138,"rectd":0},{"id":"4431487","n":"Savion Williams","pos":"WR","t":"9","ta":"GB","gp":2,"py":0,"ptd":0,"ry":13,"rtd":0,"rec":7,"recy":79,"rectd":0},{"id":"4431492","n":"Roman Wilson","pos":"WR","t":"23","ta":"PIT","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":14,"recy":188,"rectd":2},{"id":"4431545","n":"Will Shipley","pos":"RB","t":"21","ta":"PHI","gp":5,"py":0,"ptd":0,"ry":57,"rtd":1,"rec":5,"recy":31,"rectd":0},{"id":"4431574","n":"Eli Stowers","pos":"TE","t":"21","ta":"PHI","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4431611","n":"Caleb Williams","pos":"QB","t":"3","ta":"CHI","gp":4,"py":1020,"ptd":5,"ry":128,"rtd":2,"rec":0,"recy":0,"rectd":0},{"id":"4432260","n":"Matt Hibner","pos":"TE","t":"33","ta":"BAL","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":70,"rectd":1},{"id":"4432577","n":"C.J. Stroud","pos":"QB","t":"34","ta":"HOU","gp":7,"py":1867,"ptd":11,"ry":80,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"4432620","n":"Parker Washington","pos":"WR","t":"30","ta":"JAX","gp":6,"py":0,"ptd":0,"ry":3,"rtd":0,"rec":26,"recy":416,"rectd":4},{"id":"4432665","n":"Brock Bowers","pos":"TE","t":"13","ta":"LV","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":34,"recy":455,"rectd":3},{"id":"4432708","n":"Marvin Harrison Jr.","pos":"WR","t":"34","ta":"HOU","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":125,"rectd":2},{"id":"4432710","n":"TreVeyon Henderson","pos":"RB","t":"17","ta":"NE","gp":6,"py":0,"ptd":0,"ry":203,"rtd":1,"rec":5,"recy":45,"rectd":0},{"id":"4432722","n":"Athan Kaliakmanis","pos":"QB","t":"28","ta":"WSH","gp":1,"py":186,"ptd":1,"ry":16,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4432762","n":"Shedeur Sanders","pos":"QB","t":"5","ta":"CLE","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4432773","n":"Brian Thomas Jr.","pos":"WR","t":"30","ta":"JAX","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":105,"rectd":1},{"id":"4433959","n":"Ben Yurosek","pos":"TE","t":"16","ta":"MIN","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":10,"rectd":0},{"id":"4433970","n":"J.J. McCarthy","pos":"QB","t":"19","ta":"NYG","gp":3,"py":495,"ptd":1,"ry":29,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4434153","n":"Tyson Bagent","pos":"QB","t":"3","ta":"CHI","gp":3,"py":409,"ptd":0,"ry":18,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4565185","n":"Tai Felton","pos":"WR","t":"16","ta":"MIN","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":41,"rectd":0},{"id":"4567048","n":"Kenneth Walker III","pos":"RB","t":"12","ta":"KC","gp":6,"py":0,"ptd":0,"ry":701,"rtd":6,"rec":18,"recy":116,"rectd":2},{"id":"4567096","n":"John Metchie III","pos":"WR","t":"29","ta":"CAR","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":100,"rectd":1},{"id":"4567156","n":"Treylon Burks","pos":"WR","t":"28","ta":"WSH","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":152,"rectd":2},{"id":"4567750","n":"Emeka Egbuka","pos":"WR","t":"27","ta":"TB","gp":6,"py":0,"ptd":0,"ry":11,"rtd":1,"rec":28,"recy":240,"rectd":2},{"id":"4568490","n":"RJ Harvey","pos":"RB","t":"7","ta":"DEN","gp":6,"py":0,"ptd":0,"ry":87,"rtd":1,"rec":25,"recy":217,"rectd":1},{"id":"4569173","n":"Rhamondre Stevenson","pos":"RB","t":"17","ta":"NE","gp":7,"py":0,"ptd":0,"ry":285,"rtd":2,"rec":20,"recy":204,"rectd":1},{"id":"4569371","n":"Isaiah Williams","pos":"WR","t":"20","ta":"NYJ","gp":6,"py":0,"ptd":0,"ry":21,"rtd":0,"rec":11,"recy":151,"rectd":1},{"id":"4569382","n":"Jordan Whittington","pos":"WR","t":"14","ta":"LAR","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":12,"rectd":0},{"id":"4569559","n":"Devaughn Vele","pos":"WR","t":"18","ta":"NO","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":33,"recy":348,"rectd":3},{"id":"4569587","n":"Wan'Dale Robinson","pos":"WR","t":"10","ta":"TEN","gp":7,"py":0,"ptd":0,"ry":1,"rtd":0,"rec":29,"recy":205,"rectd":2},{"id":"4569603","n":"Malik Washington","pos":"WR","t":"15","ta":"MIA","gp":6,"py":0,"ptd":0,"ry":38,"rtd":0,"rec":26,"recy":289,"rectd":0},{"id":"4569618","n":"Garrett Wilson","pos":"WR","t":"20","ta":"NYJ","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":37,"recy":444,"rectd":3},{"id":"4569682","n":"Audric Estime","pos":"RB","t":"5","ta":"CLE","gp":1,"py":0,"ptd":0,"ry":19,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"4569987","n":"Jaylen Warren","pos":"RB","t":"23","ta":"PIT","gp":7,"py":0,"ptd":0,"ry":561,"rtd":1,"rec":24,"recy":294,"rectd":1},{"id":"4570037","n":"Terrance Ferguson","pos":"TE","t":"14","ta":"LAR","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":7,"recy":63,"rectd":1},{"id":"4572680","n":"Tucker Kraft","pos":"TE","t":"9","ta":"GB","gp":7,"py":0,"ptd":0,"ry":5,"rtd":0,"rec":29,"recy":297,"rectd":2},{"id":"4573699","n":"Jackson Hawes","pos":"TE","t":"2","ta":"BUF","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4575131","n":"Jacory Croskey-Merritt","pos":"RB","t":"28","ta":"WSH","gp":5,"py":0,"ptd":0,"ry":239,"rtd":2,"rec":5,"recy":40,"rectd":0},{"id":"4575665","n":"Jacob Cowing","pos":"WR","t":"25","ta":"SF","gp":4,"py":0,"ptd":0,"ry":12,"rtd":0,"rec":4,"recy":47,"rectd":0},{"id":"4576297","n":"AJ Barner","pos":"TE","t":"26","ta":"SEA","gp":7,"py":0,"ptd":0,"ry":5,"rtd":1,"rec":19,"recy":180,"rectd":0},{"id":"4586312","n":"Jaylin Noel","pos":"WR","t":"34","ta":"HOU","gp":7,"py":0,"ptd":0,"ry":26,"rtd":0,"rec":19,"recy":331,"rectd":2},{"id":"4590292","n":"Thomas Fidone II","pos":"TE","t":"19","ta":"NYG","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":29,"rectd":0},{"id":"4595342","n":"Oronde Gadsden","pos":"TE","t":"24","ta":"LAC","gp":6,"py":0,"ptd":0,"ry":2,"rtd":0,"rec":12,"recy":103,"rectd":1},{"id":"4595348","n":"Malik Nabers","pos":"WR","t":"19","ta":"NYG","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":48,"recy":605,"rectd":2},{"id":"4596334","n":"Keaton Mitchell","pos":"RB","t":"24","ta":"LAC","gp":6,"py":0,"ptd":0,"ry":139,"rtd":0,"rec":12,"recy":52,"rectd":1},{"id":"4596448","n":"Bucky Irving","pos":"RB","t":"27","ta":"TB","gp":7,"py":0,"ptd":0,"ry":558,"rtd":4,"rec":18,"recy":78,"rectd":1},{"id":"4596472","n":"Jalon Daniels","pos":"QB","t":"27","ta":"TB","gp":5,"py":501,"ptd":3,"ry":123,"rtd":0,"rec":1,"recy":-3,"rectd":0},{"id":"4596602","n":"Brashard Smith","pos":"RB","t":"12","ta":"KC","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":4,"rectd":0},{"id":"4597500","n":"Adonai Mitchell","pos":"WR","t":"20","ta":"NYJ","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":123,"rectd":0},{"id":"4597703","n":"Tory Horton","pos":"WR","t":"26","ta":"SEA","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":67,"rectd":1},{"id":"4599739","n":"Kendre Miller","pos":"RB","t":"18","ta":"NO","gp":6,"py":0,"ptd":0,"ry":159,"rtd":2,"rec":9,"recy":37,"rectd":0},{"id":"4600981","n":"Pat Bryant","pos":"WR","t":"7","ta":"DEN","gp":4,"py":0,"ptd":0,"ry":16,"rtd":0,"rec":9,"recy":133,"rectd":1},{"id":"4601080","n":"Raheim Sanders","pos":"RB","t":"5","ta":"CLE","gp":5,"py":0,"ptd":0,"ry":43,"rtd":0,"rec":11,"recy":74,"rectd":0},{"id":"4602667","n":"Jaylin Lane","pos":"WR","t":"28","ta":"WSH","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":25,"rectd":0},{"id":"4602788","n":"Jackson Meeks","pos":"WR","t":"8","ta":"DET","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":8,"rectd":0},{"id":"4603186","n":"Jack Bech","pos":"WR","t":"13","ta":"LV","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":48,"rectd":1},{"id":"4608686","n":"Kyle Monangai","pos":"RB","t":"3","ta":"CHI","gp":4,"py":0,"ptd":0,"ry":324,"rtd":3,"rec":5,"recy":39,"rectd":0},{"id":"4608810","n":"Tez Johnson","pos":"WR","t":"27","ta":"TB","gp":7,"py":0,"ptd":0,"ry":20,"rtd":0,"rec":9,"recy":178,"rectd":1},{"id":"4612826","n":"Ladd McConkey","pos":"WR","t":"24","ta":"LAC","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":13,"recy":200,"rectd":1},{"id":"4613202","n":"Kyle Williams","pos":"WR","t":"17","ta":"NE","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":6,"recy":147,"rectd":1},{"id":"4635008","n":"Keon Coleman","pos":"WR","t":"2","ta":"BUF","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":19,"recy":283,"rectd":3},{"id":"4635009","n":"J. Michael Sturdivant","pos":"WR","t":"9","ta":"GB","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":22,"rectd":0},{"id":"4678006","n":"Elijah Arroyo","pos":"TE","t":"26","ta":"SEA","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":17,"rectd":0},{"id":"4678008","n":"Jonathon Brooks","pos":"RB","t":"29","ta":"CAR","gp":2,"py":0,"ptd":0,"ry":30,"rtd":0,"rec":2,"recy":43,"rectd":0},{"id":"4682648","n":"Malachi Fields","pos":"WR","t":"19","ta":"NYG","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":16,"recy":248,"rectd":1},{"id":"4682745","n":"Jaylen Wright","pos":"RB","t":"15","ta":"MIA","gp":5,"py":0,"ptd":0,"ry":36,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4683062","n":"Xavier Worthy","pos":"WR","t":"12","ta":"KC","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":24,"recy":217,"rectd":1},{"id":"4683151","n":"Deion Burks","pos":"WR","t":"11","ta":"IND","gp":5,"py":0,"ptd":0,"ry":21,"rtd":0,"rec":4,"recy":58,"rectd":0},{"id":"4683153","n":"Skyler Bell","pos":"WR","t":"2","ta":"BUF","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4683159","n":"Lewis Bond","pos":"WR","t":"34","ta":"HOU","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4683243","n":"Mitchell Evans","pos":"TE","t":"29","ta":"CAR","gp":6,"py":0,"ptd":0,"ry":1,"rtd":0,"rec":8,"recy":105,"rectd":0},{"id":"4685030","n":"Brandon Coleman","pos":"WR","t":"28","ta":"WSH","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":13,"rectd":0},{"id":"4685116","n":"DJ Herman","pos":"RB","t":"15","ta":"MIA","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":18,"rectd":0},{"id":"4685201","n":"Tanner McKee","pos":"QB","t":"21","ta":"PHI","gp":2,"py":426,"ptd":2,"ry":1,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4685246","n":"Kaytron Allen","pos":"RB","t":"28","ta":"WSH","gp":3,"py":0,"ptd":0,"ry":41,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4685247","n":"Braelon Allen","pos":"RB","t":"20","ta":"NYJ","gp":7,"py":0,"ptd":0,"ry":418,"rtd":2,"rec":15,"recy":75,"rectd":0},{"id":"4685261","n":"Germie Bernard","pos":"WR","t":"23","ta":"PIT","gp":6,"py":0,"ptd":0,"ry":4,"rtd":0,"rec":27,"recy":254,"rectd":1},{"id":"4685278","n":"Luther Burden III","pos":"WR","t":"3","ta":"CHI","gp":7,"py":0,"ptd":0,"ry":29,"rtd":0,"rec":35,"recy":491,"rectd":2},{"id":"4685307","n":"Kevin Coleman Jr.","pos":"WR","t":"15","ta":"MIA","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":36,"rectd":1},{"id":"4685350","n":"Trevor Etienne","pos":"RB","t":"29","ta":"CAR","gp":2,"py":0,"ptd":0,"ry":7,"rtd":0,"rec":2,"recy":17,"rectd":0},{"id":"4685382","n":"Omarion Hampton","pos":"RB","t":"24","ta":"LAC","gp":6,"py":0,"ptd":0,"ry":289,"rtd":3,"rec":9,"recy":56,"rectd":0},{"id":"4685397","n":"Jordan James","pos":"RB","t":"25","ta":"SF","gp":2,"py":0,"ptd":0,"ry":21,"rtd":0,"rec":1,"recy":11,"rectd":0},{"id":"4685415","n":"Travis Hunter","pos":"WR","t":"30","ta":"JAX","gp":3,"py":0,"ptd":0,"ry":3,"rtd":0,"rec":6,"recy":76,"rectd":1},{"id":"4685472","n":"Tetairoa McMillan","pos":"WR","t":"29","ta":"CAR","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":36,"recy":511,"rectd":2},{"id":"4685504","n":"Sam Roush","pos":"TE","t":"3","ta":"CHI","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":33,"rectd":0},{"id":"4685512","n":"Jadarian Price","pos":"RB","t":"26","ta":"SEA","gp":3,"py":0,"ptd":0,"ry":119,"rtd":0,"rec":4,"recy":21,"rectd":0},{"id":"4685553","n":"Brenen Thompson","pos":"WR","t":"24","ta":"LAC","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":13,"rectd":0},{"id":"4685555","n":"Nicholas Singleton","pos":"RB","t":"10","ta":"TEN","gp":2,"py":0,"ptd":0,"ry":12,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4685702","n":"Quinshon Judkins","pos":"RB","t":"5","ta":"CLE","gp":6,"py":0,"ptd":0,"ry":317,"rtd":3,"rec":19,"recy":110,"rectd":0},{"id":"4685720","n":"Bryce Young","pos":"QB","t":"29","ta":"CAR","gp":6,"py":1712,"ptd":12,"ry":34,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"4686248","n":"Nate Boerkircher","pos":"TE","t":"30","ta":"JAX","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":6,"recy":52,"rectd":1},{"id":"4686422","n":"Xavier Hutchinson","pos":"WR","t":"34","ta":"HOU","gp":7,"py":0,"ptd":0,"ry":16,"rtd":0,"rec":21,"recy":258,"rectd":1},{"id":"4686468","n":"Seth McGowan","pos":"RB","t":"11","ta":"IND","gp":7,"py":0,"ptd":0,"ry":134,"rtd":0,"rec":4,"recy":12,"rectd":0},{"id":"4686472","n":"Marvin Mims Jr.","pos":"WR","t":"7","ta":"DEN","gp":4,"py":0,"ptd":0,"ry":6,"rtd":0,"rec":7,"recy":82,"rectd":0},{"id":"4686612","n":"Tre' Harris","pos":"WR","t":"24","ta":"LAC","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":15,"recy":225,"rectd":0},{"id":"4686658","n":"Mike Washington Jr.","pos":"RB","t":"13","ta":"LV","gp":7,"py":0,"ptd":0,"ry":195,"rtd":1,"rec":3,"recy":11,"rectd":0},{"id":"4686728","n":"Gunnar Helm","pos":"TE","t":"10","ta":"TEN","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":12,"recy":84,"rectd":0},{"id":"4688380","n":"Cam Ward","pos":"QB","t":"10","ta":"TEN","gp":7,"py":1179,"ptd":4,"ry":71,"rtd":2,"rec":0,"recy":0,"rectd":0},{"id":"4688813","n":"Josh Downs","pos":"WR","t":"11","ta":"IND","gp":7,"py":0,"ptd":0,"ry":7,"rtd":0,"rec":26,"recy":307,"rectd":0},{"id":"4689114","n":"Jaxson Dart","pos":"QB","t":"19","ta":"NYG","gp":2,"py":250,"ptd":3,"ry":54,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4690013","n":"Rasheen Ali","pos":"RB","t":"33","ta":"BAL","gp":1,"py":0,"ptd":0,"ry":19,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4690070","n":"Mitchell Tinsley","pos":"WR","t":"4","ta":"CIN","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":56,"rectd":0},{"id":"4690143","n":"LaJohntay Wester","pos":"WR","t":"33","ta":"BAL","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":44,"rectd":0},{"id":"4690923","n":"Ben Sinnott","pos":"TE","t":"28","ta":"WSH","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":6,"rectd":0},{"id":"4692835","n":"Jalen Brooks","pos":"WR","t":"22","ta":"ARI","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":81,"rectd":0},{"id":"4695193","n":"Efton Chism III","pos":"WR","t":"17","ta":"NE","gp":6,"py":16,"ptd":0,"ry":2,"rtd":0,"rec":10,"recy":114,"rectd":1},{"id":"4695404","n":"Isaiah Davis","pos":"RB","t":"20","ta":"NYJ","gp":3,"py":0,"ptd":0,"ry":29,"rtd":0,"rec":5,"recy":68,"rectd":0},{"id":"4695705","n":"Marlin Klein","pos":"TE","t":"34","ta":"HOU","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":16,"rectd":0},{"id":"4695883","n":"Jalen Coker","pos":"WR","t":"29","ta":"CAR","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":25,"recy":328,"rectd":2},{"id":"4696044","n":"Kaelon Black","pos":"RB","t":"25","ta":"SF","gp":7,"py":0,"ptd":0,"ry":233,"rtd":1,"rec":3,"recy":4,"rectd":0},{"id":"4696882","n":"Devontez Walker","pos":"WR","t":"33","ta":"BAL","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":75,"rectd":1},{"id":"4696981","n":"Cam Skattebo","pos":"RB","t":"19","ta":"NYG","gp":6,"py":0,"ptd":0,"ry":418,"rtd":2,"rec":11,"recy":76,"rectd":0},{"id":"4697815","n":"Rachaad White","pos":"RB","t":"28","ta":"WSH","gp":5,"py":0,"ptd":0,"ry":145,"rtd":0,"rec":14,"recy":83,"rectd":2},{"id":"4698597","n":"Barion Brown","pos":"WR","t":"18","ta":"NO","gp":4,"py":0,"ptd":0,"ry":-2,"rtd":0,"rec":4,"recy":62,"rectd":0},{"id":"4701936","n":"Matthew Golden","pos":"WR","t":"9","ta":"GB","gp":7,"py":0,"ptd":0,"ry":6,"rtd":0,"rec":36,"recy":540,"rectd":3},{"id":"4702555","n":"Jonah Coleman","pos":"RB","t":"7","ta":"DEN","gp":2,"py":0,"ptd":0,"ry":93,"rtd":1,"rec":5,"recy":34,"rectd":0},{"id":"4702559","n":"Oscar Delp","pos":"TE","t":"18","ta":"NO","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":4,"recy":20,"rectd":0},{"id":"4708049","n":"Gavin Bartholomew","pos":"TE","t":"16","ta":"MIN","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":7,"recy":54,"rectd":0},{"id":"4708486","n":"Jimmy Horn Jr.","pos":"WR","t":"29","ta":"CAR","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4709392","n":"Anthony Tyus III","pos":"RB","t":"29","ta":"CAR","gp":1,"py":0,"ptd":0,"ry":23,"rtd":1,"rec":0,"recy":0,"rectd":0},{"id":"4710855","n":"Konata Mumpfield","pos":"WR","t":"14","ta":"LAR","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":142,"rectd":1},{"id":"4711533","n":"Ollie Gordon II","pos":"RB","t":"15","ta":"MIA","gp":5,"py":0,"ptd":0,"ry":339,"rtd":4,"rec":6,"recy":14,"rectd":0},{"id":"4714379","n":"Seydou Traore","pos":"TE","t":"15","ta":"MIA","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4715355","n":"Darius Cooper","pos":"WR","t":"21","ta":"PHI","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":156,"rectd":4},{"id":"4722893","n":"Jaleel McLaughlin","pos":"RB","t":"5","ta":"CLE","gp":4,"py":0,"ptd":0,"ry":72,"rtd":1,"rec":4,"recy":14,"rectd":0},{"id":"4722908","n":"Drew Ogletree","pos":"TE","t":"11","ta":"IND","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":16,"rectd":0},{"id":"4723086","n":"Colston Loveland","pos":"TE","t":"3","ta":"CHI","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":26,"recy":244,"rectd":2},{"id":"4723820","n":"Omar Cooper Jr.","pos":"WR","t":"20","ta":"NYJ","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":12,"recy":248,"rectd":2},{"id":"4808766","n":"Mason Taylor","pos":"TE","t":"20","ta":"NYJ","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":14,"recy":117,"rectd":2},{"id":"4808839","n":"Isaiah Bond","pos":"WR","t":"5","ta":"CLE","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":86,"rectd":0},{"id":"4819231","n":"Kaleb Johnson","pos":"RB","t":"9","ta":"GB","gp":5,"py":0,"ptd":0,"ry":104,"rtd":0,"rec":1,"recy":10,"rectd":0},{"id":"4831959","n":"Eli Raridon","pos":"TE","t":"17","ta":"NE","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":12,"recy":168,"rectd":2},{"id":"4832800","n":"Denzel Boston","pos":"WR","t":"5","ta":"CLE","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":20,"recy":372,"rectd":3},{"id":"4832846","n":"Demond Claiborne","pos":"RB","t":"16","ta":"MIN","gp":4,"py":0,"ptd":0,"ry":13,"rtd":0,"rec":2,"recy":8,"rectd":0},{"id":"4832955","n":"Emmett Johnson","pos":"RB","t":"12","ta":"KC","gp":6,"py":0,"ptd":0,"ry":62,"rtd":0,"rec":9,"recy":109,"rectd":0},{"id":"4837248","n":"Fernando Mendoza","pos":"QB","t":"13","ta":"LV","gp":1,"py":48,"ptd":0,"ry":3,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4869132","n":"Reggie Virgil","pos":"WR","t":"22","ta":"ARI","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":29,"rectd":0},{"id":"4869645","n":"Caleb Douglas","pos":"WR","t":"15","ta":"MIA","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":183,"rectd":2},{"id":"4869748","n":"Zavion Thomas","pos":"WR","t":"3","ta":"CHI","gp":3,"py":0,"ptd":0,"ry":11,"rtd":0,"rec":5,"recy":37,"rectd":0},{"id":"4869961","n":"Chris Bell","pos":"WR","t":"15","ta":"MIA","gp":6,"py":0,"ptd":0,"ry":26,"rtd":0,"rec":8,"recy":117,"rectd":0},{"id":"4870612","n":"Zachariah Branch","pos":"WR","t":"1","ta":"ATL","gp":6,"py":0,"ptd":0,"ry":8,"rtd":0,"rec":10,"recy":64,"rectd":0},{"id":"4870653","n":"KC Concepcion","pos":"WR","t":"5","ta":"CLE","gp":7,"py":0,"ptd":0,"ry":34,"rtd":0,"rec":30,"recy":315,"rectd":0},{"id":"4870795","n":"Makai Lemon","pos":"WR","t":"21","ta":"PHI","gp":7,"py":0,"ptd":0,"ry":-5,"rtd":0,"rec":25,"recy":194,"rectd":1},{"id":"4870808","n":"Jeremiyah Love","pos":"RB","t":"22","ta":"ARI","gp":5,"py":0,"ptd":0,"ry":245,"rtd":1,"rec":11,"recy":36,"rectd":1},{"id":"4870847","n":"Ja'Kobi Lane","pos":"WR","t":"33","ta":"BAL","gp":3,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":8,"recy":76,"rectd":0},{"id":"4871023","n":"Carnell Tate","pos":"WR","t":"10","ta":"TEN","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":34,"recy":413,"rectd":1},{"id":"4876132","n":"Josh Cuevas","pos":"TE","t":"33","ta":"BAL","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":119,"rectd":1},{"id":"4876995","n":"Ja'seem Reed","pos":"WR","t":"29","ta":"CAR","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4878695","n":"Max Bredeson","pos":"RB","t":"16","ta":"MIN","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"4879194","n":"Josh Cameron","pos":"WR","t":"30","ta":"JAX","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":8,"recy":117,"rectd":2},{"id":"4879276","n":"Bryce Lance","pos":"WR","t":"18","ta":"NO","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":9,"recy":78,"rectd":1},{"id":"4880236","n":"Will Kacmarek","pos":"TE","t":"15","ta":"MIA","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":24,"rectd":0},{"id":"4882093","n":"Bhayshul Tuten","pos":"RB","t":"30","ta":"JAX","gp":6,"py":0,"ptd":0,"ry":388,"rtd":2,"rec":13,"recy":126,"rectd":2},{"id":"4883647","n":"Elic Ayomanor","pos":"WR","t":"10","ta":"TEN","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":10,"recy":177,"rectd":1},{"id":"4887558","n":"Emanuel Wilson","pos":"RB","t":"26","ta":"SEA","gp":7,"py":0,"ptd":0,"ry":403,"rtd":3,"rec":6,"recy":65,"rectd":1},{"id":"4890373","n":"Bauer Sharp","pos":"TE","t":"27","ta":"TB","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":21,"rectd":0},{"id":"4890973","n":"Ashton Jeanty","pos":"RB","t":"13","ta":"LV","gp":7,"py":0,"ptd":0,"ry":328,"rtd":1,"rec":34,"recy":312,"rectd":3},{"id":"4911851","n":"LeQuint Allen Jr.","pos":"RB","t":"30","ta":"JAX","gp":4,"py":0,"ptd":0,"ry":1,"rtd":0,"rec":2,"recy":9,"rectd":0},{"id":"4912218","n":"Cyrus Allen","pos":"WR","t":"12","ta":"KC","gp":4,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":3,"recy":45,"rectd":0},{"id":"4912274","n":"Sione Vaki","pos":"RB","t":"8","ta":"DET","gp":6,"py":0,"ptd":0,"ry":56,"rtd":0,"rec":4,"recy":52,"rectd":0},{"id":"5081397","n":"Dylan Sampson","pos":"RB","t":"5","ta":"CLE","gp":1,"py":0,"ptd":0,"ry":45,"rtd":0,"rec":3,"recy":32,"rectd":0},{"id":"5081432","n":"Antonio Williams","pos":"WR","t":"28","ta":"WSH","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":18,"recy":205,"rectd":1},{"id":"5081999","n":"CJ Donaldson","pos":"RB","t":"18","ta":"NO","gp":6,"py":0,"ptd":0,"ry":81,"rtd":0,"rec":4,"recy":10,"rectd":0},{"id":"5082630","n":"Jalen Royals","pos":"WR","t":"12","ta":"KC","gp":5,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":5,"recy":41,"rectd":1},{"id":"5083076","n":"Harold Fannin Jr.","pos":"TE","t":"5","ta":"CLE","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":25,"recy":257,"rectd":3},{"id":"5083315","n":"Kenyon Sadiq","pos":"TE","t":"20","ta":"NYJ","gp":7,"py":0,"ptd":0,"ry":3,"rtd":1,"rec":16,"recy":164,"rectd":1},{"id":"5083754","n":"Ryan Flournoy","pos":"WR","t":"6","ta":"DAL","gp":7,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":27,"recy":304,"rectd":1},{"id":"5088338","n":"Elijah Sarratt","pos":"WR","t":"33","ta":"BAL","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":13,"rectd":0},{"id":"5092508","n":"Colbie Young","pos":"WR","t":"4","ta":"CIN","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":9,"rectd":0},{"id":"5093923","n":"Andrew Armstrong","pos":"WR","t":"12","ta":"KC","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":2,"recy":16,"rectd":0},{"id":"5097554","n":"Kameron Johnson","pos":"WR","t":"27","ta":"TB","gp":1,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":3,"rectd":0},{"id":"5123663","n":"Isaac TeSlaa","pos":"WR","t":"8","ta":"DET","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":10,"recy":197,"rectd":0},{"id":"5150247","n":"Malik Benson","pos":"WR","t":"13","ta":"LV","gp":5,"py":0,"ptd":0,"ry":-8,"rtd":0,"rec":2,"recy":12,"rectd":0},{"id":"5160110","n":"Jahdae Walker","pos":"WR","t":"3","ta":"CHI","gp":2,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":1,"recy":1,"rectd":1},{"id":"5220680","n":"Ted Hurst III","pos":"WR","t":"27","ta":"TB","gp":6,"py":0,"ptd":0,"ry":0,"rtd":0,"rec":11,"recy":168,"rectd":1},{"id":"5344782","n":"Jack Strand","pos":"QB","t":"1","ta":"ATL","gp":1,"py":59,"ptd":0,"ry":16,"rtd":0,"rec":0,"recy":0,"rectd":0},{"id":"8439","n":"Aaron Rodgers","pos":"QB","t":"23","ta":"PIT","gp":7,"py":1699,"ptd":13,"ry":23,"rtd":0,"rec":0,"recy":0,"rectd":0}],"props":[{"id":"2576925","n":"Darren Waller","pos":"TE","ta":"CAR","mk":"rec_yds","lines":{"draftkings":19.5,"fanduel":19.5,"hardrockbet":19.5},"sample":[50,0,36,51,33,28],"scope":"season","gid":"401873023"},{"id":"4036378","n":"Jordan Love","pos":"QB","ta":"GB","mk":"pass_yds","lines":{"draftkings":259.5,"fanduel":262.5,"hardrockbet":262.5},"sample":[274,276,367,197,312,145,387],"scope":"season","gid":"401873023"},{"id":"4047365","n":"Josh Jacobs","pos":"RB","ta":"GB","mk":"rush_yds","lines":{"draftkings":59.5,"fanduel":58.5,"hardrockbet":59.5},"sample":[36],"scope":"season","gid":"401873023"},{"id":"4241416","n":"Chuba Hubbard","pos":"RB","ta":"CAR","mk":"rush_yds","lines":{"draftkings":66.5,"fanduel":67.5,"hardrockbet":66.5},"sample":[33,120,122,82,53,49],"scope":"season","gid":"401873023"},{"id":"4248528","n":"Christian Watson","pos":"WR","ta":"GB","mk":"rec_yds","lines":{"draftkings":67.5,"fanduel":72.5,"hardrockbet":70.5},"sample":[57,64,143,47,96,41,147],"scope":"season","gid":"401873023"},{"id":"4360763","n":"Brycen Tremayne","pos":"WR","ta":"CAR","mk":"rec_yds","lines":{"fanduel":6.5,"hardrockbet":6.5},"sample":[0,32,83],"scope":"season","gid":"401873023"},{"id":"4372780","n":"Tommy Tremble","pos":"TE","ta":"CAR","mk":"rec_yds","lines":{"draftkings":14.5,"fanduel":15.5,"hardrockbet":15.5},"sample":[8,46,12,41,4,25],"scope":"season","gid":"401873023"},{"id":"4429023","n":"MarShawn Lloyd","pos":"RB","ta":"GB","mk":"rush_yds","lines":{"draftkings":17.5,"fanduel":16.5,"hardrockbet":16.5},"sample":[20,10,31,13,11,20,37],"scope":"season","gid":"401873023"},{"id":"4431487","n":"Savion Williams","pos":"WR","ta":"GB","mk":"rec_yds","lines":{"fanduel":24.5,"hardrockbet":25.5},"sample":[47,32],"scope":"season","gid":"401873023"},{"id":"4567096","n":"John Metchie III","pos":"WR","ta":"CAR","mk":"rec_yds","lines":{"draftkings":14.5,"fanduel":15.5,"hardrockbet":16.5},"sample":[20,24,37,19],"scope":"season","gid":"401873023"},{"id":"4572680","n":"Tucker Kraft","pos":"TE","ta":"GB","mk":"rec_yds","lines":{"draftkings":46.5,"fanduel":46.5,"hardrockbet":46.5},"sample":[48,37,64,42,26,15,65],"scope":"season","gid":"401873023"},{"id":"4683243","n":"Mitchell Evans","pos":"TE","ta":"CAR","mk":"rec_yds","lines":{"fanduel":6.5},"sample":[39,0,8,36,13,9],"scope":"season","gid":"401873023"},{"id":"4685350","n":"Trevor Etienne","pos":"RB","ta":"CAR","mk":"rush_yds","lines":{"fanduel":8.5},"sample":[8,-1],"scope":"season","gid":"401873023"},{"id":"4685472","n":"Tetairoa McMillan","pos":"WR","ta":"CAR","mk":"rec_yds","lines":{"draftkings":70.5,"fanduel":71.5,"hardrockbet":72.5},"sample":[40,86,192,17,101,75],"scope":"season","gid":"401873023"},{"id":"4685720","n":"Bryce Young","pos":"QB","ta":"CAR","mk":"pass_yds","lines":{"draftkings":252.5,"fanduel":252.5,"hardrockbet":255.5},"sample":[163,281,329,291,287,361],"scope":"season","gid":"401873023"},{"id":"4695883","n":"Jalen Coker","pos":"WR","ta":"CAR","mk":"rec_yds","lines":{"draftkings":62.5,"fanduel":62.5,"hardrockbet":62.5},"sample":[9,97,18,66,138],"scope":"season","gid":"401873023"},{"id":"4701936","n":"Matthew Golden","pos":"WR","ta":"GB","mk":"rec_yds","lines":{"draftkings":57.5,"fanduel":59.5,"hardrockbet":58.5},"sample":[39,104,123,21,100,58,95],"scope":"season","gid":"401873023"}]},"nba":{"season":2027,"boxGames":68,"through":"2026-10-29T02:30Z","cacheUpdated":"2026-10-29T05:16:08.061235+00:00","propsPulledAt":"2026-10-29T11:45:22Z","propsGames":9,"players":[{"id":"1966","n":"LeBron James","pos":"F","t":"20","ta":"PHI","gp":4,"pts":62,"reb":26,"ast":27,"tpm":3},{"id":"2490149","n":"CJ McCollum","pos":"G","t":"1","ta":"ATL","gp":5,"pts":82,"reb":8,"ast":10,"tpm":12},{"id":"2528210","n":"Tim Hardaway Jr.","pos":"G","t":"14","ta":"MIA","gp":5,"pts":35,"reb":13,"ast":4,"tpm":6},{"id":"2528426","n":"Jordan Clarkson","pos":"G","t":"18","ta":"NY","gp":4,"pts":22,"reb":6,"ast":2,"tpm":2},{"id":"2578185","n":"Dorian Finney-Smith","pos":"F","t":"1","ta":"ATL","gp":2,"pts":3,"reb":2,"ast":1,"tpm":1},{"id":"2580365","n":"Larry Nance Jr.","pos":"F","t":"11","ta":"IND","gp":5,"pts":13,"reb":14,"ast":2,"tpm":2},{"id":"2581018","n":"Kentavious Caldwell-Pope","pos":"G","t":"20","ta":"PHI","gp":5,"pts":36,"reb":14,"ast":8,"tpm":8},{"id":"2581184","n":"Anthony Gill","pos":"F","t":"27","ta":"WSH","gp":1,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"2583632","n":"Royce O'Neale","pos":"F","t":"30","ta":"CHA","gp":5,"pts":23,"reb":11,"ast":1,"tpm":7},{"id":"2595516","n":"Norman Powell","pos":"G","t":"4","ta":"CHI","gp":5,"pts":108,"reb":14,"ast":9,"tpm":15},{"id":"2596112","n":"Javonte Green","pos":"G","t":"8","ta":"DET","gp":5,"pts":36,"reb":13,"ast":2,"tpm":8},{"id":"2990962","n":"Taurean Prince","pos":"F","t":"8","ta":"DET","gp":2,"pts":4,"reb":2,"ast":0,"tpm":1},{"id":"2990969","n":"Georges Niang","pos":"F","t":"9","ta":"GS","gp":5,"pts":31,"reb":14,"ast":6,"tpm":4},{"id":"2990984","n":"Buddy Hield","pos":"G","t":"4","ta":"CHI","gp":5,"pts":27,"reb":9,"ast":8,"tpm":5},{"id":"2990992","n":"Marcus Smart","pos":"G","t":"10","ta":"HOU","gp":2,"pts":15,"reb":5,"ast":3,"tpm":2},{"id":"2991070","n":"Jerami Grant","pos":"F","t":"29","ta":"MEM","gp":4,"pts":39,"reb":10,"ast":9,"tpm":7},{"id":"2991139","n":"Kris Dunn","pos":"G","t":"12","ta":"LAC","gp":4,"pts":34,"reb":17,"ast":21,"tpm":5},{"id":"2991230","n":"Fred VanVleet","pos":"G","t":"10","ta":"HOU","gp":4,"pts":49,"reb":15,"ast":26,"tpm":9},{"id":"2991235","n":"Steven Adams","pos":"C","t":"10","ta":"HOU","gp":1,"pts":4,"reb":2,"ast":1,"tpm":0},{"id":"2991350","n":"Alex Caruso","pos":"G","t":"25","ta":"OKC","gp":4,"pts":37,"reb":19,"ast":15,"tpm":8},{"id":"2993874","n":"Kyle Anderson","pos":"F","t":"28","ta":"TOR","gp":3,"pts":0,"reb":3,"ast":3,"tpm":0},{"id":"2995706","n":"Mario Hezonja","pos":"F","t":"5","ta":"CLE","gp":4,"pts":27,"reb":14,"ast":6,"tpm":4},{"id":"3032976","n":"Rudy Gobert","pos":"C","t":"16","ta":"MIN","gp":5,"pts":33,"reb":60,"ast":5,"tpm":0},{"id":"3032977","n":"Giannis Antetokounmpo","pos":"F","t":"14","ta":"MIA","gp":5,"pts":138,"reb":57,"ast":23,"tpm":3},{"id":"3032979","n":"Dennis Schroder","pos":"G","t":"30","ta":"CHA","gp":5,"pts":70,"reb":20,"ast":23,"tpm":5},{"id":"3037789","n":"Bogdan Bogdanovic","pos":"G","t":"10","ta":"HOU","gp":5,"pts":40,"reb":7,"ast":8,"tpm":10},{"id":"3059318","n":"Joel Embiid","pos":"C","t":"20","ta":"PHI","gp":4,"pts":86,"reb":40,"ast":19,"tpm":3},{"id":"3059319","n":"Andrew Wiggins","pos":"F","t":"14","ta":"MIA","gp":5,"pts":53,"reb":16,"ast":7,"tpm":6},{"id":"3062679","n":"Josh Hart","pos":"G","t":"18","ta":"NY","gp":5,"pts":45,"reb":39,"ast":17,"tpm":9},{"id":"3064290","n":"Aaron Gordon","pos":"F","t":"7","ta":"DEN","gp":4,"pts":49,"reb":26,"ast":10,"tpm":6},{"id":"3064440","n":"Zach LaVine","pos":"G","t":"23","ta":"SAC","gp":4,"pts":109,"reb":14,"ast":13,"tpm":12},{"id":"3064482","n":"Bobby Portis","pos":"F","t":"14","ta":"MIA","gp":5,"pts":52,"reb":41,"ast":9,"tpm":10},{"id":"3064514","n":"Julius Randle","pos":"F","t":"17","ta":"BKN","gp":4,"pts":90,"reb":30,"ast":23,"tpm":5},{"id":"3064560","n":"Luke Kornet","pos":"C","t":"24","ta":"SA","gp":5,"pts":12,"reb":18,"ast":3,"tpm":0},{"id":"3078576","n":"Derrick White","pos":"G","t":"2","ta":"BOS","gp":4,"pts":50,"reb":16,"ast":24,"tpm":7},{"id":"3102529","n":"Clint Capela","pos":"C","t":"10","ta":"HOU","gp":4,"pts":14,"reb":16,"ast":3,"tpm":0},{"id":"3112335","n":"Nikola Jokic","pos":"C","t":"7","ta":"DEN","gp":4,"pts":88,"reb":42,"ast":36,"tpm":5},{"id":"3133602","n":"Svi Mykhailiuk","pos":"G","t":"26","ta":"UTAH","gp":5,"pts":18,"reb":11,"ast":4,"tpm":3},{"id":"3133603","n":"Kelly Oubre Jr.","pos":"G","t":"11","ta":"IND","gp":5,"pts":45,"reb":12,"ast":9,"tpm":4},{"id":"3133626","n":"Kenrich Williams","pos":"G","t":"25","ta":"OKC","gp":5,"pts":19,"reb":14,"ast":1,"tpm":4},{"id":"3133628","n":"Myles Turner","pos":"C","t":"15","ta":"MIL","gp":5,"pts":33,"reb":24,"ast":11,"tpm":4},{"id":"3133635","n":"Jevon Carter","pos":"G","t":"19","ta":"ORL","gp":2,"pts":6,"reb":1,"ast":4,"tpm":2},{"id":"3134903","n":"Gary Payton II","pos":"G","t":"9","ta":"GS","gp":5,"pts":28,"reb":8,"ast":1,"tpm":2},{"id":"3134907","n":"Kyle Kuzma","pos":"F","t":"15","ta":"MIL","gp":5,"pts":54,"reb":40,"ast":14,"tpm":7},{"id":"3134908","n":"Jakob Poeltl","pos":"C","t":"28","ta":"TOR","gp":4,"pts":11,"reb":18,"ast":2,"tpm":0},{"id":"3134916","n":"Jordan McLaughlin","pos":"G","t":"24","ta":"SA","gp":2,"pts":0,"reb":1,"ast":2,"tpm":0},{"id":"3135045","n":"Grayson Allen","pos":"G","t":"30","ta":"CHA","gp":5,"pts":76,"reb":15,"ast":15,"tpm":16},{"id":"3135046","n":"Tyus Jones","pos":"G","t":"7","ta":"DEN","gp":4,"pts":9,"reb":0,"ast":3,"tpm":1},{"id":"3136193","n":"Devin Booker","pos":"G","t":"21","ta":"PHX","gp":3,"pts":69,"reb":13,"ast":16,"tpm":2},{"id":"3136195","n":"Karl-Anthony Towns","pos":"C","t":"18","ta":"NY","gp":5,"pts":109,"reb":69,"ast":16,"tpm":9},{"id":"3136196","n":"Trey Lyles","pos":"F","t":"16","ta":"MIN","gp":5,"pts":23,"reb":17,"ast":6,"tpm":5},{"id":"3136777","n":"Jae'Sean Tate","pos":"F","t":"10","ta":"HOU","gp":4,"pts":0,"reb":1,"ast":0,"tpm":0},{"id":"3138160","n":"Caleb Martin","pos":"F","t":"6","ta":"DAL","gp":1,"pts":10,"reb":2,"ast":0,"tpm":2},{"id":"3138196","n":"Cameron Johnson","pos":"F","t":"7","ta":"DEN","gp":1,"pts":5,"reb":2,"ast":1,"tpm":1},{"id":"3146557","n":"Jock Landale","pos":"C","t":"1","ta":"ATL","gp":5,"pts":38,"reb":24,"ast":13,"tpm":1},{"id":"3147657","n":"Mikal Bridges","pos":"G","t":"18","ta":"NY","gp":5,"pts":25,"reb":12,"ast":10,"tpm":5},{"id":"3149673","n":"Pascal Siakam","pos":"F","t":"11","ta":"IND","gp":5,"pts":120,"reb":42,"ast":19,"tpm":8},{"id":"3150844","n":"Moritz Wagner","pos":"C","t":"17","ta":"BKN","gp":4,"pts":41,"reb":11,"ast":6,"tpm":6},{"id":"3155526","n":"Dillon Brooks","pos":"F","t":"21","ta":"PHX","gp":3,"pts":44,"reb":11,"ast":10,"tpm":5},{"id":"3155535","n":"Kevon Looney","pos":"F","t":"13","ta":"LAL","gp":4,"pts":8,"reb":8,"ast":1,"tpm":0},{"id":"3155942","n":"Domantas Sabonis","pos":"F","t":"23","ta":"SAC","gp":4,"pts":76,"reb":66,"ast":29,"tpm":1},{"id":"3157465","n":"Duncan Robinson","pos":"F","t":"8","ta":"DET","gp":5,"pts":84,"reb":8,"ast":11,"tpm":20},{"id":"3195","n":"Mike Conley","pos":"G","t":"2","ta":"BOS","gp":1,"pts":6,"reb":0,"ast":0,"tpm":2},{"id":"3202","n":"Kevin Durant","pos":"F","t":"10","ta":"HOU","gp":5,"pts":112,"reb":31,"ast":18,"tpm":10},{"id":"3213","n":"Al Horford","pos":"C","t":"9","ta":"GS","gp":4,"pts":18,"reb":17,"ast":4,"tpm":4},{"id":"3442","n":"DeAndre Jordan","pos":"C","t":"3","ta":"NO","gp":2,"pts":12,"reb":13,"ast":2,"tpm":0},{"id":"3448","n":"Brook Lopez","pos":"C","t":"12","ta":"LAC","gp":4,"pts":56,"reb":19,"ast":6,"tpm":6},{"id":"3899664","n":"Simone Fontecchio","pos":"F","t":"14","ta":"MIA","gp":2,"pts":0,"reb":1,"ast":0,"tpm":0},{"id":"3907497","n":"Dejounte Murray","pos":"G","t":"3","ta":"NO","gp":4,"pts":71,"reb":23,"ast":24,"tpm":3},{"id":"3907498","n":"Matisse Thybulle","pos":"G","t":"13","ta":"LAL","gp":5,"pts":47,"reb":8,"ast":5,"tpm":12},{"id":"3908809","n":"Donovan Mitchell","pos":"G","t":"5","ta":"CLE","gp":4,"pts":99,"reb":25,"ast":21,"tpm":11},{"id":"3908845","n":"John Collins","pos":"F","t":"8","ta":"DET","gp":5,"pts":51,"reb":34,"ast":3,"tpm":7},{"id":"3912848","n":"Dean Wade","pos":"F","t":"20","ta":"PHI","gp":3,"pts":14,"reb":8,"ast":2,"tpm":3},{"id":"3913174","n":"Luke Kennard","pos":"G","t":"21","ta":"PHX","gp":2,"pts":20,"reb":5,"ast":3,"tpm":6},{"id":"3914044","n":"Landry Shamet","pos":"G","t":"18","ta":"NY","gp":5,"pts":46,"reb":9,"ast":13,"tpm":12},{"id":"3917376","n":"Jaylen Brown","pos":"G","t":"20","ta":"PHI","gp":5,"pts":103,"reb":33,"ast":21,"tpm":9},{"id":"3934672","n":"Jalen Brunson","pos":"G","t":"18","ta":"NY","gp":5,"pts":129,"reb":12,"ast":25,"tpm":10},{"id":"3934719","n":"OG Anunoby","pos":"F","t":"18","ta":"NY","gp":5,"pts":88,"reb":31,"ast":13,"tpm":9},{"id":"3936099","n":"Derrick Jones Jr.","pos":"F","t":"12","ta":"LAC","gp":4,"pts":50,"reb":21,"ast":7,"tpm":10},{"id":"3936299","n":"Jamal Murray","pos":"G","t":"7","ta":"DEN","gp":4,"pts":90,"reb":20,"ast":23,"tpm":16},{"id":"3945274","n":"Luka Doncic","pos":"G","t":"13","ta":"LAL","gp":4,"pts":144,"reb":27,"ast":33,"tpm":21},{"id":"3975","n":"Stephen Curry","pos":"G","t":"9","ta":"GS","gp":4,"pts":115,"reb":15,"ast":14,"tpm":14},{"id":"3978","n":"DeMar DeRozan","pos":"G","t":"7","ta":"DEN","gp":4,"pts":52,"reb":11,"ast":10,"tpm":2},{"id":"3992","n":"James Harden","pos":"G","t":"5","ta":"CLE","gp":4,"pts":66,"reb":17,"ast":27,"tpm":10},{"id":"3995","n":"Jrue Holiday","pos":"G","t":"22","ta":"POR","gp":3,"pts":42,"reb":9,"ast":12,"tpm":5},{"id":"4017837","n":"Ivica Zubac","pos":"C","t":"11","ta":"IND","gp":3,"pts":27,"reb":27,"ast":4,"tpm":0},{"id":"4065648","n":"Jayson Tatum","pos":"F","t":"2","ta":"BOS","gp":4,"pts":112,"reb":25,"ast":32,"tpm":7},{"id":"4065663","n":"Josh Okogie","pos":"G","t":"26","ta":"UTAH","gp":4,"pts":7,"reb":14,"ast":5,"tpm":1},{"id":"4065673","n":"Tony Bradley","pos":"C","t":"26","ta":"UTAH","gp":1,"pts":2,"reb":1,"ast":0,"tpm":0},{"id":"4065731","n":"Jay Huff","pos":"C","t":"11","ta":"IND","gp":4,"pts":23,"reb":16,"ast":6,"tpm":3},{"id":"4065732","n":"De'Andre Hunter","pos":"F","t":"23","ta":"SAC","gp":4,"pts":41,"reb":22,"ast":5,"tpm":9},{"id":"4065733","n":"Ty Jerome","pos":"G","t":"29","ta":"MEM","gp":4,"pts":119,"reb":14,"ast":25,"tpm":10},{"id":"4065804","n":"Sam Hauser","pos":"F","t":"2","ta":"BOS","gp":4,"pts":39,"reb":14,"ast":4,"tpm":11},{"id":"4065813","n":"Alpha Diallo","pos":"F","t":"7","ta":"DEN","gp":1,"pts":4,"reb":2,"ast":3,"tpm":0},{"id":"4066211","n":"Robert Williams III","pos":"C","t":"22","ta":"POR","gp":3,"pts":29,"reb":26,"ast":2,"tpm":0},{"id":"4066259","n":"De'Aaron Fox","pos":"G","t":"24","ta":"SA","gp":5,"pts":77,"reb":21,"ast":35,"tpm":7},{"id":"4066261","n":"Bam Adebayo","pos":"C","t":"14","ta":"MIA","gp":5,"pts":71,"reb":38,"ast":17,"tpm":3},{"id":"4066262","n":"Malik Monk","pos":"G","t":"23","ta":"SAC","gp":3,"pts":9,"reb":4,"ast":10,"tpm":1},{"id":"4066268","n":"Duop Reath","pos":"C","t":"21","ta":"PHX","gp":3,"pts":10,"reb":4,"ast":0,"tpm":2},{"id":"4066320","n":"Desmond Bane","pos":"G","t":"19","ta":"ORL","gp":4,"pts":58,"reb":18,"ast":8,"tpm":10},{"id":"4066328","n":"Jarrett Allen","pos":"C","t":"5","ta":"CLE","gp":4,"pts":53,"reb":36,"ast":4,"tpm":1},{"id":"4066336","n":"Lauri Markkanen","pos":"F","t":"26","ta":"UTAH","gp":4,"pts":64,"reb":22,"ast":7,"tpm":10},{"id":"4066354","n":"Payton Pritchard","pos":"G","t":"2","ta":"BOS","gp":4,"pts":53,"reb":8,"ast":15,"tpm":10},{"id":"4066372","n":"Kevin Huerter","pos":"G","t":"8","ta":"DET","gp":5,"pts":27,"reb":15,"ast":9,"tpm":5},{"id":"4066383","n":"Miles Bridges","pos":"F","t":"21","ta":"PHX","gp":3,"pts":41,"reb":19,"ast":7,"tpm":4},{"id":"4066399","n":"Micah Potter","pos":"C","t":"22","ta":"POR","gp":1,"pts":4,"reb":3,"ast":0,"tpm":0},{"id":"4066436","n":"De'Anthony Melton","pos":"G","t":"9","ta":"GS","gp":5,"pts":46,"reb":18,"ast":10,"tpm":9},{"id":"4066457","n":"Austin Reaves","pos":"G","t":"13","ta":"LAL","gp":5,"pts":122,"reb":17,"ast":27,"tpm":13},{"id":"4066648","n":"Rui Hachimura","pos":"F","t":"12","ta":"LAC","gp":3,"pts":31,"reb":18,"ast":3,"tpm":6},{"id":"4066650","n":"Zach Collins","pos":"F","t":"4","ta":"CHI","gp":3,"pts":4,"reb":10,"ast":1,"tpm":0},{"id":"4066757","n":"Sam Merrill","pos":"G","t":"5","ta":"CLE","gp":4,"pts":29,"reb":12,"ast":7,"tpm":5},{"id":"4066993","n":"Dru Smith","pos":"G","t":"14","ta":"MIA","gp":3,"pts":12,"reb":2,"ast":5,"tpm":3},{"id":"4222252","n":"Isaiah Hartenstein","pos":"C","t":"25","ta":"OKC","gp":5,"pts":47,"reb":48,"ast":12,"tpm":0},{"id":"4251","n":"Paul George","pos":"F","t":"2","ta":"BOS","gp":4,"pts":89,"reb":24,"ast":14,"tpm":14},{"id":"4277811","n":"Collin Sexton","pos":"G","t":"13","ta":"LAL","gp":4,"pts":48,"reb":8,"ast":9,"tpm":6},{"id":"4277813","n":"Herbert Jones","pos":"F","t":"3","ta":"NO","gp":4,"pts":14,"reb":8,"ast":1,"tpm":2},{"id":"4277843","n":"Gary Trent Jr.","pos":"G","t":"15","ta":"MIL","gp":1,"pts":3,"reb":0,"ast":0,"tpm":1},{"id":"4277847","n":"Wendell Carter Jr.","pos":"C","t":"19","ta":"ORL","gp":4,"pts":54,"reb":36,"ast":6,"tpm":4},{"id":"4277848","n":"Marvin Bagley III","pos":"F","t":"7","ta":"DEN","gp":4,"pts":22,"reb":14,"ast":2,"tpm":0},{"id":"4277869","n":"Jose Alvarado","pos":"G","t":"18","ta":"NY","gp":2,"pts":10,"reb":5,"ast":5,"tpm":2},{"id":"4277905","n":"Trae Young","pos":"G","t":"27","ta":"WSH","gp":5,"pts":103,"reb":16,"ast":52,"tpm":10},{"id":"4277919","n":"Mo Bamba","pos":"C","t":"26","ta":"UTAH","gp":2,"pts":22,"reb":11,"ast":2,"tpm":0},{"id":"4277922","n":"Jericho Sims","pos":"C","t":"15","ta":"MIL","gp":2,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"4277951","n":"Luka Garza","pos":"C","t":"2","ta":"BOS","gp":4,"pts":18,"reb":10,"ast":2,"tpm":2},{"id":"4277956","n":"Jordan Poole","pos":"G","t":"3","ta":"NO","gp":4,"pts":24,"reb":8,"ast":12,"tpm":3},{"id":"4277961","n":"Jaren Jackson Jr.","pos":"F","t":"26","ta":"UTAH","gp":4,"pts":65,"reb":20,"ast":8,"tpm":5},{"id":"4278039","n":"Nickeil Alexander-Walker","pos":"G","t":"1","ta":"ATL","gp":5,"pts":98,"reb":17,"ast":16,"tpm":18},{"id":"4278049","n":"Daniel Gafford","pos":"F","t":"6","ta":"DAL","gp":5,"pts":33,"reb":34,"ast":13,"tpm":1},{"id":"4278053","n":"Davion Mitchell","pos":"G","t":"14","ta":"MIA","gp":5,"pts":82,"reb":4,"ast":38,"tpm":9},{"id":"4278073","n":"Shai Gilgeous-Alexander","pos":"G","t":"25","ta":"OKC","gp":5,"pts":130,"reb":23,"ast":17,"tpm":9},{"id":"4278076","n":"Nick Richards","pos":"C","t":"14","ta":"MIA","gp":2,"pts":7,"reb":1,"ast":1,"tpm":1},{"id":"4278077","n":"Jarred Vanderbilt","pos":"F","t":"13","ta":"LAL","gp":1,"pts":0,"reb":7,"ast":2,"tpm":0},{"id":"4278078","n":"P.J. Washington","pos":"F","t":"6","ta":"DAL","gp":5,"pts":80,"reb":39,"ast":6,"tpm":10},{"id":"4278104","n":"Michael Porter Jr.","pos":"F","t":"17","ta":"BKN","gp":4,"pts":91,"reb":28,"ast":4,"tpm":15},{"id":"4278129","n":"Deandre Ayton","pos":"C","t":"27","ta":"WSH","gp":5,"pts":31,"reb":22,"ast":3,"tpm":0},{"id":"4278355","n":"Obi Toppin","pos":"F","t":"11","ta":"IND","gp":5,"pts":76,"reb":26,"ast":6,"tpm":11},{"id":"4278402","n":"Jordan Goodwin","pos":"G","t":"21","ta":"PHX","gp":3,"pts":24,"reb":10,"ast":6,"tpm":6},{"id":"4278562","n":"Paul Reed","pos":"F","t":"8","ta":"DET","gp":5,"pts":71,"reb":38,"ast":10,"tpm":5},{"id":"4278572","n":"Jamal Cain","pos":"F","t":"19","ta":"ORL","gp":4,"pts":14,"reb":7,"ast":0,"tpm":1},{"id":"4278580","n":"Sandro Mamukelashvili","pos":"F","t":"13","ta":"LAL","gp":5,"pts":51,"reb":24,"ast":9,"tpm":5},{"id":"4278585","n":"Collin Gillespie","pos":"G","t":"21","ta":"PHX","gp":3,"pts":20,"reb":6,"ast":13,"tpm":5},{"id":"4278594","n":"Naji Marshall","pos":"F","t":"6","ta":"DAL","gp":3,"pts":41,"reb":10,"ast":17,"tpm":3},{"id":"4279318","n":"Daeqwon Plowden","pos":"G","t":"23","ta":"SAC","gp":4,"pts":10,"reb":7,"ast":2,"tpm":2},{"id":"4279888","n":"Ja Morant","pos":"G","t":"22","ta":"POR","gp":3,"pts":49,"reb":8,"ast":19,"tpm":4},{"id":"4280151","n":"Corey Kispert","pos":"F","t":"1","ta":"ATL","gp":2,"pts":16,"reb":1,"ast":1,"tpm":4},{"id":"4280245","n":"Jamaree Bouyea","pos":"G","t":"21","ta":"PHX","gp":2,"pts":5,"reb":2,"ast":3,"tpm":0},{"id":"4348700","n":"Goga Bitadze","pos":"C","t":"19","ta":"ORL","gp":3,"pts":16,"reb":9,"ast":2,"tpm":0},{"id":"4351851","n":"Anfernee Simons","pos":"G","t":"20","ta":"PHI","gp":5,"pts":44,"reb":12,"ast":6,"tpm":11},{"id":"4351852","n":"Mitchell Robinson","pos":"C","t":"2","ta":"BOS","gp":4,"pts":22,"reb":19,"ast":3,"tpm":0},{"id":"4395625","n":"RJ Barrett","pos":"F","t":"28","ta":"TOR","gp":4,"pts":88,"reb":24,"ast":15,"tpm":4},{"id":"4395626","n":"Tre Jones","pos":"G","t":"4","ta":"CHI","gp":5,"pts":53,"reb":13,"ast":14,"tpm":2},{"id":"4395628","n":"Zion Williamson","pos":"F","t":"3","ta":"NO","gp":4,"pts":87,"reb":14,"ast":9,"tpm":3},{"id":"4395630","n":"Devin Vassell","pos":"G","t":"24","ta":"SA","gp":5,"pts":63,"reb":20,"ast":19,"tpm":9},{"id":"4395650","n":"Leaky Black","pos":"F","t":"23","ta":"SAC","gp":2,"pts":2,"reb":1,"ast":1,"tpm":0},{"id":"4395702","n":"Isaiah Joe","pos":"G","t":"8","ta":"DET","gp":3,"pts":22,"reb":5,"ast":3,"tpm":3},{"id":"4395712","n":"Andrew Nembhard","pos":"G","t":"11","ta":"IND","gp":4,"pts":66,"reb":8,"ast":31,"tpm":6},{"id":"4395723","n":"Keldon Johnson","pos":"F","t":"24","ta":"SA","gp":5,"pts":48,"reb":26,"ast":7,"tpm":1},{"id":"4395724","n":"Immanuel Quickley","pos":"G","t":"28","ta":"TOR","gp":4,"pts":70,"reb":11,"ast":22,"tpm":11},{"id":"4395725","n":"Tyler Herro","pos":"G","t":"15","ta":"MIL","gp":5,"pts":117,"reb":26,"ast":23,"tpm":17},{"id":"4396907","n":"Darius Garland","pos":"G","t":"12","ta":"LAC","gp":4,"pts":86,"reb":6,"ast":26,"tpm":10},{"id":"4396909","n":"Aaron Nesmith","pos":"G","t":"11","ta":"IND","gp":4,"pts":53,"reb":7,"ast":5,"tpm":9},{"id":"4396971","n":"Naz Reid","pos":"C","t":"30","ta":"CHA","gp":5,"pts":85,"reb":44,"ast":10,"tpm":15},{"id":"4396993","n":"Tyrese Haliburton","pos":"G","t":"11","ta":"IND","gp":4,"pts":87,"reb":18,"ast":38,"tpm":10},{"id":"4397002","n":"Ayo Dosunmu","pos":"G","t":"16","ta":"MIN","gp":5,"pts":65,"reb":19,"ast":21,"tpm":7},{"id":"4397014","n":"Quentin Grimes","pos":"G","t":"13","ta":"LAL","gp":5,"pts":51,"reb":18,"ast":14,"tpm":3},{"id":"4397020","n":"Luguentz Dort","pos":"G","t":"1","ta":"ATL","gp":5,"pts":43,"reb":16,"ast":9,"tpm":6},{"id":"4397040","n":"Brandon Williams","pos":"G","t":"9","ta":"GS","gp":5,"pts":55,"reb":16,"ast":13,"tpm":5},{"id":"4397077","n":"Jaxson Hayes","pos":"C","t":"26","ta":"UTAH","gp":4,"pts":33,"reb":26,"ast":10,"tpm":0},{"id":"4397136","n":"Saddiq Bey","pos":"G","t":"3","ta":"NO","gp":4,"pts":56,"reb":12,"ast":7,"tpm":8},{"id":"4397183","n":"Aaron Wiggins","pos":"G","t":"1","ta":"ATL","gp":5,"pts":73,"reb":17,"ast":9,"tpm":14},{"id":"4397189","n":"Jalen Smith","pos":"F","t":"4","ta":"CHI","gp":5,"pts":67,"reb":41,"ast":9,"tpm":9},{"id":"4397204","n":"Colin Castleton","pos":"C","t":"19","ta":"ORL","gp":2,"pts":9,"reb":4,"ast":1,"tpm":0},{"id":"4397251","n":"Ron Harper Jr.","pos":"G","t":"2","ta":"BOS","gp":1,"pts":3,"reb":1,"ast":0,"tpm":1},{"id":"4397424","n":"Neemias Queta","pos":"C","t":"2","ta":"BOS","gp":4,"pts":32,"reb":18,"ast":6,"tpm":1},{"id":"4397449","n":"Elijah Harkless","pos":"G","t":"8","ta":"DET","gp":1,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"4397475","n":"AJ Green","pos":"G","t":"15","ta":"MIL","gp":5,"pts":40,"reb":9,"ast":6,"tpm":12},{"id":"4397688","n":"Trey Murphy III","pos":"F","t":"3","ta":"NO","gp":4,"pts":52,"reb":17,"ast":11,"tpm":9},{"id":"4397882","n":"Tolu Smith","pos":"F","t":"8","ta":"DET","gp":4,"pts":3,"reb":7,"ast":0,"tpm":0},{"id":"4397886","n":"Charles Bassey","pos":"C","t":"9","ta":"GS","gp":3,"pts":10,"reb":8,"ast":0,"tpm":0},{"id":"4398207","n":"Jalen Slawson","pos":"F","t":"11","ta":"IND","gp":4,"pts":9,"reb":9,"ast":3,"tpm":0},{"id":"4398390","n":"Jalen Pickett","pos":"G","t":"12","ta":"LAC","gp":2,"pts":7,"reb":1,"ast":1,"tpm":1},{"id":"4431671","n":"Jaden McDaniels","pos":"F","t":"16","ta":"MIN","gp":5,"pts":79,"reb":34,"ast":15,"tpm":7},{"id":"4431678","n":"Tyrese Maxey","pos":"G","t":"20","ta":"PHI","gp":5,"pts":142,"reb":21,"ast":23,"tpm":12},{"id":"4431679","n":"Precious Achiuwa","pos":"F","t":"23","ta":"SAC","gp":4,"pts":45,"reb":22,"ast":3,"tpm":1},{"id":"4431680","n":"Onyeka Okongwu","pos":"F","t":"1","ta":"ATL","gp":5,"pts":48,"reb":28,"ast":15,"tpm":4},{"id":"4431684","n":"Trayce Jackson-Davis","pos":"F","t":"28","ta":"TOR","gp":4,"pts":18,"reb":13,"ast":3,"tpm":0},{"id":"4431690","n":"Zeke Nnaji","pos":"F","t":"7","ta":"DEN","gp":1,"pts":5,"reb":1,"ast":0,"tpm":1},{"id":"4431736","n":"Toumani Camara","pos":"F","t":"22","ta":"POR","gp":3,"pts":49,"reb":6,"ast":5,"tpm":13},{"id":"4431752","n":"Kobe Brown","pos":"G","t":"11","ta":"IND","gp":2,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"4431767","n":"Christian Braun","pos":"G","t":"7","ta":"DEN","gp":4,"pts":46,"reb":18,"ast":9,"tpm":5},{"id":"4431772","n":"Myron Gardner","pos":"F","t":"14","ta":"MIA","gp":2,"pts":4,"reb":2,"ast":0,"tpm":0},{"id":"4431785","n":"Scotty Pippen Jr.","pos":"G","t":"29","ta":"MEM","gp":4,"pts":30,"reb":12,"ast":11,"tpm":2},{"id":"4431823","n":"Miles McBride","pos":"G","t":"18","ta":"NY","gp":5,"pts":32,"reb":10,"ast":4,"tpm":9},{"id":"4431893","n":"Jamison Battle","pos":"F","t":"28","ta":"TOR","gp":4,"pts":24,"reb":6,"ast":3,"tpm":5},{"id":"4432107","n":"Marcus Sasser","pos":"G","t":"6","ta":"DAL","gp":5,"pts":45,"reb":8,"ast":13,"tpm":9},{"id":"4432158","n":"Evan Mobley","pos":"C","t":"5","ta":"CLE","gp":4,"pts":80,"reb":38,"ast":11,"tpm":12},{"id":"4432165","n":"Jalen Suggs","pos":"G","t":"19","ta":"ORL","gp":3,"pts":24,"reb":15,"ast":17,"tpm":1},{"id":"4432166","n":"Cade Cunningham","pos":"G","t":"8","ta":"DET","gp":5,"pts":113,"reb":28,"ast":39,"tpm":12},{"id":"4432170","n":"Isaiah Jackson","pos":"F","t":"12","ta":"LAC","gp":4,"pts":33,"reb":22,"ast":8,"tpm":0},{"id":"4432185","n":"Micah Peavy","pos":"G","t":"25","ta":"OKC","gp":1,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"4432187","n":"Reece Beekman","pos":"G","t":"27","ta":"WSH","gp":1,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"4432194","n":"Day'Ron Sharpe","pos":"C","t":"17","ta":"BKN","gp":4,"pts":30,"reb":26,"ast":5,"tpm":2},{"id":"4432241","n":"Jamal Shead","pos":"G","t":"28","ta":"TOR","gp":4,"pts":24,"reb":9,"ast":17,"tpm":1},{"id":"4432247","n":"Jaylen Clark","pos":"G","t":"16","ta":"MIN","gp":4,"pts":7,"reb":6,"ast":3,"tpm":1},{"id":"4432446","n":"Jabari Walker","pos":"F","t":"20","ta":"PHI","gp":3,"pts":8,"reb":4,"ast":2,"tpm":0},{"id":"4432573","n":"Paolo Banchero","pos":"F","t":"19","ta":"ORL","gp":2,"pts":49,"reb":13,"ast":15,"tpm":3},{"id":"4432582","n":"Max Christie","pos":"G","t":"6","ta":"DAL","gp":5,"pts":48,"reb":22,"ast":12,"tpm":10},{"id":"4432639","n":"Jabari Smith Jr.","pos":"F","t":"10","ta":"HOU","gp":5,"pts":81,"reb":29,"ast":12,"tpm":12},{"id":"4432737","n":"Jaden Bradley","pos":"G","t":"28","ta":"TOR","gp":4,"pts":6,"reb":2,"ast":2,"tpm":0},{"id":"4432808","n":"James Wiseman","pos":"C","t":"18","ta":"NY","gp":3,"pts":0,"reb":3,"ast":0,"tpm":0},{"id":"4432810","n":"Isaiah Stewart","pos":"C","t":"29","ta":"MEM","gp":3,"pts":21,"reb":11,"ast":2,"tpm":2},{"id":"4432811","n":"Josh Green","pos":"G","t":"26","ta":"UTAH","gp":3,"pts":8,"reb":6,"ast":4,"tpm":1},{"id":"4432816","n":"LaMelo Ball","pos":"G","t":"16","ta":"MIN","gp":5,"pts":67,"reb":12,"ast":33,"tpm":14},{"id":"4432819","n":"Tre Mann","pos":"G","t":"27","ta":"WSH","gp":1,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"4432822","n":"Isaac Okoro","pos":"F","t":"4","ta":"CHI","gp":5,"pts":24,"reb":5,"ast":7,"tpm":2},{"id":"4432823","n":"Jaylin Williams","pos":"F","t":"25","ta":"OKC","gp":5,"pts":14,"reb":22,"ast":8,"tpm":4},{"id":"4432827","n":"Oscar Tshiebwe","pos":"C","t":"10","ta":"HOU","gp":1,"pts":7,"reb":5,"ast":2,"tpm":0},{"id":"4432847","n":"Terrence Shannon Jr.","pos":"G","t":"16","ta":"MIN","gp":5,"pts":71,"reb":19,"ast":12,"tpm":11},{"id":"4432848","n":"Jaime Jaquez Jr.","pos":"F","t":"15","ta":"MIL","gp":5,"pts":89,"reb":36,"ast":13,"tpm":8},{"id":"4432907","n":"Justin Champagnie","pos":"F","t":"27","ta":"WSH","gp":4,"pts":29,"reb":30,"ast":5,"tpm":2},{"id":"4433076","n":"Ben Sheppard","pos":"G","t":"11","ta":"IND","gp":1,"pts":3,"reb":1,"ast":0,"tpm":1},{"id":"4433083","n":"Cam Spencer","pos":"G","t":"29","ta":"MEM","gp":4,"pts":35,"reb":12,"ast":9,"tpm":9},{"id":"4433134","n":"Scottie Barnes","pos":"F","t":"28","ta":"TOR","gp":4,"pts":79,"reb":29,"ast":17,"tpm":2},{"id":"4433136","n":"Walker Kessler","pos":"C","t":"13","ta":"LAL","gp":5,"pts":74,"reb":41,"ast":5,"tpm":0},{"id":"4433137","n":"Ziaire Williams","pos":"F","t":"13","ta":"LAL","gp":4,"pts":45,"reb":12,"ast":9,"tpm":7},{"id":"4433144","n":"Caleb Love","pos":"G","t":"20","ta":"PHI","gp":1,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"4433149","n":"LJ Cryer","pos":"G","t":"9","ta":"GS","gp":3,"pts":18,"reb":2,"ast":6,"tpm":5},{"id":"4433192","n":"Tari Eason","pos":"F","t":"10","ta":"HOU","gp":5,"pts":51,"reb":27,"ast":3,"tpm":2},{"id":"4433225","n":"Tyler Kolek","pos":"G","t":"18","ta":"NY","gp":3,"pts":11,"reb":6,"ast":21,"tpm":3},{"id":"4433247","n":"Jonathan Kuminga","pos":"F","t":"16","ta":"MIN","gp":5,"pts":66,"reb":25,"ast":15,"tpm":10},{"id":"4433249","n":"Moussa Diabate","pos":"F","t":"30","ta":"CHA","gp":5,"pts":46,"reb":47,"ast":11,"tpm":0},{"id":"4433255","n":"Chet Holmgren","pos":"C","t":"25","ta":"OKC","gp":3,"pts":36,"reb":28,"ast":4,"tpm":2},{"id":"4433287","n":"Brandon Miller","pos":"F","t":"30","ta":"CHA","gp":5,"pts":128,"reb":31,"ast":9,"tpm":15},{"id":"4433607","n":"DaRon Holmes II","pos":"F","t":"7","ta":"DEN","gp":2,"pts":3,"reb":1,"ast":2,"tpm":1},{"id":"4433621","n":"Jalen Duren","pos":"C","t":"8","ta":"DET","gp":2,"pts":26,"reb":15,"ast":4,"tpm":0},{"id":"4433627","n":"Keyonte George","pos":"G","t":"26","ta":"UTAH","gp":5,"pts":122,"reb":20,"ast":34,"tpm":14},{"id":"4433629","n":"Ryan Nembhard","pos":"G","t":"7","ta":"DEN","gp":2,"pts":9,"reb":1,"ast":2,"tpm":1},{"id":"4437244","n":"Jalen Green","pos":"G","t":"21","ta":"PHX","gp":3,"pts":42,"reb":8,"ast":8,"tpm":4},{"id":"4565698","n":"Bryce Hopkins","pos":"F","t":"7","ta":"DEN","gp":4,"pts":15,"reb":8,"ast":2,"tpm":1},{"id":"4566434","n":"Franz Wagner","pos":"F","t":"19","ta":"ORL","gp":4,"pts":78,"reb":29,"ast":24,"tpm":3},{"id":"4576060","n":"Ryan Kalkbrenner","pos":"C","t":"30","ta":"CHA","gp":5,"pts":23,"reb":22,"ast":8,"tpm":0},{"id":"4576086","n":"Bryce McGowens","pos":"G","t":"3","ta":"NO","gp":1,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"4576087","n":"Peyton Watson","pos":"G","t":"5","ta":"CLE","gp":4,"pts":56,"reb":18,"ast":9,"tpm":3},{"id":"4578893","n":"Vit Krejci","pos":"G","t":"22","ta":"POR","gp":3,"pts":5,"reb":4,"ast":3,"tpm":1},{"id":"4591725","n":"Ryan Rollins","pos":"G","t":"15","ta":"MIL","gp":5,"pts":58,"reb":23,"ast":22,"tpm":8},{"id":"4592479","n":"Julian Champagnie","pos":"F","t":"24","ta":"SA","gp":5,"pts":58,"reb":17,"ast":7,"tpm":17},{"id":"4592492","n":"Bones Hyland","pos":"G","t":"16","ta":"MIN","gp":5,"pts":22,"reb":7,"ast":7,"tpm":5},{"id":"4592691","n":"Jake LaRavia","pos":"F","t":"13","ta":"LAL","gp":4,"pts":17,"reb":17,"ast":4,"tpm":3},{"id":"4592714","n":"Pat Spencer","pos":"G","t":"21","ta":"PHX","gp":1,"pts":3,"reb":3,"ast":1,"tpm":1},{"id":"4592829","n":"Quenton Jackson","pos":"G","t":"11","ta":"IND","gp":5,"pts":25,"reb":10,"ast":16,"tpm":1},{"id":"4592857","n":"Isaiah Crawford","pos":"F","t":"10","ta":"HOU","gp":4,"pts":6,"reb":0,"ast":0,"tpm":2},{"id":"4592979","n":"Zyon Pullin","pos":"G","t":"16","ta":"MIN","gp":1,"pts":2,"reb":1,"ast":0,"tpm":0},{"id":"4593016","n":"Quinten Post","pos":"C","t":"29","ta":"MEM","gp":4,"pts":28,"reb":9,"ast":3,"tpm":3},{"id":"4593034","n":"Alex Morales","pos":"G","t":"19","ta":"ORL","gp":2,"pts":2,"reb":3,"ast":1,"tpm":0},{"id":"4593803","n":"Jalen Williams","pos":"G","t":"25","ta":"OKC","gp":3,"pts":41,"reb":14,"ast":10,"tpm":3},{"id":"4593841","n":"Baylor Scheierman","pos":"G","t":"2","ta":"BOS","gp":4,"pts":15,"reb":13,"ast":3,"tpm":3},{"id":"4594268","n":"Anthony Edwards","pos":"G","t":"16","ta":"MIN","gp":4,"pts":133,"reb":19,"ast":14,"tpm":18},{"id":"4594326","n":"Kris Murray","pos":"F","t":"29","ta":"MEM","gp":1,"pts":0,"reb":3,"ast":1,"tpm":0},{"id":"4594327","n":"Keegan Murray","pos":"F","t":"23","ta":"SAC","gp":2,"pts":14,"reb":6,"ast":1,"tpm":0},{"id":"4600663","n":"Zach Edey","pos":"C","t":"29","ta":"MEM","gp":3,"pts":18,"reb":22,"ast":5,"tpm":0},{"id":"4601023","n":"Oso Ighodaro","pos":"F","t":"21","ta":"PHX","gp":1,"pts":8,"reb":3,"ast":3,"tpm":0},{"id":"4601025","n":"Pelle Larsson","pos":"G","t":"14","ta":"MIA","gp":5,"pts":53,"reb":19,"ast":21,"tpm":5},{"id":"4602025","n":"Sion James","pos":"G","t":"30","ta":"CHA","gp":5,"pts":16,"reb":14,"ast":16,"tpm":4},{"id":"4683021","n":"Deni Avdija","pos":"F","t":"22","ta":"POR","gp":3,"pts":67,"reb":21,"ast":19,"tpm":7},{"id":"4683634","n":"Bennedict Mathurin","pos":"G","t":"3","ta":"NO","gp":4,"pts":29,"reb":10,"ast":8,"tpm":2},{"id":"4683678","n":"Scoot Henderson","pos":"G","t":"22","ta":"POR","gp":3,"pts":21,"reb":5,"ast":6,"tpm":1},{"id":"4683689","n":"Jordan Walsh","pos":"G","t":"2","ta":"BOS","gp":4,"pts":24,"reb":18,"ast":4,"tpm":4},{"id":"4683692","n":"Cason Wallace","pos":"G","t":"25","ta":"OKC","gp":3,"pts":19,"reb":7,"ast":4,"tpm":3},{"id":"4683730","n":"Jaden Akins","pos":"G","t":"18","ta":"NY","gp":2,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"4683747","n":"Jaylon Tyson","pos":"G","t":"5","ta":"CLE","gp":4,"pts":36,"reb":12,"ast":13,"tpm":4},{"id":"4683750","n":"Jordan Hawkins","pos":"G","t":"4","ta":"CHI","gp":1,"pts":4,"reb":1,"ast":0,"tpm":0},{"id":"4683766","n":"Isaiah Collier","pos":"G","t":"26","ta":"UTAH","gp":5,"pts":37,"reb":23,"ast":30,"tpm":0},{"id":"4683771","n":"Ronald Holland II","pos":"F","t":"8","ta":"DET","gp":5,"pts":14,"reb":20,"ast":12,"tpm":0},{"id":"4683774","n":"Bronny James","pos":"G","t":"13","ta":"LAL","gp":1,"pts":2,"reb":0,"ast":0,"tpm":0},{"id":"4683778","n":"Jared McCain","pos":"G","t":"25","ta":"OKC","gp":5,"pts":55,"reb":10,"ast":11,"tpm":11},{"id":"4684208","n":"Brooks Barnhizer","pos":"F","t":"25","ta":"OKC","gp":4,"pts":3,"reb":2,"ast":1,"tpm":0},{"id":"4684272","n":"Ja'Kobe Walter","pos":"G","t":"28","ta":"TOR","gp":4,"pts":53,"reb":16,"ast":10,"tpm":11},{"id":"4684740","n":"Amen Thompson","pos":"G","t":"10","ta":"HOU","gp":5,"pts":91,"reb":40,"ast":19,"tpm":2},{"id":"4684742","n":"Ausar Thompson","pos":"G","t":"8","ta":"DET","gp":4,"pts":33,"reb":29,"ast":20,"tpm":0},{"id":"4684793","n":"Kyle Filipowski","pos":"F","t":"26","ta":"UTAH","gp":3,"pts":3,"reb":2,"ast":0,"tpm":0},{"id":"4684806","n":"Taylor Hendricks","pos":"F","t":"29","ta":"MEM","gp":1,"pts":0,"reb":1,"ast":0,"tpm":0},{"id":"4687718","n":"Josh Minott","pos":"F","t":"17","ta":"BKN","gp":3,"pts":19,"reb":10,"ast":2,"tpm":3},{"id":"4698719","n":"Trevon Brazile","pos":"F","t":"7","ta":"DEN","gp":4,"pts":38,"reb":30,"ast":0,"tpm":5},{"id":"4700852","n":"Chaz Lanier","pos":"G","t":"8","ta":"DET","gp":1,"pts":2,"reb":0,"ast":0,"tpm":0},{"id":"4701208","n":"Moussa Cisse","pos":"C","t":"6","ta":"DAL","gp":4,"pts":10,"reb":5,"ast":0,"tpm":0},{"id":"4701225","n":"PJ Hall","pos":"C","t":"30","ta":"CHA","gp":1,"pts":0,"reb":1,"ast":3,"tpm":0},{"id":"4701230","n":"Jalen Johnson","pos":"F","t":"1","ta":"ATL","gp":5,"pts":98,"reb":48,"ast":45,"tpm":5},{"id":"4701233","n":"Craig Porter Jr.","pos":"G","t":"5","ta":"CLE","gp":2,"pts":3,"reb":4,"ast":1,"tpm":1},{"id":"4702177","n":"Keon Ellis","pos":"G","t":"17","ta":"BKN","gp":4,"pts":24,"reb":8,"ast":12,"tpm":4},{"id":"4702352","n":"Kobe Sanders","pos":"G","t":"12","ta":"LAC","gp":4,"pts":28,"reb":11,"ast":10,"tpm":4},{"id":"4702382","n":"Tristan da Silva","pos":"F","t":"19","ta":"ORL","gp":4,"pts":58,"reb":10,"ast":7,"tpm":14},{"id":"4702384","n":"Nique Clifford","pos":"G","t":"23","ta":"SAC","gp":3,"pts":8,"reb":1,"ast":3,"tpm":0},{"id":"4702656","n":"Alijah Martin","pos":"G","t":"28","ta":"TOR","gp":4,"pts":10,"reb":3,"ast":2,"tpm":1},{"id":"4702972","n":"Chris Manon","pos":"G","t":"13","ta":"LAL","gp":1,"pts":2,"reb":1,"ast":0,"tpm":0},{"id":"4703396","n":"Graham Ike","pos":"F","t":"9","ta":"GS","gp":4,"pts":33,"reb":14,"ast":5,"tpm":4},{"id":"4703889","n":"Jayson Kent","pos":"G","t":"22","ta":"POR","gp":1,"pts":0,"reb":1,"ast":0,"tpm":0},{"id":"4709138","n":"Brandin Podziemski","pos":"G","t":"9","ta":"GS","gp":3,"pts":44,"reb":14,"ast":14,"tpm":5},{"id":"4711272","n":"Reed Sheppard","pos":"G","t":"10","ta":"HOU","gp":4,"pts":42,"reb":11,"ast":19,"tpm":9},{"id":"4711294","n":"Matas Buzelis","pos":"F","t":"4","ta":"CHI","gp":5,"pts":73,"reb":22,"ast":10,"tpm":7},{"id":"4711297","n":"Justin Edwards","pos":"F","t":"20","ta":"PHI","gp":1,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"4712849","n":"Anthony Black","pos":"G","t":"19","ta":"ORL","gp":2,"pts":26,"reb":5,"ast":6,"tpm":5},{"id":"4712896","n":"Noah Clowney","pos":"F","t":"17","ta":"BKN","gp":4,"pts":25,"reb":16,"ast":3,"tpm":4},{"id":"4713010","n":"David Jones Garcia","pos":"F","t":"24","ta":"SA","gp":1,"pts":2,"reb":0,"ast":0,"tpm":0},{"id":"4845363","n":"Cam Christie","pos":"G","t":"12","ta":"LAC","gp":2,"pts":2,"reb":0,"ast":0,"tpm":0},{"id":"4845367","n":"Stephon Castle","pos":"G","t":"24","ta":"SA","gp":5,"pts":87,"reb":29,"ast":27,"tpm":15},{"id":"4845374","n":"Bub Carrington","pos":"G","t":"27","ta":"WSH","gp":5,"pts":31,"reb":5,"ast":11,"tpm":8},{"id":"4848625","n":"Dailyn Swain","pos":"G","t":"4","ta":"CHI","gp":1,"pts":2,"reb":2,"ast":2,"tpm":0},{"id":"4868423","n":"Jaden Hardy","pos":"G","t":"13","ta":"LAL","gp":2,"pts":5,"reb":2,"ast":2,"tpm":1},{"id":"4869342","n":"Dyson Daniels","pos":"G","t":"1","ta":"ATL","gp":5,"pts":60,"reb":25,"ast":21,"tpm":1},{"id":"4869780","n":"Derik Queen","pos":"C","t":"3","ta":"NO","gp":4,"pts":50,"reb":37,"ast":6,"tpm":1},{"id":"4870564","n":"Joshua Jefferson","pos":"F","t":"17","ta":"BKN","gp":1,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"4871144","n":"Alperen Sengun","pos":"C","t":"10","ta":"HOU","gp":4,"pts":98,"reb":36,"ast":28,"tpm":6},{"id":"4871145","n":"Josh Giddey","pos":"G","t":"4","ta":"CHI","gp":5,"pts":38,"reb":28,"ast":40,"tpm":3},{"id":"4873090","n":"Labaron Philon Jr.","pos":"G","t":"20","ta":"PHI","gp":2,"pts":5,"reb":2,"ast":1,"tpm":1},{"id":"4873138","n":"Ace Bailey","pos":"G","t":"26","ta":"UTAH","gp":5,"pts":71,"reb":40,"ast":12,"tpm":8},{"id":"4873153","n":"Morez Johnson Jr.","pos":"F","t":"6","ta":"DAL","gp":5,"pts":36,"reb":18,"ast":7,"tpm":0},{"id":"4873201","n":"Asa Newell","pos":"F","t":"1","ta":"ATL","gp":2,"pts":3,"reb":2,"ast":0,"tpm":1},{"id":"4888725","n":"Ryan Dunn","pos":"F","t":"21","ta":"PHX","gp":3,"pts":14,"reb":9,"ast":1,"tpm":2},{"id":"4895758","n":"Cody Williams","pos":"F","t":"16","ta":"MIN","gp":3,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"4896372","n":"Walter Clayton Jr.","pos":"G","t":"6","ta":"DAL","gp":4,"pts":18,"reb":9,"ast":14,"tpm":3},{"id":"4897262","n":"Will Richard","pos":"G","t":"9","ta":"GS","gp":5,"pts":25,"reb":8,"ast":2,"tpm":3},{"id":"4897449","n":"Malevy Leons","pos":"F","t":"9","ta":"GS","gp":3,"pts":2,"reb":2,"ast":0,"tpm":0},{"id":"4898010","n":"Jaylin Sellers","pos":"G","t":"4","ta":"CHI","gp":2,"pts":3,"reb":1,"ast":3,"tpm":1},{"id":"4900671","n":"Ajay Mitchell","pos":"G","t":"25","ta":"OKC","gp":5,"pts":93,"reb":17,"ast":18,"tpm":4},{"id":"4903027","n":"Cedric Coward","pos":"F","t":"29","ta":"MEM","gp":3,"pts":38,"reb":29,"ast":7,"tpm":8},{"id":"4917149","n":"Alex Karaban","pos":"F","t":"23","ta":"SAC","gp":2,"pts":1,"reb":2,"ast":1,"tpm":0},{"id":"4997526","n":"Ousmane Dieng","pos":"F","t":"15","ta":"MIL","gp":4,"pts":12,"reb":5,"ast":4,"tpm":1},{"id":"4997528","n":"Nikola Jovic","pos":"F","t":"14","ta":"MIA","gp":4,"pts":14,"reb":13,"ast":3,"tpm":1},{"id":"4997536","n":"Gui Santos","pos":"F","t":"9","ta":"GS","gp":4,"pts":37,"reb":16,"ast":6,"tpm":4},{"id":"4997538","n":"Karlo Matkovic","pos":"F","t":"3","ta":"NO","gp":3,"pts":15,"reb":7,"ast":2,"tpm":2},{"id":"5023693","n":"Tyrese Proctor","pos":"G","t":"5","ta":"CLE","gp":3,"pts":7,"reb":3,"ast":4,"tpm":1},{"id":"5037871","n":"Dylan Harper","pos":"G","t":"24","ta":"SA","gp":5,"pts":86,"reb":26,"ast":23,"tpm":6},{"id":"5037873","n":"Drake Powell","pos":"G","t":"17","ta":"BKN","gp":1,"pts":0,"reb":2,"ast":3,"tpm":0},{"id":"5041935","n":"Cameron Boozer","pos":"F","t":"29","ta":"MEM","gp":4,"pts":61,"reb":42,"ast":19,"tpm":7},{"id":"5041939","n":"Cooper Flagg","pos":"F","t":"6","ta":"DAL","gp":4,"pts":101,"reb":21,"ast":27,"tpm":7},{"id":"5041951","n":"Meleek Thomas","pos":"G","t":"5","ta":"CLE","gp":2,"pts":26,"reb":6,"ast":1,"tpm":4},{"id":"5041953","n":"Koa Peat","pos":"F","t":"21","ta":"PHX","gp":2,"pts":4,"reb":1,"ast":0,"tpm":0},{"id":"5041955","n":"Darryn Peterson","pos":"G","t":"26","ta":"UTAH","gp":5,"pts":64,"reb":22,"ast":13,"tpm":7},{"id":"5044385","n":"Leonard Miller","pos":"F","t":"4","ta":"CHI","gp":5,"pts":49,"reb":22,"ast":4,"tpm":5},{"id":"5060701","n":"Christian Anderson","pos":"G","t":"30","ta":"CHA","gp":5,"pts":7,"reb":7,"ast":6,"tpm":1},{"id":"5061568","n":"Carter Bryant","pos":"F","t":"24","ta":"SA","gp":5,"pts":8,"reb":2,"ast":3,"tpm":1},{"id":"5061585","n":"Isaiah Evans","pos":"F","t":"16","ta":"MIN","gp":3,"pts":0,"reb":1,"ast":2,"tpm":0},{"id":"5061589","n":"Yves Missi","pos":"C","t":"3","ta":"NO","gp":2,"pts":19,"reb":15,"ast":5,"tpm":0},{"id":"5075626","n":"Baba Miller","pos":"F","t":"12","ta":"LAC","gp":3,"pts":8,"reb":11,"ast":2,"tpm":0},{"id":"5081727","n":"Sidy Cissoko","pos":"G","t":"22","ta":"POR","gp":3,"pts":24,"reb":13,"ast":8,"tpm":3},{"id":"5082206","n":"Brayden Burries","pos":"G","t":"15","ta":"MIL","gp":5,"pts":39,"reb":18,"ast":7,"tpm":4},{"id":"5093267","n":"Collin Murray-Boyles","pos":"F","t":"28","ta":"TOR","gp":4,"pts":27,"reb":20,"ast":6,"tpm":2},{"id":"5095151","n":"Caleb Wilson","pos":"F","t":"4","ta":"CHI","gp":5,"pts":104,"reb":35,"ast":11,"tpm":8},{"id":"5101761","n":"Mikel Brown Jr.","pos":"G","t":"17","ta":"BKN","gp":3,"pts":31,"reb":10,"ast":13,"tpm":7},{"id":"5104155","n":"Bilal Coulibaly","pos":"G","t":"27","ta":"WSH","gp":5,"pts":49,"reb":19,"ast":2,"tpm":3},{"id":"5104157","n":"Victor Wembanyama","pos":"F","t":"24","ta":"SA","gp":5,"pts":125,"reb":57,"ast":14,"tpm":8},{"id":"5105337","n":"Maliq Brown","pos":"F","t":"24","ta":"SA","gp":1,"pts":0,"reb":0,"ast":1,"tpm":0},{"id":"5105550","n":"GG Jackson","pos":"F","t":"29","ta":"MEM","gp":4,"pts":19,"reb":16,"ast":3,"tpm":2},{"id":"5105555","n":"Tobe Awaka","pos":"F","t":"4","ta":"CHI","gp":2,"pts":6,"reb":13,"ast":2,"tpm":0},{"id":"5105565","n":"Donovan Clingan","pos":"C","t":"22","ta":"POR","gp":3,"pts":28,"reb":27,"ast":6,"tpm":4},{"id":"5105592","n":"Cam Whitmore","pos":"F","t":"7","ta":"DEN","gp":2,"pts":8,"reb":2,"ast":1,"tpm":0},{"id":"5105623","n":"Kel'el Ware","pos":"C","t":"15","ta":"MIL","gp":5,"pts":59,"reb":42,"ast":2,"tpm":3},{"id":"5105637","n":"Adem Bona","pos":"C","t":"20","ta":"PHI","gp":5,"pts":9,"reb":20,"ast":3,"tpm":0},{"id":"5105800","n":"Josh Dix","pos":"G","t":"25","ta":"OKC","gp":2,"pts":2,"reb":3,"ast":0,"tpm":0},{"id":"5105806","n":"Jett Howard","pos":"G","t":"6","ta":"DAL","gp":2,"pts":5,"reb":0,"ast":0,"tpm":1},{"id":"5105809","n":"Tarris Reed Jr.","pos":"C","t":"24","ta":"SA","gp":3,"pts":6,"reb":8,"ast":0,"tpm":0},{"id":"5105832","n":"Nick Martinelli","pos":"F","t":"12","ta":"LAC","gp":2,"pts":2,"reb":4,"ast":2,"tpm":0},{"id":"5105837","n":"Bruce Thornton","pos":"G","t":"10","ta":"HOU","gp":4,"pts":5,"reb":0,"ast":0,"tpm":1},{"id":"5105839","n":"Brice Sensabaugh","pos":"F","t":"26","ta":"UTAH","gp":5,"pts":46,"reb":16,"ast":5,"tpm":10},{"id":"5105841","n":"Felix Okpara","pos":"F","t":"27","ta":"WSH","gp":1,"pts":1,"reb":0,"ast":0,"tpm":0},{"id":"5105854","n":"Braden Smith","pos":"G","t":"11","ta":"IND","gp":2,"pts":0,"reb":0,"ast":1,"tpm":0},{"id":"5105977","n":"Rasheer Fleming","pos":"F","t":"21","ta":"PHX","gp":2,"pts":1,"reb":3,"ast":0,"tpm":0},{"id":"5106040","n":"Tobi Lawal","pos":"F","t":"6","ta":"DAL","gp":3,"pts":5,"reb":1,"ast":2,"tpm":1},{"id":"5106058","n":"Emanuel Sharp","pos":"G","t":"23","ta":"SAC","gp":4,"pts":21,"reb":2,"ast":3,"tpm":5},{"id":"5106060","n":"Jarace Walker","pos":"F","t":"11","ta":"IND","gp":5,"pts":28,"reb":30,"ast":7,"tpm":4},{"id":"5106258","n":"Gradey Dick","pos":"G","t":"12","ta":"LAC","gp":4,"pts":29,"reb":16,"ast":0,"tpm":4},{"id":"5106262","n":"Zuby Ejiofor","pos":"F","t":"1","ta":"ATL","gp":2,"pts":3,"reb":2,"ast":0,"tpm":1},{"id":"5107157","n":"Ryan Conwell","pos":"G","t":"14","ta":"MIA","gp":3,"pts":5,"reb":1,"ast":2,"tpm":1},{"id":"5107173","n":"Danny Wolf","pos":"F","t":"17","ta":"BKN","gp":1,"pts":6,"reb":2,"ast":1,"tpm":2},{"id":"5107199","n":"Daniss Jenkins","pos":"G","t":"8","ta":"DET","gp":5,"pts":61,"reb":20,"ast":19,"tpm":8},{"id":"5107818","n":"Isaac Jones","pos":"C","t":"8","ta":"DET","gp":1,"pts":0,"reb":0,"ast":1,"tpm":0},{"id":"5107897","n":"Jonathan Mogbo","pos":"F","t":"23","ta":"SAC","gp":3,"pts":9,"reb":8,"ast":1,"tpm":1},{"id":"5107968","n":"Ja'Kobi Gillespie","pos":"G","t":"24","ta":"SA","gp":2,"pts":5,"reb":0,"ast":0,"tpm":1},{"id":"5112087","n":"Jaylen Wells","pos":"F","t":"29","ta":"MEM","gp":4,"pts":59,"reb":17,"ast":6,"tpm":9},{"id":"5124612","n":"VJ Edgecombe","pos":"G","t":"20","ta":"PHI","gp":4,"pts":45,"reb":31,"ast":11,"tpm":7},{"id":"5142620","n":"Darius Acuff Jr.","pos":"G","t":"23","ta":"SAC","gp":4,"pts":86,"reb":11,"ast":19,"tpm":7},{"id":"5142621","n":"Chris Cenac Jr.","pos":"F","t":"2","ta":"BOS","gp":1,"pts":3,"reb":1,"ast":0,"tpm":1},{"id":"5142718","n":"AJ Dybantsa","pos":"F","t":"27","ta":"WSH","gp":1,"pts":19,"reb":2,"ast":2,"tpm":1},{"id":"5144091","n":"Jeremiah Fears","pos":"G","t":"3","ta":"NO","gp":4,"pts":36,"reb":13,"ast":7,"tpm":3},{"id":"5144126","n":"Will Riley","pos":"G","t":"27","ta":"WSH","gp":3,"pts":4,"reb":0,"ast":0,"tpm":0},{"id":"5149077","n":"Kingston Flemings","pos":"G","t":"1","ta":"ATL","gp":5,"pts":36,"reb":17,"ast":21,"tpm":4},{"id":"5149115","n":"Allen Graves","pos":"F","t":"28","ta":"TOR","gp":4,"pts":21,"reb":14,"ast":4,"tpm":1},{"id":"5160992","n":"Alex Sarr","pos":"C","t":"27","ta":"WSH","gp":5,"pts":53,"reb":25,"ast":13,"tpm":3},{"id":"5164559","n":"Nate Ament","pos":"F","t":"15","ta":"MIL","gp":3,"pts":16,"reb":10,"ast":0,"tpm":2},{"id":"5174563","n":"Kyshawn George","pos":"F","t":"27","ta":"WSH","gp":5,"pts":79,"reb":23,"ast":24,"tpm":4},{"id":"5174655","n":"Chaney Johnson","pos":"F","t":"17","ta":"BKN","gp":4,"pts":29,"reb":14,"ast":5,"tpm":5},{"id":"5174983","n":"Aday Mara","pos":"C","t":"25","ta":"OKC","gp":5,"pts":28,"reb":21,"ast":5,"tpm":0},{"id":"5175643","n":"Egor Demin","pos":"G","t":"17","ta":"BKN","gp":4,"pts":31,"reb":9,"ast":11,"tpm":6},{"id":"5175647","n":"Hugo Gonzalez","pos":"G","t":"2","ta":"BOS","gp":4,"pts":13,"reb":10,"ast":3,"tpm":1},{"id":"5175737","n":"Yaxel Lendeborg","pos":"F","t":"9","ta":"GS","gp":5,"pts":113,"reb":45,"ast":20,"tpm":11},{"id":"5203685","n":"Khaman Maluach","pos":"C","t":"21","ta":"PHX","gp":3,"pts":23,"reb":22,"ast":5,"tpm":1},{"id":"5211175","n":"Zaccharie Risacher","pos":"F","t":"6","ta":"DAL","gp":5,"pts":45,"reb":31,"ast":7,"tpm":5},{"id":"5211176","n":"Tidjane Salaun","pos":"F","t":"30","ta":"CHA","gp":4,"pts":21,"reb":15,"ast":1,"tpm":3},{"id":"5211983","n":"Pacome Dadiet","pos":"F","t":"18","ta":"NY","gp":2,"pts":0,"reb":1,"ast":0,"tpm":0},{"id":"5214640","n":"Kasparas Jakucionis","pos":"G","t":"15","ta":"MIL","gp":5,"pts":45,"reb":14,"ast":21,"tpm":3},{"id":"5214989","n":"Bogoljub Markovic","pos":"F","t":"15","ta":"MIL","gp":1,"pts":2,"reb":1,"ast":0,"tpm":0},{"id":"5217746","n":"Yang Hansen","pos":"C","t":"22","ta":"POR","gp":1,"pts":5,"reb":3,"ast":0,"tpm":1},{"id":"5238230","n":"Tre Johnson","pos":"G","t":"27","ta":"WSH","gp":4,"pts":48,"reb":8,"ast":4,"tpm":7},{"id":"5239561","n":"Jase Richardson","pos":"G","t":"19","ta":"ORL","gp":4,"pts":24,"reb":5,"ast":7,"tpm":5},{"id":"5239590","n":"Liam McNeeley","pos":"G","t":"30","ta":"CHA","gp":2,"pts":4,"reb":5,"ast":0,"tpm":0},{"id":"5241364","n":"Bennett Stirtz","pos":"G","t":"25","ta":"OKC","gp":5,"pts":17,"reb":2,"ast":4,"tpm":2},{"id":"5242496","n":"Noa Essengue","pos":"F","t":"4","ta":"CHI","gp":4,"pts":8,"reb":8,"ast":2,"tpm":1},{"id":"5242502","n":"Ben Saraf","pos":"G","t":"17","ta":"BKN","gp":1,"pts":2,"reb":1,"ast":0,"tpm":0},{"id":"5254165","n":"Keaton Wagler","pos":"G","t":"12","ta":"LAC","gp":4,"pts":60,"reb":17,"ast":14,"tpm":9},{"id":"5258459","n":"Ebuka Okorie","pos":"G","t":"8","ta":"DET","gp":2,"pts":2,"reb":0,"ast":2,"tpm":0},{"id":"5279129","n":"Sergio de Larrea","pos":"F","t":"6","ta":"DAL","gp":4,"pts":21,"reb":8,"ast":5,"tpm":3},{"id":"5279130","n":"Nolan Traore","pos":"G","t":"17","ta":"BKN","gp":4,"pts":38,"reb":7,"ast":8,"tpm":3},{"id":"5279133","n":"Joan Beringer","pos":"F","t":"16","ta":"MIN","gp":5,"pts":34,"reb":37,"ast":3,"tpm":0},{"id":"5281370","n":"Hannes Steinbach","pos":"F","t":"30","ta":"CHA","gp":1,"pts":6,"reb":5,"ast":0,"tpm":0},{"id":"5289900","n":"Mohamed Diawara","pos":"F","t":"18","ta":"NY","gp":1,"pts":0,"reb":0,"ast":0,"tpm":0},{"id":"6442","n":"Kyrie Irving","pos":"G","t":"6","ta":"DAL","gp":4,"pts":72,"reb":13,"ast":15,"tpm":11},{"id":"6450","n":"Kawhi Leonard","pos":"F","t":"28","ta":"TOR","gp":2,"pts":39,"reb":15,"ast":3,"tpm":4},{"id":"6475","n":"Klay Thompson","pos":"G","t":"14","ta":"MIA","gp":5,"pts":39,"reb":8,"ast":5,"tpm":12},{"id":"6478","n":"Nikola Vucevic","pos":"C","t":"19","ta":"ORL","gp":4,"pts":10,"reb":10,"ast":6,"tpm":1},{"id":"6578","n":"Harrison Barnes","pos":"F","t":"24","ta":"SA","gp":4,"pts":6,"reb":0,"ast":0,"tpm":1},{"id":"6583","n":"Anthony Davis","pos":"F","t":"27","ta":"WSH","gp":5,"pts":109,"reb":42,"ast":11,"tpm":6},{"id":"6585","n":"Andre Drummond","pos":"C","t":"18","ta":"NY","gp":5,"pts":32,"reb":38,"ast":8,"tpm":0},{"id":"6589","n":"Draymond Green","pos":"F","t":"9","ta":"GS","gp":4,"pts":13,"reb":21,"ast":28,"tpm":2},{"id":"6606","n":"Damian Lillard","pos":"G","t":"22","ta":"POR","gp":3,"pts":65,"reb":13,"ast":12,"tpm":12},{"id":"6609","n":"Khris Middleton","pos":"F","t":"27","ta":"WSH","gp":4,"pts":12,"reb":8,"ast":2,"tpm":1}],"props":[{"id":"2490149","n":"CJ McCollum","pos":"G","ta":"ATL","mk":"points","lines":{"draftkings":15.5,"fanduel":16.5,"hardrockbet":16.5},"sample":[13,20,17,13,19],"scope":"season","gid":"401909893"},{"id":"2595516","n":"Norman Powell","pos":"G","ta":"CHI","mk":"points","lines":{"draftkings":18.5,"fanduel":19.5,"hardrockbet":18.5},"sample":[30,20,18,25,15],"scope":"season","gid":"401909886"},{"id":"2990984","n":"Buddy Hield","pos":"G","ta":"CHI","mk":"points","lines":{"fanduel":6.5,"hardrockbet":6.5},"sample":[2,3,9,13,0],"scope":"season","gid":"401909886"},{"id":"2991070","n":"Jerami Grant","pos":"F","ta":"MEM","mk":"points","lines":{"draftkings":9.5,"fanduel":10.5,"hardrockbet":10.5},"sample":[13,5,6,15],"scope":"season","gid":"401909895"},{"id":"2991230","n":"Fred VanVleet","pos":"G","ta":"HOU","mk":"points","lines":{"draftkings":12.5,"fanduel":12.5,"hardrockbet":12.5},"sample":[24,5,14,6],"scope":"season","gid":"401909887"},{"id":"3032976","n":"Rudy Gobert","pos":"C","ta":"MIN","mk":"points","lines":{"draftkings":9.5,"fanduel":10.5,"hardrockbet":10.5},"sample":[1,5,8,14,5],"scope":"season","gid":"401909888"},{"id":"3062679","n":"Josh Hart","pos":"G","ta":"NY","mk":"points","lines":{"draftkings":11.5,"fanduel":11.5,"hardrockbet":11.5},"sample":[2,6,13,10,14],"scope":"season","gid":"401909886"},{"id":"3064290","n":"Aaron Gordon","pos":"F","ta":"DEN","mk":"points","lines":{"draftkings":15.5,"fanduel":15.5,"hardrockbet":15.5},"sample":[15,7,7,20],"scope":"season","gid":"401909889"},{"id":"3064440","n":"Zach LaVine","pos":"G","ta":"SAC","mk":"points","lines":{"draftkings":22.5,"fanduel":21.5,"hardrockbet":21.5},"sample":[22,37,22,28],"scope":"season","gid":"401909894"},{"id":"3102529","n":"Clint Capela","pos":"C","ta":"HOU","mk":"points","lines":{"fanduel":5.5,"hardrockbet":5.5},"sample":[10,2,2,0],"scope":"season","gid":"401909887"},{"id":"3112335","n":"Nikola Jokic","pos":"C","ta":"DEN","mk":"points","lines":{"draftkings":26.5,"fanduel":27.5,"hardrockbet":27.5},"sample":[21,19,35,13],"scope":"season","gid":"401909889"},{"id":"3133626","n":"Kenrich Williams","pos":"G","ta":"OKC","mk":"points","lines":{"draftkings":8.5,"fanduel":8.5,"hardrockbet":8.5},"sample":[7,3,3,3,3],"scope":"season","gid":"401909891"},{"id":"3133628","n":"Myles Turner","pos":"C","ta":"MIL","mk":"points","lines":{"draftkings":10.5,"fanduel":9.5,"hardrockbet":10.5},"sample":[4,6,0,12,11],"scope":"season","gid":"401909887"},{"id":"3134907","n":"Kyle Kuzma","pos":"F","ta":"MIL","mk":"points","lines":{"draftkings":12.5,"fanduel":11.5,"hardrockbet":11.5},"sample":[4,17,14,14,5],"scope":"season","gid":"401909887"},{"id":"3136195","n":"Karl-Anthony Towns","pos":"C","ta":"NY","mk":"points","lines":{"draftkings":21.5,"fanduel":21.5,"hardrockbet":21.5},"sample":[19,27,22,22,19],"scope":"season","gid":"401909886"},{"id":"3147657","n":"Mikal Bridges","pos":"G","ta":"NY","mk":"points","lines":{"draftkings":12.5,"fanduel":11.5,"hardrockbet":11.5},"sample":[3,12,6,0,4],"scope":"season","gid":"401909886"},{"id":"3155942","n":"Domantas Sabonis","pos":"F","ta":"SAC","mk":"points","lines":{"draftkings":17.5,"fanduel":17.5,"hardrockbet":17.5},"sample":[20,15,27,14],"scope":"season","gid":"401909894"},{"id":"3202","n":"Kevin Durant","pos":"F","ta":"HOU","mk":"points","lines":{"draftkings":26.5,"fanduel":25.5,"hardrockbet":25.5},"sample":[18,22,22,20,30],"scope":"season","gid":"401909887"},{"id":"3213","n":"Al Horford","pos":"C","ta":"GS","mk":"points","lines":{"draftkings":5.5,"fanduel":5.5,"hardrockbet":5.5},"sample":[4,11,3,0],"scope":"season","gid":"401909888"},{"id":"3907497","n":"Dejounte Murray","pos":"G","ta":"NO","mk":"points","lines":{"draftkings":17.5,"fanduel":17.5,"hardrockbet":17.5},"sample":[10,22,16,23],"scope":"season","gid":"401909889"},{"id":"3908809","n":"Donovan Mitchell","pos":"G","ta":"CLE","mk":"points","lines":{"draftkings":23.5,"fanduel":24.5,"hardrockbet":24.5},"sample":[19,26,22,32],"scope":"season","gid":"401909893"},{"id":"3914044","n":"Landry Shamet","pos":"G","ta":"NY","mk":"points","lines":{"draftkings":8.5,"fanduel":8.5,"hardrockbet":8.5},"sample":[14,13,6,8,5],"scope":"season","gid":"401909886"},{"id":"3934672","n":"Jalen Brunson","pos":"G","ta":"NY","mk":"points","lines":{"draftkings":25.5,"fanduel":26.5,"hardrockbet":26.5},"sample":[38,23,28,19,21],"scope":"season","gid":"401909886"},{"id":"3934719","n":"OG Anunoby","pos":"F","ta":"NY","mk":"points","lines":{"draftkings":17.5,"fanduel":17.5,"hardrockbet":17.5},"sample":[23,13,22,20,10],"scope":"season","gid":"401909886"},{"id":"3936299","n":"Jamal Murray","pos":"G","ta":"DEN","mk":"points","lines":{"draftkings":24.5,"fanduel":24.5,"hardrockbet":24.5},"sample":[23,19,42,6],"scope":"season","gid":"401909889"},{"id":"3975","n":"Stephen Curry","pos":"G","ta":"GS","mk":"points","lines":{"draftkings":23.5,"fanduel":23.5,"hardrockbet":23.5},"sample":[44,24,24,23],"scope":"season","gid":"401909888"},{"id":"3978","n":"DeMar DeRozan","pos":"G","ta":"DEN","mk":"points","lines":{"draftkings":14.5,"fanduel":14.5,"hardrockbet":14.5},"sample":[6,21,12,13],"scope":"season","gid":"401909889"},{"id":"3992","n":"James Harden","pos":"G","ta":"CLE","mk":"points","lines":{"draftkings":17.5,"fanduel":16.5,"hardrockbet":17.5},"sample":[16,22,12,16],"scope":"season","gid":"401909893"},{"id":"3995","n":"Jrue Holiday","pos":"G","ta":"POR","mk":"points","lines":{"draftkings":12.5,"fanduel":12.5,"hardrockbet":12.5},"sample":[22,12,8],"scope":"season","gid":"401909895"},{"id":"4065732","n":"De'Andre Hunter","pos":"F","ta":"SAC","mk":"points","lines":{"draftkings":11.5,"fanduel":11.5,"hardrockbet":11.5},"sample":[24,7,4,6],"scope":"season","gid":"401909894"},{"id":"4065733","n":"Ty Jerome","pos":"G","ta":"MEM","mk":"points","lines":{"draftkings":24.5,"fanduel":23.5,"hardrockbet":24.5},"sample":[15,31,28,45],"scope":"season","gid":"401909895"},{"id":"4066211","n":"Robert Williams III","pos":"C","ta":"POR","mk":"points","lines":{"draftkings":6.5,"fanduel":6.5,"hardrockbet":6.5},"sample":[14,13,2],"scope":"season","gid":"401909895"},{"id":"4066259","n":"De'Aaron Fox","pos":"G","ta":"SA","mk":"points","lines":{"draftkings":15.5,"fanduel":15.5,"hardrockbet":15.5},"sample":[14,11,19,19,14],"scope":"season","gid":"401909890"},{"id":"4066328","n":"Jarrett Allen","pos":"C","ta":"CLE","mk":"points","lines":{"draftkings":12.5,"fanduel":12.5,"hardrockbet":13.5},"sample":[8,10,21,14],"scope":"season","gid":"401909893"},{"id":"4066336","n":"Lauri Markkanen","pos":"F","ta":"UTAH","mk":"points","lines":{"draftkings":18.5,"fanduel":19.5,"hardrockbet":19.5},"sample":[2,28,16,18],"scope":"season","gid":"401909890"},{"id":"4066436","n":"De'Anthony Melton","pos":"G","ta":"GS","mk":"points","lines":{"draftkings":10.5,"fanduel":10.5,"hardrockbet":10.5},"sample":[8,3,25,10,0],"scope":"season","gid":"401909888"},{"id":"4066757","n":"Sam Merrill","pos":"G","ta":"CLE","mk":"points","lines":{"hardrockbet":8.5},"sample":[8,9,7,5],"scope":"season","gid":"401909893"},{"id":"4222252","n":"Isaiah Hartenstein","pos":"C","ta":"OKC","mk":"points","lines":{"draftkings":10.5,"fanduel":10.5,"hardrockbet":10.5},"sample":[10,15,12,6,4],"scope":"season","gid":"401909891"},{"id":"4278039","n":"Nickeil Alexander-Walker","pos":"G","ta":"ATL","mk":"points","lines":{"draftkings":17.5,"fanduel":18.5,"hardrockbet":18.5},"sample":[23,12,18,14,31],"scope":"season","gid":"401909893"},{"id":"4278049","n":"Daniel Gafford","pos":"F","ta":"DAL","mk":"points","lines":{"draftkings":9.5,"fanduel":9.5,"hardrockbet":9.5},"sample":[7,8,12,4,2],"scope":"season","gid":"401909891"},{"id":"4278073","n":"Shai Gilgeous-Alexander","pos":"G","ta":"OKC","mk":"points","lines":{"draftkings":31.5,"fanduel":31.5,"hardrockbet":31.5},"sample":[21,26,34,17,32],"scope":"season","gid":"401909891"},{"id":"4278078","n":"P.J. Washington","pos":"F","ta":"DAL","mk":"points","lines":{"draftkings":14.5,"fanduel":13.5,"hardrockbet":14.5},"sample":[18,20,12,20,10],"scope":"season","gid":"401909891"},{"id":"4279888","n":"Ja Morant","pos":"G","ta":"POR","mk":"points","lines":{"draftkings":17.5,"fanduel":17.5,"hardrockbet":17.5},"sample":[23,12,14],"scope":"season","gid":"401909895"},{"id":"4395626","n":"Tre Jones","pos":"G","ta":"CHI","mk":"points","lines":{"draftkings":8.5,"fanduel":8.5,"hardrockbet":8.5},"sample":[11,8,10,11,13],"scope":"season","gid":"401909886"},{"id":"4395628","n":"Zion Williamson","pos":"F","ta":"NO","mk":"points","lines":{"draftkings":18.5,"fanduel":18.5,"hardrockbet":18.5},"sample":[25,17,23,22],"scope":"season","gid":"401909889"},{"id":"4395630","n":"Devin Vassell","pos":"G","ta":"SA","mk":"points","lines":{"draftkings":12.5,"fanduel":11.5,"hardrockbet":11.5},"sample":[21,14,11,10,7],"scope":"season","gid":"401909890"},{"id":"4395723","n":"Keldon Johnson","pos":"F","ta":"SA","mk":"points","lines":{"fanduel":10.5,"hardrockbet":10.5},"sample":[9,14,7,8,10],"scope":"season","gid":"401909890"},{"id":"4395725","n":"Tyler Herro","pos":"G","ta":"MIL","mk":"points","lines":{"draftkings":20.5,"fanduel":20.5,"hardrockbet":21.5},"sample":[23,23,13,34,24],"scope":"season","gid":"401909887"},{"id":"4397002","n":"Ayo Dosunmu","pos":"G","ta":"MIN","mk":"points","lines":{"draftkings":16.5,"fanduel":16.5,"hardrockbet":16.5},"sample":[17,9,9,14,16],"scope":"season","gid":"401909888"},{"id":"4397077","n":"Jaxson Hayes","pos":"C","ta":"UTAH","mk":"points","lines":{"draftkings":9.5,"fanduel":9.5,"hardrockbet":9.5},"sample":[2,9,17,5],"scope":"season","gid":"401909890"},{"id":"4397136","n":"Saddiq Bey","pos":"G","ta":"NO","mk":"points","lines":{"draftkings":11.5,"fanduel":11.5,"hardrockbet":11.5},"sample":[9,14,20,13],"scope":"season","gid":"401909889"},{"id":"4397183","n":"Aaron Wiggins","pos":"G","ta":"ATL","mk":"points","lines":{"hardrockbet":11.5},"sample":[10,12,16,19,16],"scope":"season","gid":"401909893"},{"id":"4397189","n":"Jalen Smith","pos":"F","ta":"CHI","mk":"points","lines":{"draftkings":10.5,"fanduel":10.5,"hardrockbet":10.5},"sample":[17,7,14,14,15],"scope":"season","gid":"401909886"},{"id":"4397688","n":"Trey Murphy III","pos":"F","ta":"NO","mk":"points","lines":{"draftkings":17.5,"fanduel":17.5,"hardrockbet":17.5},"sample":[6,26,9,11],"scope":"season","gid":"401909889"},{"id":"4431671","n":"Jaden McDaniels","pos":"F","ta":"MIN","mk":"points","lines":{"draftkings":16.5,"fanduel":16.5,"hardrockbet":16.5},"sample":[19,14,14,15,17],"scope":"season","gid":"401909888"},{"id":"4431679","n":"Precious Achiuwa","pos":"F","ta":"SAC","mk":"points","lines":{"draftkings":10.5,"fanduel":10.5,"hardrockbet":10.5},"sample":[4,12,14,15],"scope":"season","gid":"401909894"},{"id":"4431680","n":"Onyeka Okongwu","pos":"F","ta":"ATL","mk":"points","lines":{"draftkings":11.5,"fanduel":11.5,"hardrockbet":11.5},"sample":[11,11,8,10,8],"scope":"season","gid":"401909893"},{"id":"4431736","n":"Toumani Camara","pos":"F","ta":"POR","mk":"points","lines":{"draftkings":11.5,"fanduel":11.5,"hardrockbet":11.5},"sample":[12,19,18],"scope":"season","gid":"401909895"},{"id":"4431767","n":"Christian Braun","pos":"G","ta":"DEN","mk":"points","lines":{"draftkings":11.5,"fanduel":12.5,"hardrockbet":12.5},"sample":[15,9,15,7],"scope":"season","gid":"401909889"},{"id":"4431823","n":"Miles McBride","pos":"G","ta":"NY","mk":"points","lines":{"draftkings":6.5,"hardrockbet":6.5},"sample":[3,5,1,20,3],"scope":"season","gid":"401909886"},{"id":"4432158","n":"Evan Mobley","pos":"C","ta":"CLE","mk":"points","lines":{"draftkings":17.5,"fanduel":17.5,"hardrockbet":17.5},"sample":[24,18,20,18],"scope":"season","gid":"401909893"},{"id":"4432582","n":"Max Christie","pos":"G","ta":"DAL","mk":"points","lines":{"draftkings":10.5,"fanduel":10.5,"hardrockbet":10.5},"sample":[11,11,5,16,5],"scope":"season","gid":"401909891"},{"id":"4432639","n":"Jabari Smith Jr.","pos":"F","ta":"HOU","mk":"points","lines":{"draftkings":16.5,"fanduel":15.5,"hardrockbet":15.5},"sample":[14,16,14,7,30],"scope":"season","gid":"401909887"},{"id":"4432816","n":"LaMelo Ball","pos":"G","ta":"MIN","mk":"points","lines":{"draftkings":22.5,"fanduel":22.5,"hardrockbet":22.5},"sample":[8,11,15,12,21],"scope":"season","gid":"401909888"},{"id":"4432847","n":"Terrence Shannon Jr.","pos":"G","ta":"MIN","mk":"points","lines":{"draftkings":13.5,"fanduel":13.5,"hardrockbet":13.5},"sample":[19,14,15,13,10],"scope":"season","gid":"401909888"},{"id":"4432848","n":"Jaime Jaquez Jr.","pos":"F","ta":"MIL","mk":"points","lines":{"draftkings":14.5,"fanduel":13.5,"hardrockbet":14.5},"sample":[19,8,21,19,22],"scope":"season","gid":"401909887"},{"id":"4433192","n":"Tari Eason","pos":"F","ta":"HOU","mk":"points","lines":{"draftkings":13.5,"fanduel":13.5,"hardrockbet":13.5},"sample":[5,13,19,12,2],"scope":"season","gid":"401909887"},{"id":"4433247","n":"Jonathan Kuminga","pos":"F","ta":"MIN","mk":"points","lines":{"draftkings":14.5,"fanduel":14.5,"hardrockbet":15.5},"sample":[20,10,13,11,12],"scope":"season","gid":"401909888"},{"id":"4433627","n":"Keyonte George","pos":"G","ta":"UTAH","mk":"points","lines":{"draftkings":21.5,"fanduel":21.5,"hardrockbet":21.5},"sample":[31,26,24,19,22],"scope":"season","gid":"401909890"},{"id":"4576087","n":"Peyton Watson","pos":"G","ta":"CLE","mk":"points","lines":{"draftkings":13.5,"fanduel":14.5,"hardrockbet":14.5},"sample":[22,15,11,8],"scope":"season","gid":"401909893"},{"id":"4591725","n":"Ryan Rollins","pos":"G","ta":"MIL","mk":"points","lines":{"draftkings":14.5,"fanduel":13.5,"hardrockbet":13.5},"sample":[4,19,15,11,9],"scope":"season","gid":"401909887"},{"id":"4592479","n":"Julian Champagnie","pos":"F","ta":"SA","mk":"points","lines":{"draftkings":10.5,"fanduel":9.5,"hardrockbet":9.5},"sample":[6,26,12,6,8],"scope":"season","gid":"401909890"},{"id":"4600663","n":"Zach Edey","pos":"C","ta":"MEM","mk":"points","lines":{"draftkings":8.5,"fanduel":8.5,"hardrockbet":8.5},"sample":[4,8,6],"scope":"season","gid":"401909895"},{"id":"4683021","n":"Deni Avdija","pos":"F","ta":"POR","mk":"points","lines":{"draftkings":23.5,"fanduel":22.5,"hardrockbet":23.5},"sample":[23,26,18],"scope":"season","gid":"401909895"},{"id":"4683634","n":"Bennedict Mathurin","pos":"G","ta":"NO","mk":"points","lines":{"fanduel":8.5,"hardrockbet":8.5},"sample":[5,9,4,11],"scope":"season","gid":"401909889"},{"id":"4683678","n":"Scoot Henderson","pos":"G","ta":"POR","mk":"points","lines":{"hardrockbet":8.5},"sample":[2,4,15],"scope":"season","gid":"401909895"},{"id":"4683766","n":"Isaiah Collier","pos":"G","ta":"UTAH","mk":"points","lines":{"draftkings":8.5,"fanduel":8.5,"hardrockbet":8.5},"sample":[7,7,6,10,7],"scope":"season","gid":"401909890"},{"id":"4683778","n":"Jared McCain","pos":"G","ta":"OKC","mk":"points","lines":{"draftkings":17.5,"fanduel":16.5,"hardrockbet":17.5},"sample":[10,18,3,4,20],"scope":"season","gid":"401909891"},{"id":"4684740","n":"Amen Thompson","pos":"G","ta":"HOU","mk":"points","lines":{"draftkings":18.5,"fanduel":17.5,"hardrockbet":18.5},"sample":[23,15,17,20,16],"scope":"season","gid":"401909887"},{"id":"4698719","n":"Trevon Brazile","pos":"F","ta":"DEN","mk":"points","lines":{"draftkings":9.5,"fanduel":8.5},"sample":[11,6,17,4],"scope":"season","gid":"401909889"},{"id":"4701230","n":"Jalen Johnson","pos":"F","ta":"ATL","mk":"points","lines":{"draftkings":21.5,"fanduel":21.5,"hardrockbet":21.5},"sample":[12,21,26,19,20],"scope":"season","gid":"401909893"},{"id":"4709138","n":"Brandin Podziemski","pos":"G","ta":"GS","mk":"points","lines":{"draftkings":15.5,"fanduel":16.5,"hardrockbet":15.5},"sample":[8,18,18],"scope":"season","gid":"401909888"},{"id":"4711272","n":"Reed Sheppard","pos":"G","ta":"HOU","mk":"points","lines":{"draftkings":12.5,"fanduel":12.5,"hardrockbet":12.5},"sample":[7,13,19,3],"scope":"season","gid":"401909887"},{"id":"4711294","n":"Matas Buzelis","pos":"F","ta":"CHI","mk":"points","lines":{"draftkings":14.5,"fanduel":13.5,"hardrockbet":13.5},"sample":[17,11,21,7,17],"scope":"season","gid":"401909886"},{"id":"4845367","n":"Stephon Castle","pos":"G","ta":"SA","mk":"points","lines":{"draftkings":17.5,"fanduel":17.5,"hardrockbet":17.5},"sample":[14,15,19,15,24],"scope":"season","gid":"401909890"},{"id":"4869342","n":"Dyson Daniels","pos":"G","ta":"ATL","mk":"points","lines":{"draftkings":11.5,"fanduel":11.5,"hardrockbet":11.5},"sample":[7,4,18,11,20],"scope":"season","gid":"401909893"},{"id":"4869780","n":"Derik Queen","pos":"C","ta":"NO","mk":"points","lines":{"draftkings":10.5,"fanduel":10.5,"hardrockbet":10.5},"sample":[11,17,12,10],"scope":"season","gid":"401909889"},{"id":"4871145","n":"Josh Giddey","pos":"G","ta":"CHI","mk":"points","lines":{"draftkings":10.5,"fanduel":10.5,"hardrockbet":10.5},"sample":[10,11,9,6,2],"scope":"season","gid":"401909886"},{"id":"4873138","n":"Ace Bailey","pos":"G","ta":"UTAH","mk":"points","lines":{"draftkings":13.5,"fanduel":14.5,"hardrockbet":13.5},"sample":[19,17,17,6,12],"scope":"season","gid":"401909890"},{"id":"4900671","n":"Ajay Mitchell","pos":"G","ta":"OKC","mk":"points","lines":{"draftkings":17.5,"fanduel":17.5,"hardrockbet":17.5},"sample":[29,30,18,12,4],"scope":"season","gid":"401909891"},{"id":"4903027","n":"Cedric Coward","pos":"F","ta":"MEM","mk":"points","lines":{"draftkings":12.5,"fanduel":13.5,"hardrockbet":13.5},"sample":[16,15,7],"scope":"season","gid":"401909895"},{"id":"5037871","n":"Dylan Harper","pos":"G","ta":"SA","mk":"points","lines":{"draftkings":15.5,"fanduel":15.5,"hardrockbet":16.5},"sample":[13,13,22,20,18],"scope":"season","gid":"401909890"},{"id":"5041935","n":"Cameron Boozer","pos":"F","ta":"MEM","mk":"points","lines":{"draftkings":15.5,"fanduel":15.5,"hardrockbet":15.5},"sample":[13,16,25,7],"scope":"season","gid":"401909895"},{"id":"5041939","n":"Cooper Flagg","pos":"F","ta":"DAL","mk":"points","lines":{"draftkings":23.5,"fanduel":22.5,"hardrockbet":23.5},"sample":[26,29,14,32],"scope":"season","gid":"401909891"},{"id":"5041955","n":"Darryn Peterson","pos":"G","ta":"UTAH","mk":"points","lines":{"draftkings":14.5,"fanduel":14.5,"hardrockbet":14.5},"sample":[18,14,8,15,9],"scope":"season","gid":"401909890"},{"id":"5044385","n":"Leonard Miller","pos":"F","ta":"CHI","mk":"points","lines":{"fanduel":9.5,"hardrockbet":9.5},"sample":[10,9,7,19,4],"scope":"season","gid":"401909886"},{"id":"5095151","n":"Caleb Wilson","pos":"F","ta":"CHI","mk":"points","lines":{"draftkings":16.5,"fanduel":16.5,"hardrockbet":17.5},"sample":[20,17,30,21,16],"scope":"season","gid":"401909886"},{"id":"5104157","n":"Victor Wembanyama","pos":"F","ta":"SA","mk":"points","lines":{"draftkings":25.5,"fanduel":24.5,"hardrockbet":24.5},"sample":[36,29,23,25,12],"scope":"season","gid":"401909890"},{"id":"5105565","n":"Donovan Clingan","pos":"C","ta":"POR","mk":"points","lines":{"draftkings":10.5,"fanduel":9.5,"hardrockbet":9.5},"sample":[9,8,11],"scope":"season","gid":"401909895"},{"id":"5105623","n":"Kel'el Ware","pos":"C","ta":"MIL","mk":"points","lines":{"draftkings":9.5,"fanduel":10.5,"hardrockbet":10.5},"sample":[6,16,19,11,7],"scope":"season","gid":"401909887"},{"id":"5112087","n":"Jaylen Wells","pos":"F","ta":"MEM","mk":"points","lines":{"draftkings":11.5,"fanduel":11.5,"hardrockbet":11.5},"sample":[14,16,17,12],"scope":"season","gid":"401909895"},{"id":"5142620","n":"Darius Acuff Jr.","pos":"G","ta":"SAC","mk":"points","lines":{"draftkings":22.5,"fanduel":22.5,"hardrockbet":22.5},"sample":[19,22,33,12],"scope":"season","gid":"401909894"},{"id":"5144091","n":"Jeremiah Fears","pos":"G","ta":"NO","mk":"points","lines":{"draftkings":11.5,"fanduel":11.5,"hardrockbet":11.5},"sample":[11,10,7,8],"scope":"season","gid":"401909889"},{"id":"5174983","n":"Aday Mara","pos":"C","ta":"OKC","mk":"points","lines":{"draftkings":8.5,"fanduel":8.5,"hardrockbet":8.5},"sample":[6,11,2,2,7],"scope":"season","gid":"401909891"},{"id":"5175737","n":"Yaxel Lendeborg","pos":"F","ta":"GS","mk":"points","lines":{"draftkings":16.5,"fanduel":17.5,"hardrockbet":16.5},"sample":[26,31,26,18,12],"scope":"season","gid":"401909888"},{"id":"5214640","n":"Kasparas Jakucionis","pos":"G","ta":"MIL","mk":"points","lines":{"draftkings":6.5,"fanduel":7.5,"hardrockbet":7.5},"sample":[4,7,12,7,15],"scope":"season","gid":"401909887"},{"id":"5279133","n":"Joan Beringer","pos":"F","ta":"MIN","mk":"points","lines":{"draftkings":6.5,"fanduel":6.5,"hardrockbet":6.5},"sample":[7,12,6,9,0],"scope":"season","gid":"401909888"},{"id":"6442","n":"Kyrie Irving","pos":"G","ta":"DAL","mk":"points","lines":{"draftkings":20.5,"fanduel":20.5,"hardrockbet":20.5},"sample":[15,18,24,15],"scope":"season","gid":"401909891"},{"id":"6589","n":"Draymond Green","pos":"F","ta":"GS","mk":"points","lines":{"draftkings":7.5,"fanduel":7.5,"hardrockbet":7.5},"sample":[3,3,5,2],"scope":"season","gid":"401909888"},{"id":"6606","n":"Damian Lillard","pos":"G","ta":"POR","mk":"points","lines":{"draftkings":20.5,"fanduel":20.5,"hardrockbet":20.5},"sample":[21,19,25],"scope":"season","gid":"401909895"}]}}};
});

/* Pro feature decisions that don't touch the network: sharp moves, filters, books we
   actually have, refresh age, closing-line value, and local bet tags.
   Browser: window.ProFeatures. Node: require("./pro-features.js"). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProFeatures = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const ACTIVE_FREE = 10;
  const ACTIVE_PRO = 25;
  const EMAIL_FREE = 5;          // unchanged daily email cap; a higher cap is not available
  const BOOK_KEYS = ["hardrockbet", "draftkings", "fanduel"];
  const BOOK_NAME = { hardrockbet: "Hard Rock Bet", draftkings: "DraftKings", fanduel: "FanDuel" };
  const COMING_BOOKS = ["BetMGM", "Caesars", "Fanatics", "bet365", "BetRivers"];
  const TAG_KEY = "ls-pro-tags-v1";
  const isNum = v => typeof v === "number" && isFinite(v);

  /** Upcoming games whose saved line movement already carries a sharp-move note. */
  function sharpMoves(byLg, now) {
    const out = [];
    for (const [lg, games] of Object.entries(byLg || {})) {
      for (const g of games || []) {
        const notes = (g.move && g.move.notable) || [];
        if (!notes.length || g.state !== "pre" || !(Date.parse(g.date) > now)) continue;
        out.push({
          lg, id: String(g.id), notes: notes.slice(),
          spread: g.move.spread || null, total: g.move.total || null, book: g.move.book || "",
        });
      }
    }
    out.sort((a, b) => Math.abs((b.spread && b.spread.delta) || 0) - Math.abs((a.spread && a.spread.delta) || 0) || a.lg.localeCompare(b.lg) || a.id.localeCompare(b.id));
    return out;
  }

  /** Custom filter over rows that already exist. `edge` is a fraction; `min` is in percentage points. */
  function filterBoard(rows, f) {
    const lg = f && f.lg && f.lg !== "all" ? f.lg : "";
    const mk = f && f.mk && f.mk !== "all" ? f.mk : "";
    const q = String((f && f.q) || "").trim().toLowerCase();
    const min = f && isNum(Number(f.min)) ? Number(f.min) : 0;
    return (rows || []).filter(r => {
      if (lg && r.lg !== lg) return false;
      if (mk && r.mk !== mk) return false;
      if (q && !`${r.label || ""} ${r.matchup || ""} ${r.player || ""} ${r.market || ""}`.toLowerCase().includes(q)) return false;
      if (isNum(r.edge) && r.edge * 100 < min - 1e-9) return false;
      return true;
    });
  }

  /** Book keys that posted at least one number on this game. Absent books are not invented. */
  function bookColumns(g) {
    const books = (g && g.books) || {};
    return BOOK_KEYS.filter(k => {
      const b = books[k];
      return !!b && typeof b === "object" && Object.keys(b).some(field => b[field] != null && b[field] !== "");
    });
  }

  /** File age and today's cadence. fasterMin stays null until a faster pull exists. */
  function refreshInfo(generated, now) {
    const t = Date.parse(generated || "");
    return { ageHours: isFinite(t) ? (now - t) / 36e5 : null, cadenceMin: 30, fasterMin: null };
  }

  /** Points between a bet line and a closing line. Unavailable when the close isn't a number. */
  function clvPoints(bet, closeLine) {
    if (!bet || !isNum(closeLine) || !isNum(bet.line)) return { available: false };
    if (bet.type !== "spread" && bet.type !== "total") return { available: false };
    return { available: true, delta: closeLine - bet.line };
  }

  function readTags(store) {
    if (!store || !store.getItem) return {};
    let raw;
    try { raw = JSON.parse(store.getItem(TAG_KEY) || "{}"); } catch (e) { return {}; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [id, tags] of Object.entries(raw)) {
      if (!Array.isArray(tags)) continue;
      const clean = [...new Set(tags.map(t => String(t).trim().toLowerCase()).filter(t => t && t.length <= 24))].slice(0, 6);
      if (clean.length) out[String(id)] = clean;
    }
    return out;
  }
  function setTag(store, id, tag, on) {
    const name = String(tag || "").trim().toLowerCase();
    if (!id) return { ok: false, error: "Pick a bet." };
    if (!name || name.length > 24) return { ok: false, error: "Use a short tag." };
    const all = readTags(store);
    const cur = new Set(all[id] || []);
    if (on) {
      if (cur.size >= 6 && !cur.has(name)) return { ok: false, error: "Six tags is the limit on one bet." };
      cur.add(name);
    } else cur.delete(name);
    if (cur.size) all[id] = [...cur];
    else delete all[id];
    store.setItem(TAG_KEY, JSON.stringify(all));
    return { ok: true, tags: all[id] || [] };
  }

  /** Open and recorded points for each book in a game history file. Missing markets stay null. */
  function historyMarkets(history) {
    const books = history && history.books;
    if (!books || typeof books !== "object") return [];
    const openAll = history.open && typeof history.open === "object" ? history.open : {};
    const out = [];
    for (const book of Object.keys(books)) {
      const pts = Array.isArray(books[book]) ? books[book] : [];
      const keyed = openAll[book];
      const op = keyed && typeof keyed === "object" && (isNum(keyed.hs) || isNum(keyed.tot) || isNum(keyed.hml) || isNum(keyed.aml))
        ? keyed
        : (isNum(openAll.hs) || isNum(openAll.tot) || isNum(openAll.hml) ? openAll : {});
      const series = key => {
        const vals = [];
        for (const p of pts) if (p && p[1] && isNum(p[1][key])) vals.push(p[1][key]);
        const open = isNum(op[key]) ? op[key] : null;
        if (open == null && !vals.length) return null;
        const points = [];
        if (open != null) points.push(open);
        for (const v of vals) points.push(v);
        return { open: open != null ? open : vals[0], current: vals.length ? vals[vals.length - 1] : open, points };
      };
      out.push({ book, spread: series("hs"), total: series("tot"), awayML: series("aml"), homeML: series("hml") });
    }
    return out;
  }

  /** Eastern calendar day (YYYY-MM-DD) for a timestamp or ISO string. */
  function etDay(v) {
    const t = typeof v === "number" ? v : Date.parse(v || "");
    if (!isFinite(t)) return "";
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
    } catch (e) { return ""; }
  }

  /** Spread and total moves already stored on the slate. One row per market that moved.
      Today's games when any of them moved; otherwise upcoming games in the file. Moneyline
      swings stay out so a cent move is not ranked against a point move. */
  function lineMoveBoard(byLg, now) {
    const today = etDay(now);
    const rows = [];
    for (const [lg, games] of Object.entries(byLg || {})) {
      for (const g of games || []) {
        const mv = g && g.move;
        if (!mv) continue;
        const markets = [];
        if (mv.spread && isNum(mv.spread.delta) && Math.abs(mv.spread.delta) > 1e-9) markets.push(["spread", mv.spread]);
        if (mv.total && isNum(mv.total.delta) && Math.abs(mv.total.delta) > 1e-9) markets.push(["total", mv.total]);
        if (!markets.length) continue;
        const day = etDay(g.date);
        for (const [market, m] of markets) {
          rows.push({
            lg, id: String(g.id),
            away: (g.away && g.away.abbr) || "",
            home: (g.home && g.home.abbr) || "",
            market, open: isNum(m.open) ? m.open : null, cur: isNum(m.cur) ? m.cur : null,
            delta: m.delta, size: Math.abs(m.delta),
            book: mv.book || "",
            sharp: !!(mv.notable && mv.notable.length),
            state: g.state || "",
            today: !!today && day === today,
          });
        }
      }
    }
    rows.sort((a, b) => b.size - a.size || a.lg.localeCompare(b.lg) || a.id.localeCompare(b.id) || a.market.localeCompare(b.market));
    const todays = rows.filter(r => r.today);
    if (todays.length) return { scope: "today", rows: todays };
    const upcoming = rows.filter(r => r.state === "pre");
    return { scope: "file", rows: upcoming.length ? upcoming : rows };
  }

  /** Higher score is the more favorable number for that side. Same rule as the public books table. */
  function quoteScore(kind, line, price) {
    const px = isNum(price) ? price : -110;
    if (kind === "ml") return line;
    if (kind === "over") return -line * 1000 + px;
    return line * 1000 + px;
  }

  /** Best posted number on each market. Hidden by the caller when fewer than two books priced it. */
  function bestPrices(g) {
    const cols = bookColumns(g);
    if (!g || cols.length < 2) return { available: false, rows: [] };
    const away = (g.away && g.away.abbr) || "Away";
    const home = (g.home && g.home.abbr) || "Home";
    const specs = [
      ["awaySpread", away + " spread", "spread", o => (isNum(o.awaySpread) ? [o.awaySpread, o.awaySpreadOdds] : null)],
      ["homeSpread", home + " spread", "spread", o => (isNum(o.homeSpread) ? [o.homeSpread, o.homeSpreadOdds] : null)],
      ["awayML", away + " ML", "ml", o => (isNum(o.awayML) ? [o.awayML, o.awayML] : null)],
      ["homeML", home + " ML", "ml", o => (isNum(o.homeML) ? [o.homeML, o.homeML] : null)],
      ["over", "Over", "over", o => (isNum(o.total) ? [o.total, o.overOdds] : null)],
      ["under", "Under", "under", o => (isNum(o.total) ? [o.total, o.underOdds] : null)],
    ];
    const rows = [];
    for (const [id, label, kind, read] of specs) {
      const quotes = [];
      for (const book of cols) {
        const got = read((g.books && g.books[book]) || {});
        if (!got) continue;
        const [line, price] = got;
        quotes.push({ book, line, price: isNum(price) ? price : null, score: quoteScore(kind, line, price) });
      }
      if (quotes.length < 2) continue;
      const bestScore = Math.max(...quotes.map(q => q.score));
      rows.push({ id, label, kind, quotes, best: quotes.filter(q => Math.abs(q.score - bestScore) < 1e-9).map(q => q.book) });
    }
    return { available: rows.length > 0, rows };
  }

  function betSide(bet) {
    const direct = bet && (bet.side || (bet.sel && bet.sel.side));
    if (direct) return String(direct);
    const s = String((bet && bet.selection) || "");
    if (/\bover\b/i.test(s)) return "over";
    if (/\bunder\b/i.test(s)) return "under";
    return "";
  }

  /** True when the bet's number is better than the close. Null when that can't be told. */
  function beatsClose(bet) {
    const c = clvPoints(bet, bet && bet.closeLine);
    if (!c.available) return null;
    const side = betSide(bet);
    if (bet.type === "total") {
      if (side === "over") return bet.line < bet.closeLine - 1e-9;
      if (side === "under") return bet.line > bet.closeLine + 1e-9;
      return null;
    }
    if (bet.type === "spread") return bet.line > bet.closeLine + 1e-9;
    return null;
  }

  /** Closing-line rows for bets that actually have a close. No number is invented. */
  function clvSummary(bets) {
    const rows = [];
    for (const b of bets || []) {
      const c = clvPoints(b, b && b.closeLine);
      if (!c.available) continue;
      rows.push({ id: String(b.id || ""), delta: c.delta, beat: beatsClose(b) });
    }
    if (!rows.length) return { available: false, n: 0, mean: null, beats: 0, judged: 0, beatRate: null, rows: [] };
    const mean = rows.reduce((s, r) => s + r.delta, 0) / rows.length;
    const judgedRows = rows.filter(r => r.beat === true || r.beat === false);
    const beats = judgedRows.filter(r => r.beat).length;
    return {
      available: true, n: rows.length, mean, beats, judged: judgedRows.length,
      beatRate: judgedRows.length ? beats / judgedRows.length : null, rows,
    };
  }

  /** Bets grouped by tag. A bet with no tag is "untagged". */
  function tagGroups(bets, tags) {
    const g = new Map();
    const add = (k, b) => { if (!g.has(k)) g.set(k, []); g.get(k).push(b); };
    for (const b of bets || []) {
      const mine = b && tags && tags[b.id];
      if (mine && mine.length) for (const t of mine) add(t, b);
      else add("untagged", b);
    }
    return [...g.entries()].map(([tag, list]) => ({ tag, bets: list }));
  }

  return {
    ACTIVE_FREE, ACTIVE_PRO, EMAIL_FREE, BOOK_KEYS, BOOK_NAME, COMING_BOOKS, TAG_KEY,
    sharpMoves, filterBoard, bookColumns, refreshInfo, clvPoints, clvSummary, beatsClose, tagGroups, historyMarkets, readTags, setTag,
    etDay, lineMoveBoard, bestPrices,
  };
});

window.__PRO_CSS = "/* Injected with the private Pro bundle. Not shipped in site/assets/styles.css. */\n.ppv-banner{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;margin:16px 0 4px;padding:12px 16px;border-radius:var(--r-sm);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);background:color-mix(in srgb,var(--accent) 12%,var(--surface));font-size:14.5px;line-height:1.4}\n.ppv-build{margin:0 0 12px;font-size:12px;line-height:1.4;color:var(--dim)}\n.ppv-banner b{font-weight:800;letter-spacing:.01em}\n.ppv-back{display:inline-block;margin-bottom:4px;color:var(--accent);font-size:13px;font-weight:650}\n.ppv-nav{margin:0 0 16px}\n.ppv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-bottom:14px}\n.ppv-card{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-height:148px;padding:16px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface);box-shadow:var(--shadow)}\n.ppv-card:hover{border-color:var(--accent-line)}\n.ppv-card b{font-size:15.5px;line-height:1.35;letter-spacing:-.01em}\n.ppv-card span{color:var(--mute);font-size:13.5px;line-height:1.45}\n.ppv-go{margin-top:auto;color:var(--accent);font-weight:700}\n.ppv-h{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px;font-size:16px}\n.ppv-h .st-sub{font-weight:500}\n.ppv-soon{display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border-radius:999px;border:1px solid var(--line2);color:var(--mute);font-size:11px;font-weight:750;letter-spacing:.02em;vertical-align:middle}\n.ppv-frow{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;margin-top:10px}\n.ppv-q{display:flex;gap:8px;align-items:flex-end}\n.ppv-q input,.ppv-form input,.ppv-form select,.ppv-books select{font:500 14px var(--font);color:var(--txt);background:var(--bg2);border:1px solid var(--line2);border-radius:var(--r-sm);min-height:40px;padding:0 10px}\n.ppv-list{display:flex;flex-direction:column;gap:8px}\n.ppv-line{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--bg2)}\n.ppv-line.on{border-color:var(--accent-line);background:var(--accent-soft)}\n.ppv-line b{display:block;font-weight:750}\n.ppv-line small{display:block;color:var(--dim);font-size:12.5px}\n.ppv-line .num{text-align:right;font-variant-numeric:tabular-nums}\n.ppv-cap-row{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline}\n.ppv-cap-row b{font-size:22px;letter-spacing:-.02em}\n.ppv-meter{height:8px;margin:10px 0 4px;border-radius:99px;background:var(--bg2);border:1px solid var(--line);overflow:hidden}\n.ppv-meter i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2))}\n.ppv-form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}\n.ppv-ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}\n.ppv-ul li{display:flex;flex-direction:column;gap:2px;padding-bottom:10px;border-bottom:1px solid var(--line);font-size:14px}\n.ppv-ul li:last-child{border-bottom:0;padding-bottom:0}\n.ppv-ul span{color:var(--mute)}\n.ppv-tags{margin:14px 0}\n.ppv-bets .chip{margin:2px 4px 2px 0}\n.ppv .card{margin-top:14px}\n.ppv .statgrid{margin:0 0 4px}\n.chip.ppv-off{opacity:.72}\n.ppv-saved{margin-top:8px}\n.ppv-saved-chip{gap:4px;padding-right:6px}\n.ppv-saved-chip a{color:inherit}\n.ppv-x{border:0;background:transparent;color:var(--mute);font:700 16px var(--font);line-height:1;padding:0 4px;cursor:pointer}\n.ppv-x:hover{color:var(--txt)}\nbody.app a.search-btn[data-pro-owner-nav]{display:inline-flex;width:auto;padding:0 12px;margin-left:8px}\n.ppv-inject{margin:8px 0 16px}\n.ppv-panel{margin-top:12px}\n.ppv-panel .ppv-h{gap:8px}\n.ppv-mks{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;align-items:start}\n.ppv-chart{display:block;width:100%;height:auto;max-height:160px;aspect-ratio:320/96;margin:2px 0 2px;color:var(--accent)}\n.ppv-chart path{stroke:currentColor;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}\n.ppv-chart circle{fill:currentColor}\n.ppv-mk{margin:0;min-width:0}\n.ppv-mk h4{margin:0 0 2px;font-size:13px}\n.ppv-mk .na{margin:0;font-size:12px;line-height:1.35}\n.ppv-apply{border:0;background:transparent;color:inherit;font:inherit;padding:0;cursor:pointer}\n.game-top .pro-pill{margin-left:6px}\n.pro-pill{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;border:1px solid #a67c00;border-left:3px solid #8a6a12;background:linear-gradient(180deg,#f8e7b0,#e0b84a);color:#1c1404;font:800 9px/1.2 var(--font);letter-spacing:.14em;text-transform:uppercase;flex:none}\n.pro-frame{border-left:3px solid #e0b84a}\n.pro-sharp{display:inline-flex;align-items:center;gap:4px;margin-left:6px;padding:2px 8px 2px 4px;border-radius:999px;background:color-mix(in srgb,#e0b84a 18%,var(--surface))}\n.pro-sharp .pro-pill{margin-left:0}\n.pro-sharp-txt{color:var(--txt);font:750 10px var(--font);letter-spacing:.06em;text-transform:uppercase}\n.pro-empty{margin:8px 0 12px;color:var(--dim);font-size:13px;line-height:1.45}\n.pro-insights{margin:14px 0 16px;border:1px solid color-mix(in srgb,#e0b84a 55%,var(--line));border-left:3px solid #e0b84a;border-radius:var(--r);background:var(--surface);box-shadow:var(--shadow)}\n.pro-insights-sum{display:flex;align-items:center;gap:8px;min-height:44px;padding:10px 14px;cursor:pointer;font-weight:750;list-style:none}\n.pro-insights-sum::-webkit-details-marker{display:none}\n.pro-insights[open]>.pro-insights-sum{border-bottom:1px solid var(--line)}\n.pro-insights-body{padding:4px 12px 12px}\n.pro-insights .ppv-panel{margin:10px 0 0}\n.ppv-book{margin:8px 0 6px;font-size:14px}\n.pro-best{background:color-mix(in srgb,#e0b84a 22%,transparent)}\n.pro-best-tag{display:inline-block;margin-left:4px;padding:1px 4px;border-radius:4px;background:#e0b84a;color:#1c1404;font:800 8px var(--font);letter-spacing:.08em;text-transform:uppercase;vertical-align:1px}\n.pro-sort{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}\n.pro-sort .chip{min-height:36px}\n[data-pro-owner] .card,[data-pro-enhance] .ppv-panel{border-left:3px solid #e0b84a}\n[data-pro-owner] h3.ppv-h:not(:has(.pro-pill))::before{content:\"PRO\";display:inline-flex;align-items:center;margin-right:6px;padding:2px 7px;border-radius:999px;border:1px solid #a67c00;border-left:3px solid #8a6a12;background:linear-gradient(180deg,#f8e7b0,#e0b84a);color:#1c1404;font:800 9px/1.2 var(--font);letter-spacing:.14em}\n.ppv-build{margin-top:18px;font-size:11px}\n.rk-meta{margin:0 0 10px;color:var(--mute);font-size:13.5px;line-height:1.45}\n.rk-pos,.rk-view{margin-top:8px}\n.rk-table{width:100%}\n.rk-table small{display:block;color:var(--dim);font-size:11px;font-weight:550;line-height:1.3}\n.rk-player{font-weight:750}\n.rk-stat{margin-top:0}\n.rk-table th.rk-on,.rk-table td.rk-on{background:color-mix(in srgb,#e0b84a 24%,transparent);box-shadow:inset 0 -2px 0 #e0b84a;font-weight:750}\n@media (max-width:720px){\n  .ppv-grid{grid-template-columns:1fr}\n  .ppv-line{align-items:flex-start}\n  .ppv-q,.ppv-form{width:100%}\n  .ppv-q input,.ppv-form input,.ppv-form select{font-size:16px}\n  .pro-insights-sum{padding:10px 12px}\n  .pro-insights-body{padding:4px 8px 10px}\n  .ppv-panel{padding:12px}\n  .pro-moves,.ppv-panel .books,.pro-insights .books{font-size:12.5px}\n  .pro-moves th,.pro-moves td{padding:6px 5px}\n  .pro-sharp-txt{font-size:9px}\n  .ppv-mks{grid-template-columns:1fr}\n  .ppv-chart{max-height:140px}\n  .rk-table{font-size:13px}\n  .rk-table th,.rk-table td{padding:8px 6px}\n  .rk-view .chip,.rk-pos .chip{min-height:40px}\n}\n";

/* LineSmart Pro screens. Loaded only after is_pro() is true, from the private bundle.
   Numbers come from the files the site already has. A panel with no numbers is left out. */
(function () {
  "use strict";
  const css = window.__PRO_CSS || "";
  if (css && !document.getElementById("pro-owner-css")) {
    const st = document.createElement("style");
    st.id = "pro-owner-css";
    st.textContent = css;
    document.head.appendChild(st);
  }
  const A = () => window.LSApp;
  const G = () => window.LSGeo;
  const F = () => window.ProFeatures;
  const Hp = () => window.HotProps;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = v => typeof v === "number" && isFinite(v);
  const num = v => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const sgn = v => (v > 0 ? "+" + v : v === 0 ? "PK" : String(v));
  const am = v => { const n = num(v); return n == null ? "—" : n > 0 ? "+" + n : String(n); };
  const money = (v, sign) => { if (!isFinite(v)) return "—"; const n = Math.abs(v).toFixed(2); return (v < -0.004 ? "−" : sign && v > 0.004 ? "+" : "") + "$" + n; };
  const pct = v => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(1) + "%");
  const ePct = e => (isNum(e) ? (e > 0 ? "+" : e < 0 ? "−" : "") + Math.abs(100 * e).toFixed(1) + "%" : "—");
  const cls = v => (v > 0.004 ? "pos" : v < -0.004 ? "neg" : "");
  const PILL = `<span class="pro-pill">PRO</span>`;
  const EMPTY = `<p class="pro-empty">Pro data appears here once lines start moving</p>`;
  const publicGame = (lg, id) => `#/g/${esc(lg)}/${esc(id)}`;
  const PROP_LEAGUES = ["nfl", "nba", "nhl", "mlb", "ncaaf", "ncaab", "ufc", "epl", "mls", "ucl"];
  const SCREEN = { props_ev: "value", alerts_25: "alerts", tracker_pro: "tracker", books_10: "books", line_history: "history", fast_refresh: "refresh" };
  const HINT = {
    props_ev: "Consensus edges and filters on the lines in the file. Prop edges appear only when the file can support them.",
    alerts_25: "Sharp-move flags from saved line movement. A higher daily email limit is not on yet.",
    tracker_pro: "Stats from My Bets on this device, plus tags kept in this browser. Closing-line value needs a closing price.",
    books_10: "Every book that posted a number in the file.",
    line_history: "The same line chart as a game page, and the sharp-move flags already on the slate.",
    fast_refresh: "How old this file is. A faster pull is not running.",
  };

  let keepScroll = false, afterPaint = () => {}, IX = null, PROPS = null, ALERTS = null;

  const parts = () => {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const segs = path.split("/");
    return { screen: segs[1] || "", a: segs[2] || "", b: segs[3] || "", q: new URLSearchParams(qs || "") };
  };
  function rootName() {
    const h = String(location.hash || "").replace(/^#\/?/, "").split("?")[0].split("/")[0];
    return h === "pro" ? "pro" : "owner";
  }
  const href = (screen, extra) => "#/" + rootName() + (screen ? "/" + screen : "") + (extra || "");
  const gameHref = (lg, id) => `${href("history")}/${esc(lg)}/${esc(id)}`;
  function hotState() {
    const q = parts().q;
    return { lg: q.get("lg") || "nfl", team: q.get("team") || "", player: q.get("player") || "", mk: q.get("mk") || "all" };
  }
  function rankState() {
    const q = parts().q;
    return { lg: q.get("lg") || "nfl", pos: q.get("pos") || "", view: q.get("view") === "hit" ? "hit" : "season", stat: q.get("stat") || "" };
  }
  function rankHash(patch) {
    const Rk = window.Rankings;
    const cur = rankState();
    const n = { ...cur, ...patch };
    const specs = Rk ? Rk.specsFor(n.lg) : [];
    if (!specs.some(s => s.id === n.pos)) n.pos = (specs[0] && specs[0].id) || "";
    const mode = Rk ? Rk.resolveStat(n.lg, n.pos, n.stat) : null;
    n.stat = mode ? mode.id : "";
    const p = new URLSearchParams();
    p.set("lg", n.lg || "nfl");
    if (n.pos) p.set("pos", n.pos);
    if (n.view === "hit") p.set("view", "hit");
    if (n.stat) p.set("stat", n.stat);
    return href("rankings") + "?" + p.toString();
  }
  function hotHash(patch) {
    const n = { ...hotState(), ...patch };
    const p = new URLSearchParams();
    if (n.lg) p.set("lg", n.lg);
    if (n.team) p.set("team", n.team);
    if (n.player) p.set("player", n.player);
    if (n.mk && n.mk !== "all") p.set("mk", n.mk);
    const s = p.toString();
    return href("hot") + (s ? "?" + s : "");
  }
  function localStore() {
    try { const k = "ls-pro-probe"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return localStorage; }
    catch (e) { return null; }
  }
  function bookBits(key) {
    const g = G();
    if (!g) return { label: "" };
    const label = g.naLabel ? g.naLabel(key) : "";
    return { label: label || "" };
  }
  const bookName = key => `${esc((F().BOOK_NAME)[key] || key)}${bookBits(key).label ? ` <span class="na-st">${esc(bookBits(key).label)}</span>` : ""}`;
  const flNote = () => `<p class="note"><b>Florida:</b> Hard Rock Bet is the only legal online sportsbook there. DraftKings and FanDuel are not available in Florida.</p>`;

  async function indexes() {
    if (IX) return IX;
    const meta = A().meta() || {};
    const order = meta.order || Object.keys(meta.leagues || {});
    const rows = await Promise.all(order.map(async lg => [lg, await A().getJSON(`data/${lg}/index.json`).catch(() => null)]));
    IX = { meta, order, by: Object.fromEntries(rows.filter(([, idx]) => idx && Array.isArray(idx.games))) };
    return IX;
  }
  const gamesOf = idx => (idx && idx.games) || [];
  const future = (idx, now) => gamesOf(idx).filter(g => g.state === "pre" && Date.parse(g.date) > now);

  const OWNER_EMAIL = "copenhaverrodney24@yahoo.com";
  // Label only. Who can open Pro is still is_pro(); this reads the stored session and does not call the network.
  function ownerAccount() {
    try {
      const key = (window.AcctCore && window.AcctCore.AUTH_KEY) || "ls-sb-auth";
      const j = JSON.parse(localStorage.getItem(key) || "null");
      const user = j && (j.user || (j.currentSession && j.currentSession.user));
      const email = user && typeof user.email === "string" ? user.email.trim() : "";
      return email.toLowerCase() === OWNER_EMAIL;
    } catch (e) { return false; }
  }
  function banner() {
    const note = ownerAccount()
      ? "Your account only. No payment. Not linked from the public site."
      : "Pro access. No payment. Not linked from the public site.";
    return `<div class="ppv-banner" role="status"><b>LineSmart Pro</b><span>${note}</span></div>`;
  }
  const labelOf = k => { const row = ((window.ProCore && window.ProCore.FEATURES) || []).find(x => x[0] === k); return row ? row[1] : k; };
  function head(screen, title, sub) {
    const mark = screen ? `<a class="lnk ppv-back" href="${href()}">Pro</a>` : `<span class="eyebrow">${ownerAccount() ? "Owner" : "Pro"}</span>`;
    return `<div class="page-head ppv-head"><div>${mark}<h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div></div>`;
  }
  function fine() {
    const rg = G() && G().rgSpan ? G().rgSpan() : `Call or text <a href="tel:18004262537">1-800-GAMBLER</a>.`;
    return `<p class="of-rg"><span class="of-21">21+</span> LineSmart is for adults 21 and older. Gambling problem? ${rg} <a href="responsible-gambling.html">Responsible gambling</a></p>
      <p class="note">Pro is data and software: odds comparison, line history, alerts and a bet tracker. It doesn't include picks or predictions, and nothing here can promise that a bet wins. Most bets lose. LineSmart doesn't take bets. Always confirm the price at the sportsbook.</p>`;
  }
  function crumbs(screen) {
    const items = [["", "Overview"], ["value", "Value"], ["alerts", "Alerts"], ["tracker", "My Bets"], ["books", "Books"], ["history", "Line history"], ["refresh", "Refresh"], ["hot", "Hot props"], ["rankings", "Rankings"]];
    return `<nav class="chips ppv-nav" aria-label="Pro">${items.map(([id, label]) => `<a class="chip${id === screen ? " on" : ""}" href="${href(id)}">${esc(label)}</a>`).join("")}</nav>`;
  }
  const shell = (screen, title, sub, body) => `<div class="ppv ppv-ready" data-pro-owner data-screen="${esc(screen)}">${banner()}${head(screen, title, sub)}${crumbs(screen)}${body}${fine()}</div>`;

  function buildLine() {
    const build = window.__PRO_BUILD || "unknown";
    const site = (window.ProGateCore && window.ProGateCore.SITE_BUILD) || "unknown";
    return `<p class="ppv-build">Pro build ${esc(build)} · site ${esc(site)}</p>`;
  }
  function signedPts(v) {
    if (!isNum(v)) return "—";
    const n = Math.round(v * 10) / 10;
    return (n > 0 ? "+" : "") + String(n);
  }
  function moveLabel(market, v) {
    if (!isNum(v)) return "—";
    return market === "spread" ? sgn(v) : String(v);
  }
  function clvBlock(clv) {
    if (!clv || !clv.available) return "";
    const mean = (clv.mean > 0 ? "+" : "") + clv.mean.toFixed(2);
    const rate = clv.beatRate == null ? "" : ` Beat the close: <b>${Math.round(clv.beatRate * 100)}%</b> (${clv.beats} of ${clv.judged}).`;
    return `<p><b>${clv.n}</b> bet${clv.n === 1 ? "" : "s"} with a closing line. Average CLV <b class="num ${cls(clv.mean)}">${esc(mean)}</b> points (close minus the bet line).${rate}</p><p class="note">A bet beats the close when its number is better than the closing number: a higher spread, a lower over, or a higher under. It is not a pick.</p>`;
  }
  function hubBets() {
    const bets = loadBets();
    if (!bets.length) return "";
    const C = window.BetCore;
    const stats = C ? C.stats(bets) : null;
    const clv = F().clvSummary(bets);
    const rec = stats ? `${stats.won}-${stats.lost}-${stats.push}` : "—";
    const net = stats ? money(stats.net, true) : "—";
    return panel("My Bets", `<div class="statgrid"><div class="stat"><span class="sl">Bets</span><b class="num">${bets.length}</b></div><div class="stat"><span class="sl">Record</span><b class="num">${esc(rec)}</b></div><div class="stat"><span class="sl">Net</span><b class="num ${cls(stats ? stats.net : 0)}">${esc(net)}</b></div></div>${clvBlock(clv)}<p><a href="#/bets">Open My Bets</a></p>`);
  }
  function boardTable(rows) {
    const body = rows.map(r => `<tr data-size="${esc(String(r.size))}" data-lg="${esc(r.lg)}"><td><a href="${publicGame(r.lg, r.id)}" data-pro-goto="game">${esc(r.away)} @ ${esc(r.home)}</a></td><td>${esc(A().lgName(r.lg))}</td><td>${esc(r.market === "total" ? "Total" : "Spread")}</td><td class="num">${esc(moveLabel(r.market, r.open))}</td><td class="num">${esc(moveLabel(r.market, r.cur))}</td><td class="num"><b>${esc(signedPts(r.delta))}</b></td></tr>`).join("");
    return `<div class="pro-sort" role="group" aria-label="Sort line moves"><button type="button" class="chip on" data-pro-sort="size" data-dir="desc" aria-pressed="true">Size</button><button type="button" class="chip" data-pro-sort="league" aria-pressed="false">League</button></div><div class="tbl-wrap"><table class="books pro-moves" id="proMoves"><thead><tr><th>Game</th><th>League</th><th>Market</th><th>Open</th><th>Now</th><th>Move</th></tr></thead><tbody>${body}</tbody></table></div><p class="note">Size is how far the spread or total moved, in points. Open and current are the numbers stored in the file.</p>`;
  }
  function sortMoves(btn) {
    const table = document.getElementById("proMoves");
    if (!table) return;
    const mode = btn.dataset.proSort || "size";
    const dir = btn.classList.contains("on") ? (btn.dataset.dir === "desc" ? "asc" : "desc") : (mode === "league" ? "asc" : "desc");
    btn.dataset.dir = dir;
    const bar = btn.parentElement;
    if (bar) bar.querySelectorAll("[data-pro-sort]").forEach(b => { const on = b === btn; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
    const tb = table.querySelector("tbody");
    const rows = [...tb.querySelectorAll("tr")];
    rows.sort((a, b) => {
      const sizeDesc = Number(b.dataset.size) - Number(a.dataset.size);
      const lgAsc = (a.dataset.lg || "").localeCompare(b.dataset.lg || "") || (Number(a.dataset.size) - Number(b.dataset.size));
      if (mode === "league") return dir === "asc" ? lgAsc : -lgAsc;
      return dir === "desc" ? sizeDesc : -sizeDesc;
    });
    rows.forEach(r => tb.appendChild(r));
  }
  async function home() {
    const now = Date.now(), { by } = await indexes();
    const map = {};
    for (const [lg, idx] of Object.entries(by)) map[lg] = gamesOf(idx);
    const board = F().lineMoveBoard(map, now);
    const shown = board.rows.slice(0, 20);
    const flags = notable(by, now);
    const todayKey = F().etDay(now);
    const todayFlags = flags.filter(x => F().etDay(x.g && x.g.date) === todayKey);
    const sharpList = (todayFlags.length ? todayFlags : flags).slice(0, 8);
    let dash = "";
    if (shown.length) {
      const title = board.scope === "today" ? "Biggest line moves today" : "Biggest line moves in the file";
      const sub = board.scope === "today"
        ? `${shown.length} market${shown.length === 1 ? "" : "s"} across the files`
        : "No game in the file starts today. These are the upcoming moves already stored.";
      const more = board.rows.length > shown.length ? `<p class="note">Showing the ${shown.length} largest of ${board.rows.length}.</p>` : "";
      dash += panel(title, `<p class="na">${esc(sub)}</p>${boardTable(shown)}${more}`);
    }
    if (sharpList.length) {
      const rows = sharpList.map(item => `<a class="ppv-line" href="${publicGame(item.lg, item.id)}" data-pro-goto="game"><span><span class="vs-lg">${esc(A().lgName(item.lg))}</span> <b>${esc(item.g.away.abbr)} @ ${esc(item.g.home.abbr)}</b><small>${item.notes.map(esc).join(" · ")}</small></span><span class="mvbadge">Sharp move</span></a>`).join("");
      dash += panel(todayFlags.length ? "Sharp-flagged games today" : "Sharp-flagged games", `<div class="ppv-list">${rows}</div><p class="note">Same flags as the slate: a large spread move, a key number crossed, or a total that moved past the sport's bar. A description of the saved line, not a pick.</p><p><a href="${href("alerts")}">All sharp flags</a></p>`);
    }
    dash += hubBets();
    if (!dash) dash = EMPTY;
    const cards = ((window.ProCore && window.ProCore.FEATURES) || []).map(([k, label]) => `<a class="ppv-card pro-frame" href="${href(SCREEN[k])}">${PILL}<b>${esc(label)}</b><span>${esc(HINT[k] || "")}</span><span class="ppv-go">Open</span></a>`).join("")
      + `<a class="ppv-card pro-frame" href="${href("rankings")}">${PILL}<b>Rankings</b><span>Top 10 at each position by season stat, and by how often they went over the current prop line. Only players the files actually cover.</span><span class="ppv-go">Open</span></a>`
      + `<a class="ppv-card pro-frame" href="${href("hot")}">${PILL}<b>Hot props</b><span>Same-line price gaps, prop line moves, and hot streaks, only from props files the site has. Saved filters stay in this browser.</span><span class="ppv-go">Open</span></a>`;
    const offers = G() && G().offersHTML ? G().offersHTML("pro") : "";
    return shell("", "LineSmart Pro", "Today's line moves, sharp flags, and My Bets, from the files already on the site.",
      `${flNote()}${dash}<h2 class="ppv-h">${PILL} Tools</h2><div class="ppv-grid">${cards}</div>
      <p class="note">Sharp-move flags, line charts, game lines, My Bets, hot props, and rankings use the data files. Nothing here calls the odds provider, takes a payment, or sends email. The public waitlist stays at <a href="#/pro">#/pro</a> for everyone else.</p>
      ${offers}${buildLine()}`);
  }

  function lineRows(lg, g) {
    const out = [];
    const away = g.away.abbr, home = g.home.abbr;
    for (const bk of F().bookColumns(g)) {
      const o = g.books[bk];
      const base = { lg, gid: String(g.id), matchup: `${away} @ ${home}`, date: g.date, book: bk };
      if (isNum(o.awaySpread)) out.push({ ...base, mk: "spread", label: `${away} ${sgn(o.awaySpread)}`, price: o.awaySpreadOdds });
      if (isNum(o.homeSpread)) out.push({ ...base, mk: "spread", label: `${home} ${sgn(o.homeSpread)}`, price: o.homeSpreadOdds });
      if (isNum(o.awayML)) out.push({ ...base, mk: "ml", label: `${away} ML`, price: o.awayML });
      if (isNum(o.homeML)) out.push({ ...base, mk: "ml", label: `${home} ML`, price: o.homeML });
      if (isNum(o.total)) {
        out.push({ ...base, mk: "total", label: `Over ${o.total}`, price: o.overOdds });
        out.push({ ...base, mk: "total", label: `Under ${o.total}`, price: o.underOdds });
      }
    }
    return out;
  }
  function realEdges(by, now) {
    const V = window.ValueCore;
    if (!V) return [];
    const rows = [];
    for (const [lg, idx] of Object.entries(by)) {
      const kind = idx.league.kind, fileNow = Date.parse(idx.generated) || now;
      for (const g of idx.games || []) {
        if (g.state !== "pre" || Date.parse(g.date) <= now) continue;
        const r = V.gameRows(lg, kind, g, idx.generated, fileNow);
        rows.push(...r.rows);
      }
    }
    const si = G() && G().isAvailable ? G().isAvailable.bind(G()) : () => true;
    return V.forState(rows, si);
  }
  async function propsDocs() {
    if (PROPS) return PROPS;
    const pairs = await Promise.all(PROP_LEAGUES.map(async lg => {
      try { return [lg, await A().getJSON(`data/props/${lg}.json`)]; }
      catch (e) { return [lg, null]; }
    }));
    PROPS = Object.fromEntries(pairs.filter(([, d]) => d && d.games));
    return PROPS;
  }
  async function propEdges(by, now) {
    const V = window.ValueCore;
    const docs = await propsDocs();
    if (!V || !Object.keys(docs).length) return { available: false, rows: [] };
    const rows = [];
    for (const [lg, doc] of Object.entries(docs)) {
      const idx = by[lg];
      if (!idx) continue;
      const kind = idx.league.kind, fileNow = Date.parse(doc.gen) || now;
      for (const g of idx.games || []) {
        const pg = doc.games[String(g.id)];
        if (!pg) continue;
        const r = V.propRows(lg, kind, g, pg, doc.players, doc.markets, doc.gen, fileNow);
        rows.push(...r.rows);
      }
    }
    if (!rows.length) return { available: false, rows: [] };
    const si = G() && G().isAvailable ? G().isAvailable.bind(G()) : () => true;
    return { available: true, rows: V.forState(rows, si) };
  }
  function vq() {
    const q = parts().q;
    const min = num(q.get("min"));
    const mk = q.get("mk");
    return { lg: q.get("lg") || "all", mk: ["all", "ml", "spread", "total", "prop"].includes(mk) ? mk : "all", min: min == null ? 0 : min, q: (q.get("q") || "").trim() };
  }
  const vHref = patch => {
    const f = { ...vq(), ...patch };
    const p = new URLSearchParams();
    if (f.lg !== "all") p.set("lg", f.lg);
    if (f.mk !== "all") p.set("mk", f.mk);
    if (f.min) p.set("min", String(f.min));
    if (f.q) p.set("q", f.q);
    const s = p.toString();
    return href("value") + (s ? "?" + s : "");
  };
  async function viewValue() {
    const now = Date.now(), { by, order, meta } = await indexes(), f = vq();
    const edges = realEdges(by, now);
    const shownE = window.ValueCore.filterRows(edges, { lg: f.lg, mk: f.mk === "prop" ? "none" : f.mk, min: f.min / 100, hours: 0, outliers: true }, now);
    let lines = [];
    for (const lg of order) if (by[lg]) for (const g of future(by[lg], now)) lines.push(...lineRows(lg, g));
    lines = F().filterBoard(lines, f);
    const props = await propEdges(by, now);
    const propRows = props.available ? F().filterBoard(props.rows.map(r => ({ ...r, edge: r.top && r.top.edge })), { ...f, mk: f.mk === "all" ? "prop" : f.mk }).filter(r => f.mk === "all" || f.mk === "prop") : [];
    const leagues = order.filter(lg => future(by[lg], now).length);
    const chips = `<div class="chips">${[["all", "All"], ...leagues.map(lg => [lg, A().lgName(lg)])].map(([k, t]) => `<a class="chip${f.lg === k ? " on" : ""}" href="${esc(vHref({ lg: k }))}">${esc(t)}</a>`).join("")}</div>`;
    const mks = [["all", "All"], ["ml", "Moneyline"], ["spread", "Spread"], ["total", "Total"], ["prop", "Player props"]];
    const seg = `<nav class="seg" aria-label="Market">${mks.map(([k, t]) => `<a href="${esc(vHref({ mk: k }))}" class="${f.mk === k ? "on" : ""}">${esc(t)}</a>`).join("")}</nav>`;
    const mins = [[-2, "−2%"], [0, "0%"], [1, "+1%"], [2, "+2%"], [3, "+3%"]];
    const edgeHtml = shownE.length ? `<section class="card pro-frame"><h3 class="ppv-h">${PILL} Consensus edges <span class="st-sub">Value finder math</span></h3><div class="ppv-list">${shownE.slice(0, 12).map(r => `<a class="ppv-line" href="${gameHref(r.lg, r.gid)}"><span><span class="vs-lg">${esc(A().lgName(r.lg))}</span> <b>${esc(r.label)}</b><small>${esc(r.matchup)}</small></span><span class="num ${cls(r.top.edge)}"><b>${esc(ePct(r.top.edge))}</b><small>${bookName(r.top.book)}</small></span></a>`).join("")}</div></section>` : "";
    const lineHtml = f.mk === "prop" || !lines.length ? "" : `<section class="card pro-frame"><h3 class="ppv-h">${PILL} Game lines in the file <span class="st-sub">${lines.length} match</span></h3><div class="ppv-list">${lines.slice(0, 12).map(r => `<a class="ppv-line" href="${gameHref(r.lg, r.gid)}"><span><span class="vs-lg">${esc(A().lgName(r.lg))}</span> <b>${esc(r.label)}</b><small>${esc(r.matchup)}</small></span><span class="num"><b class="px">${esc(am(r.price))}</b><small>${bookName(r.book)}</small></span></a>`).join("")}</div><p class="note">Prices are the ones stored in the data file${meta.generated ? ` (as of ${esc(A().fullET(meta.generated))})` : ""}. A single book is not a consensus, so these rows are the line, not an edge.</p></section>`;
    const propHtml = props.available && propRows.length ? `<section class="card pro-frame"><h3 class="ppv-h">${PILL} Props edges <span class="st-sub">${propRows.length} match</span></h3><div class="ppv-list">${propRows.slice(0, 12).map(r => `<div class="ppv-line"><span><span class="vs-lg">${esc(A().lgName(r.lg))}</span> <b>${esc(r.label)}</b><small>${esc(r.matchup)}</small></span><span class="num ${cls(r.top.edge)}"><b>${esc(ePct(r.top.edge))}</b><small>${bookName(r.top.book)}</small></span></div>`).join("")}</div><p class="note">An edge compares prices in the file. It is not a suggestion to bet.</p></section>` : "";
    const results = `${edgeHtml}${lineHtml}${propHtml}` || EMPTY;
    return shell("value", "Value finder extras", labelOf("props_ev"),
      `${flNote()}<section class="card pro-frame vf-filters" aria-label="Custom filters">${chips}<div class="ppv-frow">${seg}<form class="ppv-q" id="ppvQ"><label>Search <input name="q" value="${esc(f.q)}" maxlength="40" aria-label="Search lines"></label><button type="submit" class="chip">Filter</button></form>
        <label class="vf-sel"><span>Min edge</span><select id="ppvMin" aria-label="Minimum edge">${mins.map(([v, t]) => `<option value="${v}"${v === f.min ? " selected" : ""}>${t}</option>`).join("")}</select></label></div></section>
      ${results}`);
  }

  function notable(by, now) {
    const map = {};
    for (const [lg, idx] of Object.entries(by)) map[lg] = gamesOf(idx);
    return F().sharpMoves(map, now).map(row => {
      const g = (by[row.lg].games || []).find(x => String(x.id) === row.id);
      return { ...row, g, kind: by[row.lg].league.kind };
    }).filter(x => x.g);
  }
  async function loadAlerts() {
    if (ALERTS) return ALERTS;
    const AC = window.AcctCore, GC = window.ProGateCore;
    const tok = GC.tokenOf((() => { try { return localStorage.getItem(AC.AUTH_KEY); } catch (e) { return ""; } })());
    if (!tok) { ALERTS = []; return ALERTS; }
    try {
      const res = await fetch(AC.SB_URL + "/rest/v1/line_alerts?select=*&order=created_at.desc&limit=50", {
        headers: { apikey: AC.SB_KEY, Authorization: "Bearer " + tok, Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) { ALERTS = []; return ALERTS; }
      const body = await res.json();
      ALERTS = Array.isArray(body) ? body : [];
    } catch (e) { ALERTS = []; }
    return ALERTS;
  }
  async function viewAlerts() {
    const now = Date.now(), { by } = await indexes(), flags = notable(by, now);
    const mine = await loadAlerts();
    const C = window.AlertsCore;
    const active = mine.filter(a => C.status(a, now).key === "active").length;
    const cap = F().ACTIVE_PRO;
    const rows = flags.slice(0, 12).map(item => `<a class="ppv-line" href="${gameHref(item.lg, item.id)}"><span><span class="vs-lg">${esc(A().lgName(item.lg))}</span> <b>${esc(item.g.away.abbr)} @ ${esc(item.g.home.abbr)}</b><small>${item.notes.map(esc).join(" · ")}</small></span><span class="mvbadge">Sharp move</span></a>`).join("");
    const sharp = rows ? `<section class="card pro-frame"><h3 class="ppv-h">${PILL} Sharp-move flags <span class="st-sub">${flags.length} upcoming</span></h3><div class="ppv-list">${rows}</div><p class="note">A flag is the rule the site already uses on the slate: a large spread move, a key number crossed, or a total that moved past the sport's bar. It describes the saved line. It is not a pick.</p></section>` : "";
    const list = mine.length ? `<section class="card pro-frame"><h3 class="ppv-h">${PILL} Your alerts</h3><ul class="ppv-ul">${mine.slice(0, 25).map(a => `<li><b>${esc(C.describe(a))}</b><span>${esc(a.game_label || "")} · ${esc(C.status(a, now).text)}</span></li>`).join("")}</ul></section>` : "";
    return shell("alerts", "Line alerts", labelOf("alerts_25"),
      `${flNote()}<section class="card pro-frame ppv-cap"><div class="ppv-cap-row"><b>${active} of ${cap}</b><span>active alerts for this account · free accounts stay at ${F().ACTIVE_FREE}</span></div>
        <div class="ppv-meter" aria-hidden="true"><i style="width:${Math.min(100, active / cap * 100)}%"></i></div>
        <p class="note">The server allows ${cap} active alerts on an owner account after the migration. Emails still stop at ${F().EMAIL_FREE} a day. This page does not send email.</p></section>
      ${sharp}${list}`);
  }

  function loadBets() {
    if (window.LSBets && window.LSBets.syncState) return window.LSBets.syncState().bets || [];
    try {
      const d = JSON.parse(localStorage.getItem(window.BetCore.KEY) || "null");
      const list = Array.isArray(d && d.bets) ? d.bets : [];
      return list.map(window.BetCore.normalizeBet).filter(Boolean);
    } catch (e) { return []; }
  }
  function betLabel(b) {
    const ev = b.event && (b.event.name || [b.event.away, b.event.home].filter(Boolean).join(" @ "));
    return ev || b.eventText || b.selection || b.type || "Bet";
  }
  async function viewTracker() {
    const bets = loadBets();
    const store = localStore();
    const tags = store ? F().readTags(store) : {};
    const tag = (parts().q.get("tag") || "all").toLowerCase();
    const names = [...new Set(Object.values(tags).flat())].sort();
    const shown = bets.filter(b => tag === "all" || (tags[b.id] || []).includes(tag));
    const stats = window.BetCore.stats(shown);
    const clvAll = F().clvSummary(shown);
    const chips = ["all", ...names].map(t => `<a class="chip${tag === t ? " on" : ""}" href="${href("tracker")}${t === "all" ? "" : "?tag=" + encodeURIComponent(t)}">${esc(t === "all" ? "All tags" : t)}</a>`).join("");
    if (!shown.length) return shell("tracker", "My Bets extras", labelOf("tracker_pro"), `${chips ? `<div class="chips ppv-tags" role="group" aria-label="Tags">${chips}</div>` : ""}${EMPTY}`);
    const box = (k, v, sub, c) => `<div class="stat"><span class="sl">${esc(k)}</span><b class="num ${c || ""}">${v}</b>${sub ? `<span class="ss">${sub}</span>` : ""}</div>`;
    const rec = `${stats.won}-${stats.lost}-${stats.push}`;
    const clvHead = clvAll.available ? `<th>CLV</th>` : "";
    const table = `<div class="tbl-wrap"><table class="books ppv-bets"><thead><tr><th>Bet</th><th>Status</th><th>Stake</th><th>Net</th>${clvHead}<th>Tags</th></tr></thead><tbody>${shown.slice(0, 20).map(b => {
      const net = window.BetCore.netResult(b);
      const clv = F().clvPoints(b, b.closeLine);
      const mine = tags[b.id] || [];
      const clvCell = clvAll.available ? `<td class="num">${clv.available ? esc((clv.delta > 0 ? "+" : "") + clv.delta) : "—"}</td>` : "";
      return `<tr><td>${esc(betLabel(b))}<small class="na"> ${esc(b.date || "")}</small></td><td>${esc(b.status || "pending")}</td><td class="num">${esc(money(Number(b.stake) || 0))}</td><td class="num ${cls(net)}">${esc(money(net, true))}</td>${clvCell}<td>${mine.map(t => `<span class="chip">${esc(t)}</span>`).join(" ")}${store ? `<form class="ppv-form" data-ppv-tag="${esc(b.id)}"><input name="tag" maxlength="24" aria-label="Tag" placeholder="Tag"><button type="submit" class="chip">Add</button></form>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>`;
    return shell("tracker", "My Bets extras", labelOf("tracker_pro"),
      `<div class="statgrid bt-stats">${box("Net", money(stats.net, true), "from My Bets", cls(stats.net))}${box("ROI", pct(stats.roi), "", cls(stats.roi || 0))}${box("Record", rec, `${stats.n} bets`)}${box("Win rate", stats.winRate == null ? "—" : (stats.winRate * 100).toFixed(0) + "%", "pushes excluded")}</div>
      ${clvBlock(clvAll)}
      <div class="chips ppv-tags" role="group" aria-label="Tags">${chips}</div>
      <section class="card pro-frame">${table}<p class="note">Tags stay in this browser. They are not sent to an account, and they don't turn Pro on.</p></section>`);
  }

  function cell(g, key, label, line, price) {
    const o = g.books && g.books[key];
    if (!o) return "";
    if (label.endsWith("ML")) {
      const n = label.startsWith(g.away.abbr) ? o.awayML : o.homeML;
      return isNum(n) ? `<b>${esc(am(n))}</b>` : "";
    }
    if (label === "Over" || label === "Under") {
      if (!isNum(o.total)) return "";
      const px = label === "Over" ? o.overOdds : o.underOdds;
      return `<b>${esc(o.total)}</b> <span class="na">${esc(am(px))}</span>`;
    }
    const side = label.startsWith(g.home.abbr) ? "home" : "away";
    const ln = o[side + "Spread"], px = o[side + "SpreadOdds"];
    if (!isNum(ln)) return "";
    return `<b>${esc(sgn(ln))}</b> <span class="na">${esc(am(px))}</span>`;
  }
  async function viewBooks() {
    const now = Date.now(), { by, order } = await indexes();
    const games = [];
    for (const lg of order) for (const g of future(by[lg], now)) if (F().bookColumns(g).length) games.push({ lg, g });
    const pa = parts();
    const cur = games.find(x => x.lg === pa.a && String(x.g.id) === String(pa.b)) || games[0];
    if (!cur) return shell("books", "More sportsbooks", labelOf("books_10"), EMPTY);
    const g = cur.g;
    const cols = G() && G().sortBooks ? G().sortBooks(F().BOOK_KEYS.slice()) : F().BOOK_KEYS.slice();
    const headR = cols.map(k => {
      const st = bookBits(k);
      return `<th>${esc(F().BOOK_NAME[k] || k)}${st.label ? `<span class="na-st">${esc(st.label)}</span>` : ""}</th>`;
    }).join("");
    const markets = [
      [g.away.abbr + " spread"],
      [g.home.abbr + " spread"],
      [g.away.abbr + " ML"],
      [g.home.abbr + " ML"],
      ["Over"],
      ["Under"],
    ];
    const body = markets.map(([label]) => {
      const cells = cols.map(k => cell(g, k, label));
      if (!cells.some(Boolean)) return "";
      return `<tr><td>${esc(label)}</td>${cells.map(c => `<td class="num">${c || "—"}</td>`).join("")}</tr>`;
    }).join("");
    const sel = `<label class="vf-sel"><span>Game</span><select id="ppvGame" aria-label="Game">${games.slice(0, 40).map(x => `<option value="${esc(x.lg)}/${esc(x.g.id)}"${x.lg === cur.lg && String(x.g.id) === String(g.id) ? " selected" : ""}>${esc(A().lgName(x.lg))} · ${esc(x.g.away.abbr)} @ ${esc(x.g.home.abbr)}</option>`).join("")}</select></label>`;
    const offers = G() && G().offersHTML ? G().offersHTML("pro") : "";
    const table = body ? `<div class="tbl-wrap"><table class="books"><thead><tr><th>Market</th>${headR}</tr></thead><tbody>${body}</tbody></table></div><p class="note">Only books with a number in the file get a column. An empty cell means that book didn't post this market. No price is filled in. Pinnacle isn't listed.</p>` : EMPTY;
    return shell("books", "More sportsbooks", labelOf("books_10"),
      `${flNote()}<section class="card pro-frame ppv-books"><div class="ppv-frow">${sel}<span class="na">${esc(g.away.name)} at ${esc(g.home.name)}</span></div>
        ${table}</section>
      ${offers}`);
  }

  async function viewHistory() {
    const now = Date.now(), { by } = await indexes(), flags = notable(by, now);
    const lg = parts().a || (flags[0] && flags[0].lg);
    const id = parts().b || (flags[0] && flags[0].id);
    const item = flags.find(x => x.lg === lg && String(x.id) === String(id)) || flags[0];
    let chart = "";
    if (item) {
      try {
        const d = await A().getJSON(`data/${item.lg}/games/${item.g.id}.json`);
        const sec = A().lineMoveSection(d, d.game, item.kind);
        chart = sec.html || "";
        afterPaint = sec.wire || (() => {});
      } catch (e) { chart = ""; }
    }
    const list = flags.slice(0, 12).map(x => {
      const on = item && x.lg === item.lg && String(x.id) === String(item.id);
      return `<a class="ppv-line${on ? " on" : ""}" href="${href("history")}/${esc(x.lg)}/${esc(x.id)}"><span><span class="vs-lg">${esc(A().lgName(x.lg))}</span> <b>${esc(x.g.away.abbr)} @ ${esc(x.g.home.abbr)}</b><small>${x.notes.map(esc).join(" · ")} · ${bookName(x.book || "draftkings")}</small></span><span class="mvbadge">Sharp move</span></a>`;
    }).join("");
    const sharp = list ? `<section class="card pro-frame"><h3 class="ppv-h">${PILL} Sharp-move flags <span class="st-sub">${flags.length} upcoming</span></h3><div class="ppv-list">${list}</div><p class="note">Same flags as the slate. A description of the saved line, not a pick.</p></section>` : "";
    const chartBlock = chart ? `<section class="card pro-frame">${chart}</section>` : "";
    const histBody = sharp || chartBlock ? `${flNote()}${sharp}${chartBlock}` : `${flNote()}${EMPTY}`;
    return shell("history", "Line history", labelOf("line_history"), histBody);
  }

  async function viewRefresh() {
    const { meta, by, order } = await indexes();
    const info = F().refreshInfo(meta.generated, Date.now());
    const rows = (order || []).map(lg => {
      const L = (meta.leagues || {})[lg] || {}, idx = by[lg];
      const t = L.updated || (idx && idx.generated);
      const age = t ? ((Date.now() - Date.parse(t)) / 36e5) : null;
      return `<tr><td>${esc(L.name || A().lgName(lg))}</td><td class="num">${t ? esc(A().fullET(t)) : "—"}</td><td class="num">${age == null ? "—" : esc(age.toFixed(1))}</td></tr>`;
    }).join("");
    const ageCard = info.ageHours == null ? "" : `<section class="card pro-frame"><div class="statgrid">${[
        ["File age", info.ageHours.toFixed(1) + " h", "since the data file"],
        ["Cadence today", "about " + info.cadenceMin + " min", "how the site refreshes"],
      ].map(([k, v, s]) => `<div class="stat"><span class="sl">${esc(k)}</span><b class="num">${esc(v)}</b><span class="ss">${esc(s)}</span></div>`).join("")}</div>
        <p class="note">This page does not fetch new odds and does not call the odds provider.</p></section>`;
    return shell("refresh", "Faster refresh", labelOf("fast_refresh"),
      `${ageCard}<section class="card pro-frame"><h3 class="ppv-h">${PILL} When each league file was written</h3><div class="tbl-wrap"><table class="books"><thead><tr><th>League</th><th>Updated</th><th>Hours ago</th></tr></thead><tbody>${rows}</tbody></table></div></section>`);
  }

  function preferBooks() {
    const g = G();
    const order = ["hardrockbet", "draftkings", "fanduel"];
    if (!g || !g.sortBooks) return order;
    const keys = g.sortBooks(order).filter(k => !g.isAvailable || g.isAvailable(k));
    return keys.length ? keys : ["hardrockbet"];
  }
  function quoteLine(gap) {
    const by = Object.fromEntries(gap.quotes.map(q => [q.key, q]));
    const order = G() && G().sortBooks ? G().sortBooks(gap.quotes.map(q => q.key)) : gap.quotes.map(q => q.key);
    return order.map(k => {
      const q = by[k], st = bookBits(k);
      return `${(F().BOOK_NAME)[k] || k} ${am(q.price)}${st.label ? " (" + st.label + ")" : ""}`;
    }).join(" · ");
  }
  const Pnum = v => (isNum(v) ? String(Math.round(v * 10) / 10) : "—");
  async function viewHot() {
    const H = Hp();
    if (!H) return shell("hot", "Hot props", "Price gaps, line moves, and recent overs.", `<div class="empty"><h3>Hot props didn't load</h3></div>`);
    const docs = await propsDocs();
    const f = hotState();
    const labels = H.SPORT_LABEL;
    const all = H.collect(docs);
    const sportAll = all.filter(r => r.lg === f.lg);
    const filtered = H.applyFilters(all, f);
    const extra = H.sportList(docs).filter(k => !H.SPORT_FIRST.includes(k));
    const chips = [...H.SPORT_FIRST, ...extra].map(k => {
      const has = !!(docs[k] && docs[k].games && Object.keys(docs[k].games).length);
      return `<a class="chip${f.lg === k ? " on" : ""}${has ? "" : " ppv-off"}" href="${esc(hotHash({ lg: k, team: "", player: "", mk: "all" }))}">${esc(labels[k] || k.toUpperCase())}${has ? "" : ` <span class="na">no file</span>`}</a>`;
    }).join("");
    const teams = [...new Set(sportAll.map(r => r.team).filter(Boolean))].sort();
    const teamRows = f.team ? sportAll.filter(r => r.team === f.team || r.teamId === f.team) : sportAll;
    const players = [];
    const seenP = new Set();
    for (const r of teamRows) if (!seenP.has(r.pid)) { seenP.add(r.pid); players.push(r); }
    players.sort((a, b) => a.name.localeCompare(b.name));
    const playerRows = f.player ? teamRows.filter(r => r.pid === f.player || r.name.toLowerCase().includes(f.player.toLowerCase())) : teamRows;
    const mks = [];
    const seenM = new Set();
    for (const r of playerRows) if (!seenM.has(r.mk)) { seenM.add(r.mk); mks.push({ mk: r.mk, label: r.label }); }
    const sel = (id, label, options) => `<label class="vf-sel"><span>${label}</span><select id="${id}" aria-label="${label}">${options}</select></label>`;
    const teamSel = sel("ppvHotTeam", "Team", `<option value="">All teams</option>${teams.map(t => `<option value="${esc(t)}"${t === f.team ? " selected" : ""}>${esc(t)}</option>`).join("")}`);
    const playerSel = sel("ppvHotPlayer", "Player", `<option value="">All players</option>${players.map(p => `<option value="${esc(p.pid)}"${p.pid === f.player ? " selected" : ""}>${esc(p.name)}${p.team ? ` (${esc(p.team)})` : ""}</option>`).join("")}`);
    const mkSel = sel("ppvHotMk", "Prop type", `<option value="all"${f.mk === "all" ? " selected" : ""}>All props</option>${mks.map(p => `<option value="${esc(p.mk)}"${p.mk === f.mk ? " selected" : ""}>${esc(p.label)}</option>`).join("")}`);
    const store = localStore();
    const saved = store ? H.readSaved(store) : [];
    const savedHtml = saved.length ? `<div class="chips ppv-saved" aria-label="Saved filters">${saved.map(s => `<span class="chip ppv-saved-chip"><a href="${esc(hotHash({ lg: s.lg, team: s.team, player: s.player, mk: s.mk || "all" }))}">${esc(s.name)}</a><button type="button" class="ppv-x" data-ppv-hot-del="${esc(s.id)}" aria-label="${esc("Delete saved filter " + s.name)}">×</button></span>`).join("")}</div>` : "";
    const file = docs[f.lg];
    let lists;
    if (!file) {
      lists = EMPTY;
    } else {
      lists = "";
      if (H.hasPrices(sportAll)) {
        const gaps = H.priceGaps(filtered);
        const shownG = gaps.slice(0, 12);
        if (shownG.length) lists += `<section class="card pro-frame" id="ppvGaps"><h3 class="ppv-h">${PILL} Price gaps on the same line <span class="st-sub">${gaps.length} in this filter</span></h3><div class="ppv-list">${shownG.map(g => `<div class="ppv-line"><span><span class="vs-lg">${esc(labels[g.lg] || g.lg.toUpperCase())}</span> <b>${esc(g.name)} · ${esc(g.label)}</b><small>${esc(g.team)} · O/U ${esc(Pnum(g.line))} · ${g.side === "under" ? "Under" : "Over"}</small><small>${esc(quoteLine(g))}</small></span><span class="num"><b>${esc((g.gap * 100).toFixed(1))} pts</b><small>implied gap</small></span></div>`).join("")}</div><p class="note">The gap is the difference in implied probability between books that posted this exact number. A different number is not included. It is not a suggestion to bet either price.</p></section>`;
      }
      if (H.hasOpen(sportAll)) {
        const moves = H.lineMoves(filtered);
        const shownM = moves.slice(0, 12);
        if (shownM.length) lists += `<section class="card pro-frame" id="ppvMoves"><h3 class="ppv-h">${PILL} Prop line moves <span class="st-sub">${moves.length} in this filter</span></h3><div class="ppv-list">${shownM.map(m => `<div class="ppv-line"><span><span class="vs-lg">${esc(m.team)}</span> <b>${esc(m.name)} · ${esc(m.label)}</b><small>O/U ${esc(Pnum(m.line))} · ${esc(m.text)}</small></span><span class="num"><b>${m.delta > 0 ? "+" : ""}${esc(String(Math.round(m.delta * 10) / 10))}</b><small>from the open</small></span></div>`).join("")}</div><p class="note">The opening number is the one stored on the prop row. It describes that file. It is not a prediction.</p></section>`;
      }
      const prefer = preferBooks();
      if (H.hotStreaks(sportAll, prefer).available) {
        const hot = H.hotStreaks(filtered, prefer).rows;
        const shownH = hot.slice(0, 12);
        if (shownH.length) lists += `<section class="card pro-frame" id="ppvHotStreaks"><h3 class="ppv-h">${PILL} Hot streaks <span class="st-sub">${hot.length} in this filter</span></h3><div class="ppv-list">${shownH.map(h => `<div class="ppv-line"><span><span class="vs-lg">${esc(h.team)}</span> <b>${esc(h.name)} · ${esc(h.label)}</b><small>O/U ${esc(Pnum(h.gradedLine))} · ${esc(h.text)} in the last games played</small><small>Past results only.</small></span></div>`).join("")}</div><p class="note">Same rule as the props page: over in at least 4 of the last 5 games played, or the same share when fewer games are in the log. This is a count of past games, not a pick.</p></section>`;
      }
      if (!lists) lists = EMPTY;
    }
    const offers = G() && G().offersHTML ? G().offersHTML("pro") : "";
    const src = Object.entries(docs).map(([k, d]) => `${labels[k] || k.toUpperCase()}`).join(", ");
    return shell("hot", "Hot props", "Price gaps, opening-line moves, and recent overs from the props file.",
      `${flNote()}<p class="note">Built from props files on the site${src ? " (" + esc(src) + ")" : ""}. Nothing here calls the odds provider. Saved filters stay in this browser only.</p>
      <section class="card ppv-filters" aria-label="Hot props filters"><div class="chips" role="group" aria-label="Sport">${chips}</div><div class="ppv-frow">${teamSel}${playerSel}${mkSel}</div>
        <form id="ppvHotSave" class="ppv-form"><label class="vf-sel"><span>Save this filter</span><input name="name" maxlength="40" placeholder="Name" aria-label="Saved filter name"></label><button type="submit" class="chip">Save in this browser</button></form>
        <p class="ppv-out" id="ppvHotErr" role="alert"></p>
        ${savedHtml ? `<h3 class="ppv-h">Saved filters</h3>${savedHtml}` : ""}</section>
      ${lists}
      ${offers}`);
  }

  function lineText(line) {
    if (!isNum(line)) return "—";
    const t = Math.round(line * 10) / 10;
    return "O/U " + (Number.isInteger(t) ? String(t) : String(t));
  }
  function bookLabel(key) {
    if (!key) return "";
    const names = (F() && F().BOOK_NAME) || {};
    return names[key] || key;
  }
  function whenIso(iso) {
    if (!iso) return "";
    try { return A() && A().fullET ? A().fullET(iso) : String(iso); }
    catch (e) { return String(iso); }
  }
  async function loadPropsDoc(lg) {
    const api = A();
    if (!api || !api.getJSON) return null;
    try {
      const doc = await api.getJSON(`data/props/${lg}.json`);
      if (doc && doc.games && Object.keys(doc.games).length) return doc;
    } catch (e) { /* no props file for this league */ }
    return null;
  }
  async function viewRankings() {
    const Rk = window.Rankings;
    if (!Rk) return shell("rankings", "Rankings", "Top 10 by position.", `<p class="pro-empty">Rankings didn't load.</p>`);
    const st = rankState();
    const lg = Rk.LEAGUES.some(([id]) => id === st.lg) ? st.lg : "nfl";
    const specs = Rk.specsFor(lg);
    const spec = specs.find(s => s.id === st.pos) || specs[0] || null;
    const pos = spec ? spec.id : "";
    const view = st.view === "hit" ? "hit" : "season";
    const label = (Rk.LEAGUES.find(([id]) => id === lg) || [, lg.toUpperCase()])[1];
    const pack = (window.RankingsData && window.RankingsData.leagues && window.RankingsData.leagues[lg]) || null;
    const statMode = Rk.resolveStat(lg, pos, st.stat, pack && pack.players);
    const statId = statMode ? statMode.id : "";
    const chips = `<div class="chips" role="group" aria-label="League">${Rk.LEAGUES.map(([id, name]) => `<a class="chip${id === lg ? " on" : ""}" href="${rankHash({ lg: id })}"${id === lg ? ' aria-current="true"' : ""}>${esc(name)}</a>`).join("")}</div>`;
    const posChips = specs.length ? `<div class="chips rk-pos" role="group" aria-label="Position">${specs.map(s => `<a class="chip${s.id === pos ? " on" : ""}" href="${rankHash({ lg, pos: s.id, view })}"${s.id === pos ? ' aria-current="true"' : ""}>${esc(s.label)}</a>`).join("")}</div>` : "";
    const viewChips = `<div class="chips rk-view" role="group" aria-label="Ranking">${[["season", "Season stats"], ["hit", "Prop hit rate"]].map(([id, name]) => `<a class="chip${view === id ? " on" : ""}" href="${rankHash({ lg, pos, view: id, stat: statId })}"${view === id ? ' aria-current="true"' : ""}>${esc(name)}</a>`).join("")}</div>`;
    const statModes = view === "season" ? Rk.statModes(lg, pos, pack && pack.players) : [];
    const statChips = statModes.length ? `<div class="chips rk-stat" role="group" aria-label="Rank by">${statModes.map(m => `<a class="chip${m.id === statId ? " on" : ""}" href="${rankHash({ lg, pos, view, stat: m.id })}"${m.id === statId ? ' aria-current="true"' : ""}>${esc(m.label)}</a>`).join("")}</div>` : "";
    const filters = `<section class="card ppv-filters" aria-label="Rankings filters">${chips}${posChips}<div class="ppv-frow">${viewChips}${statChips}</div></section>`;
    let body = "";
    if (view === "season") {
      if (!pack || !spec) {
        body = `<p class="pro-empty">No season player stats for ${esc(label)}. NFL and NBA are the leagues with a box-score cache. Nothing is filled in for the rest.</p>`;
      } else {
        const board = Rk.seasonBoard(pack.players, spec, Rk.TOP_N, statId);
        const statName = board.statNote || (spec.cols[0] && spec.cols[0][1]) || "the stat";
        const kind = spec.perGame ? `${esc(statName)} are per game, from games he appeared in.` : `${esc(statName)} are season totals.`;
        const through = pack.through ? ` through ${esc(whenIso(pack.through))}` : "";
        const lead = board.total ? `Top ${board.rows.length} of ${board.total} by ${esc(statName).toLowerCase()}.` : `No ${esc(spec.label)} with ${esc(statName).toLowerCase()} in the cache.`;
        const headCells = (board.cols || []).map(c => `<th class="${c.on ? "rk-on" : ""}">${esc(c.label)}</th>`).join("");
        const table = board.rows.length ? `<div class="tbl-wrap"><table class="books rk-table"><thead><tr><th>Rank</th><th>Player</th><th>Team</th><th>GP</th>${headCells}</tr></thead><tbody>${board.rows.map(r => `<tr><td class="num">${r.rank}</td><td><a class="rk-player" href="${esc(Rk.playerHash(lg, r.id))}">${esc(r.name)}</a></td><td>${esc(r.team || "—")}</td><td class="num">${r.gp}</td>${r.cells.map(c => `<td class="num${c.on ? " rk-on" : ""}">${esc(c.text)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="pro-empty">No ${esc(spec.label)} with ${esc(statName).toLowerCase()} in the cache.</p>`;
        const sampleFloor = spec.perGame && board.minGp > 1 ? ` Players with fewer than ${board.minGp} games are left off. The most games anyone at this position played is ${board.maxGp}.` : "";
        const noThrees = lg === "nba" && !Rk.nbaThrees(pack.players) ? `<p class="note">3-pointers made are not in this box-score cache, so that rank is hidden.</p>` : "";
        body = `<p class="rk-meta">${lead} ${pack.boxGames} regular-season games in the cache${through}. ${kind}${sampleFloor} Games played is how many of those games he appeared in. Postseason games are not in the cache.</p>${table}<p class="note">Counting stats from the cached ESPN box scores. The highlighted column is the one this list is ranked by. A roster name is required. Completed games only.</p>${noThrees}`;
      }
    } else {
      const live = await loadPropsDoc(lg);
      const prefer = preferBooks();
      let src = "none", pulled = "", saw = false, entries = [], gameNote = "";
      if (live) {
        const got = Rk.fromProps(live, spec, prefer, null, lg);
        saw = got.saw; entries = got.entries; src = "file";
        const nGames = Object.keys(live.games || {}).length;
        gameNote = `${nGames} game${nGames === 1 ? "" : "s"} in the props file.`;
      } else if (pack && pack.props && pack.props.length && spec) {
        const got = Rk.fromPack(pack.props, spec, prefer);
        saw = got.saw; entries = got.entries; src = "pack";
        pulled = pack.propsPulledAt ? ` Stored lines as of ${whenIso(pack.propsPulledAt)}.` : "";
        const nGames = pack.propsGames || 0;
        gameNote = nGames ? `${nGames} upcoming game${nGames === 1 ? "" : "s"} in that pull have lines.` : "";
      }
      const ranked = spec ? Rk.rankHits(entries) : { rows: [], total: 0, basis: null, min: Rk.HIT_MIN };
      if (!spec || (!live && !(pack && pack.props && pack.props.length))) {
        body = `<p class="pro-empty">No props data for ${esc(label)}. Hit rate stays blank. Nothing is estimated.</p>`;
      } else if (!saw || !entries.length) {
        body = `<p class="pro-empty">No ${esc(spec.label)} ${esc(spec.hitLabel).toLowerCase()} line from a book available in your state. A line that book did not post is left off.</p><p class="note">${esc(gameNote)} The list uses the current number only.</p>`;
      } else if (!ranked.rows.length) {
        body = `<p class="pro-empty">${entries.length} ${esc(spec.label)} ${entries.length === 1 ? "has a line" : "have lines"}, and none ${entries.length === 1 ? "has" : "have"} ${ranked.min} games against it. The minimum sample is ${ranked.min}. The list stays empty.</p>`;
      } else {
        const windowLabel = Rk.basisLabel(ranked.basis);
        const table = `<div class="tbl-wrap"><table class="books rk-table"><thead><tr><th>Rank</th><th>Player</th><th>Team</th><th>Line</th><th>Over</th><th>Rate</th></tr></thead><tbody>${ranked.rows.map(r => `<tr><td class="num">${r.rank}</td><td><a class="rk-player" href="${esc(Rk.playerHash(lg, r.id))}">${esc(r.name)}</a></td><td>${esc(r.team || "—")}</td><td class="num">${esc(lineText(r.line))}<small>${esc(bookLabel(r.book))}${ranked.basis === "mixed" ? ` · ${esc(Rk.basisLabel(r.basis))}` : ""}</small></td><td class="num"><b>${esc(r.text)}</b></td><td class="num">${esc(r.pct == null ? "—" : Math.round(r.pct * 100) + "%")}</td></tr>`).join("")}</tbody></table></div>`;
        const showing = ranked.total > ranked.rows.length ? `Top ${ranked.rows.length} of ${ranked.total}.` : `${ranked.rows.length} player${ranked.rows.length === 1 ? "" : "s"} with at least ${ranked.min} games.`;
        const srcNote = src === "file"
          ? "From the props file on the site. A season tally in that file is every cached game against the current line. When the file has no season tally, the row is the last 10 logged games, and it is labeled that way."
          : `From the props lines stored with the box-score cache.${pulled} The live props file is not on this copy of the site. Each played game in the cache is graded against that current line.`;
        body = `<p class="rk-meta">${esc(windowLabel)}. ${showing} ${esc(spec.hitLabel)} for ${esc(spec.label)}. ${esc(gameNote)} ${esc(rSampleNote(ranked))}</p>${table}<p class="note">${srcNote} ${esc(sampleExplain())}</p>`;
      }
    }
    const sub = view === "hit" ? "How often each player went over the current prop line." : "Top 10 at each position by the counting stat for that spot.";
    const offers = G() && G().offersHTML ? G().offersHTML("pro") : "";
    return shell("rankings", "Rankings", sub,
      `${flNote()}${filters}<section class="card pro-frame" id="proRankings" data-rk-lg="${esc(lg)}" data-rk-pos="${esc(pos)}" data-rk-view="${esc(view)}" data-rk-stat="${esc(statId)}"><h3 class="ppv-h">${PILL} ${view === "hit" ? "Prop hit rate" : "Season stats"} <span class="st-sub">${esc(label)}${pos ? " · " + esc(pos) : ""}</span></h3>${body}</section>${offers}`);
  }
  function rSampleNote(ranked) {
    if (!ranked || !ranked.rows || !ranked.rows.length) return "";
    const ex = ranked.rows[0];
    return ex && ex.text ? `The Over column is overs out of games played, for example ${ex.text}.` : "";
  }
  function sampleExplain() {
    return "Over means the game was higher than today's number. A push counts as a game and not as an over. Today's number is not the line that was posted for that game. Past results only. Not a pick.";
  }

  async function render(screen) {
    if (screen === "value") return viewValue();
    if (screen === "alerts") return viewAlerts();
    if (screen === "tracker") return viewTracker();
    if (screen === "books") return viewBooks();
    if (screen === "history") return viewHistory();
    if (screen === "refresh") return viewRefresh();
    if (screen === "hot") return viewHot();
    if (screen === "rankings") return viewRankings();
    return home();
  }

  async function view() {
    const app = document.getElementById("app"), api = A();
    if (!app || !api) return;
    if (window.LSLive && window.LSLive.stop) window.LSLive.stop();
    api.renderTabs(null);
    const intro = document.getElementById("intro");
    if (intro) intro.hidden = true;
    const homeStates = document.getElementById("homeStates");
    if (homeStates) homeStates.hidden = true;
    const y = keepScroll ? window.scrollY : 0;
    keepScroll = false;
    if (!y) window.scrollTo(0, 0);
    const tok = api.nav(), screen = parts().screen;
    afterPaint = () => {};
    document.title = "LineSmart";
    app.innerHTML = `<div class="ppv ppv-ready" data-pro-owner data-screen="${esc(screen)}">${banner()}<div class="card"><span class="bt-spin" aria-hidden="true"></span> Loading…</div></div>`;
    let html;
    try { html = await render(screen); }
    catch (e) { html = shell(screen, "LineSmart Pro", "Something didn't load.", `<div class="empty"><h3>Couldn't load this page</h3>Reload to try again.</div>`); console.warn(e); }
    if (tok !== api.nav()) return;
    app.innerHTML = html;
    if (y) window.scrollTo(0, y);
    try { afterPaint(); } catch (e) { console.warn(e); }
    bind(app);
  }

  function bind(app) {
    if (app.dataset.proBound) return;
    app.dataset.proBound = "1";
    app.addEventListener("submit", e => {
      if (e.target.closest && e.target.closest("[data-pro-enhance]")) return;
      const q = e.target.closest && e.target.closest("#ppvQ");
      const hot = e.target.closest && e.target.closest("#ppvHotSave");
      const tag = e.target.closest && e.target.closest("[data-ppv-tag]");
      if (q) {
        e.preventDefault();
        location.hash = vHref({ q: String(new FormData(q).get("q") || "").trim() });
      }
      if (hot) { e.preventDefault(); saveHot(hot); }
      if (tag) {
        e.preventDefault();
        const store = localStore();
        const name = new FormData(tag).get("tag");
        if (store) F().setTag(store, tag.dataset.ppvTag, name, true);
        keepScroll = true;
        view();
      }
    });
    app.addEventListener("change", e => {
      const t = e.target;
      if (t.closest && t.closest("[data-pro-enhance]")) return;
      if (t.id === "ppvMin") location.hash = vHref({ min: Number(t.value) });
      if (t.id === "ppvGame") location.hash = href("books") + "/" + t.value;
      if (t.id === "ppvHotTeam") location.hash = hotHash({ team: t.value, player: "", mk: "all" });
      if (t.id === "ppvHotPlayer") location.hash = hotHash({ player: t.value, mk: "all" });
      if (t.id === "ppvHotMk") location.hash = hotHash({ mk: t.value });
    });
    app.addEventListener("click", e => {
      const sort = e.target.closest && e.target.closest("[data-pro-sort]");
      if (sort) { e.preventDefault(); sortMoves(sort); return; }
      if (e.target.closest && e.target.closest("[data-pro-enhance]")) return;
      const del = e.target.closest && e.target.closest("[data-ppv-hot-del]");
      if (del) {
        e.preventDefault();
        const store = localStore();
        if (store && Hp()) Hp().removeSaved(store, del.dataset.ppvHotDel);
        keepScroll = true;
        view();
      }
    });
  }
  function saveHot(form) {
    const name = new FormData(form).get("name");
    const store = localStore();
    const err = document.getElementById("ppvHotErr");
    if (!store || !Hp()) { if (err) err.textContent = "This browser isn't storing filters."; return; }
    const r = Hp().addSaved(store, { ...hotState(), name, id: Date.now().toString(36) });
    if (!r.ok) { if (err) err.textContent = r.error; return; }
    keepScroll = true;
    view();
  }

  function addNav() {
    if (document.querySelector("[data-pro-owner-nav]")) return;
    const bar = document.querySelector(".topbar-inner");
    if (!bar) return;
    const a = document.createElement("a");
    a.className = "search-btn";
    a.href = "#/owner";
    a.dataset.proOwnerNav = "1";
    a.textContent = "Pro";
    a.title = "LineSmart Pro";
    const inst = document.getElementById("installBtn");
    bar.insertBefore(a, inst || null);
  }
  function boot() {
    addNav();
    window.LSProApp.alertCap = F().ACTIVE_PRO;
    watchSlate();
    watchApp();
    bindEmbed();
  }
  function hide() {
    const a = document.querySelector("[data-pro-owner-nav]");
    if (a) a.remove();
    document.querySelectorAll("[data-pro-enhance], [data-pro-badge]").forEach(el => el.remove());
    if (window.LSProApp) delete window.LSProApp.alertCap;
    IX = null; PROPS = null; ALERTS = null;
    embedHot = null;
    if (window.ProGateCore && window.ProGateCore.isOwnerHash(location.hash)) location.hash = "#/";
  }

  let paint = 0, embedHot = null, embedBound = false, slateWatch = false;
  function panel(title, body) {
    if (!body) return "";
    return `<section class="card pro-frame ppv-panel"><h3 class="ppv-h">${PILL} ${title}</h3>${body}</section>`;
  }
  function insights(parts) {
    const inner = parts.filter(Boolean).join("");
    if (!inner) return EMPTY;
    return `<details class="pro-insights pro-frame" open><summary class="pro-insights-sum">${PILL} <span>Pro insights</span></summary><div class="pro-insights-body">${inner}</div></details>`;
  }
  function place(id, kind, html, anchorSel) {
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement("div");
      host.id = id;
      const list = Array.isArray(anchorSel) ? anchorSel : [anchorSel];
      const anchor = list.map(s => s && document.querySelector(s)).find(Boolean);
      const app = document.getElementById("app");
      if (anchor && anchor.parentNode) anchor.insertAdjacentElement("afterend", host);
      else if (app) app.insertBefore(host, app.firstChild);
      else return null;
    }
    host.className = "ppv-inject";
    host.dataset.proEnhance = kind;
    host.innerHTML = html;
    return host;
  }
  function spark(points, labelFmt) {
    const nums = (points || []).filter(v => typeof v === "number" && isFinite(v));
    if (!nums.length) return "";
    const w = 320, h = 96, pad = 8;
    let lo = Math.min(...nums), hi = Math.max(...nums);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const X = i => pad + (nums.length === 1 ? (w - pad * 2) / 2 : (i / (nums.length - 1)) * (w - pad * 2));
    const Y = v => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);
    const d = nums.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const dots = nums.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.2"/>`).join("");
    return `<svg class="ppv-chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Line history"><path d="${d}" fill="none"/>${dots}</svg><p class="na">${esc(labelFmt(nums[0]))} open → ${esc(labelFmt(nums[nums.length - 1]))} now</p>`;
  }
  function impliedPts(points) {
    return (points || []).map(v => {
      if (typeof v !== "number" || Math.abs(v) < 100) return null;
      return v > 0 ? 100 / (v + 100) : -v / (-v + 100);
    }).filter(v => v != null);
  }
  async function enhanceGame(ctx) {
    const api = A();
    if (!api || !ctx.lg || !ctx.id) return;
    let d = null;
    try { d = await api.getJSON(`data/${ctx.lg}/games/${ctx.id}.json`); } catch (e) { d = null; }
    const anchor = [".lm", "#line-movement-s", "#odds-s", ".pv-h1", "article.sx-game", ".cols"];
    if (!d || !d.game) {
      place("pro-game-panel", "game", `${flNote()}${EMPTY}`, anchor);
      return;
    }
    const g = d.game;
    const idx = await api.getJSON(`data/${ctx.lg}/index.json`).catch(() => null);
    const kind = (idx && idx.league && idx.league.kind) || "";
    const meta = api.meta ? api.meta() : null;
    const notes = (g.move && g.move.notable) || [];
    const sharp = notes.length
      ? panel("Sharp move", `<ul class="ppv-ul">${notes.map(n => `<li><span class="mvbadge">Sharp move</span> <span>${esc(n)}</span></li>`).join("")}</ul><p class="note">Same rule as the slate: a large spread move, a key number crossed, or a total that moved past the sport's bar. A description of the saved line, not a pick.</p>`)
      : "";
    const markets = F().historyMarkets(d.history);
    const spreadName = kind === "hockey" ? "Puck line" : kind === "baseball" ? "Run line" : "Spread";
    let charts = "";
    if (markets.length) {
      charts = markets.map(m => {
        const blocks = [
          [spreadName, m.spread, v => sgn(v)],
          [kind === "mma" ? "Total rounds" : "Total", m.total, v => String(v)],
          [`${g.away.abbr} ML`, m.awayML, v => am(v), true],
          [`${g.home.abbr} ML`, m.homeML, v => am(v), true],
        ];
        const body = blocks.map(([label, ser, fmt, ml]) => {
          if (!ser) return "";
          const pts = ml ? impliedPts(ser.points) : ser.points;
          const shown = spark(pts, ml ? (v => Math.round(v * 100) + "% implied") : fmt);
          if (!shown) return "";
          const ends = ml ? `<p class="na">${esc(fmt(ser.open))} open → ${esc(fmt(ser.current))} now</p>` : "";
          return `<div class="ppv-mk"><h4>${esc(label)}</h4>${shown}${ends}</div>`;
        }).filter(Boolean).join("");
        if (!body) return "";
        return `<h4 class="ppv-book">${esc(F().BOOK_NAME[m.book] || m.book)}</h4><div class="ppv-mks">${body}</div>`;
      }).filter(Boolean).join("");
      if (charts) charts += `<p class="note">Each chart is the opening number in the file, then the recorded snapshots. Moneyline is drawn as implied win percent so a move across even money stays on one scale. The prices under it are the American odds.</p>`;
    }
    const cols = F().bookColumns(g);
    const bookHead = cols.map(k => `<th>${bookName(k)}</th>`).join("");
    const labels = [`${g.away.abbr} spread`, `${g.home.abbr} spread`, `${g.away.abbr} ML`, `${g.home.abbr} ML`, "Over", "Under"];
    const bookBody = cols.length ? labels.map(label => {
      const cells = cols.map(k => cell(g, k, label));
      if (!cells.some(Boolean)) return "";
      return `<tr><td>${esc(label)}</td>${cells.map(c => `<td class="num">${c || "—"}</td>`).join("")}</tr>`;
    }).join("") : "";
    const books = bookBody
      ? `<div class="tbl-wrap"><table class="books"><thead><tr><th>Market</th>${bookHead}</tr></thead><tbody>${bookBody}</tbody></table></div><p class="note">Only books with a number in the file get a column. Pinnacle isn't listed.</p>`
      : "";
    const best = bestTable(g);
    const info = F().refreshInfo((meta && meta.generated) || (idx && idx.generated) || "", Date.now());
    const fresh = info.ageHours == null ? "" : `<div class="statgrid"><div class="stat"><span class="sl">File age</span><b class="num">${esc(info.ageHours.toFixed(1) + " h")}</b><span class="ss">since the data file</span></div><div class="stat"><span class="sl">Cadence today</span><b class="num">about ${esc(String(info.cadenceMin))} min</b><span class="ss">how the site refreshes</span></div></div><p class="note">This panel does not fetch new odds.</p>`;
    const html = `${flNote()}${insights([sharp, panel("Line history", charts), panel("All books", books), panel("Best price", best), panel("File freshness", fresh)])}<p class="note"><span class="of-21">21+</span> Pro reads the lines already in the file. It isn't a pick. Confirm the price at the sportsbook.</p>`;
    place("pro-game-panel", "game", html, anchor);
  }
  function bestTable(g) {
    const bp = F().bestPrices(g);
    if (!bp.available) return "";
    const cols = [];
    for (const r of bp.rows) for (const q of r.quotes) if (!cols.includes(q.book)) cols.push(q.book);
    const head = cols.map(k => `<th>${bookName(k)}</th>`).join("");
    const body = bp.rows.map(r => {
      const by = Object.fromEntries(r.quotes.map(q => [q.book, q]));
      const cells = cols.map(k => {
        const q = by[k];
        if (!q) return `<td class="num">—</td>`;
        const on = r.best.includes(k);
        const text = r.kind === "ml" ? am(q.line) : r.kind === "spread" ? sgn(q.line) : String(q.line);
        const price = q.price == null || r.kind === "ml" ? "" : ` <span class="na">${esc(am(q.price))}</span>`;
        return `<td class="num${on ? " pro-best" : ""}"><b>${esc(text)}</b>${price}${on ? ` <span class="pro-best-tag">Best</span>` : ""}</td>`;
      }).join("");
      return `<tr><td>${esc(r.label)}</td>${cells}</tr>`;
    }).join("");
    return `<div class="tbl-wrap"><table class="books"><thead><tr><th>Market</th>${head}</tr></thead><tbody>${body}</tbody></table></div><p class="note">Highlighted when at least two books posted that market. The best number is the most favorable one in the file for that side: a higher spread or moneyline, a lower over, or a higher under. The price breaks a tie. It is not a suggestion to bet. Confirm the price at the sportsbook.</p>`;
  }
  function hotFilter(ctx) {
    const key = (ctx.lg || "") + "/" + (ctx.id || "");
    if (!embedHot || embedHot.key !== key) embedHot = { key, f: { lg: ctx.lg || "nfl", team: "", player: ctx.id || "", mk: "all" } };
    return embedHot.f;
  }
  async function enhanceProps(ctx) {
    const H = Hp();
    if (!H) return;
    const docs = await propsDocs();
    const f = hotFilter(ctx);
    const labels = H.SPORT_LABEL;
    const all = H.collect(docs);
    const sportAll = all.filter(r => r.lg === f.lg);
    const filtered = H.applyFilters(all, f);
    const teams = [...new Set(sportAll.map(r => r.team).filter(Boolean))].sort();
    const teamRows = f.team ? sportAll.filter(r => r.team === f.team || r.teamId === f.team) : sportAll;
    const players = [];
    const seenP = new Set();
    for (const r of teamRows) if (!seenP.has(r.pid)) { seenP.add(r.pid); players.push(r); }
    players.sort((a, b) => a.name.localeCompare(b.name));
    const playerRows = f.player ? teamRows.filter(r => r.pid === f.player || r.name.toLowerCase().includes(String(f.player).toLowerCase())) : teamRows;
    const mks = [];
    const seenM = new Set();
    for (const r of playerRows) if (!seenM.has(r.mk)) { seenM.add(r.mk); mks.push({ mk: r.mk, label: r.label }); }
    const opt = (val, text, on) => `<option value="${esc(val)}"${on ? " selected" : ""}>${text}</option>`;
    const teamSel = `<label class="vf-sel"><span>Team</span><select id="proHotTeam" aria-label="Team">${opt("", "All teams", !f.team)}${teams.map(t => opt(t, esc(t), t === f.team)).join("")}</select></label>`;
    const playerSel = `<label class="vf-sel"><span>Player</span><select id="proHotPlayer" aria-label="Player">${opt("", "All players", !f.player)}${players.map(p => opt(p.pid, `${esc(p.name)}${p.team ? ` (${esc(p.team)})` : ""}`, p.pid === f.player)).join("")}</select></label>`;
    const mkSel = `<label class="vf-sel"><span>Prop type</span><select id="proHotMk" aria-label="Prop type">${opt("all", "All props", f.mk === "all")}${mks.map(p => opt(p.mk, esc(p.label), p.mk === f.mk)).join("")}</select></label>`;
    const store = localStore();
    const saved = store ? H.readSaved(store) : [];
    const savedHtml = saved.length ? `<div class="chips ppv-saved" aria-label="Saved filters">${saved.map(s => `<span class="chip ppv-saved-chip"><button type="button" class="ppv-apply" data-pro-hot-apply="${esc(s.id)}">${esc(s.name)}</button><button type="button" class="ppv-x" data-pro-hot-del="${esc(s.id)}" aria-label="${esc("Delete saved filter " + s.name)}">×</button></span>`).join("")}</div>` : "";
    const file = docs[f.lg];
    let lists = "";
    if (file) {
      if (H.hasPrices(sportAll)) {
        const gaps = H.priceGaps(filtered).slice(0, 8);
        if (gaps.length) lists += `<h3 class="ppv-h">Price gaps on the same line</h3><div class="ppv-list">${gaps.map(g => `<div class="ppv-line"><span><b>${esc(g.name)} · ${esc(g.label)}</b><small>${esc(g.team)} · ${esc(quoteLine(g))}</small></span><span class="num"><b>${esc((g.gap * 100).toFixed(1))} pts</b></span></div>`).join("")}</div>`;
      }
      if (H.hasOpen(sportAll)) {
        const moves = H.lineMoves(filtered).slice(0, 8);
        if (moves.length) lists += `<h3 class="ppv-h">Prop line moves</h3><div class="ppv-list">${moves.map(m => `<div class="ppv-line"><span><b>${esc(m.name)} · ${esc(m.label)}</b><small>${esc(m.text)}</small></span><span class="num"><b>${m.delta > 0 ? "+" : ""}${esc(String(Math.round(m.delta * 10) / 10))}</b></span></div>`).join("")}</div>`;
      }
      const prefer = preferBooks();
      if (H.hotStreaks(sportAll, prefer).available) {
        const hot = H.hotStreaks(filtered, prefer).rows.slice(0, 8);
        if (hot.length) lists += `<h3 class="ppv-h">Hot streaks</h3><div class="ppv-list">${hot.map(h => `<div class="ppv-line"><span><b>${esc(h.name)} · ${esc(h.label)}</b><small>${esc(h.text)} in the last games played</small></span></div>`).join("")}</div><p class="note">Past results only, not a pick.</p>`;
      }
    }
    const html = `${flNote()}<p class="note">Built from the props file already on the site. Nothing here calls the odds provider. Saved filters stay in this browser.</p>
      <div class="ppv-frow" data-pro-hot>${teamSel}${playerSel}${mkSel}</div>
      <form id="proHotSave" class="ppv-form"><label class="vf-sel"><span>Save this filter</span><input name="name" maxlength="40" placeholder="Name" aria-label="Saved filter name"></label><button type="submit" class="chip">Save in this browser</button></form>
      <p class="ppv-out" id="proHotErr" role="alert"></p>
      ${savedHtml ? `<h3 class="ppv-h">Saved filters</h3>${savedHtml}` : `<h3 class="ppv-h">Saved filters</h3>`}
      ${lists || EMPTY}
      <p class="note"><span class="of-21">21+</span> A price gap is not a suggestion to bet either number.</p>`;
    place("pro-props-panel", "props", panel("Hot props", html), ["#lines-s", "#ppPlayer", ".sx-player", ".phero", "h1"]);
  }
  function enhanceBets() {
    const bets = loadBets();
    const anchor = [".bt-stats", ".bt-empty", ".page-head"];
    if (!bets.length) {
      place("pro-bets-panel", "bets", EMPTY, anchor);
      return;
    }
    const store = localStore();
    const tags = store ? F().readTags(store) : {};
    const C = window.BetCore;
    const clv = F().clvSummary(bets);
    const groups = F().tagGroups(bets, tags);
    const one = (label, list) => {
      const s = C ? C.stats(list) : { n: list.length, net: 0 };
      return `<div class="ppv-line"><span><b>${esc(label)}</b><small>${s.n} bet${s.n === 1 ? "" : "s"}</small></span><span class="num ${cls(s.net || 0)}"><b>${esc(money(s.net || 0, true))}</b></span></div>`;
    };
    const byType = C ? C.groupBy(bets, b => (C.TYPES && C.TYPES[b.type]) || b.type || "Bet") : [];
    const typeHtml = byType.length ? `<h3 class="ppv-h">Splits by type</h3><div class="ppv-list">${byType.map(r => one(r.key, bets.filter(b => ((C.TYPES && C.TYPES[b.type]) || b.type) === r.key))).join("")}</div>` : "";
    const tagHtml = groups.length ? `<h3 class="ppv-h">Splits by tag</h3><div class="ppv-list">${groups.map(g => one(g.tag === "untagged" ? "No tag" : g.tag, g.bets)).join("")}</div>` : "";
    const rows = bets.slice(0, 12).map(b => {
      const c = F().clvPoints(b, b.closeLine);
      const mine = tags[b.id] || [];
      const clvCell = clv.available ? `<td class="num">${c.available ? esc((c.delta > 0 ? "+" : "") + c.delta) : "—"}</td>` : "";
      return `<tr><td>${esc(betLabel(b))}</td>${clvCell}<td>${mine.map(t => `<span class="chip">${esc(t)}</span>`).join(" ")}${store ? `<form class="ppv-form" data-pro-tag="${esc(b.id)}"><input name="tag" maxlength="24" aria-label="Tag" placeholder="Tag"><button type="submit" class="chip">Add</button></form>` : ""}</td></tr>`;
    }).join("");
    const clvHead = clv.available ? `<th>CLV</th>` : "";
    const table = `<div class="tbl-wrap"><table class="books ppv-bets"><thead><tr><th>Bet</th>${clvHead}<th>Tags</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    const html = `${clvBlock(clv)}${typeHtml}${tagHtml}${table}<p class="note">Tags stay in this browser. They don't turn Pro on. <span class="of-21">21+</span></p>`;
    place("pro-bets-panel", "bets", panel("My Bets extras", html), anchor);
  }
  function enhanceSlate() {
    document.querySelectorAll("a.game").forEach(a => {
      const top = a.querySelector(".game-top");
      if (!top || top.querySelector("[data-pro-badge]")) return;
      const pub = top.querySelector(".mvbadge");
      if (!pub) return;
      const s = document.createElement("span");
      s.className = "pro-sharp pro-frame";
      s.dataset.proBadge = "1";
      s.title = "Pro · sharp move";
      s.innerHTML = `<span class="pro-pill">PRO</span><span class="pro-sharp-txt">Sharp</span>`;
      top.appendChild(s);
    });
  }
  let appWatch = false;
  function watchApp() {
    if (appWatch || !window.MutationObserver) return;
    const app = document.getElementById("app");
    if (!app) return;
    appWatch = true;
    let t = 0;
    new MutationObserver(() => {
      const ctx = window.LSProGate && window.LSProGate.context && window.LSProGate.context();
      if (!ctx || !proOn() || ctx.kind === "owner" || ctx.kind === "other") return;
      const want = ctx.kind === "game" || ctx.kind === "props" || ctx.kind === "bets";
      if (!want) return;
      if (document.querySelector(`[data-pro-enhance="${ctx.kind}"]`)) return;
      clearTimeout(t);
      t = setTimeout(() => { if (window.LSProApp) enhance(ctx); }, 40);
    }).observe(app, { childList: true });
  }
  function watchSlate() {
    if (slateWatch || !window.MutationObserver) return;
    const app = document.getElementById("app");
    if (!app) return;
    slateWatch = true;
    let t = 0;
    new MutationObserver(() => {
      const ctx = window.LSProGate && window.LSProGate.context && window.LSProGate.context();
      if (!ctx || (ctx.kind !== "home" && ctx.kind !== "league" && ctx.kind !== "results")) return;
      clearTimeout(t);
      t = setTimeout(() => { if (window.LSProApp) enhanceSlate(); }, 40);
    }).observe(app, { childList: true, subtree: true });
  }
  function refreshEmbed() {
    if (!proOn()) return;
    const ctx = window.LSProGate && window.LSProGate.context && window.LSProGate.context();
    if (!ctx) return;
    if (ctx.kind === "props") enhanceProps(ctx);
    else if (ctx.kind === "bets") enhanceBets();
  }
  function bindEmbed() {
    if (embedBound) return;
    embedBound = true;
    document.addEventListener("change", e => {
      const t = e.target;
      if (!t.closest || !t.closest("[data-pro-enhance]")) return;
      const f = embedHot && embedHot.f;
      if (!f) return;
      if (t.id === "proHotTeam") { f.team = t.value; f.player = ""; f.mk = "all"; }
      if (t.id === "proHotPlayer") { f.player = t.value; f.mk = "all"; }
      if (t.id === "proHotMk") f.mk = t.value;
      refreshEmbed();
    });
    document.addEventListener("submit", e => {
      const hot = e.target.closest && e.target.closest("#proHotSave");
      const tag = e.target.closest && e.target.closest("[data-pro-tag]");
      if (!hot && !tag) return;
      if (e.target.closest("[data-pro-owner]")) return;
      e.preventDefault();
      const store = localStore();
      if (hot) {
        const err = document.getElementById("proHotErr");
        if (!store || !Hp() || !embedHot) { if (err) err.textContent = "This browser isn't storing filters."; return; }
        const r = Hp().addSaved(store, { ...embedHot.f, name: new FormData(hot).get("name"), id: Date.now().toString(36) });
        if (!r.ok) { if (err) err.textContent = r.error; return; }
        refreshEmbed();
      }
      if (tag && store) {
        F().setTag(store, tag.dataset.proTag, new FormData(tag).get("tag"), true);
        refreshEmbed();
      }
    });
    document.addEventListener("click", e => {
      const del = e.target.closest && e.target.closest("[data-pro-hot-del]");
      const apply = e.target.closest && e.target.closest("[data-pro-hot-apply]");
      if (!del && !apply) return;
      if (e.target.closest("[data-pro-owner]")) return;
      e.preventDefault();
      const store = localStore();
      const H = Hp();
      if (!store || !H || !embedHot) return;
      if (del) H.removeSaved(store, del.dataset.proHotDel);
      if (apply) {
        const row = H.readSaved(store).find(s => s.id === apply.dataset.proHotApply);
        if (row) embedHot.f = { lg: embedHot.f.lg, team: row.team || "", player: row.player || "", mk: row.mk || "all" };
      }
      refreshEmbed();
    });
  }
  function proOn() {
    const g = window.LSProGate;
    if (g && g.verified && !g.verified()) return false;
    return true;
  }
  async function enhance(ctx) {
    if (!proOn()) return;
    const n = ++paint;
    ctx = ctx || {};
    addNav();
    document.querySelectorAll("[data-pro-enhance]").forEach(el => { if (el.dataset.proEnhance !== ctx.kind) el.remove(); });
    if (ctx.kind !== "home" && ctx.kind !== "league" && ctx.kind !== "results") document.querySelectorAll("[data-pro-badge]").forEach(el => el.remove());
    if (ctx.kind === "owner" || ctx.kind === "other") return;
    try {
      if (ctx.kind === "game") await enhanceGame(ctx);
      else if (ctx.kind === "props") await enhanceProps(ctx);
      else if (ctx.kind === "bets") enhanceBets();
      else if (ctx.kind === "home" || ctx.kind === "league" || ctx.kind === "results") enhanceSlate();
    } catch (e) { console.warn(e); }
    if (n !== paint) return;
  }
  window.LSProApp = { view, boot, hide, enhance, alertCap: window.ProFeatures.ACTIVE_PRO };
})();
