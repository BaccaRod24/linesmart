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
  const TYPES = { ml: "Moneyline", spread: "Spread", total: "Total (O/U)", prop: "Player prop / other", parlay: "Parlay" };
  const STATUS = { pending: "Pending", won: "Won", lost: "Lost", push: "Push", void: "Void", cashout: "Cashed out" };
  const SOCCER = new Set(["epl", "mls", "ucl"]);
  const MMA = new Set(["ufc"]);   // bouts: final.home/away = 1 (winner) / 0; totals grade on final.rounds (rounds elapsed)
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
    if (MMA.has(sel.league) && sel.type === "total") {   // total rounds: O/U 2.5 = fight ends after 2:30 of round 3
      if (!isNum(final.rounds) || !isNum(sel.line) || (sel.side !== "over" && sel.side !== "under")) return null;
      const t = Number(final.rounds), ln = Number(sel.line);
      if (Math.abs(t - ln) < 1e-9) return "push";
      return (t > ln) === (sel.side === "over") ? "won" : "lost";
    }
    if (MMA.has(sel.league) && sel.type === "spread") return null;
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
  // ---------- player props: graded from ESPN's box score (summary endpoint) once the game is final
  // Stat getters work on boxScore()'s per-player record. Keys match scripts/props.py's market keys, so a prop picked from
  // the site's props feed (data/props/<lg>.json) settles without any mapping.
  const T = s => s.rtd + s.rectd + s.krtd + s.prtd + s.inttd + s.deftd;   // every TD the player scored (passing TDs don't count)
  const PROP_MARKETS = {
    nfl: {
      pass_yds: ["Passing yards", s => s.py], pass_tds: ["Passing TDs", s => s.ptd], pass_cmp: ["Completions", s => s.cmp],
      pass_att: ["Pass attempts", s => s.att], pass_int: ["Interceptions thrown", s => s.int], pass_rush_yds: ["Pass + rush yards", s => s.py + s.ry],
      rush_yds: ["Rushing yards", s => s.ry], rush_att: ["Carries", s => s.car], receptions: ["Receptions", s => s.rec],
      rec_yds: ["Receiving yards", s => s.recy], rush_rec_yds: ["Rush + rec yards", s => s.ry + s.recy], anytime_td: ["Anytime TD", T],
      longest_rec: ["Longest reception", s => s.lrec], longest_rush: ["Longest rush", s => s.lrush],
    },
    nba: {
      points: ["Points", s => s.pts], rebounds: ["Rebounds", s => s.reb], assists: ["Assists", s => s.ast], threes: ["3-pointers made", s => s.tpm],
      pts_reb: ["Points + rebounds", s => s.pts + s.reb], pts_ast: ["Points + assists", s => s.pts + s.ast], reb_ast: ["Rebounds + assists", s => s.reb + s.ast],
      pra: ["Pts + reb + ast", s => s.pts + s.reb + s.ast], steals: ["Steals", s => s.stl], blocks: ["Blocks", s => s.blk], turnovers: ["Turnovers", s => s.to],
    },
  };
  const YESNO = new Set(["anytime_td"]);   // yes/no props: "Yes" = over 0.5, "No" = under 0.5
  const propLabel = (lg, mk) => ((PROP_MARKETS[lg] || {})[mk] || [mk])[0];
  const num = v => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
  const pair = (v, sep) => String(v ?? "").split(sep).map(num);
  const normName = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.'’-]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();

  /** ESPN summary JSON -> {final:{home, away, completed, status}, players:{pid:{name, team, dnp, st:{...}}}, hasBox}. Pure, so it's unit-tested. */
  function boxScore(sum, lg) {
    const c = (((sum || {}).header || {}).competitions || [])[0] || {};
    const st = (c.status || {}).type || {}, cs = c.competitors || [];
    const h = cs.find(x => x.homeAway === "home"), a = cs.find(x => x.homeAway === "away");
    const final = h && a ? { home: parseFloat(h.score), away: parseFloat(a.score), completed: !!st.completed, status: st.name || "" } : null;
    const players = {};
    const Z = lg === "nfl" ? { py: 0, ptd: 0, int: 0, cmp: 0, att: 0, ry: 0, rtd: 0, car: 0, lrush: 0, rec: 0, recy: 0, rectd: 0, lrec: 0, krtd: 0, prtd: 0, inttd: 0, deftd: 0 }
                           : { pts: 0, reb: 0, ast: 0, tpm: 0, stl: 0, blk: 0, to: 0, min: 0 };
    for (const t of ((sum || {}).boxscore || {}).players || []) {
      const team = String((t.team || {}).id || "");
      for (const cat of (lg === "nfl" ? t.statistics || [] : (t.statistics || []).slice(0, 1))) {
        const keys = cat.keys || [];
        for (const row of cat.athletes || []) {
          const ath = row.athlete || {}, pid = String(ath.id || "");
          if (!pid) continue;
          const p = players[pid] || (players[pid] = { name: ath.displayName || "", team, dnp: false, st: { ...Z } });
          if (lg === "nba" && (row.didNotPlay || !(row.stats || []).length)) { p.dnp = true; continue; }
          const v = Object.fromEntries(keys.map((k, i) => [k, (row.stats || [])[i]])), S = p.st;
          if (lg === "nfl") {
            if (cat.name === "passing") { [S.cmp, S.att] = pair(v["completions/passingAttempts"], "/"); S.py = num(v.passingYards); S.ptd = num(v.passingTouchdowns); S.int = num(v.interceptions); }
            else if (cat.name === "rushing") { S.ry = num(v.rushingYards); S.rtd = num(v.rushingTouchdowns); S.car = num(v.rushingAttempts); S.lrush = num(v.longRushing); }
            else if (cat.name === "receiving") { S.rec = num(v.receptions); S.recy = num(v.receivingYards); S.rectd = num(v.receivingTouchdowns); S.lrec = num(v.longReception); }
            else if (cat.name === "kickReturns") S.krtd = num(v.kickReturnTouchdowns);
            else if (cat.name === "puntReturns") S.prtd = num(v.puntReturnTouchdowns);
            else if (cat.name === "interceptions") S.inttd = num(v.interceptionTouchdowns);
            else if (cat.name === "defensive") S.deftd = num(v.defensiveTouchdowns);
          } else {
            S.pts = num(v.points); S.reb = num(v.rebounds); S.ast = num(v.assists); S.tpm = pair(v["threePointFieldGoalsMade-threePointFieldGoalsAttempted"], "-")[0];
            S.stl = num(v.steals); S.blk = num(v.blocks); S.to = num(v.turnovers); S.min = num(v.minutes);
          }
        }
      }
    }
    return { final, players, hasBox: Object.keys(players).length > 0 };
  }

  /** Find the bet's player in a box score: by ESPN id, else a unique (normalized) name match. */
  function findPlayer(box, prop) {
    const P = (box && box.players) || {};
    if (prop.pid && P[String(prop.pid)]) return P[String(prop.pid)];
    const want = normName(prop.player);
    if (!want) return null;
    const hits = Object.values(P).filter(p => normName(p.name) === want);
    return hits.length === 1 ? hits[0] : null;
  }

  /** Grade one prop selection against a final + box score. Returns null (not final yet / can't fetch), or
   *  {result: "won"|"lost"|"push", value} or {result: "review", reason} when a person should check it. */
  function gradeProp(sel, final) {
    if (!final || !final.completed) return null;
    if (final.status && /CANCEL|POSTPON|SUSPEND|ABANDON|FORFEIT/i.test(final.status)) return { result: "review", reason: "Game wasn't completed as scheduled; check how your book graded it." };
    const pr = sel.prop || {}, lg = sel.league || (sel.event && sel.event.lg);
    const m = (PROP_MARKETS[lg] || {})[pr.mk];
    if (!m) return { result: "review", reason: "This prop type isn't in the box score; grade it by hand." };
    if (!final.box || !final.box.hasBox) return { result: "review", reason: "No box score for this game yet." };
    const p = findPlayer(final.box, pr);
    if (!p) return { result: "review", reason: lg === "nfl" ? `${pr.player || "Player"} isn't in the box score (no stats recorded or didn't play). Books usually void a prop if the player doesn't play.` : `${pr.player || "Player"} isn't in the box score.` };
    if (p.dnp) return { result: "review", reason: `${pr.player || p.name} didn't play. Most books void the bet; check your slip.` };
    const line = YESNO.has(pr.mk) && !isNum(pr.line) ? 0.5 : Number(pr.line);
    if (!isNum(line) || (pr.side !== "over" && pr.side !== "under")) return { result: "review", reason: "Missing line or Over/Under." };
    const v = m[1](p.st);
    if (!isNum(v)) return { result: "review", reason: "Stat not found in the box score." };
    if (v === line) return { result: "push", value: v };
    return { result: (v > line) === (pr.side === "over") ? "won" : "lost", value: v };
  }
  /** "Jordan Love Over 259.5 Passing yards" · "A.J. Brown Anytime TD: Yes" */
  function describeProp(sel) {
    const pr = (sel && sel.prop) || {}, lg = sel.league || (sel.event && sel.event.lg);
    const lab = pr.label || propLabel(lg, pr.mk);
    if (YESNO.has(pr.mk)) return `${pr.player || ""} ${lab}: ${pr.side === "under" ? "No" : "Yes"}`.trim();
    const ln = isNum(pr.line) ? ` ${Number(pr.line)}` : "";
    return `${pr.player || ""} ${pr.side === "under" ? "Under" : pr.side === "over" ? "Over" : ""}${ln} ${lab}`.replace(/\s+/g, " ").trim();
  }
  // tracker book key -> props-feed / odds-file book key
  const FEED_KEY = { hardrock: "hardrockbet", draftkings: "draftkings", fanduel: "fanduel" };
  /** Line + price for one side of a prop at the bet's book, from PropsCore.rowBooks() output ([{key, line, over, under}]).
   *  posted=false when that book hasn't posted the prop (line falls back to the feed's line; odds left blank to type in). */
  function propQuote(books, betBook, side, fallbackLine = null) {
    const b = (books || []).find(x => x.key === FEED_KEY[betBook]);
    if (!b) return { line: isNum(fallbackLine) ? Number(fallbackLine) : null, odds: null, posted: false };
    const od = side === "under" ? b.under : side === "over" ? b.over : null;
    return { line: b.line, odds: isNum(od) ? od : null, posted: true };
  }
  /** Pending bet (or parlay leg) that auto-settle couldn't grade: show "Needs review" + manual buttons. */
  const needsReview = b => !!(b && b.status === "pending" && (b.review || (b.type === "parlay" && (b.legs || []).some(l => l.review && (!l.result || l.result === "pending")))));
  const isPropSel = sel => !!(sel && sel.type === "prop" && sel.prop && sel.prop.mk && (sel.prop.pid || sel.prop.player) && sel.event && sel.event.id);

  const canAutoSettle = sel => !!(sel && !sel.review && ((AUTO_TYPES.has(sel.type) && sel.event && sel.event.id && sel.side) || isPropSel(sel)));

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
        const f = finals[key(l)];
        if (isPropSel(l)) {
          const r = gradeProp(l, f);
          if (!r) return l;
          changed = true;
          return r.result === "review" ? { ...l, review: { reason: r.reason, at: now } } : { ...l, result: r.result, statValue: r.value };
        }
        const g = gradeSelection(l, f);
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
    if (isPropSel(bet)) {
      const r = gradeProp(bet, finals[key(bet)]);
      if (!r) return null;
      if (r.result === "review") return { ...bet, review: { reason: r.reason, at: now } };
      return { ...bet, status: r.result, settledAt: now, settledBy: "auto", statValue: r.value };
    }
    const f = finals[key(bet)]; const g = gradeSelection(bet, f);
    if (!g) return null;
    return { ...bet, status: g, settledAt: now, settledBy: "auto", final: { home: f.home, away: f.away } };
  }
  /** event keys a bet still needs scores for */
  function pendingEvents(bet) {
    if (bet.status !== "pending" || bet.manual) return [];
    const sels = bet.type === "parlay" ? (bet.legs || []).filter(l => !l.result || l.result === "pending") : [bet];
    return sels.filter(canAutoSettle).map(s => { const e = { league: s.league || s.event.lg, id: String(s.event.id), date: s.event.date }; if (isPropSel(s)) e.box = true; return e; });
  }

  // ---------- result chosen by hand when adding / editing a bet (the add-bet form's Result field)
  const RESULTS = ["won", "lost", "push", "void", "cashout"];
  const LEG_RESULTS = ["won", "lost", "push", "void"];
  /** Overall result for a parlay from what the user picked plus any per-leg W/L/P.
   *  chosen: "" (Open) or a RESULTS key. Returns { status, auto, error }: auto = worked out from the legs. */
  function parlayResult(legs, chosen = "") {
    const graded = (legs || []).filter(l => LEG_RESULTS.includes(l.result));
    const fromLegs = graded.length ? parlayStatus(legs) : "pending";
    if (!chosen || chosen === "pending") return { status: fromLegs, auto: fromLegs !== "pending" };
    if (chosen === "cashout" || chosen === "void") return { status: chosen, auto: false };
    const lostLeg = (legs || []).findIndex(l => l.result === "lost");
    if (chosen !== "lost" && lostLeg >= 0) return { status: chosen, error: `Leg ${lostLeg + 1} is marked Lost, so the parlay lost. Change that leg or set the result to Lost.` };
    if (fromLegs !== "pending" && fromLegs !== chosen) return { status: chosen, error: `The legs work out to ${STATUS[fromLegs]}, not ${STATUS[chosen]}. Change a leg result or the bet result.` };
    if (chosen === "won" && (legs || []).some(l => l.result === "push" || l.result === "void") && parlayDecimal(legs) === null)
      return { status: chosen, error: "A leg pushed, so the payout is re-priced from the other legs: enter each leg's odds." };
    return { status: chosen, auto: false };
  }
  /** Mark a bet settled by hand (or re-open it). date = placed date (YYYY-MM-DD) so it lands on that day in the charts;
   *  manual: true keeps auto-settle from overriding it. */
  function manualSettle(bet, status, { cashout, date, today } = {}) {
    const b = { ...bet };
    if (!RESULTS.includes(status)) {
      Object.assign(b, { status: "pending", manual: false, settledAt: null, settledBy: null, cashout: null, final: null });
      return b;
    }
    delete b.review;
    Object.assign(b, { status, manual: true, settledBy: "manual", settledAt: date || bet.date || today || new Date().toISOString().slice(0, 10) });
    if (status === "cashout") b.cashout = isNum(cashout) ? r2(Number(cashout)) : 0; else delete b.cashout;
    return b;
  }
  /** Finished / scheduled games from an ESPN scoreboard (site.web.api.espn.com, read in the browser) for the
   *  "Look up a finished game" picker: same shape as data/<lg>/index.json games so the form can link them. */
  function scoreboardGames(sb) {
    const out = [];
    for (const e of (sb && sb.events) || []) {
      const c = (e.competitions || [])[0]; if (!c) continue;
      const side = ha => { const x = (c.competitors || []).find(t => t.homeAway === ha); if (!x) return null; const t = x.team || {};
        return { id: String(t.id || x.id || ""), abbr: t.abbreviation || t.shortDisplayName || "", name: t.displayName || t.name || "", short: t.shortDisplayName || t.name || t.abbreviation || "",
          score: x.score === undefined || x.score === null || x.score === "" ? null : Number(typeof x.score === "object" ? x.score.value : x.score) }; };
      const home = side("home"), away = side("away"); if (!home || !away) continue;
      const st = ((e.status || c.status || {}).type) || {};
      out.push({ id: String(e.id), date: e.date || c.date, state: st.state || "pre", completed: !!st.completed, detail: st.shortDetail || st.detail || "", home, away });
    }
    return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
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

  // ---------- deeper stats (Overview "Stats" sections). Pure + unit-tested in scripts/bets_test.mjs.
  // Conventions: pending bets never count toward results; void bets are refunded and ignored everywhere (not staked, not in
  // the record, no streak effect); pushes count as staked with $0 profit, show in W-L-P, and neither extend nor break a streak.
  // Cash-outs count by their actual profit/loss but aren't a W or L. Parlays are one bet: settled from their legs
  // (pushed / void legs re-price the ticket, see effectiveDecimal), and never split across sports or prop markets.
  const SPORT_OF = { nfl: "football", ncaaf: "football", nba: "basketball", ncaab: "basketball", wnba: "basketball", nhl: "hockey", mlb: "baseball", epl: "soccer", mls: "soccer", ucl: "soccer", ufc: "mma" };
  const SPORTS = { football: "Football", basketball: "Basketball", baseball: "Baseball", hockey: "Hockey", soccer: "Soccer", mma: "MMA", multi: "Multi-sport parlay", other: "Other" };
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  /** local calendar day ("YYYY-MM-DD") a bet settled on: ISO timestamps are converted to the viewer's local date,
   *  plain dates are kept; falls back to the placed date for older bets without settledAt */
  function settleDay(b) {
    const raw = String(b.settledAt || b.date || b.createdAt || "");
    if (raw.length > 10 && raw.includes("T")) { const d = new Date(raw); if (!isNaN(d)) return ymd(d); }
    return raw.slice(0, 10);
  }
  const isSettled = b => !!b.status && b.status !== "pending" && b.status !== "void";
  /** settled (non-void) bets in the order they settled */
  function settledOrder(bets) {
    return bets.filter(isSettled).map(b => ({ d: settleDay(b), b }))
      .sort((x, y) => x.d.localeCompare(y.d) || String(x.b.settledAt || "").localeCompare(String(y.b.settledAt || "")) || String(x.b.createdAt || "").localeCompare(String(y.b.createdAt || "")));
  }
  /** sport of a bet; a parlay with legs from more than one sport is "multi" */
  function sportOf(b) {
    const sp = new Set(betLeagues(b).map(l => SPORT_OF[l] || "other"));
    if (!sp.size) return "other";
    if (sp.size > 1) return b.type === "parlay" ? "multi" : [...sp][0];
    return [...sp][0];
  }
  /** prop market of a single prop bet ("nba:points"), "other" for free-text props, null for non-props / parlays */
  function propMarket(b) {
    if (!b || b.type !== "prop") return null;
    const mk = b.prop && b.prop.mk;
    if (!mk || mk === "other") return "other";
    return `${b.league || (b.event && b.event.lg) || ""}:${mk}`;
  }
  function propMarketLabel(key) {
    if (!key || key === "other") return "Other / custom";
    const [lg, mk] = key.split(":");
    return propLabel(lg, mk);
  }
  /** streaks over won/lost bets in settle order. current = {kind:"W"|"L", n} (null if none) */
  function streaks(bets) {
    let cur = null, bestW = 0, bestL = 0;
    for (const { b } of settledOrder(bets)) {
      if (b.status !== "won" && b.status !== "lost") continue;   // push / cash-out: no effect
      const k = b.status === "won" ? "W" : "L";
      cur = cur && cur.kind === k ? { kind: k, n: cur.n + 1 } : { kind: k, n: 1 };
      if (k === "W") bestW = Math.max(bestW, cur.n); else bestL = Math.max(bestL, cur.n);
    }
    return { current: cur, longestWin: bestW, longestLoss: bestL };
  }
  /** summarize() + biggest win / loss and streaks */
  function stats(bets) {
    const s = summarize(bets);
    let bw = null, bl = null;
    for (const { b } of settledOrder(bets)) {
      const n = netResult(b);
      if (n > 0 && (!bw || n > bw.net)) bw = { net: n, bet: b };
      if (n < 0 && (!bl || n < bl.net)) bl = { net: n, bet: b };
    }
    return { ...s, biggestWin: bw, biggestLoss: bl, ...streaks(bets) };
  }
  /** is a "YYYY-MM-DD" day within 7d / 30d / season / all of now (same rules as inRange) */
  function dayInRange(day, range, now = new Date()) {
    if (!range || range === "all") return true;
    const d = new Date(String(day).slice(0, 10) + "T12:00:00");
    if (isNaN(d)) return true;
    if (range === "7d") return now - d <= 7 * 864e5;
    if (range === "30d") return now - d <= 30 * 864e5;
    if (range === "season") return d >= seasonStart(now);
    return true;
  }
  /** daily cumulative profit for bets that SETTLED inside the range (starts from $0 at the range start):
   *  [{d, net, v (running total), n, won, lost}] */
  function dailySeries(bets, range = "all", now = new Date()) {
    const days = new Map();
    for (const { d, b } of settledOrder(bets)) {
      if (!dayInRange(d, range, now)) continue;
      const x = days.get(d) || { d, net: 0, n: 0, won: 0, lost: 0 };
      x.net = r2(x.net + netResult(b)); x.n++;
      if (b.status === "won") x.won++; else if (b.status === "lost") x.lost++;
      days.set(d, x);
    }
    let c = 0;
    return [...days.values()].map(x => { c = r2(c + x.net); return { ...x, v: c }; });
  }
  /** peak running total and the largest peak-to-trough drop of a series ({v}), both measured from a $0 start */
  function drawdown(series) {
    let peak = 0, max = 0;
    for (const p of series) { peak = Math.max(peak, p.v); max = Math.max(max, peak - p.v); }
    return { peak: r2(peak), maxDrawdown: r2(max) };
  }
  /** settled results by weekday of the settle day (0 = Sunday) */
  function byWeekday(bets) {
    const g = Array.from({ length: 7 }, () => []);
    for (const { d, b } of settledOrder(bets)) { const t = new Date(d + "T12:00:00"); if (!isNaN(t)) g[t.getDay()].push(b); }
    return g.map((list, i) => ({ key: i, ...summarize(list) }));
  }
  /** day -> {net, n} for a calendar heatmap */
  function byDay(bets) {
    const m = {};
    for (const { d, b } of settledOrder(bets)) { const x = m[d] || (m[d] = { net: 0, n: 0 }); x.net = r2(x.net + netResult(b)); x.n++; }
    return m;
  }
  /** money -> units (null when no unit size) */
  const toUnits = (v, unit) => (isNum(v) && isNum(unit) && Number(unit) > 0 ? v / Number(unit) : null);
  /** sort breakdown rows by a column (name | n | winRate | staked | net | roi); nulls last */
  function sortRows(rows, col = "net", dir = "desc") {
    const val = r => (col === "name" ? String(r.name || r.key).toLowerCase() : col === "rec" ? r.won - r.lost : r[col]);
    const m = dir === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null || x === undefined) return (y === null || y === undefined) ? 0 : 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * m;
    });
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

  return { PROP_MARKETS, YESNO, propLabel, normName, boxScore, findPlayer, gradeProp, isPropSel, describeProp, propQuote, FEED_KEY, needsReview, BOOKS, TYPES, STATUS, SOCCER, MMA, KEY, isNum, toDecimal, toAmerican, validAmerican, winProfit, impliedProb, parlayDecimal, parlayAmerican, parlayStatus,
    effectiveDecimal, netResult, payout, toWin, gradeSelection, canAutoSettle, autoSettle, pendingEvents, inRange, seasonStart, filterBets, betLeagues,
    summarize, roi, groupBy, cumulative, SPORT_OF, SPORTS, settleDay, settledOrder, sportOf, propMarket, propMarketLabel, streaks, stats, dayInRange, dailySeries, drawdown, byWeekday, byDay, toUnits, sortRows, normalizeBet, parseImport, mergeBets, toCSV, uid,
    RESULTS, LEG_RESULTS, parlayResult, manualSettle, scoreboardGames };
});
