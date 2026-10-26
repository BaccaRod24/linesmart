// ===== LineSmart color themes (preview only; the default look is unchanged) =====
// Colors live as CSS custom properties in styles.css; a theme is selected with <html data-theme="…">.
// Preview: add ?theme=<name> to the URL, e.g. https://…/linesmart/?theme=vegas#/l/nfl  (hash routes keep the query).
// Nothing is persisted: without ?theme the site always uses the default theme.
(function () {
  var THEMES = {
    linesmart: "LineSmart (current)",
    sportsbook: "Sportsbook Green",
    midnight: "Midnight Blue",
    daylight: "Daylight",
    vegas: "Vegas Gold",
  };
  var DEFAULT = "linesmart";
  var root = document.documentElement;
  var q = null;
  try { q = new URLSearchParams(location.search).get("theme"); } catch (e) {}
  var name = q && THEMES.hasOwnProperty(q.toLowerCase()) ? q.toLowerCase() : (root.getAttribute("data-theme") || DEFAULT);
  if (!THEMES.hasOwnProperty(name)) name = DEFAULT;
  if (name !== DEFAULT) root.setAttribute("data-theme", name);

  var css = function (v) { return getComputedStyle(root).getPropertyValue(v).trim(); };
  // the logo is an <img>, so CSS variables can't reach it: swap its default colors for the theme's
  var LOGO = { "#141c2b": "--logo-tile", "#22d3a6": "--logo-1", "#38bdf8": "--logo-2", "#e6edf7": "--logo-ink" };
  function apply() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", css("--bg") || "#0b0f17");
    if (name === DEFAULT) return;
    var imgs = document.querySelectorAll("img.brand-logo");
    if (!imgs.length || !window.fetch) return;
    fetch(imgs[0].getAttribute("src")).then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); }).then(function (svg) {
      var probe = document.createElement("span"); probe.style.display = "none"; document.body.appendChild(probe);
      Object.keys(LOGO).forEach(function (hex) {
        probe.style.color = "var(" + LOGO[hex] + ")";
        var c = getComputedStyle(probe).color; // resolved rgb(), so var() chains work
        svg = svg.split('"' + hex + '"').join('"' + c + '"');
      });
      probe.remove();
      var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      imgs.forEach(function (i) { i.src = url; });
    }).catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
  window.LineSmartTheme = { name: name, themes: THEMES, defaultTheme: DEFAULT };
})();
