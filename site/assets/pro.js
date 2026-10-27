/* LineSmart Pro waitlist page (#/pro, window.LSPro) and the small "Pro coming soon" teasers on the Value finder, the
   line-alerts settings and My Bets stats. Logic: assets/pro-core.js. Server: supabase/migrations/20261027_pro_waitlist.sql
   (pro_waitlist_join(): validates, dedupes by email, rate-limits; the table isn't readable with the publishable key).
   No email is sent on signup. Pro is a data/software subscription idea: no picks, no promises. */
(function () {
  "use strict";
  const P = window.ProCore; if (!P) return;
  const A = () => window.LSApp, G = () => window.LSGeo, ACC = () => window.LSAccount;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(P.STORE_KEY) || "null"); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(P.STORE_KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  let LAST = 0;

  async function rpc(name, args, token) {
    try {
      const headers = { apikey: P.SB_KEY, "Content-Type": "application/json", Accept: "application/json" };
      if (token) headers.Authorization = "Bearer " + token;   // signed in: the server links the row to the account (auth.uid())
      const res = await fetch(P.RPC(name), { method: "POST", headers, body: JSON.stringify(args), cache: "no-store" });
      let body = null; try { body = await res.json(); } catch (e) { /* empty */ }
      return { status: res.status, body };
    } catch (e) { return { status: 0, body: null }; }
  }
  async function signedInSession() {
    const a = ACC(); if (!a || !a.signedIn || !a.signedIn()) return null;
    try { return await a.session(); } catch (e) { return null; }
  }

  // ---------- teasers (subtle one-liners; never a nav item)
  const TEASE = {
    value: "props EV edges with custom filters, up to 10 books and line history",
    alerts: "up to 25 line alerts a day and sharp-move flags",
    bets: "closing-line value (CLV) and bet tags in your tracker",
  };
  const teaser = src => `<a class="pro-tease" href="#/pro?from=${esc(src)}" data-pro-tease="${esc(src)}"><span class="pro-pill">Pro</span><span class="pro-tt"><b>Coming soon:</b> ${esc(TEASE[src] || "more books, more data, more tools")}. <u>Join the waitlist</u></span><span class="pro-go" aria-hidden="true">›</span></a>`;

  // ---------- #/pro
  const FREE = [
    "Odds from Hard Rock Bet, DraftKings and FanDuel on every game we cover",
    "The full Value finder for game lines: moneylines, spreads and totals against the no-vig consensus",
    "Line alerts by email",
    "My Bets tracker with stats, charts, units and CSV export, plus sync with a free account",
    "Matchups, game previews, player props pages and the weekly email",
  ];
  const ICON_OK = `<svg class="pro-ck" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
  const ICON_PLUS = `<svg class="pro-ck pro-plus" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
  const fromHash = () => { const q = new URLSearchParams(location.hash.split("?")[1] || ""); const f = q.get("from"); return P.SOURCES.includes(f) ? f : "pro"; };
  // helpline follows the visitor's state (LSGeo.rgSpan, numbers in geo-core.js)
  const RG = () => `<p class="of-rg pro-rg"><span class="of-21">21+</span> LineSmart is for adults 21 and older. Gambling problem? ${window.LSGeo.rgSpan()} <a href="responsible-gambling.html">Responsible gambling</a></p>`;

  function formHTML(prefill, joined) {
    const box = (name, [v, label]) => `<label class="pro-opt"><input type="checkbox" name="${name}" value="${esc(v)}"><span>${esc(label)}</span></label>`;
    return `<form class="card pro-form" id="proForm" novalidate>
      <h2 class="pro-h2" id="proJoin">Join the waitlist</h2>
      <p class="pro-p">Free, no payment, no commitment. We'll email you once, when Pro opens.</p>
      <div class="pro-field"><label for="proEmail">Email address</label>
        <input id="proEmail" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="254" placeholder="you@example.com" required value="${esc(prefill)}" aria-describedby="proMsg"></div>
      <fieldset class="pro-q"><legend>Which Pro features would you use? <span>Pick any</span></legend>
        <div class="pro-opts">${P.FEATURES.map(f => box("features", f)).join("")}</div></fieldset>
      <fieldset class="pro-q"><legend>Which sports do you follow? <span>Pick any</span></legend>
        <div class="pro-opts pro-chips">${P.SPORTS.map(s => box("sports", s)).join("")}</div></fieldset>
      <fieldset class="pro-q"><legend>What's a fair monthly price for Pro?</legend>
        <div class="pro-opts pro-chips">${P.PRICES.map(([v, l]) => `<label class="pro-opt"><input type="radio" name="price" value="${esc(v)}"><span>${esc(l)}</span></label>`).join("")}</div></fieldset>
      <label class="news-age pro-age"><input name="age" type="checkbox" required> <span>I'm 21 or older</span></label>
      <div class="news-hp" aria-hidden="true"><label>Leave this empty <input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
      <div class="pro-submit"><button type="submit" class="news-btn">Join the waitlist</button></div>
      <p class="news-msg" id="proMsg" role="status" aria-live="polite">${joined ? `${esc(joined.email)} is on the waitlist. Send the form again to update your answers.` : ""}</p>
      <p class="news-fine">The survey is optional. We store your email, your answers, your state if the site knows it, and your account ID if you're signed in. <a href="privacy.html#pro-waitlist">Privacy</a></p>
    </form>`;
  }

  async function view() {
    const app = document.getElementById("app");
    if (A()) A().renderTabs(null);
    window.scrollTo(0, 0);
    const src = fromHash(), joined = store.get();
    let prefill = (joined && joined.email) || "";
    try { prefill = localStorage.getItem("ls-acct-email") || prefill; } catch (e) { /* private mode */ }
    const offers = G() ? G().offersHTML("pro") : "";
    app.innerHTML = `<div class="page-head pro-head"><div><span class="eyebrow">Coming soon</span><h1>LineSmart <span class="pro-pill pro-pill-lg">Pro</span></h1>
        <div class="sub">More sportsbooks, deeper data and power tools for serious line shoppers. Everything free today stays free.</div></div>
        <a class="bt-add" href="#proJoin" data-pro-jump>Join the waitlist</a></div>
      <div class="pro-grid">
        <section class="card pro-col"><h3>Free, today and after Pro launches</h3><ul class="pro-list">${FREE.map(t => `<li>${ICON_OK}<span>${esc(t)}</span></li>`).join("")}</ul></section>
        <section class="card pro-col pro-adds"><h3>What Pro adds</h3><ul class="pro-list">${P.FEATURES.map(([, t]) => `<li>${ICON_PLUS}<span>${esc(t)}</span></li>`).join("")}</ul></section>
      </div>
      <div class="card pro-price" role="note"><b>Founding members get a lower launch price.</b> Join the waitlist to hear first when Pro opens. No payment details now, and exact prices aren't set yet.</div>
      ${formHTML(prefill, joined)}
      <section class="card pro-what"><h3>What Pro is, and isn't</h3>
        <p>Pro is a data and software subscription: odds comparison, line history, alerts and bet tracking tools. It doesn't include picks or predictions, and no tool can promise that a bet wins or that you'll make money. Most bets lose. LineSmart doesn't take bets; always confirm the price at the sportsbook.</p>${RG()}</section>
      ${offers}`;
    const f = document.getElementById("proForm");
    const jump = app.querySelector("[data-pro-jump]");
    if (jump) jump.addEventListener("click", e => { e.preventDefault(); f.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => f.email.focus({ preventScroll: true }), 400); });
    signedInSession().then(s => { const em = s && s.user && s.user.email; if (em && f.isConnected && !f.email.value) f.email.value = em; else if (em && f.isConnected && f.email.value !== em && !f.email.dataset.touched) f.email.value = em; });
    f.email.addEventListener("input", () => { f.email.dataset.touched = "1"; });
    wire(f, src);
  }

  function wire(f, src) {
    const msg = f.querySelector(".news-msg"), btn = f.querySelector("button[type=submit]");
    const say = (kind, text) => { msg.className = "news-msg " + kind; msg.textContent = text; };
    const vals = name => [...f.querySelectorAll(`input[name=${name}]:checked`)].map(i => i.value);
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const ev = G() ? G().current() : null;
      const v = P.validate({ email: f.email.value, age: f.age.checked, features: vals("features"), sports: vals("sports"), price: vals("price")[0] || null,
        website: f.website.value, source: src, state: ev && ev.state, now: Date.now(), last: LAST });
      f.email.removeAttribute("aria-invalid"); f.age.removeAttribute("aria-invalid");
      if (v.bot) { say("ok", P.MESSAGES.ok.text); return; }
      if (!v.ok) { say("err", v.error); if (v.field) { f[v.field].setAttribute("aria-invalid", "true"); f[v.field].focus(); } return; }
      LAST = Date.now(); btn.disabled = true; btn.textContent = "Joining…";
      const s = await signedInSession();
      const r = await rpc("pro_waitlist_join", v.payload, s && s.access_token);
      const out = P.resultFor(r.status, r.body);
      btn.disabled = false; btn.textContent = "Join the waitlist";
      say(out.kind, out.text);
      if (out === P.MESSAGES.ok) store.set({ email: v.payload.p_email, at: new Date().toISOString() });
      if (out === P.MESSAGES.invalid_email) f.email.setAttribute("aria-invalid", "true");
    });
  }

  window.LSPro = { view, teaser };
})();
