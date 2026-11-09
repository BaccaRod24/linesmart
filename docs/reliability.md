# Odds reliability

Each refresh records whether the odds it published are still within the usual cadence, and whether the pull looked structurally sound. This is the evidence for a two-week trial before a paid Pro launch. It does not check a price against Hard Rock Bet, DraftKings, or FanDuel's own board.

## What each refresh checks

| Check | Clock used | Counts as a failure |
|---|---|---|
| League pull age | `hardrock.leagues[league]` (the Odds API pull time) | In-window league with upcoming games whose pull is older than **max(90 minutes, 3× the current interval)**. At the normal 30 min cadence that is 90 minutes. |
| Off-season / no events | `cache.active[league]` from the free `/events` call (0 events in 7 days) | Not a failure, and not labeled as an outage. |
| Budget stop | `oddsApi.level == "stop"` | The site still labels old lines. The workflow does **not** fail, because pulls are paused on purpose. |
| Duplicate game id | ESPN event id | Warning on the run record. The first copy is kept. |
| Game with no teams, or home and away the same team | ESPN competitors | Left out of that publish. A valid game from another feed is not removed. |
| Team identity vs the previous pull | home/away abbreviations stored with the odds cache | One game keeps that game's previous lines and their old `asOf`. If half the pull (at least 3 games) changed teams, the whole new pull is discarded and `pulledAt` stays on the previous pull. |
| Impossible prices | American odds outside ±100 to ±20000, spread or total outside a wide per-sport range | That book's bad numbers are not published. If the previous pull had a line, that line is kept and its `asOf` is not moved. A normal price change on the same teams is kept and stamped with the new pull. |
| Book missing from a pull | Hard Rock Bet, DraftKings, FanDuel | If the previous pull had that book on at least 3 of the same games and this pull has it on none, those previous lines are kept with the old `asOf`. A league that never had that book is left alone. |
| Live site matches this build | `generated`, `hardrock.asOf`, `oddsApi.checkedAt`, per-league pull times | Existing check from the publish workflow. A green deploy step is not enough. |

ESPN scoreboard failures still use `scripts/lastgood.py`. This does not add a second copy of that fallback. Odds last-good is the persisted pull in `odds/hardrockbet.json` on `data-history`.

## How gaps are counted

`site/data/health.json` is the latest run (deployed with the site, not committed). The same object is stored on `data-history` as `health/<run id>.json`.

`counts` on that file:

- `findings` — every structural note this run
- `errors` — a pull rejected outright, or a duplicate game id
- `warnings` — a line or book kept from the previous pull, or one invalid price
- `keptLastGood` — findings that reused an older pull instead of moving its clock
- `staleLeagues` — in-window leagues past the age limit

A league is not in `staleLeagues` when `upcoming` is 0 or `inWindow` is false.

## What this does not verify

The automation never opens a sportsbook and never reads a protected page. Passing checks mean the feed was shaped like a real pull and the pull clock is recent. They do not mean a number is the number currently on the book.

## When the workflow goes red

After the site is deployed, `scripts/reliability.py --fail-if-stale` fails the deploy job if an in-window league is past the age limit and the budget level is not `stop`. GitHub marks **Refresh data and deploy to GitHub Pages** failed. That failed run is the alert. This repo does not send Slack, email, or any other new notification. People who watch the repository can turn on GitHub's own Actions failure mail; nothing else is required.

A failed data build still publishes nothing, so the live site keeps what it already has.

## Daily spot-check (no extra Odds API calls, no scraping)

Once a day, pick one game that is still pre-game and has a line on the site. Do this in a normal browser, by hand:

1. Open the game on https://linesmart.app and note Hard Rock Bet, FanDuel, and DraftKings: spread, moneyline, total, and the "as of" time under each book. If a column says **Stale**, write that down. It means the pull is older than the usual refresh, not that the game has started.
2. Open that same game on each book's own site (the book you can legally use; skip a book that is not offered in your state).
3. Compare the three markets. A difference of a point or a few cents of juice after the "as of" time is normal movement. A missing team, the two teams swapped, or a line that is not a real price (a moneyline of 50, a 80-point NFL spread) is a miss.
4. Note the game, the book, the site number, the book number, and the site's "as of" time. Keep the notes with the day's `health/<run id>.json` from the `data-history` branch.

Do not refresh the site by calling The Odds API yourself, and do not script the sportsbook sites.
