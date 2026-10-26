"""NFL efficiency + usage from nflverse (stdlib only).

Source: nflverse-data GitHub releases (https://github.com/nflverse/nflverse-data), data licensed CC-BY 4.0; EPA / success /
CPOE are the nflfastR model outputs (MIT-licensed code). Snap counts in nflverse originate from Pro Football Reference
(credited in docs/advanced_stats.md). Downloaded at most once every REFRESH_HOURS (default 20 h, so about daily) and only the
aggregated result is cached (<adv cache>/nfl_nflverse.json), not the raw files.

Definitions (regular + postseason plays of the current season):
  plays          pass == 1 or rush == 1, with a non-missing EPA (nflfastR convention; includes scrambles and sacks)
  EPA/play       mean EPA of those plays; split by pass / rush too.  Defence = the same plays from the defteam side.
  success rate   share of those plays with EPA > 0 (nflfastR `success`)
  red-zone TD %  drives (game_id, fixed_drive) with any snap at yardline_100 <= 20 that end in a touchdown (fixed_drive_result)
  3rd-down conv  third_down_converted / (third_down_converted + third_down_failed)
  QB EPA/play    mean qb_epa on qb_dropback == 1 plays grouped by the player (`id`), CPOE = mean cpoe on his pass attempts.
                 Ranked among QBs with >= QB_MIN_DROPBACKS dropbacks.
  usage          target share = player targets / team targets, carries share = designed runs (no scrambles / 2-pt),
                 snap share = offense_pct, red-zone touches = carries + receptions at yardline_100 <= 20, per game.
                 Season = all the player's games; last 3 = his 3 most recent games.
"""
import csv, datetime as dt, gzip, io, json, os, urllib.request

REL = "https://github.com/nflverse/nflverse-data/releases/download"
URLS = dict(pbp=REL + "/pbp/play_by_play_{season}.csv.gz", games=REL + "/schedules/games.csv",
            snaps=REL + "/snap_counts/snap_counts_{season}.csv.gz", players=REL + "/players/players.csv")
REFRESH_HOURS = float(os.environ.get("ADV_NFL_REFRESH_HOURS", "20"))
QB_MIN_DROPBACKS = 100
ABBR_TO_ESPN = {"LA": "LAR", "WAS": "WSH"}          # nflverse -> ESPN abbreviations (the rest match)
TREND = dict(share=0.03, snap=0.05, rz=0.5)         # last-3 vs season gaps that earn an up/down arrow (see docs)

def _f(v):
    if v in (None, "", "NA"): return None
    try: return float(v)
    except ValueError: return None

def _fetch(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 LineSmart/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r: b = r.read()
    if b[:2] == b"\x1f\x8b": b = gzip.decompress(b)
    return b.decode("utf-8")

def _rows(text): return csv.DictReader(io.StringIO(text))

# ---------------------------------------------------------------- aggregation (pure; tested in adv_test.py)
def aggregate_pbp(rows):
    """rows: iterable of pbp dicts. Returns (teams, qbs, usage) with raw sums (see finish_* for rates)."""
    T, Q, U, drives = {}, {}, {}, {}
    team_g = {}                                       # (game, team) -> {tgt, car}
    def t(k): return T.setdefault(k, dict(o=[0, 0.0, 0, 0, 0.0, 0, 0.0], d=[0, 0.0, 0, 0, 0.0, 0, 0.0], o3=[0, 0], d3=[0, 0]))
    for r in rows:
        pos, de, gid = r.get("posteam"), r.get("defteam"), r.get("game_id")
        if not pos or not de or pos == "NA": continue
        wk = int(_f(r.get("week")) or 0)
        ps, ru, epa = _f(r.get("pass")) == 1, _f(r.get("rush")) == 1, _f(r.get("epa"))
        yl = _f(r.get("yardline_100"))
        if ps or ru:
            if epa is not None:
                suc = 1 if (_f(r.get("success")) or 0) >= 1 else 0
                for side, team in (("o", pos), ("d", de)):
                    A = t(team)[side]                 # [plays, epa, success, passPlays, passEpa, rushPlays, rushEpa]
                    A[0] += 1; A[1] += epa; A[2] += suc
                    if ps: A[3] += 1; A[4] += epa
                    else: A[5] += 1; A[6] += epa
        c3, f3 = _f(r.get("third_down_converted")) or 0, _f(r.get("third_down_failed")) or 0
        if c3 or f3:
            t(pos)["o3"][0] += c3; t(pos)["o3"][1] += c3 + f3
            t(de)["d3"][0] += c3; t(de)["d3"][1] += c3 + f3
        fd = r.get("fixed_drive")
        if fd not in (None, "", "NA"):
            D = drives.setdefault((gid, fd, pos), dict(o=pos, d=de, rz=False, td=False))
            if yl is not None and yl <= 20 and r.get("down") not in (None, "", "NA"): D["rz"] = True
            if r.get("fixed_drive_result") == "Touchdown": D["td"] = True
        # QB
        if _f(r.get("qb_dropback")) == 1 and r.get("id") not in (None, "", "NA"):
            qe = _f(r.get("qb_epa"))
            if qe is not None:
                q = Q.setdefault(r["id"], dict(db=0, epa=0.0, cp=0.0, cpn=0, teams={}))
                q["db"] += 1; q["epa"] += qe; q["teams"][pos] = q["teams"].get(pos, 0) + 1
                cp = _f(r.get("cpoe"))
                if cp is not None: q["cp"] += cp; q["cpn"] += 1
        # usage
        if _f(r.get("two_point_attempt")) == 1: continue
        TG = team_g.setdefault((gid, pos), dict(tgt=0, car=0, wk=wk))
        rec, rus = r.get("receiver_player_id"), r.get("rusher_player_id")
        rz = yl is not None and yl <= 20
        def u(pid): return U.setdefault(pid, {}).setdefault(gid, dict(tm=pos, wk=wk, tgt=0, car=0, rz=0))
        if _f(r.get("pass_attempt")) == 1 and rec not in (None, "", "NA") and _f(r.get("sack")) != 1:
            TG["tgt"] += 1; x = u(rec); x["tgt"] += 1
            if rz and _f(r.get("complete_pass")) == 1: x["rz"] += 1
        if r.get("play_type") == "run" and _f(r.get("rush_attempt")) == 1 and rus not in (None, "", "NA") and _f(r.get("qb_scramble")) != 1:
            TG["car"] += 1; x = u(rus); x["car"] += 1
            if rz: x["rz"] += 1
    for D in drives.values():
        if D["rz"]:
            for side, team in (("orz", D["o"]), ("drz", D["d"])):
                a = t(team).setdefault(side, [0, 0]); a[1] += 1; a[0] += 1 if D["td"] else 0
    return T, Q, U, team_g

def _rk(vals, high_good=True):
    """{k: v} -> {k: rank} (1 = best; ties share the better rank)"""
    srt = sorted([v for v in vals.values() if v is not None], reverse=high_good)
    return {k: (srt.index(v) + 1 if v is not None else None) for k, v in vals.items()}

def finish_teams(T):
    out = {}
    for tm, A in T.items():
        o, d = A["o"], A["d"]
        rate = lambda a: round(a[0] / a[1], 3) if a and a[1] else None
        out[tm] = dict(
            off=dict(epa=round(o[1] / o[0], 3) if o[0] else None, sr=round(o[2] / o[0], 3) if o[0] else None,
                     pepa=round(o[4] / o[3], 3) if o[3] else None, repa=round(o[6] / o[5], 3) if o[5] else None,
                     rz=rate(A.get("orz")), td3=rate(A["o3"]), plays=o[0]),
            dfn=dict(epa=round(d[1] / d[0], 3) if d[0] else None, sr=round(d[2] / d[0], 3) if d[0] else None,
                     pepa=round(d[4] / d[3], 3) if d[3] else None, repa=round(d[6] / d[5], 3) if d[5] else None,
                     rz=rate(A.get("drz")), td3=rate(A["d3"]), plays=d[0]))
    for side, good in (("off", True), ("dfn", False)):
        for k in ("epa", "sr", "pepa", "repa", "rz", "td3"):
            r = _rk({tm: v[side][k] for tm, v in out.items()}, high_good=good)
            for tm in out: out[tm][side].setdefault("rk", {})[k] = r[tm]
    return out

def finish_qbs(Q):
    out = {}
    for pid, q in Q.items():
        out[pid] = dict(db=q["db"], epa=round(q["epa"] / q["db"], 3), cpoe=round(q["cp"] / q["cpn"], 1) if q["cpn"] else None,
                        tm=max(q["teams"], key=q["teams"].get))
    elig = {k: v for k, v in out.items() if v["db"] >= QB_MIN_DROPBACKS}
    for k in ("epa", "cpoe"):
        r = _rk({p: v[k] for p, v in elig.items()})
        for p in elig: out[p].setdefault("rk", {})[k] = r[p]
    for p in out: out[p]["qual"] = p in elig
    return out, len(elig)

def trend(season, last, kind="share"):
    """'up' / 'down' / 'flat' for last-3 vs season (absolute gap: 3 pp shares, 5 pp snaps, 0.5 red-zone touches per game)."""
    if season is None or last is None: return None
    g = last - season
    th = TREND[kind]
    return "up" if g >= th - 1e-9 else "down" if g <= -th + 1e-9 else "flat"

def finish_usage(U, team_g, snaps=None, n_last=3):
    """U: pid -> game -> counts; snaps: pid -> game -> (offense_pct, team). -> pid -> usage summary."""
    out = {}
    for pid in set(U) | set(snaps or {}):
        G = dict(U.get(pid) or {})
        S = (snaps or {}).get(pid) or {}
        for gid, (pct, tm, wk) in S.items():
            G.setdefault(gid, dict(tm=tm, wk=wk, tgt=0, car=0, rz=0))
        games = sorted(G.items(), key=lambda x: (x[1]["wk"], x[0]))
        if S: games = [x for x in games if x[0] in S and S[x[0]][0] > 0] or games
        if not games: continue
        def agg(gs):
            tt = sum((team_g.get((g, v["tm"])) or {}).get("tgt", 0) for g, v in gs)
            tc = sum((team_g.get((g, v["tm"])) or {}).get("car", 0) for g, v in gs)
            pt, pc, rz = sum(v["tgt"] for _, v in gs), sum(v["car"] for _, v in gs), sum(v["rz"] for _, v in gs)
            sn = [S[g][0] for g, _ in gs if g in S]
            return dict(tgt=round(pt / tt, 3) if tt else None, car=round(pc / tc, 3) if tc else None,
                        snap=round(sum(sn) / len(sn), 3) if sn else None, rz=round(rz / len(gs), 2), nt=pt, nc=pc)
        se, la = agg(games), agg(games[-n_last:])
        if se["nt"] + se["nc"] < 5 and (se["snap"] or 0) < 0.2: continue
        o = dict(g=len(games), tm=games[-1][1]["tm"], wk=games[-1][1]["wk"])
        for k, kind in (("tgt", "share"), ("car", "share"), ("snap", "snap"), ("rz", "rz")):
            if se[k] is None: continue
            o[k] = [se[k], la[k], trend(se[k], la[k], kind) if len(games) > n_last else None]
        out[pid] = o
    return out

# ---------------------------------------------------------------- build
def _load(p):
    try:
        with open(p) as fh: return json.load(fh)
    except Exception: return None

def compute(season, fetch=_fetch, log=print):
    """Download nflverse files for `season` and return the aggregated blob (nflverse ids; mapped to ESPN in to_espn)."""
    pbp = fetch(URLS["pbp"].format(season=season))
    T, Q, U, team_g = aggregate_pbp(_rows(pbp)); del pbp
    snaps = {}
    try:
        players = list(_rows(fetch(URLS["players"])))
    except Exception as e:
        log(f"  adv nfl: players.csv failed ({e})"); players = []
    pfr2g = {p["pfr_id"]: p["gsis_id"] for p in players if p.get("pfr_id") and p.get("gsis_id")}
    try:
        for r in _rows(fetch(URLS["snaps"].format(season=season))):
            g = pfr2g.get(r.get("pfr_player_id"))
            pct = _f(r.get("offense_pct"))
            if not g or pct is None or (_f(r.get("offense_snaps")) or 0) <= 0: continue
            snaps.setdefault(g, {})[r["game_id"]] = (pct, r.get("team"), int(_f(r.get("week")) or 0))
    except Exception as e:
        log(f"  adv nfl: snap counts failed ({e})")
    lines = {}
    try:
        for r in _rows(fetch(URLS["games"])):
            if str(r.get("season")) != str(season) or not r.get("espn"): continue
            hs, as_ = _f(r.get("home_score")), _f(r.get("away_score"))
            sl, tl = _f(r.get("spread_line")), _f(r.get("total_line"))
            if hs is None or as_ is None: continue                  # only finished games; our own close covers the rest
            lines[str(r["espn"]).split(".")[0]] = [(-sl if sl is not None else None), tl, hs, as_]
    except Exception as e:
        log(f"  adv nfl: schedules failed ({e})")
    teams = finish_teams(T)
    qbs, nq = finish_qbs(Q)
    usage = finish_usage(U, team_g, snaps)
    pmap = {p["gsis_id"]: [str(p["espn_id"]).split(".")[0], p.get("display_name") or "", p.get("position") or ""]
            for p in players if p.get("gsis_id") and p.get("espn_id") not in (None, "", "NA")}
    weeks = sorted({v["wk"] for v in team_g.values()})
    return dict(season=season, fetched=dt.datetime.now(dt.timezone.utc).isoformat(), weeks=weeks, teams=teams, qbs=qbs, qualQB=nq,
                usage=usage, pmap={k: v for k, v in pmap.items() if k in usage or k in qbs}, lines=lines)

def to_espn(blob, espn_teams):
    """Map nflverse team abbrs / gsis ids to ESPN ids. espn_teams: [[id, name, abbr, ...]] from the search index."""
    ab = {str(t[2]).upper(): str(t[0]) for t in espn_teams}
    tid = lambda a: ab.get(ABBR_TO_ESPN.get(a, a))
    pm = blob.get("pmap") or {}
    teams = {}
    for a, v in blob["teams"].items():
        if tid(a): teams[tid(a)] = dict(v, abbr=ABBR_TO_ESPN.get(a, a))
    qbs = {}
    for g, q in blob["qbs"].items():
        if g in pm and tid(q["tm"]): qbs[pm[g][0]] = dict(q, tm=tid(q["tm"]), n=pm[g][1])
    for t in teams.values(): t["qb"] = None
    for pid, q in sorted(qbs.items(), key=lambda x: -x[1]["db"]):            # starting QB = most dropbacks for the team
        if q["tm"] in teams and teams[q["tm"]]["qb"] is None: teams[q["tm"]]["qb"] = pid
    players = {}
    for g, u in blob["usage"].items():
        if g in pm and tid(u["tm"]):
            players[pm[g][0]] = dict(u, tm=tid(u["tm"]), n=pm[g][1], pos=pm[g][2])
    return teams, qbs, players

def load_or_refresh(season, cache_dir, fetch=_fetch, now=None, log=print, force=False):
    now = now or dt.datetime.now(dt.timezone.utc)
    path = os.path.join(cache_dir, "nfl_nflverse.json") if cache_dir else None
    blob = _load(path) if path else None
    fresh = blob and blob.get("season") == season and \
        (now - dt.datetime.fromisoformat(blob["fetched"])).total_seconds() < REFRESH_HOURS * 3600
    if fresh and not force: return blob, "cached"
    try:
        nb = compute(season, fetch, log)
    except Exception as e:
        log(f"  adv nfl: nflverse download failed ({e}); {'keeping cached copy' if blob else 'no data'}")
        return blob, "stale cache" if blob else "unavailable"
    if path:
        os.makedirs(cache_dir, exist_ok=True)
        with open(path, "w") as fh: json.dump(nb, fh, separators=(",", ":"))
    return nb, "refreshed"
