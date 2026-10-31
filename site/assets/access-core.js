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

  /** Sortable number inside an ESPN season-leader string.
   *  "24.0" -> 24, ".291" -> 0.291, "1,487 YDS" -> 1487, "Matches: 8, Goals: 2" -> 2. */
  function leaderNumber(value) {
    const s = String(value == null ? "" : value).trim();
    if (!s) return null;
    const yds = s.match(/(\d[\d,]*)(?:\.\d+)?\s*YDS/i);
    if (yds) return Number(yds[1].replace(/,/g, ""));
    if (/matches\s*:/i.test(s)) {
      const labs = [...s.matchAll(/:\s*(-?\d+(?:\.\d+)?)/g)];
      if (labs.length) return Number(labs[labs.length - 1][1]);
    }
    const m = s.match(/-?\d[\d,]*(?:\.\d+)?|\.\d+/);
    if (!m) return null;
    const n = Number(m[0].replace(/,/g, ""));
    return isFinite(n) ? n : null;
  }

  /** Short label for a phone row. The full ESPN string stays available as the title. */
  function leaderLabel(value) {
    const s = String(value == null ? "" : value).trim();
    const yds = s.match(/(\d[\d,]*(?:\.\d+)?)\s*YDS/i);
    if (yds) {
      const td = s.match(/(\d+)\s*TD/i);
      const intc = s.match(/(\d+)\s*INT/i);
      return yds[1] + " YDS" + (td ? " · " + td[1] + " TD" : "") + (intc ? " · " + intc[1] + " INT" : "");
    }
    if (/matches\s*:/i.test(s)) {
      const gp = s.match(/matches\s*:\s*(\d+)/i);
      const last = s.match(/:\s*(\d+(?:\.\d+)?)\s*$/);
      if (last && gp) return last[1] + " · " + gp[1] + " GP";
    }
    return s;
  }

  function lowerIsBetter(cat) {
    return /^(earned run average|era)$/i.test(String(cat || "").trim());
  }

  /** Team season leaders (game-file shape {cat, player, teamId, value}) -> one board per category, best first.
   *  The same team shows up in every game it plays, so each team+category+player is kept once. */
  function seasonBoards(records, limit) {
    const cap = limit == null ? 8 : limit;
    const groups = new Map();
    const seen = new Set();
    for (const r of records || []) {
      if (!r || !r.cat || !r.player) continue;
      const key = r.cat + "\0" + String(r.teamId == null ? "" : r.teamId) + "\0" + r.player;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!groups.has(r.cat)) groups.set(r.cat, []);
      groups.get(r.cat).push(r);
    }
    const boards = [];
    for (const [cat, rows] of groups) {
      const low = lowerIsBetter(cat);
      const scored = rows.map(r => ({ player: r.player, teamId: r.teamId, value: r.value, id: r.id || null, n: leaderNumber(r.value) }));
      scored.sort((a, b) => {
        if (a.n == null && b.n == null) return String(a.player).localeCompare(String(b.player));
        if (a.n == null) return 1;
        if (b.n == null) return -1;
        if (a.n !== b.n) return low ? a.n - b.n : b.n - a.n;
        return String(a.player).localeCompare(String(b.player));
      });
      const cut = cap > 0 ? scored.slice(0, cap) : scored.slice();
      boards.push({ cat, rows: cut.map(({ n, ...rest }) => rest) });
    }
    return boards;
  }

  /** Games that add a team we have not covered yet, so a landing can read one file per new team instead of the whole slate. */
  function leaderGameOrder(games) {
    const pool = (games || []).filter(g => g && g.id != null && g.home && g.away);
    const teamsOf = g => [g.home.id, g.away.id].filter(x => x != null && x !== "").map(String);
    const seen = new Set();
    const out = [];
    while (pool.length) {
      let best = -1, bi = 0;
      for (let i = 0; i < pool.length; i++) {
        let n = 0;
        for (const id of teamsOf(pool[i])) if (!seen.has(id)) n++;
        if (n > best) { best = n; bi = i; }
      }
      if (best <= 0) break;
      const g = pool.splice(bi, 1)[0];
      out.push(g);
      for (const id of teamsOf(g)) seen.add(id);
    }
    return out;
  }

  /** Player-page hash when the on-site index has this name, else "". */
  function playerHref(lg, name, players) {
    const n = norm(name);
    if (!n || !lg) return "";
    for (const p of players || []) {
      if (!p || p.id == null || String(p.id) === "") continue;
      if (norm(p.name) === n) return "#/p/" + lg + "/" + p.id;
    }
    return "";
  }

  return { norm, propsControl, gamesOnDay, pickLeague, searchPlayers, leaderNumber, leaderLabel, seasonBoards, leaderGameOrder, playerHref };
});
