/* LineSmart state-aware offers: pure logic (no DOM, no network). Loaded in the browser as window.GeoCore and in
 * Node tests via require(). Data: assets/books-by-state.js (window.BOOKS_BY_STATE) ({ books, states: { FL: { name, onlineLegal, books } } }).
 *
 * evaluate(doc, offersCfg, loc) -> {
 *   status: "unknown" (no lookup / failed) | "nonus" (outside the US) | "notlegal" (no legal online sports betting)
 *         | "nobooks" (legal online, but none of our books) | "ok",
 *   state, stateName, source ("override" | "lookup" | null),
 *   available: book keys legal there (offer order; Hard Rock first), unavailable: book keys NOT legal there
 *   (only when the state is known), offers: [{ key, name, url, affiliate }], defaultBook, note }
 * Offers are only ever built for books in `available`, so a state where a book isn't legal can't get its CTA. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GeoCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const OUTSIDE = "XX";   // picker value for "Outside the US"
  const BOOK_KEYS = ["hardrockbet", "draftkings", "fanduel"];

  // A saved override wins over the geo-IP lookup. Returns { country, region, source } or null.
  function resolve(override, lookup) {
    if (override === OUTSIDE) return { country: "OTHER", region: null, source: "override" };
    if (override && /^[A-Z]{2}$/.test(override)) return { country: "US", region: override, source: "override" };
    if (lookup && lookup.country) return { country: String(lookup.country).toUpperCase(), region: lookup.region ? String(lookup.region).toUpperCase() : null, source: "lookup" };
    return null;
  }

  // Normalize a geo-IP response (ipdata.info: country_code / region_code; tolerant of other common shapes).
  function parseLookup(j) {
    if (!j || typeof j !== "object") return null;
    const country = j.country_code || j.countryCode || j.country || null;
    let region = j.region_code || j.regionCode || null;
    if (!country || typeof country !== "string" || country.length !== 2) return null;
    if (region && typeof region === "string") region = region.toUpperCase().replace(/^US-/, "");
    return { country: country.toUpperCase(), region: region && /^[A-Z]{2}$/.test(region) ? region : null };
  }

  function offerFor(key, cfg) {
    const b = ((cfg || {}).books || {})[key];
    if (!b) return null;
    const url = b.affiliateUrl || b.officialUrl || "";
    if (!/^https:\/\//.test(url)) return null;
    return { key, name: b.name || key, url, affiliate: !!b.affiliateUrl };
  }

  function evaluate(doc, cfg, loc) {
    const states = (doc && doc.states) || {};
    const order = ((cfg && cfg.order) || BOOK_KEYS).filter(k => BOOK_KEYS.includes(k));
    const base = { status: "unknown", state: null, stateName: null, source: loc ? loc.source : null, available: [], unavailable: [], offers: [], defaultBook: null, note: null };
    if (!loc) return base;
    if (loc.country !== "US" && loc.country !== "PR") return { ...base, status: "nonus" };
    const code = loc.country === "PR" ? "PR" : loc.region;
    const st = code && states[code];
    if (!st) return base;   // US but no usable region: treat as unknown until the visitor picks one
    const legalBooks = new Set(st.onlineLegal ? st.books || [] : []);
    const available = order.filter(k => legalBooks.has(k));
    const unavailable = BOOK_KEYS.filter(k => !legalBooks.has(k));
    const status = !st.onlineLegal ? "notlegal" : available.length ? "ok" : "nobooks";
    const offers = cfg && cfg.enabled === false ? [] : available.map(k => offerFor(k, cfg)).filter(Boolean);
    return { ...base, status, state: code, stateName: st.name, available, unavailable, offers, defaultBook: available[0] || null, note: st.note || null, uncertain: !!st.uncertain };
  }

  const isAvailable = (ev, key) => !ev || !ev.state || !ev.unavailable.includes(key);
  const naLabel = (ev, key) => (isAvailable(ev, key) ? "" : `Not available in ${ev.state}`);
  // sort book keys so the ones legal in the visitor's state come first, in offer order (Hard Rock first in FL)
  function sortBooks(ev, keys) {
    const rank = k => { const i = ev && ev.available ? ev.available.indexOf(k) : -1; return i >= 0 ? i : 50 + BOOK_KEYS.indexOf(k); };
    return [...keys].sort((a, b) => rank(a) - rank(b));
  }

  return { OUTSIDE, BOOK_KEYS, resolve, parseLookup, evaluate, isAvailable, naLabel, sortBooks, offerFor };
});
