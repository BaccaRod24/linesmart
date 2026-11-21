// Top 25 tab: CFP when that poll is present, AP otherwise. No browser, no network, no Odds API.
// Run: env -u ODDS_API_KEY node scripts/ncaaf_top25_test.mjs
import { readFileSync } from "fs";

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) fails.push(msg); };

const app = readFileSync(new URL("../site/assets/app.js", import.meta.url), "utf8");
const grab = name => {
  const start = app.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const rest = app.slice(start + 1);
  const m = rest.match(/\n  (?:async )?function /);
  return app.slice(start, m ? start + 1 + m.index : app.length);
};
const top25Poll = new Function(`${grab("top25Poll")}\nreturn top25Poll;`)();
const stampApRank = new Function(`${grab("stampApRank")}\nreturn stampApRank;`)();

const team = (rank, id, name) => ({ rank, id, name, abbr: name.slice(0, 3).toUpperCase() });
const cfp = { name: "Playoff Committee Rankings", teams: [team(21, "2579", "South Carolina Gamecocks"), team(22, "201", "Oklahoma Sooners"), team(1, "61", "Georgia Bulldogs")] };
const ap = { name: "AP Top 25", teams: [team(1, "61", "Georgia Bulldogs"), team(22, "2335", "Liberty Flames"), team(24, "235", "Memphis Tigers")] };

const both = top25Poll({ ap, cfp });
check(both.poll === cfp && both.label === "Playoff Top 25", "a non-empty CFP poll is the Top 25 source");
const onlyAp = top25Poll({ ap, cfp: { teams: [] } });
check(onlyAp.poll === ap && onlyAp.label === "AP Top 25", "an empty CFP poll falls back to AP");
check(top25Poll({ ap }).poll === ap && top25Poll({ cfp: null, ap }).label === "AP Top 25", "a missing CFP poll falls back to AP");
check(top25Poll(null).poll === null && top25Poll({}).label === "AP Top 25", "no polls leaves the AP wording and no teams");

const byId = new Map(cfp.teams.map(t => [String(t.id), t]));
const game = (id, name, rank) => ({ id, name, rank });
const stamped = stampApRank({
  home: game("201", "Oklahoma Sooners", 99),
  away: game("245", "Texas A&M Aggies", 7),
}, byId);
check(stamped.home.rank === 22 && stamped.away.rank === null, "badges use the selected poll and drop a rank from the other poll");
check(stamped.home.name === "Oklahoma Sooners" && stamped.away.name === "Texas A&M Aggies", "stamping a rank keeps the rest of the team");

const block = app.slice(app.indexOf("if (filter === \"top25\")"), app.indexOf("if (filter === \"standings\")"));
check(block.includes("top25.poll") && block.includes("poll.teams") && !block.includes("rankDoc.ap"), "the tab filters and badges from the selected poll");
check(app.includes("${top25.label} games this week"), "the sub line names whichever poll the tab is using");
check(!/the-odds-api|ODDS_API_KEY/.test(grab("top25Poll") + grab("stampApRank")), "the Top 25 poll choice does not call the Odds API");

if (fails.length) { console.log(`FAIL ncaaf_top25: ${fails.length} failed`); process.exit(1); }
console.log("PASS ncaaf_top25");
