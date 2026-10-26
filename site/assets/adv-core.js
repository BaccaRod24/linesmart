/* LineSmart advanced-stats math (pure, no DOM). Browser: window.AdvCore. Node: require("./adv-core.js").
   Mirrors scripts/linevalue.py, scripts/ats.py and scripts/adv_nba.py; scripts/adv_test.mjs checks them.
   Informational only: a price that beats a consensus is not a prediction. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AdvCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const PRICE_GAP = 0.03;                                     // 3 percentage points of no-vig probability
  const LINE_GAP = { football: 1.5, basketball: 1.5 };       // points; everything else 0.5
  const LINE_GAP_DEFAULT = 0.5;
  const isNum = v => typeof v === "number" && isFinite(v);

  const implied = a => (!isNum(a) || a === 0 ? null : a > 0 ? 100 / (a + 100) : -a / (-a + 100));
  const decimal = a => (!isNum(a) || a === 0 ? null : a > 0 ? 1 + a / 100 : 1 + 100 / -a);
  const toAmerican = p => (!isNum(p) || p <= 0 || p >= 1 ? null : p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p));
  function noVig(prices) {
    const ps = prices.map(implied);
    if (ps.some(p => p === null)) return null;
    const s = ps.reduce((a, b) => a + b, 0);
    return s > 0 ? ps.map(p => p / s) : null;
  }
  const edge = (fairP, price) => { const d = decimal(price); return fairP == null || d == null ? null : fairP * d - 1; };
  /** bookmaker margin (overround) of one book's market, e.g. 0.045 = 4.5% */
  const hold = prices => { const ps = prices.map(implied); return ps.some(p => p === null) ? null : ps.reduce((a, b) => a + b, 0) - 1; };

  function markets(kind) {
    const out = [];
    if (kind !== "soccer" && kind !== "mma") out.push(["spread", "homeSpread", [["away", "awaySpreadOdds"], ["home", "homeSpreadOdds"]]]);
    out.push(["ml", null, kind === "soccer" ? [["away", "awayML"], ["draw", "drawML"], ["home", "homeML"]] : [["away", "awayML"], ["home", "homeML"]]]);
    if (kind !== "mma") out.push(["total", "total", [["over", "overOdds"], ["under", "underOdds"]]]);
    return out;
  }

  /** books: {key: flat line object} (drop stale first). Same output shape as linevalue.analyze(). */
  function analyze(books, kind) {
    const res = {}, gap = LINE_GAP[kind] ?? LINE_GAP_DEFAULT;
    for (const [mk, lf, outs] of markets(kind)) {
      const per = {};
      for (const [bk, b] of Object.entries(books || {})) {
        if (!b) continue;
        const prices = outs.map(([, pf]) => b[pf]);
        if (!prices.every(isNum)) continue;
        const ln = lf ? b[lf] : null;
        if (lf && !isNum(ln)) continue;
        const nv = noVig(prices);
        if (!nv) continue;
        per[bk] = { line: ln, prices: Object.fromEntries(outs.map(([o], i) => [o, prices[i]])), nv: Object.fromEntries(outs.map(([o], i) => [o, nv[i]])), hold: hold(prices) };
      }
      const keys = Object.keys(per);
      if (!keys.length) continue;
      const cnt = new Map();
      keys.forEach(k => cnt.set(per[k].line, (cnt.get(per[k].line) || 0) + 1));
      const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]);
      const ok = top.length === 1 || top[0][1] > top[1][1];
      const cline = ok ? top[0][0] : null;
      const on = ok ? keys.filter(k => per[k].line === cline) : [];
      let fair = null;
      if (on.length >= 2) fair = Object.fromEntries(outs.map(([o]) => [o, on.reduce((a, k) => a + per[k].nv[o], 0) / on.length]));
      const M = { line: cline, n: on.length, fair, fairAm: fair ? Object.fromEntries(Object.entries(fair).map(([o, p]) => [o, toAmerican(p)])) : null, books: {} };
      for (const k of keys) {
        const v = per[k], B = { line: v.line, nv: v.nv, prices: v.prices, hold: v.hold, edge: null, out: [] };
        if (fair && v.line === cline) B.edge = Object.fromEntries(outs.map(([o]) => [o, edge(fair[o], v.prices[o])]));
        if (keys.length >= 3) {
          if (lf && ok && v.line !== cline && cnt.get(cline) >= 2 && Math.abs(v.line - cline) >= gap - 1e-9) {
            B.out = mk === "spread" ? [v.line > cline ? "home" : "away"] : [v.line < cline ? "over" : "under"];
            B.outKind = "line";
          } else if (ok && v.line === cline && on.length >= 3) {
            const others = on.filter(x => x !== k);
            for (const [o] of outs) {
              const m = others.reduce((a, x) => a + per[x].nv[o], 0) / others.length;
              if (m - v.nv[o] >= PRICE_GAP - 1e-9) B.out.push(o);
            }
            if (B.out.length) B.outKind = "price";
          }
        }
        M.books[k] = B;
      }
      res[mk] = M;
    }
    return res;
  }

  // ---- ATS / O-U grading
  const gradeATS = (margin, spread) => { const v = margin + spread; return v > 0 ? "W" : v < 0 ? "L" : "P"; };
  const gradeOU = (points, total) => (points > total ? "O" : points < total ? "U" : "P");
  const recStr = r => (Array.isArray(r) ? `${r[0]}-${r[1]}${r[2] ? `-${r[2]}` : ""}` : null);
  const recPct = r => (Array.isArray(r) && r[0] + r[1] > 0 ? r[0] / (r[0] + r[1]) : null);

  // ---- NBA pace / ratings / usage
  const possessions = (fga, oreb, tov, fta) => fga - oreb + tov + 0.44 * fta;
  const gameMinutes = per => 48 + 5 * Math.max(0, (per || 4) - 4);
  const pace = (poss, minutes) => (minutes ? (48 * poss) / minutes : null);
  const rating = (pts, poss) => (poss ? (100 * pts) / poss : null);
  const projPace = (a, b, lg) => (a && b && lg ? (a * b) / lg : null);
  function usage(p, t) {
    const den = p.min * (t.fga + 0.44 * t.fta + t.tov);
    return den ? (100 * (p.fga + 0.44 * p.fta + p.tov) * (t.min / 5)) / den : null;
  }
  /** "up" | "down" | "flat" when |recent - season| crosses the threshold */
  const trend = (season, recent, th) => (season == null || recent == null ? null : recent - season >= th - 1e-9 ? "up" : season - recent >= th - 1e-9 ? "down" : "flat");

  return { PRICE_GAP, LINE_GAP, LINE_GAP_DEFAULT, implied, decimal, toAmerican, noVig, edge, hold, markets, analyze,
           gradeATS, gradeOU, recStr, recPct, possessions, gameMinutes, pace, rating, projPace, usage, trend };
});
