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

  function statValue(p, key, perGame) {
    const raw = num(p && p[key]);
    if (!perGame) return raw;
    const gp = num(p && p.gp);
    return gp ? raw / gp : 0;
  }

  /** Top 10 by the position's key stat. NBA is per game. Players with none of that stat are left out. */
  function seasonBoard(players, spec, limit) {
    const lim = limit || TOP_N;
    if (!spec) return { rows: [], total: 0 };
    const all = (players || []).filter(p => p && p.pos === spec.id && num(p.gp) >= 1 && statValue(p, spec.key, spec.perGame) > 0);
    all.sort((a, b) => {
      const d = statValue(b, spec.key, spec.perGame) - statValue(a, spec.key, spec.perGame);
      if (Math.abs(d) > 1e-9) return d;
      for (const [k] of spec.cols) {
        const e = statValue(b, k, spec.perGame) - statValue(a, k, spec.perGame);
        if (Math.abs(e) > 1e-9) return e;
      }
      return String(a.n || "").localeCompare(String(b.n || "")) || String(a.id).localeCompare(String(b.id));
    });
    const rows = all.slice(0, lim).map((p, i) => ({
      rank: i + 1,
      id: String(p.id),
      name: p.n || "",
      team: p.ta || "",
      gp: num(p.gp),
      cells: spec.cols.map(([k, label]) => ({ key: k, label, text: fmtStat(statValue(p, k, spec.perGame), spec.perGame) })),
    }));
    return { rows, total: all.length };
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
        row.pts = 0; row.reb = 0; row.ast = 0;
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
      else { out.pts = clean(row.pts); out.reb = clean(row.reb); out.ast = clean(row.ast); }
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
    seasonBoard, aggregateSeason, gradeCount, sampleText, basisLabel, pickLine,
    fromProps, fromPack, rankHits, propRowsFromOdds, statSample, matchPid,
  };
});
