// Background music: format choice, gapless loop points, saved state, and the "do not autoplay" rule.
// No network and no Odds API. Usage: env -u ODDS_API_KEY node scripts/music_test.mjs
import { createRequire } from "module";
import fs from "fs";
import path from "path";
const require = createRequire(import.meta.url);
const M = require("../site/assets/music-core.js");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} music: ${msg}`); if (!ok) fails.push(msg); };

const tracks = JSON.parse(read("site/assets/music/tracks.json"));
const ids = tracks.map(t => t.id);

// ---------------------------------------------------------------- files on disk
{
  check(tracks.length === 6, "six tracks in the catalog");
  let bytes = 0;
  for (const t of tracks) {
    for (const ext of ["webm", "m4a"]) {
      const name = t.files[ext];
      const p = path.join(root, "site/assets/music", name);
      const ok = fs.existsSync(p) && fs.statSync(p).isFile();
      check(ok, `${name} is on disk`);
      if (ok) bytes += fs.statSync(p).size;
      check(M.safeFileName(name) === name, `${name} is a safe file name`);
    }
    check(M.safeFileName(t.files.wav) === "", `${t.id} wav path is not a web file`);
    const end = M.loopEndSeconds(t);
    check(Math.abs(end - t.loop_samples / t.sample_rate) < 1e-9, `${t.id} loop end is loop_samples / sample_rate (${end})`);
    check(Math.abs(end - t.duration_seconds) < 0.002, `${t.id} loop end matches the published duration`);
    check(M.fileFor(t, "webm") === t.files.webm && M.fileFor(t, "m4a") === t.files.m4a, `${t.id} file choice`);
  }
  check(bytes > 15_000_000 && bytes < 30_000_000, `audio payload is ${bytes} bytes`);
  const longer = tracks[0];
  check(M.loopEndSeconds(longer, longer.duration_seconds + 0.5) === longer.loop_samples / longer.sample_rate, "a longer decode still loops at the musical join");
  check(M.loopEndSeconds(longer, 10) === 10, "a short decode is not asked to loop past itself");
  check(M.loopEndSeconds({ loop: false, loop_samples: 48000, sample_rate: 48000 }, 3) === 3, "loop off uses the buffer");
}

// ---------------------------------------------------------------- format
{
  const can = supported => type => (type.indexOf("webm") >= 0 ? supported : "");
  check(M.pickFormat(can("probably")) === "webm" && M.pickFormat(can("maybe")) === "webm", "webm when opus is probably or maybe");
  check(M.pickFormat(can("")) === "m4a" && M.pickFormat(() => { throw new Error("no"); }) === "m4a", "m4a when webm is missing or canPlayType throws");
  check(M.formatOrder(can("probably")).join() === "webm,m4a", "webm first, m4a is the fallback");
  check(M.formatOrder(can("")).join() === "m4a,webm", "m4a first where webm is unsupported");
}

// ---------------------------------------------------------------- saved state, and never autoplay
{
  const fresh = M.normalizeState(null);
  check(fresh.on === false && fresh.volume === M.DEFAULT_VOLUME && fresh.track === "", "missing storage is off, at the default volume");
  check(M.boot(fresh).play === false && M.boot(fresh).pressed === false && M.boot(fresh).label === "Play background music", "a first visit does not play");
  const saved = M.normalizeState({ on: true, track: "prime_time", volume: 2, title: "  Prime   Time  " });
  check(saved.on === true && saved.track === "prime_time" && saved.volume === 1 && saved.title === "Prime Time", "on, known track, volume clamped, title cleaned");
  check(M.boot(saved).play === false && M.boot(saved).pressed === true && M.boot(saved).label === "Resume background music", "a saved on state is shown and does not autoplay");
  check(M.gestureResumes(saved, false) === true && M.gestureResumes(saved, true) === false && M.gestureResumes(fresh, false) === false, "resume only after a gesture, and only when it was on and is not already playing");
  check(M.normalizeState({ on: "true", volume: "loud" }).on === false, "only a real boolean turns music on");
  check(M.normalizeState({ on: true, track: "nope", volume: -3 }, ids).track === ids[0], "unknown track falls back once the catalog is known");
  check(M.normalizeState({ on: true, track: "halftime" }).track === "halftime", "a saved id is kept until the catalog loads");
  const round = JSON.parse(M.serialize(saved));
  check(round.on === true && round.track === "prime_time" && round.volume === 1 && round.title === "Prime Time", "state round-trips through storage");
  check(M.nextTrackId(ids, "halftime") === ids[0] && M.nextTrackId(ids, ids[0]) === ids[1] && M.nextTrackId(ids, "missing") === ids[0], "next track wraps");
  check(M.buttonLabel(saved, true, false) === "Background music is playing. Show player" && M.buttonLabel(saved, true, true) === "Hide background music player", "playing label");
}

// ---------------------------------------------------------------- page wiring
{
  const js = read("site/assets/music.js");
  check(/createBufferSource/.test(js) && /src\.loop\s*=\s*true/.test(js) && /loopEnd/.test(js) && /decodeAudioData/.test(js), "gapless Web Audio loop");
  check(!/<audio[\s>]/.test(js), "no audio element");
  check(/if \(boot\.play\) playCurrent\(\)/.test(js), "playback starts only when boot says so");
  check(!/ODDS_API|the-odds-api|apiKey|secret/i.test(js + read("site/assets/music-core.js")), "player source has no secrets");
  const pages = ["site/index.html", "site/about.html", "site/contact.html", "site/privacy.html", "site/terms.html", "site/responsible-gambling.html", "site/affiliate-disclosure.html", "site/subscribed.html", "site/unsubscribe.html", "site/404.html"];
  for (const f of pages) {
    const html = read(f);
    check(html.includes('id="musicBtn"') && html.includes('aria-label="Play background music"'), `${f} has the header button`);
  }
  check(read("site/index.html").includes('src="assets/music.js"') && read("site/about.html").includes('src="assets/music.js"'), "app and legal pages load the player");
  check(read("scripts/previews.py").includes("build_pages.MUSIC_BTN") && read("scripts/previews.py").includes('src="assets/music.js"'), "preview pages get the button");
  const sw = read("site/sw.js");
  const shell = sw.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
  check(shell && !/\.webm["']|\.m4a["']|assets\/music\//.test(shell[1]), "service worker precache does not include the audio");
  check(/startsWith\("assets\/music\/"\)/.test(sw) && sw.includes('"assets/music-core.js"') && sw.includes('"assets/music.js"'), "music folder skips the worker; the player scripts are precached");
  const home = read("site/index.html");
  check(home.includes("1-800-GAMBLER") && home.includes("21+") && home.includes('class="age-pill"'), "homepage 21+ notice and helpline stay");
  check(read("site/404.html").includes("1-800-GAMBLER") && read("site/responsible-gambling.html").includes("1-800-GAMBLER"), "404 and responsible-gambling helplines stay");
  check(read("site/assets/site.js").includes('aff-tag">Ad'), "Ad label stays");
}

console.log(fails.length ? `FAIL music: ${fails.length}` : "PASS music");
process.exit(fails.length ? 1 : 0);
