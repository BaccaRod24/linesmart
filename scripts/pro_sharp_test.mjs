// Where the Pro Sharp bubble is allowed to appear, and that every game keeps one slot.
// No network, no Odds API, no Pro account.
// Usage: env -u ODDS_API_KEY node scripts/pro_sharp_test.mjs
import { createRequire } from "module";
import fs from "fs";

const require = createRequire(import.meta.url);
const F = require("../pro/pro-features.js");
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} sharp: ${msg}`); if (!ok) fails.push(msg); };
const ui = fs.readFileSync("pro/pro-ui.js", "utf8");
const css = fs.readFileSync("pro/pro.css", "utf8");
const hist = fs.readFileSync("scripts/line_history.py", "utf8");

const slate = ui.slice(ui.indexOf("function slateSlot"), ui.indexOf("function watchApp"));
check(/function enhanceSlate/.test(slate) && !/if \(!pub\) return/.test(slate), "every slate card gets a Sharp slot, including one with no public chip");
check(/sharpSlot\(/.test(slate), "the slot uses the shared sharp rule");
check(/pro-sharp-empty/.test(slate) && /slot\.label/.test(slate), "an empty game uses the same bubble and the slot's own label");
check(/className = "pro-sharp pro-frame"/.test(slate), "the bubble keeps the emerald sharp classes");
check(/data-pro-badge/.test(slate), "the slot is marked so a later paint does not add a second one");

check(/a\.game \.pro-sharp\{position:absolute;top:46px;right:16px/.test(css), "the bubble is pinned under the kickoff line, at the card's right padding");
check(/a\.game:has\(\.pro-sharp\) \.game-top\{margin-bottom:40px\}/.test(css), "every card with a slot leaves that corner clear");
check(!/\.game-top:has\(\.pro-sharp\)\{flex-wrap:wrap/.test(css), "the header no longer wraps the bubble onto a random line");
check(/white-space:nowrap/.test(css.slice(css.indexOf("a.game .pro-sharp"))), "the label stays one line so the corner height does not change");
check(/\.pro-sharp\{[^}]*-webkit-backdrop-filter:saturate\(170%\) blur\(12px\)/.test(css) || /pro-sharp,[\s\S]{0,500}-webkit-backdrop-filter:saturate\(170%\) blur\(12px\)/.test(css), "emerald glass blur still applies to the bubble");

check(/abs\(sp\["delta"\]\) >= 1\.5/.test(hist), "football and basketball spreads flag at 1.5 points");
check(/for k in \(3, 7\)/.test(hist), "NFL and NCAAF also flag a cross of 3 or 7");
check(/"football": 2, "basketball": 3/.test(hist), "totals flag at 2 points in football and 3 in basketball");
check(/BOOK_ORDER = \["draftkings", "hardrockbet", "fanduel"\]/.test(hist), "the note is the primary book, DraftKings then Hard Rock Bet then FanDuel");

const flagged = F.sharpSlot({ state: "pre", move: { notable: ["Spread moved 2 pts"], spread: { delta: 2 } }, odds: { homeSpread: -3 } }, "football", "nfl");
check(flagged.show === "sharp" && flagged.label === "Sharp" && flagged.why === "Spread moved 2 pts", "a pre-game note is the Sharp bubble");
const live = F.sharpSlot({ state: "in", move: { notable: ["Spread moved 2 pts"] } }, "football", "nfl");
check(live.show === "empty" && /have not started/.test(live.why) && /live/.test(live.why), "a live game explains that flags are only before the start");
const done = F.sharpSlot({ state: "post", odds: { homeSpread: -3 } }, "football", "nfl");
check(done.show === "empty" && /finished/.test(done.why), "a finished game explains that it is finished");
const quiet = F.sharpSlot({ state: "pre", move: { spread: { delta: 0.5 }, notable: [] }, odds: { homeSpread: -3 } }, "football", "nfl");
check(quiet.show === "empty" && quiet.label === "No flag" && /1\.5 points/.test(quiet.why) && /cross of 3 or 7/.test(quiet.why) && /2 points/.test(quiet.why), "a small NFL move names the flag bars");
const hoops = F.sharpSlot({ state: "pre", odds: { total: 220 }, move: { total: { delta: 1 }, notable: [] } }, "basketball", "nba");
check(hoops.show === "empty" && /3 points/.test(hoops.why) && !/cross of 3 or 7/.test(hoops.why), "an NBA total names 3 points and does not mention football key numbers");
const blank = F.sharpSlot({ state: "pre" }, "hockey", "nhl");
check(blank.show === "empty" && /No line is stored/.test(blank.why), "a game with no line says there is nothing to flag");
const same = [flagged, live, quiet, blank].every(s => s.label === "Sharp" || s.label === "No flag");
check(same, "every slot uses one of the two labels");

const guide = F.proGuide();
const flat = [...guide.includes, ...guide.updates, ...guide.down].join(" ");
check(guide.includes.length >= 5 && /Hard Rock Bet, DraftKings, and FanDuel/.test(flat), "the guide names the three books the code reads");
check(/every 30 minutes/.test(flat) && /every 2 hours/.test(flat) && /36 hours/.test(flat), "the guide states the 30-minute refresh and the 2-hour props window");
check(/60, 90, 120, 180, 240, or 360/.test(flat), "the guide states the slowed game-line steps");
check(/18 hours/.test(flat) && /marks them delayed/.test(flat) && /marked closed/.test(flat), "the guide states last-good ESPN data and a closed book after the start");
check(/does not call the odds provider/.test(flat) && /25 active line alerts/.test(flat) && /5 a day/.test(flat), "the guide states no odds call, 25 active alerts, and the email cap");
check(!/stripe|checkout|payment provider/i.test(flat), "the guide does not invent a checkout");

const propRows = (ui.match(/class="ppv-line pro-prop"/g) || []).length;
check(propRows >= 7, "hot props, the game prop panel, and prop edges use the prop class (" + propRows + ")");
check(/function playerGroups/.test(ui) && /class="ppv-player"/.test(ui) && /ppv-player-team/.test(ui), "hot props and the props panel group rows under a player header");
check((ui.match(/playerGroups\(/g) || []).length >= 6, "price gaps, line moves, and hot streaks group players on the screen and the panel");
const propCss = css.slice(css.indexOf(".ppv-line.pro-prop{"), css.indexOf(".ppv-line.pro-prop .num{") + 80);
check(/0 0 14px -3px rgba\(16,185,129,\.55\)/.test(propCss), "prop rows use the Sharp bubble glow");
check(/linear-gradient\(135deg,#d4ffe8/.test(propCss), "prop rows use the Sharp gradient edge");
check(/border-radius:8px/.test(propCss), "prop rows use a tighter corner than the old soft card");
check(/0 0 0 1px rgba\(16,185,129/.test(propCss), "prop rows use a 1px edge");
check(/backdrop-filter:saturate\(160%\) blur\(8px\)/.test(propCss), "prop rows keep a shorter frosted blur");
const bubbles = css.slice(css.indexOf(".pp-card .pp-b{"));
const bubbleBase = css.slice(css.indexOf(".pp-card .pp-b{"), css.indexOf(".pp-card .pp-b.pp-o"));
const miss = css.slice(css.indexOf(".pp-card .pp-b.pp-u{"), css.indexOf(".pp-card .pp-b.pp-p"));
const missDay = (css.split(':root[data-theme="daylight"] .pp-card .pp-b.pp-u{')[1] || "").split("}")[0];
check(/border:1px solid rgba\(16,185,129/.test(bubbleBase) && /0 0 14px -3px rgba\(16,185,129,\.55\)/.test(bubbleBase), "last-5 hits use a 1px emerald edge and the Pro glow");
check(!/inset:-1px/.test(bubbleBase) && !/inset 0 1px 0/.test(bubbleBase), "last-5 corners are not shifted by an outset ring or a top-only inset");
check(/\.pp-card \.pp-l5\{[^}]*padding:/.test(css), "the last-5 row is padded so the glow is not clipped");
check(/1px solid rgba\(251,113,133/.test(miss), "misses use a rose edge");
check(/0 0 14px -3px rgba\(244,63,94/.test(miss), "misses use a rose glow with 0 0 offsets");
check(/rgba\(255,214,220,\.18\),rgba\(244,63,94,\.14\)/.test(miss), "miss centers are a light frosted rose, not a solid fill");
check(!/16,185,129|#10b981|#5eead4|#d4ffe8|#881337/.test(miss), "misses do not keep an emerald edge or a solid rose fill");
check(/rgba\(244,63,94/.test(missDay) && !/16,185,129/.test(missDay), "daylight misses stay rose");
check(/backdrop-filter:saturate\(160%\) blur\(4px\)/.test(bubbles), "last-5 bubbles keep a short frosted blur");
check(!/#22c55e|#34d399/.test(propCss + bubbles), "the Pro prop treatment stays off the win greens");
check(!/\.hc-prop/.test(css), "the free homepage hot-props strip is not restyled from Pro CSS");
const freeCss = fs.readFileSync("site/assets/styles.css", "utf8");
const freeProps = fs.readFileSync("site/assets/props.js", "utf8");
check(!/\.pro-prop|0 0 14px -3px rgba\(16,185,129/.test(freeCss), "the free stylesheet does not pick up the Pro glow");
const freeSep = freeCss.slice(freeCss.indexOf(".ps-prop-g .pp-players{"), freeCss.indexOf(".pp-player-rule[hidden]") + 40);
check(/pp-players/.test(freeProps) && /pp-player-rule/.test(freeProps) && /\.pp-player-rule\{border:0/.test(freeCss), "today's prop lines separate players with a header rule and a divider");
check(!/16,185,129|0 0 14px|backdrop-filter/.test(freeSep), "the free player divider has no Pro glow or edge");
check(/\.hc-prop \.pp-b\{width:27px/.test(freeCss) && /\.pp-o\{background:color-mix\(in srgb,var\(--win\)/.test(freeCss), "free hot-props bubbles and hit colors stay the site greens");

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);
