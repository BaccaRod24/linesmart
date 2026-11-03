// Where the Pro Sharp bubble is allowed to appear, and that it stays in one corner.
// No network, no Odds API, no Pro account.
// Usage: env -u ODDS_API_KEY node scripts/pro_sharp_test.mjs
import fs from "fs";

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} sharp: ${msg}`); if (!ok) fails.push(msg); };
const ui = fs.readFileSync("pro/pro-ui.js", "utf8");
const css = fs.readFileSync("pro/pro.css", "utf8");
const hist = fs.readFileSync("scripts/line_history.py", "utf8");

const slate = ui.slice(ui.indexOf("function enhanceSlate"), ui.indexOf("function watchApp"));
check(/if \(!pub\) return/.test(slate), "a card with no public line-move chip gets no Sharp bubble");
check(/querySelector\("\.mvbadge"\)/.test(slate), "the bubble follows the public line-move chip");
check(/className = "pro-sharp pro-frame"/.test(slate), "the bubble keeps the emerald sharp classes");
check(/pub\.getAttribute\("title"\)/.test(slate), "the bubble keeps the move note from the public chip");

check(/a\.game \.pro-sharp\{position:absolute;top:46px;right:16px/.test(css), "the bubble is pinned under the kickoff line, at the card's right padding");
check(/a\.game:has\(\.pro-sharp\) \.game-top\{margin-bottom:40px\}/.test(css), "the header leaves that corner clear");
check(!/\.game-top:has\(\.pro-sharp\)\{flex-wrap:wrap/.test(css), "the header no longer wraps the bubble onto a random line");
check(/\.pro-sharp\{[^}]*-webkit-backdrop-filter:saturate\(170%\) blur\(12px\)/.test(css) || /pro-sharp,[\s\S]{0,400}-webkit-backdrop-filter:saturate\(170%\) blur\(12px\)/.test(css), "emerald glass blur still applies to the bubble");

check(/abs\(sp\["delta"\]\) >= 1\.5/.test(hist), "football and basketball spreads flag at 1.5 points");
check(/for k in \(3, 7\)/.test(hist), "NFL and NCAAF also flag a cross of 3 or 7");
check(/"football": 2, "basketball": 3/.test(hist), "totals flag at 2 points in football and 3 in basketball");
check(/BOOK_ORDER = \["draftkings", "hardrockbet", "fanduel"\]/.test(hist), "the note is the primary book, DraftKings then Hard Rock Bet then FanDuel");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);
