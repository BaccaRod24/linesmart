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
  const r2 = n => Math.round(Number(n) * 100) / 100;
  // same as BetCore.normName so names match the auto-settle box-score lookup
  const normName = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.'’-]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[.'’]/g, "").replace(/[^a-z0-9+ ]/g, " ").replace(/\s+/g, " ").trim();
  const toAmerican = d => (!isNum(d) || d <= 1 ? null : d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
  const toDecimal = a => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
  const validAmerican = o => isNum(o) && Math.abs(Number(o)) >= 100;

  // ---------- sportsbooks (tracker keys: hardrock / draftkings / fanduel / other)
  const BOOK_RX = [
    ["hardrock", "Hard Rock Bet", /h[ae]rd\s*rock(\s*bet)?|\bhrb\b/i],
    ["draftkings", "DraftKings", /draft\s*kings|\bdk\s*sportsbook/i],
    ["fanduel", "FanDuel", /fan\s*duel/i],
    ["other", "BetMGM", /bet\s*mgm/i], ["other", "Caesars Sportsbook", /caesars/i], ["other", "ESPN BET", /espn\s*bet/i],
    ["other", "Fanatics Sportsbook", /fanatics/i], ["other", "bet365", /bet\s*365/i], ["other", "BetRivers", /bet\s*rivers/i],
    ["other", "Bally Bet", /bally\s*bet/i], ["other", "Hard Rock Bet", /^$/], ["other", "PrizePicks", /prize\s*picks/i], ["other", "Underdog", /underdog\s*fantasy/i],
  ];
  function detectBook(text) {
    for (const [key, name, rx] of BOOK_RX) if (rx.source !== "^$" && rx.test(text)) return { key, name };
    if (/\bO\/\d{5,}\/\d{3,}/.test(text)) return { key: "fanduel", name: "FanDuel" };   // FanDuel bet IDs look like O/0123456/0001234
    if (/\bDK\d{8,22}\b/.test(text)) return { key: "draftkings", name: "DraftKings" };
    // DraftKings slip chrome that survives when the logo is a picture: "4 Pick Parlay", "@ Open", "To Pay" on a parlay.
    if (/\b\d+\s*-?\s*pick\s+parlays?\b/i.test(text)) return { key: "draftkings", name: "DraftKings" };
    if (/@\s*open\b/i.test(text) && /\b(parlay|pick)\b/i.test(text)) return { key: "draftkings", name: "DraftKings" };
    if (/\bto\s+pay\b/i.test(text) && /\b(\d+\s*-?\s*pick|parlay)\b/i.test(text)) return { key: "draftkings", name: "DraftKings" };
    // Hard Rock chrome when the logo is a picture: "SGPMAX" / "4-Bet Parlay" (DraftKings says "4 Pick Parlay").
    if (/\b\d+\s*-?\s*bet\s+parlays?\b/i.test(text) || /s[g6]p\s*m[a@]x/i.test(text)) return { key: "hardrock", name: "Hard Rock Bet" };
    return null;
  }

  // ---------- text clean-up (paste + OCR quirks)
  function clean(text) {
    let t = String(text || "").replace(/\r/g, "").replace(/[\u00a0\u2007\u202f\t]/g, " ").replace(/[＋]/g, "+").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    t = t.replace(/[−–—](?=\s?\$?\d)/g, "-");                        // unicode minus / dashes in front of numbers
    t = t.replace(/(^|[^A-Za-z])S(?=\d)/g, "$1$");                 // OCR: S read for $ ("S20", "Wager S18.75")
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
  /** ET calendar day ("YYYY-MM-DD") for a timestamp, so a slip read just after midnight still sees yesterday's games. */
  function etDay(ms) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); }
    catch (e) { return new Date(ms - 5 * 36e5).toISOString().slice(0, 10); }
  }
  const shiftDay = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const dayDiff = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5);
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
  const PARLAY_RX = /\b(\d+)\s*-?\s*(leg|pick|team|selection|fold|bet)s?\b|\bparlay\b|\bsgp\s*max\b|\bsgpx\b|\bsgp\b|same\s*game\s*(parlay|multi)|\bmulti\b|\baccumulator\b|\bacca\b|\bteaser\b|\bround robin\b/i;

  // ---------- line classification
  const ODDS_TOKEN = /(^|[\s(@:/])([+-]\d{3,5})(?=$|[\s),|])|(^|[\s(@:])(even|ev)(?=$|[\s)])/gi;
  const NOISE = /^(bet (placed|confirmed|accepted|receipt|slip|details|summary|info)|your bet (has been|was) (placed|accepted)|placed!?|confirmed!?|accepted!?|success!?|my bets|open( bets)?|settled|active|pending|upcoming|live|single|singles|straight( bet)?|straights|share( bet| slip)?|keep (picks|selections|bets)|reuse selections|retain selections|done|close|ok|view( my)? bets?|details|receipt|go to my bets|bet again|new bet|edit bet|cash ?out|cash ?out available|in[- ]play|today|tomorrow|sgp|same game parlay|parlay|boost(ed)?|profit boost|odds boost|bet boost|parlay boost|bonus bet|free bet|no sweat( bet)?|sportsbook|place bet|leg|legs|selections?|bet|bets|odds|result|status)$/i;
  const SUMMARY_LABELS = [
    ["stake", /\b(total\s+)?(wager(ed)?|stake[ds]?|risk(ed)?|bet amount|amount( wagered)?|you risked|your bet|bet total)\b/i],
    ["payout", /\b(potential|est(imated)?\.?|total|projected)?\s*(payout|return|returns|to pay|winnings|to collect|collect|paid)\b/i],
    ["toWin", /\b(to win|potential win|win amount|potential profit|profit|you could win|you win|won|win)\b/i],
    ["cashout", /\bcash(ed)?\s*out( for| amount)?\b/i],
  ];
  const REF_RX = /\b(bet\s*(id|ref(erence)?|#|no\.?|number|slip id)|ticket\s*(#|id|no\.?|number)?|receipt\s*(#|id|no\.?|number)?|ref(erence)?\s*(#|no\.?|number|id)?|confirmation\s*(#|number|id|no\.?)?|wager\s*id|id)\s*[:#]?\s*([A-Z0-9][A-Z0-9/_-]{3,})/i;
  /** A bet id, or "" when the line is only the label (the digits are on the next line). null = not an id line.
   *  DraftKings ids are long digit strings, often split by OCR spaces, with the label above or "Bet lD". */
  function refFrom(s0) {
    const s = String(s0).replace(/\bbet\s*[Il1][Dd]\b/gi, "Bet ID");
    const flat = s.replace(/\s+/g, "");
    if (/^\d{12,22}$/.test(flat)) return flat;
    if (/^DK\d{12,22}$/i.test(flat)) return "DK" + flat.replace(/\D/g, "");
    const hash = s.trim().match(/^#\s*((?:DK)?\d[\d\s]{11,30})$/i);
    if (hash) {
      const c = hash[1].replace(/\s+/g, "");
      if (/^(?:DK)?\d{12,22}$/i.test(c)) return /^dk/i.test(c) ? "DK" + c.replace(/\D/g, "") : c.replace(/\D/g, "");
    }
    if (/^(?:bet\s*id|bet\s*#|wager\s*id|ticket(?:\s*id)?|confirmation|id)\s*[:#]?$/i.test(s.trim())) return "";
    const m = s.match(REF_RX);
    if (!m || !/\d/.test(m[m.length - 1])) return null;
    let id = m[m.length - 1];
    const at = s.indexOf(id);
    const more = (at >= 0 ? s.slice(at + id.length) : "").match(/^(?:\s+\d{2,})+/);
    if (more && /^\d+$/.test(id)) id = (id + more[0]).replace(/\s+/g, "");
    return id;
  }
  /** Token / free-play stake: the cash wager is not on the slip. Amount is optional. */
  function lineBonus(s) {
    const token = /\bb[o0]nus\s*b[e3]ts?\b|\bfree\s*bets?\b|\bb[o0]nus\s*tokens?\b|\bbet\s*tokens?\b/i.test(s) || /^b[o0]nus$/i.test(String(s).trim()) || /\$\s?\d[\d,]*(?:\.\d{1,2})?\s+b[o0]nus\b/i.test(s);
    if (!token) return null;
    if (/\b(payout|to\s*pay|to\s*win|returns?)\b/i.test(s)) return { v: null };
    const am = String(s).match(/\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
    return { v: am ? money(am[1]) : null };
  }
  const PLACED_RX = /\b(placed|accepted|date|bet placed on|submitted|time placed)\b/i;
  const STATUS_RX = /^(?:(?:result|status|outcome|settled)\s*:?\s*)?(won|win|winner|lost|loss|lose|void|voided|cancel+ed|push|pushed|refunded|cashed out)\b/i;
  /** Hard Rock paints WINNER across the share-card header. That is a result, not a moneyline. */
  function winnerBanner(s) {
    const n = (String(s).match(/\bwinner\b/gi) || []).length;
    if (n >= 2) return true;
    if (n !== 1) return false;
    const rest = String(s).replace(/\b(winner|won|win|h[ae]rd\s*rock(\s*bet)?|sportsbook|bet)\b/gi, "").replace(/[^a-z]/gi, "");
    return rest.length < 3;
  }
  function statusOfWord(w) {
    w = String(w || "").toLowerCase();
    if (/^won|^win/.test(w)) return "won";
    if (/^los/.test(w)) return "lost";
    if (/^push/.test(w)) return "push";
    if (/cash/.test(w)) return "cashout";
    if (/^void|^cancel|^refund/.test(w)) return "void";
    return null;
  }
  /** Final stat printed next to an over/under (4 on a 9.5 line). */
  function gradeStat(ou, line, value) {
    if (!isNum(value) || !isNum(line) || (ou !== "over" && ou !== "under")) return null;
    if (Math.abs(Number(value) - Number(line)) < 1e-6) return "push";
    return (Number(value) > Number(line)) === (ou === "over") ? "won" : "lost";
  }

  /** team / player recognition hooks from buildIndex (optional; the parser works without them) */
  const isTeam = (idx, s) => !!(idx && teamHits(idx, s).length);
  const isPlayer = (idx, s) => !!(idx && playerHits(idx, s).length);

  /** "SGP Ravens @ Bills -428" is a game, not a parlay header. Group price is not the ticket odds. */
  function gameLine(s) {
    let t = String(s || "").replace(/^(?:sgp\s*max|sgpx|sgp)\b[:\s-]*/i, "").replace(/^\([^)]{1,12}\)\s*/, "").replace(/^[A-Za-z0-9$]{1,6}\)\s+/, "").replace(/^\[[^\]]{0,8}\]?\s*/, "").replace(/^(?:[A-Za-z]?\d{1,4})\s+/, "").trim();
    t = t.replace(/\s+[+-]\d{3,5}\s*$/, "").trim();
    const ev = splitEvent(t);
    return ev;
  }
  function splitEvent(s) {
    const m = String(s).match(/^(.{2,}?)\s*(?:@|\bat\b|vs\.?|\bv\.?\b|versus)\s*(.{2,}?)$/i);
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

  /** Drop OCR junk glued in front of a player or a milestone ("Aa, Victor…", "Oo ar LaMelo…", "Fy 25+", "oO a 35+"). */
  function peelJunk(s) {
    let t = String(s || "").replace(/\s+/g, " ").trim();
    for (let i = 0; i < 5; i++) {
      const n = t.replace(/^[o0]{1,2}\s+(?:ar|a|or|&)\s+/i, "").replace(/^(?:aa|oo|fy)\b[, ]+/i, "").replace(/^&\s*/, "").trim();
      if (n === t) break;
      t = n;
    }
    return t;
  }
  /** classify one cleaned line -> list of tokens */
  function classify(line, idx, now) {
    const out = [];
    const checked = /[✓✔☑]/.test(String(line).slice(0, 8));
    let s = line.replace(/^(leg\s*\d+\s*[:.)-]?|\d{1,2}[.)]\s|[•·*>✓✔☑]\s*)/i, "").trim();
    // dark-mode OCR turns the green check into © or @ glued to "Under 9.5"
    // A leading @ is a game line ("@ MIN Today 8:10 PM SAS"), not the dark-mode check glued to Over/Under.
    s = s.replace(/^[\s©•·*✓✔☑#\[\]<>~]+/, "").replace(/^@\s+(?=over\b|under\b)/i, "").replace(/^["“”'`]+/, "").replace(/^[A-Za-z]\s+(?=(?:over|under)\b)/i, "").trim();
    if (!s) return out;
    if (/^[S$®©Ⓡ]+$/.test(s)) return out;
    // "Cash-out $150" on an open slip is a button, not a settled result. "Cashed out" still counts.
    if (/\bcash-?\s*out\b/i.test(s) && !/\bcashed\b/i.test(s)) return out;
    if (/^track$/i.test(s)) return out;
    // The token icon on a DraftKings slip OCRs as ® or © between "Wager" and the amount.
    if (/[®©Ⓡ]/.test(s) && /\b(wager|stake|risk|bet\s*amount)\b/i.test(s)) out.push({ k: "bonus" });
    if (/[®©Ⓡ]/.test(s)) s = s.replace(/[®©Ⓡ]/g, " ").replace(/\s+/g, " ").trim();
    const low = s.toLowerCase();
    const book = detectBook(s);
    const winnerLine = winnerBanner(s) || (book && /\bwinner\b/i.test(s) && s.replace(/\b(winner|h[ae]rd\s*rock(\s*bet)?|sportsbook|bet)\b/gi, "").replace(/[^a-z]/gi, "").length < 8);
    if (winnerLine) {
      if (book) out.push({ k: "book", book });
      out.push({ k: "status", status: "won", amount: null });
      return out;
    }
    if (/^(hide|show)\s+selections?\b/i.test(s)) return out;
    // "Under 9.5, Over 25.5, Under 9.5" is the parlay subtitle, not a game total
    if ((s.match(/\b(?:over|under)\s*\d/gi) || []).length >= 2 && !/\$/.test(s)) return out;
    const idOnly = /\bDK\d{8,22}\b/i.test(s) && s.replace(/\bDK\d{8,22}\b/gi, "").replace(/[^a-z]/gi, "").length < 3;
    if (book && !idOnly && s.replace(/hard\s*rock(\s*bet)?|draft\s*kings|fan\s*duel|sportsbook|bet\s*mgm|caesars|espn\s*bet|fanatics|bet\s*365|bet\s*rivers|bally\s*bet|casino|[^a-z]/gi, "").length < 4) { out.push({ k: "book", book }); return out; }
    if (book) out.push({ k: "book", book });
    const bn = lineBonus(s);
    if (bn) {
      out.push({ k: "bonus", v: bn.v });
      const rest = s.replace(/\bb[o0]nus\s*b[e3]ts?\b|\bfree\s*bets?\b|\bb[o0]nus\s*tokens?\b|\bbet\s*tokens?\b|\$\s?\d[\d,.]*/gi, " ").replace(/[^a-z]/gi, "");
      if (rest.length < 4) return out;
    }
    // status
    const st = s.match(STATUS_RX);
    if (st && s.length < 40 && !/\b(to win|win amount|potential)\b/i.test(s)) {
      const w = st[1].toLowerCase();
      const status = statusOfWord(w) || "void";
      out.push({ k: "status", status, amount: (s.match(new RegExp(AMOUNT)) || [])[1] ? money(s.match(new RegExp(AMOUNT))[1]) : null });
      if (status !== "cashout" || !/\$/.test(s)) return out;
    }
    // bet reference / placed date (label and digits may be split; OCR spaces the digits)
    const rf = !/\b(over|under)\b/i.test(s) ? refFrom(s) : null;
    if (rf === null && !/\b(over|under)\b/i.test(s)) {
      const emb = s.match(/\b(DK\d{8,22})\b/i) || s.match(/(?:^|\D)(\d{12,22})(?!\d)/);
      if (emb) {
        const id = /^dk/i.test(emb[1]) ? "DK" + emb[1].replace(/\D/g, "") : emb[1];
        out.push({ k: "ref", ref: id });
        if (s.replace(emb[0], " ").replace(/[^a-z]/gi, "").length < 4) return out;
      }
    }
    if (rf !== null) {
      if (rf === "") out.push({ k: "label", key: "ref" });
      else {
        out.push({ k: "ref", ref: rf });
        const d = parseDate(s, now); if (d && PLACED_RX.test(s)) out.push({ k: "placed", ...d });
      }
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
    {
      const parts = s.split(/\s+/).filter(Boolean);
      if (parts.length >= 2 && parts.length <= 4) {
        const keys = parts.map(p => { for (const [key, rx] of SUMMARY_LABELS) if (rx.test(p) && p.replace(rx, "").replace(/[^a-z0-9]/gi, "") === "") return key; return null; });
        if (keys.every(Boolean)) { keys.forEach(key => out.push({ k: "label", key })); return out; }
      }
    }
    // "$20 $126.29", or OCR reading the dollar sign as S ("S20 $126.29")
    // a bare "20.00" (cents, no dollar sign) is money; "9.5" / "27" stay as lines and finals
    if (/^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(s)) { out.push({ k: "amount", v: money(s) }); return out; }
    if (/[S$]/.test(s) && !/[a-z]{3,}/i.test(s.replace(/[$S\d.,\s]/g, ""))) {
      const amounts = [...s.matchAll(/[$S]\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)].map(m => money(m[1])).filter(v => v !== null);
      if (amounts.length) { amounts.forEach(v => out.push({ k: "amount", v })); return out; }
    }
    // "35+, 7+, 11+, 25+" is the parlay's line list, not four selections
    {
      const pluses = [...s.matchAll(/\b(\d{1,3})\+/g)].map(m => +m[1]);
      if (pluses.length >= 2 && !/[a-z]{4,}/i.test(s)) { out.push({ k: "miles", ns: pluses }); return out; }
    }
    // Hard Rock settled card score bar: "TNS 64  Final Score  94 MUR" (also "Q4 2:31", "2nd Half")
    {
      const bar = s.match(/^([A-Za-z]{2,5})\s+(\d{1,3})\s+(final(?:\s+score)?|(?:live|\d(?:st|nd|rd|th)|q\d|ot|half)[^\d]*?(?:\d{1,2}:\d{2})?)\s+(\d{1,3})\s+([A-Za-z]{2,5})$/i);
      if (bar) { out.push({ k: "hint", abbrs: [bar[1].toUpperCase(), bar[5].toUpperCase()], scores: [+bar[2], +bar[4]], final: /final/i.test(bar[3]), when: null }); return out; }
    }
    // "@ MIN Today 8:10 PM SAS" — two abbreviations and a time, order not reliable
    {
      const foot = s.match(/^@\s*([A-Za-z]{2,4})\b(.*)\b([A-Za-z]{2,4})\s*$/);
      if (foot && /today|tonight|\d{1,2}:\d{2}/i.test(s)) {
        const when = { date: /today|tonight/i.test(s) ? etDay(now) : ((parseDate(s, now) || {}).date || null), time: null };
        const tm = s.match(TIME_RX);
        if (tm) { let h = +tm[1]; const ap = (tm[3] || "").toLowerCase(); if (ap.startsWith("p") && h < 12) h += 12; if (ap.startsWith("a") && h === 12) h = 0; if (h < 24) when.time = `${pad(h)}:${tm[2]}`; }
        out.push({ k: "hint", abbrs: [foot[1].toUpperCase(), foot[3].toUpperCase()], when });
        return out;
      }
    }
    {
      const peeled = peelJunk(s);
      if (peeled && peeled !== s) s = peeled;
      if (/^\d{1,3}\+$/.test(s)) { out.push({ k: "mile", n: parseInt(s, 10), text: s }); return out; }
    }
    // ticket header: "3 Leg Parlay +596", "SGP +1200", "Same Game Parlay", "Single"
    const gl = gameLine(s);
    if (gl && (/\bsgp/i.test(s) || /@/.test(s) || /\b(?:vs\.?|at)\b/i.test(s))) {
      const groupPrice = /\s[+-]\d{3,5}\s*$/.test(s);
      out.push({ k: "event", ...gl, sgp: /\bsgp/i.test(s) || groupPrice });
      const go = oddsIn(s);
      if (go.length) out.push({ k: "godds", v: go[go.length - 1] });
      return out;
    }
    const pm = s.match(PARLAY_RX);
    if (pm && !gl && !/\b(over|under)\s*\d/i.test(s) && !/\b(o|u)\s?\d+(\.\d)?\b/i.test(s) && !(pm[2] && /team/i.test(pm[2]) && /total/i.test(s))) {
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
    if (/\b(site credit|bet credit|no sweat)\b/i.test(s)) out.push({ k: "credit" });
    if (NOISE.test(s.replace(/[!.:]+$/, ""))) return out;
    if (out.some(t => t.k === "boost" || t.k === "bonus" || t.k === "credit") && s.replace(/\b(profit|odds|parlay|super|bet)\b|boost(ed)?|bonus bet|free bet|site credit|bet credit|no sweat|\d+%|[^a-z0-9]/gi, "").length < 3) return out;
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
    if (sel) { if (odds.length) sel.odds = odds[odds.length - 1]; if (checked) sel.checked = true; out.push(sel, ...extra); return out; }
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
    if (winnerBanner(s)) return null;
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
    if (stat && !stat.other) {
      const name = stripStat(s);
      const words = name.split(" ").filter(Boolean);
      if (words.length >= 2 && words.length <= 5 && !/\d/.test(name)) return { k: "sel", kind: "prop", text: s, player: name, pmk: stat.mk, slg: stat.lg, period };
    }
    return null;
  }
  function stripStat(pre) {
    let s = String(pre || "");
    s = s.replace(/\b(player|alt(ernate)?|to record|to have|to score|o\/u|over\/under)\b/gi, " ").replace(/\b\d{1,3}\+/g, " ");
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
    let T = null, L = null, P = null, labels = [];
    const newTicket = () => ({ book: book ? book.key : null, bookName: book ? book.name : null, header: null, legs: [], stake: null, toWin: null, payout: null, odds: null, ref: null, placed: null, status: null, cashout: null, boost: false, bonus: false, credit: false, stakeFromSlip: false, stakeEstimated: false, payoutEstimated: false, oddsEstimated: false, gameHint: null, inSum: false, lines: [] });
    const newP = () => ({ event: null, market: null, when: null, league: null, texts: [] });
    T = newTicket(); P = newP();
    let pendingAmounts = [], bonusWants = false, mileSet = new Set(), curEvent = null, curWhen = null, afterSgp = false;
    const applyMoney = (key, v) => {
      if (key === "cashout") { T.status = "cashout"; T.cashout = v; }
      else if (T[key] == null) { T[key] = v; if (key === "stake") T.stakeFromSlip = true; }
      T.inSum = true;
    };
    const attachMile = (leg, n) => {
      if (!leg || isNum(leg.line) || !isNum(n)) return;
      if (leg.kind === "name" && !leg.isTeamName) { leg.kind = "prop"; leg.player = leg.player || leg.name; }
      if (leg.kind !== "prop") return;
      leg.ou = leg.ou || "over"; leg.line = n - 0.5; leg.text = `${leg.text || ""} ${n}+`.trim();
    };
    const finish = () => {
      if (L) { T.legs.push(L); L = null; }
      if (T.legs.length || T.stake !== null) tickets.push(T);
      const carry = T.legs.length ? null : T;
      T = newTicket(); P = newP();
      if (carry) { for (const k of ["stake", "toWin", "payout", "odds", "ref", "placed", "status", "cashout", "boost", "bonus", "credit", "header", "lines"]) T[k] = carry[k]; tickets.pop(); }
      pendingAmounts = []; bonusWants = false;
    };
    const startLeg = tok => {
      if (L) T.legs.push(L);
      L = { kind: tok.kind, text: tok.text, team: tok.team || null, draw: !!tok.draw, ou: tok.ou || null, line: isNum(tok.line) ? tok.line : null, odds: isNum(tok.odds) ? tok.odds : null,
        player: tok.player || null, pmk: tok.pmk || null, slg: tok.slg || null, otherStat: !!tok.otherStat, teamTotal: !!tok.teamTotal, period: !!tok.period, name: tok.name || null,
        isTeamName: !!tok.team && tok.kind === "name", isPlayerName: tok.kind === "name" && !!tok.player,
        checked: !!tok.checked, statValue: null, result: null,
        event: P.event || curEvent, eventSticky: !P.event && !!curEvent, market: P.market, when: P.when || curWhen, league: P.league, extra: [] };
      if (L.isTeamName) L.team = tok.text;
      P = newP();
    };
    const wants = (key) => L && L[key] === null && !(P.event || P.market || P.when);
    const mentions = (ev, teamText) => {
      if (!ev || !teamText) return false;
      const blob = `${ev.a} ${ev.b}`.toLowerCase(), t = String(teamText).toLowerCase();
      if (blob.includes(t) || t.includes(String(ev.a).toLowerCase()) || t.includes(String(ev.b).toLowerCase())) return true;
      const last = t.split(" ").pop();
      return [ev.a, ev.b].some(side => {
        const w = String(side).toLowerCase().split(" ").pop();
        return last && w && last.length >= 5 && w.length >= 5 && editDist(last, w) <= 2 && last.slice(0, 3) === w.slice(0, 3);
      });
    };
    for (const line of lines) {
      const toks = classify(line, idx, now), Tline = T;
      let selThisLine = false;
      for (const tok of toks) {
        const bareMoney = tok.k === "text" && /^\$?\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?$/.test(String(tok.text || "").trim());
        if (tok.k !== "amount" && tok.k !== "label" && !bareMoney) labels = [];
        if (tok.k !== "event" && tok.k !== "godds" && tok.k !== "when" && tok.k !== "league") afterSgp = tok.k === "odds" ? afterSgp : false;
        switch (tok.k) {
          case "book": break;
          case "sum":
            if (tok.key === "toWin" && /^won/i.test(line) && T.toWin !== null) { /* settled "Won $19.09" */ }
            else applyMoney(tok.key, tok.v);
            break;
          case "bonus":
            T.bonus = true;
            if (isNum(tok.v)) { if (T.stake == null) { T.stake = tok.v; T.stakeFromSlip = true; } T.inSum = true; bonusWants = false; }
            else if (pendingAmounts.length && T.stake == null) { T.stake = pendingAmounts.shift(); T.stakeFromSlip = true; T.inSum = true; bonusWants = false; }
            else bonusWants = T.stake == null;
            break;
          case "credit": T.credit = true; break;
          case "label":
            if (tok.key === "ref") { labels.push("ref"); break; }
            if (pendingAmounts.length && !(bonusWants && tok.key !== "stake")) applyMoney(tok.key, pendingAmounts.shift());
            else labels.push(tok.key);
            break;
          case "amount": {
            if (bonusWants && T.stake == null && !labels.length) { T.stake = tok.v; T.inSum = true; bonusWants = false; break; }
            const key = labels.shift();
            if (key && key !== "ref") applyMoney(key, tok.v);
            else if (!key) pendingAmounts.push(tok.v);
            break;
          }
          case "ref": T.ref = T.ref || tok.ref; T.inSum = true; labels = labels.filter(k => k !== "ref"); break;
          case "placed": T.placed = T.placed || { date: tok.date, time: tok.time }; break;
          case "status": T.status = tok.status; if (tok.amount !== null && tok.status === "cashout") T.cashout = tok.amount; break;
          case "boost": T.boost = true; break;
          case "todds": T.odds = tok.v; break;
          case "miles": for (const n of tok.ns || []) mileSet.add(n); break;
          case "hint": T.gameHint = { abbrs: tok.abbrs || [], scores: tok.scores || null, final: !!tok.final, when: tok.when || null }; break;
          case "mile":
            if (L && !isNum(L.line) && !P.event) attachMile(L, tok.n);
            else P.mile = { n: tok.n };
            break;
          case "header":
            // a header starts a new ticket only after a finished one (stake shown) or a second header; "Parlay (2 legs)" may also come after the legs
            if (((T.legs.length || L) && (T.inSum || T.header)) || (!T.legs.length && !L && T.inSum && T.stake !== null && T.header)) finish();
            const prev = T.header;
            T.header = { ...tok, sgp: !!(tok.sgp || (prev && prev.sgp)), n: tok.n || (prev && prev.n) || null, odds: isNum(tok.odds) ? tok.odds : (prev && isNum(prev.odds) ? prev.odds : null) };
            if (isNum(T.header.odds)) T.odds = T.header.odds; if (tok.boost || (prev && prev.boost)) T.boost = true; break;
          case "league": if (wants("league")) L.league = tok.lg; else P.league = tok.lg; break;
          case "when":
            if (/today|tonight/i.test(line) && !tok.date) tok.date = etDay(now);
            curWhen = tok;
            if (L && !L.when && !(P.event || P.market)) L.when = tok; else P.when = tok;
            break;
          case "event":
            curEvent = tok;
            afterSgp = !!tok.sgp;
            {
              const teamTxt = L && (L.team || L.name);
              const better = L && teamTxt && !mentions(L.event, teamTxt) && mentions(tok, teamTxt);
              // "SGP Team @ Team" is the next group's header. "Falcons @ Buccaneers" under a prop belongs to that prop.
              const underProp = L && L.player && !tok.sgp && (L.eventSticky || !L.event);
              if (selThisLine && L) L.event = tok;
              else if (better) L.event = tok;
              else if (underProp) { L.event = tok; L.eventSticky = false; }
              else if (L && !L.player && !L.team && (L.kind === "total" || !L.event)) L.event = tok;
              else if (L && !L.event && !(P.market || P.when || P.event)) L.event = tok;
              else P.event = tok;
            }
            break;
          case "godds": break;
          case "market": if (L && !L.market && !(P.event || P.when || P.market)) L.market = tok; else P.market = tok; break;
          case "odds":
            if (afterSgp) { afterSgp = false; break; }
            if (L && L.odds === null) L.odds = tok.v;
            else if (!L && !T.legs.length && T.header && T.header.parlay && T.odds === null) T.odds = tok.v;
            else if (P.texts.length) { startLeg({ kind: "name", text: P.texts.pop(), odds: tok.v }); }
            else if (T.inSum || (L && L.odds !== null)) { if (T.odds === null) T.odds = tok.v; }
            break;
          case "text": {
            const moneyLine = String(tok.text || "").trim();
            if (labels.length && /^\$?\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?$/.test(moneyLine)) {
              applyMoney(labels.shift(), money(moneyLine));
              break;
            }
            const bareN = String(tok.text || "").trim().match(/^(\d{1,3})$/);
            if (bareN && mileSet.has(+bareN[1])) {
              if (L && !isNum(L.line) && !P.event) attachMile(L, +bareN[1]);
              else P.mile = { n: +bareN[1] };
              break;
            }
            const numOnly = /^[\d]+(?:\.\d+)?$/.test(String(tok.text || "").trim());
            if (numOnly && /today|tonight|\d{1,2}:\d{2}/i.test(line)) break;
            if (L && numOnly && isNum(L.line) && L.statValue == null) {
              const n = parseFloat(tok.text), ln = Number(L.line);
              const echo = Math.abs(n - ln) < 1e-6 || Math.abs(n - ln * 10) < 0.2;
              if (!echo) L.statValue = n;
              break;
            }
            if (L && !P.event && !P.market) L.extra.push(tok.text); else P.texts.push(tok.text);
            break;
          }
          case "sel": {
            pendingAmounts = [];
            if (P.mile && tok.kind === "prop" && !isNum(tok.line)) { tok.ou = tok.ou || "over"; tok.line = P.mile.n - 0.5; tok.text = `${tok.text || ""} ${P.mile.n}+`.trim(); P.mile = null; }
            // Hard Rock settled props: "Under 9.5 -130" then "CADE CUNNINGHAM - ASSISTS"
            if (L && !L.player && tok.kind === "prop" && tok.player && (L.kind === "total" || L.kind === "prop") && !P.event && !P.market && !(isNum(L.line) && isNum(tok.line) && Math.abs(L.line - tok.line) > 0.01)) {
              Object.assign(L, { kind: "prop", player: tok.player, pmk: tok.pmk || L.pmk, slg: tok.slg || L.slg, otherStat: !!(L.otherStat || tok.otherStat), checked: L.checked || !!tok.checked, ou: L.ou || tok.ou || null, line: isNum(L.line) ? L.line : tok.line, text: `${L.text} ${tok.text}`.trim() });
              break;
            }
            // A parlay header already on this ticket keeps later legs here. Stake-above-legs share cards would otherwise split one parlay into many tickets.
            if (T.inSum && (T.legs.length || L) && !(T.header && T.header.parlay)) finish();
            // "Saquon Barkley - Rushing Yards" then "Over 89.5": the over/under completes that prop
            if (L && L.kind === "prop" && !L.ou && L.odds === null && tok.kind === "total" && !P.event && !P.market) { Object.assign(L, { ou: tok.ou, line: tok.line, odds: isNum(tok.odds) ? tok.odds : null, text: `${L.text} ${tok.text}` }); break; }
            // two-line selections: a bare name followed by "Over 26.5 Points" / "-3.5" belongs to the same leg
            if (L && L.kind === "name" && !L.ou && !L.market && !L.event && !P.event && !P.market && (L.odds === null || !isNum(tok.odds))) {
              const nw = String(L.name || "").split(" ").filter(Boolean);
              const nameOk = nw.length >= 2 || (nw.length === 1 && nw[0].length >= 4);
              if (nameOk && (tok.kind === "total" || (tok.kind === "prop" && !tok.player)) && !L.isTeamName) { Object.assign(L, { kind: "prop", player: L.name, ou: tok.ou, line: tok.line, pmk: tok.pmk || null, slg: tok.slg || null, odds: isNum(tok.odds) ? tok.odds : L.odds, text: `${L.text} ${tok.text}` }); break; }
              if (tok.kind === "total" && L.isTeamName) { Object.assign(L, { kind: "other", teamTotal: true, ou: tok.ou, line: tok.line, odds: isNum(tok.odds) ? tok.odds : null, text: `${L.text} ${tok.text}` }); break; }
            }
            startLeg(tok); selThisLine = true; break;
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
    if (L) { T.legs.push(L); L = null; }
    if (T.legs.length || T.stake !== null || T.payout !== null || T.status || isNum(T.odds)) tickets.push(T);
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
      const graded = gradeStat(l.ou, l.line, l.statValue);
      if (graded) l.result = graded;
      else if (l.checked && !l.result) l.result = "won";
    }
    collapseLegs(T);
    if (!T.status && T.legs.length && T.legs.every(l => l.result && l.result !== "pending")) {
      if (T.legs.some(l => l.result === "lost")) T.status = "lost";
      else if (T.legs.every(l => l.result === "push" || l.result === "void")) T.status = "push";
      else T.status = "won";
    }
    const h = T.header || {};
    T.parlay = !!h.parlay || T.legs.length > 1;
    T.teaser = !!h.teaser; T.roundRobin = !!h.rr; T.sgp = !!h.sgp || T.legs.some(l => l.event && l.event.sgp);
    if (T.roundRobin) warnings.push("Round robins are several parlays in one; this imports one parlay with every leg. Split it by hand if needed.");
    if (T.teaser) warnings.push("Teaser: check that each leg's line is the teased line on your ticket.");
    if (T.legs.length > 1 && !h.parlay) warnings.push("Several selections with one stake: imported as a parlay. If these were separate bets, import them one at a time.");
    // Money: a cash payout includes the stake (To Pay / Payout / Returns). To Win is profit only.
    // A token stake is not returned, so the printed payout is profit: amount = payout / (decimal − 1).
    const ticketOdds = isNum(T.odds) ? T.odds : null;
    let derived = null;
    if (T.stake > 0 && (T.toWin > 0 || (T.payout > 0 && (T.bonus || T.payout > T.stake)))) {
      const dec = T.bonus
        ? 1 + (T.payout > 0 ? T.payout : T.toWin) / T.stake
        : (T.toWin > 0 ? 1 + T.toWin / T.stake : T.payout / T.stake);
      derived = toAmerican(Math.round(dec * 10000) / 10000);
    }
    if (!T.bonus) {
      if (T.payout === null && T.toWin !== null && T.stake !== null) T.payout = r2(T.toWin + T.stake);
      if (T.toWin === null && T.payout !== null && T.stake !== null) T.toWin = r2(T.payout - T.stake);
    } else if (T.stake > 0) {
      if (T.payout > 0 && !(T.toWin > 0)) T.toWin = T.payout;
      else if (T.toWin > 0 && !(T.payout > 0)) T.payout = T.toWin;
    }
    if (!T.parlay) {
      const l = T.legs[0], legHad = !!(l && isNum(l.odds));
      T.odds = legHad ? l.odds : ticketOdds !== null ? ticketOdds : derived;
      if (l && !legHad && isNum(T.odds)) l.odds = T.odds;
      if (!legHad && ticketOdds === null && derived !== null) T.oddsEstimated = true;
    } else {
      const legOdds = T.legs.map(l => l.odds);
      const prod = legOdds.every(isNum) && legOdds.length ? toAmerican(legOdds.reduce((d, o) => d * toDecimal(o), 1)) : null;
      T.odds = ticketOdds !== null ? ticketOdds : derived !== null ? derived : prod;
      if (ticketOdds === null && derived !== null && T.odds === derived) T.oddsEstimated = true;
      T.oddsManual = T.odds !== null && (prod === null || Math.abs(toDecimal(T.odds) / toDecimal(prod) - 1) > 0.02);
      if (T.sgp && T.oddsManual) warnings.push("Same-game parlay: the ticket's odds are used (books price correlated legs differently from multiplying them).");
    }
    const dec = isNum(T.odds) ? toDecimal(T.odds) : null;
    if (T.bonus && dec && dec > 1) {
      if (!(T.stake > 0) && (T.payout > 0 || T.toWin > 0)) {
        const profit = T.payout > 0 ? T.payout : T.toWin;
        T.stake = r2(profit / (dec - 1));
        T.stakeEstimated = T.stake > 0;
        if (!(T.toWin > 0)) T.toWin = profit;
        if (!(T.payout > 0)) T.payout = profit;
      } else if (T.stake > 0 && !(T.payout > 0) && !(T.toWin > 0)) {
        const profit = r2(T.stake * (dec - 1));
        T.payout = profit; T.toWin = profit; T.payoutEstimated = true;
      }
    } else if (!T.bonus && dec && dec > 1) {
      if (!(T.stake > 0) && T.payout > 0 && !(T.toWin > 0)) {
        T.stake = r2(T.payout / dec);
        T.stakeEstimated = T.stake > 0;
        if (T.stake > 0) T.toWin = r2(T.payout - T.stake);
      } else if (!(T.stake > 0) && T.toWin > 0 && !(T.payout > 0)) {
        T.stake = r2(T.toWin / (dec - 1));
        T.stakeEstimated = T.stake > 0;
        if (T.stake > 0) { T.payout = r2(T.stake + T.toWin); T.payoutEstimated = true; }
      } else if (!(T.stake > 0) && T.payout > 0 && T.toWin > 0) {
        T.stake = r2(T.payout / dec);
        T.stakeEstimated = T.stake > 0;
      } else if (T.stake > 0 && T.payout == null && T.toWin == null && !T.status) {
        T.toWin = r2(T.stake * (dec - 1));
        T.payout = r2(T.stake + T.toWin);
        T.payoutEstimated = true;
      }
    }
    if (T.oddsEstimated) warnings.push("Odds weren't on the slip; worked out from the stake and payout, estimated, check this.");
    if (T.stakeEstimated) warnings.push("Amount worked out from the odds and payout, estimated, check this.");
    if (T.payoutEstimated) warnings.push("Payout worked out from the stake and odds, estimated, check this.");
    if (T.bonus) warnings.push("Cash at risk is $0. A win adds the payout as profit. A loss is $0.");
    if (T.credit) warnings.push("Paid with sportsbook site credit: the tracker counts the stake as money risked. Edit the stake if you'd rather log it as $0.");
    if (T.boost) warnings.push("Boosted odds: saved at the odds on your ticket.");
    if (T.stake == null && !T.bonus) warnings.push("Couldn't read the stake. No stake found on the slip. Enter it below.");
    if (T.stake == null && T.bonus) warnings.push("Couldn't read the token amount. Enter it below.");
    if (!isNum(T.odds)) warnings.push("Couldn't read the odds. No odds found on the slip. Enter them below.");
    if (T.payout == null && T.toWin == null && !T.status) warnings.push("Couldn't read the payout. Type it in if you want it saved.");
    if (!T.legs.length) warnings.push("Couldn't read any selections. Type the bet below.");
    if (T.legs.some(l => l.period)) warnings.push("Half / quarter / period bets can't be graded from the final score; they're saved for you to settle.");
    T.warnings = warnings;
    applyBonusMoney(T);
    return T;
  }
  /** Same player prop read twice (overlapping OCR tiles). */
  function sameProp(a, b) {
    if (!a || !b || !a.player || !b.player) return false;
    if (normName(a.player) !== normName(b.player)) return false;
    if ((a.ou || "") !== (b.ou || "")) return false;
    if (isNum(a.line) && isNum(b.line) && Math.abs(Number(a.line) - Number(b.line)) > 0.011) return false;
    if (a.pmk && b.pmk && a.pmk !== b.pmk) return false;
    return true;
  }
  /** Drop group-header echoes and repeated props. An "8-Bet" line is the leg count, not a reason to delete a different player. */
  function collapseLegs(T) {
    const kept = [];
    for (const l of T.legs || []) {
      const prev = kept.find(x => sameProp(x, l));
      if (prev) {
        const oddsOnLine = isNum(l.odds) && new RegExp("(?<![\\d])" + Math.abs(Number(l.odds)) + "(?![\\d])").test(String(l.text || ""));
        if (!isNum(prev.odds) && oddsOnLine) prev.odds = l.odds;
        if (!prev.event && l.event) prev.event = l.event;
        if (!prev.when && l.when) prev.when = l.when;
        if (!prev.pmk && l.pmk) prev.pmk = l.pmk;
        if (!isNum(prev.line) && isNum(l.line)) prev.line = l.line;
        if (!prev.ou && l.ou) prev.ou = l.ou;
        if (!isNum(prev.statValue) && isNum(l.statValue)) {
          prev.statValue = l.statValue;
          prev.result = gradeStat(prev.ou, prev.line, l.statValue) || prev.result;
        }
        continue;
      }
      kept.push(l);
    }
    T.legs = kept.filter(l => {
      const raw = String(l.text || "").replace(/^(?:sgp\s*max|sgpx|sgp)\b[:\s-]*/i, "").trim();
      if (gameLine(raw) && !(l.player && l.ou && isNum(l.line))) return false;
      return true;
    });
    T.legs = T.legs.filter(l => {
      if (l.kind !== "total" || l.player) return true;
      return !T.legs.some(n => n !== l && n.kind === "prop" && n.player && n.ou === l.ou && isNum(n.line) && isNum(l.line) && Math.abs(Number(n.line) - Number(l.line)) < 0.011);
    });
    const want = T.header && T.header.n;
    const props = T.legs.filter(l => l.kind === "prop" && l.player && l.ou && isNum(l.line));
    if (want && props.length >= want) {
      T.legs = T.legs.filter(l => {
        if (l.kind === "prop" && l.player) return true;
        if ((l.kind === "ml" || l.kind === "name") && !isNum(l.line)) return false;
        if (l.kind === "total" && !l.player) return false;
        return true;
      });
    }
  }
  /** A token's printed payout is profit. A stake read off the slip stays; a missing one is payout / (decimal − 1). */
  function applyBonusMoney(T) {
    if (!T || !T.bonus) return T;
    const d = isNum(T.odds) ? toDecimal(T.odds) : null;
    const profit = T.payout > 0 ? Number(T.payout) : (T.toWin > 0 ? Number(T.toWin) : null);
    if (T.stakeFromSlip && T.stake > 0) {
      T.stakeEstimated = false;
      if (profit > 0) { T.payout = r2(profit); T.toWin = r2(profit); }
    } else if (profit > 0 && d && d > 1) {
      const next = r2(profit / (d - 1));
      if (!(T.stake > 0) || T.stakeEstimated || Math.abs(Number(T.stake) - next) > 0.02) {
        T.stake = next;
        T.stakeEstimated = true;
      }
      T.payout = r2(profit);
      T.toWin = r2(profit);
    }
    T.warnings = (T.warnings || []).filter(w => !/No stake found/.test(w) && !/Enter the token amount/.test(w));
    if (T.stakeEstimated) {
      if (!(T.warnings || []).some(w => /Amount worked out/.test(w))) T.warnings.push("Amount worked out from the odds and payout, estimated, check this.");
    } else T.warnings = (T.warnings || []).filter(w => !/Amount worked out from the odds and payout/.test(w));
    if (!(T.warnings || []).some(w => /Cash at risk is \$0/.test(w))) T.warnings.push("Cash at risk is $0. A win adds the payout as profit. A loss is $0.");
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
    if (t.loc && s === t.loc) return t.locOk ? 82 : 66;
    if (t.short && t.short.length >= 4 && w.includes(` ${t.short} `) && s.split(" ").length <= 4) return 74;
    if (t.locOk && w.includes(` ${t.loc} `) && s.split(" ").length <= 4) return 70;
    const nick = NICK[s];
    if (nick && (t.short === nick || t.name === nick || t.name.endsWith(" " + nick) || t.loc === nick)) return 86;
    if (ABBR_ALT[s] && ABBR_ALT[s] === t.abbr) return 84;
    const lastWord = t.name.split(" ").pop();
    const fz = Math.max(fuzzyWord(s, t.short), fuzzyWord(s, lastWord), t.locOk ? fuzzyWord(s, t.loc) : 0);
    if (fz) return fz;
    return 0;
  }
  /** One- and two-letter OCR slips on a nickname or city. Abbreviations stay exact (PHI vs PHX). */
  function editDist(a, b) {
    if (a === b) return 0;
    if (!a || !b || Math.abs(a.length - b.length) > 2) return 9;
    const dp = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) dp[j] = j;
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0]; dp[0] = i;
      for (let j = 1; j <= b.length; j++) { const tmp = dp[j]; dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]); prev = tmp; }
    }
    return dp[b.length];
  }
  function fuzzyWord(text, target) {
    if (!text || !target || target.length < 5 || Math.abs(text.length - target.length) > 2) return 0;
    if (text === target) return 100;
    const d = editDist(text, target);
    if (d === 1) return 78;
    if (d === 2 && target.length >= 6 && text.slice(0, 3) === target.slice(0, 3)) return 70;
    return 0;
  }
  // spoken names that aren't the ESPN short name. Matched only against that team's own name.
  const NICK = { niners: "49ers", philly: "eagles", pats: "patriots", bucs: "buccaneers", fins: "dolphins", vikes: "vikings", jags: "jaguars", bolts: "chargers", cards: "cardinals", hawks: "seahawks", sixers: "76ers", dubs: "warriors", cavs: "cavaliers", mavs: "mavericks", wolves: "timberwolves", blazers: "trail blazers", pels: "pelicans", grizz: "grizzlies", clips: "clippers", celts: "celtics", nugs: "nuggets" };
  const ABBR_ALT = { gsw: "gs", nop: "no", nyk: "ny", sas: "sa", was: "wsh", jax: "jac", kan: "kc", tam: "tb", lar: "la" };
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
    if (!hits.length && last.length >= 5) {
      const fuzz = idx.players.filter(p => {
        if (lg && p.lg !== lg) return false;
        const pp = p.nn.split(" "), pl = pp[pp.length - 1], pf = pp[0];
        if (!pl || editDist(last, pl) > 1) return false;
        return first === pf || (first.length === 1 && pf && pf[0] === first) || (first.length >= 4 && editDist(first, pf) <= 1);
      });
      if (fuzz.length && fuzz.length <= 3) hits = fuzz;
    }
    return hits;
  }

  /** link each leg to a LineSmart game/side/player. Adds leg.m = { lg, game, side, how, pid, player } and ticket warnings. */
  function matchTicket(T, idx, opts = {}) {
    const now = opts.now || Date.now();
    const placedMs = T.placed && T.placed.date ? etMs(T.placed.date, T.placed.time) : null;
    for (const l of T.legs) {
      l.m = { lg: null, game: null, side: null, how: "", pid: null, player: null, score: 0 };
      if (!l.league && T.gameHint && T.gameHint.lg) l.league = T.gameHint.lg;
      if (!idx) continue;
      const hintLg = l.league || (l.market && l.market.lg) || null;
      const refMs = l.when && l.when.date ? etMs(l.when.date, l.when.time) : placedMs || now;
      const explicit = !!(l.when && l.when.date) || !!placedMs;
      const todayEt = etDay(now), prevEt = shiftDay(todayEt, -1), refDay = etDay(refMs);
      const rank = (cands) => {
        // best score first; ties go to the game nearest the bet (games that ended before it was placed rank last)
        return cands.map(c => {
          let d = Math.abs(c.gi.t - refMs) / 36e5;
          const gameDay = etDay(c.gi.t || refMs);
          const inWindow = Math.abs(dayDiff(gameDay, refDay)) <= 5 || (!explicit && (gameDay === prevEt || gameDay === todayEt));
          if (!inWindow) d += 8000;
          const hint = T.gameHint;
          if (hint && hint.abbrs && hint.abbrs.length) {
            const ids = [String(c.gi.g.home.id), String(c.gi.g.away.id)];
            const sides = idx.teams.filter(t => t.lg === c.gi.lg && ids.includes(t.id));
            if (hint.abbrs.some(ab => sides.some(t => teamScore(ab, t) >= 70))) d -= 36;
          }
          if (placedMs && c.gi.t < placedMs - 6 * 36e5) d += 5000;
          if (!l.when && !placedMs && c.gi.g.state === "post" && now - c.gi.t > 36 * 36e5) d += 200;
          if (hintLg && c.gi.lg !== hintLg) d += 10000;
          if (l.slg && !hintLg && !(c.gi.lg === l.slg || (l.slg === "nfl" && c.gi.lg === "ncaaf") || (l.slg === "nba" && c.gi.lg === "ncaab"))) d += 10000;
          return { ...c, d, inWindow };
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
          if (sc >= 45) cands.push({ gi, sc: sc >= 70 ? sc + 10 : sc });
        }
      }
      const teamText = l.draw ? null : l.team || (l.kind === "ml" ? l.text : null);
      if (!cands.length && teamText) {
        for (const gi of idx.games) {
          const { g, lg } = gi;
          for (const side of ["home", "away"]) { const t = idx.teams.find(x => x.lg === lg && x.id === String(g[side].id)); const sc = t ? teamScore(teamText, t) : 0; if (sc >= 45) cands.push({ gi, sc }); }
        }
      }
      // Game total / spread / moneyline with no team text: Hard Rock's score bar names both sides ("TNS 64 Final Score 94 MUR").
      // Player props keep their own game — a footer hint must not pull them onto the card's last game.
      const hint = T.gameHint;
      if (!cands.length && !l.player && hint && hint.abbrs && hint.abbrs.length === 2) {
        const abSc = (ab, t) => {
          const a = norm(ab);
          if (!t || !a) return 0;
          if (a === t.abbr) return 84;
          if (a.length >= 3 && t.abbr && (t.abbr.startsWith(a) || a.startsWith(t.abbr)) && Math.abs(a.length - t.abbr.length) <= 1) return 72;
          return teamScore(ab, t) >= 70 ? 70 : 0;
        };
        const scoreNum = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
        for (const gi of idx.games) {
          const { g, lg } = gi;
          const tA = idx.teams.find(t => t.lg === lg && t.id === String(g.away.id));
          const tH = idx.teams.find(t => t.lg === lg && t.id === String(g.home.id));
          if (!tA || !tH) continue;
          const [x, y] = hint.abbrs, [sx, sy] = hint.scores || [];
          const o1 = Math.min(abSc(x, tA), abSc(y, tH)), o2 = Math.min(abSc(x, tH), abSc(y, tA));
          let sc = Math.max(o1, o2);
          const bestX = Math.max(abSc(x, tA), abSc(x, tH)), bestY = Math.max(abSc(y, tA), abSc(y, tH));
          const one = Math.max(bestX, bestY);
          const ax = scoreNum(g.away.score), hx = scoreNum(g.home.score);
          const haveScores = isNum(sx) && isNum(sy) && ax !== null && hx !== null;
          const scoresFit = haveScores && (o1 >= o2 ? [ax, hx] : [hx, ax]).join() === [+sx, +sy].join();
          // One exact code plus the printed score can rescue a 1–2 letter OCR scrap. A different 3-letter code (TEN vs TNST) does not.
          const otherLen = bestX >= bestY ? norm(y).length : norm(x).length;
          if (!sc && one >= 84 && scoresFit && otherLen < 3) sc = 70;
          if (sc && scoresFit) sc += 10;
          if (sc >= 70) cands.push({ gi, sc, fromHint: true, scoresFit: haveScores ? !!scoresFit : null });
        }
      }
      // player props: the player's team (rosters) or the props feed tells us the game
      let ph = [];
      if (l.player) {
        ph = playerHits(idx, l.player);
        if (l.slg) { const f = ph.filter(p => p.lg === l.slg); if (f.length) ph = f; }
        if (!cands.length) for (const p of ph) for (const gi of idx.games) if (gi.lg === p.lg && (String(gi.g.home.id) === p.tid || String(gi.g.away.id) === p.tid || (idx.props[p.lg] && idx.props[p.lg].games && (idx.props[p.lg].games[gi.g.id] || {}).props && idx.props[p.lg].games[gi.g.id].props.some(r => String(r[0]) === p.pid)))) cands.push({ gi, sc: 80 });
        if (ph.length && cands.length) {
          const tids = new Set(ph.map(p => p.tid).filter(Boolean));
          const fits = cands.filter(c => tids.has(String(c.gi.g.home.id)) || tids.has(String(c.gi.g.away.id)));
          if (!fits.length && tids.size) {
            cands = [];
            for (const p of ph) for (const gi of idx.games) if (gi.lg === p.lg && (String(gi.g.home.id) === p.tid || String(gi.g.away.id) === p.tid)) cands.push({ gi, sc: 84 });
          }
        }
      }
      if (!cands.length) continue;
      const r = rank(cands), best = r[0];
      const seenG = new Set();
      l.m.choices = [];
      for (const c of r) {
        const id = String(c.gi.g.id);
        if (seenG.has(id) || c.sc < 45) continue;
        seenG.add(id);
        const gg = c.gi.g, day = String(gg.date || "").slice(0, 10);
        l.m.choices.push({ id, lg: c.gi.lg, score: c.sc, date: gg.date || "", name: `${day.slice(5)} ${gg.away.abbr} @ ${gg.home.abbr}`.trim(),
          away: { id: gg.away.id, abbr: gg.away.abbr, name: gg.away.name, short: gg.away.short },
          home: { id: gg.home.id, abbr: gg.home.abbr, name: gg.home.name, short: gg.home.short } });
        if (l.m.choices.length >= 3) break;
      }
      if (best.sc < 50) { l.m.unsure = true; continue; }
      const amb = r.find(c => c.gi !== best.gi && c.sc === best.sc && Math.abs(c.d - best.d) < 1 && c.gi.g.id !== best.gi.g.id);
      const rival = r.find(c => String(c.gi.g.id) !== String(best.gi.g.id) && c.sc >= 70 && c.sc >= best.sc - 4 && c.d < best.d + 18);
      const g = best.gi.g, lg = best.gi.lg;
      Object.assign(l.m, { lg, game: g, score: best.sc, how: best.fromHint ? "hint" : ev ? "event" : teamText ? "team" : "player", ambiguous: !!amb });
      if (!best.inWindow) l.m.far = true;
      // A score bar is matched only when the printed score agrees. Otherwise keep the game and ask the user to check it.
      l.m.unsure = best.sc < 80 || !!rival || !!amb || !!l.m.far || (best.fromHint && best.scoresFit === false);
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
    if (T.legs.length && T.legs.every(l => !l.m || !l.m.game)) {
      const names = T.legs.map(l => l.player || l.team || l.text).filter(Boolean);
      if (names.length) {
        T.warnings = T.warnings || [];
        T.warnings.push("Legs read from the slip: " + names.join("; ") + ".");
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
    const notes = [T.ref ? `Bet ID ${T.ref}` : "", T.boost ? "Boosted odds" : "", T.bonus ? "Cash at risk $0" : "", T.credit ? "Site credit" : "", T.sgp ? "Same-game parlay" : "", T.teaser ? "Teaser" : ""].filter(Boolean).join(" · ");
    const odds = isNum(T.odds) ? T.odds : "";
    const F = {
      book: T.book || opts.defaultBook || "other", bookOther: T.book === "other" ? T.bookName || "" : "", bookFromSlip: !!T.book,
      type, date: (T.placed && T.placed.date) || opts.today || new Date().toISOString().slice(0, 10), stake: isNum(T.stake) ? T.stake : "",
      odds: parlay ? (T.oddsManual ? odds : "") : odds, oddsManual: !!(parlay && T.oddsManual), notes,
      status: T.status && T.status !== "pending" ? T.status : "", cashout: isNum(T.cashout) ? T.cashout : "",
      paid: T.status === "won" && isNum(T.payout) ? T.payout : "",
      ref: T.ref || "", bonus: !!T.bonus, stakeEstimated: !!T.stakeEstimated, payoutEstimated: !!T.payoutEstimated, oddsEstimated: !!T.oddsEstimated,
      legs: legs.length ? legs : [legDraft({ kind: "other", text: "", m: {} }, opts)],
    };
    if (!parlay && F.legs[0] && !isNum(F.legs[0].odds) && isNum(odds)) F.legs[0].odds = odds;
    return F;
  }
  function legDraft(l, opts) {
    const m = l.m || {};
    const base = { league: m.lg || l.league || (l.market && l.market.lg) || l.slg || opts.defaultLeague || "nfl", eventId: "", event: null, manual: false, eventText: "", mk: "ml", side: "", line: "", odds: isNum(l.odds) ? l.odds : "", selection: "", pid: "", player: "", pmk: "", custom: false, result: l.result || "", statValue: isNum(l.statValue) ? l.statValue : "" };
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
      const mk = ["ml", "spread", "total", "prop"].includes(l.kind) ? l.kind : "prop";
      Object.assign(base, { mk, selection: l.text || "" });
      if (mk === "total" || mk === "spread") {
        if (l.ou) base.side = l.ou;
        if (isNum(l.line)) base.line = l.line;
      }
      info.status = "manual";
      info.why = l.kind === "prop" && l.player ? "Couldn't find this game in LineSmart's data. Pick it below so the prop can settle automatically." : "Couldn't match this to a game in LineSmart's data. Pick the game below, or keep it as typed and settle it yourself.";
    }
    if (m.ambiguous) info.why = "More than one game fits; check the game below.";
    else if (m.far && !info.why) info.why = "The closest matching game isn't near the slip's date; check the game below.";
    if (m.unsure && info.status === "matched") { info.status = "check"; if (!info.why) info.why = "Check this game. Other close games are listed below."; }
    if (!g && m.choices && m.choices.length) { info.status = "check"; info.why = "No exact game. These are the closest. Pick one."; }
    if (m.choices && m.choices.length && info.status !== "matched" && info.status !== "settle") info.choices = m.choices.slice(0, 3);
    base.review = info;
    return base;
  }
  /** slips already imported (same sportsbook reference) */
  const dupOf = (bets, ref) => (ref ? (bets || []).find(b => b.slipRef && String(b.slipRef) === String(ref)) || null : null);
  function legParts(l, fromBet) {
    if (!l) return null;
    const lineKind = fromBet ? (l.type || "") : (l.kind || "");
    if ((lineKind === "total" || lineKind === "spread" || lineKind === "ml") && (fromBet || !l.player)) {
      const ev = fromBet ? (l.event && l.event.id ? String(l.event.id) : "") : (l.m && l.m.game ? String(l.m.game.id) : "");
      const side = fromBet ? (l.side || "") : (lineKind === "total" ? (l.ou || "") : ((l.m && l.m.side) || ""));
      const line = lineKind === "ml" ? 0 : (isNum(l.line) ? Number(l.line) : null);
      if (!ev || !side || (lineKind !== "ml" && !isNum(line))) return null;
      return { kind: "line", ev, mk: lineKind, side, line };
    }
    const pr = fromBet ? (l.prop || {}) : null;
    const player = normName(fromBet ? pr.player || "" : l.player || "");
    const side = fromBet ? (pr.side || "") : (l.ou || "");
    const line = fromBet ? (isNum(pr.line) ? Number(pr.line) : null) : (isNum(l.line) ? Number(l.line) : null);
    const mk = fromBet ? (pr.mk || "") : (l.pmk || "");
    if (!player || (side !== "over" && side !== "under") || !isNum(line)) return null;
    return { p: player, side, line, mk };
  }
  function sameLegs(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) return false;
    const used = new Set();
    for (const x of a) {
      const i = b.findIndex((y, idx) => {
        if (used.has(idx)) return false;
        if (x.kind === "line" || y.kind === "line") return x.kind === "line" && y.kind === "line" && x.ev === y.ev && x.mk === y.mk && x.side === y.side && Math.abs(Number(x.line) - Number(y.line)) < 1e-6;
        return y.p === x.p && y.side === x.side && Math.abs(y.line - x.line) < 1e-6 && (!x.mk || !y.mk || x.mk === y.mk);
      });
      if (i < 0) return false;
      used.add(i);
    }
    return true;
  }
  /** Pending bets a settled slip should close. Bet ID (slipRef, or the ID written in notes) first;
   *  otherwise a pending Hard Rock bet with the same odds, stake and legs. */
  function matchOpenBets(bets, ticket) {
    const pending = (bets || []).filter(b => b && (!b.status || b.status === "pending"));
    const ref = ticket && ticket.ref ? String(ticket.ref) : "";
    if (ref) {
      const byRef = pending.filter(b => (b.slipRef && String(b.slipRef) === ref) || (b.notes && String(b.notes).includes(ref)));
      if (byRef.length) return byRef;
    }
    const want = ((ticket && ticket.legs) || []).map(l => legParts(l, false)).filter(Boolean);
    if (!want.length || !ticket || !isNum(ticket.stake) || !isNum(ticket.odds)) return [];
    return pending.filter(b => {
      if ((b.book || "") !== "hardrock") return false;
      if (Math.abs(Number(b.stake) - Number(ticket.stake)) > 0.001) return false;
      if (Number(b.odds) !== Number(ticket.odds)) return false;
      const have = (b.type === "parlay" ? b.legs || [] : [b]).map(l => legParts(l, true)).filter(Boolean);
      return sameLegs(want, have);
    });
  }

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

  function legGood(l) {
    return !!(l && l.player && String(l.player).replace(/[^A-Za-z]/g, "").length > 3 && l.ou && isNum(l.line));
  }
  function slipScore(t) {
    if (!t) return 0;
    let s = 0;
    if (t.book) s += 3;
    if (t.status && t.status !== "pending") s += 4;
    if (isNum(t.stake) && t.stake > 0) s += 4;
    if (isNum(t.odds)) s += 2;
    if (isNum(t.payout) && t.payout > 0) s += 4;
    const legs = t.legs || [];
    const good = legs.filter(legGood).length;
    s += good * 3;
    s -= Math.max(0, legs.length - good) * 2;
    const want = t.header && t.header.n;
    if (want && good) s += good === want ? 8 : -Math.abs(good - want) * 3;
    return s;
  }
  /** Fill gaps: one OCR pass may see the green header (stake, Paid, Winner) and another the dark legs. */
  function richer(a, b) {
    if (!a) return b ? JSON.parse(JSON.stringify(b)) : null;
    if (!b) return a;
    const base = slipScore(a) >= slipScore(b) ? a : b;
    const other = base === a ? b : a;
    const out = JSON.parse(JSON.stringify(base));
    for (const k of ["book", "bookName", "status", "stake", "odds", "payout", "toWin", "cashout", "ref"]) {
      if ((out[k] === null || out[k] === undefined || out[k] === "") && other[k] !== null && other[k] !== undefined && other[k] !== "") out[k] = other[k];
    }
    if (!out.gameHint && other.gameHint) out.gameHint = other.gameHint;
    else if (out.gameHint && other.gameHint && !out.gameHint.scores && other.gameHint.scores) out.gameHint = other.gameHint;
    const nGood = legs => (legs || []).filter(legGood).length;
    const moneyAgrees = (!isNum(out.stake) || !isNum(other.stake) || Math.abs(Number(out.stake) - Number(other.stake)) < 0.05)
      && (!isNum(out.odds) || !isNum(other.odds) || Number(out.odds) === Number(other.odds));
    if (moneyAgrees && nGood(other.legs) && nGood(out.legs)) {
      const merged = (out.legs || []).map(l => ({ ...l }));
      for (const l of other.legs || []) {
        const words = normName(l && l.player).split(" ").filter(w => w.length >= 2);
        if (!(l && legGood(l) && l.pmk && words.length >= 2)) continue;
        const prev = merged.find(x => sameProp(x, l) || (normName(x.player) === normName(l.player) && x.pmk === l.pmk));
        if (prev) {
          const oddsOnLine = isNum(l.odds) && new RegExp("(?<![\\d])" + Math.abs(Number(l.odds)) + "(?![\\d])").test(String(l.text || ""));
          if (!isNum(prev.odds) && oddsOnLine) prev.odds = l.odds;
          if (!prev.event && l.event) prev.event = l.event;
          if (!prev.when && l.when) prev.when = l.when;
          if (!isNum(prev.line) && isNum(l.line)) prev.line = l.line;
          if (!prev.ou && l.ou) prev.ou = l.ou;
          if (!isNum(prev.statValue) && isNum(l.statValue)) {
            prev.statValue = l.statValue;
            prev.result = gradeStat(prev.ou, prev.line, l.statValue) || prev.result;
          }
          continue;
        }
        merged.push({ ...l });
      }
      out.legs = merged;
    } else if (nGood(other.legs) > nGood(out.legs)) out.legs = other.legs.filter(legGood);
    else out.legs = (out.legs || []).map(l => {
      if (!legGood(l)) return l;
      const o = (other.legs || []).find(x => normName(x.player) === normName(l.player));
      if (!o) return l;
      const statValue = isNum(l.statValue) ? l.statValue : o.statValue;
      const result = gradeStat(l.ou, l.line, statValue) || l.result || o.result || null;
      return { ...l, statValue: isNum(statValue) ? statValue : null, result };
    });
    if (other.bonus) out.bonus = true;
    if (other.stakeFromSlip && !out.stakeFromSlip) { out.stake = other.stake; out.stakeFromSlip = true; out.stakeEstimated = false; }
    if ((out.legs || []).length > 1) out.parlay = true;
    if (out.status === "won") out.legs = (out.legs || []).map(l => (l.result ? l : { ...l, result: "won" }));
    if (isNum(out.payout) && isNum(out.stake) && !isNum(out.toWin)) out.toWin = out.bonus ? r2(out.payout) : r2(Number(out.payout) - Number(out.stake));
    applyBonusMoney(out);
    out.warnings = (out.warnings || []).filter(w => {
      if (/couldn't read the stake|no stake found|token amount/i.test(w) && out.stake > 0) return false;
      if (/couldn't read the payout/i.test(w) && (out.payout > 0 || out.toWin > 0)) return false;
      if (/couldn't read the odds|no odds found/i.test(w) && isNum(out.odds)) return false;
      if (/couldn't read any selections/i.test(w) && out.legs && out.legs.length) return false;
      return true;
    });
    return out;
  }
  /** Overlapping tiles repeat a long line. Short lines ("Over 0.5") stay, because each leg has its own. */
  function foldRepeatLines(text) {
    const seen = new Set();
    return String(text || "").split(/\n/).filter(line => {
      const k = line.replace(/\s+/g, " ").trim().toLowerCase();
      if (!k) return false;
      const keepOnce = k.length >= 22 || PARLAY_RX.test(line) || /\b(wager|payout|paid|stake|to pay)\b/i.test(line);
      if (!keepOnce) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).join("\n");
  }
  /** Several OCR readings of one photo (raw, inverted, header band, tiles). Returns the merged ticket. */
  function bestOcrTicket(texts) {
    let acc = null, hint = null;
    // A pass that is only the score bar has no stake or selection, so parseSlip drops it. Keep its hint anyway.
    for (const text of texts || []) for (const line of String(text || "").split(/\n/)) {
      for (const tok of classify(line.replace(/\s+/g, " ").trim(), null, Date.now())) {
        if (tok.k === "hint" && tok.scores && !hint) hint = { abbrs: tok.abbrs, scores: tok.scores, final: !!tok.final, when: tok.when || null };
      }
    }
    for (const text of texts || []) {
      const folded = foldRepeatLines(text);
      if (!folded.trim()) continue;
      for (const t of parseSlip(folded).tickets) acc = richer(acc, t);
    }
    if (acc && !acc.gameHint && hint) acc.gameHint = hint;
    return acc;
  }

  return { clean, detectBook, parseDate, classify, parseSel, findStat, parseSlip, buildIndex, teamScore, teamHits, playerHits, matchTicket, toDraft, evOf, dupOf, matchOpenBets, bestOcrTicket, ocrPrep, normName, norm };
});
