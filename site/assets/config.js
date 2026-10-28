// ===== LineSmart site config — change the brand name here (one spot) =====
window.SITE_CONFIG = {
  name: "LineSmart",
  tagline: "Betting data & matchup intel",
  defaultLeague: "nfl",          // used if it has games; otherwise first league with games
  timeZone: "America/New_York",  // all times shown in ET
  tzLabel: "ET",
  // Affiliate disclosure. Keep `enabled: false` until the site actually carries affiliate links.
  // When true, every [data-aff-disclosure] slot (footer, near sportsbook lines) shows `text`, and
  // LineSmart.affDisclosure() returns the line for views rendered in JS. Update affiliate-disclosure.html too.
  affiliate: {
    enabled: false,
    text: "Some links on LineSmart are affiliate links: we may earn a commission if you sign up, at no cost to you. It never changes the odds we show.",
  },
  // Cloudflare Web Analytics (cookieless). `cfToken` is the PUBLIC site tag from the Cloudflare dashboard
  // (Web Analytics > Manage site > JS snippet: data-cf-beacon token). Set "" to turn analytics off.
  // site.js injects the beacon ONLY when location.hostname is in `hosts`, so local servers,
  // previews and the test suites never load it and test traffic isn't counted.
  analytics: {
    cfToken: "353a52038b2e4d338fcc1ebde3aa17be",
    hosts: ["linesmart.app", "www.linesmart.app"],
    // Daily visits-by-state count (assets/geo.js, privacy.html#state-counts): only the 2-letter state code, once a day per
    // browser, on `hosts` only. Needs supabase/migrations/20261028_state_visits.sql run first (until then the call just
    // 404s, once a day). Set rpc to "" to turn it off. The key is the public publishable key (same as news-core.js).
    stateCounts: {
      rpc: "https://ctklbryattbbsqdmteny.supabase.co/rest/v1/rpc/state_visit_bump",
      key: "sb_publishable_CP-WGhBFJnoN8exJRtCu2g_CPODay7V",
    },
  },
  // Visitor state for state-aware offers (assets/geo.js). Free keyless HTTPS geo-IP lookup, cached in
  // localStorage; the "Your state" picker overrides it. Lookups run only on `hosts` (tests set ls-geo-force).
  geo: {
    url: "https://ipdata.info/json",   // returns { country_code: "US", region_code: "FL", ... }
    timeoutMs: 3500,
    ttlHours: 24,
    hosts: ["linesmart.app", "www.linesmart.app"],
  },
  // Sportsbook offers, shown only in states where that book runs a legal online sportsbook
  // (assets/books-by-state.js). `affiliateUrl`: put the real tracking link here once approved; until then
  // the card links to the book's official public site with no promo claims. Never add bonus amounts that
  // aren't in an approved, current offer. When any affiliateUrl is set, also set affiliate.enabled = true.
  offers: {
    enabled: true,
    order: ["hardrockbet", "draftkings", "fanduel", "betmgm"],
    books: {
      hardrockbet: { name: "Hard Rock Bet", officialUrl: "https://www.hardrock.bet/", affiliateUrl: "" },
      draftkings: { name: "DraftKings Sportsbook", officialUrl: "https://sportsbook.draftkings.com/", affiliateUrl: "" },
      fanduel: { name: "FanDuel Sportsbook", officialUrl: "https://sportsbook.fanduel.com/", affiliateUrl: "" },
      // BetMGM: offers + state book list only (no BetMGM odds data, so no odds column). Never shown in FL.
      betmgm: { name: "BetMGM Sportsbook", officialUrl: "https://sports.betmgm.com/", affiliateUrl: "" },
    },
  },
};
