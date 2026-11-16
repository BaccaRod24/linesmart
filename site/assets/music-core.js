/* LineSmart background music: pure decisions (no DOM, no network, no audio).
   assets/music.js plays the loops. scripts/music_test.mjs checks this file.
   Tracks live in assets/music/. Nothing here starts playback. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MusicCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const KEY = "ls-music";
  const DEFAULT_VOLUME = 0.4;

  function clampVolume(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_VOLUME;
    return Math.min(1, Math.max(0, n));
  }

  /** Opus in WebM where the browser says it can play it. AAC in M4A otherwise (Safari, iOS). */
  function pickFormat(canPlayType) {
    let support = "";
    try { support = String((canPlayType && canPlayType('audio/webm; codecs="opus"')) || ""); }
    catch (e) { support = ""; }
    support = support.toLowerCase();
    if (support === "probably" || support === "maybe") return "webm";
    return "m4a";
  }

  function formatOrder(canPlayType) {
    const first = pickFormat(canPlayType);
    return first === "webm" ? ["webm", "m4a"] : ["m4a", "webm"];
  }

  function safeFileName(name) {
    return typeof name === "string" && /^[a-z0-9_]+\.(webm|m4a)$/.test(name) ? name : "";
  }

  function fileFor(track, format) {
    const files = (track && track.files) || {};
    const primary = safeFileName(format === "webm" ? files.webm : files.m4a);
    if (primary) return primary;
    return safeFileName(format === "webm" ? files.m4a : files.webm);
  }

  /**
   * Sample-accurate loop length in seconds. loop_samples / sample_rate is the musical join.
   * Never past the decoded buffer: a decoder that trims a little short still loops what it has.
   */
  function loopEndSeconds(track, bufferDuration) {
    const rate = Number(track && track.sample_rate) || 48000;
    const samples = Number(track && track.loop_samples);
    const dur = Number(bufferDuration);
    const hasDur = Number.isFinite(dur) && dur > 0;
    const musical = track && track.loop !== false && Number.isFinite(samples) && samples > 0 && rate > 0
      ? samples / rate : null;
    if (musical == null) return hasDur ? dur : 0;
    if (!hasDur) return musical;
    return Math.min(musical, dur);
  }

  function normalizeState(raw, ids) {
    let o = raw;
    if (typeof raw === "string") {
      try { o = JSON.parse(raw); } catch (e) { o = null; }
    }
    if (!o || typeof o !== "object") o = {};
    const known = Array.isArray(ids) ? ids.filter(id => typeof id === "string" && id) : null;
    let track = typeof o.track === "string" ? o.track : "";
    if (known && known.length) track = known.indexOf(track) >= 0 ? track : known[0];
    const title = typeof o.title === "string" ? o.title.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    return { on: o.on === true, track: track, volume: clampVolume(o.volume), title: title };
  }

  function nextTrackId(ids, current) {
    if (!ids || !ids.length) return "";
    const i = ids.indexOf(current);
    if (i < 0) return ids[0];
    return ids[(i + 1) % ids.length];
  }

  function buttonLabel(state, playing, open) {
    if (playing && open) return "Hide background music player";
    if (playing) return "Background music is playing. Show player";
    if (state && state.on) return "Resume background music";
    return "Play background music";
  }

  /** Saved "on" is a preference. The page may show it. It must not start audio by itself. */
  function gestureResumes(state, playing) {
    return !!(state && state.on === true && !playing);
  }

  function boot(state) {
    const s = normalizeState(state);
    return { play: false, pressed: s.on, label: buttonLabel(s, false, false) };
  }

  function serialize(state) {
    const s = normalizeState(state);
    return JSON.stringify({
      on: s.on,
      track: s.track,
      volume: Math.round(s.volume * 100) / 100,
      title: s.title,
    });
  }

  return {
    KEY: KEY,
    DEFAULT_VOLUME: DEFAULT_VOLUME,
    clampVolume: clampVolume,
    pickFormat: pickFormat,
    formatOrder: formatOrder,
    safeFileName: safeFileName,
    fileFor: fileFor,
    loopEndSeconds: loopEndSeconds,
    normalizeState: normalizeState,
    nextTrackId: nextTrackId,
    buttonLabel: buttonLabel,
    gestureResumes: gestureResumes,
    boot: boot,
    serialize: serialize,
  };
});
