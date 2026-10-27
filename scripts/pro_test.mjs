// Unit tests for the LineSmart Pro waitlist: validation/result mapping (site/assets/pro-core.js), that the client's
// answer keys match what the SQL function accepts, the page copy rules (data/software, no picks or promises) and
// that the page + teasers are wired in. No network. Usage: node scripts/pro_test.mjs
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const P = require("../site/assets/pro-core.js");
const fails = [];
const check = (ok, msg, tag = "pro") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };
const rd = p => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const SQL = rd("../supabase/migrations/20261027_pro_waitlist.sql"), JS = rd("../site/assets/pro.js"), CORE = rd("../site/assets/pro-core.js");

{
  const T = "validate";
  check(P.SB_KEY.startsWith("sb_publishable_") && !/sb_secret_|service_role/.test(CORE + JS), "publishable key only, no secret in client code", T);
  let r = P.validate({ email: "", age: true });
  check(!r.ok && r.field === "email", "empty email -> email error", T);
  r = P.validate({ email: "nope", age: true });
  check(!r.ok && r.field === "email", "bad email -> email error", T);
  r = P.validate({ email: "fan@example.com", age: false });
  check(!r.ok && r.field === "age" && /21/.test(r.error), "21+ box is required", T);
  r = P.validate({ email: "fan@example.com", age: "on" });
  check(!r.ok && r.field === "age", "21+ must be a real boolean true", T);
  r = P.validate({ email: "  Fan@Example.COM ", age: true });
  check(r.ok && r.payload.p_email === "fan@example.com" && r.payload.p_is_21 === true && r.payload.p_features.length === 0 && r.payload.p_price === null && r.payload.p_source === "pro", "survey optional; email cleaned; defaults", T);
  r = P.validate({ email: "fan@example.com", age: true, features: ["books_10", "nope", "books_10", "props_ev"], sports: ["nfl", "xfl", "ufc"], price: "9.99", state: "fl", source: "value" });
  check(JSON.stringify(r.payload.p_features) === '["books_10","props_ev"]' && JSON.stringify(r.payload.p_sports) === '["nfl","ufc"]', "unknown / duplicate answers dropped", T);
  check(r.payload.p_price === "9.99" && r.payload.p_state === "FL" && r.payload.p_source === "value", "price, state code, source kept", T);
  r = P.validate({ email: "fan@example.com", age: true, price: "0.99", state: "Florida", source: "evil" });
  check(r.payload.p_price === null && r.payload.p_state === null && r.payload.p_source === "pro", "bad price/state/source -> null/pro", T);
  r = P.validate({ email: "fan@example.com", age: true, website: "http://spam" });
  check(r.ok && r.bot, "honeypot -> silent fake success", T);
  r = P.validate({ email: "fan@example.com", age: true, now: 10000, last: 5000 });
  check(!r.ok && /wait/.test(r.error), "client cooldown", T);
}
{
  const T = "result";
  check(P.resultFor(200, "ok") === P.MESSAGES.ok && /waitlist/.test(P.MESSAGES.ok.text), "ok", T);
  for (const k of ["invalid_email", "age_required", "rate_limited", "busy"]) check(P.resultFor(200, k) === P.MESSAGES[k], k, T);
  check(P.resultFor(404, null) === P.MESSAGES.unavailable, "404 (migration not run yet) -> opens soon", T);
  check(P.resultFor(0, null) === P.MESSAGES.network && P.resultFor(500, {}) === P.MESSAGES.network, "network / server error", T);
  check(P.resultFor(429, null) === P.MESSAGES.rate_limited, "429 -> rate limited", T);
}
{
  const T = "sql-sync";
  const arr = re => (SQL.match(re) || [, ""])[1].split(",").map(s => s.trim().replace(/'/g, "")).filter(Boolean);
  const fSql = arr(/features\s+text\[\][^\n]*array\[([^\]]+)\]/), sSql = arr(/sports\s+text\[\][^\n]*array\[([^\]]+)\]/);
  check(JSON.stringify(fSql) === JSON.stringify(P.FEATURES.map(x => x[0])), "feature keys match the table check", T);
  check(JSON.stringify(sSql) === JSON.stringify(P.SPORTS.map(x => x[0])), "sport keys match the table check", T);
  check(P.PRICES.every(([v]) => SQL.includes(`'${v}'`)), "price keys accepted by SQL", T);
  check(/enable row level security/.test(SQL) && !/create policy/i.test(SQL) && /revoke all on table public\.pro_waitlist/.test(SQL), "RLS on, no policies, table grants revoked", T);
  check(/grant execute on function public\.pro_waitlist_join\([^)]*\) to anon, authenticated/.test(SQL), "join function callable with the publishable key", T);
  check(!/net\.http_post|resend/i.test(SQL), "no email sent on signup", T);
  check(/auth\.uid\(\)/.test(SQL) && !/p_user_id/.test(SQL + JS), "user_id from the JWT, never from the client", T);
  const keys = Object.keys(P.validate({ email: "a@example.com", age: true }).payload).sort();
  const params = [...SQL.matchAll(/\b(p_[a-z0-9_]+)\s+(?:text|boolean|text\[\])/g)].map(m => m[1]);
  check(keys.every(k => params.includes(k)), "every payload key is a function parameter", T);
}
{
  const T = "copy";
  const page = JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const text = page + CORE.replace(/\/\*[\s\S]*?\*\//g, "");
  check(!/guarantee/i.test(text), "never says guarantee", T);
  check(!/\bguaranteed\b|\block(s)?\b|sure thing|can't lose|profit(able)? (guaranteed|every)|make money (fast|every)|income|winning picks|expert picks/i.test(text), "no 'guaranteed', 'locks', income or picks claims", T);
  check(/data and software subscription/.test(page) && /doesn't include picks or predictions/.test(page), "framed as data/software, not picks", T);
  check(/Founding members get a lower launch price/.test(page) && !/\$\d+(\.\d\d)? ?(\/|a |per )(mo|month|year)/i.test(page), "launch-price line, no promised price on the page", T);
  check(/Everything free today stays free/.test(page), "says free stays free", T);
  check(/LSGeo\.rgSpan\(\)/.test(page) && /21\+/.test(page) && /offersHTML\("pro"\)/.test(page), "21+, state helpline (LSGeo.rgSpan, 1-800-GAMBLER fallback) and state-aware offers", T);
}
{
  const T = "wiring";
  const idx = rd("../site/index.html"), sw = rd("../site/sw.js"), app = rd("../site/assets/app.js"), bp = rd("./build_pages.py");
  check(/assets\/pro-core\.js[\s\S]*assets\/pro\.js[\s\S]*assets\/app\.js/.test(idx), "scripts loaded before app.js", T);
  check(sw.includes('"assets/pro-core.js"') && sw.includes('"assets/pro.js"'), "service worker precaches the Pro files", T);
  check(/h\[0\]\.split\("\?"\)\[0\] === "pro"/.test(app) && /LSPro\.view\(\)/.test(app), "router handles #/pro", T);
  check(!/data-nav="pro"|href="#\/pro"/.test((idx.match(/<nav[^>]*id="bnav"[\s\S]*?<\/nav>/) || [""])[0]), "no bottom-nav item", T);
  check(/\("\.\/#\/pro", "Pro: join the waitlist"\)/.test(bp) && idx.includes('href="./#/pro"'), "footer link (generated)", T);
  check(rd("../site/assets/value.js").includes('LSPro.teaser("value")') && rd("../site/assets/alerts.js").includes('LSPro.teaser("alerts")') && rd("../site/assets/account.js").includes('LSPro.teaser("alerts")') && rd("../site/assets/bets.js").includes('LSPro.teaser("bets")'), "teasers: value, alerts settings, bet stats", T);
  check(/id="pro-waitlist"/.test(rd("../site/privacy.html")) && /ls-pro-v1/.test(rd("../site/privacy.html")), "privacy policy covers the waitlist", T);
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);
