// State-aware offers: pure-logic tests for site/assets/geo-core.js + books-by-state.js (no network, no browser).
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const G = require("../site/assets/geo-core.js");
const DOC = require("../site/assets/books-by-state.js");
globalThis.window = {}; require("../site/assets/config.js");
const OFFERS = window.SITE_CONFIG.offers;
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log("✗ " + msg); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ev = (override, lookup) => G.evaluate(DOC, OFFERS, G.resolve(override, lookup));
const keys = e => e.offers.map(o => o.key);

// Florida: Hard Rock only, first and default; DraftKings/FanDuel/BetMGM hidden and labeled
const fl = ev(null, { country: "US", region: "FL" });
check(fl.status === "ok" && fl.state === "FL" && fl.source === "lookup", "FL lookup resolves to FL");
check(eq(keys(fl), ["hardrockbet"]), "FL: only a Hard Rock Bet offer");
check(!keys(fl).includes("draftkings") && !keys(fl).includes("fanduel") && !keys(fl).includes("betmgm"), "FL hides DraftKings, FanDuel and BetMGM offers");
check(fl.defaultBook === "hardrockbet" && fl.available[0] === "hardrockbet", "FL: Hard Rock Bet first and default");
check(G.naLabel(fl, "draftkings") === "Not available in FL" && G.naLabel(fl, "fanduel") === "Not available in FL" && G.naLabel(fl, "betmgm") === "Not available in FL" && G.naLabel(fl, "hardrockbet") === "", "FL: DK/FD/BetMGM labeled not available");
check(eq(G.sortBooks(fl, ["draftkings", "hardrockbet", "fanduel", "betmgm"]), ["hardrockbet", "draftkings", "fanduel", "betmgm"]), "FL: book columns sort Hard Rock first");
check(fl.offers[0].url === "https://www.hardrock.bet/" && fl.offers[0].affiliate === false, "FL: no affiliate URL yet -> official site, not marked affiliate");

// New Jersey: all four
const nj = ev("NJ", null);
check(nj.status === "ok" && eq(keys(nj).sort(), ["betmgm", "draftkings", "fanduel", "hardrockbet"]), "NJ shows all four books (incl. BetMGM)");
const njMgm = nj.offers.find(o => o.key === "betmgm");
check(njMgm && njMgm.url === "https://sports.betmgm.com/" && njMgm.affiliate === false, "NJ: BetMGM links to its official site, not an affiliate link");
check(eq(keys(nj), ["hardrockbet", "draftkings", "fanduel", "betmgm"]), "NJ: offers follow config order, BetMGM last");
check(nj.unavailable.length === 0 && G.naLabel(nj, "draftkings") === "", "NJ: nothing labeled unavailable");

// non-legal states: no offers, neutral status
for (const st of ["TX", "CA", "GA", "UT", "WA", "MS", "WI"]) {
  const e = ev(st);
  check(e.status === "notlegal" && e.offers.length === 0 && e.available.length === 0, `${st}: not legal online -> no offers`);
}
// legal but none of our books
for (const st of ["DE", "RI", "NV"]) { const e = ev(st); check(e.status === "nobooks" && e.offers.length === 0, `${st}: legal online, none of our books -> no offers`); }
const nv = ev("NV");
check(nv.status === "nobooks" && !keys(nv).includes("betmgm") && !nv.available.includes("betmgm") && nv.uncertain, "NV: BetMGM hidden (Rod's choice), no offers, flagged uncertain");
check(G.naLabel(nv, "betmgm") === "Not available in NV", "NV: BetMGM labeled not available");
// mixed states
check(eq(keys(ev("NY")).sort(), ["betmgm", "draftkings", "fanduel"]), "NY: DraftKings + FanDuel + BetMGM, no Hard Rock");
check(eq(keys(ev("NH")), ["draftkings"]) && eq(keys(ev("OR")), ["draftkings"]), "NH/OR: DraftKings only");
check(eq(keys(ev("ME")), ["draftkings"]), "ME: DraftKings, not FanDuel");
// BetMGM: shown only where it runs a legal online sportsbook; never FL; hidden elsewhere
for (const st of ["AZ", "CO", "DC", "IL", "IN", "IA", "KS", "KY", "LA", "MD", "MA", "MI", "MO", "NJ", "NY", "NC", "OH", "PA", "TN", "VA", "WV", "WY", "PR"])
  check(keys(ev(st)).includes("betmgm"), `${st}: BetMGM shown`);
for (const st of ["FL", "NV", "CT", "VT", "ME", "NH", "OR", "AR", "DE", "RI", "MS", "TX", "CA"]) {
  const e = ev(st);
  check(!keys(e).includes("betmgm") && !e.available.includes("betmgm"), `${st}: BetMGM hidden`);
}
check(G.naLabel(ev("CT"), "betmgm") === "Not available in CT" && G.naLabel(ev("NJ"), "betmgm") === "", "BetMGM N/A label in CT, none in NJ");
check(!DOC.states.FL.books.includes("betmgm") && ev(null, { country: "US", region: "FL" }).offers.every(o => o.key !== "betmgm"), "BetMGM never in Florida (data + lookup)");

// unknown / non-US: no offers until a state is picked
check(ev(null, null).status === "unknown" && ev(null, null).offers.length === 0, "no lookup -> unknown, no offers");
check(ev(null, { country: "US", region: null }).status === "unknown", "US without region -> unknown");
const ca = ev(null, { country: "CA", region: "ON" });
check(ca.status === "nonus" && ca.offers.length === 0 && G.naLabel(ca, "draftkings") === "", "Canada -> nonus, no offers, no labels");
check(ev(G.OUTSIDE, { country: "US", region: "NJ" }).status === "nonus", "picker 'Outside the US' overrides a US lookup");

// manual override beats the lookup
const ov = ev("NJ", { country: "US", region: "FL" });
check(ov.state === "NJ" && ov.source === "override" && keys(ov).length === 4, "override NJ beats FL lookup");
const ov2 = ev("FL", { country: "US", region: "NJ" });
check(ov2.state === "FL" && eq(keys(ov2), ["hardrockbet"]), "override FL beats NJ lookup");
check(ev("TX", { country: "US", region: "NJ" }).offers.length === 0, "override to a non-legal state hides offers");
check(ev("", { country: "US", region: "NJ" }).state === "NJ", "empty override = automatic (uses lookup)");

// lookup parsing (ipdata.info shape) and junk
check(eq(G.parseLookup({ country_code: "US", region_code: "FL", ip: "x" }), { country: "US", region: "FL" }), "parse ipdata.info response");
check(eq(G.parseLookup({ country_code: "us", region_code: "US-nj" }), { country: "US", region: "NJ" }), "parse lowercase / ISO-3166-2 region");
check(G.parseLookup({}) === null && G.parseLookup(null) === null && G.parseLookup("x") === null, "junk responses -> null");

// config / data invariants
check(G.evaluate(DOC, { ...OFFERS, enabled: false }, G.resolve("NJ")).offers.length === 0, "offers.enabled=false -> no offers");
const aff = G.evaluate(DOC, { ...OFFERS, books: { ...OFFERS.books, hardrockbet: { ...OFFERS.books.hardrockbet, affiliateUrl: "https://example.com/aff" } } }, G.resolve("FL"));
check(aff.offers[0].affiliate === true && aff.offers[0].url === "https://example.com/aff", "affiliateUrl, when set, is used and flagged");
check(G.evaluate(DOC, { ...OFFERS, books: { ...OFFERS.books, hardrockbet: { name: "x", officialUrl: "http://insecure" } } }, G.resolve("FL")).offers.length === 0, "non-https offer URL is dropped");
const bad = Object.entries(DOC.states).filter(([, s]) => !s.onlineLegal && s.books.length);
check(bad.length === 0, "no books listed in a state without legal online betting");
check(Object.keys(DOC.states).length === 52 && DOC.asOf && DOC.sources.hardrockbet.length && DOC.sources.draftkings.length && DOC.sources.fanduel.length && DOC.sources.betmgm.length, "data file: 50 states + DC + PR, dated, sourced");
check(eq(DOC.states.FL.books, ["hardrockbet"]), "data: Florida = Hard Rock Bet only");
check(!JSON.stringify(OFFERS).match(/\$\d|bonus|promo/i), "offers config has no bonus or promo claims");
check(OFFERS.books.betmgm && OFFERS.books.betmgm.affiliateUrl === "" && OFFERS.books.betmgm.officialUrl === "https://sports.betmgm.com/", "BetMGM config: official URL, no affiliate link");
check(eq(G.BOOK_KEYS, ["hardrockbet", "draftkings", "fanduel", "betmgm"]), "BOOK_KEYS include BetMGM");

console.log(`${fail ? "FAIL" : "PASS"} geo: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
