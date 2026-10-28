/* LineSmart visitor state + sportsbook offers (browser side; logic in geo-core.js, data in books-by-state.js).
 * - State = manual pick ("Your state" picker, localStorage ls-state) > cached geo-IP lookup (ls-geo, TTL from config)
 *   > unknown. The lookup is a free keyless HTTPS call (SITE_CONFIG.geo.url) that only runs on the production hosts
 *   (or when localStorage ls-geo-force = "1", used by tests with a stubbed response). Failure = unknown: no offers.
 * - Offers card: only books legal online in that state, each with 21+ and 1-800-GAMBLER. Links go to the book's
 *   official site until an affiliate URL is configured. [data-rg-call] spans (LSGeo.rgSpan) show the state helpline. Fires window "ls-state-change" when the state changes. */
(function () {
  "use strict";
  const G = window.GeoCore, CFG = window.SITE_CONFIG || {}, GC = CFG.geo || {}, OC = CFG.offers || {};
  const K_GEO = "ls-geo", K_STATE = "ls-state", K_FORCE = "ls-geo-force";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const telA = h => `<a href="tel:${h.tel}">${esc(h.name)}</a>`;
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
               set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };
  let DOC = null, EV = null;

  const lookupAllowed = () => !!GC.url && ((GC.hosts || []).includes(location.hostname) || ls.get(K_FORCE) === "1");
  function cachedLookup() {
    try {
      const c = JSON.parse(ls.get(K_GEO) || "null");
      if (!c || !c.at) return null;
      const ttl = (c.failed ? 1 : GC.ttlHours || 24) * 3600e3;
      return Date.now() - c.at < ttl ? c : null;
    } catch (e) { return null; }
  }
  async function lookup() {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), GC.timeoutMs || 3500);
    try {
      const r = await fetch(GC.url, { signal: ctl && ctl.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const p = G.parseLookup(await r.json());
      if (!p) throw new Error("unusable response");
      ls.set(K_GEO, JSON.stringify({ ...p, at: Date.now() }));
    } catch (e) {
      ls.set(K_GEO, JSON.stringify({ failed: true, at: Date.now() }));
    } finally { clearTimeout(t); }
  }
  function recompute() {
    const c = cachedLookup();
    const loc = G.resolve(ls.get(K_STATE), c && !c.failed ? c : null);
    const prev = EV ? JSON.stringify([EV.status, EV.state]) : null;
    EV = G.evaluate(DOC, OC, loc);
    updateButton();
    return prev !== JSON.stringify([EV.status, EV.state]);
  }
  const fire = () => window.dispatchEvent(new CustomEvent("ls-state-change", { detail: EV }));

  // ---------- footer: state helpline line ([data-rg-local]). The static HTML is the Florida line; with a known state
  // it shows that state's own helpline, or is hidden when the state just uses 1-800-GAMBLER (already in the line above).
  let FL_HTML = null;
  function updateFooterRG() {
    document.querySelectorAll("[data-rg-local]").forEach(el => {
      if (FL_HTML === null) FL_HTML = el.innerHTML;
      const code = EV && EV.status !== "nonus" ? EV.state : null;
      const h = G.helpline(code);
      if (!code || code === "FL") { if (el.innerHTML !== FL_HTML) el.innerHTML = FL_HTML; el.hidden = false; return; }
      if (!h.local) { el.hidden = true; return; }
      const txt = h.sms ? ` or text <a href="sms:${esc(h.sms)}">${esc(h.smsName || h.sms)}</a>` : "";
      el.innerHTML = `${esc(EV.stateName || code)}: call ${telA(h)}${txt} (<a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.label)}</a>).`;
      el.hidden = false;
    });
  }
  window.addEventListener("ls-state-change", updateFooterRG);

  DOC = window.BOOKS_BY_STATE || null;   // assets/books-by-state.js, loaded before this file
  if (!DOC) console.warn("books-by-state.js missing: no offers will be shown");
  // ready: resolves at once when the state is known (override/cache); on a first visit it waits briefly for the lookup
  const ready = (async () => {
    recompute();
    if (!ls.get(K_STATE) && !cachedLookup() && lookupAllowed()) {
      const p = lookup().then(() => { if (recompute()) fire(); });
      await Promise.race([p, new Promise(r => setTimeout(r, 1200))]);
    }
  })();

  // ---------- visits-by-state count (privacy.html#state-counts). Cloudflare Web Analytics reports country only, so on the
  // live site (analytics.hosts) a real, visible browser sends just its two-letter state code once a day (ET) to
  // state_visit_bump() (supabase/migrations/20261028_state_visits.sql). GeoCore.visitDecision skips crawlers, monitors,
  // headless/automation, prefetch and non-visible loads; a background tab or prerender is counted only if it becomes
  // visible. No IP, ID, cookie or user agent is stored; localStorage ls-sv keeps only the date last counted.
  // Unknown or non-US visitors aren't counted. The database repeats the bot check (20261028_state_visits_bot_filter.sql)
  // without storing the user agent.
  const AN = CFG.analytics || {}, SVC = AN.stateCounts || {}, K_SV = "ls-sv";
  const etDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const visitEnv = () => ({
    userAgent: navigator.userAgent || "",
    webdriver: navigator.webdriver,
    prerendering: document.prerendering === true,
    visibilityState: document.visibilityState || "visible",
  });
  let visArmed = false;
  function armVisible() {
    if (visArmed) return;
    visArmed = true;
    const go = () => { visArmed = false; countState(); };
    if (document.prerendering) document.addEventListener("prerenderingchange", go, { once: true });
    else document.addEventListener("visibilitychange", go, { once: true });
  }
  function countState() {
    if (!SVC.rpc || !SVC.key || !(AN.hosts || []).includes(location.hostname)) return;
    if (!EV || EV.status === "nonus" || !/^[A-Z]{2}$/.test(EV.state || "")) return;
    const decision = G.visitDecision(visitEnv());
    if (decision === "skip") return;
    if (decision === "wait") { armVisible(); return; }
    const day = etDay();
    if (ls.get(K_SV) === day) return;
    ls.set(K_SV, day);
    try {
      fetch(SVC.rpc, { method: "POST", headers: { apikey: SVC.key, "Content-Type": "application/json" }, body: JSON.stringify({ p_state: EV.state }),
        credentials: "omit", cache: "no-store", keepalive: true, referrerPolicy: "no-referrer" }).catch(() => {});
    } catch (e) {}
  }
  ready.then(countState);
  window.addEventListener("ls-state-change", countState);

  function setState(code) {   // "FL" | GeoCore.OUTSIDE | null (automatic)
    ls.set(K_STATE, code || null);
    if (recompute()) fire();
    if (!code && !cachedLookup() && lookupAllowed()) lookup().then(() => { if (recompute()) fire(); });
  }

  // ---------- header button + picker
  function updateButton() {
    const b = document.getElementById("stateBtn"); if (!b) return;
    const l = b.querySelector(".st-l");
    const txt = EV && EV.state ? EV.state : EV && EV.status === "nonus" ? "Non-US" : "State";
    if (l) l.textContent = txt;
    b.title = EV && EV.stateName ? `Your state: ${EV.stateName}. Sets which sportsbooks we show.` : "Pick your state: sets which sportsbooks we show";
    b.setAttribute("aria-label", EV && EV.stateName ? `Your state: ${EV.stateName}. Change` : "Pick your state");
  }
  function openPicker() {
    let dlg = document.getElementById("stateDlg");
    if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "stateDlg"; dlg.className = "st-dlg"; document.body.appendChild(dlg); }
    const states = Object.entries((DOC && DOC.states) || {}).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const ov = ls.get(K_STATE) || "", c = cachedLookup();
    const det = c && !c.failed ? (c.country === "US" && DOC && DOC.states[c.region] ? DOC.states[c.region].name : c.country === "US" ? "the US (state unknown)" : "outside the US") : null;
    dlg.innerHTML = `<form method="dialog" class="st-form"><h3 id="stTitle">Your state</h3>
      <p class="st-why">We only show sportsbooks that are legal online where you are. Sportsbooks check your location again when you sign up.</p>
      <label class="st-lbl" for="stSel">State</label>
      <select id="stSel" name="st"><option value="">Automatic${det ? ` (detected: ${esc(det)})` : lookupAllowed() ? "" : " (not detected)"}</option>
        ${states.map(([k, s]) => `<option value="${k}"${ov === k ? " selected" : ""}>${esc(s.name)}</option>`).join("")}
        <option value="${G.OUTSIDE}"${ov === G.OUTSIDE ? " selected" : ""}>Outside the US</option></select>
      <div class="st-act"><button value="cancel" class="st-cancel" formnovalidate>Cancel</button><button value="save" class="st-save" id="stSave">Save</button></div>
      <p class="st-fine">Saved only in this browser. Location lookup: <a href="privacy.html#location">privacy</a>.</p></form>`;
    dlg.setAttribute("aria-labelledby", "stTitle");
    dlg.onclose = () => { if (dlg.returnValue === "save") setState(dlg.querySelector("#stSel").value || null); };
    dlg.showModal();
    dlg.querySelector("#stSel").focus();
  }
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-state-pick], #stateBtn");
    if (t) { e.preventDefault(); openPicker(); }
  });

  // ---------- markup helpers for app.js / props.js / ufc.js
  const current = () => EV || G.evaluate(DOC, OC, null);
  const naLabel = key => G.naLabel(current(), key);
  const naTag = key => { const t = naLabel(key); return t ? ` <span class="na-st">${esc(t)}</span>` : ""; };
  const providerKey = name => (/draft ?kings/i.test(name || "") ? "draftkings" : /fan ?duel/i.test(name || "") ? "fanduel" : /hard ?rock/i.test(name || "") ? "hardrockbet" : /betmgm/i.test(name || "") ? "betmgm" : null);
  // 21+ and helpline line under offers: the visitor's state helpline first (e.g. Florida -> 1-833-PLAYWISE), then 1-800-GAMBLER
  const RG = (st, code) => {
    const h = G.helpline(code), gam = G.helpline(null);
    const call = h.local ? `Call ${telA(h)} (${esc(st)}) or ${telA(gam)}.` : `Call or text ${telA(gam)}.`;
    return `<p class="of-rg"><span class="of-21">21+</span> Must be 21 or older${st ? ` and physically in ${esc(st)}` : ""}. Gambling problem? ${call} <a href="responsible-gambling.html">Responsible gambling</a></p>`;
  };
  // Helpline sentence for any spot outside the offers card (Pro, Value, alerts, bets, age notice, 404): the visitor's
  // state line first, then 1-800-GAMBLER; other states get 1-800-GAMBLER only; an unknown state also names Florida's
  // line (like the static footer). Text from GeoCore.rgCallHTML. Wrap it with rgSpan() so it follows state changes.
  const rgCall = ev => G.rgCallHTML(ev || current());
  const rgSpan = () => `<span data-rg-call>${rgCall()}</span>`;
  function updateRGCalls() {
    const html = rgCall();
    document.querySelectorAll("[data-rg-call]").forEach(el => { if (el.innerHTML !== html) el.innerHTML = html; });
  }
  window.addEventListener("ls-state-change", updateRGCalls);
  // short affiliate disclosure, always shown with sportsbook offers (the full "Ad" line replaces it once affiliate links are on)
  const DISC = `<p class="of-disc" role="note">LineSmart may earn a commission from sportsbook links. It never changes the odds we show. Offers are state-specific. <a href="affiliate-disclosure.html">Affiliate disclosure</a></p>`;
  // compact ad label on every outbound sportsbook link (odds cells never link out, so they don't carry it)
  const AD = `<span class="of-ad" data-ad-label>Ad · We may earn a commission · 21+</span>`;
  function offersHTML(ctx) {
    const ev = current();
    const change = `<button type="button" class="lnk of-change" data-state-pick>${ev.state ? `Your state: <b>${esc(ev.state)}</b> · Change` : "Pick your state"}</button>`;
    if (ev.status === "ok" && ev.offers.length) {
      const aff = ev.offers.some(o => o.affiliate) && window.LineSmart && window.LineSmart.affDisclosure ? window.LineSmart.affDisclosure("of-aff") : "";
      return `<section class="card offers" data-offers="${esc(ctx)}" aria-label="Sportsbooks in ${esc(ev.stateName)}">
        <div class="of-head"><h3>Sportsbooks in ${esc(ev.stateName)}</h3>${change}</div>
        <div class="of-list">${ev.offers.map(o => `<a class="of-book of-${esc(o.key)}" data-book="${esc(o.key)}" href="${esc(o.url)}" target="_blank" rel="${o.affiliate ? "sponsored nofollow noopener" : "nofollow noopener"}">
          <span class="of-txt"><span class="of-nm">Bet on ${esc(o.name)}</span><span class="of-sub">${o.affiliate ? "Partner link" : "Official site"} · legal online in ${esc(ev.state)}</span>${AD}</span><span class="of-go" aria-hidden="true">↗</span></a>`).join("")}</div>
        ${RG(ev.stateName, ev.state)}${aff || DISC}</section>`;
    }
    const msg = ev.status === "notlegal" ? `Online sports betting isn't legal in ${esc(ev.stateName)}, so we don't show sportsbook offers there. Odds and stats are for reference only.`
      : ev.status === "nobooks" ? `We don't show sportsbook offers in ${esc(ev.stateName)}. Odds are for reference only.`
      : ev.status === "nonus" ? "You appear to be outside the US. We only show sportsbook offers in US states where they're legal."
      : "We only show sportsbooks where they're legal. Pick your state to see which ones run there.";
    return `<section class="card offers of-none" data-offers="${esc(ctx)}" data-status="${esc(ev.status)}"><div class="of-head"><p class="of-msg">${msg}</p>${change}</div>${RG(ev.status === "nonus" ? "" : ev.stateName, ev.state)}</section>`;
  }
  // bets tracker uses "hardrock" for Hard Rock Bet
  const defaultBetBook = () => ({ hardrockbet: "hardrock", draftkings: "draftkings", fanduel: "fanduel" }[current().defaultBook] || null);

  window.LSGeo = { ready, current, setState, openPicker, offersHTML, rgCall, rgSpan, naLabel, naTag, providerKey, defaultBetBook,
    isAvailable: key => G.isAvailable(current(), key), sortBooks: keys => G.sortBooks(current(), keys), lookupAllowed };
  const onDom = () => { updateButton(); updateFooterRG(); updateRGCalls(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onDom); else onDom();
  ready.then(() => { updateFooterRG(); updateRGCalls(); });
})();
