"""Opening lines stay on the right side, and a stale basketball total is not the opener.

ESPN sometimes reports the opening spread on the opposite side of the opening moneyline
(Pacers at Heat, Rockets at Mavericks on 2026-10-30) and an opening total that never
appears in the recorded snapshots (Hornets at Wizards, 234.5 vs a series at 219.5-223.5).
The shapes below are the stored history rows. Offline: no network, no Odds API key.

Run: env -u ODDS_API_KEY python3 scripts/open_line_test.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import line_history as LH

ok = fail = 0


def check(c, msg):
    global ok, fail
    if c:
        ok += 1
    else:
        fail += 1
        print("FAIL:", msg)


# Pacers at Heat. Miami is home. ESPN open: Miami +3.5 and -155. First recorded line: Miami -4.5 and -180.
mia_open = dict(hs=3.5, **{"as": -3.5}, hml=-155, aml=130, tot=240.5)
mia_pts = [dict(hs=-4.5, **{"as": 4.5}, hml=-180, aml=150, tot=239.5),
           dict(hs=-8.5, **{"as": 8.5}, hml=-325, aml=260, tot=237.5)]
mia = LH.reconcile_open(mia_open, mia_pts, "basketball")
check(mia["hs"] == -3.5 and mia["as"] == 3.5, f"Heat opening spread swaps onto the favorite ({mia['hs']}/{mia['as']})")
check(mia["hml"] == -155 and mia["aml"] == 130, "Heat opening moneyline stays -155/+130")
check(mia["tot"] == 240.5, "Heat total 240.5 is within a point of the series and stays")

# Rockets at Mavericks. Dallas is home. ESPN open: Dallas -4.5 and +145. First recorded: Dallas +5.5 and +154.
dal_open = dict(hs=-4.5, **{"as": 4.5}, hml=145, aml=-175, tot=225.5)
dal_pts = [dict(hs=5.5, **{"as": -5.5}, hml=154, aml=-185, tot=227.5),
           dict(hs=6.5, **{"as": -6.5}, hml=195, aml=-238, tot=223.5)]
dal = LH.reconcile_open(dal_open, dal_pts, "basketball")
check(dal["hs"] == 4.5 and dal["as"] == -4.5, f"Mavericks opening spread swaps onto the dog ({dal['hs']}/{dal['as']})")
check(dal["hml"] == 145 and dal["aml"] == -175, "Mavericks opening moneyline stays +145/-175")
check(dal["tot"] == 225.5, "Mavericks total 225.5 is next to the series and stays")

# Hornets at Wizards. Spread and moneyline agree. Total 234.5 never appears; series is 223.5 then 219.5.
cha_open = dict(hs=1.5, **{"as": -1.5}, hml=-105, aml=-115, tot=234.5)
cha_pts = [dict(hs=1.5, **{"as": -1.5}, hml=-105, aml=-115, tot=223.5),
           dict(hs=-1.5, **{"as": 1.5}, hml=-118, aml=-102, tot=219.5)]
cha = LH.reconcile_open(cha_open, cha_pts, "basketball")
check(cha["hs"] == 1.5 and cha["as"] == -1.5, "Wizards opening spread already matches the moneyline")
check(cha["tot"] == 223.5, f"Wizards stale total 234.5 becomes the first recorded total ({cha['tot']})")

# A favorite that really flipped is left alone: opening spread and moneyline agree with each other.
# Knicks at Sixers opened Philadelphia -1.5 / -125; the first snapshot had already moved to +1.5.
phi_open = dict(hs=-1.5, **{"as": 1.5}, hml=-125, aml=105, tot=231.5)
phi_pts = [dict(hs=1.5, **{"as": -1.5}, hml=-108, aml=-112, tot=230.5)]
phi = LH.reconcile_open(phi_open, phi_pts, "basketball")
check(phi["hs"] == -1.5 and phi["hml"] == -125 and phi["tot"] == 231.5, "a real flip, spread and moneyline agreeing, is not rewritten")

# Consistent opener, one point of total movement: unchanged. Running it twice is stable.
tor_open = dict(hs=-3.5, **{"as": 3.5}, hml=-155, aml=130, tot=226.5)
tor_pts = [dict(hs=-4.5, **{"as": 4.5}, hml=-175, aml=145, tot=222.5)]
tor = LH.reconcile_open(tor_open, tor_pts, "basketball")
check(tor == tor_open and LH.reconcile_open(tor, tor_pts, "basketball") == tor, "a consistent opener is unchanged and idempotent")

# Football totals move before the first snapshot. A 6-point gap is not treated as the basketball bug.
fb = LH.reconcile_open(dict(hs=-3.5, **{"as": 3.5}, hml=-160, aml=140, tot=46.5),
                       [dict(hs=-3.0, **{"as": 3.0}, hml=-150, aml=130, tot=40.5)], "football")
check(fb["tot"] == 46.5 and fb["hs"] == -3.5, "football opening total is left as ESPN reported it")

# A 3-point basketball gap is normal movement, not a stale total.
near = LH.reconcile_open(dict(hs=-7.5, **{"as": 7.5}, hml=-230, aml=190, tot=226.5),
                         [dict(hs=-7.5, **{"as": 7.5}, hml=-230, aml=190, tot=223.5)], "basketball")
check(near["tot"] == 226.5, "a basketball total 3 points from the series stays")

# merge stores the corrected open and does not undo it when the next run sends the same bad ESPN open.
hist = dict(v=1, league="nba", games={})
snap = lambda t, pt, op: {"401909282": dict(date="2026-10-31T00:00Z", home="MIA", away="IND",
                                            books={"draftkings": pt}, open={"draftkings": op})}
LH.merge(hist, snap("2026-10-29T15:45:24Z", mia_pts[0], mia_open), "2026-10-29T15:45:24Z")
got = hist["games"]["401909282"]["open"]["draftkings"]
check(got["hs"] == -3.5 and got["as"] == 3.5 and got["hml"] == -155, f"merge corrects the Heat open on the way in ({got})")
n = LH.merge(hist, snap("2026-10-30T13:45:21Z", mia_pts[1], mia_open), "2026-10-30T13:45:21Z")
got = hist["games"]["401909282"]["open"]["draftkings"]
check(n == 1 and got["hs"] == -3.5 and len(hist["games"]["401909282"]["books"]["draftkings"]) == 2,
      "a later run that sends the same bad open stays corrected and keeps both points")

# The line card reads homeSpreadOpen off the odds object, not the history compact keys.
game = dict(odds=dict(provider="DraftKings", homeSpread=-8.5, awaySpread=8.5, homeSpreadOpen=3.5, awaySpreadOpen=-3.5,
                      homeML=-325, awayML=260, homeMLOpen=-155, awayMLOpen=130, total=237.5, totalOpen=240.5),
            books={"draftkings": dict(homeSpreadOpen=3.5, awaySpreadOpen=-3.5, homeMLOpen=-155, totalOpen=240.5)})
LH.stamp_open(game, mia)
check(game["odds"]["homeSpreadOpen"] == -3.5 and game["odds"]["awaySpreadOpen"] == 3.5, "line card home/away opening spreads follow the swap")
check(game["books"]["draftkings"]["homeSpreadOpen"] == -3.5 and game["odds"]["homeMLOpen"] == -155, "DraftKings book open and the moneyline open follow along")
game["odds"]["totalOpen"] = 234.5
LH.stamp_open(game, cha)
check(game["odds"]["totalOpen"] == 223.5 and game["books"]["draftkings"]["totalOpen"] == 223.5, "line card total opener becomes the first recorded total")

print(f"open_line_test: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
