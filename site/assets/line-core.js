/* LineSmart moneyline movement (pure, no DOM). Browser: window.LineCore. Node: require("./line-core.js").
   Mirrors scripts/line_history.py (flat / ml_cents / ml_prob_pts / biggest). American odds jump from -100
   to +100, so cur - open is 200 too big whenever a price crosses even money: -110 -> +114 is +24 cents,
   not +224. Spreads, totals and prop lines don't have that gap and stay a plain subtraction.
   Open and current prices stay raw American odds; only the move between them is converted. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LineCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const isNum = v => typeof v === "number" && isFinite(v);

  /** American odds on a continuous cent scale. -110 and +110 are 20 apart, not 220. */
  const flat = x => (x < 0 ? x + 100 : x - 100);

  /** Signed moneyline move in cents. -110 -> +114 is +24; +100 and -100 are the same price. */
  function cents(open, cur) {
    const d = flat(cur) - flat(open);
    const r = Math.round(d);
    return Math.abs(d - r) < 1e-6 ? r : Math.round(d * 100) / 100;
  }

  /** Implied win probability of an American price (includes the book's margin). */
  const implied = a => (!isNum(a) || a === 0 ? null : a > 0 ? 100 / (a + 100) : -a / (-a + 100));

  /** Change in implied win probability, in percentage points. -110 -> +114 is about -5.7. */
  function probPts(open, cur) {
    const po = implied(open), pc = implied(cur);
    return po == null || pc == null ? null : (pc - po) * 100;
  }

  /** Signed move. Moneyline uses cents; spreads and totals use the raw number. */
  function moveDelta(open, cur, ml) {
    if (!isNum(open) || !isNum(cur)) return null;
    return ml ? cents(open, cur) : cur - open;
  }

  /** The price farthest from open. Moneyline distance is cents, so +100 doesn't beat -140 off a -105 open. */
  function biggest(open, values, ml) {
    let big = null, best = -1;
    for (const v of values || []) {
      if (!isNum(v)) continue;
      const d = Math.abs(moveDelta(open, v, ml));
      if (big === null || d > best) { big = v; best = d; }
    }
    return big;
  }

  /** "+24" / "-25" for a moneyline, "+1.5" / "-2" for a spread or total. "" when there is no move. */
  function formatSigned(delta, ml) {
    if (!isNum(delta)) return "";
    const n = ml ? Math.round(delta) : +delta.toFixed(2);
    if (!n) return "";
    return (n > 0 ? "+" : "") + n;
  }

  return { flat, cents, implied, probPts, moveDelta, biggest, formatSigned };
});
