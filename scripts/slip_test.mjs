// Unit tests for bet-slip import (site/assets/slip-core.js): sample Hard Rock Bet / DraftKings / FanDuel / other slips -> parsed ticket ->
// matched to LineSmart games/players -> bet-form draft -> saved bet that BetCore can auto-settle. No browser, no network.
// Usage: node scripts/slip_test.mjs
import { createRequire } from "module";
import fs from "fs";
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

// ---------- 17. Hard Rock settled share card (Winner banner, Paid, line-then-player props). Fake bet ID only.
{
  const SLIP = `Hard Rock Bet
WINNER WINNER WINNER WINNER WINNER WINNER WINNER WINNER WINNER WINNER WINNER WINNER
WINNER
PARLAY 3-Bet Parlay +531
Under 9.5, Over 25.5, Under 9.5
Wager
$20
Paid
$126.29
ID: HRB-TEST-1001
Hide selections
Under 9.5 -130
CADE CUNNINGHAM - ASSISTS
4
9.5
Over 25.5 -110
TYRESE MAXEY - POINTS
27
25.5
Under 9.5 -115
BAM ADEBAYO - REBOUNDS
9
9.5`;
  const [t, ...rest] = run(SLIP);
  check(rest.length === 0 && t.parlay && t.legs.length === 3, `HRB settled: one 3-leg ticket (got ${rest.length + 1} tickets, ${t && t.legs.length} legs)`, "hardrock");
  check(t.status === "won" && t.stake === 20 && t.odds === 531 && t.payout === 126.29 && t.ref === "HRB-TEST-1001", `HRB settled: won, $20, +531, paid $126.29, fake id (got ${t.status}, ${t.stake}, ${t.odds}, ${t.payout}, ${t.ref})`, "hardrock");
  const [a, b, c] = t.legs;
  check(a.player === "CADE CUNNINGHAM" && a.pmk === "assists" && a.ou === "under" && a.line === 9.5 && a.odds === -130 && a.result === "won" && a.statValue === 4, "HRB settled leg 1: Cunningham under 9.5 assists, final 4 won", "hardrock");
  check(b.player === "TYRESE MAXEY" && b.pmk === "points" && b.ou === "over" && b.line === 25.5 && b.odds === -110 && b.result === "won" && b.statValue === 27, "HRB settled leg 2: Maxey over 25.5 points, final 27 won", "hardrock");
  check(c.player === "BAM ADEBAYO" && c.pmk === "rebounds" && c.ou === "under" && c.line === 9.5 && c.odds === -115 && c.result === "won" && c.statValue === 9, "HRB settled leg 3: Adebayo under 9.5 rebounds, final 9 won", "hardrock");
  const F = draft(t);
  check(F.status === "won" && F.paid === 126.29 && F.type === "parlay", "HRB settled: draft keeps Won and the slip's paid amount", "hardrock");
  const open = { id: "open-1", status: "pending", book: "hardrock", type: "parlay", odds: 531, stake: 20, notes: "Bet ID HRB-TEST-1001", legs: [
    { prop: { player: "Cade Cunningham", mk: "assists", side: "under", line: 9.5 } },
    { prop: { player: "Tyrese Maxey", mk: "points", side: "over", line: 25.5 } },
    { prop: { player: "Bam Adebayo", mk: "rebounds", side: "under", line: 9.5 } },
  ] };
  check(S.matchOpenBets([open], t).map(b => b.id).join() === "open-1", "HRB settled: matches the open bet by the bet ID in notes", "hardrock");
  const byLegs = { ...open, id: "open-2", notes: "" };
  check(S.matchOpenBets([byLegs], t)[0].id === "open-2", "HRB settled: matches one pending Hard Rock bet by odds, stake and legs", "hardrock");
  const two = S.matchOpenBets([open, { ...byLegs, id: "open-3" }], { ...t, ref: "" });
  check(two.length === 2, "HRB settled: several leg matches are listed, not auto-picked", "hardrock");
  const [col] = run(`Hard Rock Bet
WINNER WINNER WINNER WINNER WINNER WINNER WINNER WINNER
3-Bet Parlay +531
Under 9.5, Over 25.5, Under 9.5
Wager Paid
$20 $126.29
ID: HRB-TEST-1001
Hide selections
Under 9.5 -130
CADE CUNNINGHAM - ASSISTS
Over 25.5 -110
TYRESE MAXEY - POINTS
Under 9.5 -115
BAM ADEBAYO - REBOUNDS`);
  check(col && col.legs.length === 3 && col.stake === 20 && col.payout === 126.29 && col.status === "won" && col.legs[0].ou === "under" && col.legs[1].ou === "over" && col.legs[2].pmk === "rebounds", "HRB settled: two-column Wager Paid / $20 $126.29 stays one ticket", "hardrock");
  const banner = S.classify("WINNER WINNER WINNER WINNER WINNER WINNER WINNER WINNER WINNER WINNER WINNER WINNER", null, NOW);
  check(banner.length === 1 && banner[0].k === "status" && banner[0].status === "won", "WINNER watermark is a result, not a moneyline", "hardrock");
}

// ---------- 18. real dark-mode photo: inverted OCR drops the green header; raw + header band merge
{
  const ocr = JSON.parse(fs.readFileSync(new URL("./fixtures/hrb-photo-ocr.json", import.meta.url)));
  const bad = S.parseSlip(ocr.inverted).tickets[0];
  check(!bad || !bad.stake || bad.legs.length !== 3, "inverted photo OCR alone misses the stake or splits the legs", "photo");
  const t = S.bestOcrTicket([ocr.raw, ocr.inverted, ocr.header]);
  check(t && t.book === "hardrock" && t.status === "won" && t.stake === 20 && t.odds === 531 && t.payout === 126.29 && t.toWin === 106.29, `photo OCR merges to Hard Rock won $20 +531 paid $126.29 (got ${t && t.book} ${t && t.status} ${t && t.stake} ${t && t.odds} ${t && t.payout})`, "photo");
  check(t.legs.length === 3 && t.legs[0].player.includes("CUNNINGHAM") && t.legs[0].ou === "under" && t.legs[0].line === 9.5 && t.legs[0].pmk === "assists"
    && t.legs[1].player.includes("MAXEY") && t.legs[1].ou === "over" && t.legs[1].line === 25.5
    && t.legs[2].player.includes("ADEBAYO") && t.legs[2].ou === "under" && t.legs[2].line === 9.5 && t.legs[2].pmk === "rebounds", "photo OCR: 3 paired legs", "photo");
  check(t.ref === "HRB-TEST-1001" && !JSON.stringify(ocr).match(/\d{8,}/), "photo fixture uses the fake bet ID only", "photo");
}

// ---------- 19. DraftKings OCR: light, dark, stake math, token stake, bet id, forgiving match
{
  const tag = "dkocr";
  const FAKE_DK = ["DK", "0000", "0000", "0000", "1234"].join("");
  const FAKE_NUM = ["6000", "0000", "0000", "1234"].join("");
  const maskId = s => "****" + String(s || "").replace(/\s+/g, "").slice(-4);
  const noStakeWarn = t => (t.warnings || []).some(w => /No stake found/.test(w));
  const estWarn = t => (t.warnings || []).some(w => /estimated, check this/.test(w));

  // Light single: labels above the amounts, bet id on the next line.
  {
    const [t] = run(`DraftKings Sportsbook
Green Bay Packers
-150
Moneyline
CAR Panthers @ GB Packers
Sun 8:20 PM
Wager
$15.00
To Pay
$25.00
Bet ID
${FAKE_DK}`);
    check(t.book === "draftkings" && t.stake === 15 && t.payout === 25 && t.odds === -150 && !t.stakeEstimated, "DK light single: stake, to pay, odds", tag);
    check(t.ref === FAKE_DK && maskId(t.ref) === "****1234", `DK light single: bet id ${maskId(t.ref)}`, tag);
    check(t.legs[0].m.game && t.legs[0].m.game.id === "402" && t.legs[0].m.side === "home", "DK light single: Packers matched", tag);
  }

  // Dark single: S for $, O for 0, "Bet lD" with the digits split.
  {
    const [t] = run(`DraftKings
Green Bay Packers -15O
Moneyline
CAR Panthers @ GB Packers
Wager S15.OO
To Pay S25.OO
Bet lD: ${FAKE_NUM.replace(/(.{4})/g, "$1 ").trim()}`);
    check(t.book === "draftkings" && t.stake === 15 && t.payout === 25 && t.odds === -150, `DK dark single: S/$ and O/0 (stake ${t.stake}, pay ${t.payout}, odds ${t.odds})`, tag);
    check(t.ref === FAKE_NUM && maskId(t.ref) === "****1234", `DK dark single: spaced id ${maskId(t.ref)}`, tag);
    check(t.legs[0].m.game && t.legs[0].m.game.id === "402", "DK dark single: game matched", tag);
  }

  // Cash parlay: payout includes the stake. $75 at +300 → $18.75.
  {
    const [t] = run(`4 Pick Parlay
+300
Philadelphia Eagles -3.5
-110
Dallas Cowboys @ Philadelphia Eagles
Green Bay Packers
Moneyline
Carolina Panthers @ Green Bay Packers
Over 47.5
-110
Dallas Cowboys @ Philadelphia Eagles
Los Angeles Lakers +4.5
-110
Golden State Warriors @ Los Angeles Lakers
Potential Payout
$75.00`);
    check(t.parlay && t.legs.length === 4 && t.odds === 300 && !t.bonus, `DK parlay: 4 legs at +300 (got ${t.legs.length})`, tag);
    check(t.stake === 18.75 && t.stakeEstimated && t.payout === 75 && !noStakeWarn(t) && estWarn(t), `DK parlay: stake derived $18.75 from payout (got ${t.stake}, est ${t.stakeEstimated})`, tag);
    const F = draft(t);
    check(F.stake === 18.75 && F.stakeEstimated && F.legs.every(l => l.review.status === "matched"), "DK parlay: draft stake estimated, every leg matched", tag);
  }

  // To Win is profit only. $75 to win at +300 → $25 stake, payout $100.
  {
    const [t] = run(`Philadelphia Eagles
+300
Moneyline
Dallas Cowboys @ Philadelphia Eagles
To Win
$75.00`);
    check(t.stake === 25 && t.stakeEstimated && t.toWin === 75 && t.payout === 100 && t.payoutEstimated && !t.bonus, `DK to-win: stake $25, payout $100 (got ${t.stake}, ${t.payout})`, tag);
    check(t.legs[0].m.game && t.legs[0].m.game.id === "401" && t.legs[0].m.side === "home", "DK to-win: Eagles ML matched", tag);
  }

  // The reported slip: token, payout $75, +300, no stake printed. Amount = 75 / (4 − 1) = $25.
  {
    const [t] = run(`DraftKings
Green Bay Packers
+300
Moneyline
CAR Panthers @ GB Packers
Bonus Bet
Payout
$75.00
#${FAKE_NUM}`);
    check(t.bonus && t.stake === 25 && t.stakeEstimated && t.payout === 75 && t.toWin === 75 && t.odds === 300, `DK token single: amount $25 from payout (got bonus ${t.bonus}, stake ${t.stake}, pay ${t.payout})`, tag);
    check(!noStakeWarn(t) && estWarn(t) && (t.warnings || []).some(w => /Cash at risk is \$0/.test(w)), "DK token single: no missing-stake warning, cash at risk called out", tag);
    check(t.ref === FAKE_NUM && maskId(t.ref) === "****1234", `DK token single: hash id ${maskId(t.ref)}`, tag);
    const F = draft(t);
    check(F.bonus && F.stake === 25 && F.book === "draftkings" && F.legs[0].eventId === "402" && F.legs[0].side === "home" && F.legs[0].review.status === "matched", "DK token single: draft, Packers matched", tag);
    const saved = C.normalizeBet({ ...toBet(F), bonus: true, status: "won", paid: 75 });
    check(C.netResult(saved) === 75 && C.netResult({ ...saved, status: "lost", paid: undefined }) === 0, "DK token single: win profit is the payout, loss is $0", tag);
  }

  // Token amount is on the slip, so it is not estimated.
  {
    const [t] = run(`$25.00 Bonus Bet
Payout $75.00
+300
Philadelphia Eagles ML
Dallas Cowboys @ Philadelphia Eagles`);
    check(t.bonus && t.stake === 25 && !t.stakeEstimated && t.payout === 75 && t.odds === 300 && !noStakeWarn(t), `DK token with amount printed: $25 not estimated (est ${t.stakeEstimated})`, tag);
    check(t.legs[0].m.game && t.legs[0].m.game.id === "401", "DK token with amount: game matched", tag);
  }

  // Token player prop, clean name.
  {
    const [t] = run(`Bonus Bet
Stephen Curry
Over 26.5
Points
+300
Golden State Warriors @ Los Angeles Lakers
Payout
$75.00`);
    const l = t.legs[0];
    check(t.bonus && t.stake === 25 && t.odds === 300 && l.kind === "prop" && l.pmk === "points" && l.line === 26.5, `DK token prop: Curry points, amount $25 (got ${l.kind}/${l.pmk})`, tag);
    check(l.m.game && l.m.game.id === "501" && l.m.pid === "3975" && !noStakeWarn(t), "DK token prop: matched by the player's team", tag);
  }

  // Token prop, OCR typo in the last name, no matchup line: still the player's team.
  {
    const [t] = run(`Saquon Barkly
Over 89.5 Rushing Yards
-115
Free Bet
Payout $17.39`);
    const l = t.legs[0];
    check(t.bonus && l.player === "Saquon Barkly" && l.m.game && l.m.game.id === "401" && l.m.player === "Saquon Barkley", `DK token prop typo: Barkly -> Barkley on ${l.m.game && l.m.game.id}`, tag);
    check(t.stake === 20 && t.stakeEstimated, `DK token prop: $20 from -115 and $17.39 payout (got ${t.stake})`, tag);
  }

  // Four-leg token parlay with nickname typos. None should stay "no game found".
  {
    const [t] = run(`4 Leg Parlay
+300
Eagels -3.5
-110
Cowboys @ Eagles
Packres ML
-150
Panthers at Packers
Over 47.5
-110
DAL @ PHI
Lakers +4.5
-110
Warriors @ Lakers
Bonus Bets
Payout
$75.00`);
    const F = draft(t);
    check(t.bonus && t.parlay && t.legs.length === 4 && t.stake === 25 && t.odds === 300 && !noStakeWarn(t), `DK token parlay: 4 legs, $25, +300 (got ${t.legs.length}, ${t.stake})`, tag);
    check(F.legs.every(l => l.review.status !== "manual" && l.eventId), `DK token parlay: no "no game found" (${F.legs.map(l => l.review.status + ":" + l.eventId).join(", ")})`, tag);
    check(t.legs[0].m.game && t.legs[0].m.game.id === "401", "DK token parlay: Eagels leg uses the matchup line", tag);
    const [fuzzy] = run(`Eagels -3.5 -110\nWager $10\nTo Pay $19.09`);
    check(fuzzy.legs[0].m.game && fuzzy.legs[0].m.game.id === "401" && fuzzy.legs[0].m.unsure && draft(fuzzy).legs[0].review.status === "check", "OCR Eagels: linked and marked to check", tag);
    check(t.legs[1].m.game && t.legs[1].m.game.id === "402", "DK token parlay: fuzzy Packres linked", tag);
  }

  // Amounts printed above the words (OCR column order).
  {
    const [t] = run(`Eagles -3.5 -110
Cowboys @ Eagles
$10.00
Wager
$19.09
Payout`);
    check(t.stake === 10 && t.payout === 19.09 && !t.stakeEstimated, `DK amounts above labels: $10 and $19.09 (got ${t.stake}, ${t.payout})`, tag);
  }

  // Stake present, payout missing → derive the payout.
  {
    const [t] = run(`Philadelphia Eagles ML +300
Dallas Cowboys @ Philadelphia Eagles
Wager $25.00`);
    check(t.stake === 25 && !t.stakeEstimated && t.payout === 100 && t.payoutEstimated && t.toWin === 75, `DK reverse: payout $100 from $25 at +300 (got ${t.payout})`, tag);
  }

  // Nickname, bare cents, comma.
  {
    const [t] = run(`Philly -3.5 -110
Cowboys @ Eagles
Wager
1,250.00
To Pay
$2,386.36`);
    check(t.stake === 1250 && t.legs[0].m.game && t.legs[0].m.game.id === "401" && t.legs[0].m.side === "home", "DK nickname Philly + comma stake", tag);
  }

  // Other books, one realistic OCR shape each. Florida copy is unchanged; these are just slip text.
  {
    const [hr] = run(`Hard Rock Bet
Philadelphia Eagles −3.5 -11O
Point Spread
Dallas Cowboys @ Philadelphia Eagles
Stake
S1O.OO
Potential Return
19.09`);
    check(hr.book === "hardrock" && hr.stake === 10 && hr.odds === -110 && hr.payout === 19.09, `HR dark: S/$ O/0 (got ${hr.stake}, ${hr.odds}, ${hr.payout})`, "books");
    const [fd] = run(`FanDuel
Eagles -3.5 (-110) | DAL @ PHI
WAGER
20.00
TO WIN
18.18`);
    check(fd.book === "fanduel" && fd.stake === 20 && fd.toWin === 18.18 && fd.payout === 38.18 && fd.legs[0].m.game.id === "401", "FD: wager then to-win on their own lines", "books");
    const [mgm] = run(`BetMGM
Eagles ML +300
Dallas Cowboys @ Philadelphia Eagles
Bet Amount $18.75
Payout $75.00`);
    check(mgm.bookName === "BetMGM" && mgm.stake === 18.75 && mgm.payout === 75 && !mgm.stakeEstimated && mgm.legs[0].m.game.id === "401", "BetMGM: bet amount + payout, stake not estimated", "books");
    const [cz] = run(`Caesars Sportsbook
Packers ML -150
CAR Panthers @ GB Packers
Total Wager $15.00
Total Payout $25.00`);
    check(cz.bookName === "Caesars Sportsbook" && cz.stake === 15 && cz.payout === 25 && cz.legs[0].m.game.id === "402", "Caesars: total wager / total payout", "books");
    const [fan] = run(`Fanatics Sportsbook
Eagles -3.5 -110
Cowboys at Eagles
Risk $10.00
Returns $19.09`);
    check(fan.bookName === "Fanatics Sportsbook" && fan.stake === 10 && fan.payout === 19.09 && fan.legs[0].m.side === "home", "Fanatics: risk / returns, 'at' matchup", "books");
  }
}

// ---------- 20. Close games when the name is ambiguous, and yesterday's ET date
{
  const tm = (id, abbr, name, short) => ({ id, abbr, name, short });
  const game = (id, date, away, home, state = "pre") => ({ id, date, state, away, home });
  const NYG = tm("19", "NYG", "New York Giants", "Giants"), NYJ = tm("20", "NYJ", "New York Jets", "Jets");
  const idx = S.buildIndex({ games: { nfl: [
    game("g1", "2026-10-26T17:00:00Z", NYG, T.PHI),
    game("j1", "2026-10-26T17:00:00Z", NYJ, T.DAL),
  ] } });
  const [amb] = S.parseSlip(`New York -3.5 -110\nWager $10`, idx, { now: NOW }).tickets;
  S.matchTicket(amb, idx, { now: NOW });
  const choices = amb.legs[0].m.choices || [];
  check(amb.legs[0].m.unsure && choices.length >= 2, `city-only New York lists choices (${choices.map(c => c.name).join(" | ")})`, "match");
  const F = S.toDraft(amb, { defaultBook: "draftkings", today: "2026-10-26" });
  check(F.legs[0].review.status === "check" && (F.legs[0].review.choices || []).length >= 2, "city-only: review says check and offers games, not no-game-found", "match");

  const late = Date.parse("2026-11-01T04:30:00Z"); // 12:30 AM ET Nov 1
  const idx2 = S.buildIndex({ games: { nfl: [
    game("old", "2026-09-01T17:00:00Z", T.DAL, T.PHI, "post"),
    game("yest", "2026-10-31T23:15:00Z", T.DAL, T.PHI, "post"),
  ] } });
  const [near] = S.parseSlip(`Eagles -3.5 -110\nCowboys @ Eagles\nWager $10`, idx2, { now: late }).tickets;
  S.matchTicket(near, idx2, { now: late });
  check(near.legs[0].m.game && near.legs[0].m.game.id === "yest", `previous ET date wins over a September game (got ${near.legs[0].m.game && near.legs[0].m.game.id})`, "match");
}

// ---------- 21. The live DraftKings token parlay, verbatim from "Text read from the slip"
{
  const tag = "live";
  const LIVE = `4 Pick Parlay | +300 @ Open
35+, 7+, 11+, 25+
$
Wager: ® $25.00 | To Pay: $75.00
oO a 35+
Aa, Victor Wembanyama Points + Rebounds + Assists
& 7
Oo ar LaMelo Ball Assists
Oo & 11+
Aa, Victor Wembanyama Rebounds
Fy 25+
Oo ar LaMelo Ball Points + Rebounds + Assists
@ MIN Today 8:10 PM SAS`;
  const nba = JSON.parse(fs.readFileSync(new URL("../site/data/nba/index.json", import.meta.url)));
  const liveIdx = S.buildIndex({
    games: { nba: nba.games },
    search: { nba: { teams: [["24", "San Antonio Spurs", "SA", "Spurs"], ["30", "Charlotte Hornets", "CHA", "Hornets"]], players: [["w1", "Victor Wembanyama", 0], ["l1", "LaMelo Ball", 1]] } },
  });
  const now = Date.parse("2026-11-01T00:39:00Z"); // 8:39 PM ET on Oct 31
  const [t] = S.parseSlip(LIVE, liveIdx, { now }).tickets;
  S.matchTicket(t, liveIdx, { now });
  const F = S.toDraft(t, { defaultBook: "hardrock", today: "2026-10-31" });
  check(t.book === "draftkings" && t.bonus && t.stake === 25 && t.stakeFromSlip && !t.stakeEstimated && t.odds === 300 && t.payout === 75 && t.toWin === 75 && !t.ref, `live slip: DK token $25 (printed) +300 to pay $75 (got stake ${t.stake} est ${t.stakeEstimated} book ${t.book} bonus ${t.bonus})`, tag);
  check(!(t.warnings || []).some(w => /No stake found|estimated, check this/.test(w)) && (t.warnings || []).some(w => /Cash at risk is \$0/.test(w)), "live slip: printed stake, cash at risk $0, not estimated", tag);
  check(t.legs.length === 4, `live slip: 4 prop legs (got ${t.legs.length})`, tag);
  const [a, b, c, d] = t.legs;
  check(a.player === "Victor Wembanyama" && a.pmk === "pra" && a.ou === "over" && a.line === 34.5 && a.m.game && a.m.game.id === "401909901", "live leg 1: Wembanyama 35+ PRA → MIN @ SA", tag);
  check(b.player === "LaMelo Ball" && b.pmk === "assists" && b.ou === "over" && b.line === 6.5 && b.m.game && b.m.game.id === "401909897", "live leg 2: LaMelo 7+ assists → PHI @ CHA", tag);
  check(c.player === "Victor Wembanyama" && c.pmk === "rebounds" && c.ou === "over" && c.line === 10.5 && c.m.game && c.m.game.id === "401909901", "live leg 3: Wembanyama 11+ rebounds → MIN @ SA", tag);
  check(d.player === "LaMelo Ball" && d.pmk === "pra" && d.ou === "over" && d.line === 24.5 && d.m.game && d.m.game.id === "401909897", "live leg 4: LaMelo 25+ PRA → PHI @ CHA", tag);
  check(F.legs.every(l => l.review.status === "matched" && l.eventId), `live slip: no "no game found" (${F.legs.map(l => l.review.status).join(",")})`, tag);
  check(t.gameHint && t.gameHint.abbrs.join(",") === "MIN,SAS" && t.gameHint.when.date === "2026-10-31", "live footer: MIN / SAS on Oct 31 ET", tag);

  // Same money with the token flag and no printed stake must not use the cash formula ($75 / 4 = $18.75).
  const [miss] = run(`Philadelphia Eagles ML
+300
Bonus Bet
Payout $75.00
Dallas Cowboys @ Philadelphia Eagles`);
  check(miss.bonus && miss.stake === 25 && miss.stakeEstimated && miss.payout === 75 && miss.odds === 300, `bonus without a printed amount: $25 not $18.75 (got ${miss.stake})`, tag);

  // Two OCR passes: one derives the cash stake, the other only sees the token icon.
  const merged = S.bestOcrTicket([
    `4 Pick Parlay | +300 @ Open\nPayout\n$75.00\nEagles -3.5\nCowboys @ Eagles`,
    `Wager: ®\nEagles -3.5`,
  ]);
  check(merged && merged.bonus && merged.stake === 25 && merged.stakeEstimated && merged.odds === 300, `merged OCR passes recompute the token amount to $25 (got ${merged && merged.stake} bonus ${merged && merged.bonus})`, tag);

  const fake = "DK" + "6380" + "0000" + "0000" + "1234";
  const [id] = run(`Eagles -3.5 -110\nCowboys @ Eagles\nWager $10\nTo Pay $19.09\nID: ${fake}`);
  const maskId = s => "****" + String(s || "").slice(-4);
  check(id.ref === fake && maskId(id.ref) === "****1234" && id.book === "draftkings", `DK id anywhere: ${maskId(id.ref)}`, tag);

  const [none] = run(`Somebody Else Over 25.5 Points\n+300\nWager $10`);
  check(none.legs.length === 1 && !none.legs[0].m.game && (none.warnings || []).some(w => /Legs read from the slip:/.test(w) && /Somebody Else/.test(w)), "unmatched leg names are shown", tag);
}

// ---------- 22. Hard Rock SGPMax open parlays (wager/payout include stake; cash-out button is not a result)
{
  const tag = "sgp";
  const nfl = JSON.parse(fs.readFileSync(new URL("../site/data/nfl/index.json", import.meta.url)));
  const teams = [["33", "Baltimore Ravens", "BAL", "Ravens"], ["2", "Buffalo Bills", "BUF", "Bills"], ["13", "Las Vegas Raiders", "LV", "Raiders"], ["20", "New York Jets", "NYJ", "Jets"], ["5", "Cleveland Browns", "CLE", "Browns"], ["23", "Pittsburgh Steelers", "PIT", "Steelers"], ["1", "Atlanta Falcons", "ATL", "Falcons"], ["27", "Tampa Bay Buccaneers", "TB", "Buccaneers"]];
  const players = [["p1", "Lamar Jackson", 0], ["p2", "Josh Allen", 1], ["p3", "Kirk Cousins", 2], ["p4", "Geno Smith", 3], ["p5", "Deshaun Watson", 4], ["p6", "Aaron Rodgers", 5], ["p7", "Michael Penix Jr.", 6], ["p8", "Baker Mayfield", 7]];
  const idx = S.buildIndex({ games: { nfl: nfl.games }, search: { nfl: { teams, players } } });
  const now = Date.parse("2026-11-01T18:30:00Z");
  const eight = `Hard Rock Bet
SGPMAX
8-Bet Parlay +239
Wager
$150
Payout
$508
SGP Ravens @ Bills -428
Today, 1:00pm EST
Over 0.5
LAMAR JACKSON - TO RECORD 1+ PASSING TDS
Over 0.5
JOSH ALLEN - TO RECORD 1+ PASSING TDS
SGP Raiders @ Jets -415
Today, 1:00pm EST
Over 0.5
KIRK COUSINS - TO RECORD 1+ PASSING TDS
Over 0.5
GENO SMITH - TO RECORD 1+ PASSING TDS
SGP Browns @ Steelers -173
Today, 1:00pm EST
Over 0.5
DESHAUN WATSON - TO RECORD 1+ PASSING TDS
Over 0.5
AARON RODGERS - TO RECORD 1+ PASSING TDS
SGP Falcons @ Buccaneers -249
Today, 1:00pm EST
Over 0.5
MICHAEL PENIX JR. - TO RECORD 1+ PASSING TDS
Over 0.5
BAKER MAYFIELD - TO RECORD 1+ PASSING TDS`;
  const t8 = S.parseSlip(eight, idx, { now }).tickets[0];
  S.matchTicket(t8, idx, { now });
  check(S.parseSlip(eight, idx, { now }).tickets.length === 1 && t8.parlay && t8.sgp && t8.legs.length === 8 && t8.book === "hardrock" && t8.stake === 150 && t8.odds === 239 && t8.payout === 508 && !t8.status && !t8.bonus, `HR 8-bet SGPMax: one open parlay $150 +239 pay $508 (legs ${t8.legs.length}, odds ${t8.odds}, status ${t8.status})`, tag);
  const ids8 = t8.legs.map(l => l.m.game && l.m.game.id);
  check(t8.legs.every(l => l.pmk === "pass_tds" && l.ou === "over" && l.line === 0.5) && ids8.join(",") === "401873026,401873026,401873029,401873029,401873027,401873027,401873025,401873025", `HR 8-bet legs match the four 1:00pm games (${ids8.join(",")})`, tag);

  const four = `Hard Rock Bet
SGPMAX 4-Bet Parlay +993
Over 1.5, Over 1.5, Over 1.5, Over 1.5
Wager $150
Payout $1,640.10
SGP Raiders @ Jets +204
Today, 1:00pm EST
Over 1.5
GENO SMITH - PASSING TDS
Over 1.5
KIRK COUSINS - PASSING TDS
Over 1.5 +110
BAKER MAYFIELD - TO RECORD 2+ PASSING TDS
Falcons @ Buccaneers
Today, 1:00pm EST
Over 1.5 -140
JOSH ALLEN - PASSING TDS
Ravens @ Bills
Today, 1:00pm EST
Cash-out $150.00
Track`;
  const ts4 = S.parseSlip(four, idx, { now }).tickets;
  const t4 = ts4[0];
  S.matchTicket(t4, idx, { now });
  check(ts4.length === 1 && t4.legs.length === 4 && t4.stake === 150 && t4.odds === 993 && t4.payout === 1640.1 && !t4.status && t4.cashout == null, `HR 4-bet: $150 +993 pay $1,640.10, still open (status ${t4.status}, cash ${t4.cashout})`, tag);
  check(t4.legs[0].player === "GENO SMITH" && t4.legs[0].line === 1.5 && t4.legs[0].m.game.id === "401873029"
    && t4.legs[1].player === "KIRK COUSINS" && t4.legs[1].m.game.id === "401873029"
    && t4.legs[2].player === "BAKER MAYFIELD" && t4.legs[2].line === 1.5 && t4.legs[2].odds === 110 && t4.legs[2].m.game.id === "401873025"
    && t4.legs[3].player === "JOSH ALLEN" && t4.legs[3].odds === -140 && t4.legs[3].m.game.id === "401873026", "HR 4-bet legs: Geno/Kirk Jets, Baker Bucs +110, Josh Bills -140", tag);

  const [won] = S.parseSlip(`Hard Rock Bet
WINNER
3-Bet Parlay +531
Wager $20
Paid $126.29
ID: HRB-TEST-1234
Under 9.5 -130
CADE CUNNINGHAM - ASSISTS
Over 25.5 -110
TYRESE MAXEY - POINTS
Under 9.5 -115
BAM ADEBAYO - REBOUNDS`, idx, { now }).tickets;
  check(won && won.status === "won" && won.stake === 20 && won.payout === 126.29 && won.odds === 531 && won.legs.length === 3 && won.ref === "HRB-TEST-1234", "HR settled winner: paid $126.29, open result Won, fixture id HRB-TEST-1234", tag);

  // A tall screenshot is read in overlapping bands, so the same lines come back twice, plus a stray team name.
  const echoed = S.bestOcrTicket([eight + "\n" + eight + "\nRavens\nOver 0.5"]);
  S.matchTicket(echoed, idx, { now });
  check(echoed && echoed.legs.length === 8 && echoed.odds === 239 && echoed.stake === 150 && echoed.payout === 508 && !echoed.status, `tiled repeat of the 8-bet stays one open parlay (legs ${echoed && echoed.legs.length}, odds ${echoed && echoed.odds})`, tag);
  check(echoed.legs.every(l => l.pmk === "pass_tds" && l.line === 0.5), "tiled repeat: every leg is still a passing-TD prop", tag);

  const split = `Hard Rock Bet
8-Bet Parlay +239
Wager
150
Payout
508
SGP Ravens @ Bills
-428
Today, 1:00pm EST
Over 0.5
LAMAR JACKSON - TO RECORD 1+ PASSING TDS
Over 0.5
JOSH ALLEN - TO RECORD 1+ PASSING TDS
SGP Raiders @ Jets
-415
Over 0.5
KIRK COUSINS - TO RECORD 1+ PASSING TDS`;
  const ts = S.parseSlip(split, idx, { now }).tickets[0];
  check(ts && ts.stake === 150 && ts.payout === 508 && ts.odds === 239 && ts.legs.length === 3 && ts.legs.every(l => l.odds == null), `group price on its own line is not a leg price (stake ${ts && ts.stake}, leg odds ${(ts && ts.legs || []).map(l => l.odds).join(",")})`, tag);

  const badge = S.parseSlip(`S6PMAX 4-Bet Parlay +993
888 Ravens @ Bills -428
Over 0.5
LAMAR JACKSON - TO RECORD 1+ PASSING TDS
[8 Falcons @ Buccaneers -249
Over 0.5
BAKER MAYFIELD - TO RECORD 1+ PASSING TDS`, idx, { now }).tickets[0];
  check(badge && badge.book === "hardrock" && badge.odds === 993 && badge.legs.length === 2 && badge.legs.every(l => l.pmk === "pass_tds" && l.odds == null), `OCR badge in front of a group header is not an extra leg (book ${badge && badge.book}, legs ${badge && badge.legs.length})`, tag);

  const withFinal = S.bestOcrTicket([
    `Hard Rock Bet\nWINNER\n3-Bet Parlay +531\nUnder 9.5 -130\nCADE CUNNINGHAM - ASSISTS\n9.5`,
    `Under 9.5 -130\nCADE CUNNINGHAM - ASSISTS\n4`,
  ]);
  check(withFinal && withFinal.legs.length === 1 && withFinal.legs[0].statValue === 4 && withFinal.legs[0].result === "won", `a second OCR pass keeps the printed final (got ${withFinal && withFinal.legs[0] && withFinal.legs[0].statValue})`, tag);
  const noFin = S.parseSlip(`Over 0.5\nJOSH ALLEN - TO RECORD 1+ PASSING TDS\n9 Today, 1:00pm EST`, idx, { now }).tickets[0];
  check(noFin && noFin.legs.length === 1 && noFin.legs[0].statValue == null && !noFin.status, "a digit glued to Today is not a final", tag);
  const twice = S.parseSlip(`Under 9.5 -130
CADE CUNNINGHAM - ASSISTS
9.5
Over 25.5 -110
TYRESE MAXEY - POINTS
25.5
Under 9.5 -115
BAM ADEBAYO - REBOUNDS
9.5
Under 9.5 -130
CADE CUNNINGHAM - ASSISTS
4
Over 25.5 -110
TYRESE MAXEY - POINTS
27
Under 9.5 -115
BAM ADEBAYO - REBOUNDS
9`).tickets[0];
  check(twice && twice.legs.length === 3 && twice.legs.map(l => l.statValue).join(",") === "4,27,9", `repeated legs keep the printed finals (got ${twice && twice.legs.map(l => l.statValue).join(",")})`, tag);
  const junk = S.parseSlip(`3-Bet Parlay +531
Under 9.5 -130
CADE CUNNINGHAM - ASSISTS
4
CEE
Over 25.5 -110
TYRESE MAXEY - POINTS
27
EEE
Under 9.5 -115
BAM ADEBAYO - REBOUNDS
9`).tickets[0];
  check(junk && junk.legs.length === 3 && junk.legs.map(l => l.statValue).join(",") === "4,27,9", `OCR junk between legs does not steal the line (got ${junk && junk.legs.map(l => l.player + ":" + l.statValue).join(",")})`, tag);
}

// ---------- 23. Hard Rock straight total (Under 169.5) named only by the score bar. Fake bet ID. No photo.
{
  const tag = "hrb-total";
  const ocr = JSON.parse(fs.readFileSync(new URL("./fixtures/hrb-total-ocr.json", import.meta.url)));
  const hintOf = line => (S.classify(line, null, NOW).find(t => t.k === "hint") || null);
  const bar = hintOf("TNS 64  Final Score  94 MUR");
  check(bar && bar.abbrs.join() === "TNS,MUR" && bar.scores.join() === "64,94" && bar.final === true, "score bar TNS 64 Final Score 94 MUR is a hint", tag);
  const phi = hintOf("PHI 24 Final 17 DAL");
  check(phi && phi.abbrs.join() === "PHI,DAL" && phi.scores.join() === "24,17" && phi.final === true, "score bar PHI 24 Final 17 DAL is a hint", tag);
  check(!hintOf("Wager Paid"), "Wager Paid is not a score bar", tag);
  check(!hintOf("Under 169.5 +110"), "Under 169.5 +110 is not a score bar", tag);

  const MUR = tm("93", "MUR", "Murray State Racers", "Murray St");
  const TNST = tm("2634", "TNST", "Tennessee State Tigers", "Tennessee St");
  const TEN = tm("2633", "TEN", "Tennessee Volunteers", "Tennessee");
  const VAN = tm("238", "VAN", "Vanderbilt Commodores", "Vanderbilt");
  const gline = (id, date, away, home, state, as, hs) => ({ id, date, state, away: { ...away, score: as }, home: { ...home, score: hs } });
  const now = Date.parse("2026-11-02T20:00:00Z");
  const finalIdx = S.buildIndex({ games: { ncaab: [gline("401911707", "2026-11-02T16:30Z", MUR, TNST, "post", 94, 64)] } });
  const t = S.bestOcrTicket(ocr.passes);
  const leg = t && t.legs && t.legs[0];
  check(t && t.book === "hardrock" && t.status === "won" && t.stake === 25 && t.odds === 110 && t.payout === 52.5 && t.legs.length === 1 && leg.kind === "total" && leg.ou === "under" && leg.line === 169.5,
    `OCR merge: hardrock won $25 +110 paid $52.50 under 169.5 (got ${t && t.book} ${t && t.status} ${t && t.stake} ${t && t.odds} ${t && t.payout} legs ${t && t.legs.length} ${leg && leg.kind} ${leg && leg.ou} ${leg && leg.line})`, tag);
  check(t.gameHint && t.gameHint.abbrs.join() === "TNS,MUR" && t.gameHint.scores.join() === "64,94" && t.gameHint.final === true, `gameHint from the inverted pass (got ${t && t.gameHint && JSON.stringify(t.gameHint)})`, tag);
  check(t.ref === "HRB-TEST-2002", `fixture bet id HRB-TEST-2002 (got ${t && t.ref})`, tag);
  S.matchTicket(t, finalIdx, { now });
  const F = S.toDraft(t, { defaultBook: "hardrock", defaultLeague: "nfl", today: "2026-11-02" });
  check(leg.m.game && leg.m.game.id === "401911707" && leg.m.lg === "ncaab" && leg.m.side === "under" && !leg.m.unsure, `matched MUR @ TNST under, scores agree (unsure ${leg.m.unsure} id ${leg.m.game && leg.m.game.id})`, tag);
  check(F.type === "total" && F.legs[0].review.status === "matched" && F.legs[0].side === "under" && F.legs[0].line === 169.5 && F.status === "won" && F.paid === 52.5 && F.legs[0].league === "ncaab" && F.legs[0].eventId === "401911707",
    `draft: total matched under 169.5 won paid 52.5 (got ${F.type} ${F.legs[0].review.status} ${F.legs[0].side} ${F.legs[0].line} ${F.status} ${F.paid} ${F.legs[0].league})`, tag);

  const both = S.buildIndex({ games: { ncaab: [
    gline("401911707", "2026-11-02T16:30Z", MUR, TNST, "post", 94, 64),
    gline("401800001", "2026-11-02T16:30Z", VAN, TEN, "post", 70, 80),
  ] } });
  const hinted = (abbrs, scores) => ({ book: "hardrock", stake: 25, odds: 110, status: "won", payout: 52.5, gameHint: { abbrs, scores, final: true }, legs: [{ kind: "total", text: "Under 169.5", ou: "under", line: 169.5, odds: 110 }] });
  const near = hinted(["TNS", "MUR"], [64, 94]);
  S.matchTicket(near, both, { now });
  check(near.legs[0].m.game && near.legs[0].m.game.id === "401911707", `TNS/MUR matches TNST/MUR (got ${near.legs[0].m.game && near.legs[0].m.game.id})`, tag);
  const ten = hinted(["TEN", "MUR"], [64, 94]);
  S.matchTicket(ten, both, { now });
  check(!(ten.legs[0].m.game && ten.legs[0].m.game.id === "401911707"), `TEN/MUR does not match TNST (got ${ten.legs[0].m.game && ten.legs[0].m.game.id})`, tag);

  const wrong = hinted(["TNS", "MUR"], [64, 90]);
  S.matchTicket(wrong, finalIdx, { now });
  const Fw = S.toDraft(wrong, { defaultBook: "hardrock", defaultLeague: "nfl", today: "2026-11-02" });
  check(wrong.legs[0].m.game && wrong.legs[0].m.game.id === "401911707" && Fw.legs[0].review.status === "check", `wrong scores stay check, not matched (got ${wrong.legs[0].m.game && wrong.legs[0].m.game.id} ${Fw.legs[0].review.status})`, tag);

  const um = S.toDraft({ legs: [{ kind: "total", text: "Under 169.5", ou: "under", line: 169.5, market: { mk: "total", lg: "ncaab" }, m: {} }], stake: 25, odds: 110 }, { defaultBook: "hardrock", defaultLeague: "nfl", today: "2026-11-02" });
  check(um.legs[0].mk === "total" && um.legs[0].side === "under" && um.legs[0].line === 169.5 && um.legs[0].league === "ncaab" && um.legs[0].review.status === "manual", `unmatched total keeps side, line, and the slip league (got ${um.legs[0].mk} ${um.legs[0].side} ${um.legs[0].line} ${um.legs[0].league} ${um.legs[0].review.status})`, tag);
  const ums = S.toDraft({ legs: [{ kind: "spread", text: "Eagles -3.5", team: "Eagles", line: -3.5, market: { mk: "spread", lg: "nfl" }, m: {} }] }, { defaultLeague: "nba" });
  check(ums.legs[0].mk === "spread" && ums.legs[0].line === -3.5 && ums.legs[0].league === "nfl", `unmatched spread keeps the line (got ${ums.legs[0].line} ${ums.legs[0].league})`, tag);

  const open = { id: "open-total", status: "pending", book: "hardrock", type: "total", odds: 110, stake: 25, league: "ncaab", side: "under", line: 169.5, event: { id: "401911707", lg: "ncaab" } };
  check(S.matchOpenBets([open], near).map(b => b.id).join() === "open-total", "open total matched by game, market, side, and line", tag);
  check(S.matchOpenBets([{ ...open, id: "over", side: "over" }], near).length === 0, "open over does not match this under", tag);
  const sprT = { book: "hardrock", stake: 10, odds: -110, legs: [{ kind: "spread", line: -3.5, m: { game: { id: "401" }, side: "home" } }] };
  const sprB = { id: "sp", status: "pending", book: "hardrock", type: "spread", odds: -110, stake: 10, side: "home", line: -3.5, event: { id: "401" } };
  check(S.matchOpenBets([sprB], sprT)[0] && S.matchOpenBets([sprB], sprT)[0].id === "sp", "open spread matches game, side, and line", tag);
  const mlT = { book: "hardrock", stake: 10, odds: -150, legs: [{ kind: "ml", m: { game: { id: "401" }, side: "away" } }] };
  const mlB = { id: "ml", status: "pending", book: "hardrock", type: "ml", odds: -150, stake: 10, side: "away", event: { id: "401" } };
  check(S.matchOpenBets([mlB], mlT)[0] && S.matchOpenBets([mlB], mlT)[0].id === "ml", "open moneyline matches game and side", tag);
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall slip import tests passed");
process.exit(fails.length ? 1 : 0);
