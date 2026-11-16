# LineSmart site music: 6 seamless loops

Six original background loops for linesmart.app. Each one is about 2 minutes long, built on whole bars, and loops seamlessly: there are no fades and no tail, and the last sample flows straight back into the first. All are mastered to **-16 LUFS integrated, true peak ≤ -1 dBTP** (actual peaks are between -2.3 and -5.9 dBTP), with no clipping.

| slug | title | BPM | key | length | mood |
|---|---|---|---|---|---|
| game_day_hype | Game-Day Hype | 128 | A minor | 2:00.0 | energetic game-day electronic: supersaw arps, sidechain pump, builds, two drops |
| prime_time | Prime Time | ~94 | C minor | 2:02.6 | boom-bap: swung drums, gliding 808, electric piano, bell hook |
| study_the_lines | Study the Lines | ~78 | D minor (Dorian) | 2:03.1 | chill lo-fi: dusty drums, jazz electric piano, tape wobble, vinyl crackle |
| late_night_slate | Late Night Slate | 100 | B minor | 1:55.2 | night-drive synthwave: analog pads, arpeggiated bass, gated snare |
| sunday_countdown | Sunday Countdown | ~110 | D minor | 2:02.2 | stadium anthem: drumline snares and toms, brass stabs |
| halftime | Halftime | 90 | E minor (Dorian) | 1:57.3 | mellow funk / neo-soul: Rhodes, guitar chops, clav, syncopated bass |

Section layouts are in `tracks.json` (`structure`). For example, Game-Day Hype runs intro, build, drop A, breakdown, build, drop B, outro.

## Files
- `<slug>.m4a`: AAC-LC, 128 kbps, 48 kHz stereo. The MP4 edit list trims the encoder priming and padding, so it decodes to exactly `loop_samples`.
- `<slug>.webm`: Opus, about 96 kbps VBR, 48 kHz stereo. Pre-skip and end trimming are handled by the container, so it also decodes to exactly `loop_samples`.
- `masters/<slug>.wav`: 48 kHz 16-bit stereo masters. These are the source of truth.
- `tracks.json`: metadata (title, mood, BPM, key, duration, loop sample count, file paths relative to this folder, sizes, loudness).

## Playing them gaplessly on the web
Use the **Web Audio API**: fetch, then `decodeAudioData`, then an `AudioBufferSourceNode` with `loop = true`, ideally with `loopStart = 0` and `loopEnd = loop_samples / 48000`. A plain HTML `<audio loop>` element can leave a small gap or click at the loop point, especially with AAC or MP3, because of how browsers handle encoder delay. Serve `webm` (Opus) where supported and `m4a` as the fallback, which mainly matters for older Safari.

```js
const ctx = new AudioContext();
const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
src.loopStart = 0; src.loopEnd = track.loop_samples / 48000;
const gain = ctx.createGain(); gain.gain.value = 0.5;   // fade the gain node for start/stop
src.connect(gain).connect(ctx.destination); src.start();
```

## License / source
All six tracks are **original compositions made on our own machine for LineSmart, and LineSmart owns them outright.** Every sound (drums, bass, keys, pads, brass, guitar-like plucks, crackle) was synthesized from scratch in Python with numpy and scipy. **No third-party audio is used:** no samples, loops, soundfonts, presets, or downloaded or AI-service-generated audio. The only outside software involved is open-source tooling that adds no audio content: numpy and scipy (BSD) for synthesis, and ffmpeg for loudness measurement and AAC/Opus encoding.

## Regenerating
The code lives in `/workspace/youtube/music_library/`:
- `synth.py`: instruments and effects (from the first Shorts music options)
- `songs2.py`: extra instruments from the previews (gated snare, drumline snare, brass, plucked string, clav, synth bass, chorus)
- `songs_site.py`: the six full arrangements. It renders circularly, so reverb and echo tails wrap into the head. It also normalizes to -16 LUFS.
- `encode_site.py`: builds the loop-safe AAC (wrapped encode plus edit-list patch) and the Opus files
- `seamcheck.py`: the loop-seam checker (plays each file twice back-to-back and inspects the join)

```bash
cd /workspace/youtube/music_library
python3 songs_site.py game_day_hype prime_time study_the_lines late_night_slate sunday_countdown halftime
python3 encode_site.py game_day_hype prime_time study_the_lines late_night_slate sunday_countdown halftime
python3 seamcheck.py site/*.m4a site/*.webm site/masters/*.wav
```
Rendering is deterministic: fixed random seeds produce identical output. Prime Time, Study the Lines, and Sunday Countdown have their tempo nudged by under 0.01 BPM, so each loop is an exact multiple of 1024 samples (one AAC frame).
