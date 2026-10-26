/* LineSmart bet tracker — pure logic (no DOM). Loaded in the browser as window.BetCore and in Node tests via require().
 * All money values are plain numbers in the user's currency; odds are American (+150 / -110). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BetCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const isNum = v => v !== null && v !== undefined && v !== "" && !isNaN(v) && isFinite(v);
  const r2 = v => Math.round(v * 100) / 100;

  const BOOKS = { draftkings: "DraftKings", fanduel: "FanDuel", hardrock: "Hard Rock Bet", other: "Other" };
  const TYPES = { ml: "Moneyline", spread: "Spread", total: "Total (O/U)", prop: "Prop / other", parlay: "Parlay" };
  const STATUS = { pending: "Pending", won: "Won", lost: "Lost", push: "Push", void: "Void", cashout: "Cashed out" };
  const SOCCER = new Set(["epl", "mls", "ucl"]);
  const AUTO_TYPES = new Set(["ml", "spread", "total"]);

  // ---------- odds math
  function validAmerican(a) { a = Number(a); return isNum(a) && Math.abs(a) >= 100; }
  function toDecimal(a) {
    a = Number(a);
    if (!validAmerican(a)) return null;
    return a > 0 ? 1 + a / 100 : 1 + 100 / -a;
  }
  function toAmerican(d) {
    d = Number(d);
    if (!isNum(d) || d <= 1) return null;
    return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
  }
  /** profit (not incl. stake) if the bet wins */
  function winProfit(stake, american) { const d = toDecimal(american); return d === null || !isNum(stake) ? null : r2(Number(stake) * (d - 1)); }
  function impliedProb(american) { const d = toDecimal(american); return d === null ? null : 1 / d; }

  /** parlay: decimal product of the legs that still count (won or pending); pushed / void legs drop out */
  function parlayDecimal(legs, { ignoreResults = false } = {}) {
    let d = 1;
    for (const l of legs || []) {
      if (!ignoreResults && (l.result === "push" || l.result === "void")) continue;
      const ld = toDecimal(l.odds);
      if (ld === null) return null;
      d *= ld;
    }
    return d;
  }
  function parlayAmerican(legs) { const d = parlayDecimal(legs, { ignoreResults: true }); return d === null || d <= 1 ? null : toAmerican(d); }

  /** overall result of a parlay from its legs: lost if any leg lost, pending while any leg is open, push if every leg pushed/voided */
  function parlayStatus(legs) {
    if (!legs || !legs.length) return "pending";
    if (legs.some(l => l.result === "lost")) return "lost";
    if (legs.some(l => !l.result || l.result === "pending")) return "pending";
    if (legs.every(l => l.result === "push" || l.result === "void")) return "push";
    return "won";
  }

  /** decimal odds actually paid on a winning bet (parlays re-priced if legs pushed and no manual odds) */
  function effectiveDecimal(bet) {
    if (bet.type === "parlay" && Array.isArray(bet.legs) && bet.legs.length) {
      const reduced = bet.legs.some(l => l.result === "push" || l.result === "void");
      if (!reduced) return toDecimal(bet.odds) ?? parlayDecimal(bet.legs);
      return parlayDecimal(bet.legs);   // ticket odds no longer apply: re-price from the remaining legs
    }
    return toDecimal(bet.odds);
  }

  /** net profit/loss of a bet in currency; 0 while pending */
  function netResult(bet) {
    const stake = Number(bet.stake) || 0;
    switch (bet.status) {
      case "won": { const d = effectiveDecimal(bet); return d === null ? 0 : r2(stake * (d - 1)); }
      case "lost": return r2(-stake);
      case "cashout": return r2((Number(bet.cashout) || 0) - stake);
      default: return 0; // pending, push, void
    }
  }
  /** amount returned to the bettor (stake + profit) */
  function payout(bet) {
    if (bet.status === "pending" || bet.status === "lost") return 0;
    if (bet.status === "push" || bet.status === "void") return Number(bet.stake) || 0;
    return r2((Number(bet.stake) || 0) + netResult(bet));
  }
  function toWin(bet) {
    const d = bet.type === "parlay" && !validAmerican(bet.odds) ? parlayDecimal(bet.legs, { ignoreResults: true }) : toDecimal(bet.odds);
    return d === null ? null : r2((Number(bet.stake) || 0) * (d - 1));
  }

  // ---------- settlement from a final score
  /** final = { home: number, away: number, completed: bool, status?: ESPN status name }
   *  sel   = { type: ml|spread|total, side: home|away|draw|over|under, line?: number, league?: key }
   *  returns won|lost|push, or null if it can't be graded automatically */
  function gradeSelection(sel, final) {
    if (!final || !final.completed || !isNum(final.home) || !isNum(final.away)) return null;
    if (final.status && /CANCEL|POSTPON|SUSPEND|ABANDON|FORFEIT|DELAY/i.test(final.status)) return null;
    const soccer = SOCCER.has(sel.league);
    // 3-way soccer moneylines settle on 90 minutes + stoppage; games that went to extra time / penalties need a manual check
    if (soccer && final.status && /AET|PEN|EXTRA|SHOOTOUT/i.test(final.status)) return null;
    const h = Number(final.home), a = Number(final.away);
    const mine = sel.side === "home" ? h : sel.side === "away" ? a : null, theirs = sel.side === "home" ? a : sel.side === "away" ? h : null;
    if (sel.type === "ml") {
      if (sel.side === "draw") return h === a ? "won" : "lost";
      if (mine === null) return null;
      if (mine > theirs) return "won";
      if (mine < theirs) return "lost";
      return soccer ? "lost" : "push";   // a tie: 2-way ML (e.g. NFL tie) is refunded; 3-way soccer ML loses to the draw
    }
    // quarter lines (Asian handicap -0.25 / 2.75) are split stakes: grade by hand
    if ((sel.type === "spread" || sel.type === "total") && isNum(sel.line) && Math.abs(Number(sel.line) * 4) % 2 === 1) return null;
    if (sel.type === "spread") {
      if (mine === null || !isNum(sel.line)) return null;
      const m = mine + Number(sel.line) - theirs;
      return Math.abs(m) < 1e-9 ? "push" : m > 0 ? "won" : "lost";
    }
    if (sel.type === "total") {
      if (!isNum(sel.line) || (sel.side !== "over" && sel.side !== "under")) return null;
      const t = h + a, ln = Number(sel.line);
      if (Math.abs(t - ln) < 1e-9) return "push";
      return (t > ln) === (sel.side === "over") ? "won" : "lost";
    }
    return null;
  }
  const canAutoSettle = sel => !!(sel && AUTO_TYPES.has(sel.type) && sel.event && sel.event.id && sel.side);

  /** apply graded results; finals: { "<lg>:<eventId>": final }. Returns a new bet or null if nothing changed.
   *  Bets the user settled by hand are never touched. */
  function autoSettle(bet, finals, now = new Date().toISOString()) {
    if (bet.status !== "pending" || bet.manual) return null;
    const key = s => s.event && `${s.league || (s.event && s.event.lg)}:${s.event.id}`;
    if (bet.type === "parlay") {
      let changed = false;
      const legs = (bet.legs || []).map(l => {
        if (l.result && l.result !== "pending") return l;
        if (!canAutoSettle(l)) return l;
        const f = finals[key(l)]; const g = gradeSelection(l, f);
        if (!g) return l;
        changed = true;
        return { ...l, result: g, final: { home: f.home, away: f.away } };
      });
      if (!changed) return null;
      const st = parlayStatus(legs);
      const out = { ...bet, legs };
      if (st !== "pending") {
        // manual ticket odds + a pushed leg: we can't know the book's re-priced odds unless every leg has odds
        if (st === "won" && legs.some(l => l.result === "push" || l.result === "void") && parlayDecimal(legs) === null) return out;
        Object.assign(out, { status: st, settledAt: now, settledBy: "auto" });
      }
      return out;
    }
    if (!canAutoSettle(bet)) return null;
    const f = finals[key(bet)]; const g = gradeSelection(bet, f);
    if (!g) return null;
    return { ...bet, status: g, settledAt: now, settledBy: "auto", final: { home: f.home, away: f.away } };
  }
  /** event keys a bet still needs scores for */
  function pendingEvents(bet) {
    if (bet.status !== "pending" || bet.manual) return [];
    const sels = bet.type === "parlay" ? (bet.legs || []).filter(l => !l.result || l.result === "pending") : [bet];
    return sels.filter(canAutoSettle).map(s => ({ league: s.league || s.event.lg, id: String(s.event.id), date: s.event.date }));
  }

  // ---------- stats
  function inRange(bet, range, now = new Date()) {
    if (!range || range === "all") return true;
    const d = new Date((bet.date || bet.createdAt || "").slice(0, 10) + "T12:00:00");
    if (isNaN(d)) return true;
    if (range === "7d") return now - d <= 7 * 864e5;
    if (range === "30d") return now - d <= 30 * 864e5;
    if (range === "season") return d >= seasonStart(now);
    return true;
  }
  /** "season" = since Aug 1 (football season start); before August it's last year's Aug 1 */
  function seasonStart(now = new Date()) { const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1; return new Date(y, 7, 1); }
  function filterBets(bets, f = {}, now = new Date()) {
    return bets.filter(b => inRange(b, f.range, now) && (!f.book || b.book === f.book) && (!f.league || betLeagues(b).includes(f.league)) && (!f.type || b.type === f.type));
  }
  function betLeagues(b) { return b.type === "parlay" ? [...new Set((b.legs || []).map(l => l.league).filter(Boolean))].concat(b.league ? [b.league] : []) : [b.league].filter(Boolean); }

  function summarize(bets) {
    const s = { n: bets.length, won: 0, lost: 0, push: 0, void: 0, cashout: 0, pending: 0, staked: 0, net: 0, exposure: 0, toWinPending: 0, decSum: 0, decN: 0 };
    for (const b of bets) {
      const st = b.status || "pending", stake = Number(b.stake) || 0;
      s[st] = (s[st] || 0) + 1;
      if (st === "pending") { s.exposure += stake; s.toWinPending += toWin(b) || 0; }
      else if (st !== "void") { s.staked += stake; s.net += netResult(b); }
      if (st !== "void") { const d = b.type === "parlay" && !validAmerican(b.odds) ? parlayDecimal(b.legs, { ignoreResults: true }) : toDecimal(b.odds); if (d) { s.decSum += d; s.decN++; } }
    }
    s.staked = r2(s.staked); s.net = r2(s.net); s.exposure = r2(s.exposure); s.toWinPending = r2(s.toWinPending);
    s.settled = s.won + s.lost + s.push + s.cashout;
    s.winRate = s.won + s.lost ? s.won / (s.won + s.lost) : null;   // pushes and cash-outs excluded
    s.roi = s.staked ? s.net / s.staked : null;
    s.avgOdds = s.decN ? toAmerican(s.decSum / s.decN) : null;     // average of decimal prices, shown as American
    return s;
  }
  const roi = (net, staked) => (staked ? net / staked : null);
  function groupBy(bets, keyFn) {
    const g = {};
    for (const b of bets) for (const k of [].concat(keyFn(b))) (g[k] ||= []).push(b);
    return Object.entries(g).map(([k, list]) => ({ key: k, ...summarize(list) })).sort((a, b) => b.staked + b.exposure - (a.staked + a.exposure));
  }
  /** cumulative P/L series from settled bets, ordered by settle date */
  function cumulative(bets) {
    const done = bets.filter(b => b.status && b.status !== "pending" && b.status !== "void")
      .map(b => ({ t: (b.settledAt || b.date || b.createdAt || "").slice(0, 10), b }))
      .sort((x, y) => x.t.localeCompare(y.t) || String(x.b.createdAt || "").localeCompare(String(y.b.createdAt || "")));
    let c = 0;
    return done.map(({ t, b }) => { c = r2(c + netResult(b)); return { t, v: c, net: netResult(b), id: b.id }; });
  }

  // ---------- storage format, import / export
  const KEY = "ls-bets-v1";
  function normalizeBet(b) {
    if (!b || typeof b !== "object") return null;
    const stake = Number(b.stake);
    if (!isNum(stake) || stake < 0) return null;
    const out = { ...b, stake, id: String(b.id || uid()), status: STATUS[b.status] ? b.status : "pending", type: TYPES[b.type] ? b.type : "prop", book: b.book || "other" };
    if (isNum(b.odds)) out.odds = Number(b.odds); else delete out.odds;
    if (out.type === "parlay") out.legs = Array.isArray(b.legs) ? b.legs.map(l => ({ ...l, odds: isNum(l.odds) ? Number(l.odds) : null })) : [];
    return out;
  }
  function parseImport(text) {
    const d = JSON.parse(text);
    const list = Array.isArray(d) ? d : d && Array.isArray(d.bets) ? d.bets : null;
    if (!list) throw new Error("No bets found in this file");
    return list.map(normalizeBet).filter(Boolean);
  }
  function mergeBets(existing, incoming) {
    const m = new Map(existing.map(b => [b.id, b]));
    let added = 0, updated = 0;
    for (const b of incoming) { if (m.has(b.id)) updated++; else added++; m.set(b.id, b); }
    return { bets: [...m.values()], added, updated };
  }
  const csvCell = v => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function toCSV(bets, describe = b => b.selection || "") {
    const head = ["id", "date", "sportsbook", "league", "type", "event", "selection", "odds", "stake", "status", "cashout", "net", "settled_at", "settled_by", "legs"];
    const rows = bets.map(b => [b.id, b.date, b.book === "other" ? b.bookOther || "Other" : BOOKS[b.book] || b.book, betLeagues(b).join("+"), TYPES[b.type] || b.type,
      b.event ? b.event.name || "" : b.eventText || "", describe(b), isNum(b.odds) ? b.odds : b.type === "parlay" ? parlayAmerican(b.legs) ?? "" : "", b.stake, b.status,
      b.status === "cashout" ? b.cashout : "", netResult(b), b.settledAt || "", b.settledBy || "", b.type === "parlay" ? (b.legs || []).length : ""]);
    return [head, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  return { BOOKS, TYPES, STATUS, SOCCER, KEY, isNum, toDecimal, toAmerican, validAmerican, winProfit, impliedProb, parlayDecimal, parlayAmerican, parlayStatus,
    effectiveDecimal, netResult, payout, toWin, gradeSelection, canAutoSettle, autoSettle, pendingEvents, inRange, seasonStart, filterBets, betLeagues,
    summarize, roi, groupBy, cumulative, normalizeBet, parseImport, mergeBets, toCSV, uid };
});
