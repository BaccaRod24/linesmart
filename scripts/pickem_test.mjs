// Unit tests for the pick'em note rule (site/assets/pickem-core.js). No browser or network needed.
// Usage: node scripts/pickem_test.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const P = require("../site/assets/pickem-core.js");
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} pickem: ${msg}`); if (!ok) fails.push(msg); };
const bk = (as, extra = {}) => ({ awaySpread: as, homeSpread: as === null ? null : -as, awayML: -110, homeML: -110, ...extra });

// MEM @ UTAH, Oct 26 2026 (live data at the 23:45Z pull): DK has UTAH -1.5, Hard Rock + FanDuel have MEM -1.5
const memUtah = { books: {
  draftkings: { awayML: -110, awaySpread: 1.5, awaySpreadOdds: -120, homeML: -110, homeSpread: -1.5, homeSpreadOdds: 100 },
  fanduel: { awayML: -108, awaySpread: -1.5, awaySpreadOdds: -105, homeML: -108, homeSpread: 1.5, homeSpreadOdds: -115 },
  hardrockbet: { awayML: -110, awaySpread: -1.5, awaySpreadOdds: -105, homeML: -110, homeSpread: 1.5, homeSpreadOdds: -115 } } };
const before = JSON.stringify(memUtah);
const s = P.split(memUtah, "basketball");
check(!!s, "MEM @ UTAH is flagged");
check(s && s.away.map(x => x.book).join() === "hardrockbet,fanduel" && s.away.every(x => x.line === -1.5), "away favorites: Hard Rock Bet, FanDuel at -1.5");
check(s && s.home.length === 1 && s.home[0].book === "draftkings" && s.home[0].line === -1.5, "home favorite: DraftKings, home -1.5");
check(JSON.stringify(memUtah) === before, "line data is not modified");

// LV @ NYJ: Hard Rock LV -1, DK/FD LV +1.5 (football, half-point vs whole-point lines)
check(!!P.split({ books: { draftkings: bk(1.5), fanduel: bk(1.5), hardrockbet: bk(-1) } }, "football"), "LV @ NYJ (-1 vs +1.5) is flagged");

// not flagged
check(P.split({ books: { draftkings: bk(-1.5), fanduel: bk(-1.5), hardrockbet: bk(-2.5) } }, "basketball") === null, "same favorite everywhere: no note");
check(P.split({ books: { draftkings: bk(3.5), fanduel: bk(-1.5) } }, "basketball") === null, "a book outside 2.5 points: no note (not a pick'em)");
check(P.split({ books: { draftkings: bk(1.5) } }, "basketball") === null, "one book only: no note");
check(P.split({ books: { draftkings: bk(1.5), fanduel: { stale: true, awaySpread: null } } }, "basketball") === null, "stale book ignored -> one book: no note");
check(P.split({ books: { draftkings: bk(1.5), fanduel: bk(-1.5, { stale: true }) } }, "basketball") === null, "stale book's old numbers are never used");
check(P.split({ books: { draftkings: bk(0), fanduel: bk(-1.5) } }, "basketball") === null, "pick (0) counts for neither side");
check(P.split({ books: { draftkings: bk(1.5), fanduel: bk(-1.5) } }, "soccer") === null, "soccer has no spread market: no note");
check(P.split({ books: { draftkings: bk(1.5), fanduel: bk(-1.5) } }, "mma") === null, "mma: no note");
check(P.split({}, "football") === null && P.split(null, "football") === null, "no books / no game: no note");
check(P.split({ books: { draftkings: { awaySpread: null, homeSpread: null }, fanduel: bk(-1.5) } }, "football") === null, "book with no spread posted is skipped");

// edges
check(!!P.split({ books: { draftkings: bk(2.5), fanduel: bk(-2.5) } }, "basketball"), "exactly 2.5 each way is flagged");
check(!!P.split({ books: { draftkings: { homeSpread: -1.5 }, fanduel: { homeSpread: 1.5 } } }, "hockey"), "homeSpread-only records work (puck line)");
check(P.awayLine({ homeSpread: 1.5 }) === -1.5 && P.awayLine({ awaySpread: 2 }) === 2 && P.awayLine(null) === null, "awayLine fallbacks");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall pickem tests passed");
process.exit(fails.length ? 1 : 0);
