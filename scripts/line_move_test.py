"""Even-money-aware moneyline moves, and the homepage / UFC source copy.

A raw cur - open treats -110 -> +114 as +224. The move is +24 cents. Display recomputes from open/cur
so an older stored delta can't leak onto the page. Offline: no network, no Odds API key.
Run: env -u ODDS_API_KEY python3 scripts/line_move_test.py
"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import line_history as LH
import previews as P
import seo_pages as SP

ok = fail = 0


def check(c, msg):
    global ok, fail
    if c:
        ok += 1
    else:
        fail += 1
        print("FAIL:", msg)


# ---- cents: the even-money gap is 200, not part of the move
check(LH.ml_cents(-110, 114) == 24, "-110 -> +114 is +24 cents")
check(LH.ml_cents(114, -110) == -24, "+114 -> -110 is -24 cents")
check(LH.ml_cents(-105, 105) == 10, "-105 -> +105 is +10 cents")
check(LH.ml_cents(105, -105) == -10, "+105 -> -105 is -10 cents")
check(LH.ml_cents(100, -100) == 0 and LH.ml_cents(-100, 100) == 0, "+100 and -100 are the same price")
check(LH.ml_cents(-110, -135) == -25, "same-sign favorite -110 -> -135 is -25")
check(LH.ml_cents(150, 180) == 30, "same-sign dog +150 -> +180 is +30")
check(round(LH.ml_prob_pts(-110, 114), 1) == -5.7, "-110 -> +114 is about -5.7 implied-probability points")
check(LH.ml_prob_pts(100, -100) == 0, "+100 -> -100 is no implied-probability change")

# ---- biggest move is the cent distance, not the raw American gap
check(LH.biggest(-105, [-140, 100], True) == -140, "biggest move from -105 over [-140, +100] picks -140")
gh = dict(open=dict(draftkings=dict(hml=-105, aml=-110)),
          books=dict(draftkings=[["2026-10-28T01:00:00Z", dict(hml=-140, aml=-110)],
                                 ["2026-10-28T02:00:00Z", dict(hml=100, aml=-135)]]))
m = LH.summarize(gh, "hockey", "nhl")
check(m["homeML"]["open"] == -105 and m["homeML"]["cur"] == 100, "open/cur stay raw American odds")
check(m["homeML"]["delta"] == 5, "current move -105 -> +100 is +5 cents, not +205")
check(m["homeML"]["maxMove"] == -35, "summarize biggest-move pick is -140 (-35 cents), not +100")
check(m["awayML"]["delta"] == -25 and m["awayML"]["open"] == -110 and m["awayML"]["cur"] == -135, "same-sign away move stored in cents")

# Kraken: open -110, touched +120, now +114. Stored the old way this was +224 / +230.
sea = [-110, -105, 100, 120, 114]
gh = dict(open=dict(draftkings=dict(hml=-110)),
          books=dict(draftkings=[[f"2026-10-2{i}T00:00:00Z", dict(hml=v)] for i, v in enumerate(sea)]))
m = LH.summarize(gh, "hockey", "nhl")
check(m["homeML"]["open"] == -110 and m["homeML"]["cur"] == 114, "Kraken open/cur stay -110 and +114")
check(m["homeML"]["delta"] == 24 and m["homeML"]["maxMove"] == 30, "Kraken move is +24 cents, biggest +120 is +30 (not +224 / +230)")

# spread math is unchanged (no even-money gap)
gh = dict(open=dict(draftkings=dict(hs=-3.0, tot=48.5)),
          books=dict(draftkings=[["2026-10-26T01:00:00Z", dict(hs=-4.5, tot=47.5)],
                                 ["2026-10-26T02:00:00Z", dict(hs=-5.0, tot=47.5)]]))
m = LH.summarize(gh, "football", "nfl")
check(m["spread"]["delta"] == -2.0 and m["spread"]["open"] == -3.0 and m["spread"]["cur"] == -5.0, "spread delta stays a plain subtraction")
check(m["total"]["delta"] == -1.0, "total delta stays a plain subtraction")

# ---- static game page recomputes, ignoring a stored delta of +224
def move_cells(move, kind="hockey"):
    g = {"away": {"abbr": "TOR"}, "home": {"abbr": "SEA"}, "move": dict(move, book="draftkings", since="2026-10-27T15:45:16Z")}
    html, _ = P.movement(g, kind)
    rows = re.findall(r"<tr><td>(.*?)</td><td[^>]*>(.*?)</td><td[^>]*>(.*?)</td><td[^>]*>(.*?)</td></tr>", html)
    return {a: d for a, _, _, d in rows}, html


cells, html = move_cells({"spread": {"open": 1.5, "cur": 1.5, "delta": 0},
                          "total": {"open": 6.5, "cur": 6.5, "delta": 0},
                          "homeML": {"open": -110, "cur": 114, "delta": 224, "maxMove": 230},
                          "awayML": {"open": -110, "cur": -135, "delta": -25, "maxMove": -32}})
check(cells.get("SEA moneyline") == "+24" and "+224" not in html, "rendered game page shows +24, not the stored +224")
check(cells.get("TOR moneyline") == "-25", "same-sign away moneyline on the game page is -25")
check(cells.get("Puck line (SEA)") == "no change" and cells.get("Total") == "no change", "unchanged spread and total say no change")
check("-110" in html and "+114" in html, "open and current render as raw odds")

cells, html = move_cells({"homeML": {"open": 114, "cur": -110, "delta": -224}})
check(cells.get("SEA moneyline") == "-24" and "-224" not in html, "rendered game page shows -24 for +114 -> -110, not -224")

cells, html = move_cells({"homeML": {"open": -105, "cur": 105, "delta": 210}})
check(cells.get("SEA moneyline") == "+10" and "+210" not in html, "rendered game page shows +10 for -105 -> +105")

cells, html = move_cells({"homeML": {"open": 100, "cur": -100, "delta": -200}, "awayML": {"open": -100, "cur": 100, "delta": 200}})
check(cells.get("SEA moneyline") == "no change" and cells.get("TOR moneyline") == "no change", "+100 <-> -100 renders as no change")
check("-200" not in html and "+200" not in html, "+100 <-> -100 does not render the raw 200-point gap")

cells, _ = move_cells({"homeML": {"open": -110, "cur": -135, "delta": -25}, "awayML": {"open": 150, "cur": 180, "delta": 30}})
check(cells.get("SEA moneyline") == "-25" and cells.get("TOR moneyline") == "+30", "same-sign moves render -25 and +30")


# ---- biggest-line-moves ranking: implied-probability points, both sides, 15-cent floor
def league(lg, kind, games):
    now = P.parse_dt("2026-10-28T18:00:00Z")
    L = SP.League(lg, {"league": {"kind": kind}, "games": games, "generated": "2026-10-28T18:00:00Z"}, None, None, now, SP.BASE_URL)
    L.games = {g["id"]: g for g in games}
    return L


def game(gid, date, home, away, move):
    return {"id": gid, "state": "pre", "date": date, "home": home, "away": away, "move": move}


H = lambda a, **k: dict(abbr=a, short=a, name=a, **k)
spread = game("s", "2026-11-01T17:00:00Z", H("DEN"), H("KC"), {"spread": {"open": 3, "cur": -5, "delta": -8}})
flip = game("m", "2026-10-29T02:00:00Z", H("SEA"), H("TOR"),
            {"homeML": {"open": -110, "cur": 114, "delta": 224}, "awayML": {"open": -110, "cur": -135, "delta": -25}})
ranked = sorted(SP.big_moves(league("nfl", "football", [spread]), 4) + SP.big_moves(league("nhl", "hockey", [flip]), 4),
                key=lambda r: (-r[0], r[3]["date"]))
check(len(ranked) == 2 and ranked[0][4] == "Spread" and ranked[0][0] == 8, "an 8-pt spread is the top move")
check(ranked[0][0] > ranked[1][0] and ranked[1][4] == "Moneyline", "8-pt spread ranks above a -110 -> +114 moneyline")
check(ranked[1][0] < 8 and "224" not in ranked[1][5] and "-110" in ranked[1][5] and "+114" in ranked[1][5],
      "the moneyline tile keeps raw odds and scores under 8 implied-probability points")

# the away side moved further in probability than the home flip, so the tile names the away side
both = game("b", "2026-10-29T02:00:00Z", H("SEA"), H("TOR"),
            {"homeML": {"open": -110, "cur": 114, "delta": 224}, "awayML": {"open": -110, "cur": -200, "delta": -90}})
rows = SP.big_moves(league("nhl", "hockey", [both]), 4)
check(len(rows) == 1 and rows[0][5].startswith("TOR ") and "-110" in rows[0][5] and "-200" in rows[0][5],
      "both sides are considered; the larger implied-probability move wins")

# under the 15-cent floor, and +100/-100, are not moves. A real away move still is.
noise = game("n", "2026-10-30T00:00:00Z", H("STL"), H("BOS"), {"homeML": {"open": 105, "cur": -105, "delta": -210}})
check(SP.big_moves(league("nhl", "hockey", [noise]), 4) == [], "+105 -> -105 (10 cents) is under the floor")
even = game("e", "2026-10-30T00:00:00Z", H("STL"), H("BOS"), {"homeML": {"open": 100, "cur": -100, "delta": -200}})
check(SP.big_moves(league("nhl", "hockey", [even]), 4) == [], "+100 -> -100 is not a move")
mixed = game("x", "2026-10-30T00:00:00Z", H("STL"), H("BOS"),
             {"homeML": {"open": 105, "cur": -105, "delta": -210}, "awayML": {"open": 150, "cur": 180, "delta": 30}})
rows = SP.big_moves(league("nhl", "hockey", [mixed]), 4)
check(len(rows) == 1 and rows[0][5].startswith("BOS ") and "+150" in rows[0][5] and "+180" in rows[0][5],
      "a 10-cent home flip is skipped; the 30-cent away move is the tile")

# a longshot's raw gap used to outrank an 8-pt spread (300/20 = 15). Probability points do not.
longshot = game("l", "2026-10-31T00:00:00Z", H("OTT"), H("NYR"), {"homeML": {"open": 1500, "cur": 1800, "delta": 300}})
ls = SP.big_moves(league("nhl", "hockey", [longshot]), 4)
check(ls and ls[0][0] < 8, "a +1500 -> +1800 longshot scores under an 8-pt spread")

# UFC tile uses the last name, and the crossing is not scored as a raw -220
ufc = game("u", "2026-11-01T00:00:00Z",
           {"abbr": "DUR", "last": "Durden", "name": "Cody Durden"},
           {"abbr": "OSB", "last": "Osbourne", "name": "Osbourne"},
           {"homeML": {"open": 105, "cur": -115, "delta": -220}})
rows = SP.big_moves(league("ufc", "mma", [ufc]), 4)
check(len(rows) == 1 and rows[0][5].startswith("Durden ") and "220" not in rows[0][5], "UFC tile uses the last name and not the raw gap")


# ---- source copy
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ix = open(os.path.join(root, "site", "index.html")).read()
intro = ix.split('id="introTitle"', 1)[1].split("</p>", 1)[0]
check("Hard Rock Bet" in ix and "DraftKings" in ix and "FanDuel" in ix, "homepage names Hard Rock Bet, DraftKings and FanDuel")
check("DraftKings (via ESPN) and Hard Rock Bet" not in ix and "DraftKings</strong> odds (via ESPN)" not in ix, "homepage no longer says DraftKings-via-ESPN with only Hard Rock")
check("in Florida, Hard Rock Bet is the only legal online sportsbook" in intro, "Florida: Hard Rock Bet is the only legal online sportsbook")
check("FanDuel is legal" not in ix and "DraftKings is legal" not in ix and "available in Florida" not in ix, "copy does not call DraftKings or FanDuel legal in Florida")
check("free bet" not in ix.lower() and "risk-free" not in ix.lower() and "risk free" not in ix.lower(), "no promo wording")
check("The Odds API" in intro and "DraftKings opening lines" in intro and "UFC odds are DraftKings lines via ESPN" in intro, "homepage states the real sources")
check("21+" in ix and "1-800-GAMBLER" in ix and "1-833-PLAYWISE" in ix and "1-888-ADMIT-IT" in ix, "21+ notice and state helplines stay")
man = json.load(open(os.path.join(root, "site", "manifest.webmanifest")))
check("FanDuel" in man["description"] and "Hard Rock Bet" in man["description"] and "21+" in man["description"], "manifest description names the three books")

now = P.parse_dt("2026-10-28T18:00:00Z")
ufc_L = SP.League("ufc", {"league": {"kind": "mma"}, "games": []}, None, None, now, SP.BASE_URL)
nfl_L = SP.League("nfl", {"league": {"kind": "football"}, "games": []}, None, None, now, SP.BASE_URL)
lead = SP.hub_lead(ufc_L, 12)
check(lead == "Moneylines and totals for 12 upcoming UFC bouts (DraftKings lines via ESPN), every fighter's record, full fight cards and results with closing odds.",
      f"UFC hub lead is DraftKings via ESPN ({lead})")
check("Hard Rock" not in lead and "FanDuel" not in lead, "UFC hub lead does not claim Hard Rock Bet or FanDuel")
empty = SP.hub_lead(ufc_L, 0)
check("DraftKings lines via ESPN" in empty and "Hard Rock" not in empty and "FanDuel" not in empty, "empty UFC board does not claim the other books")
nfl_lead = SP.hub_lead(nfl_L, 4)
check("DraftKings" in nfl_lead and "Hard Rock Bet" in nfl_lead and "FanDuel" in nfl_lead, "other league hubs still compare all three books")

# ---- the JS helper agrees with Python (the game page uses it for the change and biggest columns)
pairs = [[-110, 114], [114, -110], [-105, 105], [105, -105], [100, -100], [-100, 100], [-110, -135], [150, 180], [-105, -140], [-105, 100]]
want = [{"cents": LH.ml_cents(a, b), "pts": None if LH.ml_prob_pts(a, b) is None else round(LH.ml_prob_pts(a, b), 6)} for a, b in pairs]
js = r"""
const C = require('./site/assets/line-core.js');
const pairs = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const out = pairs.map(([o, c]) => ({ cents: C.cents(o, c), pts: C.probPts(o, c) == null ? null : Math.round(C.probPts(o, c) * 1e6) / 1e6 }));
out.push(C.biggest(-105, [-140, 100], true));
out.push(C.formatSigned(C.cents(-110, 114), true));
out.push(C.formatSigned(C.cents(114, -110), true));
out.push(C.formatSigned(0, true));
process.stdout.write(JSON.stringify(out));
"""
try:
    r = subprocess.run(["node", "-e", js], input=json.dumps(pairs), capture_output=True, text=True, cwd=root, timeout=30)
    got = json.loads(r.stdout)
    check(got[:len(want)] == want, f"JS cents and implied-probability points match Python ({r.stderr.strip()})")
    check(got[len(want)] == -140, "JS biggest-move pick from -105 over [-140, +100] is -140")
    check(got[-3:] == ["+24", "-24", ""], f"JS game-page move text is +24 / -24 / blank, not +224 ({got[-3:]})")
except FileNotFoundError:
    print("(node not found: skipped JS parity)")
except Exception as e:  # noqa: BLE001
    check(False, f"JS parity failed: {e} {r.stderr if 'r' in dir() else ''}")

print(f"line_move_test: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
