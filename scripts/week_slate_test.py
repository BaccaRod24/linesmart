#!/usr/bin/env python3
"""ESPN week bounds and the 7-day window. No network and no Odds API.

NFL week 9 in 2026 (from ESPN's calendar, not a Thursday guess):
  start 2026-11-04T08:00Z  end 2026-11-11T07:59Z  detail Nov 4-10
Week 10 starts 2026-11-11T08:00Z, which is the roll after Monday night.

Run: env -u ODDS_API_KEY python3 scripts/week_slate_test.py
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.pop("ODDS_API_KEY", None)
import week_slate as WS  # noqa: E402

passed = failed = 0


def check(ok, msg):
    global passed, failed
    print(("PASS" if ok else "FAIL"), msg)
    if ok:
        passed += 1
    else:
        failed += 1


def entry(num, label, detail, start, end):
    return {"label": label, "detail": detail, "value": str(num), "startDate": start, "endDate": end}


REG = {
    "label": "Regular Season", "value": "2",
    "entries": [
        entry(9, "Week 9", "Nov 4-10", "2026-11-04T08:00Z", "2026-11-11T07:59Z"),
        entry(10, "Week 10", "Nov 11-17", "2026-11-11T08:00Z", "2026-11-18T07:59Z"),
    ],
}
PRE = {"label": "Preseason", "value": "1", "entries": [entry(1, "Week 1", "Aug", "2026-08-06T07:00Z", "2026-08-13T06:59Z")]}


def ev(eid, date, state="post", away="AAA", home="BBB", hs="10", aws="3", detail="Final"):
    def side(abbr, score, ha):
        return {"homeAway": ha, "score": score, "winner": ha == "home",
                "team": {"id": abbr, "abbreviation": abbr, "shortDisplayName": abbr, "displayName": abbr, "logo": f"https://example/{abbr}.png"}}
    return {"id": eid, "date": date, "name": f"{away} at {home}", "shortName": f"{away} @ {home}",
            "status": {"type": {"state": state, "completed": state == "post", "shortDetail": detail}},
            "competitions": [{"neutralSite": False, "competitors": [side(home, hs, "home"), side(away, aws, "away")]}]}


def board(week, events):
    return {"week": {"number": week}, "season": {"type": 2, "year": 2026},
            "leagues": [{"calendar": [PRE, REG]}], "events": events}


# Sunday night Nov 8, 2026 is 01:20Z on Nov 9. Monday night Nov 9 is 01:15Z on Nov 10.
SUN_NIGHT = "2026-11-09T01:20Z"
MON_NIGHT = "2026-11-10T01:15Z"
# Wednesday of week 9 (ESPN's start is Wednesday 3:00 AM ET, not Thursday).
WED = "2026-11-04T17:00Z"
BEFORE_WEEK = "2026-11-04T07:00Z"
# Thursday of week 10.
NEXT_THU = "2026-11-13T01:15Z"

week9 = board(9, [ev("sun", SUN_NIGHT, detail="Final"), ev("mnf", MON_NIGHT, state="pre", detail="8:15 PM"),
                  ev("wed", WED), ev("old", BEFORE_WEEK), ev("next", NEXT_THU)])
slate = WS.football_slate(week9)
ids = [g["id"] for g in slate["games"]]
check(slate["mode"] == "espn-week" and slate["number"] == 9 and slate["label"] == "Week 9" and slate["detail"] == "Nov 4-10", "week 9 label comes from ESPN's calendar entry")
check(slate["order"] == "asc", "football week is listed earliest day first")
check("sun" in ids and "mnf" in ids, "Monday still shows Sunday night and Monday night")
check("wed" in ids, "a Wednesday game inside ESPN's week is kept (the week is not guessed as Thursday)")
check("old" not in ids and "next" not in ids, "the previous week's last hour and next Thursday are outside week 9")
check(ids.index("wed") < ids.index("sun") < ids.index("mnf"), "week games stay in kickoff order")

# Tuesday after MNF: ESPN has published week 10. The old Sunday final is not in that week.
tuesday = dt.datetime(2026, 11, 10, 20, 0, tzinfo=dt.timezone.utc)  # Tue Nov 10, 3:00 PM ET
week10 = board(10, [ev("sun", SUN_NIGHT), ev("mnf", MON_NIGHT, state="post", detail="Final"), ev("thu", NEXT_THU, state="pre", detail="8:15 PM")])
rolled = WS.football_slate(week10)
rolled_ids = [g["id"] for g in rolled["games"]]
check(rolled["number"] == 10 and rolled["label"] == "Week 10", "Tuesday's scoreboard week number selects week 10")
check(rolled_ids == ["thu"], f"once ESPN rolls the week, Sunday and Monday finals drop off ({rolled_ids})")
check(WS.in_bounds(SUN_NIGHT, rolled["start"], rolled["end"]) is False, "Sunday night is outside the new week's calendar bounds")
check(WS.in_bounds(NEXT_THU, rolled["start"], rolled["end"]) is True, "the new Thursday is inside the new week")
check(tuesday.astimezone(WS.ET).weekday() == 1, "the fixture instant is a Tuesday in US Eastern")

# Preseason entry must not steal the regular-season week number.
check(WS.calendar_entry(week9)["label"] == "Week 9", "season type 2 matches the regular-season calendar, not preseason")
check(WS.calendar_entry({"week": {"number": 9}, "season": {"type": 2}, "leagues": []}) is None, "no calendar -> no invented bounds")
bare = WS.football_slate({"week": {}, "events": [ev("x", SUN_NIGHT)]})
check([g["id"] for g in bare["games"]] == ["x"] and bare["label"] == "This week", "without a week number, ESPN's events are kept as-is")

# Last 7 ET dates. Today is Monday Nov 9, 2026. The window is Nov 3 through Nov 9.
today = dt.date(2026, 11, 9)
dates = WS.daily_dates(today)
check(dates[0].isoformat() == "2026-11-03" and dates[-1].isoformat() == "2026-11-09" and len(dates) == 7, "seven ET dates ending today")
# Nov 2, 10:30 PM ET is Nov 3 03:30Z — outside. Nov 3, 12:30 AM ET is Nov 3 05:30Z — inside.
# Nov 10 is tomorrow.
events = [
    ev("too-old", "2026-11-03T03:30Z"),
    ev("first", "2026-11-03T05:30Z"),
    ev("mid", "2026-11-08T18:00Z"),
    ev("today", "2026-11-09T23:00Z", state="pre", detail="6:00 PM"),
    ev("tomorrow", "2026-11-10T18:00Z", state="pre"),
]
daily = WS.daily_slate(events + [ev("mid", "2026-11-08T18:00Z")], today)
dids = [g["id"] for g in daily["games"]]
check(dids == ["first", "mid", "today"], f"last 7 days keeps the edges, drops tomorrow, and dedupes ({dids})")
check(daily["mode"] == "days" and daily["order"] == "desc" and daily["label"] == "Last 7 days", "daily slate is newest-day-first")
check(daily["detail"] == "Nov 3–9", f"same-month range ({daily['detail']})")
today_g = next(g for g in daily["games"] if g["id"] == "today")
check(today_g["state"] == "pre" and daily["games"][0]["state"] == "post", "an upcoming game inside the 7 days stays next to the finals")

# league_week: football uses the undated scoreboard; NBA asks for seven dates; UFC is skipped.
calls = []


def fetch(url):
    calls.append(url)
    if "/mma/" in url:
        raise AssertionError(url)
    if "/football/nfl/scoreboard" in url and "dates=" not in url:
        return week9
    if "/basketball/nba/scoreboard" in url and "dates=" in url:
        return {"events": [ev("g" + url.split("dates=")[1][:8], "2026-11-09T23:00Z", state="post")]}
    raise AssertionError("unexpected " + url)


NFL = {"key": "nfl", "path": "football/nfl", "params": "", "kind": "football"}
NBA = {"key": "nba", "path": "basketball/nba", "params": "", "kind": "basketball"}
UFC = {"key": "ufc", "path": "mma/ufc", "params": "", "kind": "mma"}
now = dt.datetime(2026, 11, 9, 23, 0, tzinfo=dt.timezone.utc)
got = WS.league_week(NFL, fetch, now, "https://site.api.espn.com/apis/site/v2/sports/")
check(got and got["number"] == 9 and any("nfl/scoreboard" in u and "dates=" not in u for u in calls), "NFL week is the undated current-week scoreboard")
calls.clear()
nba = WS.league_week(NBA, fetch, now, "https://site.api.espn.com/apis/site/v2/sports/")
nba_dates = sorted(u.split("dates=")[1][:8] for u in calls)
check(nba and nba["mode"] == "days" and nba_dates == [d.strftime("%Y%m%d") for d in dates], f"NBA asks for each of the seven dates ({nba_dates})")
check(WS.league_week(UFC, fetch, now, "https://x/") is None, "UFC has no week slate")


def boom(url):
    raise RuntimeError("down")


check(WS.league_week(NBA, boom, now, "https://x/") is None, "a failed week fetch is empty rather than a crash")

print(f"\nweek_slate_test: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
