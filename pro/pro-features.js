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

  /** Closing-line rows for bets that actually have a close. No number is invented. */
  function clvSummary(bets) {
    const rows = [];
    for (const b of bets || []) {
      const c = clvPoints(b, b && b.closeLine);
      if (c.available) rows.push({ id: String(b.id || ""), delta: c.delta });
    }
    if (!rows.length) return { available: false, n: 0, mean: null, rows: [] };
    const mean = rows.reduce((s, r) => s + r.delta, 0) / rows.length;
    return { available: true, n: rows.length, mean, rows };
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
    sharpMoves, filterBoard, bookColumns, refreshInfo, clvPoints, clvSummary, tagGroups, historyMarkets, readTags, setTag,
  };
});
