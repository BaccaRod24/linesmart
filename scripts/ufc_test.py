#!/usr/bin/env python3
"""UFC builder tests (offline, ESPN fixtures in scripts/fixtures/ufc). Never calls the network or The Odds API.
   python3 scripts/ufc_test.py"""
import datetime as dt, json, os, re, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import ufc as UF, line_history as LH, weather as WX
FX = os.path.join(HERE, "fixtures", "ufc")
J = lambda n: json.load(open(os.path.join(FX, n + ".json")))
ok = fail = 0
def check(name, cond, info=""):
    global ok, fail
    if cond: ok += 1
    else: fail += 1; print("FAIL", name, info)

# ---------- pure helpers
check("rounds_of 5", UF.rounds_of("5 Rnd (5-5-5-5-5)") == 5)
check("rounds_of 3", UF.rounds_of("3 Rnd (5-5-5)") == 3)
check("elapsed KO R2 4:54", UF.elapsed_rounds(2, "4:54") == 1.98)
check("elapsed R3 2:30 = 2.5", UF.elapsed_rounds(3, "2:30") == 2.5)
check("decision goes the distance", UF.elapsed_rounds(3, "5:00", "Decision", 3) == 3.0)
check("elapsed missing clock", UF.elapsed_rounds(1, None) is None)
now = dt.datetime(2026, 10, 26, 15, 0, tzinfo=dt.timezone.utc)
cal = J("sb_next")["leagues"][0]["calendar"]
picks = UF.pick_events(cal, now)
ids = [p[0] for p in picks]
check("pick 2 recent + 4 upcoming", len(picks) == 6, ids)
check("recent includes UFC 333", "600061267" in ids[:2], ids)
check("next card is Moicano vs Nolan", ids[2] == "600061420", ids)
check("picks: past before upcoming, chronological", [p[2] for p in picks] == sorted(p[2] for p in picks))

# odds mapped by athlete id (ESPN's home/away athlete odds don't follow the card's corners)
od = J("odds_next")["items"][0]
o = UF.parse_odds(od, "3028863", "5144007")
check("odds provider", o and o["provider"] == "DraftKings", o)
check("odds Moicano open +102", o["awayMLOpen"] == 102, o)
check("odds Nolan open -122", o["homeMLOpen"] == -122, o)
check("odds total rounds 1.5", o["total"] == 1.5 and o["overOdds"] == -210 and o["underOdds"] == 160, o)
o2 = UF.parse_odds(od, "5144007", "3028863")
check("odds swap corners", o2["awayMLOpen"] == -122 and o2["homeMLOpen"] == 102)
check("odds unknown fighters -> None", UF.parse_odds(od, "1", "2") is None)
check("odds none", UF.parse_odds(None, "1", "2") is None)

# results
st = J("st_post")
r = UF.parse_result(st, dict(winner=True), dict(winner=False), 5)
check("result winner away", r["winner"] == "away" and r["outcome"] == "win", r)
check("result method", r["method"] == "KO/TKO" and r["detail"] == "Punches", r)
check("result round/clock", r["round"] == 2 and r["clock"] == "4:54" and r["rounds"] == 1.98, r)
check("pre status -> no result", UF.parse_result(J("st_pre"), {}, {}, 3) is None)
dr = dict(st, result=dict(displayName="Draw", description="Majority"))
check("draw outcome", UF.parse_result(dr, {}, {}, 3)["outcome"] == "draw")
nc = dict(st, result=dict(displayName="No Contest", description="Overturned"))
check("no contest outcome", UF.parse_result(nc, {}, {}, 3)["outcome"] == "nc")

# ---------- full build against fixtures (fake ESPN)
calls = []
SBN, SBP, EVN, EVP = J("sb_next"), J("sb_past"), J("ev_next"), J("ev_past")
SB_ALL = dict(SBN, events=SBN["events"] + SBP["events"])
PAST_COMPS = {c["id"]: c for c in EVP["competitions"]}
# the eventlog's earlier fights (other events): synthetic competitions, alternating W / L for the logged fighter
ELOG = {re.search(r"/competitions/(\d+)", i["competition"]["$ref"]).group(1): (re.search(r"/events/(\d+)", i["event"]["$ref"]).group(1), n)
        for n, i in enumerate(J("elog")["events"]["items"]) if i.get("played")}
def elog_comp(cid):
    eid, n = ELOG[cid]
    return {"$ref": f"http://x/events/{eid}/competitions/{cid}", "id": cid, "date": f"2026-0{9 - min(n, 8)}-01T00:00Z", "type": {"text": "Lightweight"},
            "competitors": [{"id": "3028863", "winner": n % 2 == 0}, {"id": str(9000 + n), "winner": n % 2 == 1}]}
def fake(url):
    calls.append(url)
    assert "the-odds-api" not in url, "Odds API must not be called"
    if "/scoreboard" in url: return SB_ALL if "dates=" in url else SBN
    m = re.search(r"/events/(\d+)(?:/competitions/(\d+)(/status|/odds)?)?\?", url)
    if "/eventlog" in url: return J("elog")
    if re.search(r"/athletes/(\d+)\?", url): return dict(displayName="Fighter " + re.search(r"/athletes/(\d+)\?", url).group(1))
    if not m: raise RuntimeError("unexpected " + url)
    eid, cid, sub = m.groups()
    if cid in ELOG and eid != "600061420": return J("st_post") if sub == "/status" else elog_comp(cid)
    if eid not in ("600061420", "600061267"): raise RuntimeError("404 " + eid)
    if not cid: return EVN if eid == "600061420" else EVP
    if sub == "/status":
        if eid == "600061420": return J("st_pre")
        return J("st_post") if cid == "401911632" else J("st_post2")
    if sub == "/odds": return J("odds_next") if cid == "401921310" else dict(items=[])
    if cid in PAST_COMPS: return PAST_COMPS[cid]
    raise RuntimeError("404 competition " + cid)
tmp = tempfile.mkdtemp(prefix="ufc_test_")
out, sdir, hdir, cdir = (os.path.join(tmp, x) for x in ("data", "data/search", "hist", "cache"))
lg = dict(key="ufc", name="UFC", full="UFC (Mixed Martial Arts)", path="mma/ufc", params="", kind="mma", odds_key="mma_mixed_martial_arts", odds_markets="h2h", odds_cost=1)
pulled = []
rep = UF.build_ufc(lg, fake, out, sdir, LH, pull=None, odds_pull=lambda *a: pulled.append(a), hist_dir=hdir, cache_dir=cdir, log=lambda *a: None, now=now,
                   odds_off_reason="off (flag)")
check("odds api off -> never pulled", not pulled and rep["oddsApi"] == "off (flag)", rep.get("oddsApi"))
check("no odds api urls", not any("odds-api" in u for u in calls))
idx = json.load(open(os.path.join(out, "ufc", "index.json")))
check("2 events built (4 others 404 gracefully)", len(idx["events"]) == 2, [e["name"] for e in idx["events"]])
check("event errors reported", len(rep["endpoints"].get("eventErrors", [])) == 4, rep["endpoints"].get("eventErrors"))
check("27 bouts", len(idx["games"]) == 27, len(idx["games"]))
G = {g["id"]: g for g in idx["games"]}
nx = next(e for e in idx["events"] if e["id"] == "600061420")
check("next card segments", [s["key"] for s in nx["segments"]] == ["main", "prelims1"], nx["segments"])
check("main event first", nx["bouts"][0] == "401921310" and G["401921310"]["mainEvent"], nx["bouts"][:2])
check("bout order by matchNo", [G[b]["matchNo"] for b in nx["bouts"]] == sorted(G[b]["matchNo"] for b in nx["bouts"]))
g = G["401921310"]
check("corners: order 1 = away (Moicano)", g["away"]["id"] == "3028863" and g["home"]["id"] == "5144007")
check("fighter names/records", g["away"]["name"] == "Renato Moicano" and re.match(r"\d+-\d+-\d+", g["away"]["record"] or ""), g["away"])
check("flag", (g["away"]["logo"] or "").endswith(".png") and g["away"]["country"], g["away"])
check("weight class / rounds", g["weightClass"] == "Lightweight" and g["rounds"] == 5, (g["weightClass"], g["rounds"]))
check("game odds + DK book", g["odds"]["awayMLOpen"] == 102 and g["books"]["draftkings"]["total"] == 1.5)
check("no weather on bouts", all("weather" not in x for x in idx["games"]))
check("indoor", all(x["indoor"] for x in idx["games"]))
pe = next(e for e in idx["events"] if e["id"] == "600061267")
check("UFC 333 segments incl. early prelims", [s["key"] for s in pe["segments"]] == ["main", "prelims1", "prelims2"], pe["segments"])
check("UFC 333 is post", pe["state"] == "post")
m = G["401911632"]
check("past bout result", m["state"] == "post" and m["result"]["method"] == "KO/TKO" and m["result"]["round"] == 2, m.get("result"))
check("past bout scores 1/0 for grading", m["away"]["score"] == 1 and m["home"]["score"] == 0, (m["away"].get("score"), m["home"].get("score")))
check("past bout rounds elapsed", m["result"]["rounds"] == 1.98)
check("title / main event flag", m["mainEvent"])
gd = json.load(open(os.path.join(out, "ufc", "games", "401921310.json")))
check("game file shape", gd["league"] == "ufc" and gd["game"]["id"] == "401921310" and gd["hasSummary"] is False and gd["event"]["id"] == "600061420")
check("line history recorded", os.path.exists(os.path.join(hdir, "ufc.json")) and gd["history"], rep.get("history"))
fj = json.load(open(os.path.join(out, "ufc", "fighters.json")))["fighters"]
check("fighters index", "3028863" in fj and fj["3028863"]["bouts"] == ["401921310"], fj.get("3028863"))
h = fj["3028863"].get("hist") or []
check("fighter form from eventlog", 1 <= len(h) <= 5 and all(x["res"] in ("W", "L", "D", "NC") for x in h), h[:2])
check("form W/L from winners", [x["res"] for x in h][:2] in (["W", "L"], ["L", "W"]), [x["res"] for x in h])
check("form opponent names", all(x["opp"] for x in h), h[:1])
check("form method from status", h and h[0]["method"] == "KO/TKO", h[:1])
check("form newest first", [x["date"] for x in h] == sorted((x["date"] for x in h), reverse=True))
check("form string on bout", isinstance(g["away"].get("form"), str))
check("fight cache saved", os.path.exists(os.path.join(cdir, UF.CACHE_FILE)))
n1 = len(calls); calls.clear()
UF.build_ufc(lg, fake, out, sdir, LH, hist_dir=hdir, cache_dir=cdir, log=lambda *a: None, now=now)
check("second run reuses cached fights", not any(re.search(r"/competitions/\d+\?", u) and "/events/600061267/" in u and "status" not in u for u in calls if "eventlog" not in u) or len(calls) < n1, (len(calls), n1))
sd = json.load(open(os.path.join(sdir, "ufc.json")))
check("search doc", sd["kind"] == "mma" and len(sd["players"]) >= 50 and sd["hs"].startswith("https://a.espncdn.com/i/headshots/mma"), (len(sd["players"]),))
check("search players unique", len({p[0] for p in sd["players"]}) == len(sd["players"]))
check("fight props reported as unavailable", "none" in rep["fightProps"])
check("report counts", rep["games"] == 27 and rep["withOdds"] >= 1 and rep["providers"] == ["DraftKings"], rep)

# ---------- weather / build_data wiring
wr = WX.attach(lg, [dict(g)], fetch=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no weather fetch for mma")))
check("weather skips mma", wr.get("skipped") == "mma")
os.environ.pop("ODDS_MMA", None)
import importlib, build_data as BD; importlib.reload(BD)
L = {l["key"]: l for l in BD.LEAGUES}
check("ufc league registered", "ufc" in L and L["ufc"]["kind"] == "mma" and L["ufc"]["path"] == "mma/ufc")
check("ufc odds: h2h only, 1 credit", L["ufc"]["odds_markets"] == "h2h" and L["ufc"]["odds_cost"] == 1)
check("ODDS_MMA off by default", BD.ODDS_MMA is False)
check("other leagues keep 3-market pull", all(l.get("odds_cost", BD.ODDS_COST) == 3 for l in BD.LEAGUES if l["key"] != "ufc"))
# Hard Rock (The Odds API) matching for MMA, against a fake API response: swapped corners, accents, card-level start time
ng = [x for x in idx["games"] if x["state"] == "pre"]
t0 = min(x["date"] for x in ng)
fold = lambda n: n.replace("é", "e").replace("á", "a")
def fake_odds(ev_list):
    def _get(url):
        assert "markets=h2h&" in url and "mma_mixed_martial_arts" in url, url
        return ev_list, {"x-requests-remaining": "470", "x-requests-last": "1"}
    return _get
evs = []
for i, x in enumerate(ng):
    h, a = (x["away"], x["home"]) if i % 2 else (x["home"], x["away"])   # every other bout listed the other way round
    evs.append(dict(id=f"e{i}", commence_time=t0, home_team=fold(h["name"]), away_team=fold(a["name"]), bookmakers=[dict(key="hardrockbet", last_update=t0,
                markets=[dict(key="h2h", outcomes=[dict(name=fold(h["name"]), price=-150 - i), dict(name=fold(a["name"]), price=130 + i)])])]))
evs.append(dict(id="pfl", commence_time=t0, home_team="Someone Else", away_team="Nobody Known", bookmakers=[dict(key="hardrockbet", markets=[])]))
BD.get = fake_odds(evs)
pull = dict(key="k", remaining=470, spent=0, pulled=[], skipped=[], errors=[])
entry, msg = BD.odds_pull_league(L["ufc"], ng, pull, "2026-10-26T15:30:00Z")
check("hard rock: every listed bout matched", entry and entry["matched"] == len(ng) and entry["unmatched"] == 1, msg)
check("hard rock: 1 credit spent", pull["spent"] == 1 and pull["remaining"] == 470, pull)
ok_sides = all(entry["games"][x["id"]]["line"][("away" if i % 2 else "home") + "ML"] == -150 - i and entry["games"][x["id"]]["line"][("home" if i % 2 else "away") + "ML"] == 130 + i for i, x in enumerate(ng))
check("hard rock: prices land on the right fighter (swapped corners too)", ok_sides)
import matchups as MU, props as PR
check("matchups / props skip ufc", "ufc" not in MU.SUPPORTED and "ufc" not in PR.SUPPORTED)

print(f"ufc_test: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
