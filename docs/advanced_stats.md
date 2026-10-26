# Advanced stats

Branch `advanced-stats`. Five additions, all informational: no pick, "lock" or guarantee language, and the 21+ / responsible-gambling notes are unchanged.
**No new Odds API calls and no extra credit spend.** Line value and value spots reuse the odds that `build_data.py` already pulls every ~30 min. ATS/O-U uses those odds and the persisted line history on `data-history`. `ODDS_MMA` stays off.

| Feature | Where it shows | Data file (lazy-loaded per page) |
|---|---|---|
| NFL efficiency (EPA/play, success rate, red-zone TD %, 3rd-down %, ranks; QB EPA + CPOE) | NFL team page "Efficiency" card; NFL game page "Efficiency matchup" | `data/adv/nfl.json` (~21 KB) |
| NBA pace & ratings (ORtg/DRtg/Net per 100, pace, last 10, rest / back-to-back, projected pace) | NBA team page; NBA game page "Pace & ratings" | `data/adv/nba.json` (~20 KB) |
| Player usage trends (NFL target/carry/snap share + red-zone touches, last 3 vs season; NBA minutes + usage, last 5 vs season) | Player pages "Usage trends"; chips on each player card in the game-page props view | `data/adv/nfl-players.json` (~105 KB), `data/adv/nba-players.json` (~25 KB), only on player pages / props |
| ATS & O/U (overall, home/away, last 10, recent strip) for NFL, NBA, NCAAF, NCAAB, NHL, MLB | Team page "ATS & over/under"; game page side-by-side card | `data/adv/<lg>.json` |
| Line value (implied %, no-vig fair line, edge %, Outlier badge) | Game page odds comparison; "Value spots" card on Today's Slate | computed in the browser from the game JSON; slate list in `meta.json` → `slate.value` |

The game, team and player pages fetch `data/adv/*.json` only when one of them is opened (`LSAdv.load`, cached per session). Nothing extra loads on the slate except the small `slate.value` block that already rides in `meta.json`.

## Sources, licenses, refresh cadence

| Source | Used for | License / terms | Cadence |
|---|---|---|---|
| **nflverse** play-by-play (`pbp/play_by_play_<season>.csv.gz`), schedules (`schedules/games.csv`), snap counts, from GitHub releases of `nflverse/nflverse-data` | NFL EPA, success, red zone, 3rd down, QB EPA/CPOE, usage shares, NFL closing spread/total for ATS | nflverse data: **CC-BY 4.0** (attribution: "nflverse"). EPA/CPOE models come from **nflfastR (MIT)**. Snap counts in nflverse **originate from Pro Football Reference**; nflverse redistributes them, and we never scrape PFR or any Sports Reference site. | Re-downloaded when the cached aggregate is over 20 h old (`ADV_NFL_REFRESH_HOURS`), so about daily. Cached in `data-history:advstats/`. |
| **ESPN** public site API: box scores (already fetched by `matchups.py` for NBA/NFL matchup ranks), team schedules, and the core odds endpoint (DraftKings close) | NBA possessions/pace/ratings/usage; final scores; closing lines for ATS backfill (NBA, NCAAF, NCAAB, NHL, MLB) | Undocumented public API. **ESPN's terms restrict commercial use.** The site already depends on ESPN for scores, schedules and box scores. The ESPN close backfill can be switched off with `ATS_ESPN_BACKFILL=0`; ATS then uses only our own Odds API history going forward. | Schedules re-scanned every 6 h; box scores incremental each build; close backfill capped at 300 games per run (`ATS_BACKFILL_MAX`) and cached forever. |
| **The Odds API** (paid plan; Hard Rock Bet, DraftKings, FanDuel) | Line value, value spots, our own closing lines for ATS (preferred over ESPN once we have them) | Our subscription; **no new calls**, only odds already in `index.json` and `data-history:history/` | Every build (~30 min) |
| Our own computations | Ratings, pace, ranks, ATS/O-U grading, no-vig fair lines | n/a | Every build |

Not used: Sports Reference sites (their terms forbid scraping) and stats.nba.com (terms don't clearly allow this use).

## Formulas

**NFL** (nflverse play-by-play, regular season; pass and rush plays only, two-point tries and special teams excluded)
- EPA/play = mean `epa`; success rate = share of plays with `success` = 1 (EPA > 0); pass and rush EPA split on `pass`/`rush`.
- Red-zone TD % = drives that ran a play at or inside the opponent's 20 (`yardline_100` ≤ 20) and ended in a touchdown (`fixed_drive_result`).
- 3rd-down % = `third_down_converted` / (converted + failed).
- Defense: the same stats allowed. Ranks 1–32, 1 = best (lowest allowed on defense).
- QB: EPA per dropback (`qb_epa`), mean `cpoe`; ranked among QBs with 100+ dropbacks.
- Usage: target share = targets / team targets; carry share = designed runs (no scrambles) / team designed runs, both in games the player played. Snap share = offensive snap % (nflverse snap counts). Red-zone touches = red-zone targets caught + red-zone carries, per game.

**NBA** (ESPN box scores)
- Possessions = FGA − OREB + TOV + 0.44 × FTA, averaged across both teams per game.
- ORtg/DRtg = 100 × points scored/allowed ÷ possessions; Net = ORtg − DRtg. Pace = 48 × possessions ÷ game minutes (48 + 5 per OT).
- Projected game pace = home pace × away pace ÷ league pace.
- Rest days = full ET calendar days off since the last game; back-to-back = played the previous day.
- Usage % = 100 × (FGA + 0.44·FTA + TOV) × (team minutes / 5) ÷ (minutes × (team FGA + 0.44·team FTA + team TOV)).

**ATS / O/U**
- Cover margin = (team score − opponent score) + team spread: > 0 W, < 0 L, 0 Push. O/U: total points vs closing total, equal = Push.
- Records are W-L-P (O-U-P). Percentages leave pushes out. "Last 10" = the team's last 10 graded games.
- Closing line priority: NFL from the nflverse schedule (`spread_line`/`total_line`); then our own last pre-game Odds API line (DraftKings → Hard Rock Bet → FanDuel); otherwise ESPN's DraftKings close.

**Line value** (`scripts/linevalue.py`, mirrored in `site/assets/adv-core.js`)
- Implied probability: −A → A/(A+100); +A → 100/(A+100). It includes the book's margin.
- No-vig: each book's implied probabilities divided by their sum (multiplicative/proportional).
- Fair line: the consensus line is the one most books hang (a tie means no consensus). Fair probability = mean no-vig probability across the books on that line; needs 2+ books.
- Edge = fair probability × decimal odds − 1 (0% = fair price; most prices sit a little below 0 because of the margin).

## Thresholds

- **Outlier badge** (needs all three books):
  - **Line outlier.** One book's spread or total is ≥ 1.5 points from the consensus line two books share (football, basketball), or ≥ 0.5 (hockey, baseball, soccer). One point is normal key-number shading in football and basketball and fired too often in testing. The badge goes on the side that gets the better number.
  - **Price outlier.** On the consensus line, a book's no-vig probability for a side is ≥ 3 percentage points below the average of the other two. That makes the side cheaper there, about a 6–7 cent difference at −110.
  - Off-market numbers can be stale or posted in error. The UI tells users to confirm at the book.
- **Value spots** (Today's Slate):
  - Pre-game games in the next 36 h.
  - Each price within 3% of the consensus fair price, or better (edge ≥ −3%), and between −1000 and +400. Long shots are left out because proportional de-vig overstates their fair odds.
  - Rows are sorted by best edge (max 60 in `meta.json`); the card shows the top 6, plus up to 3 off-consensus lines.
  - Truly positive edges vs a three-book consensus are rare. When none exist, the card says these are the closest prices.
  - **Florida:** only Hard Rock Bet prices are listed or colored, because it is the only one of the three books legal there. Other books' edges show grey and their Outlier badges are muted ("reference only").
- **Trend arrows:**
  - NFL, last 3 games vs season: ±3 points of target/carry share, ±5 points of snap share, ±0.5 red-zone touches per game. Needs 4+ games.
  - NBA, last 5 games vs season: ±3 minutes per game or ±2 usage points. Needs 6+ games.

## ATS history depth

Local full build on Mon Oct 26, 2026 (ET):

| League | Graded games | Since | Closing-line source |
|---|---|---|---|
| NFL | 106 / 106 finals | Sep 9, 2026 (week 1) | nflverse |
| NBA | 43 / 43 | Oct 20, 2026 (opening night) | ESPN DraftKings close |
| NHL | 184 / 184 | Sep 29, 2026 | ESPN DraftKings close |
| NCAAF | 566 / 566 | Aug 29, 2026 | ESPN DraftKings close |
| MLB | 2,466 / 2,466 | Mar 25, 2026 (full season) | ESPN DraftKings close |
| NCAAB | 0 | season not started | n/a |

In CI the ESPN backfill adds at most 300 games per league per run. NFL, NBA and NHL fill on the first run; NCAAF needs ~2 runs and MLB ~9 runs (about 4–5 h at the 30-min cadence). Each payload states its `since`, `through`, graded count and sources, and the UI prints them. Our own Odds API line history only starts Oct 25, 2026 (10:46 PM ET), so ESPN's DraftKings close covers everything before that.

## Files

- `scripts/adv.py`: per-league builder (called from `build_data.py`), writes `data/adv/<lg>.json` and `<lg>-players.json`.
- `scripts/adv_nfl.py`: nflverse download, aggregation, cache. `scripts/adv_nba.py`: possessions, ratings, rest, usage.
- `scripts/ats.py`: schedule scan, closing lines, grading, store (`data-history:advstats/ats_<lg>.json`). `scripts/linevalue.py`: no-vig, edges, outliers, value spots.
- `site/assets/adv-core.js` (pure math, also used by the Node tests) and `site/assets/adv.js` (UI).
- Tests: `scripts/adv_test.py`, `scripts/adv_test.mjs` (includes JS ↔ Python parity on 300 random markets). Screenshots: `scripts/adv_screens.mjs` → `screenshots/adv-*.png`.
