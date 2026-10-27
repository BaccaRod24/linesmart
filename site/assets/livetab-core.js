/* LineSmart "Live" tab: pure logic (no DOM, no fetch). Browser: window.LiveTabCore. Node: require("./livetab-core.js").
 * Sorts every game the site knows about into three buckets: in progress, starting soon (next 2 h) and just finished
 * (final within the last hour), grouped by league. Scores come from the existing client-side ESPN polling (live.js);
 * this file only decides what goes where. Unit-tested in scripts/livetab_test.mjs. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LiveTabCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const H = 3600e3, M = 60e3;
  const SOON_MS = 2 * H;          // "Starting soon": first pitch / tip-off within the next 2 hours
  const RECENT_MS = 1 * H;        // "Just finished": went final within the last hour
  const LATE_MS = 45 * M;         // a game still "pre" this long after its listed start is shown as starting (delays, stale data)
  // typical length from listed start to final whistle, used when we never saw a game go final this session
  const DUR = { nfl: 3.25 * H, ncaaf: 3.5 * H, nba: 2.4 * H, ncaab: 2.1 * H, nhl: 2.6 * H, mlb: 3 * H, epl: 1.9 * H, mls: 1.9 * H, ucl: 1.9 * H, ufc: 0.4 * H };
  const durOf = lg => DUR[lg] || 3 * H;
  const t = iso => { const v = Date.parse(iso); return isNaN(v) ? null : v; };
  const key = (lg, id) => `${lg}/${id}`;

  /** when a final game ended: when we saw it flip to final (finishedAt[key], ms) or start + typical length */
  function endedAt(lg, g, finishedAt) {
    const seen = finishedAt && finishedAt[key(lg, g.id)];
    if (seen) return seen;
    const s = t(g.date); return s === null ? null : s + durOf(lg);
  }

  /** items: [{lg, g}] where g is the (live-merged) game. Returns {live, soon, recent}, each [{lg, g, at}] sorted. */
  function classify(items, now, opts = {}) {
    const fin = opts.finishedAt || {}, soonMs = opts.soonMs || SOON_MS, recentMs = opts.recentMs || RECENT_MS;
    const live = [], soon = [], recent = [], seen = new Set();
    for (const it of items || []) {
      const lg = it && it.lg, g = it && it.g; if (!lg || !g || g.id == null) continue;
      const k = key(lg, g.id); if (seen.has(k)) continue; seen.add(k);
      const start = t(g.date);
      if (g.state === "in") live.push({ lg, g, at: start });
      else if (g.state === "pre") {
        if (start === null) continue;
        const d = start - now;
        if (d <= soonMs && d >= -LATE_MS) soon.push({ lg, g, at: start, starting: d <= 0 });
      } else if (g.state === "post") {
        if (/postpon|cancel|suspend|delay/i.test(g.statusDetail || "")) continue;
        const e = endedAt(lg, g, fin);
        if (e !== null && now - e <= recentMs && now - e >= -durOf(lg) && (start === null || start <= now)) recent.push({ lg, g, at: Math.min(e, now) });
      }
    }
    live.sort((a, b) => (a.at || 0) - (b.at || 0));
    soon.sort((a, b) => a.at - b.at);
    recent.sort((a, b) => b.at - a.at);
    return { live, soon, recent };
  }

  /** [{lg, items}] in the site's league order (unknown leagues last, alphabetically) */
  function group(list, order = []) {
    const by = {};
    for (const x of list || []) (by[x.lg] = by[x.lg] || []).push(x);
    const rank = lg => { const i = order.indexOf(lg); return i < 0 ? 1e3 : i; };
    return Object.keys(by).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map(lg => ({ lg, items: by[lg] }));
  }

  const ORD = n => { const v = n % 100; return n + (v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"); };
  /** short period/clock text: "Q2 · 8:35", "Halftime", "Top 5th", "2nd · 5:10", "67'", "R2 · 2:14" */
  function clockText(lg, g, kind) {
    const ov = g && g.live, det = String((ov && ov.detail) || (g && g.statusDetail) || "").trim();
    if (!g || g.state !== "in") return det;
    if (lg === "ufc" || kind === "mma") {
      const m = /(?:R(?:ound)?\s*(\d+))/i.exec(det), c = /(\d+:\d{2})/.exec(det);
      if (ov && ov.period) return `R${ov.period}${ov.clock ? " · " + ov.clock : ""}`;
      return m ? `R${m[1]}${c ? " · " + c[1] : ""}` : det || "Live";
    }
    if (/half|end of|delay|intermission|ot\b|shootout/i.test(det) && !/^\d+:\d{2}\s*-/.test(det)) return det;
    const m = /^(\d+:\d{2}|\d+(?:\.\d)?)\s*-\s*(.+)$/.exec(det);   // ESPN "8:35 - 2nd"
    if (m) {
      const per = m[2].trim(), football = kind === "football" || lg === "nfl" || lg === "ncaaf", hoops = kind === "basketball" || lg === "nba" || lg === "ncaab";
      const q = /^(\d)(?:st|nd|rd|th)$/i.exec(per);
      if (q && football) return `Q${q[1]} · ${m[1]}`;
      if (q && hoops && lg !== "ncaab") return `Q${q[1]} · ${m[1]}`;
      if (q && lg === "ncaab") { const n = +q[1]; return `${n <= 2 ? ORD(n) + " half" : "OT" + (n > 3 ? n - 2 : "")} · ${m[1]}`; }
      return `${per} · ${m[1]}`;
    }
    return det || "Live";
  }

  /** "lg/id" of every unsettled pick in this browser's bet tracker (straight bets and the open legs of parlays) */
  function betKeys(bets) {
    const out = new Set();
    for (const b of bets || []) {
      if (!b || (b.status && b.status !== "pending")) continue;
      const sels = b.type === "parlay" ? (b.legs || []).filter(l => l && (!l.result || l.result === "pending")) : [b];
      for (const s of sels) { const e = s && s.event; const lg = s && (s.league || (e && e.lg)); if (e && e.id != null && lg) out.add(key(lg, String(e.id))); }
    }
    return out;
  }

  /** leagues whose index we need: anything with games today or live per the slate; every league with games in the
   *  small hours (a late game from "yesterday" can still be on) or when there is no slate */
  function leaguesToLoad(meta, now = Date.now()) {
    const order = (meta && meta.order) || [], S = meta && meta.slate, L = (meta && meta.leagues) || {};
    if (!S || !S.leagues) return order.slice();
    const hr = +new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(now));
    return order.filter(lg => { const e = S.leagues[lg] || {}; return e.today || e.live || ((hr < 5 || hr >= 22) && (L[lg] || {}).games); });
  }

  /** UFC cards: one row per event for "soon"/"recent" (a card has a dozen fights); live fights stay individual */
  function collapseFights(list) {
    const out = [], ev = {};
    for (const x of list) {
      if (x.lg !== "ufc" || !x.g.event) { out.push(x); continue; }
      const id = x.g.event.id || x.g.event.name;
      if (!ev[id]) { ev[id] = Object.assign({}, x, { fights: 0, event: x.g.event }); out.push(ev[id]); }
      ev[id].fights++;
      if (x.g.mainEvent || (x.g.segment === "main" && !ev[id].main)) ev[id].main = x.g;
    }
    return out;
  }

  return { SOON_MS, RECENT_MS, LATE_MS, DUR, key, endedAt, classify, group, clockText, betKeys, leaguesToLoad, collapseFights };
});
