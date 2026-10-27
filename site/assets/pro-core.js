/* LineSmart Pro waitlist: pure logic (no DOM, no network), unit-tested by scripts/pro_test.mjs.
   assets/pro.js renders #/pro and the "Pro coming soon" teasers, and calls pro_waitlist_join() from
   supabase/migrations/20261027_pro_waitlist.sql. The table itself isn't readable or writable with the publishable key. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const SB_URL = "https://ctklbryattbbsqdmteny.supabase.co";
  const SB_KEY = "sb_publishable_CP-WGhBFJnoN8exJRtCu2g_CPODay7V";
  const RPC = name => `${SB_URL}/rest/v1/rpc/${name}`;
  const STORE_KEY = "ls-pro-v1";          // {email, at}: this browser joined the waitlist (so the page can say so)
  const COOLDOWN_MS = 30 * 1000;          // client-side throttle between submits (the server rate-limits too)
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;   // same rule as news-core.js, account-core.js and the SQL function

  // Survey answers. Keys are what's stored; the SQL function accepts only these keys.
  const FEATURES = [
    ["props_ev", "Props EV edges and custom filters in the Value finder"],
    ["alerts_25", "Up to 25 line alerts a day"],
    ["tracker_pro", "Tracker extras: closing-line value (CLV), bet tags"],
    ["books_10", "Up to 10 sportsbooks (BetMGM, Caesars, Fanatics, Pinnacle and more)"],
    ["line_history", "Line history charts and sharp-move flags"],
    ["fast_refresh", "Faster odds refresh"],
  ];
  const SPORTS = [["nfl", "NFL"], ["nba", "NBA"], ["mlb", "MLB"], ["nhl", "NHL"], ["ncaaf", "NCAAF"], ["ncaab", "NCAAB"], ["ufc", "UFC"]];
  const PRICES = [["4.99", "$4.99 a month"], ["9.99", "$9.99 a month"], ["14.99", "$14.99 a month"], ["more", "More than $14.99"]];
  const SOURCES = ["pro", "value", "alerts", "bets", "footer"];
  const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" ");

  const cleanEmail = e => String(e == null ? "" : e).trim().toLowerCase();
  const validEmail = e => { const c = cleanEmail(e); return c.length >= 6 && c.length <= 254 && EMAIL_RE.test(c); };
  const pick = (vals, table) => { const ok = new Set(table.map(x => x[0])); return [...new Set([].concat(vals || []).map(String))].filter(v => ok.has(v)); };
  const cleanState = s => { const t = String(s || "").trim().toUpperCase(); return STATES.includes(t) ? t : null; };

  /** Validate the form. Returns {ok, field, error, payload}. The honeypot never shows an error (bots get a fake success).
      The survey is optional: only the email and the 21+ box are required. */
  function validate({ email, age, features, sports, price, website, source, state, now = Date.now(), last = 0 } = {}) {
    if (String(website || "").trim()) return { ok: true, bot: true };
    if (!cleanEmail(email)) return { ok: false, field: "email", error: "Enter your email address." };
    if (!validEmail(email)) return { ok: false, field: "email", error: "That email doesn't look right. Check it and try again." };
    if (age !== true) return { ok: false, field: "age", error: "Please confirm you're 21 or older." };
    if (last && now - last < COOLDOWN_MS) return { ok: false, field: "", error: "One moment: please wait a few seconds before trying again." };
    const p = PRICES.some(x => x[0] === price) ? price : null;
    return { ok: true, payload: {
      p_email: cleanEmail(email), p_is_21: true, p_features: pick(features, FEATURES), p_sports: pick(sports, SPORTS),
      p_price: p, p_state: cleanState(state), p_source: SOURCES.includes(source) ? source : "pro", p_website: "",
    } };
  }

  const MESSAGES = {
    ok: { kind: "ok", text: "You're on the LineSmart Pro waitlist. We'll email you once, when Pro opens, with the founding-member launch price. No other emails from this list." },
    invalid_email: { kind: "err", text: "That email doesn't look right. Check it and try again." },
    age_required: { kind: "err", text: "Please confirm you're 21 or older." },
    rate_limited: { kind: "err", text: "Too many tries from this connection. Please wait an hour and try again." },
    busy: { kind: "err", text: "The waitlist is very busy right now. Please try again tomorrow." },
    unavailable: { kind: "err", text: "The waitlist opens soon. Please check back in a few days." },
    network: { kind: "err", text: "Couldn't reach the waitlist. Check your connection and try again." },
  };
  /** Map the RPC answer (or a failed fetch) to what the visitor sees. */
  function resultFor(status, body) {
    if (status === 404) return MESSAGES.unavailable;   // function not installed yet (migration not run)
    if (status === 0 || status == null) return MESSAGES.network;
    if (status >= 200 && status < 300 && typeof body === "string" && MESSAGES[body]) return MESSAGES[body];
    if (status === 429) return MESSAGES.rate_limited;
    return MESSAGES.network;
  }

  return { SB_URL, SB_KEY, RPC, STORE_KEY, COOLDOWN_MS, EMAIL_RE, FEATURES, SPORTS, PRICES, SOURCES, STATES, cleanEmail, validEmail, cleanState, validate, MESSAGES, resultFor };
});
