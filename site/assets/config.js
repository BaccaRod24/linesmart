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
};
