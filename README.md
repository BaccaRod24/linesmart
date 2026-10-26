# LineSmart (v1): sports betting data site

LineSmart is a static site (plain HTML/CSS/JS) with upcoming games, betting lines, team stats, home/away splits, recent form, last-5 results and injuries. It covers **NFL, NBA, NCAAF (FBS), NCAAB (men), NHL, MLB, EPL, MLS and UEFA Champions League**.

All numbers come from real public sources. Nothing is hardcoded or invented. Missing data shows as **N/A**.

The brand name lives in one place: `site/assets/config.js` (`SITE_CONFIG.name`).

## Structure
```
scripts/build_data.py    # data refresh (Python 3 stdlib only) -> site/data/*.json
scripts/line_history.py  # line-movement history: snapshot merge, prune, summaries (used by build_data.py)
scripts/screenshots.mjs  # Playwright screenshots (optional)
scripts/subpath_test.mjs # Playwright check that the site works under /linesmart/ (optional)
.github/workflows/refresh-and-deploy.yml  # scheduled data refresh + GitHub Pages deploy
site/index.html          # single-page app (hash routes: #/l/nfl, #/g/nfl/<eventId>)
site/assets/{config.js,styles.css,app.js}
site/data/meta.json, site/data/<league>/index.json, site/data/<league>/games/<id>.json
```

## Refresh data
```bash
python3 scripts/build_data.py                      # all leagues, today (ET) + next 9 days
python3 scripts/build_data.py --leagues nfl,epl    # subset
python3 scripts/build_data.py --days 7
ODDS_API_KEY=xxxx python3 scripts/build_data.py --odds-cache-dir /tmp/odds   # also pull Hard Rock Bet (27 credits)
```
A full run takes about 2.5 minutes, with roughly 1,000 ESPN requests and no key needed. Lines move, so refresh as often as you like. Some ways to automate it:
- cron: `*/30 * * * * cd /path/to/site && python3 scripts/build_data.py`
- GitHub Actions: `.github/workflows/refresh-and-deploy.yml` rebuilds data every 30 min and deploys to GitHub Pages without committing data (see `DEPLOY.md`)

## Run locally
```bash
python3 -m http.server 8765 -d site   # open http://localhost:8765/
```

## Deploy
Publish the `site/` folder on Netlify, Cloudflare Pages or GitHub Pages. There is no build step. All asset and data URLs are relative, so the site works from a subpath such as `https://baccarod24.github.io/linesmart/`. GitHub Pages setup and commands: see `DEPLOY.md`.

## Data sources (ESPN public JSON, no key)
- Scoreboard: `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD` (one day per call; date ranges return 400). NCAAF adds `groups=80&limit=300` and NCAAB adds `groups=50&limit=300`.
- Game summary: `.../summary?event={id}`. This returns `pickcenter` (lines with open and current values), team season stats, last five games, injuries, predictor, leaders and season series.
- Team schedule: `.../teams/{id}/schedule`. Used to compute PF/PA, home/away splits, last 10 and streak.

Odds come from the single sportsbook ESPN lists (currently DraftKings). It is labeled with the provider name ESPN reports.

## Hard Rock Bet: The Odds API v4 (free plan)
DraftKings comes from ESPN on every run. Hard Rock Bet comes from The Odds API, but only on **pull runs**. A pull run is the dedicated every-other-day cron, or a manual run with `pull_odds=true` (see `DEPLOY.md`). FanDuel is not tracked on the free plan, so it has no column.

- **Request:** each league calls `GET /v4/sports/{sport_key}/odds?bookmakers=hardrockbet&regions=us2&markets=h2h,spreads,totals&oddsFormat=american`. `bookmakers` takes priority over `regions`, and `hardrockbet` is in `us2`. There are also state keys `hardrockbet_az`, `hardrockbet_fl` and `hardrockbet_oh`. Events are matched to ESPN games by start time and team names.
- **Cost:** markets × regions, so 3 credits per league and **27 credits** for all 9 leagues. A league with no events costs 0.
- **Credit guard:** before pulling, the script calls `GET /v4/sports`, which is free and still returns `x-requests-remaining`. It skips the whole pull if fewer than `ODDS_MIN_CREDITS` (35) remain or the count is unknown. It also stops league by league if fewer than 3 remain, and logs the remaining and spent credits.
- **Persistence:** the last pull is stored in `odds/hardrockbet.json` on the `data-history` branch. That file has a `pulledAt` per league, a `line` per ESPN game id, and a log of credit checks. It is read by `--odds-cache-dir` / `ODDS_CACHE_DIR`, and every build merges it in, so the 30-minute keyless runs keep the Hard Rock column populated. The site labels it "as of <pull time ET>".
- **Started games:** once a game starts (ESPN state isn't `pre`, or kickoff has passed), its cached Hard Rock line is replaced by a `stale` marker and the site shows "closed · game started". Old pre-game lines are never presented as live.
- **History:** Hard Rock points are recorded in line history at the pull time, once per pull. Repeat keyless runs add nothing.
- Odds are never faked. With no pull yet, the column says "no pull yet".

## Line movement
Every refresh snapshots each pre-game line (spread, moneyline and total, per book) with a UTC timestamp and merges it into `history/<league>.json`.
```bash
python3 scripts/build_data.py --history-dir ../linesmart-history/history --snap-dir /tmp/linesnap   # or env LINE_HISTORY_DIR / LINE_SNAP_DIR
python3 scripts/line_history.py apply --snap-dir /tmp/linesnap --history-dir ../linesmart-history/history  # re-merge saved snapshots
```
- **Storage:** in CI the history lives on the `data-history` branch, never on `main`. Each game keeps the opening line plus a point only when something changes, so files stay small. `lastSeen` records the last check.
- **Pruning:** games that started more than 3 days ago are dropped (`PRUNE_DAYS` in `line_history.py`).
- **Site data:** each `games/<id>.json` gets that game's `history`. League cards get `move` (open → current, plus notable flags).
- **Open line:** this is ESPN's open when ESPN reports one (it comes from pickcenter, so arrows work right away). Otherwise it is the first line we recorded. Many NFL ESPN opens are look-ahead lines from a week or more earlier, so big moves are common.
- **Notable moves:** spread moved ≥1.5 (football and basketball), the spread crossed 3 or 7 (NFL/NCAAF), or the total moved ≥2 (football), ≥3 (basketball) or ≥0.5 (other sports).
- **Detail page:** a step chart of spread, total or moneyline over time. The moneyline is plotted as implied win %, because American odds jump from -100 to +100. A book toggle appears when more than one book has data. Below the chart are open, current, change, biggest move and last change, in ET.

## Search, team and player pages
- Search button in the header (or press `/`). Type-ahead covers teams and players in all 9 leagues; arrow keys + Enter work. Routes: `#/search/{q}`, `#/t/{league}/{teamId}`, `#/p/{league}/{athleteId}`. They are plain hash routes, so they survive a reload and work in the installed app.
- Index: `build_data.py` writes `site/data/search/{league}.json` (compact arrays, about 445 KB gzipped for all 9 leagues). All teams are included. Player rosters cover pro leagues fully, NCAAF **FBS** programs and NCAAB **Division I** programs only. Team pages for other college programs load their roster live from ESPN, but those players are not searchable.
- Rosters (about 140 + 360 college calls) are cached for 20 h (`--roster-cache-dir`, `--roster-max-age-hours`). In CI the cache lives on the `data-history` branch under `rosters/`. A team whose roster fetch fails keeps its last cached copy.
- `python3 scripts/build_data.py --search-only` rebuilds just the index (no odds, no league files). `--no-search` skips it.
- Team and player stats, schedules, bios and game logs are fetched in the browser from `site.web.api.espn.com` (CORS-enabled; `site.api.espn.com` is not). The service worker caches those responses network-first, so recently viewed pages open offline. MLB uses `seasontype=2` (regular season) because ESPN defaults to the postseason. Soccer team stats are computed from the competition's results, and upcoming soccer fixtures come from `?fixture=true`.
- Next-game lines on a team page come only from our own league data (the 10-day window). They are never invented.

## Color themes (preview)

All colors are CSS custom properties in `site/assets/styles.css` (`:root`). Alternate themes override them via `:root[data-theme="…"]`; `site/assets/theme.js` applies one from `?theme=` (not persisted). The default (no query) is the original LineSmart look.

Preview: `?theme=sportsbook`, `?theme=midnight`, `?theme=daylight`, `?theme=vegas` (e.g. `/linesmart/?theme=midnight#/l/nfl`).

Screenshots + comparison sheets (serve the site under `/linesmart/` first):
`BASE=http://localhost:8811/linesmart/ DATA_DIR=<data dir> node scripts/theme_screenshots.mjs` → `screenshots/themes-compare-*.png`.

## Limitations
- ESPN reports one book per game. Hard Rock Bet is refreshed only every other day (free plan). FanDuel is not tracked.
- Lines appear only once the book posts them. NBA, NHL and NCAAB lines usually show up a day or so before the game.
- ESPN's free feeds return empty ATS records, so the site shows N/A for ATS.
- Detailed summaries are capped at 150 games per league per run (`MAX_SUMMARIES`). This affects NCAAB.
- Soccer (ESPN) has no injury data.
- Unofficial ESPN endpoints may change without notice.

Gamble responsibly. 21+. 1-800-GAMBLER.

## Install as an app (PWA)

LineSmart is an installable Progressive Web App (`site/manifest.webmanifest` + `site/sw.js`, all paths relative so it works under `/linesmart/`).

- **iPhone/iPad:** open the site in Safari → Share → **Add to Home Screen**.
- **Android:** open in Chrome → ⋮ menu → **Install app** (or tap the **Install app** button in the header when it appears).
- **Desktop Chrome/Edge:** install icon in the address bar, or the header button.

Caching: the app shell (HTML/CSS/JS/icons) is cache-first from a versioned cache. The workflow stamps `VERSION` in `sw.js` on every deploy (shell hash + build time), so each deploy installs a fresh worker. Page navigations and all `data/*.json` are network-first, so the 30-minute refresh shows up as soon as you reload. Cached data is used only when you're offline, with a banner saying so and showing when the data was generated.
Icons are generated from `site/assets/brand/icon.svg` (192/512 "any" plus a 512 maskable icon with a full-bleed background). `scripts/subpath_test.mjs` checks the manifest, icons, SW registration/control, Chromium installability and offline rendering.
