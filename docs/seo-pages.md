# Crawlable pages (SEO)

`scripts/seo_pages.py` turns the data in `site/data/` into real, indexable HTML pages. It runs in the
refresh job, after the data refresh and before the deploy ("Build SEO pages" in
`.github/workflows/refresh-and-deploy.yml`). It never calls an odds API: it only reads what the refresh already wrote.

The output is **not committed** (see `.gitignore`). Each deploy rebuilds it from that run's data.

## URL patterns

| Page | URL | Example |
|---|---|---|
| League hub | `/<lg>/` | `/nfl/` |
| Game (upcoming, live or finished) | `/<lg>/games/<away>-at-<home>-<YYYY-MM-DD>/` | `/nfl/games/dallas-cowboys-at-philadelphia-eagles-2026-10-26/` |
| Player props | `/<lg>/props/<player>/` | `/nfl/props/jordan-love/` |
| Team | `/<lg>/teams/<team>/` | `/nba/teams/boston-celtics/` |
| UFC fight | `/ufc/fights/<a>-vs-<b>-<YYYY-MM-DD>/` | `/ufc/fights/aaron-pico-vs-losene-keita-2026-10-24/` (demo data) |
| UFC fighter | `/ufc/fighters/<name>/` | `/ufc/fighters/aaron-pico/` (demo data) |
| UFC event | `/ufc/events/<slug>-<YYYY-MM-DD>/` | `/ufc/events/ufc-333-volkanovski-vs-evloev-2026-10-24/` (demo data) |
| Results archive | `/<lg>/results/` | `/nba/results/` |
| Results month | `/<lg>/results/YYYY-MM/` | `/nba/results/2026-10/` |

`<lg>` is one of `nfl nba mlb nhl ncaaf ncaab ufc`. Every league always has a hub, even an empty one, so footer links
never break. The date is the game's date in ET. If two pages would get the same slug, `-2`, `-3` and so on are added.
A URL never changes once it is assigned, because the archive keeps it. Soccer gets no pages for now.

`data/pages.json` maps app routes to URLs (`{generated, l, g, t, p}`; UFC fighters go under `p`). `app.js` uses it to:
- replace a `#/` route that has a real page with that URL (`history.replaceState`);
- point game, team and player tiles at real URLs (the original hash is kept in `data-h`).

App-only sub-routes such as `#/l/nfl/all` stay hash routes.

## What is on a page

- A unique title, description, canonical, Open Graph and Twitter tags, plus JSON-LD.
- Game, fight and UFC event pages carry an `ItemPage` (a `WebPage`), not a `SportsEvent`. Google's Event rich result
  warns on `offers` for every Event subtype, and these pages do not sell tickets. The JSON-LD does not invent a price,
  a ticket, or an `offers` property. The description is the page snippet (or a factual sentence from the teams, time and
  place when that snippet is blank). The game window is `temporalCoverage` (an ISO 8601 interval: start plus `EVENT_HOURS`
  per league; a UFC card runs until `UFC_CARD_TAIL_H` after its last segment starts). The venue is `contentLocation`.
  The league is `mentions` (name + official site). The teams or fighters are `about`, linked to their LineSmart pages.
  A fight's `isPartOf` is the card page, with the same description and no offer.
- Real text content in `main#app`: matchup, time and venue, lines by book, movement, weather, injuries, form, props and result.
- The persistent internal links in `section.seo-more`:
  - game ↔ props, teams, weather, movement and related games;
  - player ↔ game and their other props;
  - the hubs link to everything;
  - the footer links the hubs.
- **Discover links** (`nav.sx-discover`): plain `<a href>` links, in the static HTML. The homepage lists every league
  (NCAAF and NCAAB anchors say "odds, lines and spreads"), this week's games (up to 12 per league, topped up to 3 when
  the week is empty), and player-prop pages that have a number on those games (up to 8 per league). Each league page
  repeats the other leagues under the lead and again outside `#app`. This week's games and prop pages for that sport
  sit in `div.sx-week` above `#app`, under the headings "Games this week" and "Player props this week" (up to 80 games, topped up to 12; up to 24 prop pages), so they stay in the HTML
  after the app replaces `#app`. The list wraps on a phone. Caps keep the homepage from growing back toward the old
  multi-megabyte size.
- Plain-HTML internal links near the top (crawlable without JS; only pages that exist in this build):
  - **Hub: today's slate** (`#today-s`, `ul.sx-today`) right under the lead: today's games (ET) with time / LIVE / score,
    or, when today is done or empty, the next day that has games ("Next NFL games: Thursday, October 29"). With no
    upcoming games at all it says "No games today." For JS users the hub hydrates into the app's own slate, which already
    links every game.
  - **Game: next matchups** (`#next-s`, `ul.sx-next`): each team's next scheduled game page after this one
    (`next_games()`), e.g. "Next for the Ravens: at Bills, Sun 11/1". Finished games get it too. On static pages it sits
    right under the odds; on hydrated (current) games it is the first block in `section.seo-more`, so it stays visible.
    Teams and the league hub stay linked from `seo-more`.
- **Line alert entry** (`.al-cta`, "Get a line alert") under the odds on upcoming games in the data window that have
  lines, and on each prop card (`.al-cta-prop`, pre-filled with player + market) for upcoming games. It opens the
  existing alert sheet in `assets/alerts.js` (`[data-al]` / `[data-al-prop]`); nothing new on the backend. Live,
  finished and archived games and archived props get none (alerts end at kickoff). See `docs/line_alerts.md`.
- The normal app shell and JS. Hubs that have data, and current games that aren't final, hydrate into the live app view.
  Past games stay static.
- **No offers in the HTML.** State-aware offers (Florida: Hard Rock Bet only; Nevada: no BetMGM) are still filled in by JS
  (`LSGeo`), exactly as before. The 21+ notice, 1-800-GAMBLER, the affiliate disclosure and the privacy footer are part
  of every page.

## Titles and descriptions

Titles use the phrases people search for and end in ` | LineSmart`. The whole title, suffix included, is kept to 60
characters (`TITLE_MAX`). `fit()` takes the first candidate that fits with the suffix (the phrase itself can be at most
48 characters). If none fit, it drops the suffix, then cuts at a word boundary. Game and player-prop titles use
`prefer_title()` instead: the first phrase that fits in 60 wins, and the suffix stays only when that phrase still fits
with it. Long names fall back to abbreviations or a last name only after the readable form no longer fits.

- Upcoming or live game, away team first: `Ravens vs Bills Nov 1: Odds & Line Movement | LineSmart`. The title leads
  with the matchup and the date (ET), then what the page has: odds and line movement, and player props when a prop is
  posted (`Odds, Line Moves & Props`). A live game says `Live Odds & Line Moves`. `prefer_title()` keeps a long readable
  name that fits in 60 ahead of an abbreviation that would have kept the brand suffix. `Trail Blazers` is `Blazers` in
  the title and the description. The same title is used before lines are posted, so it does not change when the number
  arrives. The three books stay in the description, not the title.
- Description: `Ravens vs Bills on Sun, Nov 1, 1:00 PM ET: NFL odds and line movement. Compare DraftKings, FanDuel and Hard Rock Bet.`
  A posted spread or total is added when it fits (`Bills -3.5, total 53.5.`). College games say odds, lines and spreads.
  Neutral comparison only: no pick, and nothing that says DraftKings or FanDuel is legal or available in Florida.
- Player props: `Josh Jacobs (GB) Props: DK, FD & HR (Oct 29) | LineSmart`. The description names the player, the date
  and the same three books. A long name drops to the last name before it drops the date.
- UFC fight: `Fighter vs Fighter Odds (Nov 7)` (last names if the full names don't fit). DraftKings is the only book named.
- Finished game: `Bengals vs Ravens Oct 25: Final Score 35-13 & Box Score`. The matchup and date come first, then the
  final score and box score. Overtime stays in the score (`27-21, OT`). UFC keeps `Result` (and `Result & Odds` when a
  closing line was recorded).
- Finished-game description: `Bengals vs Ravens result, Sun, Oct 25: CIN 35, BAL 13. Box score. No lines were recorded before the start.`
  With a closing line: box score, closing odds, and how the spread graded. At most 155 characters (`DESC_MAX`), including the homepage.
- League hubs and team/fighter pages add an `ItemList` of the game or fight URLs linked on the page (hub: inside the
  `CollectionPage`; team: `mainEntity` of the page about the `SportsTeam` or fighter `Person`). The homepage
  `Organization` has `sameAs` and `alternateName`. No `SearchAction`.
- Hub titles and H1s follow the queries those pages already show for. `/nfl/`: `NFL Spreads & Betting Lines Today`,
  H1 `NFL spreads and betting lines`. `/nba/`: `NBA Odds Today: Spreads, Totals & Props`, H1 `NBA odds today`.
  `/ncaaf/`: `College Football Lines, Spreads & NCAAF Odds`, H1 `College football lines, spreads and NCAAF odds`.
  `/ncaab/`: `NCAAB Lines & College Basketball Spreads`, H1 `NCAAB lines and college basketball spreads`.
  College game descriptions still say lines, spreads and odds. The game title stays the matchup, the date, and odds.
- Team, fighter and event pages: `<Team> Odds & Schedule (NFL)`, `<Fighter> UFC Odds, Record & Fight Results`.
  Player-prop pages use the props title above.
- `og:title` and `twitter:title` always equal `<title>`. `og:description` and `twitter:description` always equal the meta
  description, because they are written from the same string. If two finished game pages would share a title (a series),
  the date is added. Upcoming titles already include the date, so a same-day collision gets the start time instead.
  That pass goes through `with_extra()` so the extra token cannot push the title back over 60 characters. Anything still
  shared gets the page slug. The H1 and the visible content don't change with the title.

`content_hash()` covers the title and meta description as well as `main#app`, so a new title or snippet moves the page's
`lastmod` (and gets sent to IndexNow).

## Finished games (archive)

Set `ARCHIVE_DIR` (or `--archive`) to keep finished games. In the workflow this is `_history/pages` on the
`data-history` branch, with a snapshot in `.linehist-snap/_pages` for the push-retry path. It holds:

- `games-<lg>.json`: for each game, its URL, the last lines seen within `ARCHIVE_AHEAD_H` (6h) of the start (= the
  closing lines), movement, and the final score. Missing finals are backfilled from the teams' `recent` results, matched by ESPN event id (or, for rows with no id, same opponent, same home/away side and same ET date). Games still in ESPN's data window are never backfilled, and an archived final is re-checked against id-matched rows so a wrong score self-heals.
- `players-<lg>.json`: player URLs and their recent props.
- `state.json`: a content hash and lastmod for each page, so `lastmod` only changes when the content changes.

Finished games keep their page permanently, with the final score, closing lines and how each line graded.
Nothing is pruned from the archive. A game with no stored closing line says "Closing lines not recorded" instead of
showing an empty table. Postponed games stay up labeled Postponed and are never treated as a final. Canceled games
stay up labeled Canceled, with no score. Team URLs are remembered in `state.json` (`team_paths`); a rename leaves the
old slug as a canonical + meta-refresh stub, because GitHub Pages can't send a 301.

`/<lg>/results/` lists the last 14 days and links each month. `/<lg>/results/YYYY-MM/` lists that month's finals
(UFC: events). Hubs link the archive. Team pages link the last 10 results from the archive and a "Full results" jump
to that team's section on the archive page.

The archive grows with the season (on the order of 10k games across 7 leagues). If `games-<lg>.json` or the 20-minute
job starts to strain, shard `games-<lg>.json` by season. Don't do that until the file is actually large.

If the archive can't be checked out, the step still runs without one. Finished games then only exist while they are
still in the live data.

## Redirects

The old `/preview/...` pages are now small stubs with no `<base>` tag. Each one has a canonical pointing to its new
URL, a meta refresh, and a `location.replace` that keeps the hash:

- `/preview/` → `/`
- `/preview/<lg>/` → `/<lg>/`
- `/preview/<lg>/<game>/` → the game page
- an upcoming game URL that this build no longer writes, because the game left `select()` before it was archived
  as a final (a college game whose line comes down) → `/<lg>/`

That last stub is how a page Google already fetched avoids a hard 404 when the line flickers. It carries no odds
and no Pro data. A game that has never had a page is not given a URL. Stubs carry no `noindex`: mixing a canonical
and noindex sends search engines mixed signals. `404.html` also sends unknown `/preview/<lg>/...` URLs to the hub.
Pro pages stay `noindex` the way they already are.

## Site files

- `sitemap.xml` is a sitemap index. Children, each a urlset under 50,000 URLs and with no URL repeated:
  - `sitemap-core.xml`: home, tool pages (about, responsible gambling, privacy, terms, affiliate disclosure), hubs, teams and fighters. Tool pages sit outside the generated block.
  - `sitemap-live.xml`: upcoming and live games, player-prop pages that still have a line on a game that has not finished, and games that are postponed or canceled. A prop page kept for history after its last line ("No new lines posted") stays published and leaves this file.
  - `sitemap-games-<lg>-YYYY-MM.xml`: finished games (and finished UFC cards) for that month. A month that would pass 50,000 URLs is split into `…-2.xml`, `…-3.xml`.
  - `sitemap-results.xml`: `/<lg>/results/` and the month pages.
  `lastmod` comes from a content hash that ignores the cross-link blocks. A finished game's lastmod freezes when the final is recorded and moves only if the score or the closing line changes. The committed `sitemap.xml` points at `sitemap-core.xml`; the build rewrites the index and the children.
  A game or fight URL is added to a child sitemap only when this same build wrote that page's HTML, and it is removed in the build that stops writing the page. A redirect stub is never listed. `sitemap-games-*.xml` therefore never names a game before its page exists or after that page is gone.
  The sitemap also leaves out thin URLs: past games with no odds (no posted line and no closing line) or no recorded score, postponed or canceled games with no odds, empty prop pages (no posted number), prop pages with no current or upcoming line, UFC fighter pages with no booked upcoming bout (those pages stay up with `noindex`), empty UFC cards, duplicate URLs, and any file whose canonical points somewhere else or that is a meta-refresh. Hubs, results, standings, team pages, booked fighters, upcoming and live games, and finished games that have odds and a score stay.
- `robots.txt`: points to the sitemap.
- `index.html`: the homepage cards (top games, line moves, hot props with last-5 strips) are filled in between the
  `HOME` markers. The committed file keeps them empty.

## IndexNow

[IndexNow](https://www.indexnow.org/) tells Bing, Yandex, Seznam, Naver and others that a URL is new or changed, so they
recrawl it without waiting for the sitemap. Google doesn't use IndexNow; it keeps using the sitemap.

- **Key file:** `site/3ae969c61e5480137cf96b41a75edbfc.txt`, served at
  `https://linesmart.app/3ae969c61e5480137cf96b41a75edbfc.txt`. It contains only the key. The key is public by design: it
  only proves we control the host.
- **When it runs:** the `indexnow` job in `refresh-and-deploy.yml`, after the `deploy` job succeeds, on `main` only
  (push, the 30-minute schedule and manual runs). It sends at most one request per run.
- **What it sends:** at the start of the build job, the live `sitemap.xml` is fetched (the version from before this
  deploy). After the SEO build, the new sitemap is saved, and both are passed to the indexnow job as the short-lived
  `indexnow` artifact (`_indexnow/prev/` and `_indexnow/new/`, index plus child files). `scripts/indexnow_ping.py` reads a sitemap index and the child files next to it, and compares only the generated pages block of each urlset. A URL is sent if it is new, or
  if its `lastmod` changed, which only happens when the page's content, title or description changed (a finished game's lastmod stays put). Up to 10,000 URLs
  go in one POST to `https://api.indexnow.org/indexnow` with `host`, `key`, `keyLocation` and `urlList`. Removed
  pages are not sent. A dropped upcoming game refreshes to its sport hub. Any other URL this build does not write returns the 404 page.
- **Skips:** nothing new or changed; the live sitemap couldn't be fetched (the job never resubmits everything blind);
  the SEO build or the archive checkout failed (lastmods would not be stable); no key file.
- **Failures never fail the deploy.** The deploy has already finished when the job starts. The script logs the
  HTTP status (200 OK, 202 key pending, 400/403/422/429 errors) with a warning annotation, and always exits 0. The job
  is `continue-on-error`. There is no retry: pages changed later are picked up by the next diff, and the sitemap still covers the rest.
- **Rotate the key:** run `python3 -c "import secrets; print(secrets.token_hex(16))"`, save the output (with no other
  text) as `site/<key>.txt`, and delete the old file in the same commit. The script picks up whichever single
  `<32 hex>.txt` file is in `site/`.
- **Dry run:** `python3 scripts/indexnow_ping.py --prev old-sitemap.xml --new site/sitemap.xml --dry-run` prints what
  would be sent, and sends nothing.

## One-time backfill (games before the archive)

The finished-game archive on `data-history` starts 2026-10-27 (commit `fcbc0d3`). Games before that were never captured.
ESPN's public scoreboard (`?dates=YYYYMMDD`) still returns events back to at least the 2010 season for all 7 leagues
(checked 2026-10-28: NFL, NBA, NCAAF, NCAAB, NHL, MLB and UFC all had real events on 2010 dates; the current season's
calendar start is the right place to begin). Closing lines exist in git history of `history/<lg>.json` from
2026-10-26 02:46 UTC. Earlier games are stored with `"closing": null`.

Run this once, locally, after this change is on main. It never calls The Odds API, and it never commits or pushes.

NBA `?dates=20261026` and `?dates=20261027` are HTTP 200 with a 0-byte body (checked 2026-10-29). The same
dates with `&limit=100` return the games, and the nine Oct 26 ET finals are on `20261026`, not the next UTC
day. `build_data.fetch_scoreboard` retries the bare URL once with `limit=100`. A real off day (JSON, no events)
is not retried. The first backfill (data-history `2c7d745`) missed 2026-10-26 because of the empty body.

```sh
# How far back ESPN goes, and where this season starts. No files written.
env -u ODDS_API_KEY python3 scripts/backfill_results.py --probe

# A few dates into a scratch directory (safe to try before the full run):
env -u ODDS_API_KEY python3 scripts/backfill_results.py \
  --league nba --dates 2026-10-20,2026-10-23,2026-10-26 --out /tmp/linesmart-backfill

# Full backfill. --history is a checkout of data-history (the workflow uses _history/).
# --out is the pages directory the SEO build reads (workflow: _history/pages).
# Existing games that already have closing lines are left alone.
env -u ODDS_API_KEY python3 scripts/backfill_results.py \
  --out /path/to/data-history/pages \
  --history /path/to/data-history \
  --through 2026-10-27
```

Then review `games-*.json`, commit on `data-history`, and push that branch yourself. The next refresh builds the pages.
Do not run this from CI.

## Running and testing locally

```sh
env -u ODDS_API_KEY python3 scripts/seo_pages.py --site /tmp/site-copy --now 2026-10-27T12:00:00Z   # build into a copy
env -u ODDS_API_KEY python3 scripts/seo_pages_test.py     # static checks (titles, canonicals, links, sitemap, archive, redirects)
env -u ODDS_API_KEY python3 scripts/series_results_test.py # same two teams on back-to-back dates: finals never cross games
env -u ODDS_API_KEY node scripts/seo_pages_test.mjs       # browser checks (state offers, #/ -> real URL, tiles, 404, stubs)
env -u ODDS_API_KEY python3 scripts/indexnow_ping_test.py  # IndexNow: sitemap diff, one batched POST, skips, errors (no network)
env -u ODDS_API_KEY python3 scripts/backfill_results_test.py  # backfill merge + closing lines from a local git fixture (no network)
```

Both tests build into a temp copy, so `site/` is never touched. Set `DATA_DIR=/path/to/data` to test with other data.
