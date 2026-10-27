// Builds scripts/fixtures/stats-bets.json: a deterministic (seeded) EXAMPLE bet history used only for local previews and
// screenshots of the tracker's stats (scripts/screenshots_stats.mjs). It is injected into a headless browser's localStorage;
// it never ships in site/ and is never written to Supabase or any account.
// Usage: node scripts/gen_stats_fixture.mjs
import fs from "fs";
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = a => a[Math.floor(rnd() * a.length)];
const TEAMS = {
  nfl: [["KC", "Chiefs"], ["BUF", "Bills"], ["PHI", "Eagles"], ["DAL", "Cowboys"], ["SF", "49ers"], ["DET", "Lions"], ["BAL", "Ravens"], ["MIA", "Dolphins"]],
  ncaaf: [["UGA", "Georgia"], ["OSU", "Ohio State"], ["TEX", "Texas"], ["ORE", "Oregon"], ["BAMA", "Alabama"], ["MICH", "Michigan"]],
  nba: [["BOS", "Celtics"], ["NY", "Knicks"], ["DEN", "Nuggets"], ["OKC", "Thunder"], ["LAL", "Lakers"], ["MIL", "Bucks"]],
  nhl: [["NYR", "Rangers"], ["TOR", "Maple Leafs"], ["EDM", "Oilers"], ["FLA", "Panthers"], ["COL", "Avalanche"]],
  mlb: [["NYY", "Yankees"], ["LAD", "Dodgers"], ["PHI", "Phillies"], ["HOU", "Astros"], ["ATL", "Braves"], ["BAL", "Orioles"]],
  epl: [["ARS", "Arsenal"], ["LIV", "Liverpool"], ["MCI", "Man City"], ["CHE", "Chelsea"], ["TOT", "Tottenham"]],
  ucl: [["RMA", "Real Madrid"], ["BAR", "Barcelona"], ["BAY", "Bayern"], ["PSG", "PSG"], ["INT", "Inter"]],
};
// league availability by month (MLB ends early Oct, NBA/NHL start late Oct, football from late Aug)
const LG_BY_DAY = d => {
  const m = d.getMonth() + 1, day = d.getDate(), out = [];
  if (m < 10 || (m === 10 && day < 30)) out.push("mlb", "mlb");
  if (m > 8 || (m === 8 && day > 27)) out.push("nfl", "nfl", "nfl", "ncaaf", "ncaaf");
  if (m === 10 && day >= 21) out.push("nba", "nba");
  if (m === 10 && day >= 7) out.push("nhl");
  out.push("epl");
  if (m >= 9 && day > 15 || m === 10) out.push("ucl");
  return out;
};
const BOOKS = ["draftkings", "draftkings", "fanduel", "fanduel", "hardrock"];
const PROPS = {
  nfl: [["pass_yds", "Josh Allen", 254.5], ["rush_yds", "Saquon Barkley", 89.5], ["rec_yds", "CeeDee Lamb", 74.5], ["anytime_td", "Christian McCaffrey", null], ["receptions", "Amon-Ra St. Brown", 6.5], ["rush_rec_yds", "Jahmyr Gibbs", 104.5]],
  nba: [["points", "Jayson Tatum", 27.5], ["pra", "Nikola Jokic", 49.5], ["threes", "Jalen Brunson", 2.5], ["rebounds", "Giannis Antetokounmpo", 11.5]],
};
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function ev(lg, d, i) {
  const t = TEAMS[lg], a = pick(t); let h = pick(t); while (h === a) h = pick(t);
  return { id: `ex-${lg}-${i}`, lg, name: `${a[0]} @ ${h[0]}`, date: `${iso(d)}T23:00Z`, home: { abbr: h[0], name: h[1], short: h[1] }, away: { abbr: a[0], name: a[1], short: a[1] } };
}
const amer = () => pick([-110, -110, -110, -115, -105, -120, -125, +100, +105, -140, -160, +120, +135, +150, -200, +175, +210, -130]);
const winP = o => (o < 0 ? -o / (-o + 100) : 100 / (o + 100)) * 1.04;  // a slightly +EV bettor, for a realistic upward chart
function status(o) { const r = rnd(); if (r < 0.035) return "push"; if (r < 0.05) return "void"; if (r < 0.075) return "cashout"; return rnd() < winP(o) ? "won" : "lost"; }
const bets = []; let i = 0;
const start = new Date(2026, 7, 8, 12), end = new Date(2026, 9, 25, 12);
for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
  const wd = d.getDay(), weekend = wd === 0 || wd === 6 || wd === 1 || wd === 4;
  const n = rnd() < (weekend ? 0.92 : 0.45) ? 1 + Math.floor(rnd() * (weekend ? 3 : 2)) : 0;
  for (let k = 0; k < n; k++) {
    const lgs = LG_BY_DAY(d), lg = pick(lgs), id = `ex-${String(++i).padStart(3, "0")}`, book = pick(BOOKS);
    const stake = pick([10, 20, 25, 25, 25, 50, 50, 75, 100]);
    const base = { id, createdAt: `${iso(d)}T16:${String(10 + k).padStart(2, "0")}:00Z`, date: iso(d), book, stake };
    const r = rnd();
    let b;
    if (r < 0.14) {          // parlay: 2-4 legs, sometimes multi-sport
      const nl = 2 + Math.floor(rnd() * 3), legs = [];
      for (let j = 0; j < nl; j++) {
        const l2 = j && rnd() < 0.4 ? pick(lgs) : lg, e = ev(l2, d, `${i}${j}`), ty = pick(["ml", "spread", "total"]);
        legs.push({ league: l2, type: ty, event: e, side: ty === "total" ? pick(["over", "under"]) : pick(["home", "away"]), line: ty === "spread" ? pick([-3.5, -6.5, 1.5, 2.5, -1.5]) : ty === "total" ? pick([44.5, 8.5, 5.5, 2.5, 224.5]) : undefined, odds: ty === "ml" ? pick([-150, -200, +120, -120]) : -110 });
      }
      const st = rnd();
      legs.forEach((l, j) => (l.result = st < 0.28 ? (j === 1 && nl > 2 && rnd() < 0.3 ? "push" : "won") : j === nl - 1 ? "lost" : rnd() < 0.6 ? "won" : "lost"));
      if (legs.every(l => l.result !== "lost") && rnd() < 0.15) legs[0].result = "void";
      const dec = legs.reduce((a, l) => a * (l.result === "push" || l.result === "void" ? 1 : l.odds < 0 ? 1 - 100 / l.odds : 1 + l.odds / 100), 1);
      const fullDec = legs.reduce((a, l) => a * (l.odds < 0 ? 1 - 100 / l.odds : 1 + l.odds / 100), 1);
      b = { ...base, type: "parlay", stake: pick([5, 10, 10, 20]), odds: Math.round((fullDec - 1) * 100), legs, status: legs.some(l => l.result === "lost") ? "lost" : "won", settledBy: "auto" };
      void dec;
    } else if (r < 0.5 && PROPS[lg]) {
      const [mk, player, line] = pick(PROPS[lg]), o = mk === "anytime_td" ? pick([+120, +150, -110, +185]) : pick([-115, -110, -120, +100, -105]);
      b = { ...base, type: "prop", league: lg, event: ev(lg, d, i), prop: { mk, player, line: line ?? 0.5, side: mk === "anytime_td" ? "over" : pick(["over", "under"]) }, odds: o, status: status(o), settledBy: "auto" };
    } else if (r >= 0.5 && r < 0.54) {
      const o = pick([+110, -125, +140]);
      b = { ...base, type: "prop", league: lg, eventText: "Same-game special", selection: pick(["First TD scorer: Travis Kelce", "Both teams to score", "Over 9.5 corners", "Player to hit a HR"]), odds: o, status: status(o), manual: true, settledBy: "manual" };
    } else {
      const ty = pick(["ml", "ml", "spread", "spread", "total"]), o = ty === "ml" ? amer() : pick([-110, -110, -115, -105, -108]);
      b = { ...base, type: ty, league: lg, event: ev(lg, d, i), side: ty === "total" ? pick(["over", "under"]) : pick(["home", "away"]), odds: o, status: status(o), settledBy: "auto" };
      if (ty === "spread") b.line = pick([-3, -3.5, -7, 1.5, 2.5, -1.5, 6.5]);
      if (ty === "total") b.line = pick([44.5, 47.5, 8.5, 6, 5.5, 2.5]);
    }
    if (b.status === "cashout") b.cashout = Math.round(b.stake * (0.4 + rnd() * 1.1) * 100) / 100;
    if (b.status === "void") b.settledBy = "manual";
    b.settledAt = b.status === "void" ? undefined : `${iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + (rnd() < 0.15 ? 1 : 0)))}`;
    bets.push(b);
  }
}
// a few open bets, entered by hand (no event id, so the page never tries to auto-settle them)
const open = [["fanduel", "nfl", "ml", "Bills ML vs Ravens", 120, 50], ["draftkings", "nba", "prop", "Jayson Tatum over 27.5 points", -115, 25], ["hardrock", "nhl", "total", "Rangers @ Leafs over 6", -105, 20], ["draftkings", "ncaaf", "spread", "Texas -6.5 vs Georgia", -110, 40]];
open.forEach(([book, lg, type, sel, odds, stake], j) => bets.push({ id: `ex-open-${j + 1}`, createdAt: `2026-10-26T1${j}:00:00Z`, date: "2026-10-26", book, type, league: lg, eventText: sel.split(" ").slice(0, 3).join(" "), selection: sel, odds, stake, status: "pending", manual: true }));
bets.forEach(b => Object.keys(b).forEach(k => b[k] === undefined && delete b[k]));
fs.writeFileSync(new URL("./fixtures/stats-bets.json", import.meta.url), JSON.stringify({ _note: "EXAMPLE data for local previews/screenshots only (generated by scripts/gen_stats_fixture.mjs). Not real bets; never synced.", bets }, null, 1) + "\n");
console.log("wrote", bets.length, "example bets");
