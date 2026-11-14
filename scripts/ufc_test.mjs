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

// ---------- public rankings tab (separate from Pro rankings)
ctx.window.LSApp = { fullET: s => "FULL " + s, timeET: s => "T " + s };
const rankData = { league: { full: "UFC (Mixed Martial Arts)" }, report: { upcoming: 2, withOdds: 1, providers: ["DraftKings"] }, events: [], games: [], windowDays: 45 };
const rankHtml = U.league(rankData, "ufc", "rankings");
check(rankHtml.includes("Upcoming & live") && rankHtml.includes("Incl. recent results") && rankHtml.includes(">Rankings<"), "rankings tab sits with the existing UFC tabs", "rankings");
check(rankHtml.includes('id="ufRank"') && !rankHtml.includes('class="bout"'), "rankings view does not render fight cards", "rankings");
const cardsHtml = U.league(rankData, "ufc", "upcoming");
check(cardsHtml.includes("Upcoming & live") && cardsHtml.includes("No UFC cards") && cardsHtml.includes("ESPN's MMA feeds"), "upcoming tab still renders cards", "rankings");
check(U.slugify("Jiří Procházka") === "jiri-prochazka" && U.slugify("Sean O'Malley") === "sean-o-malley", "fighter slugs match the page slugs", "rankings");
const paths = U.pathsFromPages({ p: { ufc: { "11": "ufc/fighters/islam-makhachev/", "22": "javascript:alert(1)", "33": "ufc/fighters/not a slug/" } } });
check(U.fighterHref({ name: "Islam Makhachev" }, paths) === "ufc/fighters/islam-makhachev/", "a fighter with a page links to it", "rankings");
check(U.fighterHref({ id: "11", name: "Someone Else" }, paths) === "ufc/fighters/islam-makhachev/", "an ESPN id on the page map links even when the name differs", "rankings");
check(U.fighterHref({ name: "No Page Fighter", slug: "no-page" }, paths) === "", "a fighter without a page is not a link", "rankings");
check(!paths.byId["22"] && !paths.bySlug["not"], "only real fighter paths are linkable", "rankings");
const doc = { updated: "2026-11-14T11:52:48Z", divisions: [
  { key: "mens-p4p", name: "Men's Pound-for-Pound", short: "Men's P4P", kind: "p4p", ranks: [{ rank: 1, name: "Islam Makhachev" }, { rank: 2, name: "No Page Fighter" }] },
  { key: "heavyweight", name: "Heavyweight", short: "Heavyweight", kind: "division", champion: { name: "Ciryl Gane", slug: "ciryl-gane" }, interim: { name: "Interim Heavy" }, ranks: [{ rank: 1, name: "Tom Aspinall", change: -1 }, { rank: 2, name: "New Fighter", change: "nr" }] },
] };
const view = U.rankingsView(doc, paths);
check(view.includes("As of FULL 2026-11-14T11:52:48Z"), "rankings show an as-of time", "rankings");
check(view.includes('href="ufc/fighters/islam-makhachev/"') && view.includes("No Page Fighter") && !view.includes('href="">No Page') && !/>No Page Fighter<\/a>/.test(view), "only the fighter with a page is a link", "rankings");
check(U.rankingsView({ divisions: [] }, paths).includes("Rankings not available"), "an empty file says rankings are not available", "rankings");
const board = U.divisionBoard(doc.divisions[1], paths);
check(board.includes("Champion") && board.includes("Ciryl Gane") && board.includes("Interim champion") && board.includes("Interim Heavy"), "a division shows the champion and interim champion", "rankings");
check(board.includes(">1<") && board.includes("down 1") && board.includes("NR"), "ranks show the number and the movement", "rankings");
check(!/best bet|lock of|guaranteed|legal in florida|FanDuel are legal|DraftKings are legal/i.test(view + board), "rankings copy has no picks and no Florida book claim", "rankings");
const loadSrc = fs.readFileSync(new URL("../site/assets/load.js", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../site/sw.js", import.meta.url), "utf8");
check(loadSrc.includes('if (k === "l" && parts[1] === "ufc") return ["ufc"]'), "the UFC route, including rankings, stays on the ufc script group", "rankings");
check(sw.includes('"assets/ufc.js"') && !sw.includes("ufc-rankings.js"), "rankings stay in the precached ufc.js", "rankings");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall ufc front-end tests passed");
process.exit(fails.length ? 1 : 0);
