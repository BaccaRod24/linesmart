"""Credit budget guard for The Odds API (paid 100K plan) - pure functions, no network. Used by build_data.py.

Plan: 100,000 credits per billing month; we budget ODDS_BUDGET (default 80,000) of them and keep a floor in reserve.
Credits reset on the subscription day of the month (Odds API FAQ), ODDS_BILLING_DAY (default 26: subscribed 2026-10-26).
A drop in `x-requests-used` between two runs also counts as a reset (see detect_reset), so a wrong billing day only
makes the pacing a little conservative/optimistic for a few days; it can't overspend the per-run cap.

Throttle (decided every run from the free /sports quota headers + free /events counts):
  budget_left = min(remaining, budget - used) - floor           credits we may still spend this cycle
  days_left   = time until the next reset (min 1 hour)
  allowance   = budget_left / days_left                         credits/day we can afford from now on
  need_games  = games_per_run * runs/day at the 30-min cadence  (games_per_run = 3 credits x leagues with events in 7 days)
  need_props  = props_per_run * props runs/day (every 2 h)      (props_per_run = markets x NFL/NBA events in the next 36 h)
  level "full"       allowance >= need_games + need_props       game lines every 30 min, props every 2 h
        "no-props"   allowance >= need_games                    step 1: props paused, game lines every 30 min
        "slow-games" otherwise                                  step 2: props paused, game lines every 60/90/120/180/240/360 min
                                                                (smallest step that fits the allowance)
        "stop"       budget_left <= 0, or quota unknown         no paid calls; the site shows the last persisted pull
"""
import datetime as dt, math

GAME_STEPS = (30, 60, 90, 120, 180, 240, 360)   # minutes between game-line pulls, fastest first
PROPS_INTERVAL = 120                             # minutes between props pulls at "full"

def _utc(t): return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)

def _day_in(y, m, day):
    """The billing day in month m, clamped to the month's length (day 31 -> Feb 28/29)."""
    nxt = dt.date(y + (m == 12), m % 12 + 1, 1)
    return min(day, (nxt - dt.timedelta(days=1)).day)

def cycle_bounds(now, billing_day=26):
    """(start, end) of the billing cycle containing now; resets at 00:00 UTC on the billing day."""
    now = _utc(now); y, m = now.year, now.month
    start = dt.datetime(y, m, _day_in(y, m, billing_day), tzinfo=dt.timezone.utc)
    if now < start:
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
        start = dt.datetime(y, m, _day_in(y, m, billing_day), tzinfo=dt.timezone.utc)
    y2, m2 = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
    end = dt.datetime(y2, m2, _day_in(y2, m2, billing_day), tzinfo=dt.timezone.utc)
    return start, end

def detect_reset(prev_used, used):
    """True when the used counter went down since the last run (the plan reset)."""
    return isinstance(prev_used, (int, float)) and isinstance(used, (int, float)) and used < prev_used

def plan(remaining, used, now, *, billing_day=26, budget=80000, plan_credits=100000, floor=300,
         games_per_run=0, props_per_run=0):
    """Decide this run's level. Returns a dict (all numbers rounded for logs/meta)."""
    now = _utc(now)
    start, end = cycle_bounds(now, billing_day)
    days_left = max((end - now).total_seconds() / 86400, 1 / 24)
    out = dict(level="stop", gameInterval=None, props=False, remaining=remaining, used=used, budget=budget,
               cycleEnd=end.isoformat(), daysLeft=round(days_left, 2), gamesPerRun=games_per_run, propsPerRun=props_per_run)
    if not isinstance(remaining, (int, float)):
        out.update(reason="credit balance unknown"); return out
    if not isinstance(used, (int, float)): used = max(0, plan_credits - remaining)
    budget_left = min(remaining, budget - used) - floor
    allowance = budget_left / days_left
    need_games = games_per_run * 1440 / GAME_STEPS[0]
    need_props = props_per_run * 1440 / PROPS_INTERVAL
    out.update(budgetLeft=round(budget_left), allowancePerDay=round(allowance), needGamesPerDay=round(need_games),
               needPropsPerDay=round(need_props))
    if budget_left <= 0:
        out.update(reason=f"monthly budget reached ({used} used of {budget}, floor {floor})"); return out
    if allowance >= need_games + need_props:
        out.update(level="full", gameInterval=GAME_STEPS[0], props=True, reason="on pace"); return out
    if allowance >= need_games:
        out.update(level="no-props", gameInterval=GAME_STEPS[0], props=False,
                   reason=f"allowance {allowance:.0f}/day < {need_games + need_props:.0f} needed: props paused"); return out
    step = next((s for s in GAME_STEPS[1:] if games_per_run * 1440 / s <= allowance), GAME_STEPS[-1])
    out.update(level="slow-games", gameInterval=step, props=False,
               reason=f"allowance {allowance:.0f}/day < {need_games:.0f} for 30-min game lines: props paused, game lines every {step} min")
    return out

def due(last_iso, interval_min, now, slack_min=2):
    """Has at least interval_min (minus slack for cron jitter) passed since last_iso? No last pull -> due."""
    if not last_iso: return True
    try: last = _utc(dt.datetime.fromisoformat(str(last_iso).replace("Z", "+00:00")))
    except ValueError: return True
    return (_utc(now) - last).total_seconds() >= (interval_min - slack_min) * 60

def monthly_estimate(game_leagues=9, game_markets=3, game_runs_per_day=48, props=None, days=30.4):
    """Worst-case monthly credits. props: [(name, markets, events_per_day, pulls_per_event)]."""
    rows = [("Game lines", game_leagues * game_markets * game_runs_per_day * days)]
    for name, mk, epd, ppe in props or []: rows.append((name, mk * epd * ppe * days))
    return rows, sum(r[1] for r in rows)
