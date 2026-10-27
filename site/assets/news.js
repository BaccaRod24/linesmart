/* LineSmart weekly email: signup boxes ([data-news-signup] slots on the homepage, footer and My Bets) and the
   confirm / unsubscribe pages ([data-news-page]). Logic lives in assets/news-core.js; the server side is
   supabase/migrations/20261026_newsletter.sql (double opt-in, rate limits, one-click unsubscribe). */
(function () {
  "use strict";
  const N = window.NewsCore; if (!N) return;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(N.STORE_KEY) || "null"); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(N.STORE_KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  let LAST = 0, UID = 0;

  async function rpc(name, args) {
    try {
      const res = await fetch(N.RPC(name), { method: "POST", headers: { apikey: N.SB_KEY, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(args), cache: "no-store" });
      let body = null; try { body = await res.json(); } catch (e) { /* empty */ }
      return { status: res.status, body };
    } catch (e) { return { status: 0, body: null }; }
  }

  const ICON = `<svg class="news-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4 7.5 8 5.5 8-5.5"/></svg>`;
  function formHTML(src) {
    const base = "news-" + String(src).replace(/[^a-z0-9]/gi, ""), id = document.getElementById(base + "f") ? base + (++UID) : base; // stable per slot, so the footer markup is the same on every page
    const prev = store.get();
    const toggle = src === "home" ? `<button type="button" class="news-toggle" aria-expanded="false" aria-controls="${id}f">${ICON}<span>Get the free weekly email</span><svg class="news-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>` : "";
    return `${toggle}<form class="news-form" id="${id}f" novalidate data-src="${esc(src)}">
      <div class="news-copy">
        <div class="news-h">${ICON}<span><b>Get the weekly LineSmart email:</b> best lines, hot props, line moves. Free.</span></div>
      </div>
      <div class="news-fields">
        <div class="news-row">
          <label class="sr-only" for="${id}e">Email address</label>
          <input id="${id}e" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="254" placeholder="you@example.com" required aria-describedby="${id}m">
          <button type="submit" class="news-btn">Subscribe</button>
        </div>
        <label class="news-age"><input name="age" type="checkbox" required> <span>I'm 21 or older</span></label>
        <div class="news-hp" aria-hidden="true"><label>Leave this empty <input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
      </div>
      <p class="news-msg" id="${id}m" role="status" aria-live="polite">${prev && prev.state === "pending" ? `Confirmation sent to ${esc(prev.email)}. Check your inbox (and spam) for the link.` : ""}</p>
      <p class="news-fine">One email a week, Thursday mornings. Unsubscribe anytime. 21+. <a href="privacy.html#newsletter">Privacy</a></p>
    </form>`;
  }

  function wire(slot) {
    const src = slot.dataset.newsSignup || "site";
    slot.classList.add("news-box", "news-" + src);
    slot.innerHTML = formHTML(src);
    const f = slot.querySelector("form"), msg = f.querySelector(".news-msg"), btn = f.querySelector("button[type=submit]");
    const tg = slot.querySelector(".news-toggle");
    if (tg) tg.addEventListener("click", () => { const open = !slot.classList.contains("open"); slot.classList.toggle("open", open); tg.setAttribute("aria-expanded", String(open)); if (open) f.email.focus(); });
    const say = (kind, text) => { msg.className = "news-msg " + kind; msg.textContent = text; };
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const v = N.validate({ email: f.email.value, age: f.age.checked, website: f.website.value, source: src, now: Date.now(), last: LAST });
      f.email.removeAttribute("aria-invalid"); f.age.removeAttribute("aria-invalid");
      if (v.bot) { say("ok", N.MESSAGES.ok.text); f.reset(); return; }
      if (!v.ok) { say("err", v.error); if (v.field) { f[v.field].setAttribute("aria-invalid", "true"); f[v.field].focus(); } return; }
      LAST = Date.now(); btn.disabled = true; btn.textContent = "Sending…";
      const r = await rpc("newsletter_subscribe", v.payload);
      const out = N.resultFor(r.status, r.body);
      btn.disabled = false; btn.textContent = "Subscribe";
      say(out.kind, out.text);
      if (out === N.MESSAGES.ok) { store.set({ email: v.payload.p_email, at: new Date().toISOString(), state: "pending" }); f.reset(); }
      if (out === N.MESSAGES.invalid_email) f.email.setAttribute("aria-invalid", "true");
    });
  }

  function mountAll(root) {
    if (document.body && document.body.dataset.newsPage && root === document) {
      // confirm / unsubscribe pages: the page's own form only, no footer box
      const foot = document.querySelector('.footer [data-news-signup]'); if (foot) foot.remove();
    }
    (root || document).querySelectorAll("[data-news-signup]:not([data-news-ready])").forEach(s => { s.dataset.newsReady = "1"; wire(s); });
  }

  // ---------- confirm / unsubscribe pages
  function pageView(kind) {
    const box = document.getElementById("newsPage"); if (!box) return;
    const token = N.tokenFrom(location.search);
    const T = kind === "confirm" ? N.CONFIRM : N.UNSUB;
    const show = (r, retry) => {
      box.innerHTML = `<div class="news-result ${r.kind}"><h2>${esc(r.title)}</h2><p>${esc(r.text)}</p>${retry ? `<button type="button" class="news-btn" data-go>${kind === "confirm" ? "Confirm again" : "Try again"}</button>` : ""}</div>`;
      if (kind === "confirm" && r.kind === "err" && !retry) { const d = document.createElement("div"); d.dataset.newsSignup = "site"; d.className = "news-page-signup"; box.appendChild(d); mountAll(box); }
      if (kind === "confirm" && (r === T.confirmed || r === T.already)) { const p = store.get(); if (p) store.set({ ...p, state: "confirmed" }); box.querySelector(".news-result").insertAdjacentHTML("beforeend", `<p><a class="news-link" href="./">Back to today's odds</a> · <a class="news-link" href="./#/bets">Track your bets free</a></p>`); }
      if (kind === "unsub" && r.kind === "ok") { const p = store.get(); if (p) store.set({ ...p, state: "unsubscribed" }); box.querySelector(".news-result").insertAdjacentHTML("beforeend", `<p><a class="news-link" href="./">Back to LineSmart</a></p>`); }
      const go = box.querySelector("[data-go]"); if (go) go.addEventListener("click", run);
    };
    async function run() {
      box.innerHTML = `<div class="news-result"><p>${kind === "confirm" ? "Confirming…" : "Unsubscribing…"}</p></div>`;
      const r = await rpc(kind === "confirm" ? "newsletter_confirm" : "newsletter_unsubscribe", { p_token: token });
      const out = N.pageResult(T, r.status, r.body);
      show(out, out === T.network);
    }
    if (!token) {
      if (kind === "confirm") { box.innerHTML = `<div class="news-result"><h2>Check your inbox</h2><p>We sent a confirmation link to the address you entered. Open it on any device to finish subscribing. Nothing there after a few minutes? Check spam, or sign up again below.</p></div><div data-news-signup="site" class="news-page-signup"></div>`; mountAll(box); }
      else box.innerHTML = `<div class="news-result"><h2>Unsubscribe from the LineSmart weekly email</h2><p>Use the unsubscribe link at the bottom of any LineSmart email; one click removes you. Can't find one? Write to <a href="mailto:contact@linesmart.app?subject=unsubscribe">contact@linesmart.app</a> with the subject "unsubscribe" and we'll remove you by hand.</p></div>`;
      return;
    }
    if (kind === "unsub") return run();   // one click: the link itself unsubscribes, no extra button or login
    // confirm needs one tap, so link scanners in mail filters can't confirm addresses on their own
    box.innerHTML = `<div class="news-result"><h2>Confirm your weekly LineSmart email</h2><p>One more tap and you're on the list for the free Thursday email: best lines across Hard Rock Bet, DraftKings and FanDuel, hot props and line moves.</p>
      <button type="button" class="news-btn" data-go>Confirm my email</button></div>`;
    box.querySelector("[data-go]").addEventListener("click", run);
  }

  function start() {
    mountAll(document);
    const pg = document.body.dataset.newsPage; if (pg) pageView(pg);
    // the app re-renders views (My Bets) after load: mount any new slots
    const app = document.getElementById("app");
    if (app && "MutationObserver" in window) new MutationObserver(() => { if (app.querySelector("[data-news-signup]:not([data-news-ready])")) mountAll(app); }).observe(app, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.LSNews = { mount: mountAll };
})();
