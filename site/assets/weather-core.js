/* LineSmart game-day weather: pure logic (no DOM). Loaded in the browser as window.WxCore and in Node tests via require().
 * Input is g.weather written by scripts/weather.py (Open-Meteo forecast for the kickoff hour + the next 3 hours):
 *   {kind:"forecast", temp, feels, pop, precip, wind, gust, dir, dirTxt, code, label, hours:[...], max:{wind,gust,pop},
 *    min:{temp,feels}, precipType, roof:null|"retractable", tz, place, asOf}
 *   {kind:"indoor", roof:"dome"|"arena"} · {kind:"pending"} (beyond the ~16-day horizon) · {kind:"unavailable", why} */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WxCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const isNum = v => typeof v === "number" && isFinite(v);
  const WATCH = { wind: 15, cold: 32, pop: 50 };            // mph, °F, % — same thresholds as scripts/weather.py
  const TOTALS_KINDS = new Set(["football", "baseball"]);

  // WMO weather code -> icon family
  // a precipitation code with a low chance of precipitation is drawn as a cloud (matches scripts/weather.py label_for)
  const LOW_POP = 25;
  function iconKind(code, pop) {
    if (!isNum(code)) return "cloud";
    if (isNum(pop) && pop < LOW_POP && ((code >= 51 && code <= 67) || (code >= 71 && code <= 86) || code >= 95)) return "cloud";
    if (code === 0 || code === 1) return "sun";
    if (code === 2) return "partly";
    if (code === 3) return "cloud";
    if (code === 45 || code === 48) return "fog";
    if (code >= 51 && code <= 57) return "drizzle";
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if (code >= 95) return "storm";
    return "cloud";
  }

  // Weather watch flags from the game-window extremes (kickoff → +3h). Falls back to the kickoff hour.
  function watchFlags(w) {
    if (!w || w.kind !== "forecast") return [];
    const mx = w.max || {}, mn = w.min || {};
    const wind = isNum(mx.wind) ? mx.wind : w.wind, gust = isNum(mx.gust) ? mx.gust : w.gust;
    const cold = isNum(mn.temp) ? mn.temp : w.temp, feels = isNum(mn.feels) ? mn.feels : w.feels;
    const pop = isNum(mx.pop) ? mx.pop : w.pop, snow = w.precipType === "snow";
    const out = [];
    if (isNum(wind) && wind >= WATCH.wind) out.push({ k: "wind", text: `Wind ${wind} mph` + (isNum(gust) && gust > wind ? `, gusts ${gust}` : "") });
    if (isNum(cold) && cold <= WATCH.cold) out.push({ k: "cold", text: `Cold ${cold}°F` + (isNum(feels) && feels < cold ? ` (feels ${feels}°F)` : "") });
    if (isNum(pop) && pop >= WATCH.pop) out.push({ k: snow ? "snow" : "rain", text: `${snow ? "Snow" : "Rain"} ${pop}% chance` });
    return out;
  }

  // "watch" = full highlight (open-air venue); "roof" = flags exist but a retractable roof may be closed (muted); "" = none
  function watchLevel(w) {
    if (!watchFlags(w).length) return "";
    return w.roof === "retractable" ? "roof" : "watch";
  }

  const deg = v => (isNum(v) ? `${Math.round(v)}°` : "–");
  const mph = v => (isNum(v) ? `${Math.round(v)} mph` : "–");
  const pct = v => (isNum(v) ? `${Math.round(v)}%` : "–");

  // Compact card chip model
  function chipModel(w) {
    if (!w) return null;
    if (w.kind === "indoor") return { cls: "indoor", icon: "roof", text: "Indoor", title: w.roof === "dome" ? "Dome / fixed roof: no weather impact" : "Indoor arena" };
    if (w.kind === "pending") return { cls: "pending", icon: "clock", text: "Forecast soon", title: "Forecast not yet available (Open-Meteo forecasts reach ~16 days out)" };
    if (w.kind !== "forecast") return null;                 // unavailable: show nothing on the card
    const lvl = watchLevel(w), flags = watchFlags(w);
    const parts = [deg(w.temp), mph(w.wind)];
    if (isNum(w.pop)) parts.push(`${Math.round(w.pop)}%`);
    return {
      cls: ["fc", lvl, w.roof === "retractable" ? "rr" : ""].filter(Boolean).join(" "), icon: iconKind(w.code, w.pop), parts,
      text: parts.join(" · "),
      title: [w.label, `${deg(w.temp)}F`, `wind ${mph(w.wind)}${w.dirTxt ? " " + w.dirTxt : ""}`, `${w.precipType === "snow" ? "snow" : "rain"} ${pct(w.pop)}`,
              w.roof === "retractable" ? "retractable roof" : "", flags.length ? "Weather watch: " + flags.map(f => f.text).join(", ") : ""].filter(Boolean).join(" · "),
    };
  }

  // local kickoff clock at the venue ("1:00 PM CT")
  function localTime(ts, tz, locale = "en-US") {
    if (!isNum(ts)) return "";
    const d = new Date(ts * 1000);
    try {
      return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: tz || "UTC", timeZoneName: "short" });
    } catch (e) { return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }); }
  }

  // Wind arrow points where the wind blows TO (meteorological direction is where it comes FROM)
  const windArrowDeg = dir => (isNum(dir) ? (dir + 180) % 360 : null);
  const totalsNote = (w, kind) => TOTALS_KINDS.has(kind) && w && w.kind === "forecast";

  return { isNum, WATCH, iconKind, watchFlags, watchLevel, chipModel, localTime, windArrowDeg, totalsNote, deg, mph, pct };
});
