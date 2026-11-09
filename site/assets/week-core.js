/* League week list: group compact games by US Eastern day and choose the link.
   Browser: window.WeekCore. Node: require("./week-core.js").
   Finals open the box-score tab. Games still to be played open the line page. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WeekCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function dayKey(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const g = t => (p.find(x => x.type === t) || {}).value;
    return `${g("year")}-${g("month")}-${g("day")}`;
  }

  /** games: compact week rows. order "asc" (football week) or "desc" (last 7 days, newest day first). */
  function group(games, order) {
    const dir = order === "desc" ? -1 : 1;
    const list = (games || []).filter(g => g && g.date).slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) * dir);
    const days = [];
    for (const g of list) {
      const key = dayKey(g.date);
      let bucket = days[days.length - 1];
      if (!bucket || bucket.key !== key) {
        bucket = { key, date: g.date, games: [] };
        days.push(bucket);
      }
      bucket.games.push(g);
    }
    return days;
  }

  /** Final -> box score tab. Anything else -> the game page. */
  function href(lg, g) {
    if (!lg || !g || g.id == null || g.id === "") return "";
    const id = encodeURIComponent(g.id);
    return g.state === "post" ? `#/g/${lg}/${id}/box` : `#/g/${lg}/${id}`;
  }

  return { dayKey, group, href };
});
