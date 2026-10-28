// Unit tests for the weekly email: signup validation (site/assets/news-core.js) and email selection/rendering
// (scripts/newsletter_lib.mjs). No network, no sending. Usage: node scripts/newsletter_test.mjs
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const N = require("../site/assets/news-core.js");
const L = await import("./newsletter_lib.mjs");
const fails = [];
const check = (ok, msg, tag = "news") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };
const rd = p => fs.readFileSync(new URL(p, import.meta.url), "utf8");

// ---------------------------------------------------------------- signup validation
{
  const T = "signup";
  check(N.SB_KEY.startsWith("sb_publishable_") && !/sb_secret_|service_role/.test(rd("../site/assets/news-core.js") + rd("../site/assets/news.js")), "publishable key only, no secret in client code", T);
  check(N.validEmail("fan@example.com") && N.validEmail("  Fan@Example.COM ") && !N.validEmail("fan@") && !N.validEmail("a b@c.com") && !N.validEmail("x@y.c") && !N.validEmail(""), "email rules", T);
  check(!N.validEmail("a".repeat(250) + "@x.com"), "over 254 chars rejected", T);
  let r = N.validate({ email: "", age: true });
  check(!r.ok && r.field === "email", "empty email -> email error", T);
  r = N.validate({ email: "nope", age: true });
  check(!r.ok && r.field === "email" && /doesn't look right/.test(r.error), "bad email -> email error", T);
  r = N.validate({ email: "fan@example.com", age: false });
  check(!r.ok && r.field === "age" && /21/.test(r.error), "21+ box is required", T);
  r = N.validate({ email: "fan@example.com", age: "on" });
  check(!r.ok && r.field === "age", "21+ must be a real boolean true", T);
  r = N.validate({ email: " Fan@Example.com ", age: true, source: "footer" });
  check(r.ok && !r.bot && r.payload.p_email === "fan@example.com" && r.payload.p_age_ok === true && r.payload.p_website === "" && r.payload.p_source === "footer", "valid -> lowercased payload", T);
  check(N.validate({ email: "fan@example.com", age: true, source: "evil" }).payload.p_source === "site", "unknown source -> site", T);
  r = N.validate({ email: "", age: false, website: "http://spam" });
  check(r.ok && r.bot && !r.payload, "honeypot filled -> fake success, nothing sent", T);
  r = N.validate({ email: "fan@example.com", age: true, now: 100000, last: 90000 });
  check(!r.ok && /wait/.test(r.error), "client cooldown between submits", T);
  check(N.validate({ email: "fan@example.com", age: true, now: 100000, last: 100000 - N.COOLDOWN_MS - 1 }).ok, "cooldown expires", T);
  check(N.resultFor(200, "ok").kind === "ok" && /check your inbox/i.test(N.resultFor(200, "ok").text), "ok -> check inbox", T);
  check(N.resultFor(200, "rate_limited") === N.MESSAGES.rate_limited && N.resultFor(429, null) === N.MESSAGES.rate_limited, "rate limit messages", T);
  check(N.resultFor(404, null) === N.MESSAGES.unavailable && N.resultFor(0, null) === N.MESSAGES.network && N.resultFor(500, "x") === N.MESSAGES.network, "404 / offline / server error", T);
  check(N.resultFor(200, "busy").kind === "err" && N.resultFor(200, "unavailable").kind === "err" && N.resultFor(200, "nonsense") === N.MESSAGES.network, "busy / unavailable / unknown", T);
  const tok = "3F2504E0-4F89-11D3-9A0C-0305E82C3301";
  check(N.tokenFrom(`?t=${tok}`) === tok.toLowerCase() && N.tokenFrom(`?x=1&t=${tok}#a`) === tok.toLowerCase(), "token parsed from ?t=", T);
  check(N.tokenFrom("?t=abc") === "" && N.tokenFrom("") === "" && N.tokenFrom("?t=<script>") === "", "bad tokens rejected", T);
  check(N.pageResult(N.CONFIRM, 200, "confirmed").title === "You're subscribed" && N.pageResult(N.CONFIRM, 200, "expired").kind === "err" && N.pageResult(N.CONFIRM, 0, null) === N.CONFIRM.network, "confirm page states", T);
  check(N.pageResult(N.UNSUB, 200, "unsubscribed").kind === "ok" && N.pageResult(N.UNSUB, 200, "already").kind === "ok" && N.pageResult(N.UNSUB, 200, "invalid").kind === "err", "unsubscribe page states", T);
  const copy = JSON.stringify([N.MESSAGES, N.CONFIRM, N.UNSUB]) + rd("../site/assets/news.js");
  check(!L.bannedIn(copy).length, "signup copy has no banned wording", T);
  const idx = rd("../site/index.html");
  check(/data-news-signup="home"/.test(idx) && /data-news-signup="footer"/.test(idx) && /assets\/news-core\.js/.test(idx) && /assets\/news\.js/.test(idx), "homepage + footer slots and scripts", T);
  check(/data-news-signup="bets"/.test(rd("../site/assets/bets.js")), "My Bets slot", T);
  check(/Get the weekly LineSmart email: best lines, hot props, line moves\. Free\./.test(rd("../site/assets/news.js").replace(/<[^>]+>/g, "")), "signup headline copy", T);
  const sw = rd("../site/sw.js");
  check(["assets/news-core.js", "assets/news.js", "subscribed.html", "unsubscribe.html"].every(f => sw.includes(f)), "service worker caches the new files", T);
  check(/id="newsletter"/.test(rd("../site/privacy.html")) && /noindex/.test(rd("../site/unsubscribe.html")) && /data-news-page="confirm"/.test(rd("../site/subscribed.html")), "privacy section + noindex pages", T);
  const sql = rd("../supabase/migrations/20261026_newsletter.sql");
  check(/enable row level security/i.test(sql) && /revoke all on table public\.newsletter_subscribers, public\.newsletter_signup_log, public\.newsletter_settings from anon, authenticated/i.test(sql) && !/create policy/i.test(sql), "SQL: RLS on, no anon table access, no policies", T);
}

// ---------------------------------------------------------------- email selection + rendering
const NOW = "2026-10-29T13:00:00Z";
const bk = (o = {}) => ({ homeML: -150, awayML: 130, homeSpread: -3, awaySpread: 3, homeSpreadOdds: -110, awaySpreadOdds: -110, total: 45.5, overOdds: -110, underOdds: -110, source: "The Odds API", ...o });
const game = (id, date, away, home, books, extra = {}) => ({ id, date, shortName: `${away} @ ${home}`, state: "pre", away: { abbr: away, name: away }, home: { abbr: home, name: home }, books, ...extra });
const nfl = { games: [
  game("1", "2026-11-01T17:00Z", "AAA", "BBB", { draftkings: bk({ awayML: 150 }), fanduel: bk({ awayML: 165 }), hardrockbet: bk({ awayML: 155 }) },
    { move: { book: "draftkings", points: 7, spread: { open: -7, cur: -3, delta: 4 }, total: { open: 44.5, cur: 45.5, delta: 1 }, notable: ["Spread moved 4 pts", "Crossed key number 7"] } }),
  game("2", "2026-11-01T20:00Z", "CCC", "DDD", { draftkings: bk({ awaySpread: 3.5, homeSpread: -3.5 }), fanduel: bk(), hardrockbet: bk({ total: 46.5 }) }),
  game("3", "2026-10-29T00:15Z", "EEE", "FFF", { draftkings: bk({ awayML: 300 }), fanduel: bk({ awayML: 100 }) }),                  // already started
  game("4", "2026-11-20T18:00Z", "GGG", "HHH", { draftkings: bk({ awayML: 300 }), fanduel: bk({ awayML: 100 }) }),                  // outside the window
  game("5", "2026-11-02T01:20Z", "III", "JJJ", { draftkings: bk(), fanduel: { stale: true, reason: "game started" }, hardrockbet: bk({ awayML: 135 }) }),
  game("6", "2026-11-02T18:00Z", "KKK", "LLL", { draftkings: bk({ awaySpread: 1.5, homeSpread: -1.5 }), fanduel: bk({ awaySpread: 1.5, homeSpread: -1.5 }), hardrockbet: bk({ awaySpread: -1, homeSpread: 1 }) }),   // HR spread contradicts its own ML
] };
nfl.games[2].state = "in";
const log = vals => vals.map((v, i) => [`2026-10-${20 - i}`, "OPP", "vs", v == null ? null : { rec_yds: v, anytime_td: v > 50 ? 1 : 0 }]);
const props = { markets: { rec_yds: ["Receiving yards", "Rec yds"], anytime_td: ["Anytime TD", "Any TD"] },
  players: { p1: { n: "Drew Lock", ta: "BBB", pos: "QB", log: log([60, 70, 80, 90, 10]) }, p2: { n: "Cold Guy", ta: "BBB", pos: "WR", log: log([10, 70, 10, 90, 10]) },
    p3: { n: "Short Log", ta: "AAA", pos: "WR", log: log([60, 70, 80]) }, p4: { n: "Missed One", ta: "AAA", pos: "WR", log: log([60, null, 80, 90, 70]) } },
  games: { "1": { props: [["p1", "rec_yds", 45.5, 45.5, [4, 1, 0, 5], { draftkings: [45.5, -115, -105, null], fanduel: [45.5, -105, -115, null], hardrockbet: [46.5, -110, -110, null] }],
    ["p2", "rec_yds", 45.5, 45.5, [2, 3, 0, 5]], ["p3", "rec_yds", 45.5, 45.5, [3, 0, 0, 3]], ["p4", "rec_yds", 45.5, 45.5, [4, 0, 0, 4]]] },
    "3": { props: [["p2", "rec_yds", 5.5, 5.5, [5, 0, 0, 5]]] } } };
const meta = { generated: "2026-10-29T12:30:00Z", hardrock: { asOf: "2026-10-29T12:15:00Z" } };
const cfg = JSON.parse(rd("./newsletter.config.json"));
const issue = L.buildIssue({ meta, indexes: [{ lg: "nfl", index: nfl }], props: [{ lg: "nfl", doc: props }], now: NOW, cfg });
{
  const T = "select";
  const ids = issue.prices.map(r => r.g.id);
  check(!ids.includes("3") && !ids.includes("4"), "only upcoming games inside the 7-day window", T);
  const p1 = issue.prices.find(r => r.g.id === "1");
  check(p1 && p1.label === "AAA moneyline" && p1.bestKeys.join() === "fanduel" && p1.hi === 165 && p1.lo === 150 && p1.cents === 15, "biggest same-bet price gap picked (AAA +165 at FanDuel, 15c)", T);
  check(issue.prices.length === new Set(ids).size, "one row per game", T);
  check(!issue.prices.some(r => r.cells.some(c => c.key === "fanduel" && r.g.id === "5")), "stale books are skipped", T);
  const n2 = issue.numbers.find(r => r.g.id === "2" && r.market === "spread"), t2 = issue.numbers.find(r => r.g.id === "2" && r.market === "total");
  check(n2 && n2.hiLine === 3.5 && n2.loLine === 3 && t2 && t2.diff === 1, "different numbers on spread and total found", T);
  check(!issue.numbers.some(r => r.g.id === "6") && L.offers(nfl.games[5], "spread", "away").every(o => o.key !== "hardrockbet"), "spread that contradicts the book's own moneyline is dropped", T);
  check(L.fmtOdds(-110) === "\u2212110" && L.fmtOdds(150) === "+150" && L.fmtSpread(0) === "PK" && L.fmtSpread(-3.5) === "\u22123.5" && L.centsScale(-105) === -5 && L.centsScale(110) === 10, "odds formatting", T);
  const hot = issue.props.map(x => x.name);
  check(hot.includes("Drew Lock") && hot.includes("Missed One") && !hot.includes("Cold Guy") && !hot.includes("Short Log"), "hot props: 4/5+ over (a missed game doesn't count); 3 games isn't enough", T);
  const dl = issue.props.find(x => x.name === "Drew Lock");
  check(dl && dl.over === -105 && dl.overKeys.join() === "fanduel", "best over price only among books on the same line", T);
  check(issue.moves.length === 1 && issue.moves[0].g.id === "1" && issue.moves[0].notable.join() === "Crossed key number 7", "line moves from the move summary", T);
  check(!L.isEmptyIssue(issue) && L.isEmptyIssue(L.buildIssue({ meta, indexes: [], props: [], now: NOW, cfg })), "empty-issue detection", T);
  const rows = ["nba", "nfl", "nfl", "nfl", "nfl", "nhl"].map((lg, i) => ({ lg, i }));
  check(L.perLeague(rows, 2, 4, ["nfl", "nba", "nhl"]).map(r => r.i).join() === "1,2,0,5", "league balance: cap per league, NFL first", T);
}
{
  const T = "render";
  const u = L.unsubFor(cfg, "3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  check(u.url === "https://linesmart.app/unsubscribe.html?t=3f2504e0-4f89-11d3-9a0c-0305e82c3301", "per-recipient unsubscribe URL", T);
  check(u.headers["List-Unsubscribe"] === `<${u.url}>, <mailto:contact@linesmart.app?subject=unsubscribe>`, "List-Unsubscribe header (URL + mailto)", T);
  const m = L.renderEmail(issue, { ...cfg, mailingAddress: "PO Box 123, Anytown, FL 00000" }, { unsubUrl: u.url });
  check(m.html.includes(`href="${u.url}"`) && m.text.includes(u.url), "unsubscribe link in HTML and text", T);
  // state helplines: unknown state (m) -> compact multi-state line + link; FL / NY / other known state -> that state's line first
  const fall = "Florida: 1-833-PLAYWISE · New York: 1-877-8-HOPENY · Arizona: 1-800-NEXT-STEP · Indiana: 1-800-9-WITH-IT · Iowa: 1-800-BETS-OFF · Elsewhere: 1-800-GAMBLER";
  const strip = h => h.replace(/<[^>]+>/g, "");
  check(m.text.includes(`21+ | Gambling problem? ${fall}. All state helplines: https://linesmart.app/responsible-gambling.html`), "unknown state: compact multi-state helpline line (text)", T);
  check(strip(m.html).includes(`21+ | Gambling problem? ${fall}. All state helplines`) && m.html.includes('href="https://linesmart.app/responsible-gambling.html"'), "unknown state: compact multi-state line + helplines link (HTML)", T);
  check(["18337529947", "18778467369", "18006398783", "18009948448", "18002387633", "18004262537"].every(t => m.html.includes(`href="tel:${t}"`)), "unknown state: every number is a tel: link", T);
  check(!/In Florida you can also call or text 1-833-PLAYWISE/.test(m.html + m.text), "unknown state: PLAYWISE not repeated in the Florida note", T);
  const fl = L.renderEmail(issue, cfg, { unsubUrl: u.url, state: "FL" });
  check(strip(fl.html).includes("21+ | Gambling problem? Call 1-833-PLAYWISE (Florida) or 1-800-GAMBLER.") && fl.text.includes("21+ | Gambling problem? Call 1-833-PLAYWISE (Florida) or 1-800-GAMBLER."), "Florida recipient: 1-833-PLAYWISE first, then 1-800-GAMBLER", T);
  check(fl.html.indexOf("tel:18337529947") < fl.html.indexOf("tel:18004262537") && !fl.html.includes("HOPENY") && !fl.text.includes("HOPENY") && !/All state helplines/.test(fl.text), "Florida recipient: no multi-state list", T);
  check(/Hard Rock Bet is the only legal online sportsbook in Florida/.test(fl.html) && /Hard Rock Bet is the only legal/.test(fl.text), "Florida recipient: Florida sportsbook note kept", T);
  const ny = L.renderEmail(issue, cfg, { unsubUrl: u.url, state: "ny" });
  check(strip(ny.html).includes("21+ | Gambling problem? Call 1-877-8-HOPENY (New York) or 1-800-GAMBLER.") && ny.text.includes("21+ | Gambling problem? Call 1-877-8-HOPENY (New York) or 1-800-GAMBLER.") && ny.html.includes('href="tel:18778467369"'), "New York recipient: 1-877-8-HOPENY first, then 1-800-GAMBLER", T);
  check(ny.html.indexOf("HOPENY") < ny.html.indexOf("1-800-GAMBLER") && !/All state helplines/.test(ny.text), "New York recipient: state line first, no multi-state list", T);
  const nj = L.renderEmail(issue, cfg, { unsubUrl: u.url, state: "NJ" });
  check(strip(nj.html).includes("21+ | Gambling problem? Call 1-800-GAMBLER.") && nj.text.includes("21+ | Gambling problem? Call 1-800-GAMBLER.") && !/HOPENY|NEXT-STEP/.test(nj.html), "other known state (NJ): 1-800-GAMBLER", T);
  check(/In Florida you can also call or text 1-833-PLAYWISE/.test(nj.html), "other known state: Florida note keeps the PLAYWISE line", T);
  check(L.renderEmail(issue, cfg, { state: "<b>" }).text.includes(fall) && L.renderEmail(issue, cfg, { state: 7 }).text.includes(fall), "junk state -> unknown-state line", T);
  const G = require("../site/assets/geo-core.js");
  check(L.HELPLINE_STATES.every(([c]) => G.HELPLINES[c]) && Object.keys(G.HELPLINES).every(c => L.HELPLINE_STATES.some(x => x[0] === c)), "email covers exactly the site's state helplines (geo-core.js)", T);
  check(/Hard Rock Bet is the only legal online sportsbook in Florida/.test(m.html), "Florida note", T);
  check(m.html.includes("PO Box 123, Anytown, FL 00000") && !/NOT SET/.test(m.html), "mailing address shown", T);
  check(m.html.includes("https://linesmart.app/#/bets") && /Track your bets free/.test(m.html), "My Bets plug", T);
  check(m.html.includes("AAA moneyline") && m.html.includes("Drew Lock") && /Notable line moves/.test(m.html) && /Crossed key number 7/.test(m.html), "all sections rendered from data", T);
  check(/^LineSmart Weekly, Oct 29: /.test(m.subject) && m.preheader.length < 150, "subject + preheader", T);
  const links = [...m.html.matchAll(/href="([^"]+)"/g)].map(x => x[1]);
  check(links.length > 5 && links.every(h => h.startsWith("https://linesmart.app/") || h.startsWith("mailto:contact@linesmart.app") || /^tel:1\d{10}$/.test(h)), "every link goes to linesmart.app, contact@ or a helpline tel: (no affiliate links)", T);
  check(!/promo|bonus|affiliate=|[?&]ref=|utm_|[?&]code=/i.test(m.html.replace("This email has no affiliate links.", "")), "no promo codes / tracking parameters", T);
  check(!/<img[^>]+(width="1"|height="1")/i.test(m.html) && !/<script/i.test(m.html), "no tracking pixel, no script", T);
  check(!/\bRod\b|Rodney/i.test(m.html + m.text), "no owner name", T);
  const lint = L.renderEmail(issue, cfg, { lint: true });
  check(!L.bannedIn(lint.html + lint.text).length, "template copy has none of: lock, guaranteed, can't lose, free money, promo", T);
  check(L.bannedIn("a total LOCK tonight").length && L.bannedIn("Guaranteed winner").length && L.bannedIn("you can't lose").length && L.bannedIn("free money").length && L.bannedIn("use promo code X").length, "banned-word guard catches each phrase", T);
  check(!lint.html.includes("Drew Lock") && L.bannedIn(m.html).length > 0, "player names are data (lint mode hides them)", T);
  const evil = L.buildIssue({ meta, indexes: [{ lg: "nfl", index: { games: [game("9", "2026-11-01T17:00Z", "<b>X</b>", "Y\"Z", { draftkings: bk({ awayML: 150 }), fanduel: bk({ awayML: 170 }) })] } }], props: [], now: NOW, cfg });
  const e = L.renderEmail(evil, cfg);
  check(!e.html.includes("<b>X</b>") && e.html.includes("&lt;b&gt;X&lt;/b&gt;"), "data is HTML-escaped", T);
  const empty = L.renderEmail(L.buildIssue({ meta, indexes: [], props: [], now: NOW, cfg }), cfg);
  check(/No meaningful price differences/.test(empty.html) && /No props hit that bar/.test(empty.html), "empty sections say so (nothing invented)", T);
}
{
  const T = "guard";
  const placeholder = L.renderEmail(issue, { ...cfg, mailingAddress: "" });
  check(/MAILING ADDRESS NOT SET/.test(placeholder.html) && /MAILING ADDRESS NOT SET/.test(placeholder.text), "dry run shows a visible address placeholder", T);
  const b = L.sendBlockers({ cfg: { ...cfg, mailingAddress: "" }, mode: "send", recipients: [{}], issue });
  check(b.length === 1 && /mailing address is empty/.test(b[0]), "send REFUSED while the mailing address is empty", T);
  check(L.sendBlockers({ cfg: { ...cfg, mailingAddress: "   " }, mode: "send", recipients: [], issue }).length === 1, "whitespace-only address also refused", T);
  check(!L.sendBlockers({ cfg: { ...cfg, mailingAddress: "PO Box 1" }, mode: "send", recipients: [{}], issue }).length, "send allowed with an address", T);
  check(!L.sendBlockers({ cfg: { ...cfg, mailingAddress: "" }, mode: "test", issue }).length, "test copy to one address allowed without it", T);
  check(/maxRecipients/.test(L.sendBlockers({ cfg: { ...cfg, mailingAddress: "PO Box 1", maxRecipients: 2 }, mode: "send", recipients: [{}, {}, {}], issue }).join()), "over the daily-quota guard -> refused", T);
  check(/no data/.test(L.sendBlockers({ cfg, mode: "test", issue: L.buildIssue({ meta, indexes: [], props: [], now: NOW, cfg }) }).join()), "empty issue -> refused", T);
  check(cfg.mailingAddress === "" && cfg.maxRecipients <= 100, "repo config ships with no address (sending blocked until set)", T);
  const wf = rd("../.github/workflows/newsletter.yml");
  check(/cron: '0 13 \* \* 4'/.test(wf) && /NEWSLETTER_ENABLED/.test(wf) && /default: dry-run/.test(wf) && /m=dry-run/.test(wf), "workflow: Thursday cron, dry-run unless NEWSLETTER_ENABLED=1", T);
  const cli = rd("./newsletter.mjs");
  check(/NEWSLETTER_ENABLED !== "1"/.test(cli) && !/console\.(log|error)\([^)]*(RESEND_API_KEY|exportKey|key\b)/.test(cli), "CLI double-checks NEWSLETTER_ENABLED and never logs keys", T);
  check(!/odds-api|the-odds-api\.com|ODDS_API_KEY/i.test(cli + rd("./newsletter_lib.mjs")), "newsletter never calls the Odds API", T);
}

{ // layout regressions: footer markup identical on every page (stable ids), no mobile overflow, no double box on My Bets
  const T = "layout", js = rd("../site/assets/news.js"), css = rd("../site/assets/styles.css");
  check(/const base = "news-" \+ String\(src\)/.test(js) && !/const id = "news" \+ \(\+\+UID\)/.test(js), "form ids derive from the slot (same footer HTML on SPA and legal pages)", T);
  check(/\.news-form\{grid-template-columns:minmax\(0,1fr\)/.test(css), "mobile form column can shrink (no horizontal overflow at 390px)", T);
  check(/body:has\(\.news-bets\) \.footer \.news-foot\{display:none\}/.test(css), "My Bets hides the duplicate footer box", T);
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall newsletter tests passed");
process.exit(fails.length ? 1 : 0);
