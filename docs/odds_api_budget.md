# The Odds API: paid 100K plan budget (Hard Rock Bet + FanDuel + DraftKings)

Plan: **100K, $59/month, 100,000 credits**. Credits reset on the subscription day of each month, which is the **26th** (subscribed 2026-10-26; `ODDS_BILLING_DAY=26`).
LineSmart plans to use at most **80,000** credits per cycle (`ODDS_BUDGET`). That leaves 20K of headroom for manual force pulls and surprises.

DraftKings prices also come from The Odds API, in the same requests (no extra credits, see below). ESPN (free, every run) still supplies DraftKings' opening line for line movement, and is the fallback when the Odds API has no DraftKings line for a game or prop (ESPN props are line only). UFC stays ESPN/DraftKings-only: `ODDS_MMA` stays off.

## What one request costs (sources)

From the v4 guide, <https://the-odds-api.com/liveapi/guides/v4/>:

- **`/v4/sports/{sport}/odds`** costs `[number of unique markets returned] x [number of regions]`.
  The `bookmakers` parameter replaces `regions`: *"Every group of 10 bookmakers is the equivalent of 1 region."*
  So `bookmakers=hardrockbet,fanduel,draftkings` (3 of 10) costs the same as `bookmakers=hardrockbet`.
  For `markets=h2h,spreads,totals` that is **3 credits per league for all three books**.
  In short, **FanDuel and DraftKings are free in the same request**; adding DraftKings changed no number in the tables below.
- **`/v4/sports`** and **`/v4/sports/{sport}/events`** don't count against the quota.
  They are used every run to read `x-requests-remaining`/`x-requests-used` and to find leagues with events in the next 7 days.
- **Empty responses don't cost credits.** A league with no events, or an event with no props posted yet, costs 0.
- **`/v4/sports/{sport}/events/{id}/odds`** (player props) costs `[unique markets returned] x [regions]`.
  For NFL that is at most 5 credits per event; for NBA, at most 4. Markets a book hasn't posted aren't charged.
  Markets are counted once however many books return them, so DraftKings adds nothing; at most it can turn a market none of
  Hard Rock/FanDuel posted into a returned one, which the estimate already assumes (it charges every market on every event).
- Every response carries the `x-requests-remaining`, `x-requests-used` and `x-requests-last` headers.

Credits reset monthly on the subscription date: FAQ, <https://the-odds-api.com/manage/faqs.html>.

## Cadence

| Pull | Request | When | Window |
|---|---|---|---|
| Game lines (h2h, spreads, totals), HR + FD + DK | 1 per league, 3 credits | every **30 min** (each refresh run) | leagues with events in the next 7 days |
| NFL props: `player_pass_yds, player_rush_yds, player_reception_yds, player_receptions, player_anytime_td` | 1 per event, at most 5 credits | every **2 h** per event | events starting within **36 h** |
| NBA props: `player_points, player_rebounds, player_assists, player_threes` | 1 per event, at most 4 credits | every **2 h** per event | events starting within **36 h** |

Triggers:

- cron-job.org dispatches at :15/:45 ET, plus the GitHub `*/30` cron.
- A persisted per-league `pulledAt` gate (2 min slack) makes sure two near-simultaneous runs don't both pay for the same league or event.
- The old every-other-day cron was removed.

## Monthly estimate (worst case, 30.4-day month)

| Item | Math | Credits/month |
|---|---|---|
| Game lines | 9 leagues x 3 credits x 48 runs/day x 30.4 | **39,398** |
| NBA props | 4 markets x 18 pulls/event (36 h / 2 h) x 7.2 games/day x 30.4 | **15,759** |
| NFL props | 5 markets x 18 pulls/event x (16 games / 7 days) x 30.4 | **6,254** |
| **Total** | | **61,411** (about 77% of the 80K budget, 61% of the plan) |

Notes on the estimate:

- It assumes all 9 non-UFC leagues are in season at once. Each league with no events in the next 7 days costs 0.
  In late October, MLB has finished, so it is lower in practice.
- Props are priced as if every market is posted for every event at all 18 pulls. NBA books post most props the day before, so real props spend is lower.
- Upper bound: the 2-minute slack allows up to about 51 game-line runs per day if both triggers fire back to back.
  That gives 9 x 3 x 51 x 30.4 = 41,860 for game lines, or about **63.9K** total, still under 80K.
- Manual force pulls (`pull_odds=true`) cost about 27 credits for game lines, plus props for events in the window.
- `python3 -c "import scripts.odds_budget as B; print(B.monthly_estimate(props=[('NBA',4,7.2,18),('NFL',5,16/7,18)]))"` reproduces the table.

## Budget guard / auto-throttle (`scripts/odds_budget.py`)

Every run starts with the free calls. It persists `remaining`, `used`, the level and the reason in `odds/hardrockbet.json` (`quota`, plus `usage` = per-cycle games vs props tally and per day), then computes:

```
budget_left = min(remaining, ODDS_BUDGET - used) - ODDS_MIN_CREDITS      # 80,000 budget, 300 floor
allowance   = budget_left / days_left_in_cycle                          # credits/day we may still spend
need_games  = game-line credits this run x 48                           # at a 30-min cadence
need_props  = props credits this run x 12                               # at a 2-h cadence
```

| Level | Condition | Action |
|---|---|---|
| `full` | allowance >= need_games + need_props | game lines every 30 min + props every 2 h |
| `no-props` | need_games <= allowance < need_games + need_props | **props paused first**; game lines stay at 30 min |
| `slow-games` | allowance < need_games | props paused; game-line interval steps 30 -> 60 -> 90 -> 120 -> 180 -> 240 -> 360 min, the first that fits |
| `stop` | budget_left <= 0, or the credit balance is unknown | no paid calls; the site keeps showing the last persisted pull (labelled "as of ...") |

Extra guards:

- **Per-run cap:** `ODDS_RUN_MAX_CREDITS=250`.
- **Floor:** a league or event is skipped if its cost would cross the 300 floor.
- **Cycle reset:** a reset is detected at the billing day, or when `x-requests-used` drops.
- **`ODDS_PAUSE`:** set the repo variable `ODDS_PAUSE=1` as a kill switch. The workflow then never exposes the key.
- **`pull_odds=true`:** a manual dispatch input that forces a pull. It ignores the interval gate, but the budget level still applies.

All thresholds can be overridden through env vars in `.github/workflows/refresh-and-deploy.yml`.

## Safety

- The key is only exposed on schedule and workflow_dispatch runs, and only when the `data-history` checkout succeeded (so every paid pull is persisted).
- Pushes never see it.
- Without `--odds-cache-dir` the build makes **no** paid calls.
- The key is scrubbed from every logged URL and error (`apiKey=***`).
- Builds without a key (`env -u ODDS_API_KEY`) merge the persisted game lines and props, and never call the API.
