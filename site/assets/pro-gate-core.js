/* LineSmart Pro gate: the decision the public page is allowed to make.
   true only when the is_pro() RPC body is the boolean true. Browser flags are ignored.
   The screens live in the private bundle, not in this file. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProGateCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const ROUTE = "owner";
  const BUCKET = "pro-private";
  const OBJECT = "pro-app.js";
  const RPC = "is_pro";
  // Names a visitor might set. None of them are read by allow().
  const IGNORED_FLAGS = ["ls-pro", "ls-pro-on", "isPro", "pro", "linesmart-pro", "ls-pro-access"];

  /** The server said yes. A string, a 1, or an object is not yes. */
  function allow(body) {
    return body === true;
  }
  /** is_pro() outcome. Only boolean true/false are definite. HTTP errors and any other body are unknown. */
  function verdict(body, httpOk) {
    if (httpOk !== true) return "unknown";
    if (body === true) return "yes";
    if (body === false) return "no";
    return "unknown";
  }
  /** Tear Pro down only on sign-out (no token) or a definite false. A blip must not hide a session that already verified. */
  function shouldHide(hasToken, result) {
    if (!hasToken) return true;
    return result === "no";
  }
  function sessionObj(raw) {
    if (raw == null || raw === "") return null;
    let j = raw;
    if (typeof raw === "string") {
      try { j = JSON.parse(raw); } catch (e) { return null; }
    }
    return j && typeof j === "object" ? j : null;
  }
  function tokenOf(raw) {
    const j = sessionObj(raw);
    if (!j) return "";
    const t = j.access_token || (j.currentSession && j.currentSession.access_token) || "";
    return typeof t === "string" ? t : "";
  }
  function hasRefresh(raw) {
    const j = sessionObj(raw);
    return !!(j && typeof j.refresh_token === "string" && j.refresh_token);
  }
  function jwtExp(token) {
    const part = String(token || "").split(".")[1];
    if (!part) return 0;
    try {
      const pad = part.length % 4 === 0 ? "" : "=".repeat(4 - (part.length % 4));
      const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad));
      return typeof json.exp === "number" ? json.exp : 0;
    } catch (e) { return 0; }
  }
  /** Seconds since epoch when this access token stops working. 0 when the session doesn't say. */
  function expirySec(raw) {
    const j = sessionObj(raw);
    if (!j) return 0;
    if (typeof j.expires_at === "number" && isFinite(j.expires_at)) return j.expires_at;
    return jwtExp(tokenOf(j));
  }
  /** True when a stored session cannot be used as-is: no access token, or it is already expired. A missing session is not stale. */
  function accessStale(raw, nowMs) {
    const j = sessionObj(raw);
    if (!j) return false;
    if (!tokenOf(j)) return hasRefresh(j);
    const exp = expirySec(j);
    if (!exp) return false;
    const now = Math.floor((nowMs == null ? Date.now() : nowMs) / 1000);
    return exp <= now + 60;
  }
  /** Which Pro surface this page is, without reading the network or any browser flag. */
  function pageContext(input) {
    const src = input || {};
    const hash = String(src.hash || "");
    const path = hash.replace(/^#\/?/, "").split("?")[0];
    const segs = path ? path.split("/") : [];
    const page = src.page || "";
    const lgAttr = src.lg || "";
    const route = String(src.route || "");
    const base = { hash, page, lg: lgAttr, id: "", kind: "other" };
    const dec = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
    if (segs[0] === "owner") return { ...base, kind: "owner" };
    if (segs[0] === "g" && segs[1] && segs[2]) return { ...base, kind: "game", lg: segs[1], id: dec(segs[2]) };
    if (segs[0] === "p" && segs[1] && segs[2]) return { ...base, kind: "props", lg: segs[1], id: dec(segs[2]) };
    if (segs[0] === "bets") return { ...base, kind: "bets" };
    if (segs[0] === "l" && segs[1]) return { ...base, kind: "league", lg: segs[1] };
    if (segs[0]) return base;
    if (page === "game") {
      const r = route.split("/");
      const id = (r[2] && dec(r[2])) || src.gid || "";
      return { ...base, kind: "game", lg: r[1] || lgAttr, id };
    }
    if (page === "player") {
      let id = src.pid || "";
      let plg = lgAttr;
      const m = src.playerHref && /#\/p\/([^/]+)\/([^/?#]+)/.exec(src.playerHref);
      if (m) { plg = dec(m[1]); if (!id) id = dec(m[2]); }
      return { ...base, kind: "props", lg: plg, id };
    }
    if (page === "hub") return { ...base, kind: "league", lg: lgAttr };
    if (page === "results") return { ...base, kind: "results", lg: lgAttr };
    if (!page) return { ...base, kind: "home" };
    return { ...base, kind: page };
  }
  /** ESPN id for a generated page path. pages.json stores "nfl/games/slug/" and "nfl/props/name/", not the slug as the id. */
  function idFromPages(pages, pathname) {
    let path = String(pathname || "").split("?")[0].split("#")[0].replace(/\/index\.html$/, "/");
    if (!path.startsWith("/")) path = "/" + path;
    if (path.length > 1 && !path.endsWith("/")) path += "/";
    const maps = [["g", "game"], ["p", "props"]];
    for (const [key, kind] of maps) {
      const byLg = (pages && pages[key]) || {};
      for (const [lg, map] of Object.entries(byLg)) {
        for (const [id, rel] of Object.entries(map || {})) {
          let norm = "/" + String(rel || "").replace(/^\/+/, "");
          if (norm.length > 1 && !norm.endsWith("/")) norm += "/";
          if (norm === path) return { lg, id: String(id), kind };
        }
      }
    }
    return null;
  }
  function isOwnerHash(hash) {
    const h = String(hash || "").replace(/^#\/?/, "").split("?")[0].split("/")[0];
    return h === ROUTE;
  }
  const rpcUrl = base => String(base || "").replace(/\/$/, "") + "/rest/v1/rpc/" + RPC;
  const bundleUrl = base => String(base || "").replace(/\/$/, "") + "/storage/v1/object/" + BUCKET + "/" + OBJECT;

  return { ROUTE, BUCKET, OBJECT, RPC, IGNORED_FLAGS, allow, verdict, shouldHide, tokenOf, hasRefresh, expirySec, accessStale, pageContext, idFromPages, isOwnerHash, rpcUrl, bundleUrl };
});
