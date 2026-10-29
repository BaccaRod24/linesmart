/* Which leagues get a props link, which games are "today", and player-name search.
   No DOM and no network. Browser: window.AccessCore. Node: require(). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AccessCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

  /** files: { nfl: true } or a Set of league keys that have data/props/<lg>.json. Anything else is off, never a blank props page. */
  function propsControl(lg, files) {
    const has = files instanceof Set ? files.has(lg) : !!(files && files[lg]);
    return has ? "link" : "off";
  }

  /** Keep games whose day matches. dayOf defaults to g.day so tests stay timezone-free. */
  function gamesOnDay(games, day, dayOf) {
    const f = dayOf || (g => g.day);
    return (games || []).filter(g => g && f(g) === day);
  }

  /** Requested league if it is real, else the league the visitor was just on, else the first in order. */
  function pickLeague(order, requested, current) {
    const list = order || [];
    if (requested && list.includes(requested)) return requested;
    if (current && list.includes(current)) return current;
    return list[0] || "";
  }

  /** Player entries only ({k:"p", name, w?}). Each query word must prefix a name word. Cap 40. */
  function searchPlayers(entries, query) {
    const qt = norm(query).split(" ").filter(Boolean);
    if (!qt.length) return [];
    const out = [];
    for (const e of entries || []) {
      if (!e || (e.k && e.k !== "p")) continue;
      const w = e.w && e.w.length ? e.w : norm(e.name).split(" ").filter(Boolean);
      if (!qt.every(t => w.some(x => x.startsWith(t)))) continue;
      out.push(e);
      if (out.length >= 40) break;
    }
    return out;
  }

  return { norm, propsControl, gamesOnDay, pickLeague, searchPlayers };
});
