// Unit tests for bet-slip import (site/assets/slip-core.js): sample Hard Rock Bet / DraftKings / FanDuel / other slips -> parsed ticket ->
// matched to LineSmart games/players -> bet-form draft -> saved bet that BetCore can auto-settle. No browser, no network.
// Usage: node scripts/slip_test.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const S = require("../site/assets/slip-core.js");
const C = require("../site/assets/bets-core.js");
const fails = [];
const check = (ok, msg, tag = "slip") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };

// ---------- fixture: a slice of LineSmart data (same shapes as data/<lg>/index.json, data/search/<lg>.json, data/props/<lg>.json)
const tm = (id, abbr, name, short, extra = {}) => ({ id, abbr, name, short, ...extra });
const T = {
  DAL: tm("6", "DAL", "Dallas Cowboys", "Cowboys"), PHI: tm("21", "PHI", "Philadelphia Eagles", "Eagles"),
  CAR: tm("29", "CAR", "Carolina Panthers", "Panthers"), GB: tm("9", "GB", "Green Bay Packers", "Packers"),
  GS: tm("9", "GS", "Golden State Warriors", "Warriors"), LAL: tm("13", "LAL", "Los Angeles Lakers", "Lakers"), LAC: tm("12", "LAC", "LA Clippers", "Clippers"),
  NYR: tm("13", "NYR", "New York Rangers", "Rangers"), FLA: tm("26", "FLA", "Florida Panthers", "Panthers"),
  TEX: tm("13", "TEX", "Texas Rangers", "Rangers"), NYY: tm("10", "NYY", "New York Yankees", "Yankees"),
  ARS: tm("359", "ARS", "Arsenal", "Arsenal"), CHE: tm("363", "CHE", "Chelsea", "Chelsea"),
  CHO: tm("5282412", "CHOVANCEK", "Cody Chovancek", "C. Chovancek", { last: "Chovancek" }), YOU: tm("5044361", "YOU", "SuYoung You", "S. You", { last: "You" }),
};
const game = (id, date, away, home, state = "pre") => ({ id, date, state, away, home, name: `${away.name} at ${home.name}` });
const ctx = {
  games: {
    nfl: [game("401", "2026-10-26T20:25Z", T.DAL, T.PHI, "post"), game("402", "2026-10-30T00:15Z", T.CAR, T.GB)],
    nba: [game("501", "2026-10-28T02:00Z", T.GS, T.LAL), game("502", "2026-10-30T02:30Z", T.LAC, T.LAL)],
    nhl: [game("601", "2026-10-28T23:00Z", T.NYR, T.FLA)],
    mlb: [game("701", "2026-10-28T00:08Z", T.NYY, T.TEX)],
    epl: [game("801", "2026-11-01T15:00Z", T.CHE, T.ARS)],
    ufc: [game("901", "2026-10-31T22:00Z", T.CHO, T.YOU)],
  },
  search: {
    nfl: { teams: [["21", "Philadelphia Eagles", "PHI", "Eagles"], ["6", "Dallas Cowboys", "DAL", "Cowboys"]], players: [["4040715", "Jalen Hurts", 0, "QB", "1", 1], ["3929630", "Saquon Barkley", 0, "RB", "26", 1], ["4241389", "CeeDee Lamb", 1, "WR", "88", 1]] },
    nba: { teams: [["9", "Golden State Warriors", "GS", "Warriors"], ["13", "Los Angeles Lakers", "LAL", "Lakers"]], players: [["3975", "Stephen Curry", 0, "G", "30", 1], ["1966", "LeBron James", 1, "F", "23", 1], ["3945274", "Luka Doncic", 1, "G", "77", 1]] },
  },
  props: {
    nba: { lg: "nba", players: { "3975": { n: "Stephen Curry", t: "9", ta: "GS" } }, games: { "501": { props: [["3975", "points", 26.5, 26.5, [], {}]] } } },
    nfl: { lg: "nfl", players: { "3929630": { n: "Saquon Barkley", t: "21", ta: "PHI" } }, games: { "401": { props: [["3929630", "rush_yds", 89.5, 89.5, [], {}]] } } },
  },
};
const IDX = S.buildIndex(ctx);
const NOW = Date.parse("2026-10-26T15:00:00Z");
const run = (text, opts = {}) => {
  const r = S.parseSlip(text, IDX, { now: NOW });
  for (const t of r.tickets) S.matchTicket(t, IDX, { now: NOW });
  return r.tickets;
};
// mirror of bets.js submit(): draft -> bet (so we can assert the saved bet will auto-settle)
const PROP_LG = new Set(["nfl", "nba"]);
function toBet(F) {
  const parlay = F.type === "parlay", legs = [];
  for (const l of F.legs) {
    const mk = parlay ? l.mk : F.type, leg = { league: l.league, type: mk, odds: C.isNum(l.odds) ? Number(l.odds) : null };
    const linked = !l.manual && l.event;
    if (linked) leg.event = l.event; else if (l.eventText) leg.eventText = l.eventText;
    if (linked && mk === "prop" && PROP_LG.has(l.league) && l.pmk !== "other") leg.prop = { mk: l.pmk, pid: l.pid || undefined, player: l.player, line: Number(l.line), side: l.side };
    else if (linked && mk !== "prop") { leg.side = l.side; if (mk !== "ml") leg.line = Number(l.line); }
    else leg.selection = l.selection;
    legs.push(leg);
  }
  const odds = parlay && !F.oddsManual ? C.parlayAmerican(legs) : Number(F.odds);
  return C.normalizeBet(parlay ? { id: "x", book: F.book, type: "parlay", odds, stake: Number(F.stake), status: "pending", legs, oddsManual: F.oddsManual } : { id: "x", book: F.book, stake: Number(F.stake), status: "pending", ...legs[0], type: F.type, odds });
}
const draft = t => S.toDraft(t, { defaultBook: "hardrock", today: "2026-10-26" });

// ---------- 1. Hard Rock Bet single (spread), multi-line confirmation
{
  const [t, ...rest] = run(`Bet Placed
Single
Philadelphia Eagles -3.5
-110
Point Spread
Dallas Cowboys @ Philadelphia Eagles
Sun, Oct 26 4:25 PM ET
Stake
$10.00
Potential Return
$19.09
Bet Ref: HRB2610264471
Placed: 10/25/2026 9:14 PM
Hard Rock Bet`);
  check(t && !rest.length, "HRB single: one ticket", "hardrock");
  check(t.book === "hardrock", "HRB single: book detected", "hardrock");
  check(t.stake === 10 && t.odds === -110 && t.payout === 19.09, `HRB single: stake $10, odds -110, return $19.09 (got ${t.stake}, ${t.odds}, ${t.payout})`, "hardrock");
  check(t.ref === "HRB2610264471" && t.placed.date === "2026-10-25", "HRB single: bet ref + placed date", "hardrock");
  const l = t.legs[0];
  check(t.legs.length === 1 && l.kind === "spread" && l.line === -3.5, "HRB single: spread -3.5", "hardrock");
  check(l.m.game && l.m.game.id === "401" && l.m.side === "home", "HRB single: matched DAL @ PHI, side home", "hardrock");
  const F = draft(t);
  check(F.type === "spread" && F.legs[0].eventId === "401" && F.legs[0].side === "home" && F.legs[0].line === -3.5 && F.book === "hardrock" && F.date === "2026-10-25", "HRB single: form draft prefilled", "hardrock");
  check(F.notes.includes("HRB2610264471") && F.ref === "HRB2610264471", "HRB single: bet ref kept in notes", "hardrock");
  const b = toBet(F);
  check(C.canAutoSettle(b), "HRB single: saved bet auto-settles", "hardrock");
  check(C.gradeSelection({ type: "spread", side: "home", line: -3.5, league: "nfl" }, { home: 27, away: 20, completed: true }) === "won", "HRB single: grades like a hand-entered bet", "hardrock");
}

// ---------- 2. Hard Rock Bet 3-leg parlay (ML + game total + player prop), market labels under each selection
{
  const [t] = run(`HARD ROCK BET
3 Leg Parlay +596
Philadelphia Eagles
Moneyline
Dallas Cowboys @ Philadelphia Eagles
-110
Over 220.5
Total Points
Golden State Warriors @ Los Angeles Lakers
-110
Stephen Curry Over 26.5 Points
Player Points
Golden State Warriors @ Los Angeles Lakers
-110
Stake $5.00
Potential Return $34.80`);
  check(t.parlay && t.legs.length === 3 && t.odds === 596 && t.stake === 5, `HRB parlay: 3 legs, +596, $5 (got ${t.legs.length}, ${t.odds})`, "hardrock");
  const [a, b, c] = t.legs;
  check(a.kind === "ml" && a.m.game.id === "401" && a.m.side === "home" && a.odds === -110, "HRB parlay leg 1: Eagles ML", "hardrock");
  check(b.kind === "total" && b.ou === "over" && b.line === 220.5 && b.m.game.id === "501" && b.m.side === "over", "HRB parlay leg 2: GS @ LAL over 220.5", "hardrock");
  check(c.kind === "prop" && c.pmk === "points" && c.player === "Stephen Curry" && c.line === 26.5 && c.m.game.id === "501" && c.m.pid === "3975", "HRB parlay leg 3: Curry over 26.5 points, feed player id", "hardrock");
  const F = draft(t);
  check(F.type === "parlay" && !F.oddsManual && F.legs.every(l => l.review.status === "matched"), "HRB parlay: draft, all legs matched, leg odds multiply to ticket odds", "hardrock");
  const bet = toBet(F);
  check(bet.legs.every(l => C.canAutoSettle({ ...l })), "HRB parlay: every saved leg auto-settles", "hardrock");
}

// ---------- 2b. event-first layout, parlay header after the legs
{
  const ts = run(`Dallas Cowboys @ Philadelphia Eagles
Point Spread
Philadelphia Eagles -3.5
-110
Golden State Warriors @ Los Angeles Lakers
Total Points
Under 220.5
-105
Parlay (2 legs) +255
Stake: $20.00
To Win: $71.00`);
  const t = ts[0];
  check(ts.length === 1 && t.legs.length === 2 && t.parlay && t.odds === 255, `event-first parlay: 1 ticket, 2 legs (got ${ts.length}, ${t && t.legs.length})`, "layout");
  check(t.legs[0].m.game.id === "401" && t.legs[0].m.side === "home" && t.legs[1].m.game.id === "501" && t.legs[1].ou === "under" && t.legs[1].odds === -105, "event-first parlay: each leg gets its own game", "layout");
}

// ---------- 3. DraftKings single moneyline ("CAR Panthers @ GB Packers", "To Pay")
{
  const [t] = run(`DraftKings Sportsbook
Green Bay Packers
-150
Moneyline
CAR Panthers @ GB Packers
Wager: $15.00
To Pay: $25.00
Bet ID: DK638123456789012345`);
  check(t.book === "draftkings" && t.stake === 15 && t.payout === 25 && t.odds === -150, "DK single: book, stake, payout, odds", "draftkings");
  check(t.legs[0].kind === "ml" && t.legs[0].m.game.id === "402" && t.legs[0].m.side === "home", "DK single: Packers ML matched home", "draftkings");
  check(C.canAutoSettle(toBet(draft(t))), "DK single: auto-settles", "draftkings");
}

// ---------- 4. DraftKings SGP: ticket odds on their own line, legs without prices
{
  const [t] = run(`SGP
+450
Jalen Hurts Anytime TD Scorer
Saquon Barkley 100+ Rushing Yards
Over 47.5
DAL Cowboys @ PHI Eagles
Wager $10.00
To Pay $55.00`);
  check(t.parlay && t.sgp && t.odds === 450 && t.legs.length === 3, `DK SGP: 3 legs at +450 (got ${t.legs.length} @ ${t.odds})`, "draftkings");
  const [a, b, c] = t.legs;
  check(a.pmk === "anytime_td" && a.player === "Jalen Hurts" && a.m.game && a.m.game.id === "401", "DK SGP: Hurts anytime TD -> DAL @ PHI", "draftkings");
  check(b.pmk === "rush_yds" && b.ou === "over" && b.line === 99.5 && b.m.game.id === "401", "DK SGP: 100+ rushing yards = over 99.5", "draftkings");
  check(c.kind === "total" && c.line === 47.5 && c.m.game.id === "401", "DK SGP: over 47.5 game total", "draftkings");
  const F = draft(t);
  check(F.oddsManual && F.odds === 450, "DK SGP: uses ticket odds (oddsManual)", "draftkings");
  check(F.legs[0].custom && F.legs[0].player === "Jalen Hurts" && F.legs[1].pid === "3929630", "DK SGP: prop not in feed -> typed player; feed player gets picker id", "draftkings");
  const bet = toBet(F);
  check(bet.legs.every(l => C.canAutoSettle(l)) && bet.odds === 450, "DK SGP: legs auto-settle, ticket odds kept", "draftkings");
}

// ---------- 5. FanDuel single prop (stat on one line, over/under on the next) with FanDuel bet ID
{
  const [t] = run(`Saquon Barkley - Rushing Yards
Over 89.5
-115
Dallas Cowboys @ Philadelphia Eagles
WAGER $20.00
TO WIN $17.39
BET ID: O/0123456/0001234
PLACED: 10/26/2026 11:02AM ET`);
  check(t.book === "fanduel", "FD single: FanDuel detected from bet ID format", "fanduel");
  const l = t.legs[0];
  check(t.legs.length === 1 && l.kind === "prop" && l.pmk === "rush_yds" && l.ou === "over" && l.line === 89.5 && l.odds === -115, "FD single: Barkley over 89.5 rush yds -115", "fanduel");
  check(l.m.game.id === "401" && l.m.pid === "3929630", "FD single: matched game + feed player", "fanduel");
  check(t.toWin === 17.39 && t.payout === 37.39 && t.placed.date === "2026-10-26", "FD single: to win, payout, placed date", "fanduel");
  check(C.canAutoSettle(toBet(draft(t))), "FD single: auto-settles", "fanduel");
}

// ---------- 5b. last name only -> unique player on the two teams in that game
{
  const [t] = run(`Barkley Over 89.5 Rushing Yards -115
DAL @ PHI
Stake $10`);
  check(t.legs[0].m.player === "Saquon Barkley" && t.legs[0].m.pid === "3929630", "last name only: Barkley -> Saquon Barkley (feed id)", "match");
}

// ---------- 5c. screenshot OCR layout: name + price on one row, over/under and stat on the next rows
{
  const [t] = run(`HARD ROCK BET
Bet Placed
Single
Saquon Barkley -115
Over 89.5
Rushing Yards
Dallas Cowboys @ Philadelphia Eagles
Stake $20.00
Potential Return $37.39
Bet Ref: HRB2610275519`);
  const l = t.legs[0];
  check(t.legs.length === 1 && l.kind === "prop" && l.pmk === "rush_yds" && l.line === 89.5 && l.odds === -115 && l.m.pid === "3929630", `OCR layout: one Barkley rush-yds leg (got ${t.legs.length} legs, ${l.kind}/${l.pmk})`, "ocr");
  check(t.lines.length === 10 && t.lines[0] === "HARD ROCK BET", "ticket keeps the slip's lines for the review screen", "ocr");
}

// ---------- 6. FanDuel parlay, one line per leg, amount-first summary
{
  const [t] = run(`FanDuel
3 leg parlay +600
Eagles -3.5 (-110) | DAL @ PHI
Packers ML (-150) | CAR @ GB
Lakers +4.5 (-110) | GS @ LAL
$10.00 wager · $60.00 to win`);
  check(t.legs.length === 3 && t.odds === 600 && t.stake === 10 && t.toWin === 60, `FD one-line parlay: 3 legs +600 $10 (got ${t.legs.length}, ${t.odds}, ${t.stake}, ${t.toWin})`, "fanduel");
  const [a, b, c] = t.legs;
  check(a.kind === "spread" && a.m.side === "home" && b.kind === "ml" && b.m.side === "home" && c.kind === "spread" && c.line === 4.5 && c.m.side === "home", "FD one-line parlay: sides + lines", "fanduel");
  check(c.odds === -110 && a.m.game.id === "401" && b.m.game.id === "402" && c.m.game.id === "501", "FD one-line parlay: games", "fanduel");
}

// ---------- 7. other book: soccer draw, Risk / To Win
{
  const [t] = run(`BetMGM
Arsenal vs Chelsea
Draw
+260
3-Way Moneyline
Risk $10 To Win $26`);
  check(t.book === "other" && t.bookName === "BetMGM", "BetMGM: other book with its name", "other");
  check(t.legs[0].kind === "ml" && t.legs[0].m.side === "draw" && t.legs[0].m.game.id === "801" && t.odds === 260 && t.stake === 10, "BetMGM: draw matched", "other");
  const F = draft(t);
  check(F.book === "other" && F.bookOther === "BetMGM" && C.canAutoSettle(toBet(F)), "BetMGM: draft + auto-settle", "other");
}

// ---------- 8. UFC fighter moneyline, no book on the slip -> default book (Hard Rock in Florida)
{
  const [t] = run(`Chovancek ML -125
UFC Fight Night
Stake: $25.00`);
  check(t.book === null && t.legs[0].m.lg === "ufc" && t.legs[0].m.side === "away", "UFC: fighter last name matched", "ufc");
  const F = draft(t);
  check(F.book === "hardrock" && F.stake === 25 && F.odds === -125 && C.canAutoSettle(toBet(F)), "UFC: default book + auto-settle", "ufc");
}

// ---------- 9. several singles in one paste (My Bets list) -> one ticket each
{
  const ts = run(`Philadelphia Eagles -3.5 -110
DAL @ PHI
Wager $10.00 To Win $9.09
Over 220.5 -110
GS @ LAL
Wager $5.00 To Win $4.55`);
  check(ts.length === 2 && ts[0].stake === 10 && ts[1].stake === 5 && ts[1].legs[0].kind === "total" && ts[1].legs[0].m.game.id === "501", `two singles split into 2 tickets (got ${ts.length})`, "multi");
}

// ---------- 10. OCR noise: O for 0, unicode minus, dark-screen garbage lines
{
  const [t] = run(`Hard Rock Bet
Philadelphia Eagles −3.5   -11O
Point Spread
Dallas Cowboys @ Philadelphia Eagles
Stake $1O.OO
Potential Return $19.O9`);
  check(t.odds === -110 && t.stake === 10 && t.payout === 19.09 && t.legs[0].line === -3.5, "OCR: -11O / $1O.OO / unicode minus fixed", "ocr");
}

// ---------- 11. decimal odds, settled result, cash-out
{
  const [t] = run(`Green Bay Packers Moneyline
CAR @ GB
Odds 1.67
Stake $30.00
Won`);
  check(t.odds === -149 && t.status === "won", `decimal odds 1.67 -> -149, status won (got ${t.odds}, ${t.status})`, "misc");
  const [c] = run(`Philadelphia Eagles -3.5 -110
DAL @ PHI
Wager $20.00
Cashed Out $12.50`);
  check(c.status === "cashout" && c.cashout === 12.5 && c.stake === 20, "cash-out amount", "misc");
}

// ---------- 12. part-game and unsupported markets stay linked but settle by hand
{
  const [t] = run(`1st Half Spread
Philadelphia Eagles -1.5 -115
DAL @ PHI
Stake $10`);
  const F = draft(t);
  check(t.legs[0].period && F.legs[0].eventId === "401" && F.legs[0].review.status === "settle" && !C.canAutoSettle(toBet(F)), "1st-half spread: linked, not auto-settled", "misc");
  const [u] = run(`CeeDee Lamb First TD Scorer +800
DAL @ PHI
Wager $5`);
  const G = draft(u);
  check(G.legs[0].review.status === "settle" && G.legs[0].selection.includes("CeeDee Lamb") && !C.canAutoSettle(toBet(G)), "first TD scorer: settle by hand", "misc");
}

// ---------- 13. ambiguous nickname: "Rangers" (NHL + MLB) resolved by market (puck line)
{
  const [t] = run(`Rangers +1.5 -180
Puck Line
Stake $18`);
  check(t.legs[0].m.lg === "nhl" && t.legs[0].m.side === "away", "Rangers puck line -> NHL", "match");
  const [u] = run(`Rangers -1.5 +120
Run Line
Stake $10`);
  check(u.legs[0].m.lg === "mlb" && u.legs[0].m.side === "home", "Rangers run line -> MLB", "match");
}

// ---------- 14. unmatched game stays editable, typed selection kept
{
  const [t] = run(`Miami Dolphins +6.5 -110
Wager $10`);
  const F = draft(t);
  check(F.legs[0].manual && F.legs[0].selection === "Miami Dolphins +6.5" && F.legs[0].review.status === "manual" && F.odds === -110 && F.stake === 10, "unmatched team: manual leg with the slip's text", "match");
}

// ---------- 15. odds derived from stake + payout when the slip shows no price; empty / junk text
{
  const [t] = run(`Los Angeles Lakers Moneyline
GS @ LAL
Wager $10.00
To Pay $28.00`);
  check(t.odds === 180 && t.warnings.some(w => /worked out/.test(w)), "odds derived from payout (+180)", "misc");
  const r = S.parseSlip("hello\nthanks!", IDX, { now: NOW });
  check(r.tickets.length === 0, "junk text -> no tickets", "misc");
  check(S.parseSlip("", IDX).tickets.length === 0, "empty -> no tickets", "misc");
}

// ---------- 16. duplicate detection + OCR pixel prep
{
  check(S.dupOf([{ id: "a", slipRef: "HRB1" }], "HRB1").id === "a" && S.dupOf([{ id: "a" }], "HRB1") === null, "duplicate slip ref detected", "misc");
  const px = new Uint8ClampedArray([10, 10, 10, 255, 240, 240, 240, 255, 20, 20, 20, 255]);
  const r = S.ocrPrep(px);
  check(r.dark && px[0] === 255 && px[4] === 0, "OCR prep inverts dark-mode screenshots", "ocr");
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall slip import tests passed");
process.exit(fails.length ? 1 : 0);
