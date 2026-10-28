"""Tests for overtime / extra-inning final labels ("Final/OT", "Final/2OT", "Final/SO", "Final/12", "AET").

Covers scripts/final_label.py against ESPN status blocks from Oct 27, 2026 (Canucks at Ducks Final/OT, Islanders at
Predators Final/SO, World Series Game 4 Brewers at Rays Final/12), the archive backfill (label stored with the final,
older records repaired, plain "Final" fallback), the SEO score line / result label, and the JS helper in live-core.js.
Offline, no API key.  Usage: python3 scripts/final_label_test.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.pop("ODDS_API_KEY", None)
import final_label as FL  # noqa: E402
import seo_pages as SP  # noqa: E402

passed = failed = 0


def check(ok, msg):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FAIL", msg)


def st(short, state="post", completed=True, name="STATUS_FINAL"):
    return {"state": state, "completed": completed, "name": name, "shortDetail": short, "detail": short}


# ---- label(): ESPN status -> label
check(FL.label("hockey", st("Final/OT"), 4, "nhl") == "Final/OT", "NHL OT (VAN@ANA)")
check(FL.label("hockey", st("Final/SO"), 5, "nhl") == "Final/SO", "NHL shootout (NYI@NSH)")
check(FL.label("hockey", st("Final"), 3, "nhl") == "Final", "NHL regulation")
check(FL.label("baseball", st("Final/12"), 12, "mlb") == "Final/12", "MLB 12 innings (WS G4)")
check(FL.label("baseball", st("F/12"), 12, "mlb") == "Final/12", "ESPN short form F/12")
check(FL.label("baseball", st("Final"), 9, "mlb") == "Final", "MLB nine innings")
check(FL.label("basketball", st("Final/2OT"), 6, "nba") == "Final/2OT", "NBA double OT")
check(FL.label("basketball", st(""), 6, "nba") == "Final/2OT", "NBA double OT from period count")
check(FL.label("basketball", st(""), 3, "ncaab") == "Final/OT", "college hoops (two halves) OT from period count")
check(FL.label("football", st(""), 5, "nfl") == "Final/OT", "NFL OT from period count")
check(FL.label("baseball", st(""), 11, "mlb") == "Final/11", "MLB extras from inning count")
check(FL.label("hockey", st("Final/OT", "in", False, "STATUS_IN_PROGRESS"), 4, "nhl") is None, "live game: no label")
check(FL.label("hockey", st("Postponed", "post", True, "STATUS_POSTPONED"), 0, "nhl") is None, "postponed: no label")
check(FL.label("soccer", st("FT"), 2, "epl") == "FT", "soccer full time")
check(FL.label("soccer", st("AET"), 4, "epl") == "AET", "soccer extra time")
check(FL.label("soccer", st("FT-Pens"), 5, "ucl") == "FT-Pens", "soccer penalties")

# ---- of_game() / suffix(): old records fall back to plain "Final"
check(FL.of_game({"statusDetail": "Final"}) == "Final", "old record -> Final")
check(FL.of_game({}) == "Final", "no status -> Final")
check(FL.of_game({"statusDetail": "Final", "finalLabel": "Final/OT"}) == "Final/OT", "stored label wins")
check(FL.of_game({"statusDetail": "Final/12"}) == "Final/12", "label in statusDetail")
check([FL.suffix(x) for x in ("Final", "Final/OT", "Final/2OT", "Final/SO", "Final/12", "AET", "FT-Pens", None)]
      == ["", "OT", "2OT", "SO", "12 inn", "AET", "pens", ""], "suffixes")

# ---- archive: a late game that left the window is filled in with its label; old plain-Final records are repaired
VAN = {"id": "22", "abbr": "VAN", "name": "Vancouver Canucks"}
ANA = {"id": "25", "abbr": "ANA", "name": "Anaheim Ducks"}
GID, D = "401892594", "2026-10-28T02:00Z"
rec_live = {"id": GID, "date": D, "state": "in", "statusDetail": "OT", "completed": False,
            "home": dict(ANA, score=5), "away": dict(VAN, score=5)}
teams = {"25": {"recent": [dict(id=GID, date=D, res="L", pf=5.0, pa=6.0, home=True, opp="VAN", fin="Final/OT")]},
         "22": {"recent": [dict(id=GID, date=D, res="W", pf=6.0, pa=5.0, home=False, opp="ANA", fin="Final/OT")]}}
later = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)
with tempfile.TemporaryDirectory() as tmp:
    a = SP.Archive(Path(tmp))
    a.games["nhl"] = {GID: dict(rec_live)}
    SP.merge_archive(a, "nhl", [], teams, later)
    r = a.games["nhl"][GID]
    check((r["home"]["score"], r["away"]["score"], r["statusDetail"], r.get("finalLabel")) == (5, 6, "Final/OT", "Final/OT"),
          f"left-window final keeps OT label: {r}")
    # older build already archived plain "Final": repaired, score untouched
    a.games["nhl"] = {GID: dict(rec_live, state="post", completed=True, statusDetail="Final",
                                home=dict(ANA, score=5, winner=False), away=dict(VAN, score=6, winner=True))}
    SP.merge_archive(a, "nhl", [], teams, later)
    r = a.games["nhl"][GID]
    check(r["statusDetail"] == "Final/OT" and r["finalLabel"] == "Final/OT" and (r["home"]["score"], r["away"]["score"]) == (5, 6),
          f"plain Final record repaired: {r}")
    # recent rows from before this change (no fin): plain "Final", no label
    old = json.loads(json.dumps(teams))
    for t in old.values():
        t["recent"][0].pop("fin")
    a.games["nhl"] = {GID: dict(rec_live)}
    SP.merge_archive(a, "nhl", [], old, later)
    r = a.games["nhl"][GID]
    check(r["statusDetail"] == "Final" and "finalLabel" not in r, f"no label -> plain Final: {r}")

# ---- SEO text: score line (titles / meta description / lists) and result label
L = SimpleNamespace(lg="nhl", is_final=lambda g: g.get("state") == "post")
g_ot = {"state": "post", "statusDetail": "Final/OT", "finalLabel": "Final/OT", "home": dict(ANA, score=5), "away": dict(VAN, score=6)}
g_reg = dict(g_ot, statusDetail="Final", finalLabel="Final")
check(SP.League.score_line(L, g_ot) == "VAN 6, ANA 5 (OT)", "score line with (OT)")
check(SP.League.score_line(L, g_reg) == "VAN 6, ANA 5", "regulation score line unchanged")
check(SP.League.final_label(L, g_ot) == "Final/OT" and SP.League.final_label(L, g_reg) == "Final", "result label")
check(SP.League.final_label(L, {"statusDetail": "Final", "state": "post"}) == "Final", "archived record without label")

# ---- JS helper (scoreboards, cards, Live tab, team recent results)
if shutil.which("node"):
    js = ("const C=require(%r);const o=[C.finalLabel({statusDetail:'Final'}),C.finalLabel({statusDetail:'F/12'}),"
          "C.finalLabel({statusDetail:'Final',finalLabel:'Final/SO'}),C.finalLabel({}),C.finalSuffix('Final/12'),"
          "C.finalSuffix('Final/2OT'),C.finalSuffix('Final')];console.log(JSON.stringify(o))") % str(ROOT / "site/assets/live-core.js")
    out = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
    check(out == ["Final", "Final/12", "Final/SO", "Final", "12 inn", "2OT", ""], f"live-core.js finalLabel/finalSuffix: {out}")

print(f"final_label_test: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
