// UFC front-end unit tests: My Bets grading for MMA (bets-core.js) and the pure helpers in ufc.js. No browser needed.
// Usage: node scripts/ufc_test.mjs
import { createRequire } from "module";
import fs from "fs";
import vm from "vm";
const require = createRequire(import.meta.url);
const C = require("../site/assets/bets-core.js");
const fails = [];
const check = (ok, msg, tag = "ufc") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };
const fin = o => ({ completed: true, status: "STATUS_FINAL", ...o });
const G = (sel, f) => C.gradeSelection({ league: "ufc", ...sel }, f);

// ---------- grading (bout scores are 1/0 for the winner; total = elapsed rounds)
check(C.MMA && C.MMA.has("ufc"), "ufc is an MMA league", "grade");
check(G({ type: "ml", side: "away" }, fin({ away: 1, home: 0 })) === "won", "ML on the winner wins", "grade");
check(G({ type: "ml", side: "home" }, fin({ away: 1, home: 0 })) === "lost", "ML on the loser loses", "grade");
check(G({ type: "ml", side: "home" }, fin({ away: 0, home: 0 })) === "push", "draw / no contest (0-0) pushes the ML", "grade");
check(G({ type: "total", side: "over", line: 1.5 }, fin({ away: 1, home: 0, rounds: 1.98 })) === "won", "over 1.5 rounds: R2 4:54 finish wins", "grade");
check(G({ type: "total", side: "under", line: 1.5 }, fin({ away: 1, home: 0, rounds: 1.98 })) === "lost", "under 1.5 rounds: R2 4:54 finish loses", "grade");
check(G({ type: "total", side: "under", line: 2.5 }, fin({ away: 1, home: 0, rounds: 1.98 })) === "won", "under 2.5 rounds wins", "grade");
check(G({ type: "total", side: "over", line: 2.5 }, fin({ away: 0, home: 1, rounds: 3 })) === "won", "decision (3 rounds) goes over 2.5", "grade");
check(G({ type: "total", side: "over", line: 1.5 }, fin({ away: 1, home: 0 })) === null, "no rounds data -> manual", "grade");
check(G({ type: "spread", side: "away", line: -1.5 }, fin({ away: 1, home: 0, rounds: 2 })) === null, "no spreads in MMA -> manual", "grade");
check(G({ type: "ml", side: "away" }, { completed: false, away: 0, home: 0 }) === null, "unfinished bout stays pending", "grade");
// regression: a non-MMA total still grades on points
check(C.gradeSelection({ league: "nfl", type: "total", side: "over", line: 40.5 }, fin({ away: 21, home: 24 })) === "won", "NFL totals unchanged", "grade");

// ---------- ufc.js pure helpers (loaded in a vm with a window stub)
const ctx = { window: { SITE_CONFIG: {} }, document: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../site/assets/ufc.js", import.meta.url), "utf8"), ctx);
const U = ctx.window.LSUfc;
check(U && typeof U.league === "function" && typeof U.fight === "function" && typeof U.fighter === "function", "LSUfc exports views", "helpers");
const hist = [
  { res: "W", opp: "Beneil Dariush", method: "KO/TKO", round: 1, clock: "4:05", date: "2026-08-01" },
  { res: "L", opp: "Islam Makhachev", method: "Submission", round: 1, clock: "4:05", date: "2026-04-01" },
  { res: "D", opp: "X Y", date: "2026-01-01" },
  { res: "NC", opp: "A B" }, { res: "W", opp: "C D" }, { res: "W", opp: "E F" }];
const s = U.strip(hist);
check(s.length === 5, "strip keeps the last 5", "helpers");
check(s.map(b => b.cls).join() === "pp-o,pp-u,pp-p,pp-p,pp-o", "W green / L red / D,NC grey (props strip classes)", "helpers");
check(s[0].opp === "Dariush" && /Win vs Beneil Dariush · KO\/TKO · R1 4:05 · 2026-08-01/.test(s[0].tip), "strip label + tooltip", "helpers");
const t = U.tally(hist);
check(t.W === 2 && t.L === 1 && t.D === 2, "tally of last 5 (D includes NC)", "helpers");
const g = { state: "post", away: { short: "A. Volkanovski", name: "Alexander Volkanovski" }, home: { short: "M. Evloev" },
  result: { winner: "away", outcome: "win", method: "KO/TKO", detail: "Punches", round: 2, clock: "4:54" } };
check(U.resultLine(g) === "A. Volkanovski wins · KO/TKO · Punches · R2 4:54", "result line", "helpers");
check(U.resultLine({ ...g, result: { outcome: "draw", method: "Decision - Majority", round: 3, clock: "5:00" } }) === "Draw · Decision - Majority · R3 5:00", "draw result line", "helpers");
check(U.resultLine({ ...g, result: { outcome: "nc", method: "No Contest", detail: "Overturned" } }) === "No contest · Overturned", "no-contest result line", "helpers");
check(U.resultLine({ ...g, state: "pre" }) === "", "no result before the fight", "helpers");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall ufc front-end tests passed");
process.exit(fails.length ? 1 : 0);
