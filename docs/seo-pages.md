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

`<lg>` is one of `nfl nba mlb nhl ncaaf ncaab ufc`. Every league always has a hub, even an empty one, so footer links
never break. The date is the game's date in ET. If two pages would get the same slug, `-2`, `-3` and so on are added.
A URL never changes once it is assigned, because the archive keeps it. Soccer gets no pages for now.

`data/pages.json` maps app routes to URLs (`{generated, l, g, t, p}`; UFC fighters go under `p`). `app.js` uses it to:
- replace a `#/` route that has a real page with that URL (`history.replaceState`);
- point game, team and player tiles at real URLs (the original hash is kept in `data-h`).

App-only sub-routes such as `#/l/nfl/all` stay hash routes.

## What is on a page

- A unique title, description, canonical, Open Graph and Twitter tags, plus JSON-LD.
- Real text content in `main#app`: matchup, time and venue, lines by book, movement, weather, injuries, form, props and result.
- The persistent internal links in `section.seo-more`:
  - game ↔ props, teams, weather, movement and related games;
  - player ↔ game and their other props;
  - the hubs link to everything;
  - the footer links the hubs.
- The normal app shell and JS. Hubs that have data, and current games that aren't final, hydrate into the live app view.
  Past games stay static.
- **No offers in the HTML.** State-aware offers (Florida: Hard Rock Bet only; Nevada: no BetMGM) are still filled in by JS
  (`LSGeo`), exactly as before. The 21+ notice, 1-800-GAMBLER, the affiliate disclosure and the privacy footer are part
  of every page.

## Finished games (archive)

Set `ARCHIVE_DIR` (or `--archive`) to keep finished games. In the workflow this is `_history/pages` on the
`data-history` branch, with a snapshot in `.linehist-snap/_pages` for the push-retry path. It holds:

- `games-<lg>.json`: for each game, its URL, the last lines seen within `ARCHIVE_AHEAD_H` (6h) of the start (= the
  closing lines), movement, and the final score. Missing finals are backfilled from the teams' `recent` results.
- `players-<lg>.json`: player URLs and their recent props.
- `state.json`: a content hash and lastmod for each page, so `lastmod` only changes when the content changes.

Finished games keep their page, with the final score, closing lines and how each line graded, for `KEEP_DAYS` (60)
days. After that they are pruned from the pages, the sitemap and the archive, and the URL falls through to `404.html`,
which says the page expired and links the league hub.

If the archive can't be checked out, the step still runs without one. Finished games then only exist while they are
still in the live data.

## Redirects

The old `/preview/...` pages are now small stubs with no `<base>` tag. Each one has a canonical pointing to its new
URL, a meta refresh, and a `location.replace` that keeps the hash:

- `/preview/` → `/`
- `/preview/<lg>/` → `/<lg>/`
- `/preview/<lg>/<game>/` → the game page

Stubs carry no `noindex`: mixing a canonical and noindex sends search engines mixed signals. `404.html` also sends
unknown `/preview/<lg>/...` URLs to the hub.

## Site files

- `sitemap.xml`: the generated block sits between `<!-- pages:start -->` and `<!-- pages:end -->`. It has a W3C `lastmod`
  for each page and leaves out stubs. The committed file keeps that block empty.
- `robots.txt`: points to the sitemap.
- `index.html`: the homepage cards (top games, line moves, hot props with last-5 strips) are filled in between the
  `HOME` markers. The committed file keeps them empty.

## Running and testing locally

```sh
env -u ODDS_API_KEY python3 scripts/seo_pages.py --site /tmp/site-copy --now 2026-10-27T12:00:00Z   # build into a copy
env -u ODDS_API_KEY python3 scripts/seo_pages_test.py     # static checks (titles, canonicals, links, sitemap, archive, redirects)
env -u ODDS_API_KEY node scripts/seo_pages_test.mjs       # browser checks (state offers, #/ -> real URL, tiles, 404, stubs)
```

Both tests build into a temp copy, so `site/` is never touched. Set `DATA_DIR=/path/to/data` to test with other data.
