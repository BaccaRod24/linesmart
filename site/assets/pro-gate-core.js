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
  function tokenOf(raw) {
    if (raw == null || raw === "") return "";
    let j = raw;
    if (typeof raw === "string") {
      try { j = JSON.parse(raw); } catch (e) { return ""; }
    }
    if (!j || typeof j !== "object") return "";
    const t = j.access_token || (j.currentSession && j.currentSession.access_token) || "";
    return typeof t === "string" ? t : "";
  }
  function isOwnerHash(hash) {
    const h = String(hash || "").replace(/^#\/?/, "").split("?")[0].split("/")[0];
    return h === ROUTE;
  }
  const rpcUrl = base => String(base || "").replace(/\/$/, "") + "/rest/v1/rpc/" + RPC;
  const bundleUrl = base => String(base || "").replace(/\/$/, "") + "/storage/v1/object/" + BUCKET + "/" + OBJECT;

  return { ROUTE, BUCKET, OBJECT, RPC, IGNORED_FLAGS, allow, verdict, shouldHide, tokenOf, isOwnerHash, rpcUrl, bundleUrl };
});
