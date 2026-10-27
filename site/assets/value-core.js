/* LineSmart Value finder: pure logic (no DOM, no network). Browser: window.ValueCore. Node: require("./value-core.js").
 * Input = the odds the hourly build already wrote (data/<lg>/index.json game books, data/props/<lg>.json prop books).
 * Nothing here calls The Odds API or any other service; it only re-reads prices LineSmart already has.
 *
 *   implied p        100/(A+100) for A > 0, -A/(-A+100) for A < 0  (includes the book's margin)
 *   no-vig (book)    each side's implied p / sum over the market's sides  (proportional de-vig; 2-way, 3-way soccer ML)
 *   fair p           mean of the no-vig probabilities of every book hanging the consensus line (the line most books
 *                    post; moneylines always qualify). Needs MIN_BOOKS (3) books on that line.
 *   EV / edge        fair p x decimal odds - 1: expected return per $1 at that price IF the consensus is right.
 *   outlier          the book's no-vig p for that side is PRICE_GAP (3 pts) lower than the other books' mean
 *                    (= its price is clearly better than the rest of the market).
 * Guards: pre-game only (start in the future), book prices younger than MAX_AGE_H (the keep-last-good window), each book's
 * market hold must be plausible (HOLD_MIN..HOLD_MAX), prices within MIN_PRICE..MAX_PRICE, and an edge above MAX_EDGE is treated
 * as bad data (a stale or mistyped line), not a bet. Informational only: a consensus price is not a prediction. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./adv-core.js"));
  else root.ValueCore = factory(root.AdvCore);
})(typeof self !== "undefined" ? self : this, function (AC) {
  "use strict";
  const MIN_BOOKS = 3;
  const MAX_AGE_H = 18;          // = LASTGOOD_MAX_H in scripts/lastgood.py: older prices are not shown anywhere on the site
  const MAX_EDGE = 0.15;         // > +15% vs the consensus is almost always a stale / bad line
  const HOLD_MIN = -0.005, HOLD_MAX = 0.2;
  const MIN_PRICE = -1000, MAX_PRICE = 400;   // proportional de-vig overstates long shots' fair odds
  const PRICE_GAP = AC.PRICE_GAP;
  const OUTLIER_FLOOR = -0.03;   // outliers shown even slightly below fair (with only 3 books the outlier is part of its own consensus)
  const BOOKS = ["hardrockbet", "draftkings", "fanduel", "betmgm"];
  const isNum = v => typeof v === "number" && isFinite(v);
  const { implied, decimal, toAmerican, noVig, edge, hold } = AC;
  const okPrice = p => isNum(p) && Math.abs(p) >= 100 && p >= MIN_PRICE && p <= MAX_PRICE;
  const plausible = prices => { if (!prices.every(p => isNum(p) && Math.abs(p) >= 100)) return false; const h = hold(prices); return h !== null && h >= HOLD_MIN && h <= HOLD_MAX; };
  const ts = s => { const t = Date.parse(s || ""); return isNaN(t) ? null : t; };
  const fresh = (iso, now) => { const t = ts(iso); return t !== null && now - t <= MAX_AGE_H * 3600e3 && t <= now + 600e3; };

  /** Pre-game, not started, and the league file itself is inside the last-good window. */
  function gameOpen(g, now) {
    if (!g || g.state !== "pre" || g.completed) return false;
    const t = ts(g.date);
    return t !== null && t > now;
  }

  /** Fresh, sane per-book copies of a game's lines: drops stale/started books, books older than MAX_AGE_H and
   *  any market whose prices make no sense (negative or huge hold, |price| < 100). */
  function cleanBooks(books, kind, genIso, now) {
    const out = {}, dropped = [];
    for (const [k, b] of Object.entries(books || {})) {
      if (!b || b.stale || !BOOKS.includes(k)) continue;
      if (!fresh(b.asOf || genIso, now)) { dropped.push(k); continue; }   // asOf = when LineSmart pulled it (not the book's own last change)
      const c = { ...b };
      for (const [, , outs] of AC.markets(kind)) {
        const prices = outs.map(([, pf]) => c[pf]);
        if (prices.every(v => v === null || v === undefined)) continue;
        if (!plausible(prices)) outs.forEach(([, pf]) => (c[pf] = null));
      }
      out[k] = c;
    }
    return { books: out, dropped };
  }

  const sgnLine = v => (v > 0 ? "+" + v : v === 0 ? "PK" : String(v));
  function gameLabel(g, mk, side, line) {
    const t = side === "home" ? g.home : side === "away" ? g.away : null;
    const nm = t ? t.short || t.abbr || t.name : "";
    if (mk === "ml") return side === "draw" ? "Draw" : `${nm} ML`;
    if (mk === "spread") return `${nm} ${sgnLine(side === "home" ? line : -line)}`;
    return `${side === "over" ? "Over" : "Under"} ${line}`;
  }

  /** Value rows for one game's moneyline / spread / total. kind = sport kind (football, basketball, hockey, baseball, soccer, mma). */
  function gameRows(lg, kind, g, genIso, now, opts = {}) {
    const minBooks = opts.minBooks || MIN_BOOKS;
    const res = { rows: [], lines: [], suspect: 0 };
    if (!gameOpen(g, now)) return res;
    const { books } = cleanBooks(g.books, kind, genIso, now);
    if (Object.keys(books).length < minBooks) return res;
    const an = AC.analyze(books, kind);
    const base = { lg, kind, gid: String(g.id), date: g.date, matchup: `${(g.away || {}).abbr || "?"} @ ${(g.home || {}).abbr || "?"}`, name: g.name || "" };
    for (const [mk, M] of Object.entries(an)) {
      // off-consensus lines (a book hanging a clearly better number than the rest)
      for (const [bk, B] of Object.entries(M.books)) {
        if (B.outKind === "line" && B.out.length && M.n >= 2 && Object.keys(M.books).length >= minBooks) {
          const o = B.out[0], pr = B.prices[o];
          if (okPrice(pr)) res.lines.push({ ...base, mk, side: o, book: bk, price: pr, line: lineFor(mk, o, B.line), consLine: lineFor(mk, o, M.line), label: gameLabel(g, mk, o, B.line), consLabel: gameLabel(g, mk, o, M.line), gap: Math.abs(B.line - M.line) });
        }
      }
      if (!M.fair || M.n < minBooks) continue;
      for (const side of Object.keys(M.fair)) {
        const offers = [];
        for (const [bk, B] of Object.entries(M.books)) {
          if (!B.edge || !isNum(B.edge[side])) continue;
          offers.push({ book: bk, price: B.prices[side], edge: B.edge[side], out: B.out.includes(side) && B.outKind === "price" });
        }
        const r = mkRow({ ...base, mk, side, line: lineFor(mk, side, M.line), label: gameLabel(g, mk, side, M.line), fairP: M.fair[side], fairAm: M.fairAm[side], n: M.n }, offers);
        if (r === "suspect") res.suspect++; else if (r) res.rows.push(r);
      }
    }
    return res;
  }
  const lineFor = (mk, side, line) => (mk === "spread" ? (side === "home" ? line : -line) : mk === "total" ? line : null);

  // offers sorted best first; drops bad prices; "suspect" when the best price is too good to be real
  function mkRow(row, offers) {
    const ok = offers.filter(o => okPrice(o.price) && isNum(o.edge)).sort((a, b) => b.edge - a.edge || b.price - a.price);
    if (!ok.length) return null;
    const bad = ok.filter(o => o.edge > MAX_EDGE);
    const good = ok.filter(o => o.edge <= MAX_EDGE);
    if (!good.length) return bad.length ? "suspect" : null;
    const bestPrice = Math.max(...good.map(o => decimal(o.price)));
    good.forEach(o => (o.best = decimal(o.price) === bestPrice));
    return { ...row, offers: good, top: good[0], suspect: bad.length };
  }

  /** Player-prop value rows from one props-file game entry ({props: [[pid, mk, line, ?, hist, {book: [line, over, under]}]]}). */
  function propRows(lg, kind, g, pg, players, markets, genIso, now, opts = {}) {
    const minBooks = opts.minBooks || MIN_BOOKS;
    const res = { rows: [], lines: [], suspect: 0 };
    if (!gameOpen(g, now) || !pg || !Array.isArray(pg.props)) return res;
    if (!fresh(pg.upd || genIso, now) && !fresh(genIso, now)) return res;
    const base = { lg, kind, gid: String(g.id), date: g.date, matchup: `${(g.away || {}).abbr || "?"} @ ${(g.home || {}).abbr || "?"}`, name: g.name || "" };
    for (const row of pg.props) {
      const [pid, pmk, , , , bks] = row;
      if (!bks || typeof bks !== "object") continue;
      const per = {};
      for (const [bk, v] of Object.entries(bks)) {
        if (!Array.isArray(v) || !BOOKS.includes(bk)) continue;
        const [ln, ov, un] = v;
        if (!isNum(ln) || !isNum(ov) || !isNum(un) || !plausible([ov, un])) continue;   // one-sided (anytime TD, ladders): no de-vig
        const nv = noVig([ov, un]);
        if (nv) per[bk] = { line: ln, prices: { over: ov, under: un }, nv: { over: nv[0], under: nv[1] } };
      }
      const keys = Object.keys(per);
      if (keys.length < minBooks) continue;
      const cnt = new Map(); keys.forEach(k => cnt.set(per[k].line, (cnt.get(per[k].line) || 0) + 1));
      const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]);
      if (top.length > 1 && top[0][1] === top[1][1]) continue;
      const cline = top[0][0], on = keys.filter(k => per[k].line === cline);
      if (on.length < minBooks) continue;
      const pl = (players || {})[pid] || {}, mlab = ((markets || {})[pmk] || [])[0] || pmk;
      for (const side of ["over", "under"]) {
        const fairP = on.reduce((a, k) => a + per[k].nv[side], 0) / on.length;
        const offers = on.map(k => {
          const others = on.filter(x => x !== k), m = others.reduce((a, x) => a + per[x].nv[side], 0) / others.length;
          return { book: k, price: per[k].prices[side], edge: edge(fairP, per[k].prices[side]), out: on.length >= 3 && m - per[k].nv[side] >= PRICE_GAP - 1e-9 };
        });
        const r = mkRow({ ...base, mk: "prop", side, line: cline, pid: String(pid), pmk, player: pl.n || "Player", team: pl.ta || "", market: mlab,
          label: `${pl.n || "Player"} ${side === "over" ? "Over" : "Under"} ${cline} ${mlab}`, fairP, fairAm: toAmerican(fairP), n: on.length }, offers);
        if (r === "suspect") res.suspect++; else if (r) res.rows.push(r);
      }
    }
    return res;
  }

  /** Visitor-state view of rows: keep only offers at books legal in the state (isAvail(bookKey)), recompute best. */
  function forState(rows, isAvail) {
    const out = [];
    for (const r of rows) {
      const offs = r.offers.filter(o => isAvail(o.book));
      if (!offs.length) continue;
      out.push({ ...r, offers: offs, top: offs[0], hidden: r.offers.length - offs.length });
    }
    return out;
  }

  /** Filters: { lg: "all"|key, mk: "all"|"ml"|"spread"|"total"|"prop", min: edge fraction, hours: window or 0 = all,
   *  outliers: also keep best-price outliers down to OUTLIER_FLOOR EV even when below min }. Sorted by edge. */
  function filterRows(rows, f, now) {
    const min = isNum(f.min) ? f.min : 0;
    const keep = r => r.top.edge >= min - 1e-12 || (f.outliers && r.top.out && r.top.edge >= Math.min(min, OUTLIER_FLOOR) - 1e-12 && min <= 0);
    return rows.filter(r => (!f.lg || f.lg === "all" || r.lg === f.lg) && (!f.mk || f.mk === "all" || r.mk === f.mk)
        && keep(r) && (!f.hours || ts(r.date) - now <= f.hours * 3600e3))
      .sort((a, b) => b.top.edge - a.top.edge || ts(a.date) - ts(b.date));
  }

  return { MIN_BOOKS, MAX_AGE_H, MAX_EDGE, HOLD_MIN, HOLD_MAX, MIN_PRICE, MAX_PRICE, PRICE_GAP, OUTLIER_FLOOR, BOOKS,
    implied, decimal, toAmerican, noVig, edge, hold, plausible, fresh, gameOpen, cleanBooks, gameRows, propRows, forState, filterRows, gameLabel };
});
