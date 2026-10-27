/* LineSmart shared page script (loaded on the app and on the legal pages, before app.js).
 * - One-time 21+ notice: an accessible dialog, not a gate. The page content stays in the DOM (so it is
 *   readable by search engines and screen readers once dismissed). Dismissal is remembered in localStorage.
 * - Affiliate disclosure component, driven by SITE_CONFIG.affiliate.enabled (config.js).
 * - Cloudflare Web Analytics beacon, only on the production hostnames (SITE_CONFIG.analytics).
 * - Service worker registration (same worker/scope as the app). */
(function () {
  "use strict";
  const CFG = window.SITE_CONFIG || {};
  const AFF = CFG.affiliate || {};
  const AGE_KEY = "ls-age-ok";
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- affiliate disclosure (hidden unless affiliate links exist)
  const affOn = () => AFF.enabled === true && !!AFF.text;
  function affDisclosure(cls = "") {
    if (!affOn()) return "";
    return `<p class="aff-disc ${esc(cls)}" role="note"><span class="aff-tag">Ad</span> ${esc(AFF.text)} <a href="affiliate-disclosure.html">Affiliate disclosure</a></p>`;
  }
  function applyAffSlots(root = document) {
    root.querySelectorAll("[data-aff-disclosure]").forEach(el => {
      if (affOn()) { el.innerHTML = `<span class="aff-tag">Ad</span> ${esc(AFF.text)} <a href="affiliate-disclosure.html">Affiliate disclosure</a>`; el.hidden = false; }
      else { el.textContent = ""; el.hidden = true; }
    });
  }

  // ---------- 21+ notice
  const ageOk = () => { try { return !!localStorage.getItem(AGE_KEY); } catch (e) { return false; } };
  let sessionOk = false; // if storage is blocked, don't nag again in this page session
  function showAgeNotice() {
    if (ageOk() || sessionOk || document.getElementById("ageNotice")) return;
    const prev = document.activeElement;
    const wrap = document.createElement("div");
    wrap.className = "age-wrap";
    wrap.id = "ageNotice";
    wrap.innerHTML = `<div class="age-backdrop"></div>
      <div class="age-sheet" role="dialog" aria-modal="true" aria-labelledby="ageTitle" aria-describedby="ageDesc">
        <div class="age-badge" aria-hidden="true">21+</div>
        <h2 id="ageTitle">For adults 21 and over</h2>
        <div id="ageDesc">
          <p>${esc(CFG.name || "LineSmart")} shows sports betting odds and stats for people 21+ where sports betting is legal. We don't take bets. Odds are for reference only.</p>
          <p class="age-help">Gambling problem? <span data-rg-call>${window.LSGeo ? window.LSGeo.rgCall() : `Call or text <a href="tel:18004262537">1-800-GAMBLER</a>. In Florida: <a href="tel:18337529947">1-833-PLAYWISE</a>.`}</span></p>
        </div>
        <div class="age-actions">
          <button type="button" class="age-ok" id="ageOk">I'm 21 or older</button>
          <a class="age-more" href="responsible-gambling.html">Responsible gambling</a>
        </div>
        <p class="age-fine">If you're under 21, please leave this site.</p>
      </div>`;
    const others = [...document.body.children];
    others.forEach(el => el.setAttribute("inert", ""));
    document.body.appendChild(wrap);
    document.documentElement.classList.add("age-open");
    const sheet = wrap.querySelector(".age-sheet");
    const focusables = () => [...sheet.querySelectorAll("a[href],button")];
    const close = () => {
      try { localStorage.setItem(AGE_KEY, new Date().toISOString()); } catch (e) {}
      sessionOk = true;
      others.forEach(el => el.removeAttribute("inert"));
      document.documentElement.classList.remove("age-open");
      document.removeEventListener("keydown", onKey, true);
      wrap.remove();
      if (prev && prev.focus && document.contains(prev)) prev.focus();
    };
    const onKey = e => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "Tab") { // keep focus inside the dialog
        const f = focusables(), i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    wrap.querySelector("#ageOk").addEventListener("click", close);
    // following a link out of the notice also counts as having seen it
    sheet.querySelectorAll("a[href]").forEach(a => a.addEventListener("click", close));
    wrap.querySelector(".age-backdrop").addEventListener("click", () => wrap.querySelector("#ageOk").focus());
    wrap.querySelector("#ageOk").focus();
  }

  // ---------- Cloudflare Web Analytics (cookieless). Same as the official snippet
  // <script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "…"}'></script>
  // placed before </body>, but injected only when a token is set AND we're on a production host.
  const AN = CFG.analytics || {};
  const analyticsAllowed = () => !!AN.cfToken && (AN.hosts || []).includes(location.hostname);
  function loadAnalytics() {
    if (!analyticsAllowed() || document.querySelector("script[data-cf-beacon]")) return false;
    const s = document.createElement("script");
    s.type = "module";
    s.src = "https://static.cloudflareinsights.com/beacon.min.js";
    s.setAttribute("data-cf-beacon", JSON.stringify({ token: AN.cfToken }));
    document.body.appendChild(s);
    return true;
  }

  window.LineSmart = Object.assign(window.LineSmart || {}, { affDisclosure, applyAffSlots, showAgeNotice, AGE_KEY, analyticsAllowed });
  const init = () => {
    document.querySelectorAll("[data-brand]").forEach(e => (e.textContent = CFG.name || "LineSmart"));
    applyAffSlots();
    // weekly-email confirm/unsubscribe pages: the visitor already confirmed 21+ at signup, so don't cover the page
    if (!(document.body && document.body.dataset.newsPage)) showAgeNotice();
    loadAnalytics();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(e => console.warn("SW registration failed", e)));
  }
})();
