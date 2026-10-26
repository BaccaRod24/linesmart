/* LineSmart player props: pure logic (no DOM). Loaded in the browser as window.PropsCore and in Node tests via require().
 * Input is data/props/<lg>.json from scripts/props.py: DraftKings lines (via ESPN) + each player's last 10 games.
 * Every past game is graded against the CURRENT line: over = green, under = red, push or no game = grey.
 * Past results only - nothing here predicts outcomes. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PropsCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const isNum = v => typeof v === "number" && isFinite(v);
  const NFL_POS = { QB: 0, RB: 1, FB: 1, WR: 2, TE: 3 };

  /** "o" over the line, "u" under, "p" push (exactly on it), null = no game / no value */
  function grade(v, line) {
    if (!isNum(v) || !isNum(line)) return null;
    return v > line ? "o" : v < line ? "u" : "p";
  }

  /** Boxes for the last n games, latest first: [{d, opp, ha, v, r}] where r is "o" | "u" | "p" | "x" (no game / not in box score). */
  function strip(log, mk, line, n = 5) {
    return (log || []).slice(0, n).map(([d, opp, ha, vals]) => {
      const v = vals && isNum(vals[mk]) ? vals[mk] : null;
      return { d, opp, ha, v, r: v === null ? "x" : grade(v, line) };
    });
  }

  /** Over count across the last n games he actually played (pushes count as played, not over). */
  function rate(log, mk, line, n) {
    const s = strip(log, mk, line, n);
    const played = s.filter(b => b.r !== "x");
    const o = played.filter(b => b.r === "o").length;
    return { o, u: played.filter(b => b.r === "u").length, p: played.filter(b => b.r === "p").length, n: played.length, missed: s.length - played.length,
      pct: played.length ? Math.round((100 * o) / played.length) : null };
  }

  /** "3/5 over" for the strip (denominator = games played among the shown boxes). */
  function summary(log, mk, line, n = 5) {
    const r = rate(log, mk, line, n);
    if (!r.n) return { ...r, text: "No recent games" };
    return { ...r, text: `${r.o}/${r.n} over` };
  }

  /** "Hot" = went over in at least 4 of his last 5 games played, or the same share when he has fewer (3/3, 4/4, 2/2).
   *  Needs at least HOT_MIN games; DNPs in the last 5 don't count either way. */
  const HOT_SHARE = 0.8, HOT_MIN = 2;
  const hotNeed = n => Math.ceil(HOT_SHARE * n - 1e-9);
  function isHot(log, mk, line) {
    const r = rate(log, mk, line, 5);
    return r.n >= HOT_MIN && r.o >= hotNeed(r.n);
  }

  /** Season tally [over, under, push, games] from the build -> {o, n, pct, text} */
  function season(t) {
    if (!Array.isArray(t) || !t[3]) return { o: 0, n: 0, pct: null, text: "—" };
    const pct = Math.round((100 * t[0]) / t[3]);
    return { o: t[0], n: t[3], pct, text: `${t[0]}/${t[3]} (${pct}%)` };
  }

  const fmtNum = v => (isNum(v) ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10)) : "—");

  /** Line label: "O/U 266.5", anytime TD is a yes/no bet. */
  function lineText(mk, line) { return mk === "anytime_td" ? "Scores a TD" : `O/U ${fmtNum(line)}`; }

  /** Opening-line note, only when it moved. */
  function moveText(line, open) {
    if (!isNum(open) || !isNum(line) || open === line) return "";
    return `opened ${fmtNum(open)} ${line > open ? "▲" : "▼"}`;
  }

  /** Props for one game grouped by player: [{pid, n, pos, t, ta, log, props:[{mk, label, short, line, open, tally}]}]
   *  ordered away team first (then home), NFL by position (QB, RB, WR, TE), then by the player's biggest line. */
  function byPlayer(doc, gid, teamOrder = []) {
    const g = doc && doc.games && doc.games[String(gid)];
    if (!g) return [];
    const mk = doc.markets || {}, P = doc.players || {}, groups = new Map();
    for (const [pid, m, line, open, tally] of g.props || []) {
      const pl = P[pid];
      if (!pl) continue;
      if (!groups.has(pid)) groups.set(pid, { pid, n: pl.n, pos: pl.pos, t: pl.t, ta: pl.ta, log: pl.log || [], props: [] });
      groups.get(pid).props.push({ mk: m, label: (mk[m] || [m])[0], short: (mk[m] || [m, m])[1], line, open, tally });
    }
    const ord = Object.keys(mk);
    const top = p => Math.max(...p.props.filter(x => x.mk !== "anytime_td").map(x => x.line), 0);
    const ti = t => { const i = teamOrder.indexOf(String(t)); return i < 0 ? 99 : i; };
    const out = [...groups.values()];
    for (const p of out) p.props.sort((a, b) => ord.indexOf(a.mk) - ord.indexOf(b.mk));
    out.sort((a, b) => ti(a.t) - ti(b.t)
      || (doc.lg === "nfl" ? (NFL_POS[a.pos] ?? 9) - (NFL_POS[b.pos] ?? 9) : 0)
      || top(b) - top(a) || String(a.n).localeCompare(String(b.n)));
    return out;
  }

  /** Every upcoming game in the file with props for this player: [{gid, props}] */
  function forPlayer(doc, pid) {
    const out = [];
    for (const gid of Object.keys((doc && doc.games) || {})) {
      const grp = byPlayer(doc, gid).find(p => p.pid === String(pid));
      if (grp) out.push({ gid, player: grp, props: grp.props });
    }
    return out;
  }

  return { isNum, grade, strip, rate, summary, HOT_SHARE, HOT_MIN, hotNeed, isHot, season, fmtNum, lineText, moveText, byPlayer, forPlayer };
});
