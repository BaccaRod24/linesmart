/* Opt-in background music. Off until a click. A later visit shows the saved choice and
   waits for a gesture before it resumes (browsers block autoplay).
   Loops with the Web Audio API: decode the file, then an AudioBufferSourceNode with loopEnd
   at the track's loop point. An element loop attribute can click at the join, so this player does not use one.
   WebM (Opus) when the browser can play it, M4A otherwise. The file is fetched only after
   the visitor turns music on. Preferences live in localStorage under ls-music. */
(function () {
  "use strict";
  const Core = window.MusicCore;
  if (!Core || window.__lsMusic) return;
  window.__lsMusic = true;

  const BUTTON = '<button class="music-btn" id="musicBtn" type="button" aria-label="Play background music" aria-pressed="false" aria-expanded="false" aria-controls="musicPop" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 18.5V6l11-2v12.5"/><circle cx="6.5" cy="18.5" r="2.4"/><circle cx="17.5" cy="16.5" r="2.4"/></svg></button>';

  let state = Core.normalizeState(null);
  let catalog = null;
  let catalogP = null;
  let ctx = null;
  let master = null;
  let source = null;
  let sourceGain = null;
  let playing = false;
  let busy = false;
  let open = false;
  let error = "";
  let failed = false;
  let gen = 0;
  let aborter = null;
  let lastFormat = "";
  let lastLoopEnd = 0;
  let lastDuration = 0;
  let slot = null;
  let btn = null;
  let pop = null;

  function readRaw() {
    try { return localStorage.getItem(Core.KEY); } catch (e) { return null; }
  }
  function writeState() {
    try { localStorage.setItem(Core.KEY, Core.serialize(state)); } catch (e) {}
  }
  function assetUrl(rel) {
    const base = (typeof window.LS_ASSET_BASE === "string" && window.LS_ASSET_BASE) || document.baseURI;
    return new URL(rel, base).href;
  }
  function canPlay(type) {
    try { return document.createElement("audio").canPlayType(type) || ""; }
    catch (e) { return ""; }
  }

  function ensureSlot() {
    const have = document.getElementById("musicSlot");
    if (have && have.querySelector("#musicBtn")) return have;
    const bar = document.querySelector(".topbar-inner");
    if (!bar) return null;
    const el = document.createElement("div");
    el.className = "music";
    el.id = "musicSlot";
    el.innerHTML = BUTTON;
    const anchor = bar.querySelector(".brand-tag") || bar.querySelector(".brand");
    if (anchor && anchor.parentNode === bar) {
      if (anchor.nextSibling) bar.insertBefore(el, anchor.nextSibling);
      else bar.appendChild(el);
    } else bar.insertBefore(el, bar.firstChild);
    return el;
  }

  function ensureCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("no audio");
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = state.volume;
      master.connect(ctx.destination);
    } else {
      master.gain.value = state.volume;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function abortFetch() {
    if (aborter) { aborter.abort(); aborter = null; }
  }

  function stopSource() {
    if (!source) return;
    const src = source;
    const g = sourceGain;
    source = null;
    sourceGain = null;
    const now = ctx ? ctx.currentTime : 0;
    try {
      if (g) {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + 0.03);
      }
      src.stop(now + 0.04);
    } catch (e) {}
    src.onended = () => {
      try { src.disconnect(); } catch (e) {}
      try { if (g) g.disconnect(); } catch (e) {}
    };
  }

  function startSource(buf, track) {
    stopSource();
    const end = Core.loopEndSeconds(track, buf.duration);
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    if (end > 0) {
      try { src.loopEnd = end; } catch (e) { /* buffer is the loop */ }
    }
    g.connect(master);
    src.connect(g);
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + 0.05);
    src.start(now);
    source = src;
    sourceGain = g;
    lastLoopEnd = end;
    lastDuration = buf.duration || 0;
  }

  function loadCatalog() {
    if (catalog) return Promise.resolve(catalog);
    if (!catalogP) {
      catalogP = fetch(assetUrl("assets/music/tracks.json")).then(res => {
        if (!res.ok) throw new Error("catalog " + res.status);
        return res.json();
      }).then(data => {
        if (!Array.isArray(data)) throw new Error("catalog");
        const list = data.filter(t => t && typeof t.id === "string" && /^[a-z0-9_]+$/.test(t.id) && (Core.fileFor(t, "webm") || Core.fileFor(t, "m4a")));
        if (!list.length) throw new Error("catalog");
        catalog = list;
        return list;
      }).catch(err => { catalogP = null; throw err; });
    }
    return catalogP;
  }

  const decoded = new Map();
  async function loadBuffer(track) {
    const order = Core.formatOrder(canPlay);
    let last = null;
    for (let i = 0; i < order.length; i++) {
      const fmt = order[i];
      const name = Core.fileFor(track, fmt);
      if (!name) continue;
      const key = track.id + ":" + fmt;
      if (decoded.has(key)) { lastFormat = fmt; return decoded.get(key); }
      const ctrl = new AbortController();
      aborter = ctrl;
      try {
        const res = await fetch(assetUrl("assets/music/" + name), { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        decoded.set(key, buf);
        lastFormat = fmt;
        aborter = null;
        return buf;
      } catch (e) {
        if (e && e.name === "AbortError") throw e;
        last = e;
      }
    }
    throw last || new Error("no audio");
  }

  function label() {
    if (error) return open ? "Hide background music player" : "Background music hit a problem. Show player";
    return Core.buttonLabel(state, playing, open);
  }

  function paint() {
    if (!btn || !pop) return;
    btn.classList.toggle("is-on", !!state.on);
    btn.classList.toggle("is-playing", !!playing);
    btn.setAttribute("aria-pressed", state.on ? "true" : "false");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", label());
    pop.hidden = !open;
    const title = pop.querySelector("#musicTitle");
    const count = pop.querySelector("#musicCount");
    const status = pop.querySelector("#musicStatus");
    const toggle = pop.querySelector("#musicToggle");
    const vol = pop.querySelector("#musicVol");
    const pct = pop.querySelector("#musicPct");
    if (title) title.textContent = state.title || "Background music";
    if (count) {
      if (catalog) {
        const i = catalog.findIndex(t => t.id === state.track);
        count.textContent = i >= 0 ? (i + 1) + " of " + catalog.length : "";
      } else count.textContent = "";
    }
    if (status) {
      status.textContent = error ? error
        : busy ? "Loading…"
        : playing ? "Playing"
        : state.on ? "On. Tap anywhere to resume."
        : "Off";
    }
    if (toggle) toggle.textContent = (playing || (busy && state.on && !error)) ? "Pause" : "Play";
    if (vol && document.activeElement !== vol) vol.value = String(Math.round(state.volume * 100));
    if (pct) pct.textContent = Math.round(state.volume * 100) + "%";
    if (open) place();
  }

  function viewWidth() {
    // clientWidth stays the layout width. innerWidth can grow to the scroll width once a
    // popover sticks out, which would make the clamp think the overflow is on screen.
    return document.documentElement.clientWidth || window.innerWidth;
  }
  function place() {
    if (!open || !pop) return;
    pop.hidden = false;
    pop.style.right = "auto";
    pop.style.left = "0px";
    const pad = 8;
    const vw = viewWidth();
    const rect = pop.getBoundingClientRect();
    let shift = 0;
    if (rect.right > vw - pad) shift -= rect.right - (vw - pad);
    if (rect.left + shift < pad) shift += pad - (rect.left + shift);
    pop.style.left = shift + "px";
  }

  async function playCurrent() {
    const my = ++gen;
    abortFetch();
    failed = false;
    error = "";
    busy = true;
    state.on = true;
    writeState();
    paint();
    try {
      ensureCtx();
      const list = await loadCatalog();
      if (my !== gen || !state.on) return;
      const track = list.find(t => t.id === state.track) || list[0];
      state.track = track.id;
      state.title = String(track.title || track.id);
      writeState();
      paint();
      const buf = await loadBuffer(track);
      if (my !== gen || !state.on) return;
      if (ctx.state === "suspended") await ctx.resume();
      if (my !== gen || !state.on) return;
      startSource(buf, track);
      playing = true;
      error = "";
    } catch (e) {
      if (my !== gen || (e && e.name === "AbortError")) return;
      playing = false;
      failed = true;
      error = "Couldn't load this track. Check your connection and try again.";
      open = true;
      stopSource();
    } finally {
      if (my === gen) { busy = false; paint(); }
    }
  }

  function pause() {
    gen++;
    abortFetch();
    busy = false;
    playing = false;
    error = "";
    failed = false;
    state.on = false;
    writeState();
    stopSource();
    paint();
  }

  async function skip() {
    try {
      const list = catalog || await loadCatalog();
      const track = list.find(t => t.id === Core.nextTrackId(list.map(x => x.id), state.track)) || list[0];
      state.track = track.id;
      state.title = String(track.title || track.id);
      writeState();
      paint();
      if (state.on) await playCurrent();
    } catch (e) {
      error = "Couldn't load the track list. Check your connection and try again.";
      open = true;
      paint();
    }
  }

  function setVolume(v) {
    state.volume = Core.clampVolume(v);
    writeState();
    if (master && ctx) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(state.volume, now);
    }
    const pct = pop && pop.querySelector("#musicPct");
    if (pct) pct.textContent = Math.round(state.volume * 100) + "%";
  }

  function buildPop() {
    const el = document.createElement("div");
    el.className = "music-pop";
    el.id = "musicPop";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-labelledby", "musicTitle");
    el.hidden = true;
    el.innerHTML = '<p class="music-title" id="musicTitle">Background music</p>'
      + '<p class="music-count" id="musicCount"></p>'
      + '<p class="music-status" id="musicStatus" aria-live="polite">Off</p>'
      + '<div class="music-row"><button type="button" id="musicToggle">Play</button><button type="button" id="musicNext">Next</button></div>'
      + '<div class="music-vol"><label for="musicVol">Volume</label><input id="musicVol" type="range" min="0" max="100" step="1"><b id="musicPct" aria-hidden="true">40%</b></div>';
    slot.appendChild(el);
    el.querySelector("#musicToggle").addEventListener("click", () => {
      if (playing || (busy && state.on && !error)) pause();
      else { open = true; playCurrent(); }
    });
    el.querySelector("#musicNext").addEventListener("click", () => { open = true; skip(); });
    el.querySelector("#musicVol").addEventListener("input", e => setVolume(Number(e.target.value) / 100));
    return el;
  }

  function nearest(node) {
    if (!node) return null;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return el && el.closest ? el : null;
  }

  function mount() {
    slot = ensureSlot();
    if (!slot) return;
    btn = slot.querySelector("#musicBtn");
    pop = document.getElementById("musicPop") || buildPop();
    state = Core.normalizeState(readRaw());
    const boot = Core.boot(state);
    paint();
    if (boot.play) playCurrent();

    btn.addEventListener("click", () => {
      if (!state.on || failed) { open = true; playCurrent(); return; }
      if (!playing) { open = true; if (!busy) playCurrent(); else paint(); return; }
      open = !open;
      paint();
    });
    document.addEventListener("pointerdown", e => {
      if (e.button && e.button !== 0) return;
      const t = nearest(e.target);
      if (t && t.closest("#ageNotice")) return;
      const inBtn = t && slot.contains(t);
      const inPop = t && pop.contains(t);
      if (open && !inBtn && !inPop) { open = false; paint(); }
      if (!inPop && !failed && Core.gestureResumes(state, playing) && !busy) playCurrent();
    }, true);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        if (open) { open = false; paint(); btn.focus(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      if (!failed && Core.gestureResumes(state, playing) && !busy) playCurrent();
    });
    window.addEventListener("resize", () => { if (open) place(); });

    window.LineSmartMusic = {
      get playing() { return playing; },
      get busy() { return busy; },
      get open() { return open; },
      get format() { return lastFormat; },
      get loopEnd() { return lastLoopEnd; },
      get duration() { return lastDuration; },
      get audio() { return !!ctx; },
      get state() { return { on: state.on, track: state.track, volume: state.volume, title: state.title }; },
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
