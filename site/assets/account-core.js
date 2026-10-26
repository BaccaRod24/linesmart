/* LineSmart Account: pure logic for optional email sign-in + My Bets sync (no DOM, no network), unit-tested by
   scripts/account_test.mjs. The Supabase client itself is vendored (assets/vendor/supabase-js-*.min.js) and only
   loaded by assets/account.js when the Account tab or sync is actually used. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AcctCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // Public project URL + publishable key: safe in client code (row-level security limits every user to their own rows).
  const SB_URL = "https://ctklbryattbbsqdmteny.supabase.co";
  const SB_KEY = "sb_publishable_CP-WGhBFJnoN8exJRtCu2g_CPODay7V";
  const SB_LIB = "vendor/supabase-js-2.118.0.min.js";   // relative to assets/
  const TABLE = "user_bets";
  const AUTH_KEY = "ls-sb-auth";        // supabase-js session storage key (localStorage); present = signed in on this device
  const TOMB_KEY = "ls-bets-tomb-v1";   // {betId: deletedAtISO}: deletions not yet pushed to the cloud
  const SYNC_KEY = "ls-sync-v1";        // {last, email, up, down, del}
  const RESEND_SECS = 60;               // Supabase allows one sign-in email per address per 60 s by default
  const PUSH_CHUNK = 200;

  const t = v => { const n = Date.parse(v || ""); return isFinite(n) ? n : 0; };
  const iso = n => new Date(n).toISOString();
  const strip = b => { const { updatedAt, ...rest } = b || {}; return rest; };
  const sig = b => JSON.stringify(strip(b));

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;
  const validEmail = e => EMAIL_RE.test(String(e || "").trim());
  /** Sign-in codes: Supabase sends 6-10 digits depending on the project setting (8 today). Spaces/dashes ignored. */
  const cleanCode = c => String(c || "").replace(/[\s-]/g, "");
  const validCode = c => /^\d{6,10}$/.test(cleanCode(c));

  /** Every bet gets a stable unique id and an updatedAt (older bets: their createdAt / settledAt / date, else now). */
  function migrate(bets, nowISO, uid) {
    const seen = new Set(); let changed = 0;
    const out = (bets || []).map(b => {
      let n = b;
      if (!n.id || seen.has(String(n.id))) { n = { ...n, id: uid() }; changed++; }
      else if (typeof n.id !== "string") { n = { ...n, id: String(n.id) }; changed++; }
      seen.add(n.id);
      if (!t(n.updatedAt)) {
        const guess = t(n.createdAt) || t(n.settledAt) || t(n.date) || t(nowISO);
        n = { ...n, updatedAt: iso(guess) }; changed++;
      }
      return n;
    });
    return { bets: out, changed };
  }

  /** Compare against the last saved snapshot (id -> signature): bump updatedAt on new/changed bets, list removed ids. */
  function stamp(prevSig, bets, nowISO) {
    const next = {}, removed = [];
    const out = bets.map(b => {
      const s = sig(b); next[b.id] = s;
      return prevSig[b.id] === s && t(b.updatedAt) ? b : { ...b, updatedAt: nowISO };
    });
    for (const id of Object.keys(prevSig)) if (!(id in next)) removed.push(id);
    return { bets: out, removed, sig: next };
  }
  const snapshot = bets => Object.fromEntries((bets || []).map(b => [b.id, sig(b)]));

  /**
   * Row-by-row merge of this device (bets + tombstones) with the cloud rows ({id, bet, deleted, updated_at}).
   * Newest updatedAt wins; deletes are soft (deleted=true rows). Returns the new local list, the tombstones still
   * to keep, the rows to upsert, and counts. normalize: BetCore.normalizeBet (drops junk rows).
   */
  function merge(local, tombs, rows, normalize = b => b) {
    const L = new Map((local || []).map(b => [String(b.id), b]));
    const T = { ...(tombs || {}) };
    const R = new Map((rows || []).filter(r => r && r.id !== undefined && r.id !== null).map(r => [String(r.id), r]));
    const bets = [], fresh = [], push = [], stats = { up: 0, down: 0, del: 0 };
    const ids = [...new Set([...L.keys(), ...Object.keys(T), ...R.keys()])];
    for (const id of ids) {
      const l = L.get(id), tomb = T[id], r = R.get(id);
      const lt = l ? t(l.updatedAt) : tomb ? t(tomb) : -1;
      const localDeleted = !l && !!tomb;
      const rt = r ? t(r.updated_at) || t(r.bet && r.bet.updatedAt) : -1;
      if (r && rt > lt) {                                   // cloud is newer
        delete T[id];
        if (r.deleted) { if (l) stats.del++; continue; }
        const nb = normalize({ ...(r.bet || {}), id, updatedAt: iso(rt) });
        if (!nb) { if (l) bets.push(l); continue; }
        if (!l || sig(l) !== sig(nb)) stats.down++;
        (l ? bets : fresh).push(nb);
      } else if (lt > rt) {                                 // this device is newer (or the cloud doesn't have it)
        if (localDeleted) push.push({ id, bet: { id }, deleted: true, updated_at: iso(lt) });
        else { bets.push(l); push.push({ id, bet: l, deleted: false, updated_at: l.updatedAt }); stats.up++; }
      } else {                                              // same timestamp: already in sync
        if (l) bets.push(l);
        if (localDeleted && r && r.deleted) delete T[id];
        else if (localDeleted && r && !r.deleted) push.push({ id, bet: { id }, deleted: true, updated_at: iso(lt) });  // tie: a delete wins
      }
    }
    return { bets: [...fresh, ...bets], tombs: T, push, stats };
  }
  const chunks = (a, n = PUSH_CHUNK) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

  /** Friendly message for a Supabase auth / network error. */
  function authError(e) {
    const st = e && (e.status || e.statusCode), code = String((e && e.code) || ""), m = String((e && (e.message || e.error_description || e.msg)) || e || "");
    const all = code + " " + m;
    if (st === 429 || /rate.?limit|too many|over_email_send|over_request|after \d+ seconds/i.test(all)) {
      const sec = (m.match(/after (\d+) seconds?/i) || [])[1];
      return sec ? `Too many requests. You can ask for a new code in ${sec} seconds.` : "Too many requests, try again later. Sign-in emails are limited per hour, so use the latest code or link you received.";
    }
    if (/otp_expired|token has expired|expired|invalid.*(otp|token)|(otp|token).*invalid/i.test(all)) return "That code is wrong or has expired. Use the newest email, or send a new code.";
    if (/email_address_invalid|invalid.*email|validate email|email.*invalid/i.test(all)) return "That email address doesn't look right.";
    if (/signup.*(disabled|not allowed)|signups not allowed/i.test(all)) return "New sign-ups are paused right now. Please try again later.";
    if (/email_address_not_authorized|not authorized/i.test(all)) return "Sign-in emails can't be sent to that address yet. Please try again later.";
    if (/failed to fetch|networkerror|network|load failed|offline|timeout/i.test(all)) return "Couldn't reach the sign-in server. Check your connection and try again.";
    return "Something went wrong" + (m ? `: ${m.slice(0, 160)}` : ". Please try again.");
  }
  function syncError(e) {
    const st = e && (e.status || e.statusCode), m = String((e && e.message) || e || "");
    if (st === 401 || /jwt|expired|not authenticated|session/i.test(m)) return "Your sign-in expired. Sign in again to keep syncing.";
    if (/failed to fetch|networkerror|network|load failed|offline/i.test(m)) return "Offline. Changes are saved on this device and will sync when you're back online.";
    return "Sync failed" + (m ? `: ${m.slice(0, 160)}` : "") + ". Your bets are safe on this device.";
  }

  /**
   * Auth details in the landing URL after a magic link. Implicit flow appends the tokens as a second fragment
   * ("#/account#access_token=..."), PKCE adds "?code=...". Returns {kind, ...} or null, and the clean URL to show.
   */
  function parseAuthReturn(href) {
    let u; try { u = new URL(href); } catch (e) { return null; }
    const hash = u.hash || "", q = u.searchParams;
    const at = hash.search(/[#&/]?(access_token|error|error_code)=/);
    let res = null, route = hash;
    if (at >= 0) {
      const tail = hash.slice(at).replace(/^[#&/]/, "");
      const p = new URLSearchParams(tail);
      route = hash.slice(0, at).replace(/#$/, "");
      if (p.get("access_token")) res = { kind: "token", access_token: p.get("access_token"), refresh_token: p.get("refresh_token") || "", type: p.get("type") || "" };
      else if (p.get("error") || p.get("error_code")) res = { kind: "error", error: p.get("error") || "", code: p.get("error_code") || "", description: (p.get("error_description") || "").replace(/\+/g, " ") };
    }
    if (!res && q.get("code")) res = { kind: "code", code: q.get("code") };
    if (!res && (q.get("error") || q.get("error_code"))) res = { kind: "error", error: q.get("error") || "", code: q.get("error_code") || "", description: q.get("error_description") || "" };
    if (!res) return null;
    for (const k of ["code", "error", "error_code", "error_description", "type"]) u.searchParams.delete(k);
    if (!/^#\/?account/.test(route)) route = "#/account";
    u.hash = route;
    return { ...res, clean: u.pathname + (u.searchParams.toString() ? "?" + u.searchParams : "") + route };
  }
  function linkError(r) {
    const all = `${r.code} ${r.error} ${r.description}`;
    if (/otp_expired|expired/i.test(all)) return "That sign-in link has expired or was already used. Send a new code (or link) below.";
    if (/access_denied/i.test(all)) return "That sign-in link didn't work. Send a new code (or link) below.";
    return "Sign-in didn't finish" + (r.description ? `: ${r.description}` : ".") + " Send a new code (or link) below.";
  }

  return { SB_URL, SB_KEY, SB_LIB, TABLE, AUTH_KEY, TOMB_KEY, SYNC_KEY, RESEND_SECS, PUSH_CHUNK,
    validEmail, cleanCode, validCode, migrate, stamp, snapshot, merge, chunks, authError, syncError, parseAuthReturn, linkError };
});
