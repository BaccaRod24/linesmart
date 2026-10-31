#!/usr/bin/env python3
"""Scoreboard window after midnight ET. No network and no Odds API.

At 12:21 AM ET on 2026-10-31, ESPN still had LAL @ GS and DEN @ PHX in the 4th
quarter and Kent State @ Sacramento State at halftime, all on the Oct 30 ET
scoreboard (dates=20261030). dates=20261031 had only games that had not started.
Kent State @ Sacramento State is on the FBS board (groups=80), not FCS (groups=81).

Run: env -u ODDS_API_KEY python3 scripts/build_data_window_test.py
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.pop("ODDS_API_KEY", None)
import build_data as BD  # noqa: E402

passed = failed = 0


def check(ok, msg):
    global passed, failed
    print(("PASS" if ok else "FAIL"), msg)
    if ok:
        passed += 1
    else:
        failed += 1


def ev(eid, date, state, away, home, detail, hs="0", aws="0"):
    def side(abbr, score, ha):
        return {"homeAway": ha, "score": str(score), "winner": False,
                "team": {"id": abbr, "abbreviation": abbr, "displayName": abbr, "shortDisplayName": abbr}}
    return {"id": eid, "date": date, "name": f"{away} at {home}", "shortName": f"{away} @ {home}",
            "status": {"type": {"state": state, "completed": state == "post", "shortDetail": detail, "detail": detail}},
            "competitions": [{"competitors": [side(home, hs, "home"), side(away, aws, "away")]}]}


# 12:21 AM ET Saturday 2026-10-31 (EDT, UTC-4).
MIDNIGHT = dt.datetime(2026, 10, 31, 4, 21, tzinfo=dt.timezone.utc)
# 11:30 PM ET Friday 2026-10-30. UTC has already rolled to Oct 31; ET has not.
BEFORE = dt.datetime(2026, 10, 31, 3, 30, tzinfo=dt.timezone.utc)

NBA = next(l for l in BD.LEAGUES if l["key"] == "nba")
NCAAF = next(l for l in BD.LEAGUES if l["key"] == "ncaaf")

# What ESPN returned at 12:21 AM ET (abbreviated to the games that decide the window).
NBA_1030 = [
    ev("401909277", "2026-10-30T23:00Z", "post", "CHA", "WSH", "Final", "95", "79"),          # 7:00 PM ET, long final
    ev("401909285", "2026-10-31T02:00Z", "in", "LAL", "GS", "8:50 - 4th", "90", "80"),       # 10:00 PM ET, 4th quarter
    ev("401909286", "2026-10-31T02:00Z", "in", "DEN", "PHX", "35.4 - 4th", "117", "123"),    # 10:00 PM ET, 4th quarter
    ev("just", "2026-10-31T01:30Z", "post", "BOS", "NY", "Final", "100", "98"),              # 9:30 PM ET, final ~27 min ago
    ev("pp", "2026-10-31T02:00Z", "post", "AAA", "BBB", "Postponed"),
    ev("delay", "2026-10-31T02:10Z", "in", "CCC", "DDD", "Rain Delay", "1", "0"),
]
NBA_1031 = [
    ev("401909896", "2026-10-31T19:00Z", "pre", "POR", "UTAH", "10/31 - 3:00 PM EDT"),
]
NCAAF_1030 = [
    ev("early", "2026-10-30T20:00Z", "post", "AAA", "BBB", "Final"),                         # 4:00 PM ET
    ev("401866451", "2026-10-31T02:30Z", "in", "KENT", "SAC", "Halftime", "14", "17"),       # 10:30 PM ET, FBS board
]
NCAAF_1031 = [
    ev("401856846", "2026-10-31T18:00Z", "pre", "KSU", "COLO", "10/31 - 2:00 PM EDT"),       # Kansas State, not Kent State
]


def boards(nba_prior=None, ncaaf_prior=None):
    nba_prior = NBA_1030 if nba_prior is None else nba_prior
    ncaaf_prior = NCAAF_1030 if ncaaf_prior is None else ncaaf_prior

    def fetch(url):
        fetch.urls.append(url)
        if "groups=81" in url:
            raise AssertionError(f"FCS board requested: {url}")
        if "/basketball/nba/" in url and "dates=20261030" in url:
            return {"events": nba_prior}
        if "/basketball/nba/" in url and "dates=20261031" in url:
            return {"events": NBA_1031}
        if "/football/college-football/" in url and "dates=20261030" in url:
            return {"events": ncaaf_prior}
        if "/football/college-football/" in url and "dates=20261031" in url:
            return {"events": NCAAF_1031}
        if "dates=20261029" in url:
            return {"events": [ev("old", "2026-10-30T02:00Z", "post", "OLD", "OLD", "Final")]}
        return {"events": []}
    fetch.urls = []
    return fetch


def ids(events):
    return {e["id"] for e in events}


# ---------- the date list itself
et_midnight = MIDNIGHT.astimezone(BD.ET).date()
check(et_midnight == dt.date(2026, 10, 31), f"12:21 AM ET is still Oct 31 ET (got {et_midnight})")
dates = BD.scoreboard_dates(et_midnight, 10)
check(dates[0] == "20261030" and dates[1] == "20261031" and dates[-1] == "20261109" and len(dates) == 11,
      f"window is yesterday plus 10 forward dates ({dates[0]}..{dates[-1]}, {len(dates)})")
et_before = BEFORE.astimezone(BD.ET).date()
check(et_before == dt.date(2026, 10, 30), f"11:30 PM ET is still Oct 30 even though UTC is Oct 31 (got {et_before})")
check(BD.scoreboard_dates(et_before, 10)[1] == "20261030", "before midnight the forward window still starts on the ET day, not the UTC day")

# ---------- 12:21 AM ET: yesterday's live games survive, afternoon finals do not
nba_fetch = boards()
events, ok, errs = BD.fetch_scoreboards(NBA, 10, now=MIDNIGHT, fetch=nba_fetch)
check(not errs and ok == 11, f"NBA: 11 dates fetched, no errors (ok={ok}, errs={errs})")
got = ids(events)
check({"401909285", "401909286", "just", "delay", "401909896"} <= got, f"NBA keeps both 4th-quarter games, a just-final, a delay, and today's slate ({sorted(got)})")
check("401909277" not in got and "pp" not in got, "NBA drops the 7 PM final and a postponement")
games = {g["id"]: g for g in (BD.game_from_event(e, NBA) for e in events)}
check(games["401909285"]["state"] == "in" and games["401909285"]["away"]["abbr"] == "LAL" and games["401909285"]["home"]["abbr"] == "GS",
      "LAL @ GS stays in progress")
check(games["401909286"]["state"] == "in" and games["401909286"]["away"]["abbr"] == "DEN", "DEN @ PHX stays in progress")
check(any("dates=20261030" in u and "/basketball/nba/" in u for u in nba_fetch.urls), "NBA requests dates=20261030")
check(all("groups=81" not in u for u in nba_fetch.urls), "NBA requests do not add an FCS group")

cfb_fetch = boards()
cfb, ok, errs = BD.fetch_scoreboards(NCAAF, 10, now=MIDNIGHT, fetch=cfb_fetch)
cfb_ids = ids(cfb)
check("401866451" in cfb_ids and "early" not in cfb_ids and "401856846" in cfb_ids,
      f"NCAAF keeps Kent State @ Sacramento State and today's games, not the 4 PM final ({sorted(cfb_ids)})")
kent = next(g for g in (BD.game_from_event(e, NCAAF) for e in cfb) if g["id"] == "401866451")
check(kent["state"] == "in" and kent["statusDetail"] == "Halftime", "Kent State @ Sacramento State is live at halftime")
prior_urls = [u for u in cfb_fetch.urls if "dates=20261030" in u and "college-football" in u]
check(len(prior_urls) == 1 and "groups=80" in prior_urls[0] and "groups=81" not in prior_urls[0],
      f"Kent State @ Sacramento State is read from the FBS board (groups=80), not FCS ({prior_urls})")

# ---------- 11:30 PM ET: Oct 30 is "today", so its finals stay; Oct 29 finals do not
late = boards()
events, ok, errs = BD.fetch_scoreboards(NBA, 10, now=BEFORE, fetch=late)
got = ids(events)
check("401909277" in got and "401909285" in got, "before midnight, today's finals and live games both stay")
check("old" not in got, "the previous ET date's long-finished game is not carried into tonight")
check(any("dates=20261029" in u for u in late.urls) and any("dates=20261030" in u for u in late.urls),
      "11:30 PM ET still requests yesterday (Oct 29) and today (Oct 30), not the UTC date")

# ---------- later the same morning, a game that just went final is kept; one that ended earlier is not
later = MIDNIGHT + dt.timedelta(hours=2)  # 2:21 AM ET
events, _, _ = BD.fetch_scoreboards(NBA, 2, now=later, fetch=boards())
got = ids(events)
check("401909285" in got and "just" not in got, f"2:21 AM ET: still-live game stays, the 9:30 PM final has left 'just finished' ({sorted(got)})")

# ---------- an in-progress game is kept even if it has run long
long = boards(nba_prior=[ev("marathon", "2026-10-30T23:00Z", "in", "LAL", "GS", "2:00 - OT", "100", "100")])
events, _, _ = BD.fetch_scoreboards(NBA, 1, now=MIDNIGHT, fetch=long)
check("marathon" in ids(events), "a game ESPN still marks in progress is kept no matter how long it has run")

print(f"\nbuild_data_window_test: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
