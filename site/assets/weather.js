/* LineSmart game-day weather UI: the compact chip on game cards and the "Game-day weather" section on game pages.
 * Logic lives in weather-core.js (window.WxCore). Data: g.weather from scripts/weather.py (Open-Meteo, CC BY 4.0). */
(() => {
  const W = window.WxCore;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const svg = (body, cls = "wxi") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const CLOUD = '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 11 3.5 3.5 0 0 0 7 18z"/>';
  const ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    partly: '<path d="M8.5 3.5v1.3M3.5 8.5h1.3M5 5l.9.9M12.1 5l-.9.9"/><path d="M5.6 11.2A3.6 3.6 0 1 1 11.9 8"/><path d="M9 20h8.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8.3 13.6 3.2 3.2 0 0 0 9 20z"/>',
    cloud: CLOUD,
    fog: '<path d="M7 14h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 7 3.5 3.5 0 0 0 7 14z"/><path d="M4 17.5h16M6 21h12"/>',
    drizzle: '<path d="M7 15h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8 3.5 3.5 0 0 0 7 15z"/><path d="M9 18.5v1M13 18.5v1M17 18.5v1"/>',
    rain: '<path d="M7 14h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 7 3.5 3.5 0 0 0 7 14z"/><path d="M8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3"/>',
    snow: '<path d="M7 14h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 7 3.5 3.5 0 0 0 7 14z"/><path d="M8 18h.01M12 20h.01M16 18h.01M10 21.5h.01M14 21.5h.01" stroke-width="2.6"/>',
    storm: '<path d="M7 14h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 7 3.5 3.5 0 0 0 7 14z"/><path d="M12.5 14l-2 3.5h3l-2 4"/>',
    roof: '<path d="M3 11.5 12 5l9 6.5"/><path d="M5 10v9h14v-9"/><path d="M9.5 19v-5h5v5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
    drop: '<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/>',
    temp: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4L12 4z"/><path d="M12 10v4M12 17h.01"/>',
  };
  const icon = (k, cls) => svg(ICONS[k] || ICONS.cloud, cls);
  const CREDIT = `<a class="wx-credit" href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a>`;

  // ---------- compact chip on game cards
  function chip(g) {
    const m = W.chipModel(g && g.weather);
    if (!m) return "";
    if (!m.parts) return `<span class="wx ${m.cls}" title="${esc(m.title)}">${icon(m.icon)}<span>${esc(m.text)}</span></span>`;
    const [t, wind, pop] = m.parts;
    return `<span class="wx ${m.cls}" title="${esc(m.title)}" aria-label="Weather: ${esc(m.title)}">${icon(m.icon)}<b>${esc(t)}</b>`
      + `<span class="wx-p">${icon("wind", "wxs")}${esc(wind.replace(" mph", ""))}</span>`
      + (pop ? `<span class="wx-p">${icon("drop", "wxs")}${esc(pop)}</span>` : "") + `</span>`;
  }

  // ---------- full section on game pages
  function section(g, kind) {
    const w = g && g.weather;
    if (!w || g.state === "post") return "";
    const title = `<div class="section-title">Game-day weather</div>`;
    const venue = esc([g.venue, g.city].filter(Boolean).join(", "));
    if (w.kind === "indoor")
      return `${title}<div class="card wx-card wx-indoor"><div class="wx-main">${icon("roof", "wxi big")}<div><div class="wx-big">Indoor</div>
        <div class="wx-sub">${venue}${w.roof === "dome" ? " · dome / fixed roof" : ""}. Weather doesn't affect play.</div></div></div></div>`;
    if (w.kind === "pending")
      return `${title}<div class="card wx-card"><div class="wx-main">${icon("clock", "wxi big")}<div><div class="wx-big sm">Forecast not yet available</div>
        <div class="wx-sub">${venue}. Forecasts open about 16 days before kickoff${w.roof === "retractable" ? " (retractable roof)" : ""}.</div></div></div>${CREDIT}</div>`;
    if (w.kind !== "forecast")
      return `${title}<div class="card wx-card"><div class="wx-main">${icon("cloud", "wxi big")}<div><div class="wx-big sm">Weather unavailable</div>
        <div class="wx-sub">${venue}. We couldn't load a forecast this refresh; it will retry automatically.</div></div></div></div>`;

    const lvl = W.watchLevel(w), flags = W.watchFlags(w), first = (w.hours || [])[0] || {};
    const arrow = W.windArrowDeg(w.dir);
    const stat = (ic, label, val, sub) => `<div class="wx-stat">${icon(ic, "wxs")}<div><div class="wx-k">${label}</div><div class="wx-v">${val}</div>${sub ? `<div class="wx-s">${sub}</div>` : ""}</div></div>`;
    const windSub = [w.dirTxt ? `from ${esc(w.dirTxt)}${W.isNum(arrow) ? ` <i class="wx-arrow" style="transform:rotate(${arrow}deg)">↑</i>` : ""}` : "", W.isNum(w.gust) ? `gusts ${w.gust}` : ""].filter(Boolean).join(" · ");
    const precipSub = W.isNum(w.precip) && w.precip > 0 ? `${w.precip.toFixed(2)} in/hr` : "none expected";
    const hours = (w.hours || []).map((h, i) => `<div class="wx-h${i === 0 ? " k" : ""}"><div class="wx-ht">${i === 0 ? "Kickoff" : esc(W.localTime(h.t, w.tz).replace(/\s\S+$/, ""))}</div>
        ${icon(W.iconKind(h.code, h.pop), "wxs")}<div class="wx-hv">${W.deg(h.temp)}</div><div class="wx-hs">${icon("wind", "wxs")}${W.isNum(h.wind) ? h.wind : "–"}</div><div class="wx-hs">${icon("drop", "wxs")}${W.pct(h.pop)}</div></div>`).join("");
    const watch = flags.length ? `<div class="wx-watch ${lvl}">${icon("alert", "wxs")}<div><b>Weather watch${lvl === "roof" ? " (if the roof is open)" : ""}:</b> ${flags.map(f => esc(f.text)).join(" · ")}
        ${W.totalsNote(w, kind) ? `<div class="wx-why">Wind, cold and rain or snow tend to matter for totals in football and baseball.</div>` : ""}</div></div>` : "";
    const roof = w.roof === "retractable" ? `<div class="wx-roof">${icon("roof", "wxs")}Retractable roof: it may be closed, which would take weather out of play. Outdoor forecast shown.</div>` : "";
    const asOf = w.asOf ? new Date(w.asOf) : null;
    const asOfTxt = asOf && !isNaN(asOf) ? asOf.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET" : "";
    return `${title}<div class="card wx-card ${lvl ? "is-" + lvl : ""}">
      <div class="wx-main">${icon(W.iconKind(w.code, w.pop), "wxi big")}<div><div class="wx-big">${W.deg(w.temp)}<small>F</small></div>
        <div class="wx-sub">${esc(w.label || "")}${W.isNum(w.feels) && w.feels !== w.temp ? ` · feels like ${W.deg(w.feels)}` : ""}</div></div>
        <div class="wx-at"><div>${esc(w.place || g.city || "")}</div><div class="na">Kickoff ${esc(W.localTime(first.t, w.tz))} local</div></div></div>
      ${watch}${roof}
      <div class="wx-stats">${stat("wind", "Wind", W.mph(w.wind), windSub)}${stat("drop", w.precipType === "snow" ? "Snow chance" : "Rain chance", W.pct(w.pop), precipSub)}${stat("temp", "Game window", `${W.deg(w.min && w.min.temp)}–${W.deg(Math.max(...(w.hours || []).map(h => h.temp).filter(W.isNum), w.temp))}`, `max wind ${W.mph(w.max && w.max.wind)}`)}</div>
      ${hours ? `<div class="wx-hours">${hours}</div>` : ""}
      <div class="note">Forecast for ${venue} at the hour closest to kickoff and the 3 hours after${asOfTxt ? `, updated ${esc(asOfTxt)}` : ""}. City-level location; conditions can change. ${CREDIT}</div>
    </div>`;
  }

  window.LSWeather = { chip, section, icon };
})();
