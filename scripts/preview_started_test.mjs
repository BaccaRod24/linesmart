// started() in site/assets/preview.js: a past kickoff on a still-upcoming page points at the live
// game. A final recap (state post + completed: Final, Final/OT, FT, AET, FT-Pens), and a canceled
// or postponed page, must not get that banner. No network. Usage: node scripts/preview_started_test.mjs
import { chromium } from "playwright";
import fs from "fs";

const src = fs.readFileSync("site/assets/preview.js", "utf8");
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log("FAIL " + msg); } };
const PAST = "2020-01-01T00:00:00Z", FUTURE = "2099-01-01T00:00:00Z";
const html = (o = {}) => `<article class="pv sx-game">
<h1 class="pv-h1">${o.h1 || "Away at Home: odds"}</h1>
<div class="match pv-match"><div class="mmid">${o.status ? `<div class="sx-status">${o.status}</div>` : ""}<div class="when"><time datetime="${o.when || PAST}">when</time></div></div></div>
${o.result ? `<div class="card sx-result"><h3>Final score</h3><p>Final: Away 1, Home 2.</p></div>` : ""}
${o.noline ? `<div class="noline">${o.noline}</div>` : ""}
${o.live === false ? "" : `<p class="pv-cta"><a class="pv-live" href="${o.href || "#/g/nba/1"}">${o.link || "Open the live game page"}</a></p>`}
${o.extra || ""}
</article>`;

const browser = await chromium.launch();
const page = await browser.newPage();
async function run(body) {
  await page.setContent(`<!doctype html><html><body>${body}<script>${src}</script></body></html>`, { waitUntil: "domcontentloaded" });
  return page.evaluate(() => ({
    n: document.querySelectorAll(".pv-started").length,
    text: (document.querySelector(".pv-started") || {}).innerText || "",
    href: (document.querySelector(".pv-started a") || {}).getAttribute?.("href") || "",
    status: (document.querySelector(".sx-status") || {}).textContent || "",
  }));
}

const finals = ["Final", "Final/OT", "Final/2OT", "Final/SO", "Final/12", "FT", "FT-Pens", "AET"];
for (const status of finals) {
  const r = await run(html({ status, href: "#/g/nba/9/box", link: "Box score", h1: "Away at Home: final score & closing odds", result: true }));
  check(r.n === 0 && r.status === status, `${status} recap has no started banner (n=${r.n}, status=${r.status})`);
}
for (const status of ["Canceled", "Cancelled", "Postponed"]) {
  const r = await run(html({ status, h1: `Away at Home: ${status.toLowerCase()}` }));
  check(r.n === 0 && r.status === status, `${status} has no started banner (n=${r.n})`);
}
{
  const r = await run(html({ status: "", h1: "Away at Home: canceled", noline: "Canceled. No score." }));
  check(r.n === 0, `canceled heading and note, no status chip: no banner (n=${r.n})`);
}
{
  const r = await run(html({ status: "", h1: "Away at Home: postponed", noline: "Postponed. No score." }));
  check(r.n === 0, `postponed heading: no banner (n=${r.n})`);
}
{
  const r = await run(html({ status: "", h1: "Away at Home: final score & closing odds", result: true, href: "#/g/nba/9/box" }));
  check(r.n === 0, `final score card without a status chip: no banner (n=${r.n})`);
}
{
  const r = await run(html({ when: FUTURE, href: "#/g/nba/1" }));
  check(r.n === 0, `future kickoff: no banner (n=${r.n})`);
}
{
  const r = await run(html({ when: PAST, href: "#/g/nba/42", link: "Open the live game page" }));
  check(r.n === 1 && /this game has started/i.test(r.text) && r.href === "#/g/nba/42", `stale preview after kickoff still points at the live page (${r.text})`);
}
{
  const r = await run(html({ status: "Live: 6:08 - 3rd", href: "#/g/nba/7" }));
  check(r.n === 1 && r.href === "#/g/nba/7", `in progress still gets the started banner (n=${r.n})`);
}
{
  const r = await run(html({ live: false }));
  check(r.n === 0, `past kickoff with no live link: no banner (n=${r.n})`);
}
{
  const r = await run(html({ extra: `<p class="pv-started">already</p>` }));
  check(r.n === 1 && r.text === "already", `does not add a second banner (${r.n})`);
}
await browser.close();
console.log(`${fail ? "FAIL" : "PASS"} preview started banner: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
