/* LineSmart line alerts UI: the "🔔 Alert" sheet (game cards, game pages, prop rows) and the "Line alerts" list in Account.
 * Rules and validation live in alerts-core.js (window.AlertsCore). Alerts are rows in Supabase table line_alerts, readable
 * and deletable only by their owner (RLS); the checker (scripts/line_alerts.mjs) emails each one at most once.
 * Books offered follow the state rules (assets/geo.js): in Florida only Hard Rock Bet. */
(() => {
  const C = window.AlertsCore;
  const A = () => window.LSApp;
  const ACC = () => window.LSAccount;
  const G = () => window.LSGeo || null;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const alertCap = () => (window.LSProApp && window.LSProApp.alertCap) || C.MAX_ACTIVE;
  const allowed = () => C.allowedBooks(G() ? k => G().isAvailable(k) : null);
  const kick = d => (A() && A().fullET ? A().fullET(d) : new Date(d).toLocaleString());
  const fmtV = (kind, v) => (kind === "ml_target" ? C.fmtOdds(v) : /total/.test(kind) || kind === "prop_move" ? C.fmtTotal(v) : C.fmtLine(v));

  // ---------- bell markup (called by app.js and props.js)
  const tileBell = (lg, g) => (g && g.state === "pre" && g.books ? `<button type="button" class="al-bell al-tile" data-al="${esc(lg)}/${esc(g.id)}" aria-label="${esc(`Line alert: ${g.away.name} at ${g.home.name}`)}" title="Line alert"><span class="al-bell-face"><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-bell"/></svg></span></button>` : "");
  const pageBell = (lg, g) => (g && g.state === "pre" ? `<button type="button" class="al-bell al-txt" data-al="${esc(lg)}/${esc(g.id)}"><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-bell"/></svg> Alert</button>` : "");
  // compact "Get a line alert" entry under the odds table (game view; static pages get the same markup from scripts/seo_pages.py)
  const pageCta = (lg, g) => (g && g.state === "pre" ? `<div class="al-cta"><button type="button" class="al-cta-btn" data-al="${esc(lg)}/${esc(g.id)}"><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-bell"/></svg> Get a line alert</button><span class="al-cta-note">Get an email when this line moves or hits your number. Free account, up to 5 alerts a day.</span></div>` : "");
  const propBell = (lg, gid, pid, mk, name, label) => `<button type="button" class="al-bell pp-al" data-al-prop="${esc([lg, gid, pid, mk].join("|"))}" data-name="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(`Line alert: ${name} ${label}`)}"><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-bell"/></svg> Alert</button>`;

  // ---------- sheet
  let dlg = null, S = null;
  function dialog() {
    if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "alDlg"; dlg.className = "bt-dlg al-dlg"; dlg.setAttribute("aria-labelledby", "alT"); document.body.appendChild(dlg); }
    return dlg;
  }
  const show = () => { const d = dialog(); if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); } };
  const close = () => { if (dlg) { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); } };

  function signInSheet(spec) {
    const d = dialog();
    const rg = window.LSGeo ? window.LSGeo.rgSpan() : "";
    const say = (err, info) => {
      const box = d.querySelector(".al-sign-msg");
      if (!box) return;
      box.className = "al-sign-msg" + (err ? " ac-err" : info ? " ac-info" : "");
      box.textContent = err || info || "";
      if (err) box.setAttribute("role", "alert"); else box.setAttribute("role", "status");
    };
    const emailStep = (err) => {
      d.innerHTML = `<div class="bt-dl al-dl"><h3 id="alT"><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-bell"/></svg> Line alerts</h3>
        <p class="ac-p">Sign in to get an email when the line hits your number. A free account, no password. You pick the target, you get one email if it hits, and the alert turns off. It expires at game start.</p>
        <form id="alSign" novalidate>
          <label class="bt-lbl" for="alEm">Email</label>
          <input id="alEm" type="email" name="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" required>
          <div class="al-sign-msg${err ? " ac-err" : ""}" ${err ? 'role="alert"' : 'role="status"'}>${esc(err || "")}</div>
          <div class="bt-dl-foot"><a class="lnk" href="#/account" data-x>Account</a><span style="flex:1"></span><button type="button" class="chip" data-x>Not now</button><button type="submit" class="bt-add">Email me a code</button></div>
        </form>
        <p class="ac-p">Florida: Hard Rock Bet is the only legal online sportsbook in Florida. DraftKings and FanDuel prices are shown for comparison where they're legal.</p>
        <p class="al-rg">21+ | Gambling problem? ${rg}</p></div>`;
      d.querySelectorAll("[data-x]").forEach(b => b.addEventListener("click", close));
      const form = d.querySelector("#alSign");
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const email = form.email.value;
        const btn = form.querySelector('button[type="submit"]');
        if (!ACC() || !ACC().requestOtp) { say("Open the Account tab to sign in."); return; }
        if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
        const r = await ACC().requestOtp(email, "bell");
        if (!r.ok) { emailStep(r.error || "Something went wrong. Please try again."); return; }
        codeStep(r.email, r.info || "");
      });
      const keep = d.querySelector("#alEm"); if (keep && err) keep.focus();
    };
    const codeStep = (email, info) => {
      d.innerHTML = `<div class="bt-dl al-dl"><h3 id="alT"><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-bell"/></svg> Check your email</h3>
        <p class="ac-p">We emailed a sign-in code (or link) to <b>${esc(email)}</b>. Enter the code here, or tap the link on this device. Then you can set the alert.</p>
        <form id="alCode" novalidate>
          <label class="bt-lbl" for="alCd">Sign-in code</label>
          <input id="alCd" class="ac-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="8-digit code" required>
          <div class="al-sign-msg${info ? " ac-info" : ""}" role="status">${esc(info || "")}</div>
          <div class="bt-dl-foot"><button type="button" class="chip" id="alBack">Use a different email</button><span style="flex:1"></span><button type="button" class="chip" data-x>Not now</button><button type="submit" class="bt-add">Verify</button></div>
        </form>
        <p class="al-rg">21+ | Gambling problem? ${rg}</p></div>`;
      d.querySelectorAll("[data-x]").forEach(b => b.addEventListener("click", close));
      d.querySelector("#alBack").addEventListener("click", () => emailStep(""));
      d.querySelector("#alCode").addEventListener("submit", async e => {
        e.preventDefault();
        const code = d.querySelector("#alCd").value;
        const btn = d.querySelector('#alCode button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
        const r = await ACC().verifyCode(code, email);
        if (!r.ok) { say(r.error || "That code didn't work."); if (btn) { btn.disabled = false; btn.textContent = "Verify"; } return; }
        open(spec);
      });
    };
    emailStep("");
    show();
  }
  async function maybeWaitlist(host) {
    const Pro = window.LSPro;
    if (!Pro || !Pro.waitlistCard || !host) return;
    try {
      if (localStorage.getItem("ls-pro-nudge-3") === "1" || localStorage.getItem("ls-pro-v1")) return;
    } catch (e) { return; }
    try {
      const sb = await ACC().client();
      const { data, error } = await sb.from(C.TABLE).select("id");
      if (error || !data || data.length < 3) return;
      localStorage.setItem("ls-pro-nudge-3", "1");
      host.insertAdjacentHTML("beforeend", Pro.waitlistCard("alert3"));
      Pro.bindWaitlist(host);
    } catch (e) { /* the alert is already saved; the waitlist card can wait for the Account tab */ }
  }
  async function open(spec) {
    const d = dialog();
    if (!ACC() || !ACC().signedIn()) return signInSheet(spec);
    d.innerHTML = `<div class="bt-dl al-dl"><h3 id="alT"><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-bell"/></svg> Line alert</h3><div class="na">Loading lines…</div></div>`;
    show();
    try {
      const idx = await A().getJSON(`data/${spec.lg}/index.json`);
      const g = (idx.games || []).find(x => String(x.id) === String(spec.gid));
      const props = spec.pid ? await A().getJSON(`data/props/${spec.lg}.json`).catch(() => null) : null;
      if (!g) throw new Error("This game isn't in the data any more.");
      S = { ...spec, g, props, soccer: idx.league.kind === "soccer" || idx.league.kind === "mma",
        f: { kind: spec.pid ? "prop_move" : (idx.league.kind === "soccer" || idx.league.kind === "mma") ? "ml_target" : "spread_move", side: "home", points: 1, target: "", books: allowed() } };
      if (S.f.kind === "prop_move") Object.assign(S.f, { player_id: spec.pid, prop_market: spec.mk, player_name: spec.name, prop_label: spec.label, side: null });
      S.f.target = suggest();
      render();
    } catch (e) { d.querySelector(".na").textContent = e.message || "Couldn't load this game's lines."; }
  }
  const sideOpts = k => (k === "total_target" ? [["over", "Over"], ["under", "Under"]] : k === "spread_move" || k === "spread_target" || k === "ml_target" ? [["away", S.g.away.abbr], ["home", S.g.home.abbr]] : []);
  const cur = () => C.currentValues(S.g, S.f.kind, S.f.side, allowed(), S.props, S.f.player_id, S.f.prop_market);
  function suggest() {
    const v = Object.values(cur())[0]; if (!v) return "";
    const x = v.value, k = S.f.kind;
    if (k === "spread_target") return x + 0.5;
    if (k === "total_target") return S.f.side === "under" ? x + 0.5 : x - 0.5;
    if (k === "ml_target") return x >= 100 ? x + 10 : x + 10 <= -100 ? x + 10 : 100;
    return "";
  }
  function render(msg) {
    const d = dialog(), f = S.f, g = S.g, ok = allowed();
    const kinds = S.pid ? ["prop_move"] : Object.keys(C.KINDS).filter(k => k !== "prop_move" && (!S.soccer || k === "ml_target" || k === "total_move" || k === "total_target"));
    const sides = sideOpts(f.kind);
    const now = cur();
    const ev = G() ? G().current() : {};
    const bookRow = k => `<label class="al-bk${f.books.includes(k) ? " on" : ""}"><input type="checkbox" name="bk" value="${k}" ${f.books.includes(k) ? "checked" : ""} ${ok.length === 1 ? "disabled" : ""}><span>${esc(C.BOOK_NAME[k])}</span><b>${now[k] ? esc(fmtV(f.kind, now[k].value)) : `<span class="na">no line</span>`}</b></label>`;
    const move = /_move$/.test(f.kind);
    const prev = C.build(f, { game: g, league: S.lg, props: S.props, allowed: ok, now: Date.now() });
    const title = S.pid ? `${esc(f.player_name)} · ${esc(f.prop_label)}` : `${esc(g.away.name)} at ${esc(g.home.name)}`;
    d.innerHTML = `<form class="bt-dl al-dl" novalidate><h3 id="alT"><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-bell"/></svg> Line alert</h3>
      <div class="bt-dl-sel"><b>${title}</b><span class="na">${esc(S.pid ? `${g.away.abbr} @ ${g.home.abbr} · ` : "")}${esc(kick(g.date))}</span></div>
      ${ok.length ? `
      ${kinds.length > 1 ? `<div class="bt-lbl" id="alK">Email me when</div><div class="al-kinds" role="radiogroup" aria-labelledby="alK">${kinds.map(k => `<button type="button" role="radio" aria-checked="${k === f.kind}" class="chip${k === f.kind ? " on" : ""}" data-k="${k}">${esc(C.KINDS[k].label)}</button>`).join("")}</div>` : `<div class="bt-lbl">Email me when the line moves</div>`}
      ${sides.length ? `<div class="bt-lbl" id="alS">${f.kind === "total_target" ? "Side" : "Team"}</div><div class="seg al-seg" role="radiogroup" aria-labelledby="alS">${sides.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === f.side}" class="${v === f.side ? "on" : ""}" data-s="${v}">${esc(l)}</button>`).join("")}</div>` : ""}
      <label class="bt-lbl" for="alN">${move ? "Moves by at least (points)" : f.kind === "ml_target" ? "Price (or better)" : f.kind === "total_target" ? `${f.side === "under" ? "Under" : "Over"} at (or better)` : "Spread (or better)"}</label>
      <input id="alN" name="n" type="number" inputmode="decimal" ${move ? `step="0.5" min="0.5" max="20" value="${esc(f.points)}"` : `step="${f.kind === "ml_target" ? 5 : 0.5}" value="${esc(f.target)}" placeholder="${f.kind === "ml_target" ? "+150" : "-2.5"}"`}>
      <div class="bt-lbl">Sportsbook${ok.length > 1 ? "s" : ""} <span class="na">· now</span></div><div class="al-bks">${ok.map(bookRow).join("")}</div>
      ${ok.length === 1 && ev.stateName ? `<div class="note">${esc(ev.stateName)}: only ${esc(C.BOOK_NAME[ok[0]])} runs a legal online sportsbook, so alerts use its lines.</div>` : ""}
      <div class="al-prev" role="status">${prev.ok ? `<b>${esc(C.describe(prev.row))}</b><span class="na">One email, then the alert turns off. Ends at the start of the game.</span>${msg ? `<span class="al-why" role="alert">${esc(msg)}</span>` : ""}` : `<span class="al-why">${esc(msg || prev.error)}</span>`}</div>
      <div class="bt-dl-foot"><a class="lnk al-man" href="#/account" data-x>My alerts</a><span style="flex:1"></span><button type="button" class="chip" data-x>Cancel</button><button type="submit" class="bt-add" ${prev.ok ? "" : "disabled"}>Set alert</button></div>`
      : `<p class="ac-p">Line alerts cover Hard Rock Bet, DraftKings and FanDuel where they're legal online. None of them is in ${esc(ev.stateName || "your state")}, so alerts aren't available there.</p><div class="bt-dl-foot"><span style="flex:1"></span><button type="button" class="chip" data-x>Close</button></div>`}
      <p class="al-rg">21+ | Gambling problem? ${window.LSGeo.rgSpan()}</p></form>`;
    wire(d);
  }
  function wire(d) {
    d.querySelectorAll("[data-x]").forEach(b => b.addEventListener("click", close));
    d.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => {
      S.f.kind = b.dataset.k;
      if (S.f.kind === "total_target" && !["over", "under"].includes(S.f.side)) S.f.side = "over";
      if (S.f.kind !== "total_target" && !["home", "away"].includes(S.f.side)) S.f.side = "home";
      S.f.target = suggest(); render(); const k = d.querySelector(`[data-k="${S.f.kind}"]`); if (k) k.focus();
    }));
    d.querySelectorAll("[data-s]").forEach(b => b.addEventListener("click", () => { S.f.side = b.dataset.s; S.f.target = suggest(); render(); const s = d.querySelector(`[data-s="${S.f.side}"]`); if (s) s.focus(); }));
    const n = d.querySelector("#alN");
    if (n) n.addEventListener("change", () => { if (/_move$/.test(S.f.kind)) S.f.points = n.value; else S.f.target = n.value; render(); const x = d.querySelector("#alN"); if (x) x.focus(); });
    d.querySelectorAll('input[name="bk"]').forEach(c => c.addEventListener("change", () => { S.f.books = [...d.querySelectorAll('input[name="bk"]:checked')].map(x => x.value); render(); }));
    const form = d.querySelector("form");
    if (form) form.addEventListener("submit", e => { e.preventDefault(); if (n) { if (/_move$/.test(S.f.kind)) S.f.points = n.value; else S.f.target = n.value; } save(); });
  }
  async function save() {
    const prev = C.build(S.f, { game: S.g, league: S.lg, props: S.props, allowed: allowed(), now: Date.now() });
    if (!prev.ok) return render(prev.error);
    const btn = dialog().querySelector('button[type="submit"]'); if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      const sb = await ACC().client();
      const { error } = await sb.from(C.TABLE).insert(prev.row);
      if (error) throw error;
      LIST = null;
      const s = await ACC().session().catch(() => null), email = s && s.user && s.user.email;
      dialog().innerHTML = `<div class="bt-dl al-dl"><h3 id="alT"><svg class="ic" aria-hidden="true" focusable="false"><use href="#i-bell"/></svg> Alert set</h3>
        <p class="ac-p"><b>${esc(C.describe(prev.row))}</b></p>
        <p class="ac-p">We'll email ${email ? `<b>${esc(email)}</b>` : "you"} once if it happens before the game starts. We check after each odds update (about every 30 minutes), so a quick move and move back can be missed.</p>
        <div class="bt-dl-foot"><a class="lnk" href="#/account" data-x>Manage alerts</a><span style="flex:1"></span><button type="button" class="bt-add" data-x>Done</button></div>
        <div id="alWait"></div></div>`;
      dialog().querySelectorAll("[data-x]").forEach(b => b.addEventListener("click", close));
      maybeWaitlist(dialog().querySelector("#alWait"));
    } catch (e) {
      const msg = window.LSProApp && /alert_limit/.test(String((e && (e.message || e.hint)) || e || ""))
        ? `You already have ${alertCap()} active alerts. Delete one in Account to add another.`
        : C.insertError(e);
      render(msg);
    }
  }

  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-al],[data-al-prop]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.al) { const [lg, gid] = b.dataset.al.split("/"); open({ lg, gid }); }
    else { const [lg, gid, pid, mk] = b.dataset.alProp.split("|"); open({ lg, gid, pid, mk, name: b.dataset.name, label: b.dataset.label }); }
  });

  // ---------- Account: "Line alerts" list
  let LIST = null, LOADING = false, LERR = "", HOST = null;
  async function load() {
    if (LOADING) return; LOADING = true; LERR = "";
    try {
      const sb = await ACC().client();
      const { data, error } = await sb.from(C.TABLE).select("*").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      LIST = data || [];
    } catch (e) { LERR = /relation|does not exist|schema cache/i.test(String(e && e.message)) ? "Line alerts aren't switched on yet." : "Couldn't load your alerts right now."; LIST = LIST || []; }
    finally { LOADING = false; paint(); }
  }
  function accountHtml() {
    if (LIST === null && !LOADING) setTimeout(load, 0);
    const now = Date.now(), rows = LIST || [];
    const act = rows.filter(a => C.status(a, now).key === "active").length;
    const row = a => { const st = C.status(a, now);
      return `<li class="al-row al-k-${st.key}"><div class="al-main"><b>${esc(C.describe(a))}</b><span class="na">${esc(a.game_label)} · ${esc(kick(a.starts_at))}</span>
        ${st.key === "fired" && a.fired_value != null ? `<span class="al-fired">Sent ${esc(kick(a.fired_at))}: ${esc(C.BOOK_NAME[a.fired_book] || "")} ${esc(fmtV(a.kind, +a.fired_value))}</span>` : ""}</div>
        <span class="al-st al-st-${st.key}">${esc(st.text)}</span><button type="button" class="chip al-del" data-al-del="${esc(a.id)}" aria-label="${esc(`Delete alert: ${C.describe(a)}`)}">Delete</button></li>`; };
    return `<div class="section-title">Line alerts <span class="st-sub">${act} of ${alertCap()} active</span></div>
      <div class="card ac-card al-acct">${LERR ? `<div class="ac-msg ac-err" role="alert">${esc(LERR)}</div>` : ""}${LIST === null ? `<div class="na">Loading your alerts…</div>`
        : LERR && !rows.length ? ""
        : rows.length ? `<ul class="al-list">${rows.map(row).join("")}</ul>` : `<p class="ac-p">No alerts yet. Tap <b>Alert</b> on a game or player prop to get one email when the line moves or hits your number.</p>`}
        <div class="note">Each alert emails you once, then turns off, and ends when the game starts. Up to ${alertCap()} active alerts. Checked after each odds update, about every 30 minutes. Every alert email has a link back here to stop alerts.</div>
        ${rows.length ? `<div class="ac-btns"><button type="button" class="chip bt-del" data-al-delall>Delete all alerts</button></div>` : ""}</div>
      ${window.LSPro ? window.LSPro.teaser("alerts") : ""}`;
  }
  function paint() { if (HOST && HOST.isConnected) { HOST.innerHTML = accountHtml(); } }
  function bindAccount(host) {
    HOST = host; if (!host || host.dataset.alBound) return; host.dataset.alBound = "1";
    host.addEventListener("click", async e => {
      const one = e.target.closest("[data-al-del]"), all = e.target.closest("[data-al-delall]");
      if (!one && !all) return;
      if (all && !confirm("Delete all your line alerts?")) return;
      (one || all).disabled = true;
      try {
        const sb = await ACC().client(), s = await ACC().session();
        const q = sb.from(C.TABLE).delete();
        const { error } = one ? await q.eq("id", one.dataset.alDel) : await q.eq("user_id", s.user.id);
        if (error) throw error;
        LIST = one ? LIST.filter(a => a.id !== one.dataset.alDel) : []; LERR = "";
      } catch (err) { LERR = "Couldn't delete right now. Try again."; }
      paint();
    });
  }
  const reset = () => { LIST = null; LERR = ""; };

  window.LSAlerts = { tileBell, pageBell, pageCta, propBell, open, accountHtml, bindAccount, reset };
})();
