// Futures tab render. Offline: no browser, no Odds API.
//   env -u ODDS_API_KEY node scripts/futures_ui_test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
delete process.env.ODDS_API_KEY;
const C = require("../site/assets/futures-core.js");

let fail = 0;
const check = (ok, msg) => { if (ok) console.log("PASS " + msg); else { fail++; console.log("FAIL " + msg); } };
const read = f => fs.readFileSync(f, "utf8");

const nfl = {
  v: 1, league: "nfl", updated: "2026-11-28T14:42:45Z",
  markets: [{
    key: "americanfootball_nfl_super_bowl_winner", title: "NFL Super Bowl Winner", subject: "team",
    lastUpdate: "2026-11-28T14:42:45Z", hardrock: false, books: ["draftkings", "fanduel"],
    outcomes: [{
      name: "San Francisco 49ers", draftkings: 430, fanduel: 460, hardrockbet: null,
      best: 460, bestBook: "fanduel", implied: Math.round(C.implied(460) * 1000) / 10,
      open: 460, openBook: "fanduel", openDraftkings: 430, openFanduel: 460, move: 0,
      firstRecorded: "2026-11-28T14:42:45Z", firstDraftkings: "2026-11-28T14:42:44Z", firstFanduel: "2026-11-28T14:42:45Z",
    }, {
      name: "Buffalo Bills", draftkings: 470, fanduel: 470, hardrockbet: null,
      best: 470, bestBook: "draftkings", implied: Math.round(C.implied(470) * 1000) / 10,
      open: 470, move: 0, firstRecorded: "2026-11-28T14:42:44Z",
    }],
  }],
};
const FL = { status: "ok", state: "FL", stateName: "Florida", available: ["hardrockbet"], unavailable: ["draftkings", "fanduel", "betmgm"] };
const NJ = { status: "ok", state: "NJ", stateName: "New Jersey", available: ["hardrockbet", "draftkings", "fanduel"], unavailable: [] };
const NH = { status: "ok", state: "NH", stateName: "New Hampshire", available: ["draftkings"], unavailable: ["hardrockbet", "fanduel", "betmgm"] };

const fl = C.page(nfl, { league: "nfl", full: "National Football League", geo: FL, seg: `<div class="seg"><a class="on">Futures</a></div>` });
check(fl.includes("Hard Rock Bet is the only legal online sportsbook in Florida."), "FL note names Hard Rock Bet as the only legal online sportsbook");
check(fl.includes("Hard Rock Bet futures aren't in our odds feed yet, so DraftKings and FanDuel prices are shown for reference only."), "FL note keeps DraftKings and FanDuel as reference");
check(!/DraftKings (is|are) legal|FanDuel (is|are) legal|legal in Florida/i.test(fl), "FL copy does not say DraftKings or FanDuel are legal there");
check(!fl.includes('class="num best"') && fl.includes("fu-ref") && fl.includes(">Reference<"), "FL does not highlight a bettable best; the column is labeled Reference");
check(fl.includes("+430") && fl.includes("+460") && fl.includes("San Francisco 49ers"), "FL still shows the discovery DraftKings and FanDuel prices");
check(fl.includes("17.9%"), "implied percent is the better price (+460)");

const nj = C.page(nfl, { league: "nfl", full: "National Football League", geo: NJ });
check(nj.includes('class="num best"') && !nj.includes("only legal online sportsbook in Florida"), "NJ highlights a best price and does not show the Florida note");
check((nj.match(/class="num best"/g) || []).length >= 2, "NJ highlights the best column and the FanDuel cell");
check(!/Florida:/.test(nj), "a non-FL visitor does not get the Florida note");

const nh = C.page(nfl, { league: "nfl", full: "National Football League", geo: NH });
check(nh.includes("FanDuel isn't available in New Hampshire"), "NH uses the normal not-available note");
check(nh.includes('class="num best"') && nh.includes("+430"), "NH highlights the DraftKings price, the book that is legal there");
const fdCell = nh.split("FanDuel")[1] || "";
check(/na-col/.test(nh) && !nh.includes("FanDuel prices are shown for reference only."), "NH dims the unavailable book instead of the Florida reference label");

const empty = C.page({ league: "mls", markets: [] }, { league: "mls", full: "Major League Soccer", geo: NJ });
check(empty.includes("No futures odds available for this league in our feed right now."), "a league with no feed says so");
check(!empty.includes("+430"), "the empty state does not invent prices");

const golf = C.page({
  league: "golf", markets: [{
    key: "golf_masters_tournament_winner", title: "Masters Tournament Winner", subject: "player",
    outcomes: [{ name: "Scottie Scheffler", draftkings: 400, fanduel: 370, best: 400, bestBook: "draftkings", implied: Math.round(C.implied(400) * 1000) / 10, open: 400, move: 0 }],
  }, { key: "golf_the_open_championship_winner", title: "The Open Winner", subject: "player", outcomes: [] }],
}, { league: "golf", geo: NJ });
check(golf.includes("Golf isn't a league hub") && golf.includes("Scottie Scheffler") && golf.includes("+400") && golf.includes("Player"), "golf majors render under their own section, players not teams");
check(golf.includes("No futures odds available for The Open Winner in our feed right now."), "a major with no posted books says so");

check(!/\b(free bets?|risk[- ]free|guaranteed|bonus bets?|no[- ]sweat|free plays?|my pick|best bet)\b/i.test(fl + nj + golf + empty), "no promo wording and no picks");

const idx = read("site/index.html");
const bnav = (idx.match(/<nav class="bnav"[\s\S]*?<\/nav>/) || [""])[0];
check((bnav.match(/data-nav="/g) || []).length === 8 && !/Futures/.test(bnav), "bottom nav stays at 8 items and has no Futures item");
const app = read("site/assets/app.js");
check(app.includes('href="#/l/${key}/futures"') && app.includes(">Futures</a>"), "leagueSeg adds a Futures segment");
check(read("site/assets/load.js").includes('if (k === "l" && parts[1] === "ufc") return ["ufc"];'), "UFC route group is unchanged for the non-futures tabs");
check(read("site/sw.js").includes('"assets/futures-core.js"') && read("site/sw.js").includes('"assets/futures.js"'), "service worker precaches the futures scripts");
const foot = idx.slice(idx.indexOf('<footer class="footer"'));
check(/age-pill">21\+</.test(foot) && /1-800-GAMBLER/.test(foot) && /1-833-PLAYWISE/.test(foot) && /1-888-ADMIT-IT/.test(foot), "footer 21+ notice and helplines stay");
check(read("site/assets/site.js").includes('aff-tag">Ad'), "Ad label stays");

console.log(fail ? `\nFAIL futures ui: ${fail}` : "\nPASS futures ui");
process.exit(fail ? 1 : 0);
