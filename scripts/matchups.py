"""Opponent defense vs position (build time) -> site/data/matchups/<lg>.json

For every completed regular-season game this season we read ESPN's box score (site.api summary) and credit each
offensive player's line to the *defending* team, bucketed by position. Per team we then average per game and rank
the league (rank 1 = the toughest defense for that stat: fewest allowed, or most interceptions forced).

  NFL: QB/RB/WR/TE pass yds, pass TD, INT, rush yds/TD, receptions, rec yds/TD, targets allowed + team points/yards allowed
  NBA: G/F/C points, rebounds, assists, 3PM allowed + opp PPG, opp FG%, defensive rating (pts per 100 poss) and pace

NFL box scores carry no positions, so positions come from the search index rosters (data/search/<lg>.json); a player
not on any current roster falls back to his box-score category (passing -> QB, receiving -> WR, rushing -> RB).
NBA box scores list G/F/C for every player, which is used as-is.

Completed games never change, so each game's compact box line is cached in --matchup-cache-dir (the data-history branch
in CI) and only new games are fetched. Without a cache dir every game is fetched each run (fine locally; ~120 NFL /
~1,230 NBA games by season end). MAX_NEW caps the summaries fetched per run so a cold cache can't blow up build time.
"""
import concurrent.futures as cf, datetime as dt, json, os

SUPPORTED = ("nfl", "nba")
MAX_NEW = 400
LAST_GAMES = {}   # league -> this run's compact games dict (reused by scripts/props.py for prop hit history)
LAST_EVENTS = {}  # league -> this run's completed regular-season events {eid: {date, home, away, hs, as}} (reused by ats.py)
NBA_ROW_LEN = 10  # NBA player rows: [pid, pos, pts, reb, ast, 3pm, min, fga, fta, tov]; older cached rows (6) are refetched

# key, label, rank direction ("low": rank 1 = lowest value). Per league: position buckets and team-level stats.
NFL_POS = {
    "QB": [("py", "Pass yds"), ("ptd", "Pass TD"), ("int", "INT"), ("ry", "Rush yds")],
    "RB": [("ry", "Rush yds"), ("rtd", "Rush TD"), ("rec", "Rec"), ("recy", "Rec yds")],
    "WR": [("rec", "Rec"), ("recy", "Rec yds"), ("rectd", "Rec TD"), ("tgt", "Targets")],
    "TE": [("rec", "Rec"), ("recy", "Rec yds"), ("rectd", "Rec TD"), ("tgt", "Targets")],
}
NFL_TEAM = [("pts", "Points"), ("py", "Pass yds"), ("ry", "Rush yds"), ("yds", "Total yds")]
NBA_POS = {
    "G": [("pts", "Pts"), ("reb", "Reb"), ("ast", "Ast"), ("tpm", "3PM")],
    "F": [("pts", "Pts"), ("reb", "Reb"), ("ast", "Ast"), ("tpm", "3PM")],
    "C": [("pts", "Pts"), ("reb", "Reb"), ("ast", "Ast"), ("tpm", "3PM")],
}
NBA_TEAM = [("pts", "Opp PPG"), ("fgp", "Opp FG%"), ("drtg", "Def rating"), ("pace", "Pace (est.)")]
NBA_POSMAP = {"PG": "G", "SG": "G", "G": "G", "SF": "F", "PF": "F", "F": "F", "C": "C", "FC": "F", "GF": "G"}
NFL_POSMAP = {"QB": "QB", "RB": "RB", "FB": "RB", "HB": "RB", "WR": "WR", "TE": "TE"}

def _now(): return dt.datetime.now(dt.timezone.utc)

def _n(v):
    try: return float(str(v).replace(",", ""))
    except (TypeError, ValueError): return 0.0

def _pair(v):
    """'7/13' or '4-11' -> (7.0, 13.0)"""
    s = str(v or "").replace("/", "-").split("-")
    return (_n(s[0]), _n(s[1])) if len(s) == 2 else (0.0, 0.0)

def _load(path):
    try:
        with open(path) as fh: return json.load(fh)
    except Exception: return None

# ---------------------------------------------------------------- box score -> compact per-game record
def compact_nfl(m):
    """{teamId: {pid: {stat: value, "_c": [categories]}}} for the offense of each team."""
    out = {}
    for t in (m.get("boxscore") or {}).get("players") or []:
        tid = str((t.get("team") or {}).get("id") or "")
        if not tid: continue
        P = out.setdefault(tid, {})
        for c in t.get("statistics") or []:
            name, keys = c.get("name"), c.get("keys") or []
            if name not in ("passing", "rushing", "receiving"): continue
            for a in c.get("athletes") or []:
                pid = str((a.get("athlete") or {}).get("id") or ""); st = a.get("stats") or []
                if not pid or not st: continue
                v = dict(zip(keys, st)); p = P.setdefault(pid, {})
                p.setdefault("_c", []).append(name[:4])
                if name == "passing":
                    p["py"] = _n(v.get("passingYards")); p["ptd"] = _n(v.get("passingTouchdowns")); p["int"] = _n(v.get("interceptions"))
                    p["cmp"], p["att"] = _pair(v.get("completions/passingAttempts"))
                elif name == "rushing":
                    p["ry"] = _n(v.get("rushingYards")); p["rtd"] = _n(v.get("rushingTouchdowns")); p["car"] = _n(v.get("rushingAttempts"))
                else:
                    p["rec"] = _n(v.get("receptions")); p["recy"] = _n(v.get("receivingYards")); p["rectd"] = _n(v.get("receivingTouchdowns")); p["tgt"] = _n(v.get("receivingTargets"))
    return out

def compact_nba(m):
    """{teamId: {"p": [[pid, pos, pts, reb, ast, 3pm, min, fga, fta, tov]], "t": [fgm, fga, fta, oreb, tov]}}
    (min/fga/fta/tov feed the player usage-rate trends in scripts/adv_nba.py)"""
    out = {}
    box = m.get("boxscore") or {}
    for t in box.get("players") or []:
        tid = str((t.get("team") or {}).get("id") or "")
        if not tid: continue
        rows = []
        for c in (t.get("statistics") or [])[:1]:
            keys = c.get("keys") or []
            for a in c.get("athletes") or []:
                ath = a.get("athlete") or {}; st = a.get("stats") or []
                if a.get("didNotPlay") or not st or not ath.get("id"): continue
                v = dict(zip(keys, st))
                rows.append([str(ath["id"]), (ath.get("position") or {}).get("abbreviation") or "", _n(v.get("points")), _n(v.get("rebounds")),
                             _n(v.get("assists")), _pair(v.get("threePointFieldGoalsMade-threePointFieldGoalsAttempted"))[0],
                             _n(v.get("minutes")), _pair(v.get("fieldGoalsMade-fieldGoalsAttempted"))[1],
                             _pair(v.get("freeThrowsMade-freeThrowsAttempted"))[1], _n(v.get("turnovers"))])
        out.setdefault(tid, {})["p"] = rows
    for t in box.get("teams") or []:
        tid = str((t.get("team") or {}).get("id") or "")
        s = {x.get("name"): x.get("displayValue") for x in t.get("statistics") or []}
        fgm, fga = _pair(s.get("fieldGoalsMade-fieldGoalsAttempted")); _, fta = _pair(s.get("freeThrowsMade-freeThrowsAttempted"))
        tov = _n(s.get("totalTurnovers") if s.get("totalTurnovers") not in (None, "") else s.get("turnovers"))
        out.setdefault(tid, {})["t"] = [fgm, fga, fta, _n(s.get("offensiveRebounds")), tov]
    return out

def compact_game(lg_key, m, ev):
    hdr = ((m.get("header") or {}).get("competitions") or [{}])[0]
    per = ((hdr.get("status") or {}).get("period")) or 0
    rec = dict(d=ev["date"], h=ev["home"], a=ev["away"], s={ev["home"]: ev["hs"], ev["away"]: ev["as"]}, per=per)
    rec["b"] = compact_nfl(m) if lg_key == "nfl" else compact_nba(m)
    return rec

# ---------------------------------------------------------------- aggregate
def _nfl_bucket(pos, p):
    b = NFL_POSMAP.get((pos or "").upper())
    if b: return b
    if pos: return None                         # a known non-skill position (K, P, LB on a fake…) isn't counted
    c = p.get("_c") or []
    return "QB" if "pass" in c and p.get("att", 0) >= 5 else "WR" if "rece" in c else "RB" if "rush" in c else None

def aggregate(lg_key, games, posmap):
    """games: {eid: compact record}. posmap: pid -> roster position. Returns {defTeamId: {gp, team:{k:v}, pos:{P:{k:v}}}} (per-game averages)."""
    POS, TEAM = (NFL_POS, NFL_TEAM) if lg_key == "nfl" else (NBA_POS, NBA_TEAM)
    acc = {}
    for g in games.values():
        b = g.get("b") or {}
        for off, de in ((g["h"], g["a"]), (g["a"], g["h"])):
            if off not in b or de not in b: continue
            A = acc.setdefault(de, dict(gp=0, team={}, pos={k: {} for k in POS}, _poss=0.0, _min=0.0, _fgm=0.0, _fga=0.0))
            A["gp"] += 1
            T = A["team"]; T["pts"] = T.get("pts", 0) + _n((g.get("s") or {}).get(off))
            if lg_key == "nfl":
                for pid, p in b[off].items():
                    T["py"] = T.get("py", 0) + p.get("py", 0); T["ry"] = T.get("ry", 0) + p.get("ry", 0)
                    bk = _nfl_bucket(posmap.get(pid), p)
                    if not bk: continue
                    D = A["pos"][bk]
                    for k, _ in POS[bk]: D[k] = D.get(k, 0) + p.get(k, 0)
            else:
                for row in b[off].get("p") or []:
                    pid, pos, pts, reb, ast, tpm = row[:6]
                    bk = NBA_POSMAP.get((pos or posmap.get(pid) or "").upper())
                    if not bk: continue
                    D = A["pos"][bk]
                    for k, v in (("pts", pts), ("reb", reb), ("ast", ast), ("tpm", tpm)): D[k] = D.get(k, 0) + v
                to, td = b[off].get("t"), b[de].get("t")
                if to and td:
                    poss = lambda x: x[1] - x[3] + x[4] + 0.44 * x[2]       # FGA - OREB + TOV + 0.44*FTA
                    A["_poss"] += (poss(to) + poss(td)) / 2
                    A["_min"] += 48 + 5 * max(0, (g.get("per") or 4) - 4)
                    A["_fgm"] += to[0]; A["_fga"] += to[1]
    out = {}
    for tid, A in acc.items():
        gp = A["gp"]
        if not gp: continue
        team = {k: round(v / gp, 1) for k, v in A["team"].items()}
        if lg_key == "nfl":
            team["yds"] = round(team.get("py", 0) + team.get("ry", 0), 1)
        else:
            if A["_poss"]:
                team["drtg"] = round(100 * A["team"]["pts"] / A["_poss"], 1)
                team["pace"] = round(48 * A["_poss"] / A["_min"], 1)
            if A["_fga"]: team["fgp"] = round(100 * A["_fgm"] / A["_fga"], 1)
        pos = {P: {k: round(D.get(k, 0) / gp, 1) for k, _ in POS[P]} for P, D in A["pos"].items()}
        out[tid] = dict(gp=gp, team=team, pos=pos)
    return out

HIGH_IS_TOUGH = {"int"}   # defense stats where MORE allowed/forced means a tougher defense (interceptions)

def rank(agg):
    """Replace each value v with [v, rank] where rank 1 = toughest defense: lowest value allowed, except HIGH_IS_TOUGH
    keys where rank 1 = highest (ties share the better rank). Pace: rank 1 = slowest."""
    def rk(getter, setter, k=None):
        vals = [(tid, getter(t)) for tid, t in agg.items() if getter(t) is not None]
        srt = sorted((v for _, v in vals), reverse=k in HIGH_IS_TOUGH)
        for tid, v in vals: setter(agg[tid], [v, srt.index(v) + 1])
    if not agg: return agg
    any_t = next(iter(agg.values()))
    for k in list(any_t["team"].keys()):
        rk(lambda t, k=k: t["team"].get(k), lambda t, v, k=k: t["team"].__setitem__(k, v), k)
    for P, D in any_t["pos"].items():
        for k in list(D.keys()):
            rk(lambda t, P=P, k=k: t["pos"].get(P, {}).get(k), lambda t, v, P=P, k=k: t["pos"][P].__setitem__(k, v), k)
    return agg

# ---------------------------------------------------------------- build
def _completed_events(getj, site, lg, team_ids):
    evs, season = {}, None
    def one(tid):
        return getj(f"{site}{lg['path']}/teams/{tid}/schedule")
    with cf.ThreadPoolExecutor(12) as ex:
        for f in cf.as_completed([ex.submit(one, t) for t in team_ids]):
            try: d = f.result()
            except Exception: continue
            season = season or (d.get("requestedSeason") or d.get("season") or {}).get("year")
            for e in d.get("events") or []:
                c = (e.get("competitions") or [{}])[0]
                if not ((c.get("status") or {}).get("type") or {}).get("completed"): continue
                if str((e.get("seasonType") or {}).get("type") or (e.get("seasonType") or {}).get("id")) != "2": continue
                cs = c.get("competitors") or []
                h = next((x for x in cs if x.get("homeAway") == "home"), None); a = next((x for x in cs if x.get("homeAway") == "away"), None)
                if not h or not a: continue
                sc = lambda x: (x.get("score") or {}).get("value") if isinstance(x.get("score"), dict) else x.get("score")
                evs[str(e["id"])] = dict(date=e.get("date"), home=str(h.get("id") or h["team"]["id"]), away=str(a.get("id") or a["team"]["id"]), hs=sc(h), as_=sc(a))
    for v in evs.values(): v["as"] = v.pop("as_")
    return evs, season

def build_matchups(lg, getj, site, out_dir, search_dir, cache_dir=None, snap_dir=None, log=print, teams_list=None):
    key = lg["key"]; t0 = _now()
    if key not in SUPPORTED: return None
    rep = dict(league=key)
    teams = teams_list(getj, site, lg) if teams_list else []
    tids = [str(t["id"]) for t in teams]
    evs, season = _completed_events(getj, site, lg, tids)
    cpath = os.path.join(cache_dir, f"{key}.json") if cache_dir else None
    cached = (_load(cpath) if cpath else None) or {}
    games = dict(cached.get("games") or {}) if cached.get("season") == season else {}
    games = {k: v for k, v in games.items() if k in evs}                    # prune games no longer on the schedule
    if key == "nba":                                                        # refetch box scores cached before minutes/FGA/FTA/TOV were kept
        games = {k: v for k, v in games.items() if all(len(r) >= NBA_ROW_LEN for t in (v.get("b") or {}).values() for r in t.get("p") or [])}
    LAST_EVENTS[key] = evs
    need = [k for k in sorted(evs, key=lambda k: evs[k]["date"] or "", reverse=True) if k not in games][:MAX_NEW]
    ok = fail = 0
    with cf.ThreadPoolExecutor(12) as ex:
        futs = {ex.submit(getj, f"{site}{lg['path']}/summary?event={eid}"): eid for eid in need}
        for f in cf.as_completed(futs):
            eid = futs[f]
            try: games[eid] = compact_game(key, f.result(), evs[eid]); ok += 1
            except Exception: fail += 1
    LAST_GAMES[key] = games
    rep["boxScores"] = f"{len(games)} games ({len(games) - ok} cached, {ok} fetched" + (f", {fail} failed" if fail else "") + ")"
    if cpath and ok:
        blob = dict(league=key, season=season, updated=t0.isoformat(), games=games)
        os.makedirs(cache_dir, exist_ok=True)
        with open(cpath, "w") as fh: json.dump(blob, fh, separators=(",", ":"))
        if snap_dir:
            os.makedirs(os.path.join(snap_dir, "_matchups"), exist_ok=True)
            with open(os.path.join(snap_dir, "_matchups", f"{key}.json"), "w") as fh: json.dump(blob, fh, separators=(",", ":"))
    # positions: from the search index (rosters)
    posmap = {}
    si = _load(os.path.join(search_dir, f"{key}.json")) if search_dir else None
    for p in (si or {}).get("players") or []: posmap[str(p[0])] = p[3]
    rep["positions"] = f"{len(posmap)} roster positions" if posmap else "no search index (box-score categories only)"
    agg = rank(aggregate(key, games, posmap))
    POS, TEAM = (NFL_POS, NFL_TEAM) if key == "nfl" else (NBA_POS, NBA_TEAM)
    doc = dict(v=1, lg=key, season=season, gen=t0.isoformat(), games=len(games), nTeams=len(agg),
               posStats={P: [list(x) for x in v] for P, v in POS.items()}, teamStats=[list(x) for x in TEAM],
               rankNote="rank 1 = toughest: fewest allowed (most INTs forced); for pace, 1 = slowest", teams=agg)
    os.makedirs(out_dir, exist_ok=True)
    raw = json.dumps(doc, separators=(",", ":"))
    with open(os.path.join(out_dir, f"{key}.json"), "w") as fh: fh.write(raw)
    rep.update(games=len(games), teams=len(agg), bytes=len(raw.encode()), seconds=round((_now() - t0).total_seconds(), 1))
    log(f"[{key}] matchups: {rep['boxScores']}, teams={len(agg)} size={len(raw.encode()) // 1024}KB ({rep['seconds']}s)")
    return rep
