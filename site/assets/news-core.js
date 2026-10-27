/* LineSmart weekly email signup: pure logic (no DOM, no network), unit-tested by scripts/newsletter_test.mjs.
   assets/news.js renders the forms and calls the Supabase functions from supabase/migrations/20261026_newsletter.sql.
   Only the public project URL + publishable key are used; the table itself isn't readable or writable with it. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NewsCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const SB_URL = "https://ctklbryattbbsqdmteny.supabase.co";
  const SB_KEY = "sb_publishable_CP-WGhBFJnoN8exJRtCu2g_CPODay7V";
  const RPC = name => `${SB_URL}/rest/v1/rpc/${name}`;
  const STORE_KEY = "ls-news-v1";        // {email, at, state}: what this browser last did, so the box can say "check your inbox"
  const COOLDOWN_MS = 30 * 1000;         // client-side throttle between submits (the server rate-limits too)
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;   // same rule as account-core.js and the SQL function
  const SOURCES = ["home", "footer", "bets", "site"];
  const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const cleanEmail = e => String(e == null ? "" : e).trim().toLowerCase();
  const validEmail = e => { const c = cleanEmail(e); return c.length >= 6 && c.length <= 254 && EMAIL_RE.test(c); };

  /** Validate the form. Returns {ok, field, error, payload}. The honeypot never shows an error (bots get a fake success). */
  function validate({ email, age, website, source, now = Date.now(), last = 0 } = {}) {
    if (String(website || "").trim()) return { ok: true, bot: true };
    if (!cleanEmail(email)) return { ok: false, field: "email", error: "Enter your email address." };
    if (!validEmail(email)) return { ok: false, field: "email", error: "That email doesn't look right. Check it and try again." };
    if (age !== true) return { ok: false, field: "age", error: "Please confirm you're 21 or older." };
    if (last && now - last < COOLDOWN_MS) return { ok: false, field: "", error: "One moment: please wait a few seconds before trying again." };
    return { ok: true, payload: { p_email: cleanEmail(email), p_age_ok: true, p_website: "", p_source: SOURCES.includes(source) ? source : "site" } };
  }

  /** Map the RPC answer (or a failed fetch) to what the visitor sees. */
  const MESSAGES = {
    ok: { kind: "ok", text: "Almost done: check your inbox for a confirmation link from LineSmart. You won't get the weekly email until you click it." },
    invalid_email: { kind: "err", text: "That email doesn't look right. Check it and try again." },
    age_required: { kind: "err", text: "Please confirm you're 21 or older." },
    rate_limited: { kind: "err", text: "Too many tries from this connection. Please wait an hour and try again." },
    busy: { kind: "err", text: "We've hit today's signup limit. Please try again tomorrow." },
    unavailable: { kind: "err", text: "Email signups open soon. Please check back in a few days." },
    network: { kind: "err", text: "Couldn't reach the signup service. Check your connection and try again." },
  };
  function resultFor(status, body) {
    if (status === 404) return MESSAGES.unavailable;   // functions not installed yet
    if (status === 0 || status == null) return MESSAGES.network;
    if (status >= 200 && status < 300 && typeof body === "string" && MESSAGES[body]) return MESSAGES[body];
    if (status === 429) return MESSAGES.rate_limited;
    return MESSAGES.network;
  }

  const CONFIRM = {
    confirmed: { kind: "ok", title: "You're subscribed", text: "Thanks for confirming. The LineSmart weekly email arrives Thursday mornings with the best lines, hot props and line moves. Every email has a one-click unsubscribe link." },
    already: { kind: "ok", title: "You're already subscribed", text: "This address is already confirmed. The next LineSmart weekly email arrives Thursday morning." },
    expired: { kind: "err", title: "This link expired", text: "Confirmation links last 14 days. Sign up again below and we'll send a fresh one." },
    invalid: { kind: "err", title: "This link isn't valid", text: "It may have been copied incompletely, or the address was unsubscribed. Sign up again below to get a new confirmation link." },
    network: { kind: "err", title: "Couldn't confirm right now", text: "We couldn't reach the server. Check your connection and tap Confirm again." },
  };
  const UNSUB = {
    unsubscribed: { kind: "ok", title: "You're unsubscribed", text: "You won't get the LineSmart weekly email anymore. Changed your mind? You can sign up again anytime." },
    already: { kind: "ok", title: "You're already unsubscribed", text: "This address isn't on the list. You won't get the LineSmart weekly email." },
    invalid: { kind: "err", title: "This unsubscribe link isn't valid", text: "It may have been copied incompletely. Reply to any LineSmart email or write to contact@linesmart.app with the subject \"unsubscribe\" and we'll remove you by hand." },
    network: { kind: "err", title: "Couldn't unsubscribe right now", text: "We couldn't reach the server. Tap Try again, or write to contact@linesmart.app with the subject \"unsubscribe\"." },
  };
  const pageResult = (table, status, body) => (status >= 200 && status < 300 && table[body]) ? table[body] : status === 404 ? table.invalid : table.network;

  /** Token from a page URL query string (?t=uuid). Returns "" if missing or malformed. */
  function tokenFrom(search) {
    const m = /[?&]t=([^&#]+)/.exec(String(search || ""));
    const t = m ? decodeURIComponent(m[1]).trim() : "";
    return TOKEN_RE.test(t) ? t.toLowerCase() : "";
  }

  return { SB_URL, SB_KEY, RPC, STORE_KEY, COOLDOWN_MS, EMAIL_RE, cleanEmail, validEmail, validate, MESSAGES, resultFor, CONFIRM, UNSUB, pageResult, tokenFrom };
});
