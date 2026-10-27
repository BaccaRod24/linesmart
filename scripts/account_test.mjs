// Unit tests for Account sync logic (site/assets/account-core.js): migration, change stamping, row-by-row merge,
// auth-return URL parsing and error messages. No browser or network. Usage: node scripts/account_test.mjs
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const A = require("../site/assets/account-core.js");
const C = require("../site/assets/bets-core.js");
const fails = [];
const check = (ok, msg, tag = "acct") => { console.log(`${ok ? "PASS" : "FAIL"} ${tag}: ${msg}`); if (!ok) fails.push(`${tag}: ${msg}`); };
const T0 = "2026-10-20T12:00:00.000Z", T1 = "2026-10-21T12:00:00.000Z", T2 = "2026-10-22T12:00:00.000Z", NOW = "2026-10-26T22:00:00.000Z";
const bet = (id, o = {}) => C.normalizeBet({ id, type: "ml", sel: "Bills", odds: -120, stake: 50, status: "pending", createdAt: T0, updatedAt: T1, ...o });
let n = 0; const uid = () => "new" + (++n);

// ---------- config: public key only, no secret
const src = fs.readFileSync(new URL("../site/assets/account-core.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../site/assets/account.js", import.meta.url), "utf8");
check(A.SB_KEY.startsWith("sb_publishable_"), "uses the publishable key", "config");
check(!/sb_secret_|service_role/.test(src), "no secret / service-role key in client code", "config");
check(A.SB_URL === "https://ctklbryattbbsqdmteny.supabase.co" && A.TABLE === "user_bets", "project URL + table", "config");
check(fs.existsSync(new URL("../site/assets/" + A.SB_LIB, import.meta.url)), "vendored supabase-js file exists (no CDN)", "config");
check(!/cdn\.jsdelivr|unpkg\.com|esm\.sh/.test(src), "no CDN URLs", "config");

// ---------- validation
check(A.validEmail("user@example.com") && !A.validEmail("user@") && !A.validEmail("a b@c.com") && !A.validEmail(""), "email validation", "valid");
check(A.validCode("12345678") && A.validCode("123456") && A.validCode("1234567890"), "codes of 6, 8 and 10 digits are accepted", "valid");
check(!A.validCode("12345") && !A.validCode("12345678901") && !A.validCode("1234abcd"), "too short / too long / letters rejected", "valid");
check(A.validCode("1234 5678") && A.cleanCode("1234-5678") === "12345678", "spaces and dashes are ignored", "valid");

// ---------- migrate
{
  const m = A.migrate([{ id: "a", createdAt: T0 }, { id: "a", createdAt: T0 }, { createdAt: T0 }, { id: 7, updatedAt: T2 }, { id: "b" }], NOW, uid);
  const ids = m.bets.map(b => b.id);
  check(new Set(ids).size === 5 && ids.every(x => typeof x === "string" && x), "every bet gets a unique string id (dupes + missing fixed)", "migrate");
  check(m.bets[0].updatedAt === T0 && m.bets[3].updatedAt === T2 && m.bets[4].updatedAt === NOW, "updatedAt = existing, else createdAt, else now", "migrate");
  check(A.migrate(m.bets, NOW, uid).changed === 0, "migration is idempotent", "migrate");
}

// ---------- stamp (central change detection in save())
{
  const a = bet("a"), b = bet("b"), c = bet("c");
  const sig = A.snapshot([a, b, c]);
  const st = A.stamp(sig, [a, { ...b, status: "won" }, bet("d", { updatedAt: undefined })], NOW);
  check(st.bets[0].updatedAt === T1, "unchanged bet keeps its updatedAt", "stamp");
  check(st.bets[1].updatedAt === NOW, "edited/settled bet gets updatedAt = now", "stamp");
  check(st.bets[2].updatedAt === NOW, "new bet gets updatedAt = now", "stamp");
  check(st.removed.length === 1 && st.removed[0] === "c", "deleted bet reported for a tombstone", "stamp");
  check(A.stamp(st.sig, st.bets, "2030-01-01T00:00:00Z").bets.every((x, i) => x.updatedAt === st.bets[i].updatedAt), "re-saving unchanged bets doesn't bump timestamps", "stamp");
}

// ---------- merge
const norm = C.normalizeBet;
{
  // first sign-in: nothing in the cloud -> upload everything local
  const m = A.merge([bet("a"), bet("b")], {}, [], norm);
  check(m.push.length === 2 && m.push.every(r => !r.deleted && r.bet.id === r.id && r.updated_at === T1), "first sign-in uploads all local bets", "merge");
  check(m.bets.length === 2 && m.stats.up === 2, "local copy kept", "merge");
}
{
  // new device: empty local -> download
  const rows = [{ id: "a", bet: bet("a"), deleted: false, updated_at: T1 }, { id: "z", bet: { id: "z" }, deleted: true, updated_at: T1 }];
  const m = A.merge([], {}, rows, norm);
  check(m.bets.length === 1 && m.bets[0].id === "a" && m.push.length === 0, "new device downloads live rows, skips soft-deleted ones", "merge");
}
{
  // newest wins, both directions
  const local = [bet("a", { status: "won", updatedAt: T2 }), bet("b", { updatedAt: T0 })];
  const rows = [{ id: "a", bet: bet("a", { status: "pending" }), deleted: false, updated_at: T1 }, { id: "b", bet: bet("b", { stake: 99 }), deleted: false, updated_at: T1 }];
  const m = A.merge(local, {}, rows, norm);
  const a = m.bets.find(x => x.id === "a"), b = m.bets.find(x => x.id === "b");
  check(a.status === "won" && m.push.some(r => r.id === "a" && r.bet.status === "won"), "local newer -> local kept and pushed", "merge");
  check(b.stake === 99 && b.updatedAt === T1 && !m.push.some(r => r.id === "b"), "remote newer -> remote applied, not pushed back", "merge");
  check(m.stats.up === 1 && m.stats.down === 1, "stats count up/down", "merge");
}
{
  // deletes: local tombstone newer -> soft delete pushed; remote delete newer -> local removed
  const m = A.merge([bet("b", { updatedAt: T0 })], { a: T2 }, [{ id: "a", bet: bet("a"), deleted: false, updated_at: T1 }, { id: "b", bet: { id: "b" }, deleted: true, updated_at: T1 }], norm);
  check(m.push.length === 1 && m.push[0].id === "a" && m.push[0].deleted === true && JSON.stringify(m.push[0].bet) === '{"id":"a"}' && m.push[0].updated_at === T2, "local delete pushed as soft-delete with only the id", "merge");
  check(!m.bets.some(x => x.id === "b") && m.stats.del === 1, "remote delete newer removes local bet", "merge");
  check(!m.bets.some(x => x.id === "a"), "deleted bet doesn't come back", "merge");
}
{
  // remote edit newer than local delete -> bet restored, tombstone cleared
  const m = A.merge([], { a: T0 }, [{ id: "a", bet: bet("a", { stake: 75 }), deleted: false, updated_at: T2 }], norm);
  check(m.bets.length === 1 && m.bets[0].stake === 75 && !("a" in m.tombs) && !m.push.length, "remote edit after a local delete wins (newest wins)", "merge");
}
{
  // tombstone for a never-uploaded bet -> soft delete pushed (harmless) ; same-ts tie with delete -> delete wins
  const m = A.merge([], { q: T1 }, [], norm);
  check(m.push.length === 1 && m.push[0].deleted, "tombstone without a cloud row still pushed as deleted", "merge");
  const m2 = A.merge([], { a: T1 }, [{ id: "a", bet: bet("a"), deleted: false, updated_at: T1 }], norm);
  check(m2.push.length === 1 && m2.push[0].deleted && !m2.bets.length, "tie between delete and edit: delete wins", "merge");
  const m3 = A.merge([], { a: T1 }, [{ id: "a", bet: { id: "a" }, deleted: true, updated_at: T1 }], norm);
  check(!m3.push.length && !("a" in m3.tombs), "already-deleted in cloud: tombstone cleared, nothing pushed", "merge");
}
{
  // equal timestamps -> no traffic; junk remote rows ignored
  const m = A.merge([bet("a")], {}, [{ id: "a", bet: bet("a"), deleted: false, updated_at: T1 }, { id: "j", bet: null, deleted: false, updated_at: T2 }, { bet: {} }], norm);
  check(m.push.length === 0 && m.bets.length === 1 && m.stats.down === 0, "in sync -> nothing pushed; invalid rows skipped", "merge");
  // remote updated_at precision (Postgres "+00:00" format) compares correctly
  const m2 = A.merge([bet("a")], {}, [{ id: "a", bet: bet("a"), deleted: false, updated_at: "2026-10-21T12:00:00+00:00" }], norm);
  check(m2.push.length === 0, "Postgres timestamp format compares equal", "merge");
}
{
  // two devices converge: A edits a, B deletes b, both add new
  const base = [bet("a"), bet("b")];
  let cloud = A.merge(base, {}, [], norm).push;           // first device uploaded
  const devA = [bet("a", { status: "won", updatedAt: T2 }), bet("b"), bet("n1", { updatedAt: T2 })];
  const devB = [bet("a"), bet("n2", { updatedAt: T2 })]; const tombB = { b: T2 };
  const apply = (rows, push) => { const map = new Map(rows.map(r => [r.id, r])); for (const p of push) map.set(p.id, p); return [...map.values()]; };
  const mA = A.merge(devA, {}, cloud, norm); cloud = apply(cloud, mA.push);
  const mB = A.merge(devB, tombB, cloud, norm); cloud = apply(cloud, mB.push);
  const mA2 = A.merge(mA.bets, mA.tombs, cloud, norm);
  const ids = x => x.map(b => b.id).sort().join(",");
  check(ids(mA2.bets) === "a,n1,n2" && ids(mB.bets) === "a,n1,n2", "two devices converge (edit + delete + adds)", "merge");
  check(mB.bets.find(b => b.id === "a").status === "won" && mA2.bets.find(b => b.id === "a").status === "won", "edit from device A reaches device B", "merge");
}
check(A.chunks(Array.from({ length: 450 }), 200).map(c => c.length).join() === "200,200,50", "upserts chunked by 200", "merge");

// ---------- magic-link return URLs
{
  const r = A.parseAuthReturn("https://linesmart.app/#/account#access_token=AT&expires_in=3600&refresh_token=RT&token_type=bearer&type=magiclink");
  check(r && r.kind === "token" && r.access_token === "AT" && r.refresh_token === "RT" && r.clean === "/#/account", "implicit link (#/account#access_token=…) parsed, URL cleaned", "link");
  const r2 = A.parseAuthReturn("https://linesmart.app/#access_token=AT&refresh_token=RT&type=magiclink");
  check(r2 && r2.kind === "token" && r2.clean === "/#/account", "Site-URL fallback (#access_token=…) parsed", "link");
  const r3 = A.parseAuthReturn("https://linesmart.app/?code=PK#/account");
  check(r3 && r3.kind === "code" && r3.code === "PK" && r3.clean === "/#/account", "PKCE ?code= parsed, query removed", "link");
  const r4 = A.parseAuthReturn("https://user.github.io/linesmart/?x=1&code=PK#/account");
  check(r4 && r4.clean === "/linesmart/?x=1#/account", "subpath + other query params kept", "link");
  const r5 = A.parseAuthReturn("https://linesmart.app/#/account#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  check(r5 && r5.kind === "error" && /expired/.test(A.linkError(r5)), "expired-link error parsed with a friendly message", "link");
  check(A.parseAuthReturn("https://linesmart.app/#/bets/add?lg=nfl") === null && A.parseAuthReturn("https://linesmart.app/#/g/nfl/401") === null, "normal app URLs aren't treated as auth returns", "link");
}

// ---------- error messages
{
  const rl = A.authError({ status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" });
  check(/too many requests, try again later/i.test(rl), "429 email rate limit -> 'too many requests, try again later'", "errors");
  check(/in 42 seconds/.test(A.authError({ status: 429, message: "For security purposes, you can only request this after 42 seconds." })), "per-address cooldown shows the seconds", "errors");
  check(/wrong or has expired/.test(A.authError({ status: 403, code: "otp_expired", message: "Token has expired or is invalid" })), "bad / expired code", "errors");
  check(/doesn't look right/.test(A.authError({ status: 400, code: "email_address_invalid", message: "Email address is invalid" })), "invalid email", "errors");
  check(/Couldn't reach/.test(A.authError(new TypeError("Failed to fetch"))), "network error", "errors");
  check(/Offline/.test(A.syncError(new TypeError("Failed to fetch"))) && /expired/.test(A.syncError({ status: 401, message: "JWT expired" })), "sync errors", "errors");
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall account tests passed");
process.exit(fails.length ? 1 : 0);
