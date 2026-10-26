"""ATS (against the spread) and O/U records from final scores + closing lines. Stdlib only.

Closing lines, in order of preference (no new Odds API calls; everything reuses data we already have):
  1. NFL: nflverse schedules (games.csv, CC-BY 4.0) spread_line / total_line = consensus closing line (scripts/adv_nfl.py).
  2. Our own odds: the last pre-game DraftKings line we showed (else Hard Rock Bet, else FanDuel), captured every build
     from index.json and seeded from the persisted line history (history/<lg>.json). This is the long-run source.
  3. Backfill for games finished before our history starts: ESPN's core odds API "close" values (DraftKings, provider
     100), the same ESPN feed family the site already reads. Capped per run (ATS_BACKFILL_MAX) and switchable off with
     ATS_ESPN_BACKFILL=0. See docs/advanced_stats.md for the licence note.
Final scores: ESPN team schedules (already fetched for NFL/NBA by matchups.py; one call per team for the others,
re-scanned at most every SCAN_HOURS), plus finals seen in index.json each build.

Store (persisted in the data-history branch): <cache>/ats_<lg>.json
  {v, league, season, scanned, sched: [eid...], games: {eid: {d, h, a, hs, as, sp, tot, src, tries}}}
  sp = home team's closing spread (negative = home favoured), tot = closing total.
"""
import concurrent.futures as cf, datetime as dt, json, os

V = 1
SCAN_HOURS = 6
SEASON_TYPES = {"2", "3"}                        # regular season + postseason
LEAGUES = ("nfl", "nba", "ncaaf", "nhl", "mlb", "ncaab")
BOOK_PREF = ("draftkings", "hardrockbet", "fanduel")
CORE = "https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events/{eid}/competitions/{eid}/odds"

def _now(): return dt.datetime.now(dt.timezone.utc)
def _iso(t): return t.strftime("%Y-%m-%dT%H:%MZ")
def _num(v):
    try:
        f = float(str(v).replace("+", "")) if v not in (None, "", "EVEN") else (0.0 if v == "EVEN" else None)
        return f
    except (TypeError, ValueError): return None

# ---------------------------------------------------------------- grading (pure; tested in ats_test.py)
def grade_ats(margin, spread):
    """margin = team score - opponent score, spread = team's line (negative = favourite). 'W' / 'L' / 'P'."""
    v = margin + spread
    return "W" if v > 0 else "L" if v < 0 else "P"

def grade_ou(points, total):
    return "O" if points > total else "U" if points < total else "P"

def team_records(games):
    """games: iterable of store records with hs/as/sp/tot. -> {teamId: {ats: {all, home, away, l10}, ou: {...}, last: 'WLP..'}}
    every bucket is [wins, losses, pushes] (O/U: [overs, unders, pushes]); l10 = the team's last 10 graded games."""
    per = {}
    for eid, g in sorted(games.items(), key=lambda x: x[1].get("d") or ""):
        if g.get("hs") is None or g.get("as") is None: continue
        hs, as_ = float(g["hs"]), float(g["as"])
        for tid, side in ((g["h"], "home"), (g["a"], "away")):
            R = per.setdefault(tid, dict(ats=[], ou=[]))
            if g.get("sp") is not None:
                sp = g["sp"] if side == "home" else -g["sp"]
                m = hs - as_ if side == "home" else as_ - hs
                R["ats"].append((side, grade_ats(m, sp), eid))
            if g.get("tot") is not None:
                R["ou"].append((side, grade_ou(hs + as_, g["tot"]), eid))
    def rec(rows, keys):
        c = [sum(1 for _, r, _ in rows if r == k) for k in keys]
        return c
    out = {}
    for tid, R in per.items():
        o = {}
        for name, keys in (("ats", "WLP"), ("ou", "OUP")):
            rows = R[name]
            o[name] = dict(all=rec(rows, keys), home=rec([x for x in rows if x[0] == "home"], keys),
                           away=rec([x for x in rows if x[0] == "away"], keys), l10=rec(rows[-10:], keys))
        o["last"] = "".join(r for _, r, _ in R["ats"][-10:])
        o["lastOU"] = "".join(r for _, r, _ in R["ou"][-10:])
        out[tid] = o
    return out

# ---------------------------------------------------------------- closing lines from our own odds
def own_line(g):
    """(home spread, total, source) from a pre-game index.json game: DraftKings first, then Hard Rock Bet, then FanDuel."""
    books = g.get("books") or {}
    sp = tot = None; src = []
    for bk in BOOK_PREF:
        b = books.get(bk) or {}
        if b.get("stale"): continue
        if sp is None and _num(b.get("homeSpread")) is not None: sp = _num(b["homeSpread"]); src.append(bk)
        if tot is None and _num(b.get("total")) is not None: tot = _num(b["total"]); src.append(bk) if bk not in src else None
    if sp is None and tot is None and g.get("odds"):
        sp, tot = _num(g["odds"].get("homeSpread")), _num(g["odds"].get("total")); src = ["espn"]
    return sp, tot, "+".join(src)

def history_lines(hist):
    """Last pre-game point per game from history/<lg>.json -> {eid: (sp, tot, src, date, home, away)}"""
    out = {}
    for eid, h in ((hist or {}).get("games") or {}).items():
        sp = tot = None; src = None
        for bk in BOOK_PREF:
            pts = ((h.get("books") or {}).get(bk)) or []
            if not pts: continue
            last = pts[-1][1] if isinstance(pts[-1], list) and len(pts[-1]) > 1 else {}
            if sp is None and last.get("hs") is not None: sp = last["hs"]; src = src or bk
            if tot is None and last.get("tot") is not None: tot = last["tot"]; src = src or bk
        if sp is not None or tot is not None: out[str(eid)] = (sp, tot, f"history:{src}", h.get("date"), h.get("home"), h.get("away"))
    return out

# ---------------------------------------------------------------- ESPN reads
def schedule_scan(getj, site, lg, team_ids, workers=12):
    """{eid: {d, h, a, hs, as, fin}} for regular + postseason games on every team's schedule."""
    evs = {}
    path = lg["path"]
    urls = [f"{site}{path}/teams/{t}/schedule" + (f"?seasontype={st}" if lg["key"] == "mlb" else "") for t in team_ids
            for st in (("2", "3") if lg["key"] == "mlb" else ("",))]
    with cf.ThreadPoolExecutor(workers) as ex:
        for f in cf.as_completed([ex.submit(getj, u) for u in urls]):
            try: d = f.result()
            except Exception: continue
            for e in d.get("events") or []:
                st = str((e.get("seasonType") or {}).get("type") or (e.get("seasonType") or {}).get("id") or "")
                if st not in SEASON_TYPES: continue
                c = (e.get("competitions") or [{}])[0]
                cs = c.get("competitors") or []
                h = next((x for x in cs if x.get("homeAway") == "home"), None); a = next((x for x in cs if x.get("homeAway") == "away"), None)
                if not h or not a: continue
                sc = lambda x: _num((x.get("score") or {}).get("value") if isinstance(x.get("score"), dict) else x.get("score"))
                fin = bool(((c.get("status") or {}).get("type") or {}).get("completed"))
                evs[str(e["id"])] = dict(d=e.get("date"), h=str(h.get("id") or h["team"]["id"]), a=str(a.get("id") or a["team"]["id"]),
                                         hs=sc(h) if fin else None, as_=sc(a) if fin else None, fin=fin, neutral=bool(c.get("neutralSite")))
    for v in evs.values(): v["as"] = v.pop("as_")
    return evs

def core_close(getj, lg, eid):
    """(home spread, total) at close from ESPN's core odds API (DraftKings = provider 100 when present)."""
    sport, league = lg["path"].split("/")
    d = getj(CORE.format(sport=sport, league=league, eid=eid))
    items = d.get("items") or []
    it = next((x for x in items if str((x.get("provider") or {}).get("id")) == "100"), None) or next(iter(items), None)
    if not it: return None, None
    sp = _num((((it.get("homeTeamOdds") or {}).get("close") or {}).get("pointSpread") or {}).get("american"))
    if sp is None: sp = _num(it.get("spread"))
    tot = _num((((it.get("close") or {}).get("total")) or {}).get("american"))
    if tot is None: tot = _num(it.get("overUnder"))
    return sp, tot

# ---------------------------------------------------------------- build
def _load(p):
    try:
        with open(p) as fh: return json.load(fh)
    except Exception: return None

def update(lg, getj, site, out_dir, cache_dir, history_dir=None, team_ids=None, events=None, nfl_lines=None,
           backfill=True, backfill_max=150, now=None, log=print):
    """Update the store for one league and return {teams, since, through, graded, src, note} for data/adv/<lg>.json."""
    key = lg["key"]; now = now or _now()
    path = os.path.join(cache_dir, f"ats_{key}.json") if cache_dir else None
    st = (_load(path) if path else None) or {}
    if st.get("v") != V: st = dict(v=V, league=key, games={}, sched=[], scanned=None)
    G = st["games"]
    # 1) schedule: every team's schedule (regular + postseason, incl. upcoming games) re-scanned every SCAN_HOURS;
    #    NFL/NBA finals also arrive every run from matchups.py's completed-events list
    scanned = st.get("scanned")
    stale = not scanned or (now - dt.datetime.fromisoformat(scanned)).total_seconds() > SCAN_HOURS * 3600
    sched = {}
    if team_ids and stale:
        try:
            sched = schedule_scan(getj, site, lg, team_ids)
            if sched: st["scanned"] = now.isoformat(); st["sched"] = sorted(sched)
        except Exception as e: log(f"  ats {key}: schedule scan failed: {e}")
    for k, v in (events or {}).items():
        sched[k] = dict(d=v.get("date"), h=str(v["home"]), a=str(v["away"]), hs=_num(v.get("hs")), fin=True, **{"as": _num(v.get("as"))})
    if events: st["sched"] = sorted(set(st.get("sched") or []) | set(events))
    for eid, e in sched.items():
        g = G.setdefault(eid, dict(d=e["d"], h=e["h"], a=e["a"]))
        g.update(d=e["d"] or g.get("d"), h=e["h"], a=e["a"])
        if e.get("fin") and e.get("hs") is not None: g["hs"], g["as"] = e["hs"], e["as"]
    # 2) our own lines: persisted history (pre-game only) then this build's index.json (pre-game -> keep updating to close)
    hist = _load(os.path.join(history_dir, f"{key}.json")) if history_dir else None
    for eid, (sp, tot, src, d, h, a) in history_lines(hist).items():
        g = G.get(eid)
        if g is None: continue
        if g.get("src") in (None, "espn-close") or str(g.get("src", "")).startswith("history:"):
            g.update(sp=sp if sp is not None else g.get("sp"), tot=tot if tot is not None else g.get("tot"), src=src)
    idx = _load(os.path.join(out_dir, key, "index.json")) or {}
    for x in idx.get("games") or []:
        eid = str(x["id"]); h, a = str(x["home"]["id"]), str(x["away"]["id"])
        g = G.get(eid)
        if x.get("state") == "pre":
            sp, tot, src = own_line(x)
            if sp is None and tot is None: continue
            if g is None:
                if st.get("sched") and eid not in set(st["sched"]): continue          # preseason / exhibitions aren't graded
                g = G.setdefault(eid, dict(d=x["date"], h=h, a=a))
            if g.get("src") != "nflverse": g.update(sp=sp, tot=tot, src="close:" + src)
        elif x.get("state") == "post" and x.get("completed") and g is not None:
            hs, as_ = _num(x["home"].get("score")), _num(x["away"].get("score"))
            if hs is not None and as_ is not None: g["hs"], g["as"] = hs, as_
    # 3) NFL: nflverse consensus closing lines (and scores) for the whole season
    if nfl_lines:
        for eid, (sp, tot, hs, as_) in nfl_lines.items():
            g = G.get(eid)
            if g is None: continue
            if sp is not None or tot is not None: g.update(sp=sp, tot=tot, src="nflverse")
            if hs is not None and g.get("hs") is None: g["hs"], g["as"] = hs, as_
    # 4) ESPN close backfill for finished games with no line yet
    sched_ids = set(st.get("sched") or [])
    need = [eid for eid, g in G.items() if g.get("hs") is not None and g.get("sp") is None and g.get("tot") is None
            and g.get("tries", 0) < 3 and (not sched_ids or eid in sched_ids)]
    need.sort(key=lambda e: G[e].get("d") or "", reverse=True)
    got = 0
    if backfill and need and key != "nfl":
        with cf.ThreadPoolExecutor(8) as ex:
            futs = {ex.submit(core_close, getj, lg, eid): eid for eid in need[:backfill_max]}
            for f in cf.as_completed(futs):
                eid = futs[f]; g = G[eid]
                try: sp, tot = f.result()
                except Exception: sp = tot = None
                if sp is None and tot is None: g["tries"] = g.get("tries", 0) + 1; continue
                g.update(sp=sp, tot=tot, src="espn-close"); g.pop("tries", None); got += 1
    # keep only this season's schedule (drops last season and preseason entries)
    if sched_ids: st["games"] = G = {k: v for k, v in G.items() if k in sched_ids}
    st["updated"] = now.isoformat()
    if path:
        os.makedirs(cache_dir, exist_ok=True)
        with open(path, "w") as fh: json.dump(st, fh, separators=(",", ":"))
    graded = {k: v for k, v in G.items() if v.get("hs") is not None and (v.get("sp") is not None or v.get("tot") is not None)}
    finals = sum(1 for v in G.values() if v.get("hs") is not None)
    src = {}
    for v in graded.values():
        s = (v.get("src") or "").split(":")[0]; src[s] = src.get(s, 0) + 1
    ds = sorted(v["d"] for v in graded.values() if v.get("d"))
    res = dict(teams=team_records(graded), graded=len(graded), finals=finals, missing=finals - len(graded),
               since=ds[0] if ds else None, through=ds[-1] if ds else None, src=src, backfilled=got, pendingBackfill=max(0, len(need) - got))
    log(f"  ats {key}: {len(graded)}/{finals} finals graded ({src}), +{got} backfilled, {res['pendingBackfill']} still need a line")
    return res
