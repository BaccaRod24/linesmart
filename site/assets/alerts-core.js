/* LineSmart line alerts: pure logic shared by the browser (assets/alerts.js) and the checker (scripts/line_alerts.mjs).
 * No DOM, no network; unit-tested by scripts/line_alerts_test.mjs. The same trigger rules are re-checked in Postgres
 * (supabase/migrations/20261027_line_alerts.sql, line_alert_condition) before anything is sent. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AlertsCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const TABLE = "line_alerts";
  const MAX_ACTIVE = 10;                      // per user (also enforced by a trigger in the database)
  const BOOKS = ["hardrockbet", "draftkings", "fanduel"];
  const BOOK_NAME = { hardrockbet: "Hard Rock Bet", draftkings: "DraftKings", fanduel: "FanDuel" };
  const KINDS = {
    spread_move:  { label: "Spread moves",   game: true },
    total_move:   { label: "Total moves",    game: true },
    spread_target:{ label: "Spread hits a number", game: true },
    total_target: { label: "Total hits a number",  game: true },
    ml_target:    { label: "Moneyline hits a price", game: true },
    prop_move:    { label: "Prop line moves", game: false },
  };
  const isNum = v => typeof v === "number" && isFinite(v);
  const half = v => Math.round(v * 2) / 2;
  const fmtLine = v => (!isNum(v) ? "" : v === 0 ? "PK" : (v > 0 ? "+" : "-") + Math.abs(v));
  const fmtTotal = v => (isNum(v) ? String(v) : "");
  const fmtOdds = v => (!isNum(v) ? "" : (v > 0 ? "+" : "-") + Math.abs(Math.round(v)));
  /** American odds -> decimal payout (for "price is at least this good"). */
  const dec = a => (a >= 100 ? 1 + a / 100 : a <= -100 ? 1 + 100 / -a : NaN);

  /** Books the visitor may pick: Hard Rock Bet, DraftKings, FanDuel filtered by the state rules (Florida: Hard Rock Bet only). */
  const allowedBooks = isAvailable => BOOKS.filter(k => !isAvailable || isAvailable(k));

  /** Spread sanity: drop a book's spread if its favorite contradicts the same book's moneyline (feed glitch, e.g. -1 vs +1.5). */
  function spreadOk(b) {
    if (!isNum(b.homeSpread) || !isNum(b.homeML) || !isNum(b.awayML) || b.homeSpread === 0 || b.homeML === b.awayML) return true;
    return (b.homeSpread < 0) === (b.homeML < b.awayML);
  }
  /** The number an alert watches at one book of one game: {value, price} or null. */
  function gameValue(g, book, kind, side) {
    const b = g && g.books && g.books[book];
    if (!b || b.stale) return null;
    if (kind === "spread_move" || kind === "spread_target") {
      const v = b[side + "Spread"];
      return isNum(v) && spreadOk(b) ? { value: v, price: isNum(b[side + "SpreadOdds"]) ? b[side + "SpreadOdds"] : null } : null;
    }
    if (kind === "total_move" || kind === "total_target") {
      if (!isNum(b.total)) return null;
      const p = side === "under" ? b.underOdds : b.overOdds;
      return { value: b.total, price: isNum(p) ? p : null };
    }
    if (kind === "ml_target") { const v = b[side + "ML"]; return isNum(v) && Math.abs(v) >= 100 ? { value: v, price: null } : null; }
    return null;
  }
  /** Prop line at one book: props doc row [pid, mk, line, open, tally, {book: [line, over, under, tally]}] (DraftKings-only rows have no 6th item). */
  function propValue(doc, gid, pid, mk, book) {
    const G = doc && doc.games && doc.games[String(gid)];
    const row = G && (G.props || []).find(r => String(r[0]) === String(pid) && r[1] === mk);
    if (!row) return null;
    const B = row[5] && typeof row[5] === "object" ? row[5] : { draftkings: [row[2], null, null] };
    const x = B[book];
    return Array.isArray(x) && isNum(x[0]) ? { value: x[0], price: isNum(x[1]) ? x[1] : null } : null;
  }
  /** Does `value` satisfy the alert? Same rule as line_alert_condition() in SQL. */
  function condition(a, book, value) {
    if (!isNum(value)) return false;
    switch (a.kind) {
      case "spread_move": case "total_move": case "prop_move": {
        const base = a.baseline && a.baseline[book];
        return isNum(base) && Math.abs(value - base) >= a.points - 1e-9;
      }
      case "spread_target": return value >= a.target - 1e-9;                        // that many points or more ("-2.5 or better")
      case "total_target": return a.side === "over" ? value <= a.target + 1e-9 : value >= a.target - 1e-9;
      case "ml_target": return dec(value) >= dec(a.target) - 1e-9;                     // pays at least as much as the target price
      default: return false;
    }
  }
  /** Check one alert against fresh data. Returns {id, book, value, price} for the first matching book (biggest move for move
   *  alerts) or {skip: reason}. `games` = Map "lg/id" -> game; `props` = {lg: doc}. */
  function evaluate(a, games, props, nowMs) {
    const g = games.get(a.league + "/" + a.game_id);
    if (Date.parse(a.starts_at) <= nowMs) return { skip: "expired" };
    if (!g) return { skip: "no-game" };
    if (g.state && g.state !== "pre") return { skip: "started" };
    let best = null;
    for (const book of (a.books || []).filter(k => BOOKS.includes(k))) {
      const v = a.kind === "prop_move" ? propValue(props[a.league], a.game_id, a.player_id, a.prop_market, book) : gameValue(g, book, a.kind, a.side);
      if (!v || !condition(a, book, v.value)) continue;
      const size = /_move$/.test(a.kind) ? Math.abs(v.value - a.baseline[book]) : 0;
      if (!best || size > best.size) best = { id: a.id, book, value: v.value, price: v.price, size };
    }
    if (!best) return { skip: "not-met" };
    delete best.size;
    return best;
  }
  /** All alerts: {hits, skipped: {reason: n}}; hits capped at `limit` (the database applies the real daily caps). */
  function checkAll(alerts, games, props, nowMs, limit = 40) {
    const hits = [], skipped = {};
    for (const a of alerts || []) {
      const r = evaluate(a, games, props, nowMs);
      if (r.skip) skipped[r.skip] = (skipped[r.skip] || 0) + 1;
      else if (hits.length < limit) hits.push(r);
      else skipped["over-limit"] = (skipped["over-limit"] || 0) + 1;
    }
    return { hits, skipped };
  }

  /** Current numbers for the "set alert" sheet: {book: {value, price}} for allowed books. */
  function currentValues(g, kind, side, books, propsDoc, pid, mk) {
    const out = {};
    for (const k of books) { const v = kind === "prop_move" ? propValue(propsDoc, g.id, pid, mk, k) : gameValue(g, k, kind, side); if (v) out[k] = v; }
    return out;
  }
  /** Validate the sheet and build the row to insert (the database re-validates everything). Returns {ok, row} or {ok:false, error}. */
  function build(f, ctx) {
    const kind = f.kind, K = KINDS[kind];
    if (!K) return { ok: false, error: "Pick what to watch." };
    const books = (f.books || []).filter(k => (ctx.allowed || BOOKS).includes(k));
    if (!books.length) return { ok: false, error: "Pick at least one sportsbook." };
    const g = ctx.game;
    if (!g || g.state !== "pre" || !(Date.parse(g.date) > ctx.now)) return { ok: false, error: "Alerts can only be set before the game starts." };
    const cur = currentValues(g, kind, f.side, books, ctx.props, f.player_id, f.prop_market);
    const row = { league: ctx.league, game_id: String(g.id), kind, books, starts_at: new Date(Date.parse(g.date)).toISOString(),
      game_label: clip(`${g.away.abbr || g.away.name} @ ${g.home.abbr || g.home.name}`, 60), side: f.side || null };
    if (/_move$/.test(kind)) {
      const pts = Number(f.points);
      if (!isNum(pts) || pts < 0.5 || pts > 20 || half(pts) !== pts) return { ok: false, error: "Pick a move of 0.5 to 20 points, in half points." };
      const base = Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v.value]));
      if (!Object.keys(base).length) return { ok: false, error: "None of those books has a line for this right now, so there's nothing to measure a move from." };
      Object.assign(row, { points: pts, baseline: base, books: Object.keys(base) });
    } else {
      const t = Number(f.target);
      if (kind === "ml_target" && (!isNum(t) || Math.abs(t) < 100 || Math.abs(t) > 5000 || Math.round(t) !== t)) return { ok: false, error: "Enter a price like -120 or +150." };
      if (kind === "spread_target" && (!isNum(t) || Math.abs(t) > 60 || half(t) !== t)) return { ok: false, error: "Enter a spread like -2.5 or +7, in half points." };
      if (kind === "total_target" && (!isNum(t) || t <= 0 || t > 400 || half(t) !== t)) return { ok: false, error: "Enter a total like 44.5, in half points." };
      Object.assign(row, { target: t, baseline: Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v.value])) });
      const met = Object.keys(row.baseline).filter(k => condition(row, k, row.baseline[k]));
      if (met.length) return { ok: false, error: `${BOOK_NAME[met[0]]} is already there (${kind === "ml_target" ? fmtOdds(row.baseline[met[0]]) : kind === "total_target" ? fmtTotal(row.baseline[met[0]]) : fmtLine(row.baseline[met[0]])}). Pick a number it hasn't reached yet.` };
    }
    if (kind === "spread_move" || kind === "spread_target" || kind === "ml_target") {
      if (f.side !== "home" && f.side !== "away") return { ok: false, error: "Pick a team." };
      row.side_label = clip((f.side === "home" ? g.home : g.away).abbr || "", 12);
    }
    if (kind === "total_target" && f.side !== "over" && f.side !== "under") return { ok: false, error: "Pick over or under." };
    if (kind === "total_move") row.side = null;
    if (kind === "prop_move") {
      if (!f.player_id || !f.prop_market) return { ok: false, error: "Pick a prop." };
      Object.assign(row, { side: null, player_id: String(f.player_id), prop_market: String(f.prop_market),
        side_label: clip(f.player_name || "", 40), prop_label: clip(f.prop_label || f.prop_market, 30) });
    }
    return { ok: true, row };
  }
  const clip = (s, n) => String(s || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, n);

  /** One-line summary for lists and the sheet preview. */
  function describe(a) {
    const bk = (a.books || []).map(k => BOOK_NAME[k] || k);
    const at = bk.length === 3 ? "any of Hard Rock Bet, DraftKings, FanDuel" : bk.join(" or ");
    const who = a.side_label || "";
    switch (a.kind) {
      case "spread_move": return `${who} spread moves ${a.points} pt${a.points === 1 ? "" : "s"} at ${at}`;
      case "total_move": return `Total moves ${a.points} pt${a.points === 1 ? "" : "s"} at ${at}`;
      case "spread_target": return `${who} spread reaches ${fmtLine(a.target)} or better at ${at}`;
      case "total_target": return `Total reaches ${a.side === "over" ? "Over" : "Under"} ${fmtTotal(a.target)} or better at ${at}`;
      case "ml_target": return `${who} moneyline reaches ${fmtOdds(a.target)} or better at ${at}`;
      case "prop_move": return `${who} ${a.prop_label || a.prop_market} line moves ${a.points} pt${a.points === 1 ? "" : "s"} at ${at}`;
      default: return "Line alert";
    }
  }
  /** Status for the Account list. */
  function status(a, nowMs) {
    if (a.status === "fired") return { key: "fired", text: "Sent" };
    if (a.status === "expired" || Date.parse(a.starts_at) <= nowMs) return { key: "expired", text: "Expired at start" };
    return { key: "active", text: "Active" };
  }
  /** Map Supabase/PostgREST errors from the insert to plain words. */
  function insertError(e) {
    const m = String((e && (e.message || e.msg || e.hint)) || e || "");
    if (/alert_limit/.test(m)) return `You already have ${MAX_ACTIVE} active alerts. Delete one in Account to add another.`;
    if (/alert_started|starts_at/.test(m)) return "This game has started or is too far out, so alerts can't be set.";
    if (/JWT|not authenticated|401|row-level security/i.test(m)) return "Your sign-in expired. Sign in again in Account, then try again.";
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "Couldn't reach the server. Check your connection and try again.";
    return "Couldn't save the alert right now. Try again in a minute.";
  }
  return { TABLE, MAX_ACTIVE, BOOKS, BOOK_NAME, KINDS, isNum, fmtLine, fmtTotal, fmtOdds, dec, allowedBooks, spreadOk, gameValue, propValue,
    condition, evaluate, checkAll, currentValues, build, describe, status, insertError };
});
