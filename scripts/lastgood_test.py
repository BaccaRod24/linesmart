#!/usr/bin/env python3
"""Tests for the keep-last-good fallback (scripts/lastgood.py + build_data.py). Fully offline: every HTTP call made by the
build is answered by a fake (ESPN 403s for chosen leagues, empty-but-OK feeds for others); the last good copy is a local
directory (LASTGOOD_SRC). Never calls The Odds API (the fake raises if it is ever asked). Run: python3 scripts/lastgood_test.py"""
import json
import os
import shutil
import sys
import tempfile
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.pop("ODDS_API_KEY", None)
import build_data as BD  # noqa: E402
import lastgood as LG  # noqa: E402
import previews as P  # noqa: E402

passed = failed = 0


def check(cond, label):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print("FAIL:", label)


NOW = datetime.now(timezone.utc).replace(microsecond=0)
iso = lambda t: t.strftime("%Y-%m-%dT%H:%MZ")
H = lambda h: NOW + timedelta(hours=h)
ET = BD.ET


def team(i, abbr, name):
    return {"id": str(i), "abbr": abbr, "name": name, "short": name.split()[-1], "logo": f"https://a.espncdn.com/{abbr}.png",
            "color": "204e32", "record": "5-3"}


def book(asof):
    return {"homeML": -150, "awayML": 130, "homeSpread": -1.5, "awaySpread": 1.5, "total": 6.5, "overOdds": -110, "underOdds": -110,
            "homeSpreadOdds": 120, "awaySpreadOdds": -140, "asOf": asof}


def game(gid, t, a, h, state="pre", **kw):
    g = {"id": str(gid), "date": iso(t), "name": f"{a['name']} at {h['name']}", "state": state, "statusDetail": "7:00 PM",
         "venue": "Arena", "city": "Town", "neutral": False, "broadcasts": ["ESPN+"], "home": dict(h), "away": dict(a),
         "odds": {"provider": "DraftKings", "homeML": -150, "awayML": 130, "total": 6.5},
         "books": {"draftkings": book(iso(NOW - timedelta(hours=1))), "fanduel": book(iso(NOW - timedelta(hours=1)))}}
    g.update(kw)
    return g


def write_league(src, key, kind, games, generated, teams=None, extra=None, detail=True):
    d = src / key / "games"; d.mkdir(parents=True, exist_ok=True)
    ix = {"league": {"key": key, "name": key.upper(), "full": key.upper(), "kind": kind}, "generated": generated, "windowDays": 10,
          "games": games, "teams": teams or {}, "report": {"league": key, "games": len(games)}}
    ix.update(extra or {})
    (src / key / "index.json").write_text(json.dumps(ix))
    for g in games:
        det = {"injuriesAvailable": True, "injuries": {g["home"]["id"]: [{"player": "Hurt Guy", "pos": "C", "status": "Out", "type": "Knee"}]}} if detail else {}
        (d / f"{g['id']}.json").write_text(json.dumps({"league": key, "game": g, "detail": det, "teams": {}, "hasSummary": detail, "history": None}))


def last_good(src):
    """The 'deployed site' copy: NHL/MLB/UFC with upcoming games (the 403 leagues), plus cases for the other rules."""
    gen = (NOW - timedelta(minutes=40)).isoformat()
    bos, tor, nyr, mtl = team(1, "BOS", "Boston Bruins"), team(21, "TOR", "Toronto Maple Leafs"), team(13, "NYR", "New York Rangers"), team(10, "MTL", "Montreal Canadiens")
    nhl = [game(401, H(-30), bos, tor, "post"),             # yesterday's final: kept (ticker)
           game(402, H(-7), nyr, mtl, "pre"),               # "pre" but 7h past start: played, result unknown -> dropped
           game(403, H(20), bos, nyr), game(404, H(26), tor, mtl), game(405, H(50), mtl, bos), game(406, H(74), nyr, tor)]
    write_league(src, "nhl", "hockey", nhl, gen, teams={"1": {"recordSummary": "5-3", "streak": "W2"}, "21": {"recordSummary": "4-4"}})
    lad, nyy = team(19, "LAD", "Los Angeles Dodgers"), team(10, "NYY", "New York Yankees")
    write_league(src, "mlb", "baseball", [game(501, H(18), lad, nyy, note="World Series - Game 4"), game(502, H(42), lad, nyy, note="World Series - Game 5")], gen)
    f = lambda i, n: {"id": str(i), "name": n, "abbr": n[:4].upper(), "record": "20-3"}
    ev = {"id": "600", "name": "UFC 999: Alpha vs. Beta"}
    ufc = [game(601, H(96), f(1, "Alpha Fighter"), f(2, "Beta Fighter"), segment="main", mainEvent=True, event=ev, weightClass="Lightweight"),
           game(602, H(95), f(3, "Gamma Fighter"), f(4, "Delta Fighter"), segment="main", event=ev, weightClass="Welterweight"),
           game(603, H(93), f(5, "Prelim One"), f(6, "Prelim Two"), segment="prelims", event=ev)]
    write_league(src, "ufc", "mma", ufc, gen, extra={"events": [dict(ev, date=iso(H(93)), state="pre", bouts=["601", "602", "603"], mainEvent="601")]}, detail=False)
    (src / "ufc" / "fighters.json").write_text(json.dumps({"generated": gen, "fighters": {"1": {"id": "1", "name": "Alpha Fighter", "bouts": ["601"]}}}))
    (src / "search").mkdir(exist_ok=True)
    for k in ("nhl", "mlb"):
        (src / "search" / f"{k}.json").write_text(json.dumps({"league": k, "teams": [{"id": "1", "n": "Boston Bruins"}], "players": []}))
    # NBA: real empty schedule (last good copy also has only an old final) -> must stay empty
    write_league(src, "nba", "basketball", [game(701, H(-40), team(2, "BOS", "Boston Celtics"), team(18, "NY", "New York Knicks"), "post")], gen)
    # NFL: ESPN answers every day with an EMPTY feed, but the deployed copy had 3 upcoming games -> suspicious, fallback
    kc, buf = team(12, "KC", "Kansas City Chiefs"), team(2, "BUF", "Buffalo Bills")
    write_league(src, "nfl", "football", [game(801, H(60), kc, buf), game(802, H(63), buf, kc), game(803, H(66), kc, buf)], gen)
    # NCAAB: 403, but the last good copy is 20h old (> max age) -> give up, empty
    write_league(src, "ncaab", "basketball", [game(901, H(30), team(150, "DUKE", "Duke Blue Devils"), team(153, "UNC", "North Carolina Tar Heels"))],
                 (NOW - timedelta(hours=20)).isoformat())
    # EPL: 403, last good copy only has games that already finished (pre-game entries well past their start) -> give up
    ars, che = team(359, "ARS", "Arsenal"), team(363, "CHE", "Chelsea")
    write_league(src, "epl", "soccer", [game(1001, H(-9), ars, che), game(1002, H(-30), che, ars, "post")], gen)
    # MLS: partial failure (today 403, other days fine): today's game restored; a later-day game the OK feed dropped is not
    mia, lafc = team(9568, "MIA", "Inter Miami CF"), team(18966, "LAFC", "LAFC")
    today_late = datetime.now(ET).replace(hour=22, minute=30, second=0, microsecond=0).astimezone(timezone.utc)
    write_league(src, "mls", "soccer", [game(1101, today_late, mia, lafc), game(1102, H(24 * 4), lafc, mia), game(1103, H(24 * 5), mia, lafc)], gen,
                 teams={"9568": {"recordSummary": "19-8-7"}})
    return gen


def espn_event(g):
    comp = lambda t, ha: {"homeAway": ha, "team": {"id": t["id"], "abbreviation": t["abbr"], "displayName": t["name"], "shortDisplayName": t["short"]}}
    return {"id": g["id"], "date": g["date"], "name": g["name"], "competitions": [{"competitors": [comp(g["home"], "home"), comp(g["away"], "away")],
            "status": {"type": {"state": "pre", "shortDetail": "TBD", "completed": False}}}]}


calls = {"odds": 0, "espn": 0}


def forbidden(url):
    return urllib.error.HTTPError(url, 403, "Forbidden", {}, None)


def make_fake(src, fail, empty, partial_today):
    """fail: league paths whose every ESPN call 403s; empty: league paths whose scoreboards answer OK with no events;
    partial_today: path -> (today's YYYYMMDD that 403s, events returned on another day)."""
    def fake_getj(url):
        if "the-odds-api" in url or "odds-api" in url:
            calls["odds"] += 1; raise AssertionError("Odds API must never be called in tests")
        calls["espn"] += 1
        if "mma/ufc" in url and "mma/ufc" in fail: raise forbidden(url)
        for p in fail:
            if f"/{p}/" in url: raise forbidden(url)
        for p in empty:
            if f"/{p}/scoreboard" in url: return {"events": []}
        for p, (day, evs) in partial_today.items():
            if f"/{p}/scoreboard" in url:
                if f"dates={day}" in url: raise forbidden(url)
                return {"events": evs if url.split("dates=")[1][:8] == (datetime.now(ET) + timedelta(days=4)).strftime("%Y%m%d") else []}
        raise forbidden(url)   # summaries, team schedules, standings, rosters: unavailable too
    return fake_getj


def run_build(out, src, leagues, fail, empty, partial=None, extra_env=None):
    os.environ["LASTGOOD_SRC"] = str(src)
    for k, v in (extra_env or {}).items(): os.environ[k] = v
    BD.OUT = str(out)
    fake = make_fake(src, fail, empty, partial or {})
    BD.getj = fake
    BD.get = lambda url, tries=3: (_ for _ in ()).throw(AssertionError("raw get() must not be called: " + url[:40]))
    argv = sys.argv
    sys.argv = ["build_data.py", "--leagues", ",".join(leagues), "--no-matchups", "--no-props", "--no-adv", "--no-weather"]
    try: BD.main()
    finally: sys.argv = argv


def load(p): return json.loads(Path(p).read_text())


def main():
    tmp = Path(tempfile.mkdtemp(prefix="lastgood-"))
    try:
        src = tmp / "deployed"; src.mkdir()
        gen = last_good(src)
        site = tmp / "site"; out = site / "data"; out.mkdir(parents=True)
        shutil.copy(ROOT / "site" / "sitemap.xml", site / "sitemap.xml")
        mia_lafc = espn_event(load(src / "mls" / "index.json")["games"][1])
        today = datetime.now(ET).strftime("%Y%m%d")
        run_build(out, src, ["nfl", "nba", "ncaab", "nhl", "mlb", "epl", "mls", "ufc"],
                  fail=["hockey/nhl", "baseball/mlb", "mma/ufc", "basketball/mens-college-basketball", "soccer/eng.1"],
                  empty=["basketball/nba", "football/nfl"], partial={"soccer/usa.1": (today, [mia_lafc])})
        check(calls["odds"] == 0, "the Odds API was never called")
        meta = load(out / "meta.json")
        fbl = (meta.get("fallback") or {}).get("leagues") or {}

        # --- NHL: 403 on every ESPN call -> last good games survive, marked stale; finished-but-unknown game dropped
        ix = load(out / "nhl" / "index.json")
        ids = [g["id"] for g in ix["games"]]
        check(sorted(ids) == ["401", "403", "404", "405", "406"], f"nhl kept the right games: {ids}")
        check(all(LG.parse((g.get("stale") or {}).get("asOf")) == LG.parse(gen) for g in ix["games"]), "nhl games marked stale with the last good time")
        check("403" in ((ix.get("stale") or {}).get("reason") or ""), f"nhl index stale reason names the 403: {ix.get('stale')}")
        check(ix["report"]["upcoming"] == 4, "nhl report counts 4 upcoming")
        check(ix["teams"].get("1", {}).get("streak") == "W2", "nhl teams carried over from the last good copy")
        gf = load(out / "nhl" / "games" / "403.json")
        check(gf["detail"].get("injuries") and gf["hasSummary"], "nhl game file keeps its last good detail (injuries)")
        check(gf["game"].get("stale"), "nhl game file's game is marked stale")
        check(not (out / "nhl" / "games" / "402.json").exists(), "nhl dropped game has no file")
        check(meta["leagues"]["nhl"]["games"] == 5 and meta["leagues"]["nhl"].get("stale"), "meta: nhl 5 games, stale")
        check("nhl" in fbl and "mlb" in fbl and "ufc" in fbl, f"meta.fallback lists nhl/mlb/ufc: {sorted(fbl)}")
        check((out / "search" / "nhl.json").exists() and meta["search"]["nhl"].get("stale"), "nhl search index restored after its 403")

        # --- MLB: World Series games survive
        mx = load(out / "mlb" / "index.json")
        check([g["id"] for g in mx["games"]] == ["501", "502"] and all(g.get("stale") for g in mx["games"]), "mlb games survive, stale")

        # --- UFC: calendar 403 -> whole-league restore incl. events and fighters
        ux = load(out / "ufc" / "index.json")
        check(sorted(g["id"] for g in ux["games"]) == ["601", "602", "603"], "ufc bouts survive")
        check(ux.get("stale") and ux["stale"].get("whole"), "ufc index marked stale (whole league)")
        check(len(ux.get("events") or []) == 1 and ux["events"][0]["bouts"] == ["601", "602", "603"], "ufc event kept with its bouts")
        check((out / "ufc" / "fighters.json").exists() and (out / "ufc" / "games" / "601.json").exists(), "ufc fighters.json + bout files restored")
        check(meta["leagues"]["ufc"]["games"] == 3 and meta["leagues"]["ufc"].get("error"), "meta: ufc 3 games (error still recorded)")

        # --- real empty schedule (NBA): stays empty, no stale flag
        nx = load(out / "nba" / "index.json")
        check(nx["games"] == [] and "stale" not in nx and "nba" not in fbl, "nba real empty schedule stays empty")
        # --- suspicious empty (NFL): fallback
        fx = load(out / "nfl" / "index.json")
        check(len(fx["games"]) == 3 and "empty schedule" in fx["stale"]["reason"], f"nfl suspicious empty feed -> last good kept ({fx.get('stale')})")
        # --- max age (NCAAB, 20h old): give up
        cx = load(out / "ncaab" / "index.json")
        check(cx["games"] == [] and "stale" not in cx and "older than" in (cx["report"].get("fallback") or {}).get("why", ""), "ncaab: stale copy too old -> empty")
        # --- finished games (EPL): give up
        ex = load(out / "epl" / "index.json")
        check(ex["games"] == [] and "stale" not in ex, "epl: last good games all finished -> empty")
        # --- partial (MLS): today's failed day restored, the fetched day comes fresh, the dropped later game is not resurrected
        sx = load(out / "mls" / "index.json")
        got = {g["id"]: bool(g.get("stale")) for g in sx["games"]}
        check(got == {"1101": True, "1102": False}, f"mls partial failure merge: {got}")
        check(sx["stale"]["partial"] and sx["stale"]["games"] == 1, "mls index stale (partial, 1 game)")
        check(load(out / "mls" / "games" / "1102.json")["detail"].get("injuries"), "mls fresh game reused last good detail when its summary 403'd")
        check(sx["teams"].get("9568", {}).get("recordSummary") == "19-8-7", "mls team splits reused after 403")

        # --- previews + sitemap survive
        st = P.build(site, out, NOW)
        man = load(out / "previews.json")["leagues"]
        sm = (site / "sitemap.xml").read_text()
        exp = lambda k: sum(1 for _, m in P.select(k, load(src / k / "index.json")["games"], NOW) if m == "index")   # what the deployed copy had
        check(exp("nhl") == 3, "nhl: 3 of the deployed games fall inside the preview horizon")
        for lg, n in (("nhl", exp("nhl")), ("mlb", 2), ("ufc", 2)):
            check(len(man.get(lg, {})) == n, f"previews: {lg} has {n} pages (got {len(man.get(lg, {}))})")
            check(all(("https://linesmart.app/" + p) in sm for p in man.get(lg, {}).values()), f"sitemap lists the {lg} previews")
        page = next(iter(man["nhl"].values()))
        html = (site / page / "index.html").read_text()
        check("stale-note" in html and "last good update" in html, "nhl preview page shows the delayed-data note")
        check("nba" not in man, "nba (real empty) has no preview pages")

        # --- a second failing run re-serves the stale copy: asOf is carried from the real fetch, so max age still applies
        src2 = tmp / "deployed2"; shutil.copytree(out, src2)
        lx = load(src2 / "nhl" / "index.json")
        kept, asof, _ = LG.pick(lx, NOW + timedelta(hours=2))
        check(asof and LG.parse(asof) == LG.parse(gen), "second run: asOf stays the original fetch time")
        _, _, why = LG.pick(lx, NOW + timedelta(hours=19))
        check(why and "older than" in why, f"second run 19h later: gives up ({why})")
        kept, _, _ = LG.pick(lx, H(80))
        check(kept == [], "after the last game has started and finished, nothing is kept")

        # --- once ESPN works again, no stale flags remain
        out2 = tmp / "site2" / "data"; out2.mkdir(parents=True)
        bos, tor = team(1, "BOS", "Boston Bruins"), team(21, "TOR", "Toronto Maple Leafs")
        evs = [espn_event(game(403, H(20), bos, tor))]
        fake = lambda url: {"events": evs} if "/hockey/nhl/scoreboard" in url and f"dates={datetime.now(ET).strftime('%Y%m%d')}" in url else (
            {"events": []} if "/scoreboard" in url else (_ for _ in ()).throw(forbidden(url)))
        os.environ["LASTGOOD_SRC"] = str(src2); BD.OUT = str(out2); BD.getj = fake
        argv = sys.argv; sys.argv = ["b", "--leagues", "nhl", "--no-matchups", "--no-props", "--no-adv", "--no-weather", "--no-search"]
        try: BD.main()
        finally: sys.argv = argv
        rx = load(out2 / "nhl" / "index.json")
        check([g["id"] for g in rx["games"]] == ["403"] and "stale" not in rx and not rx["games"][0].get("stale"),
              "recovered feed: fresh games only, no stale flags (an OK feed is trusted even when shorter)")

        # --- fallback off (LASTGOOD_SRC=""): old behaviour, 403 -> empty
        out3 = tmp / "site3" / "data"; out3.mkdir(parents=True)
        os.environ["LASTGOOD_SRC"] = ""; BD.OUT = str(out3); BD.getj = make_fake(src, ["hockey/nhl"], [], {})
        sys.argv = ["b", "--leagues", "nhl", "--no-matchups", "--no-props", "--no-adv", "--no-weather", "--no-search"]
        try: BD.main()
        finally: sys.argv = argv
        check(load(out3 / "nhl" / "index.json")["games"] == [], "fallback off: 403 -> empty (previous behaviour)")

        # --- odds cache guard: a 0-match pull never wipes the previous lines; an error keeps the last pull
        lg = {"key": "nhl"}
        cache = {"leagues": {"nhl": {"pulledAt": "2026-10-27T04:45:00Z", "matched": 6, "games": {"403": {"lines": {}}}}}}
        msg = BD.odds_cache_put(lg, cache, {"pulledAt": "2026-10-27T05:15:00Z", "events": 7, "matched": 0, "games": {}}, "pulled 7 events, 0 matched")
        check(cache["leagues"]["nhl"]["matched"] == 6 and "kept the previous pull" in msg, "odds: 0-match pull keeps the previous entry")
        msg = BD.odds_cache_put(lg, cache, None, "error: HTTP Error 500")
        check(cache["leagues"]["nhl"]["pulledAt"] == "2026-10-27T04:45:00Z" and "last persisted pull" in msg, "odds: pull error keeps the last pull")
        BD.odds_cache_put(lg, cache, {"pulledAt": "2026-10-27T05:45:00Z", "events": 7, "matched": 7, "games": {}}, "ok")
        check(cache["leagues"]["nhl"]["matched"] == 7, "odds: a good pull replaces the entry")
        c2 = {"leagues": {"nhl": {"pulledAt": "x", "matched": 0, "games": {}}}}
        BD.odds_cache_put(lg, c2, {"pulledAt": "y", "events": 0, "matched": 0, "games": {}}, "ok")
        check(c2["leagues"]["nhl"]["pulledAt"] == "y", "odds: an empty pull (no events) still replaces an empty entry")

        # --- unit: suspicious_empty thresholds
        one = {"generated": NOW.isoformat(), "games": [game(1, H(5), bos, tor)]}
        check(LG.suspicious_empty(one, NOW, 10) == 0, "one upcoming game is not enough to call an empty feed suspicious")
        check(LG.suspicious_empty({"generated": NOW.isoformat(), "games": [game(1, H(5), bos, tor), game(2, H(9), bos, tor)]}, NOW, 10) == 2, "two upcoming -> suspicious")
        check(LG.suspicious_empty({"generated": NOW.isoformat(), "games": [game(1, H(24 * 12), bos, tor), game(2, H(24 * 13), bos, tor)]}, NOW, 10) == 0,
              "games beyond the window don't count")
        check(LG.Source(None).get("x") is None and not LG.Source(""), "disabled source returns nothing")
        check(LG.Source(str(tmp / "nope")).index("nhl") is None, "missing source dir -> no fallback, no exception")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"lastgood_test: {passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
