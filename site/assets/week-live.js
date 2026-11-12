/* Week-list LIVE badge (nav.sx-discover game rows). No network.
 * Build HTML already badges state "in". Between builds this corrects the row:
 *   - LSLive overlay when the page is already polling that game (same store as the tiles)
 *   - otherwise kickoff vs now, same 2 min before / 7 h after window as LiveCore.needsLive
 * A finished game (state post, or the live overlay says so) says Final, never LIVE.
 * The collapsed games heading shows "N live" from those same rows. Nothing is fetched.
 * Browser: window.WeekLive. Node: require("./week-live.js"). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.WeekLive = api;
    var tick = function () { if (!document.hidden) api.paint(document); };
    var start = function () {
      if (!document.querySelector("a[data-start]")) return;
      tick();
      setInterval(tick, 15000);
      document.addEventListener("visibilitychange", tick);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var GRACE = 2 * 60 * 1000, MAX = 7 * 3600 * 1000;
  var BADGE = '<span class="sx-live-badge"><span class="live-dot" aria-hidden="true"></span><span class="sx-live-tx">LIVE</span></span>';

  function status(row, now, ov) {
    var built = (row && row.state) || "pre";
    var start = Date.parse(row && row.start);
    var past = !isNaN(start) && now - start >= MAX;
    if (ov && (ov.state === "post" || ov.completed)) return "final";
    if (built === "post") return "final";
    if (ov && ov.state === "in") return "live";
    if (built === "in") return past ? "final" : "live";
    if (ov && ov.state === "pre") return "time";
    if (!isNaN(start) && now >= start - GRACE && !past) return "live";
    return "time";
  }

  function overlayFor(a) {
    var L = typeof window !== "undefined" && window.LSLive;
    if (!L || !L.get) return null;
    return L.get(a.getAttribute("data-lg"), a.getAttribute("data-id")) || null;
  }

  function apply(a, mode) {
    var li = a.closest ? a.closest("li") : null;
    var dt = a.querySelector(".sx-dt");
    if (!dt) return;
    if (mode === "live") {
      if (li) li.classList.add("sx-live");
      if (!dt.querySelector(".sx-live-badge")) dt.innerHTML = BADGE;
      return;
    }
    if (li) li.classList.remove("sx-live");
    var text = mode === "final" ? "Final" : (a.getAttribute("data-when") || "");
    if (dt.textContent !== text) dt.textContent = text;
  }

  function paintCounts(scope) {
    var folds = [];
    if (scope.matches && scope.matches('details[data-week="games"]')) folds.push(scope);
    var found = scope.querySelectorAll('details[data-week="games"]');
    for (var i = 0; i < found.length; i++) folds.push(found[i]);
    for (var j = 0; j < folds.length; j++) {
      var d = folds[j], n = d.querySelectorAll("li.sx-live").length;
      var slot = d.querySelector(".sx-fold-live");
      if (!n) { if (slot) slot.remove(); continue; }
      var text = n + " live";
      if (!slot) {
        slot = document.createElement("span");
        slot.className = "sx-fold-live";
        var chev = d.querySelector(".sx-chev");
        if (chev) chev.parentNode.insertBefore(slot, chev);
        else (d.querySelector("h2") || d.querySelector("summary")).appendChild(slot);
      }
      if (slot.textContent !== text) slot.textContent = text;
    }
  }

  function paint(root, now) {
    var scope = root && root.querySelectorAll ? root : (typeof document !== "undefined" ? document : null);
    if (!scope) return;
    var t = now || Date.now();
    var nodes = scope.querySelectorAll("a[data-start]");
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      apply(a, status({ state: a.getAttribute("data-state"), start: a.getAttribute("data-start") }, t, overlayFor(a)));
    }
    paintCounts(scope);
  }

  return { status: status, paint: paint, GRACE: GRACE, MAX: MAX };
});
