/* LineSmart Account tab (#/account): optional email sign-in (one-time code, or the magic link in the same email) that
   syncs My Bets between devices through Supabase. Signed-out visitors never load the Supabase library: it is fetched
   from assets/vendor/ only when the Account tab is opened, a sign-in link lands here, or this device is signed in.
   This browser stays the source of truth offline; logic lives in account-core.js (unit-tested). */
(function () {
  "use strict";
  const AC = window.AcctCore;
  if (!AC) return;
  const LIB = new URL(AC.SB_LIB, (document.currentScript && document.currentScript.src) || location.href).href;
  const esc = s => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  const hasSession = () => { try { return !!localStorage.getItem(AC.AUTH_KEY); } catch (e) { return false; } };
  const timeET = iso => { try { return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET"; } catch (e) { return iso; } };

  // ---------- Supabase client (lazy)
  let SB = null, sbP = null, SESSION = null;
  function client() {
    if (SB) return Promise.resolve(SB);
    if (!sbP) sbP = new Promise((res, rej) => {
      if (window.supabase && window.supabase.createClient) return res();
      const s = document.createElement("script"); s.src = LIB; s.async = true;
      s.onload = () => res(); s.onerror = () => { sbP = null; s.remove(); rej(new Error("Couldn't load sign-in. Check your connection and try again.")); };
      document.head.appendChild(s);
    }).then(() => {
      SB = window.supabase.createClient(AC.SB_URL, AC.SB_KEY, { auth: { storageKey: AC.AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "implicit" } });
      SB.auth.onAuthStateChange((ev, s) => {
        const was = !!SESSION; SESSION = s || null;
        if (ev === "SIGNED_OUT" || (was && !SESSION)) { UI.step = "email"; draw(); }
        // The gate reads localStorage on its own. Tell it when this client has a new access token.
        // Sign-out already dispatches from signOut(). The startup session event is not a new token.
        if ((ev === "TOKEN_REFRESHED" || ev === "SIGNED_IN") && s && s.access_token) window.dispatchEvent(new Event("ls-auth"));
      });
      return SB;
    });
    return sbP;
  }
  async function session() { const sb = await client(); const { data } = await sb.auth.getSession(); SESSION = (data && data.session) || null; return SESSION; }

  // ---------- state shown on the tab
  const UI = { step: "email", email: "", err: "", info: "", busy: false, cooldownUntil: 0, sync: "idle", syncMsg: "" };
  let tick = null;

  // ---------- sync
  let syncing = null, again = false, debounce = null, lastRun = 0;
  function setSync(st, msg) { UI.sync = st; UI.syncMsg = msg || ""; draw(true); }
  function syncNow() {
    if (syncing) { again = true; return syncing; }
    if (!window.LSBets || !window.LSBets.syncState) return Promise.resolve();
    if (navigator.onLine === false) { setSync("offline", "Offline. Changes are saved on this device and will sync when you're back online."); return Promise.resolve(); }
    lastRun = Date.now();
    syncing = (async () => {
      const s = await session();
      if (!s) { setSync("idle"); return; }
      setSync("syncing");
      for (let attempt = 0; attempt < 3; attempt++) {
        const st = window.LSBets.syncState();
        const { data: rows, error } = await SB.from(AC.TABLE).select("id,bet,deleted,updated_at");
        if (error) throw error;
        const m = AC.merge(st.bets, st.tombs, rows || [], window.BetCore.normalizeBet);
        for (const part of AC.chunks(m.push)) {
          const { error: e2 } = await SB.from(AC.TABLE).upsert(part.map(r => ({ ...r, user_id: s.user.id })), { onConflict: "user_id,id" });
          if (e2) throw e2;
        }
        const pushedDel = new Set(m.push.filter(r => r.deleted).map(r => r.id));
        const tombs = Object.fromEntries(Object.entries(m.tombs).filter(([id]) => !pushedDel.has(id)));
        if (window.LSBets.applySync(m.bets, tombs, st.raw)) {
          const prev = ls.get(AC.SYNC_KEY) || {};
          ls.set(AC.SYNC_KEY, { last: new Date().toISOString(), email: s.user.email, count: m.bets.length, up: m.stats.up, down: m.stats.down, del: m.stats.del, first: prev.first || new Date().toISOString() });
          setSync("ok");
          return m;
        }
      }
      again = true;   // kept being edited mid-sync: try again shortly
    })().catch(e => { setSync("error", AC.syncError(e)); })
      .finally(() => { syncing = null; if (again) { again = false; schedule(1500); } });
    return syncing;
  }
  function schedule(ms = 2000) { if (!hasSession()) return; clearTimeout(debounce); debounce = setTimeout(syncNow, ms); }
  window.addEventListener("ls-bets-changed", () => schedule(2000));          // add, edit, settle, delete (debounced)
  window.addEventListener("online", () => schedule(500));
  const onFocus = () => { if (document.visibilityState === "visible" && hasSession() && Date.now() - lastRun > 30000) schedule(300); };
  document.addEventListener("visibilitychange", onFocus);
  window.addEventListener("focus", onFocus);

  // ---------- magic-link return (implicit "#...#access_token=" or PKCE "?code="): finish sign-in, land on #/account
  const RET = AC.parseAuthReturn(location.href);
  if (RET) { try { history.replaceState(null, "", RET.clean); } catch (e) { location.hash = "#/account"; } }
  async function finishReturn() {
    if (!RET) return;
    if (RET.kind === "error") { UI.err = AC.linkError(RET); UI.step = "email"; draw(); return; }
    UI.busy = true; UI.info = "Finishing sign-in…"; draw();
    try {
      const sb = await client();
      const { error } = RET.kind === "token"
        ? await sb.auth.setSession({ access_token: RET.access_token, refresh_token: RET.refresh_token })
        : await sb.auth.exchangeCodeForSession(RET.code);
      if (error) throw error;
      await signedIn();
    } catch (e) {
      UI.err = RET.kind === "code" ? "That sign-in link has to be opened in the same browser where you asked for it. Enter the code from the email instead, or send a new one." : AC.authError(e);
      UI.step = "email";
    } finally { UI.busy = false; UI.info = ""; draw(); }
  }
  async function signedIn() {
    UI.step = "in"; UI.err = ""; UI.info = "";
    await session();
    draw();
    window.dispatchEvent(new Event("ls-auth"));
    await syncNow();        // first sign-in on this device: uploads the bets already here, pulls the rest
  }

  // ---------- actions
  async function sendCode(email, resend) {
    email = String(email || "").trim();
    UI.email = email;     // keep what was typed across re-renders (errors)
    if (!AC.validEmail(email)) { UI.err = "Enter a valid email address."; draw(); return; }
    if (Date.now() < UI.cooldownUntil && UI.sentTo === email) {   // just sent one: don't burn the hourly email limit
      UI.step = "code"; UI.err = "";
      UI.info = `We already sent a code (or link) to this address a moment ago. Use that email, or resend in ${Math.ceil((UI.cooldownUntil - Date.now()) / 1000)}s.`;
      draw(); return;
    }
    UI.busy = true; UI.err = ""; UI.info = ""; draw();
    try {
      const sb = await client();
      const base = location.origin + location.pathname;
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: base + "#/account" } });
      if (error) throw error;
      UI.step = "code"; UI.sentTo = email; UI.cooldownUntil = Date.now() + AC.RESEND_SECS * 1000;
      UI.info = resend ? "We sent a new code (or link). Use the newest email." : "";
      ls.set("ls-acct-email", email);
    } catch (e) {
      UI.err = AC.authError(e);
      const sec = Number((String((e && e.message) || "").match(/after (\d+) seconds?/i) || [])[1]);
      if (sec) { UI.cooldownUntil = Date.now() + sec * 1000; UI.sentTo = email; }
    } finally { UI.busy = false; draw(); }
  }
  async function verify(code) {
    code = AC.cleanCode(code);
    if (!AC.validCode(code)) { UI.err = "Enter the code from the email (6 to 10 digits)."; draw(); return; }
    UI.busy = true; UI.err = ""; draw();
    try {
      const sb = await client();
      const { error } = await sb.auth.verifyOtp({ email: UI.email, token: code, type: "email" });
      if (error) throw error;
      UI.busy = false;
      await signedIn();
    } catch (e) { UI.err = AC.authError(e); }
    finally { UI.busy = false; draw(); }
  }
  async function signOut() {
    UI.busy = true; draw();
    try { const sb = await client(); await sb.auth.signOut({ scope: "local" }); } catch (e) {}
    ls.del(AC.AUTH_KEY); SESSION = null; if (window.LSAlerts) window.LSAlerts.reset();
    UI.busy = false; UI.step = "email"; UI.sync = "idle"; UI.err = "";
    UI.info = "Signed out. Your bets are still saved on this device; sign in again any time to sync them.";
    draw();
    window.dispatchEvent(new Event("ls-auth"));
  }
  async function deleteCloud() {
    if (!confirm("Delete your LineSmart account data?\n\nThis permanently deletes every bet and line alert saved to your account in the cloud and signs you out. The bets on this device stay here.\n\nTo also delete your email address (the sign-in itself), email contact@linesmart.app.")) return;
    UI.busy = true; UI.err = ""; draw();
    try {
      const s = await session();
      if (!s) throw new Error("not signed in");
      const { error } = await SB.from(AC.TABLE).delete().eq("user_id", s.user.id);
      if (error) throw error;
      // line alerts too (ignore "table not there yet" before the migration is run)
      try { await SB.from("line_alerts").delete().eq("user_id", s.user.id); } catch (e) {}
      if (window.LSAlerts) window.LSAlerts.reset();
      ls.del(AC.TOMB_KEY); ls.del(AC.SYNC_KEY); ls.del("ls-acct-email"); UI.email = "";
      await SB.auth.signOut({ scope: "local" }).catch(() => {});
      ls.del(AC.AUTH_KEY); SESSION = null;
      window.dispatchEvent(new Event("ls-auth"));
      UI.step = "email"; UI.sync = "idle";
      UI.info = "Deleted: your bets and line alerts are no longer stored in your account, and you're signed out. The copy on this device stays. To delete your sign-in email too, email contact@linesmart.app (we'll confirm when it's done).";
    } catch (e) { UI.err = "Couldn't delete right now: " + AC.syncError(e); }
    finally { UI.busy = false; draw(); }
  }

  // ---------- view
  let app = null;
  function view() {
    app = document.getElementById("app");
    window.onresize = null;
    if (window.LSApp && window.LSApp.renderTabs) window.LSApp.renderTabs(null);
    document.title = "Account · LineSmart";
    if (hasSession() && UI.step !== "in") UI.step = "in";
    draw();
    if (/^#\/?account\/alerts/.test(location.hash)) setTimeout(() => { const t = document.getElementById("acAlerts") || document.getElementById("acAlertsInfo"); if (t) t.scrollIntoView({ block: "start" }); }, 0);   // home "Line alerts" link
    if (RET && !finishReturn.done) { finishReturn.done = true; finishReturn(); return; }
    if (hasSession()) session().then(s => { if (!s) { UI.step = "email"; draw(); } else { draw(); if (UI.sync === "idle") syncNow(); } }, e => { UI.err = e.message; draw(); });
    else client().catch(() => {});   // warm up so "Send code" is instant
  }
  const onAccount = () => /^#\/?account/.test(location.hash);
  function draw(soft) {
    if (!app || !onAccount() || !document.getElementById("app")) return;
    if (soft) { const box = app.querySelector(".ac-sync"); if (box) { box.outerHTML = syncBox(); return; } }
    const focus = document.activeElement && document.activeElement.id;
    app.innerHTML = `<div class="page-head ac-head"><div><h1>Account</h1><div class="sub">${UI.step === "in" ? "Signed in · My Bets syncs across your devices" : "Optional · keep the same bets on your phone and computer"}</div></div></div>
      <div class="ac-wrap">${UI.step === "in" ? signedInHtml() : signInHtml()}</div>`;
    bind();
    const f = focus && document.getElementById(focus); if (f && !f.disabled) f.focus();
    clearInterval(tick);
    if (UI.step === "code" && UI.cooldownUntil > Date.now()) tick = setInterval(() => { const b = document.getElementById("acResend"); if (!b || !onAccount()) return clearInterval(tick); const left = Math.ceil((UI.cooldownUntil - Date.now()) / 1000); if (left <= 0) { clearInterval(tick); b.disabled = false; b.textContent = "Resend code"; } else b.textContent = `Resend in ${left}s`; }, 1000);
  }
  const msgs = () => `${UI.err ? `<div class="ac-msg ac-err" role="alert">${esc(UI.err)}</div>` : ""}${UI.info ? `<div class="ac-msg ac-info" role="status">${esc(UI.info)}</div>` : ""}`;
  function signInHtml() {
    const left = Math.max(0, Math.ceil((UI.cooldownUntil - Date.now()) / 1000));
    const n = (window.LSBets && window.LSBets.syncState) ? window.LSBets.syncState().bets.length : 0;
    if (UI.step === "code") return `<form class="card ac-card bt-form" id="acCodeForm" novalidate>
        <h3>Check your email</h3>
        <p class="ac-p">We emailed you a sign-in code (or link) at <b>${esc(UI.email)}</b>. Enter the code here, or tap the link in the email on this device.</p>
        <label class="bt-lbl" for="acCode">Sign-in code</label>
        <input id="acCode" class="ac-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="12" placeholder="8-digit code" required ${UI.busy ? "disabled" : ""}>
        ${msgs()}
        <div class="bt-actions ac-actions"><button type="button" class="chip" id="acBack">Use a different email</button><button type="submit" class="bt-add" ${UI.busy ? "disabled" : ""}>${UI.busy ? "Checking…" : "Verify"}</button></div>
        <div class="ac-resend"><span class="na">Didn't get it? Check spam, or</span> <button type="button" class="lnk" id="acResend" ${left > 0 || UI.busy ? "disabled" : ""}>${left > 0 ? `Resend in ${left}s` : "Resend code"}</button></div>
      </form>${privacyHtml()}`;
    return `<form class="card ac-card bt-form" id="acEmailForm" novalidate>
        <h3>Sign in or create an account</h3>
        <p class="ac-p">Enter your email and we'll send you a sign-in code. No password. Your bets then stay in sync on every device where you sign in.</p>
        <label class="bt-lbl" for="acEmail">Email</label>
        <input id="acEmail" type="email" name="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(UI.email || ls.get("ls-acct-email") || "")}" required ${UI.busy ? "disabled" : ""}>
        ${msgs()}
        <div class="bt-actions ac-actions"><button type="submit" class="bt-add" ${UI.busy ? "disabled" : ""}>${UI.busy ? "Sending…" : "Send code"}</button></div>
        ${n ? `<div class="note">The ${n} bet${n > 1 ? "s" : ""} already on this device will be added to your account when you sign in.</div>` : ""}
      </form>
      <div class="note ac-note">An account is optional. Without one, My Bets keeps working and stays only in this browser on this device.</div>
      <div class="section-title" id="acAlertsInfo">Line alerts</div>
      <div class="card ac-card"><p class="ac-p">Get one email when a line moves or hits your number. Sign in above, then tap <b>🔔 Alert</b> on any game or player prop. Your alerts are listed here.</p></div>${window.LSPro ? window.LSPro.teaser("alerts") : ""}${privacyHtml()}`;
  }
  function syncBox() {
    const st = ls.get(AC.SYNC_KEY) || {};
    const line = UI.sync === "syncing" ? `<span class="ac-dot ac-busy"></span>Syncing…`
      : UI.sync === "error" || UI.sync === "offline" ? `<span class="ac-dot ac-bad"></span>${esc(UI.syncMsg)}`
      : st.last ? `<span class="ac-dot ac-ok"></span>Synced · last synced ${esc(timeET(st.last))}` : `<span class="ac-dot"></span>Not synced yet`;
    const cnt = st.last && UI.sync !== "error" ? `<div class="na">${st.count || 0} bet${st.count === 1 ? "" : "s"} in your account${st.up || st.down || st.del ? ` · last sync: ${[st.up ? `${st.up} sent` : "", st.down ? `${st.down} received` : "", st.del ? `${st.del} removed` : ""].filter(Boolean).join(", ")}` : ""}</div>` : "";
    return `<div class="ac-sync" role="status" aria-live="polite"><div class="ac-line">${line}</div>${cnt}</div>`;
  }
  function signedInHtml() {
    const email = (SESSION && SESSION.user && SESSION.user.email) || (ls.get(AC.SYNC_KEY) || {}).email || "";
    return `<div class="card ac-card">
        <h3>Signed in</h3>
        <div class="ac-email">${email ? esc(email) : `<span class="na">Loading…</span>`}</div>
        ${syncBox()}
        ${msgs()}
        <div class="ac-btns"><button type="button" class="bt-add" id="acSync" ${UI.busy || UI.sync === "syncing" ? "disabled" : ""}>Sync now</button><button type="button" class="chip" id="acOut" ${UI.busy ? "disabled" : ""}>Sign out</button></div>
        <div class="note">Bets sync automatically when you add, edit, settle or delete one, when the site opens, and when you come back to it. Offline changes are kept on this device and sync later. Signing out keeps a copy of your bets on this device.</div>
      </div>
      ${window.LSAlerts ? `<div id="acAlerts">${window.LSAlerts.accountHtml()}</div>` : ""}
      <div class="section-title">Delete your data</div>
      <div class="card ac-card ac-danger">
        <p class="ac-p">Deletes every bet and line alert stored in your account (the cloud copy) and signs you out. Bets on this device aren't touched. Deleting the account itself (your sign-in email) needs a request: email <a href="mailto:contact@linesmart.app?subject=Delete%20my%20LineSmart%20account">contact@linesmart.app</a> from the address you sign in with.</p>
        <button type="button" class="chip bt-del" id="acDel" ${UI.busy ? "disabled" : ""}>Delete my account and bets</button>
      </div>${privacyHtml()}`;
  }
  const privacyHtml = () => `<div class="note ac-note">Accounts store your email address, your tracked bets and any line alerts with our provider Supabase (US). We never sell your data. Sign-in codes are sent by email. <a href="privacy.html#accounts">Privacy policy</a> · <a href="#/bets">My Bets</a></div>`;
  function bind() {
    const q = id => document.getElementById(id);
    q("acEmailForm") && q("acEmailForm").addEventListener("submit", e => { e.preventDefault(); sendCode(q("acEmail").value); });
    q("acCodeForm") && q("acCodeForm").addEventListener("submit", e => { e.preventDefault(); verify(q("acCode").value); });
    ["acCode", "acEmail"].forEach(id => q(id) && q(id).addEventListener("input", () => { if (UI.err) { UI.err = ""; const e = app.querySelector(".ac-err"); if (e) e.remove(); } }));
    q("acBack") && q("acBack").addEventListener("click", () => { UI.step = "email"; UI.err = ""; UI.info = ""; draw(); });
    q("acResend") && q("acResend").addEventListener("click", () => sendCode(UI.email, true));
    q("acSync") && q("acSync").addEventListener("click", () => syncNow());
    q("acOut") && q("acOut").addEventListener("click", signOut);
    q("acDel") && q("acDel").addEventListener("click", deleteCloud);
    if (q("acAlerts") && window.LSAlerts) window.LSAlerts.bindAccount(q("acAlerts"));
  }

  // ---------- boot: a sign-in link landed here, or this device is signed in -> sync once the page is up
  if (RET) { if (!onAccount()) location.hash = "#/account"; }
  else if (hasSession()) setTimeout(() => syncNow(), 1200);
  // client/session for alerts.js (line alerts use the same signed-in Supabase client; RLS keeps rows per user)
  window.LSAccount = { view, syncNow, signedIn: hasSession, client, session };
})();
