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
ODDS_API_KEY=xxxx python3 scripts/build_data.py    # also pull DraftKings/FanDuel/Hard Rock Bet from The Odds API
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

## Multi-book odds (optional): The Odds API v4
When `ODDS_API_KEY` is set, the script calls `GET https://api.the-odds-api.com/v4/sports/{sport_key}/odds?bookmakers=draftkings,fanduel,hardrockbet&regions=us,us2&markets=h2h,spreads,totals&oddsFormat=american` for each league (`bookmakers` takes precedence over `regions`; `us2` is where Hard Rock Bet lives). It matches events to ESPN games by start time and team names, then fills the comparison table. The best price is highlighted.

Without a key, the FanDuel and Hard Rock Bet columns show N/A. Odds are never faked.

- Bookmaker keys: `draftkings`, `fanduel` (region `us`) and `hardrockbet` (region `us2`). There are also state-specific keys `hardrockbet_az`, `hardrockbet_fl` and `hardrockbet_oh`.
- Cost: markets × regions per call. Up to 10 bookmakers count as one region. One full refresh is 3 markets × 9 leagues ≈ **27 credits**.
- Free Starter tier: **500 credits/month**, which is about 18 full refreshes. Paid plans start at $30/mo for 20K credits.
- Usage headers: `x-requests-remaining` and `x-requests-used`.

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

## Limitations
- ESPN reports one book per game. FanDuel and Hard Rock Bet need The Odds API.
- Lines appear only once the book posts them. NBA, NHL and NCAAB lines usually show up a day or so before the game.
- ESPN's free feeds return empty ATS records, so the site shows N/A for ATS.
- Detailed summaries are capped at 150 games per league per run (`MAX_SUMMARIES`). This affects NCAAB.
- Soccer (ESPN) has no injury data.
- Unofficial ESPN endpoints may change without notice.

Gamble responsibly. 21+. 1-800-GAMBLER.
