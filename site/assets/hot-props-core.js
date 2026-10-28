/* Hot props for the private Pro preview. Pure logic: no DOM, no network.
   Input is data/props/<lg>.json (the shape scripts/props.py writes) plus props-core.js.
   Browser: window.HotProps. Node: require("./hot-props-core.js"). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./props-core.js"));
  else root.HotProps = factory(root.PropsCore);
})(typeof self !== "undefined" ? self : this, function (P) {
  "use strict";
  const KEY = "ls-ppv-hot-v1";
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
    KEY, SPORT_FIRST, SPORT_LABEL, implied, sportList, collect, applyFilters, gapOf, priceGaps,
    hasOpen, lineMoves, hasLog, gradedLine, hotStreaks, readSaved, addSaved, removeSaved,
  };
});
