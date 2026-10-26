// ===== LineSmart color themes. Default: Midnight Blue; the others are previews ======
// Colors live as CSS custom properties in styles.css; a theme is selected with <html data-theme="…">.
// Preview: add ?theme=<name> to the URL, e.g. https://linesmart.app/?theme=vegas#/l/nfl  (hash routes keep the query).
// Nothing is persisted: without ?theme the site always uses the default theme (Midnight Blue).
// The original teal look is ?theme=linesmart.
(function () {
  var THEMES = {
    midnight: "Midnight Blue",
    linesmart: "LineSmart (original)",
    sportsbook: "Sportsbook Green",
    daylight: "Daylight",
    vegas: "Vegas Gold",
  };
  var DEFAULT = "midnight";
  var root = document.documentElement;
  var q = null;
  try { q = new URLSearchParams(location.search).get("theme"); } catch (e) {}
  var name = q && THEMES.hasOwnProperty(q.toLowerCase()) ? q.toLowerCase() : (root.getAttribute("data-theme") || DEFAULT);
  if (!THEMES.hasOwnProperty(name)) name = DEFAULT;
  if (name !== DEFAULT) root.setAttribute("data-theme", name);

  var css = function (v) { return getComputedStyle(root).getPropertyValue(v).trim(); };
  // the logo is an <img>, so CSS variables can't reach it: swap its default colors for the theme's
  var LOGO = { "#0e1a3a": "--logo-tile", "#3d9bff": "--logo-1", "#22e1ff": "--logo-2", "#e8eeff": "--logo-ink" };
  function apply() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", css("--bg") || "#050b1c");
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
