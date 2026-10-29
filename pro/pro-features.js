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
