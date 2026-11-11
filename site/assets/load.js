/* Route scripts. The shell (theme, config, site, state, news) is in the HTML with defer.
 * Everything else waits until the route needs it, so a legal page, a state page, or a thin
 * fighter page does not download the bet tracker or the slip importer.
 * Scripts in a group run in order. A group that is already loaded is skipped. */
(function () {
  "use strict";
  var GROUPS = {
    live: ["assets/live-core.js", "assets/live.js"],
    week: ["assets/week-core.js"],
    livetab: ["assets/livetab-core.js"],
    box: ["assets/box-core.js"],
    line: ["assets/line-core.js"],
    adv: ["assets/adv-core.js", "assets/adv.js"],
    alerts: ["assets/alerts-core.js", "assets/alerts.js"],
    propsCore: ["assets/props-core.js"],
    props: ["assets/props-core.js", "assets/props.js"],
    matchup: ["assets/matchup-core.js", "assets/matchup.js"],
    weather: ["assets/weather-core.js", "assets/weather.js"],
    ufc: ["assets/ufc.js"],
    betsCore: ["assets/bets-core.js"],
    bets: ["assets/bets-core.js", "assets/bets.js"],
    slip: ["assets/slip-core.js"],
    account: ["assets/account-core.js", "assets/account.js"],
    value: ["assets/value-core.js", "assets/value.js"],
    // pro-core before pro.js; account-core before the gate (the gate stops if AcctCore is missing).
    pro: ["assets/account-core.js", "assets/pro-core.js", "assets/pro.js", "assets/pro-gate-core.js", "assets/pro-gate.js"],
    access: ["assets/access-core.js"],
    pickem: ["assets/pickem-core.js"],
  };
  var done = {}, pending = {};

  function signedIn() {
    try { return !!localStorage.getItem("ls-sb-auth"); } catch (e) { return false; }
  }
  function add(list, name) {
    if (list.indexOf(name) < 0) list.push(name);
  }
  // hash wins over the page's own route once the visitor follows an in-app link.
  function keyOf(hash, route) {
    var h = String(hash || "");
    if (h.indexOf("#/") === 0) return h.replace(/^#\/?/, "").split("?")[0];
    return String(route || "");
  }
  function groupsFor(hash, page, route) {
    var key = keyOf(hash, route);
    if (!key && page) return []; // static page: state, legal-style, team, fighter. Shell only.
    var parts = key.split("/"), k = parts[0], g = [];
    if (k === "bets") return ["bets", "slip", "live", "propsCore", "alerts", "pro"];
    if (k === "account") return ["account", "alerts", "pro"];
    if (k === "pro" || k === "owner") return ["pro", "alerts"];
    if (k === "value") return ["adv", "value", "pro"];
    if (k === "live") return ["live", "livetab", "week", "betsCore"];
    if (k === "props") return ["access", "props", "alerts", "pickem"];
    if (k === "stats") return ["access", "matchup", "propsCore"];
    if (k === "search") return [];
    if (k === "g") return ["live", "box", "line", "alerts", "account", "props", "matchup", "weather", "adv", "bets", "pickem"];
    if (k === "t") return ["live", "matchup", "adv", "alerts", "week"];
    if (k === "p") return parts[1] === "ufc" ? ["ufc"] : ["props", "matchup", "adv", "alerts"];
    if (k === "l" && parts[1] === "ufc") return ["ufc"];
    // Home and a league hub: scores, bells, weather chips, the pick'em note. Not the tracker.
    add(g, "live"); add(g, "week"); add(g, "alerts"); add(g, "account"); add(g, "propsCore");
    add(g, "weather"); add(g, "adv"); add(g, "pickem");
    return g;
  }
  function filesFor(names) {
    var out = [], seen = {};
    names.forEach(function (name) {
      (GROUPS[name] || []).forEach(function (src) {
        if (!seen[src]) { seen[src] = 1; out.push(src); }
      });
    });
    return out;
  }
  function loadOne(src) {
    if (done[src]) return Promise.resolve();
    if (pending[src]) return pending[src];
    pending[src] = new Promise(function (res) {
      var s = document.createElement("script");
      s.async = false;
      s.onload = s.onerror = function () { done[src] = 1; res(); };
      s.src = src;
      document.head.appendChild(s);
    });
    return pending[src];
  }
  // Insert the missing files together with async=false so they download together and run in order.
  function loadSeq(srcs) {
    var waits = [];
    srcs.forEach(function (src) {
      if (!done[src]) waits.push(loadOne(src));
    });
    return Promise.all(waits);
  }
  function prepare(hash, page, route) {
    var names = groupsFor(hash, page, route);
    // A signed-in visitor still gets the Pro gate on this page. Everyone else does not download it.
    if (signedIn()) names = names.concat(["pro"]);
    return loadSeq(filesFor(names));
  }
  window.LSLoad = { prepare: prepare, groupsFor: groupsFor, GROUPS: GROUPS };
})();
