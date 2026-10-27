/* LineSmart "pick'em" note: pure logic (no DOM). Browser: window.PickemCore. Node: require("./pickem-core.js").
 * Flags close games where the sportsbooks disagree on which team is favored on the spread (e.g. DraftKings UTAH -1.5
 * while FanDuel and Hard Rock Bet have MEM -1.5). That's a real market difference, not a data error, but it looks like
 * one, so the site adds a short note. Read-only: never changes the line data it's given.
 *
 * Rule: at least two current (non-stale) books post a spread, at least one has the away team favored and at least one
 * has the home team favored (a 0 / pick line counts for neither side), and every posted spread is within
 * PICKEM_MAX points (2.5). Larger disagreements are not called a pick'em: they stay unexplained on purpose. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PickemCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const PICKEM_MAX = 2.5;
  const NO_SPREAD = new Set(["soccer", "mma"]);
  const BOOK_ORDER = ["draftkings", "hardrockbet", "fanduel"];
  const isNum = v => typeof v === "number" && isFinite(v);

  /** Away team's spread for one book record: awaySpread, else -homeSpread; null when none. */
  function awayLine(b) {
    if (!b || b.stale) return null;
    if (isNum(b.awaySpread)) return b.awaySpread;
    if (isNum(b.homeSpread)) return -b.homeSpread;
    return null;
  }

  /** null, or {away:[{book, line}], home:[{book, line}]} listing which books favor which team (line = favorite's spread). */
  function split(g, kind) {
    if (!g || NO_SPREAD.has(kind)) return null;
    const books = (g && g.books) || {};
    const keys = Object.keys(books).sort((a, b) => (BOOK_ORDER.indexOf(a) + 1 || 99) - (BOOK_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
    const lines = keys.map(k => [k, awayLine(books[k])]).filter(([, l]) => l !== null);
    if (lines.length < 2) return null;
    if (lines.some(([, l]) => Math.abs(l) > PICKEM_MAX)) return null;
    const away = lines.filter(([, l]) => l < 0).map(([book, l]) => ({ book, line: l }));
    const home = lines.filter(([, l]) => l > 0).map(([book, l]) => ({ book, line: -l }));
    return away.length && home.length ? { away, home } : null;
  }

  return { PICKEM_MAX, awayLine, split };
});
