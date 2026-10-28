/* LineSmart bet-slip import: pure logic (no DOM, no network). Loaded in the browser as window.SlipCore and in Node tests via require().
 * parseSlip(text, idx) turns the pasted text of a sportsbook bet slip / confirmation (or OCR text from a screenshot) into tickets:
 *   { book, stake, odds, toWin, payout, ref, placed, status, legs: [{ kind, text, team, ou, line, odds, player, pmk, event, market, ... }] }
 * buildIndex(ctx) indexes LineSmart's own data (data/<lg>/index.json games, data/search/<lg>.json rosters, data/props/<lg>.json) so
 * matchTicket() can link each leg to a game / side / player and toDraft() can prefill the bet form (which the user always reviews
 * before anything is saved). Layout-agnostic on purpose: it reads labels and patterns (Wager / To Win / -110 / Over 47.5 / A @ B),
 * not one book's exact screen, so Hard Rock Bet, DraftKings, FanDuel, BetMGM, Caesars, ESPN BET, Fanatics, bet365 copies all work. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SlipCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const isNum = v => v !== null && v !== undefined && v !== "" && !isNaN(v) && isFinite(v);
  // same as BetCore.normName so names match the auto-settle box-score lookup
  const normName = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.'’-]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[.'’]/g, "").replace(/[^a-z0-9+ ]/g, " ").replace(/\s+/g, " ").trim();
  const toAmerican = d => (!isNum(d) || d <= 1 ? null : d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
  const toDecimal = a => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
  const validAmerican = o => isNum(o) && Math.abs(Number(o)) >= 100;

  // ---------- sportsbooks (tracker keys: hardrock / draftkings / fanduel / other)
  const BOOK_RX = [
    ["hardrock", "Hard Rock Bet", /hard\s*rock(\s*bet)?|\bhrb\b/i],
    ["draftkings", "DraftKings", /draft\s*kings|\bdk\s*sportsbook/i],
    ["fanduel", "FanDuel", /fan\s*duel/i],
    ["other", "BetMGM", /bet\s*mgm/i], ["other", "Caesars Sportsbook", /caesars/i], ["other", "ESPN BET", /espn\s*bet/i],
    ["other", "Fanatics Sportsbook", /fanatics/i], ["other", "bet365", /bet\s*365/i], ["other", "BetRivers", /bet\s*rivers/i],
    ["other", "Bally Bet", /bally\s*bet/i], ["other", "Hard Rock Bet", /^$/], ["other", "PrizePicks", /prize\s*picks/i], ["other", "Underdog", /underdog\s*fantasy/i],
  ];
  function detectBook(text) {
    for (const [key, name, rx] of BOOK_RX) if (rx.source !== "^$" && rx.test(text)) return { key, name };
    if (/\bO\/\d{5,}\/\d{3,}/.test(text)) return { key: "fanduel", name: "FanDuel" };   // FanDuel bet IDs look like O/0123456/0001234
    return null;
  }

  // ---------- text clean-up (paste + OCR quirks)
  function clean(text) {
    let t = String(text || "").replace(/\r/g, "").replace(/[\u00a0\u2007\u202f\t]/g, " ").replace(/[＋]/g, "+").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    t = t.replace(/[−–—](?=\s?\$?\d)/g, "-");                        // unicode minus / dashes in front of numbers
    // OCR: letter O read for zero inside numbers (-11O, $1O.OO, +15O)
    for (let i = 0; i < 3; i++) t = t.replace(/([\d$.])[Oo](?=[\dOo.,]|\b)/g, "$10").replace(/([+-])[Oo](?=\d)/g, "$10");
    t = t.replace(/(\d)\s*[,](\d{2})\b(?!\d)/g, (m, a, b) => `${a}.${b}`).replace(/(\d)\s+\.\s*(\d)/g, "$1.$2");   // "$10,00" "47 .5"
    return t.split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(l => l && !/^[-=_*•·|.]{2,}$/.test(l));
  }

  // ---------- small parsers
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?";
  const DATE_RX = new RegExp(`\\b(\\d{4})-(\\d{2})-(\\d{2})\\b|\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b|\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?|\\b(\\d{1,2})\\s+${MON}(?:,?\\s+(\\d{4}))?`, "i");
  const TIME_RX = /\b(\d{1,2}):(\d{2})\s*(am|pm|a|p)?\b\s*(et|est|edt|ct|cst|cdt|mt|mst|pt|pst|pdt)?/i;
  const DOW_RX = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|sday|urday)?\b\.?,?/i;
  const pad = n => String(n).padStart(2, "0");
  /** a date in the line -> "YYYY-MM-DD" (year inferred from `now` when missing: the closest one), plus "HH:MM" (24h, ET) if a time is there */
  function parseDate(s, now) {
    const m = String(s).match(DATE_RX);
    if (!m) return null;
    const ref = now ? new Date(now) : new Date();
    let y, mo, d;
    if (m[1]) { y = +m[1]; mo = +m[2] - 1; d = +m[3]; }
    else if (m[4]) { mo = +m[4] - 1; d = +m[5]; y = m[6] ? (+m[6] < 100 ? 2000 + +m[6] : +m[6]) : null; if (mo > 11 && d <= 12) [mo, d] = [d - 1, mo + 1]; }
    else if (m[7]) { mo = MONTHS[m[7].toLowerCase().slice(0, 3)]; d = +m[8]; y = m[9] ? +m[9] : null; }
    else { d = +m[10]; mo = MONTHS[m[11].toLowerCase().slice(0, 3)]; y = m[12] ? +m[12] : null; }
    if (!(mo >= 0 && mo <= 11 && d >= 1 && d <= 31)) return null;
    if (!y) { y = ref.getFullYear(); const c = Date.UTC(y, mo, d), r = Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate()); if (c - r > 200 * 864e5) y--; else if (r - c > 200 * 864e5) y++; }
    let time = null;
    const t = String(s).match(TIME_RX);
    if (t) { let h = +t[1]; const ap = (t[3] || "").toLowerCase(); if (ap.startsWith("p") && h < 12) h += 12; if (ap.startsWith("a") && h === 12) h = 0; if (h < 24) time = `${pad(h)}:${t[2]}`; }
    return { date: `${y}-${pad(mo + 1)}-${pad(d)}`, time };
  }
  /** ET wall-clock date/time -> epoch ms (ET = UTC-4 in season, UTC-5 Nov-Mar; close enough for picking the nearest game) */
  function etMs(date, time) {
    const [y, mo, d] = date.split("-").map(Number), [h, mi] = (time || "12:00").split(":").map(Number);
    const off = mo >= 4 && mo <= 10 ? 4 : 5;
    return Date.UTC(y, mo - 1, d, h + off, mi);
  }
  const money = s => { const v = parseFloat(String(s).replace(/[$,\s]/g, "")); return isNum(v) ? Math.round(v * 100) / 100 : null; };
  const AMOUNT = "\\$?\\s?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)";

  // ---------- markets & player stats
  /** prop stat phrases -> tracker market keys (see BetCore.PROP_MARKETS). Order matters: combos and specific phrases first. */
  const STATS = [
    ["nfl", "pass_rush_yds", /pass(ing)?\s*(\+|and|&)\s*rush(ing)?\s*(yds|yards)?/],
    ["nfl", "rush_rec_yds", /rush(ing)?\s*(\+|and|&)\s*rec(eiving)?\s*(yds|yards)?/],
    ["nfl", "longest_rec", /longest\s*rec(eption)?/], ["nfl", "longest_rush", /longest\s*rush/],
    ["nfl", "pass_yds", /pass(ing)?\s*(yds|yards)/], ["nfl", "pass_tds", /pass(ing)?\s*(tds?|touchdowns?)/],
    ["nfl", "pass_cmp", /(pass(ing)?\s*)?completions|pass(ing)?\s*cmp/], ["nfl", "pass_att", /pass(ing)?\s*(attempts|att)\b/],
    ["nfl", "pass_int", /interceptions?(\s*thrown)?|\bints?\b/],
    ["nfl", "rush_yds", /rush(ing)?\s*(yds|yards)/], ["nfl", "rush_att", /rush(ing)?\s*(attempts|att)\b|carries/],
    ["nfl", "rec_yds", /rec(eiving)?\s*(yds|yards)/], ["nfl", "receptions", /receptions|catches|\btotal rec\b/],
    ["nfl", "anytime_td", /any\s*time\s*(td|touchdown)|to score (a|any|1\+?)\s*(td|touchdown)|\btd scorer\b|anytime scorer/],
    ["nba", "pra", /p(ts|oints)?\s*\+\s*r(eb|ebs|ebounds)?\s*\+\s*a(st|sts|ssists)?|\bpra\b|points,? rebounds,? (and|&|\+) assists/],
    ["nba", "pts_reb", /(pts|points)\s*(\+|and|&)\s*(reb|rebs|rebounds)|\bp\s*\+\s*r\b/], ["nba", "pts_ast", /(pts|points)\s*(\+|and|&)\s*(ast|asts|assists)|\bp\s*\+\s*a\b/],
    ["nba", "reb_ast", /(reb|rebs|rebounds)\s*(\+|and|&)\s*(ast|asts|assists)|\br\s*\+\s*a\b/],
    ["nba", "threes", /threes|three[- ]?pointers?|3[- ]?pointers?|\b3[- ]?pt|\b3pm\b/],
    ["nba", "points", /\bpoints\b|\bpts\b/], ["nba", "rebounds", /\brebounds\b|\brebs?\b/], ["nba", "assists", /\bassists\b|\basts?\b/],
    ["nba", "steals", /\bsteals\b|\bstl\b/], ["nba", "blocks", /\bblocks\b|\bblk\b/], ["nba", "turnovers", /\bturnovers\b/],
  ];
  // player markets we recognize but can't grade automatically (settle by hand)
  const OTHER_STAT = /first\s*(td|touchdown|basket|goal|scorer)|last\s*(td|touchdown|scorer)|shots?\s*on\s*(goal|target)|\bsog\b|saves|strikeouts|\bk'?s\b|hits\b|total bases|home runs?|\bhrs?\b|\brbis?\b|runs scored|stolen bases|tackles|sacks|field goals|kicking points|power ?play points|goal ?scorer|anytime goal|double[- ]double|triple[- ]double|\bto record\b|\b2\+\s*(td|touchdowns)/;
  function findStat(s) {
    const t = String(s || "").toLowerCase();
    if (/first|last/.test(t) && /(td|touchdown|scorer|basket|goal)/.test(t)) return { other: true };
    if (/\b[2-9]\+\s*(td|touchdowns)/.test(t)) return { other: true };
    for (const [lg, mk, rx] of STATS) if (rx.test(t)) {
      if (mk === "points" && /total points|team total|game total/.test(t)) continue;
      return { lg, mk };
    }
    return OTHER_STAT.test(t) ? { other: true } : null;
  }
  const PERIOD = /\b(1st|2nd|3rd|4th|first|second|third|fourth)\s*(half|quarter|qtr|period|inning)|\b[1-4](h|q|p)\b|\bfirst\s*(5|five)\s*innings?|\bf5\b|\b1st\s*5\b|halftime|\bhalf\b|\bquarter\b|\bperiod\b|\bregulation\b(?!.*3[- ]way)|\bnrfi\b|\byrfi\b/i;
  const LEAGUE_HINT = [
    ["nfl", /\bnfl\b/i], ["ncaaf", /\b(ncaaf|cfb|college football|ncaa football)\b/i], ["nba", /\bnba\b/i], ["ncaab", /\b(ncaab|cbb|college basketball|ncaa basketball|ncaam)\b/i],
    ["mlb", /\bmlb\b|run ?line/i], ["nhl", /\bnhl\b|puck ?line/i], ["epl", /premier league|\bepl\b/i], ["mls", /\bmls\b/i], ["ucl", /champions league|\bucl\b/i],
    ["ufc", /\bufc\b|\bmma\b|fight (winner|result|odds)|bout|method of victory|total rounds|\brounds?\b/i],
  ];
  const leagueHint = s => { for (const [lg, rx] of LEAGUE_HINT) if (rx.test(s)) return lg; return null; };
  const MKT = {
    ml: /\b(money\s?line|\bml\b|match (result|winner|odds)|game (winner|line)|to win( the)? (game|match|fight|bout)?|fight (winner|result|odds)|bout (winner|odds)|winner|3[- ]way|1x2|full[- ]time result|h2h|head to head)\b/i,
    spread: /\b(point\s*spread|spread|run\s*line|puck\s*line|goal\s*line|handicap|alt(ernate)?\s*(spread|lines?))\b/i,
    total: /\b(total|totals|over\s*\/\s*under|o\s*\/\s*u|game total|total (points|runs|goals|rounds)|alt(ernate)?\s*total)\b/i,
  };
  const PARLAY_RX = /\b(\d+)\s*-?\s*(leg|pick|team|selection|fold)s?\b|\bparlay\b|\bsgp\b|\bsgpx\b|same\s*game\s*(parlay|multi)|\bmulti\b|\baccumulator\b|\bacca\b|\bteaser\b|\bround robin\b/i;

  // ---------- line classification
  const ODDS_TOKEN = /(^|[\s(@:/])([+-]\d{3,5})(?=$|[\s),|])|(^|[\s(@:])(even|ev)(?=$|[\s)])/gi;
  const NOISE = /^(bet (placed|confirmed|accepted|receipt|slip|details|summary|info)|your bet (has been|was) (placed|accepted)|placed!?|confirmed!?|accepted!?|success!?|my bets|open( bets)?|settled|active|pending|upcoming|live|single|singles|straight( bet)?|straights|share( bet| slip)?|keep (picks|selections|bets)|reuse selections|retain selections|done|close|ok|view( my)? bets?|details|receipt|go to my bets|bet again|new bet|edit bet|cash ?out|cash ?out available|in[- ]play|today|tomorrow|sgp|same game parlay|parlay|boost(ed)?|profit boost|odds boost|bet boost|parlay boost|bonus bet|free bet|no sweat( bet)?|sportsbook|place bet|leg|legs|selections?|bet|bets|odds|result|status)$/i;
  const SUMMARY_LABELS = [
    ["stake", /\b(total\s+)?(wager(ed)?|stake[ds]?|risk(ed)?|bet amount|amount( wagered)?|you risked|your bet|bet total)\b/i],
    ["payout", /\b(potential|est(imated)?\.?|total|projected)?\s*(payout|return|returns|to pay|winnings|to collect|collect)\b/i],
    ["toWin", /\b(to win|potential win|win amount|potential profit|profit|you could win|you win|won|win)\b/i],
    ["cashout", /\bcash(ed)?\s*out( for| amount)?\b/i],
  ];
  const REF_RX = /\b(bet\s*(id|ref(erence)?|#|no\.?|number|slip id)|ticket\s*(#|id|no\.?|number)?|receipt\s*(#|id|no\.?|number)?|ref(erence)?\s*(#|no\.?|number|id)?|confirmation\s*(#|number|id|no\.?)?|wager\s*id|id)\s*[:#]?\s*([A-Z0-9][A-Z0-9/_-]{3,})/i;
  const PLACED_RX = /\b(placed|accepted|date|bet placed on|submitted|time placed)\b/i;
  const STATUS_RX = /^(?:(?:result|status|outcome|settled)\s*:?\s*)?(won|win|winner|lost|loss|lose|void|voided|cancel+ed|push|pushed|refunded|cashed out)\b/i;

  /** team / player recognition hooks from buildIndex (optional; the parser works without them) */
  const isTeam = (idx, s) => !!(idx && teamHits(idx, s).length);
  const isPlayer = (idx, s) => !!(idx && playerHits(idx, s).length);

  function splitEvent(s) {
    const m = String(s).match(/^(.{2,}?)\s+(?:@|at|vs\.?|v\.?|versus)\s+(.{2,}?)$/i);
    if (!m) return null;
    const a = m[1].trim(), b = m[2].trim();
    if (/^[+\-\d$]/.test(b) || /^[+\-\d$]/.test(a) || /\b(over|under)\b/i.test(a + " " + b) || /[+-]\d/.test(a + " " + b)) return null;
    if (/\bat\b/i.test(s) && !/@|\bvs\b|\bv\b|versus/i.test(s) && /\d/.test(s)) return null;
    const home = !/\bvs\.?\b|\bv\.?\b|versus/i.test(s.slice(m[1].length, s.length - m[2].length));   // "A @ B": B is home; "A vs B": unknown order
    return { a, b, at: home, text: `${a} ${home ? "@" : "vs"} ${b}` };
  }
  /** strip a trailing/leading date & time from a line: returns {rest, when} */
  function takeWhen(line, now) {
    let rest = line, when = null;
    const d = parseDate(line, now), t = line.match(TIME_RX);
    if (d || t) {
      when = d || { date: null, time: null };
      if (!d && t) { let h = +t[1]; const ap = (t[3] || "").toLowerCase(); if (ap.startsWith("p") && h < 12) h += 12; if (ap.startsWith("a") && h === 12) h = 0; when.time = `${pad(h)}:${t[2]}`; }
      rest = rest.replace(DATE_RX, " ").replace(TIME_RX, " ").replace(DOW_RX, " ").replace(/\b(today|tomorrow|tonight)\b/i, " ");
      rest = rest.replace(/\s*[|·•,-]\s*$/, "").replace(/^\s*[|·•,-]\s*/, "").replace(/\s+/g, " ").trim();
    }
    return { rest, when };
  }

  /** classify one cleaned line -> list of tokens */
  function classify(line, idx, now) {
    const out = [];
    let s = line.replace(/^(leg\s*\d+\s*[:.)-]?|\d{1,2}[.)]\s|[•·*>✓✔☑]\s*)/i, "").trim();
    if (!s) return out;
    const low = s.toLowerCase();
    const book = detectBook(s);
    if (book && s.replace(/hard\s*rock(\s*bet)?|draft\s*kings|fan\s*duel|sportsbook|bet\s*mgm|caesars|espn\s*bet|fanatics|bet\s*365|bet\s*rivers|bally\s*bet|casino|[^a-z]/gi, "").length < 4) { out.push({ k: "book", book }); return out; }
    if (book) out.push({ k: "book", book });
    // status
    const st = s.match(STATUS_RX);
    if (st && s.length < 40 && !/\b(to win|win amount|potential)\b/i.test(s)) {
      const w = st[1].toLowerCase();
      const status = /^won|^win/.test(w) ? "won" : /^los/.test(w) ? "lost" : /^push/.test(w) ? "push" : /cash/.test(w) ? "cashout" : "void";
      out.push({ k: "status", status, amount: (s.match(new RegExp(AMOUNT)) || [])[1] ? money(s.match(new RegExp(AMOUNT))[1]) : null });
      if (status !== "cashout" || !/\$/.test(s)) return out;
    }
    // bet reference / placed date
    const ref = s.match(REF_RX);
    if (ref && /\d/.test(ref[ref.length - 1]) && !/\b(over|under)\b/i.test(s)) {
      out.push({ k: "ref", ref: ref[ref.length - 1] });
      const d = parseDate(s, now); if (d && PLACED_RX.test(s)) out.push({ k: "placed", ...d });
      return out;
    }
    if (PLACED_RX.test(s) && parseDate(s, now)) { out.push({ k: "placed", ...parseDate(s, now) }); return out; }
    // money summary (Wager $10.00 · To Win $9.09 · Payout $19.09); several on one line
    const sums = [];
    {
      const rx = new RegExp(`(${SUMMARY_LABELS.map(x => x[1].source).join("|")})\\s*:?\\s*(?:amount)?\\s*:?\\s*${AMOUNT}(?![\\d.]*\\s*(?:pts|points|yds|yards))`, "gi");
      let m;
      while ((m = rx.exec(s))) {
        const lab = m[1], v = money(m[m.length - 1]);
        const key = (SUMMARY_LABELS.find(([, r]) => r.test(lab)) || [])[0];
        if (key && v !== null && (/\$|\./.test(m[0].slice(lab.length)) || key === "stake")) sums.push({ k: "sum", key, v });
      }
    }
    if (!sums.length) {   // amount first: "$10.00 wager · $60.00 to win"
      const rx = new RegExp(`\\$\\s?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)\\s*(${SUMMARY_LABELS.map(x => x[1].source).join("|")})`, "gi");
      let m;
      while ((m = rx.exec(s))) { const key = (SUMMARY_LABELS.find(([, r]) => r.test(m[2])) || [])[0]; if (key) sums.push({ k: "sum", key, v: money(m[1]) }); }
    }
    if (sums.length) { out.push(...sums); if (/(total|parlay)\s*odds|odds\s*:/i.test(s)) { const o = oddsIn(s); if (o.length) out.push({ k: "todds", v: o[o.length - 1] }); } return out; }
    // label alone ("Wager" then "$10.00" on the next line) -> pending label
    for (const [key, rx] of SUMMARY_LABELS) if (rx.test(s) && s.replace(rx, "").replace(/[^a-z0-9]/gi, "").length === 0) { out.push({ k: "label", key }); return out; }
    if (/^\$\s?\d/.test(s) && !/[a-z]{3,}/i.test(s.replace(/\$[\d.,]+/g, ""))) { out.push({ k: "amount", v: money(s) }); return out; }
    // ticket header: "3 Leg Parlay +596", "SGP +1200", "Same Game Parlay", "Single"
    const pm = s.match(PARLAY_RX);
    if (pm && !/\b(over|under)\s*\d/i.test(s) && !/\b(o|u)\s?\d+(\.\d)?\b/i.test(s) && !(pm[2] && /team/i.test(pm[2]) && /total/i.test(s))) {
      const n = pm[1] ? +pm[1] : null, o = oddsIn(s);
      out.push({ k: "header", parlay: true, n, teaser: /teaser/i.test(s), rr: /round robin/i.test(s), sgp: /sgp|same\s*game/i.test(s), odds: o.length ? o[o.length - 1] : null, boost: /boost/i.test(s) });
      return out;
    }
    if (/^(single|straight)( bet)?\b/i.test(s) && s.length < 30) { const o = oddsIn(s); out.push({ k: "header", parlay: false, odds: o.length ? o[0] : null }); return out; }
    if (/\b(odds|price)\b\s*:?\s*([+-]\d{3,5}|even|\d+\.\d{2})\b/i.test(s) && !/\b(over|under)\b/i.test(s)) {
      const m = s.match(/\b(odds|price)\b\s*:?\s*([+-]\d{3,5}|even|\d+\.\d{2})/i), raw = m[2].toLowerCase();
      const v = raw === "even" ? 100 : /\./.test(raw) ? toAmerican(parseFloat(raw)) : parseInt(raw, 10);
      out.push({ k: /total|parlay|combined/i.test(s) ? "todds" : "odds", v, dec: /\./.test(raw) });
      return out;
    }
    if (/\b(profit|odds|parlay|super)?\s*boost(ed)?\b/i.test(s)) out.push({ k: "boost" });
    if (/\b(bonus bet|free bet|site credit|bet credit|no sweat)\b/i.test(s)) out.push({ k: "bonus" });
    if (NOISE.test(s.replace(/[!.:]+$/, ""))) return out;
    if (out.some(t => t.k === "boost" || t.k === "bonus") && s.replace(/\b(profit|odds|parlay|super|bet)\b|boost(ed)?|bonus bet|free bet|site credit|bet credit|no sweat|\d+%|[^a-z0-9]/gi, "").length < 3) return out;
    // odds-only line
    const odds = oddsIn(s);
    let body = s.replace(ODDS_TOKEN, (m, p1, o, p3) => `${p1 || p3 || ""} `).replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").trim();
    if (!body || /^[@()|·•:\s-]*$/.test(body)) { if (odds.length) out.push({ k: "odds", v: odds[odds.length - 1] }); return out; }
    // league chip ("NFL", "Basketball - NBA")
    const lgh = leagueHint(body);
    if (lgh && body.replace(/\b(nfl|nba|mlb|nhl|ncaaf|ncaab|cfb|cbb|ncaa|football|basketball|baseball|hockey|soccer|mma|ufc|college|premier league|epl|mls|champions league|ucl|[-|·•/])\b/gi, "").replace(/[^a-z]/gi, "").length === 0) { out.push({ k: "league", lg: lgh }); return out; }
    // date / time line (game time) or inline time
    const w = takeWhen(body, now);
    if (w.when && !w.rest) { out.push({ k: "when", ...w.when }); if (odds.length) out.push({ k: "odds", v: odds[odds.length - 1] }); return out; }
    // inline pieces separated by " · ", " | ", " - " (e.g. "Eagles -3.5 (-110) · DAL @ PHI")
    const parts = w.rest.split(/\s+[|·•]\s+|\s+[-–—]\s+(?=[A-Z])/);
    let selPart = null; const extra = [];
    for (const p0 of parts) {
      const p = p0.trim(); if (!p) continue;
      const ev = splitEvent(p);
      if (ev && !(selPart === null && parts.length === 1 && !(isTeam(idx, ev.a) || isTeam(idx, ev.b)) && /\b(over|under)\b/i.test(p))) { extra.push({ k: "event", ...ev }); continue; }
      if (selPart === null) selPart = p; else selPart += " - " + p;
    }
    if (w.when) extra.push({ k: "when", ...w.when });
    if (selPart === null) { out.push(...extra); if (odds.length) out.push({ k: "odds", v: odds[odds.length - 1] }); return out; }
    const sel = parseSel(selPart, idx);
    if (sel) { if (odds.length) sel.odds = odds[odds.length - 1]; out.push(sel, ...extra); return out; }
    // a market label ("Moneyline", "Point Spread", "Passing Yards O/U", "Anytime TD Scorer")
    const mk = marketOf(selPart);
    if (mk && mk.mk === "other" && (odds.length || mk.stat === null) && /^[A-Z][A-Za-z.'’-]+(\s+[A-Z][A-Za-z.'’-]+)+/.test(selPart)) {
      const name = stripStat(selPart.replace(/\b(first|last)\b/gi, " ").replace(/\b(td|touchdown|scorer|basket|goal)s?\b/gi, " "));
      if (name.split(" ").length >= 2 && name.split(" ").length <= 4) { out.push({ k: "sel", kind: "other", text: selPart, player: name, otherStat: true, period: mk.period, odds: odds.length ? odds[odds.length - 1] : null }, ...extra); return out; }
    }
    if (mk) { out.push({ k: "market", ...mk, text: selPart }, ...extra); if (odds.length) out.push({ k: "odds", v: odds[odds.length - 1] }); return out; }
    // a bare name (team for a moneyline, or a player whose prop is on another line)
    if (/^[A-Za-z][A-Za-z.'’&\- ]{1,48}$/.test(selPart) && selPart.split(" ").length <= 6) {
      out.push({ k: "sel", kind: "name", text: selPart, name: selPart, odds: odds.length ? odds[odds.length - 1] : null, team: isTeam(idx, selPart), player: isPlayer(idx, selPart) }, ...extra);
      return out;
    }
    if (odds.length) out.push({ k: "sel", kind: "text", text: selPart, odds: odds[odds.length - 1] }, ...extra);
    else out.push({ k: "text", text: selPart }, ...extra);
    return out;
  }
  function oddsIn(s) {
    const out = []; let m; const rx = new RegExp(ODDS_TOKEN.source, "gi");
    while ((m = rx.exec(s))) out.push(m[2] ? parseInt(m[2], 10) : 100);
    return out.filter(v => Math.abs(v) >= 100);
  }
  function marketOf(s) {
    const low = s.toLowerCase();
    const period = PERIOD.test(low);
    const stat = findStat(low);
    if (/team total/.test(low)) return { mk: "other", period, teamTotal: true };
    if (stat && !(stat.mk === "points" && MKT.total.test(low) && !/player/.test(low))) return stat.other ? { mk: "other", period, stat: null } : { mk: "prop", stat: stat.mk, slg: stat.lg, period };
    if (MKT.spread.test(low)) return { mk: "spread", period, lg: leagueHint(low) };
    if (MKT.total.test(low)) return { mk: "total", period, lg: leagueHint(low) };
    if (MKT.ml.test(low)) return { mk: "ml", period, lg: leagueHint(low) };
    if (/\bplayer\b|\bprops?\b|method of victory|by (ko|tko|submission|decision)|go the distance|alt(ernate)?\b|both teams to score|\bbtts\b|double chance|draw no bet|exact score|correct score|race to|margin/.test(low)) return { mk: "other", period };
    return null;
  }
  /** a selection: "Eagles -3.5", "Over 47.5", "Stephen Curry Over 26.5 Points", "Saquon Barkley 100+ Rush Yds", "Saquon Barkley Anytime TD", "Draw" */
  function parseSel(s0, idx) {
    let s = s0.replace(/\((?:[A-Z]{2,4}|[+-]?\d+(\.\d)?)\)/g, m => (/\d/.test(m) ? m.slice(1, -1) : " ")).replace(/\s+/g, " ").trim();
    const low = s.toLowerCase();
    const period = PERIOD.test(low);
    // over / under (game total, team total, or player prop)
    let m = s.match(/^(.*?)(?:^|\s|[-:,])(over|under|o|u)\s?(\d{1,3}(?:\.\d)?)\b(.*)$/i);
    if (m && !(m[2].length === 1 && m[1] && /[a-z]$/i.test(m[1]) && !/\s$/.test(s.slice(0, m[1].length + 1)))) {
      const pre = m[1].replace(/[-:,|]+\s*$/, "").trim(), ou = /^o/i.test(m[2]) ? "over" : "under", line = parseFloat(m[3]), post = m[4].replace(/^[-:,\s]+/, "").trim();
      const statTxt = `${pre} ${post}`, stat = findStat(statTxt);
      const name = stripStat(pre);
      const total = /\btotal\b/i.test(statTxt) && !/team total/i.test(statTxt) && !(name && isPlayer(idx, name));
      if (/team total/i.test(statTxt) || (name && isTeam(idx, name) && !isPlayer(idx, name) && !(stat && !stat.other && stat.lg && !/total/i.test(statTxt)))) return { k: "sel", kind: "other", text: s, team: name, ou, line, period, teamTotal: true };
      if (!name || total) return { k: "sel", kind: "total", text: s, ou, line, period, mkText: post || pre || "" };
      return { k: "sel", kind: "prop", text: s, player: name, ou, line, period, pmk: stat && !stat.other ? stat.mk : null, slg: stat && stat.lg, otherStat: !!(stat && stat.other) };
    }
    // ladder: "25+ Points", "Player 100+ Rushing Yards", "Player To Record 8+ Rebounds"
    m = s.match(/^(.*?)\s*(?:to (?:record|have|get|score)\s*)?(\d{1,3})\+\s*(.+)?$/i);
    if (m && (m[3] || /\+$/.test(s))) {
      const stat = findStat((m[3] || "") + " " + m[1]), n = +m[2], name = stripStat(m[1]);
      if (stat && !stat.other && stat.mk === "anytime_td" && n !== 1) return { k: "sel", kind: "prop", text: s, player: name, otherStat: true, period };
      if (/^(td|tds|touchdowns?)$/i.test((m[3] || "").trim())) return { k: "sel", kind: "prop", text: s, player: name, pmk: n === 1 ? "anytime_td" : null, slg: "nfl", ou: "over", line: 0.5, otherStat: n !== 1, period };
      if (name || stat) return { k: "sel", kind: "prop", text: s, player: name, ou: "over", line: n - 0.5, pmk: stat && !stat.other ? stat.mk : null, slg: stat && stat.lg, otherStat: !stat || stat.other, period };
    }
    // anytime TD written out
    m = s.match(/^(?:anytime\s*(?:td|touchdown)(?:\s*scorer)?\s*[:-]\s*)(.+)$/i) || s.match(/^(.+?)\s*[-:(]?\s*(?:anytime\s*(?:td|touchdown)(?:\s*scorer)?|to score (?:a|any)\s*(?:td|touchdown))\)?$/i);
    if (m && m[1]) return { k: "sel", kind: "prop", text: s, player: m[1].replace(/[-:]+$/, "").trim(), pmk: "anytime_td", slg: "nfl", ou: "over", line: 0.5, period };
    // team with a spread line: "Philadelphia Eagles -3.5", "Eagles +7", "Chiefs PK"
    m = s.match(/^(.+?)\s+([+-]\d{1,2}(?:\.\d)?|pk|pick|pick'?em)(?:\s+(.*))?$/i);
    if (m && !/\d/.test(m[1]) && (!m[3] || marketOf(m[3]) || !/[a-z]{3,}/i.test(m[3]))) {
      const line = /^p/i.test(m[2]) ? 0 : parseFloat(m[2]);
      if (Math.abs(line) < 70) {
        const mk = m[3] ? marketOf(m[3]) : null;
        if (mk && mk.mk === "prop") return { k: "sel", kind: "prop", text: s, player: m[1], pmk: mk.stat, slg: mk.slg, period };
        return { k: "sel", kind: "spread", text: s, team: m[1].trim(), line, period: period || !!(mk && mk.period), mkText: m[3] || "" };
      }
    }
    // "Eagles ML", "Eagles Moneyline", "Eagles to win"
    m = s.match(/^(.+?)\s*[-:(]?\s*(ml|money\s?line|to win|win|\(ml\))\)?$/i);
    if (m && !/\d/.test(m[1])) return { k: "sel", kind: "ml", text: s, team: m[1].trim(), period };
    if (/^(draw|tie|the draw|match drawn|x)$/i.test(s)) return { k: "sel", kind: "ml", text: s, draw: true, period };
    // a player name next to a stat word ("Stephen Curry Points") is a market+name combo whose line is elsewhere
    const stat = findStat(low);
    if (stat && !stat.other && /^[A-Za-z.'’\- ]+$/.test(s)) { const name = stripStat(s); if (name && name.split(" ").length >= 2) return { k: "sel", kind: "prop", text: s, player: name, pmk: stat.mk, slg: stat.lg, period }; }
    return null;
  }
  function stripStat(pre) {
    let s = String(pre || "");
    s = s.replace(/\b(player|alt(ernate)?|to record|to have|to score|o\/u|over\/under)\b/gi, " ");
    for (const [, , rx] of STATS) s = s.replace(new RegExp(rx.source, "gi"), " ");
    s = s.replace(new RegExp(OTHER_STAT.source, "gi"), " ").replace(/\b(total|made|yds|yards|milestones?|props?)\b/gi, " ");
    return s.replace(/[-:,|+()]+/g, " ").replace(/\s+/g, " ").trim();
  }

  // ---------- assemble tickets from tokens
  function parseSlip(text, idx = null, opts = {}) {
    const now = opts.now || Date.now();
    const lines = clean(text);
    const book = detectBook(lines.join("\n"));
    const tickets = [];
    let T = null, L = null, P = null, label = null;
    const newTicket = () => ({ book: book ? book.key : null, bookName: book ? book.name : null, header: null, legs: [], stake: null, toWin: null, payout: null, odds: null, ref: null, placed: null, status: null, cashout: null, boost: false, bonus: false, inSum: false, lines: [] });
    const newP = () => ({ event: null, market: null, when: null, league: null, texts: [] });
    T = newTicket(); P = newP();
    const finish = () => {
      if (L) { T.legs.push(L); L = null; }
      if (T.legs.length || T.stake !== null) tickets.push(T);
      const carry = T.legs.length ? null : T;
      T = newTicket(); P = newP();
      if (carry) { for (const k of ["stake", "toWin", "payout", "odds", "ref", "placed", "status", "cashout", "boost", "bonus", "header", "lines"]) T[k] = carry[k]; tickets.pop(); }
    };
    const startLeg = tok => {
      if (L) T.legs.push(L);
      L = { kind: tok.kind, text: tok.text, team: tok.team || null, draw: !!tok.draw, ou: tok.ou || null, line: isNum(tok.line) ? tok.line : null, odds: isNum(tok.odds) ? tok.odds : null,
        player: tok.player || null, pmk: tok.pmk || null, slg: tok.slg || null, otherStat: !!tok.otherStat, teamTotal: !!tok.teamTotal, period: !!tok.period, name: tok.name || null,
        isTeamName: !!tok.team && tok.kind === "name", isPlayerName: tok.kind === "name" && !!tok.player,
        event: P.event, market: P.market, when: P.when, league: P.league, extra: [] };
      if (L.isTeamName) L.team = tok.text;
      P = newP();
    };
    const wants = (key) => L && L[key] === null && !(P.event || P.market || P.when);
    for (const line of lines) {
      const toks = classify(line, idx, now), Tline = T;
      for (const tok of toks) {
        if (label && tok.k !== "amount") label = null;
        switch (tok.k) {
          case "book": break;
          case "sum":
            if (tok.key === "cashout") { T.status = "cashout"; T.cashout = tok.v; }
            else if (tok.key === "toWin" && /^won/i.test(line) && T.toWin !== null) { /* settled "Won $19.09" */ }
            else if (T[tok.key] === null) T[tok.key] = tok.v;
            T.inSum = true; break;
          case "label": label = tok.key; break;
          case "amount": if (label) { if (label === "cashout") { T.status = "cashout"; T.cashout = tok.v; } else if (T[label] === null) T[label] = tok.v; T.inSum = true; label = null; } break;
          case "ref": T.ref = T.ref || tok.ref; T.inSum = true; break;
          case "placed": T.placed = T.placed || { date: tok.date, time: tok.time }; break;
          case "status": T.status = tok.status; if (tok.amount !== null && tok.status === "cashout") T.cashout = tok.amount; break;
          case "boost": T.boost = true; break;
          case "bonus": T.bonus = true; break;
          case "todds": T.odds = tok.v; break;
          case "header":
            // a header starts a new ticket only after a finished one (stake shown) or a second header; "Parlay (2 legs)" may also come after the legs
            if (((T.legs.length || L) && (T.inSum || T.header)) || (!T.legs.length && !L && T.inSum && T.stake !== null && T.header)) finish();
            T.header = tok; if (isNum(tok.odds)) T.odds = tok.odds; if (tok.boost) T.boost = true; break;
          case "league": if (wants("league")) L.league = tok.lg; else P.league = tok.lg; break;
          case "when": if (L && !L.when && !(P.event || P.market)) L.when = tok; else P.when = tok; break;
          case "event": if (L && !L.event && !(P.market || P.when || P.event)) L.event = tok; else P.event = tok; break;
          case "market": if (L && !L.market && !(P.event || P.when || P.market)) L.market = tok; else P.market = tok; break;
          case "odds":
            if (L && L.odds === null) L.odds = tok.v;
            else if (!L && !T.legs.length && T.header && T.header.parlay && T.odds === null) T.odds = tok.v;
            else if (P.texts.length) { startLeg({ kind: "name", text: P.texts.pop(), odds: tok.v }); }
            else if (T.inSum || (L && L.odds !== null)) { if (T.odds === null) T.odds = tok.v; }
            break;
          case "text": if (L && !P.event && !P.market) L.extra.push(tok.text); else P.texts.push(tok.text); break;
          case "sel": {
            if (T.inSum && (T.legs.length || L)) finish();
            // "Saquon Barkley - Rushing Yards" then "Over 89.5": the over/under completes that prop
            if (L && L.kind === "prop" && !L.ou && L.odds === null && tok.kind === "total" && !P.event && !P.market) { Object.assign(L, { ou: tok.ou, line: tok.line, odds: isNum(tok.odds) ? tok.odds : null, text: `${L.text} ${tok.text}` }); break; }
            // two-line selections: a bare name followed by "Over 26.5 Points" / "-3.5" belongs to the same leg
            if (L && L.kind === "name" && !L.ou && !L.market && !L.event && !P.event && !P.market && (L.odds === null || !isNum(tok.odds))) {
              if ((tok.kind === "total" || (tok.kind === "prop" && !tok.player)) && !L.isTeamName) { Object.assign(L, { kind: "prop", player: L.name, ou: tok.ou, line: tok.line, pmk: tok.pmk || null, slg: tok.slg || null, odds: isNum(tok.odds) ? tok.odds : L.odds, text: `${L.text} ${tok.text}` }); break; }
              if (tok.kind === "total" && L.isTeamName) { Object.assign(L, { kind: "other", teamTotal: true, ou: tok.ou, line: tok.line, odds: isNum(tok.odds) ? tok.odds : null, text: `${L.text} ${tok.text}` }); break; }
            }
            startLeg(tok); break;
          }
          default: break;
        }
      }
      (T === Tline || !T.legs.length && !L ? T : Tline).lines.push(line);
      // a bare spread number on its own line ("-3.5") after a team name
      if (L && L.kind === "name" && /^[+-]\d{1,2}(\.\d)?$/.test(line.replace(/\s*[+-]\d{3,5}$/, "")) && L.line === null) {
        const v = parseFloat(line); if (Math.abs(v) < 70) { L.kind = "spread"; L.line = v; L.team = L.name; const o = oddsIn(line); if (o.length) L.odds = o[o.length - 1]; }
      }
    }
    if (P.texts.length && L && !L.odds) { /* leftover descriptive lines */ }
    finish();
    for (const t of tickets) finalizeTicket(t, idx);
    return { tickets: tickets.filter(t => t.legs.length || t.stake !== null), book, lines };
  }

  function finalizeTicket(T, idx) {
    // resolve each leg's kind from its market line
    const warnings = [];
    T.legs = T.legs.filter(l => !(l.kind === "name" && l.odds === null && !l.market && !l.event && l.line === null && !l.isPlayerName && !l.isTeamName));
    for (const l of T.legs) {
      const mk = l.market;
      if (mk && mk.period) l.period = true;
      if (mk && mk.lg && !l.league) l.league = mk.lg;
      if (l.kind === "name") {
        if (mk && mk.mk === "prop") Object.assign(l, { kind: "prop", player: l.name, pmk: mk.stat, slg: mk.slg, ou: mk.stat === "anytime_td" ? "over" : l.ou, line: mk.stat === "anytime_td" ? 0.5 : l.line });
        else if (mk && mk.mk === "other") l.kind = "other";
        else if (/^(draw|tie)$/i.test(l.name)) Object.assign(l, { kind: "ml", draw: true });
        else if (l.isPlayerName && !l.isTeamName) Object.assign(l, { kind: "other", player: l.name });
        else Object.assign(l, { kind: "ml", team: l.name });
      } else if (l.kind === "text") {
        l.kind = mk && mk.mk === "ml" ? "ml" : "other"; if (l.kind === "ml") l.team = l.text;
      } else if (l.kind === "prop") {
        if (!l.pmk && mk && mk.mk === "prop") { l.pmk = mk.stat; l.slg = mk.slg; }
        if (!l.pmk && mk && mk.mk === "other") l.otherStat = true;
        if (l.pmk === "anytime_td") { l.ou = l.ou || "over"; l.line = 0.5; }
      } else if (l.kind === "total" && mk && mk.mk === "prop" && mk.stat !== "points") {
        l.kind = "other";
      }
      if (mk && mk.teamTotal) { l.kind = "other"; l.teamTotal = true; }
      if (l.kind === "spread" && mk && mk.mk === "ml") { /* "Eagles -3.5" under a Moneyline label is still a spread */ }
      if (!l.league && l.slg) l.league = null;   // stat league is only a hint (nfl/ncaaf, nba/ncaab share words)
    }
    const h = T.header || {};
    T.parlay = !!h.parlay || T.legs.length > 1;
    T.teaser = !!h.teaser; T.roundRobin = !!h.rr; T.sgp = !!h.sgp;
    if (T.roundRobin) warnings.push("Round robins are several parlays in one; this imports one parlay with every leg. Split it by hand if needed.");
    if (T.teaser) warnings.push("Teaser: check that each leg's line is the teased line on your ticket.");
    if (T.legs.length > 1 && !h.parlay) warnings.push("Several selections with one stake: imported as a parlay. If these were separate bets, import them one at a time.");
    // stake / odds sanity: derive odds from payout or to-win when the slip doesn't show them
    const ticketOdds = isNum(T.odds) ? T.odds : null;
    let derived = null;
    if (T.stake > 0 && (T.toWin > 0 || T.payout > T.stake)) {
      const dec = T.toWin > 0 ? 1 + T.toWin / T.stake : T.payout / T.stake;
      derived = toAmerican(Math.round(dec * 10000) / 10000);
    }
    if (T.payout === null && T.toWin !== null && T.stake !== null && !T.bonus) T.payout = Math.round((T.toWin + T.stake) * 100) / 100;
    if (T.toWin === null && T.payout !== null && T.stake !== null) T.toWin = Math.round((T.payout - (T.bonus ? 0 : T.stake)) * 100) / 100;
    if (!T.parlay) {
      const l = T.legs[0], legHad = !!(l && isNum(l.odds));
      T.odds = legHad ? l.odds : ticketOdds !== null ? ticketOdds : derived;
      if (l && !legHad && isNum(T.odds)) l.odds = T.odds;
      if (!legHad && ticketOdds === null && derived !== null) warnings.push("Odds weren't on the slip; worked out from the stake and payout.");
    } else {
      const legOdds = T.legs.map(l => l.odds);
      const prod = legOdds.every(isNum) && legOdds.length ? toAmerican(legOdds.reduce((d, o) => d * toDecimal(o), 1)) : null;
      T.odds = ticketOdds !== null ? ticketOdds : derived !== null ? derived : prod;
      T.oddsManual = T.odds !== null && (prod === null || Math.abs(toDecimal(T.odds) / toDecimal(prod) - 1) > 0.02);
      if (T.sgp && T.oddsManual) warnings.push("Same-game parlay: the ticket's odds are used (books price correlated legs differently from multiplying them).");
    }
    if (T.bonus) warnings.push("Paid with sportsbook site credit: the tracker counts the stake as money risked. Edit the stake if you'd rather log it as $0.");
    if (T.boost) warnings.push("Boosted odds: saved at the odds on your ticket.");
    if (T.stake === null) warnings.push("No stake found on the slip. Enter it below.");
    if (!isNum(T.odds)) warnings.push("No odds found on the slip. Enter them below.");
    if (!T.legs.length) warnings.push("No selection recognized. Fill in the bet below.");
    if (T.legs.some(l => l.period)) warnings.push("Half / quarter / period bets can't be graded from the final score; they're saved for you to settle.");
    T.warnings = warnings;
    return T;
  }

  // ---------- LineSmart data index (teams, players, games)
  /** ctx = { games: {lg: [game]} (data/<lg>/index.json .games), search: {lg: doc} (data/search/<lg>.json), props: {lg: doc} (data/props/<lg>.json) } */
  function buildIndex(ctx = {}) {
    const teams = [], players = [], games = [];
    const seen = new Set();
    const addTeam = (lg, t) => {
      if (!t || !t.name) return;
      const key = `${lg}:${t.id || t.name}`; if (seen.has(key)) return; seen.add(key);
      const name = norm(t.name), short = norm(t.short), abbr = norm(t.abbr), last = norm(t.last);
      const loc = short && name.endsWith(" " + short) ? name.slice(0, -short.length - 1) : "";
      teams.push({ lg, id: String(t.id || ""), name, short, abbr, last, loc, fighter: lg === "ufc", raw: t });
    };
    for (const [lg, list] of Object.entries(ctx.games || {})) for (const g of list || []) {
      if (!g || !g.home || !g.away) continue;
      addTeam(lg, g.home); addTeam(lg, g.away);
      games.push({ lg, g, t: Date.parse(g.date) || 0 });
    }
    for (const [lg, doc] of Object.entries(ctx.search || {})) {
      const T = (doc && doc.teams) || [];
      for (const r of T) addTeam(lg, { id: r[0], name: r[1], abbr: r[2], short: r[3] });
      for (const p of (doc && doc.players) || []) { const t = T[p[2]]; players.push({ lg, pid: String(p[0]), n: p[1], nn: normName(p[1]), tid: t ? String(t[0]) : "", ta: t ? t[2] : "" }); }
    }
    for (const [lg, doc] of Object.entries(ctx.props || {})) {
      const P = (doc && doc.players) || {};
      for (const [pid, p] of Object.entries(P)) if (!players.some(x => x.lg === lg && x.pid === pid)) players.push({ lg, pid, n: p.n, nn: normName(p.n), tid: String(p.t || ""), ta: p.ta || "" });
    }
    // location names ("Philadelphia") only count when unique within the league
    const locCount = {};
    for (const t of teams) if (t.loc) locCount[`${t.lg}:${t.loc}`] = (locCount[`${t.lg}:${t.loc}`] || 0) + 1;
    for (const t of teams) t.locOk = t.loc && locCount[`${t.lg}:${t.loc}`] === 1 && t.loc.length > 3;
    return { teams, players, games, props: ctx.props || {} };
  }
  /** 0-100 match score of free text against a team / fighter */
  function teamScore(text, t) {
    const s = norm(text).replace(/\b(ml|moneyline|money line|to win)\b/g, "").trim();
    if (!s || !t) return 0;
    const w = ` ${s} `;
    if (s === t.name) return 100;
    if (t.abbr && t.short && s === `${t.abbr} ${t.short}`) return 96;
    if (t.fighter) {
      if (t.last && (s === t.last || w.includes(` ${t.last} `) && s.split(" ").length <= 3 && t.name.split(" ").some(p => p.length > 1 && w.includes(` ${p} `) && p !== t.last) )) return 92;
      if (t.last && s === t.last) return 85;
      if (t.last && s.endsWith(" " + t.last) && t.name.startsWith(s[0])) return 80;
      return 0;
    }
    if (w.includes(` ${t.name} `)) return 92;
    if (t.short && s === t.short) return 88;
    if (t.abbr && s === t.abbr && t.abbr.length >= 2) return 84;
    if (t.locOk && s === t.loc) return 76;
    if (t.short && t.short.length >= 4 && w.includes(` ${t.short} `) && s.split(" ").length <= 4) return 74;
    if (t.locOk && w.includes(` ${t.loc} `) && s.split(" ").length <= 4) return 70;
    return 0;
  }
  function teamHits(idx, text, lg = null) {
    const out = [];
    for (const t of idx.teams) { if (lg && t.lg !== lg) continue; const sc = teamScore(text, t); if (sc >= 70) out.push({ t, sc }); }
    return out.sort((a, b) => b.sc - a.sc);
  }
  function playerHits(idx, text, lg = null) {
    const n = normName(String(text || "").replace(/\([^)]*\)/g, " "));
    if (!n || n.split(" ").length < 2) return [];
    const parts = n.split(" "), last = parts[parts.length - 1], first = parts[0];
    let hits = idx.players.filter(p => (!lg || p.lg === lg) && p.nn === n);
    if (!hits.length && first.length === 1) hits = idx.players.filter(p => (!lg || p.lg === lg) && p.nn.endsWith(" " + parts.slice(1).join(" ")) && p.nn[0] === first);
    if (!hits.length) hits = idx.players.filter(p => (!lg || p.lg === lg) && p.nn.split(" ").slice(-1)[0] === last && p.nn.startsWith(first.slice(0, 3)) && first.length >= 3);
    return hits;
  }

  /** link each leg to a LineSmart game/side/player. Adds leg.m = { lg, game, side, how, pid, player } and ticket warnings. */
  function matchTicket(T, idx, opts = {}) {
    const now = opts.now || Date.now();
    const placedMs = T.placed && T.placed.date ? etMs(T.placed.date, T.placed.time) : null;
    for (const l of T.legs) {
      l.m = { lg: null, game: null, side: null, how: "", pid: null, player: null, score: 0 };
      if (!idx) continue;
      const hintLg = l.league || (l.market && l.market.lg) || null;
      const refMs = l.when && l.when.date ? etMs(l.when.date, l.when.time) : placedMs || now;
      const rank = (cands) => {
        // best score first; ties go to the game nearest the bet (games that ended before it was placed rank last)
        return cands.map(c => {
          let d = Math.abs(c.gi.t - refMs) / 36e5;
          if (placedMs && c.gi.t < placedMs - 6 * 36e5) d += 5000;
          if (!l.when && !placedMs && c.gi.g.state === "post" && now - c.gi.t > 36 * 36e5) d += 200;
          if (hintLg && c.gi.lg !== hintLg) d += 10000;
          if (l.slg && !hintLg && !(c.gi.lg === l.slg || (l.slg === "nfl" && c.gi.lg === "ncaaf") || (l.slg === "nba" && c.gi.lg === "ncaab"))) d += 10000;
          return { ...c, d };
        }).sort((a, b) => b.sc - a.sc || a.d - b.d);
      };
      let cands = [];
      const ev = l.event;
      if (ev) {
        for (const gi of idx.games) {
          const { g, lg } = gi;
          const tA = idx.teams.find(t => t.lg === lg && t.id === String(g.away.id)) || null, tH = idx.teams.find(t => t.lg === lg && t.id === String(g.home.id)) || null;
          if (!tA || !tH) continue;
          const s1 = Math.min(teamScore(ev.a, tA), teamScore(ev.b, tH)), s2 = Math.min(teamScore(ev.a, tH), teamScore(ev.b, tA));
          const sc = Math.max(s1, s2);
          if (sc >= 70) cands.push({ gi, sc: sc + 10 });
        }
      }
      const teamText = l.draw ? null : l.team || (l.kind === "ml" ? l.text : null);
      if (!cands.length && teamText) {
        for (const gi of idx.games) {
          const { g, lg } = gi;
          for (const side of ["home", "away"]) { const t = idx.teams.find(x => x.lg === lg && x.id === String(g[side].id)); const sc = t ? teamScore(teamText, t) : 0; if (sc >= 70) cands.push({ gi, sc }); }
        }
      }
      // player props: the player's team (rosters) or the props feed tells us the game
      let ph = [];
      if (l.player) {
        ph = playerHits(idx, l.player);
        if (l.slg) { const f = ph.filter(p => p.lg === l.slg); if (f.length) ph = f; }
        if (!cands.length) for (const p of ph) for (const gi of idx.games) if (gi.lg === p.lg && (String(gi.g.home.id) === p.tid || String(gi.g.away.id) === p.tid || (idx.props[p.lg] && idx.props[p.lg].games && (idx.props[p.lg].games[gi.g.id] || {}).props && idx.props[p.lg].games[gi.g.id].props.some(r => String(r[0]) === p.pid)))) cands.push({ gi, sc: 80 });
      }
      if (!cands.length) continue;
      const r = rank(cands), best = r[0];
      const amb = r.find(c => c.gi !== best.gi && c.sc === best.sc && Math.abs(c.d - best.d) < 1 && c.gi.g.id !== best.gi.g.id);
      const g = best.gi.g, lg = best.gi.lg;
      Object.assign(l.m, { lg, game: g, score: best.sc, how: ev ? "event" : teamText ? "team" : "player", ambiguous: !!amb });
      if (best.d > 2000) l.m.far = true;
      // side
      if (l.kind === "ml" || l.kind === "spread") {
        if (l.draw) l.m.side = "draw";
        else if (teamText) {
          const tH = idx.teams.find(t => t.lg === lg && t.id === String(g.home.id)), tA = idx.teams.find(t => t.lg === lg && t.id === String(g.away.id));
          const sh = teamScore(teamText, tH), sa = teamScore(teamText, tA);
          l.m.side = sh > sa ? "home" : sa > sh ? "away" : null;
        }
      } else if (l.kind === "total") l.m.side = l.ou;
      if (l.player) {
        let p = ph.find(x => x.lg === lg) || null;
        if (!p) {   // last name only ("Jokic 10+ Rebounds"): unique on the two teams in this game
          const nn = normName(l.player), tids = [String(g.home.id), String(g.away.id)];
          const c = idx.players.filter(x => x.lg === lg && tids.includes(x.tid) && (x.nn === nn || x.nn.split(" ").slice(-1)[0] === nn.split(" ").slice(-1)[0]));
          if (c.length === 1) p = c[0];
        }
        l.m.player = p ? p.n : l.player.replace(/\s+/g, " ").trim();
        // the bet form's player picker keys off the props feed's player id for this game
        const doc = idx.props[lg], rows = doc && doc.games && doc.games[String(g.id)] ? doc.games[String(g.id)].props || [] : [];
        const fp = p && rows.some(rw => String(rw[0]) === p.pid) ? p.pid : null;
        l.m.pid = fp; l.m.rosterPid = p ? p.pid : null;
      }
    }
    return T;
  }

  // ---------- bet-form draft (what the review screen shows; nothing is saved until the user taps Save)
  const PROP_LG = new Set(["nfl", "nba"]);
  function evOf(g, lg) {
    return { id: String(g.id), lg, date: g.date, name: `${g.away.abbr} @ ${g.home.abbr}`, home: { id: g.home.id, abbr: g.home.abbr, name: g.home.name, short: g.home.short }, away: { id: g.away.id, abbr: g.away.abbr, name: g.away.name, short: g.away.short } };
  }
  /** opts: { defaultBook, defaultLeague, today } -> form state for bets.js plus review info per leg */
  function toDraft(T, opts = {}) {
    const legs = T.legs.map(l => legDraft(l, opts));
    const parlay = T.parlay && legs.length > 1;
    const type = parlay ? "parlay" : legs.length ? legs[0].mk : "ml";
    const notes = [T.ref ? `Bet ID ${T.ref}` : "", T.boost ? "Boosted odds" : "", T.bonus ? "Site credit" : "", T.sgp ? "Same-game parlay" : "", T.teaser ? "Teaser" : ""].filter(Boolean).join(" · ");
    const odds = isNum(T.odds) ? T.odds : "";
    const F = {
      book: T.book || opts.defaultBook || "other", bookOther: T.book === "other" ? T.bookName || "" : "", bookFromSlip: !!T.book,
      type, date: (T.placed && T.placed.date) || opts.today || new Date().toISOString().slice(0, 10), stake: isNum(T.stake) ? T.stake : "",
      odds: parlay ? (T.oddsManual ? odds : "") : odds, oddsManual: !!(parlay && T.oddsManual), notes,
      status: T.status && T.status !== "pending" ? T.status : "", cashout: isNum(T.cashout) ? T.cashout : "",
      ref: T.ref || "", legs: legs.length ? legs : [legDraft({ kind: "other", text: "", m: {} }, opts)],
    };
    if (!parlay && F.legs[0] && !isNum(F.legs[0].odds) && isNum(odds)) F.legs[0].odds = odds;
    return F;
  }
  function legDraft(l, opts) {
    const m = l.m || {};
    const base = { league: m.lg || l.league || l.slg || opts.defaultLeague || "nfl", eventId: "", event: null, manual: false, eventText: "", mk: "ml", side: "", line: "", odds: isNum(l.odds) ? l.odds : "", selection: "", pid: "", player: "", pmk: "", custom: false };
    const info = { text: l.text || "", status: "manual", why: "" };
    const g = m.game;
    if (g) { base.eventId = String(g.id); base.event = evOf(g, m.lg); }
    else { base.manual = true; base.eventText = l.event ? l.event.text : ""; }
    const auto = !!g && !l.period;
    if ((l.kind === "ml" || l.kind === "spread") && auto && m.side) {
      Object.assign(base, { mk: l.kind, side: m.side, line: l.kind === "spread" ? l.line : "" });
      info.status = m.ambiguous || m.far ? "check" : "matched";
    } else if (l.kind === "total" && auto && l.ou) {
      Object.assign(base, { mk: "total", side: l.ou, line: l.line });
      info.status = m.ambiguous || m.far ? "check" : "matched";
    } else if (l.kind === "prop" && auto && PROP_LG.has(m.lg) && l.pmk && !l.otherStat) {
      Object.assign(base, { mk: "prop", pid: m.pid || "", player: m.player || l.player || "", pmk: l.pmk, custom: !m.pid, side: l.ou || (l.pmk === "anytime_td" ? "over" : ""), line: l.pmk === "anytime_td" ? 0.5 : isNum(l.line) ? l.line : "" });
      info.status = m.ambiguous || m.far || !l.ou || !isNum(base.line) ? "check" : "matched";
    } else if (g) {
      // linked to the game but a market LineSmart can't grade (period, team total, other player stat): saved for you to settle
      Object.assign(base, { mk: l.kind === "ml" || l.kind === "spread" || l.kind === "total" ? l.kind : "prop", pmk: PROP_LG.has(m.lg) ? "other" : "", custom: true, selection: l.text || "", player: "" });
      if (base.mk !== "prop") { base.mk = "prop"; }
      info.status = "settle";
      info.why = l.period ? "Part-game bet (half / quarter / period): settle it yourself." : l.teamTotal ? "Team total: settle it yourself." : "LineSmart can't grade this market automatically; settle it yourself.";
    } else {
      Object.assign(base, { mk: ["ml", "spread", "total", "prop"].includes(l.kind) ? l.kind : "prop", selection: l.text || "" });
      info.status = "manual";
      info.why = l.kind === "prop" && l.player ? "Couldn't find this game in LineSmart's data. Pick it below so the prop can settle automatically." : "Couldn't match this to a game in LineSmart's data. Pick the game below, or keep it as typed and settle it yourself.";
    }
    if (m.ambiguous) info.why = "More than one game fits; check the game below.";
    else if (m.far && !info.why) info.why = "The closest matching game isn't near the slip's date; check the game below.";
    base.review = info;
    return base;
  }
  /** slips already imported (same sportsbook reference) */
  const dupOf = (bets, ref) => (ref ? (bets || []).find(b => b.slipRef && String(b.slipRef) === String(ref)) || null : null);

  /** Preprocess a screenshot's pixel data in place for OCR: grayscale, invert dark mode, stretch contrast. data = RGBA Uint8ClampedArray. */
  function ocrPrep(data) {
    let sum = 0; const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) { const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; data[i] = y; sum += y; }
    const dark = sum / n < 128;
    let lo = 255, hi = 0;
    for (let i = 0; i < data.length; i += 4) { let y = data[i]; if (dark) y = 255 - y; data[i] = y; if (y < lo) lo = y; if (y > hi) hi = y; }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < data.length; i += 4) { const y = Math.max(0, Math.min(255, ((data[i] - lo) / span) * 255)); data[i] = data[i + 1] = data[i + 2] = y; data[i + 3] = 255; }
    return { dark };
  }

  return { clean, detectBook, parseDate, classify, parseSel, findStat, parseSlip, buildIndex, teamScore, teamHits, playerHits, matchTicket, toDraft, evOf, dupOf, ocrPrep, normName, norm };
});
