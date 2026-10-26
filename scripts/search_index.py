"""
Search index for LineSmart (teams + players across all leagues), built from ESPN's public endpoints.

Per league it writes site/data/search/<league>.json (compact arrays, see FORMAT below):
  - every team in ESPN's teams list (all divisions for college football), with record + group from standings
  - players from team rosters: all teams for pro/soccer leagues; FBS only (NCAAF) and D-I only (NCAAB)

Rosters change slowly, so they're cached in --roster-cache-dir (the data-history branch in CI) and only
re-fetched when the cached copy is older than ROSTER_MAX_AGE_H (default 20h). Any roster fetch that fails
falls back to the last cached copy of that team. Teams + standings are cheap (2 calls) and fetched every run.

FORMAT (v1):
  {"v":1,"lg":"nfl","gen":iso,"rostersAsOf":iso|null,"scope":"...","hs":"<headshot url prefix>",
   "teams":   [[id, name, abbr, short, logo, color, record, group, hasRoster(0/1)], ...],
   "players": [[id, name, teamIndex, pos, jersey, hasHeadshot(0/1)], ...]}
"""
import concurrent.futures as cf, datetime as dt, json, os

HEADSHOT_SEG = {"nfl": "nfl", "nba": "nba", "ncaaf": "college-football", "ncaab": "mens-college-basketball",
                "nhl": "nhl", "mlb": "mlb", "epl": "soccer", "mls": "soccer", "ucl": "soccer"}
# college: players only for the top division (keeps the index small); teams list stays complete
PLAYER_GROUP = {"ncaaf": ("80", "FBS teams only"), "ncaab": ("50", "Division I teams only")}

def _now(): return dt.datetime.now(dt.timezone.utc)

def _teams_list(getj, site, lg):
    d = getj(f"{site}{lg['path']}/teams?limit=1000")
    out = []
    for lgx in (d.get("sports") or [{}])[0].get("leagues") or []:
        for x in lgx.get("teams") or []:
            t = x.get("team") or {}
            if t.get("id"): out.append(t)
    return out

def _stat(entry, *names):
    for s in entry.get("stats") or []:
        if s.get("name") in names or s.get("type") in names: return s
    return None

def _standings(getj, standings_base, lg, group=None):
    """team id -> dict(record, group). Walks nested children (conferences/divisions)."""
    url = f"{standings_base}{lg['path']}/standings" + (f"?group={group}" if group else "")
    d = getj(url); out = {}
    def walk(n, gname):
        name = n.get("name") or n.get("abbreviation") or gname
        for e in (n.get("standings") or {}).get("entries") or []:
            tid = str((e.get("team") or {}).get("id") or "")
            if not tid: continue
            if lg["kind"] == "soccer":
                w, dr, l = (_stat(e, "wins") or {}).get("value"), (_stat(e, "ties") or {}).get("value"), (_stat(e, "losses") or {}).get("value")
                pts = (_stat(e, "points") or {}).get("value")
                rec = f"{int(w)}-{int(dr)}-{int(l)}" if None not in (w, dr, l) else None
                if rec and pts is not None: rec += f" · {int(pts)} pts"
            else:
                rec = (_stat(e, "overall") or {}).get("displayValue") or (_stat(e, "total") or {}).get("summary")
            out[tid] = dict(record=rec, group=name)
        for c in n.get("children") or []: walk(c, name)
    walk(d, None)
    return out

def _parse_roster(r):
    ath = r.get("athletes") or []
    items = [i for grp in ath for i in (grp.get("items") or [])] if ath and isinstance(ath[0], dict) and "items" in ath[0] else ath
    out = []
    for a in items:
        if not a.get("id"): continue
        out.append([str(a["id"]), a.get("displayName") or a.get("fullName") or "", (a.get("position") or {}).get("abbreviation") or "",
                    a.get("jersey") or "", 1 if (a.get("headshot") or {}).get("href") else 0])
    return out

def _load(path):
    try:
        with open(path) as fh: return json.load(fh)
    except Exception: return None

def build_search(lg, getj, site, standings_base, out_dir, cache_dir=None, max_age_h=20.0, snap_dir=None, log=print):
    key = lg["key"]; t0 = _now()
    rep = dict(league=key)
    teams = _teams_list(getj, site, lg)
    st = {}
    try: st = _standings(getj, standings_base, lg)
    except Exception as ex: rep["standingsError"] = str(ex)[:120]
    scope_ids, scope = None, "all teams"
    if key in PLAYER_GROUP:
        grp, scope = PLAYER_GROUP[key]
        try:
            g = _standings(getj, standings_base, lg, grp); scope_ids = set(g)
            for tid, v in g.items(): st[tid] = v          # top-division standings have conference names
        except Exception as ex:
            rep["scopeError"] = str(ex)[:120]; scope_ids = set(st) or None
    want = [str(t["id"]) for t in teams if scope_ids is None or str(t["id"]) in scope_ids]
    # rosters: cached (data-history) unless stale
    cpath = os.path.join(cache_dir, f"{key}.json") if cache_dir else None
    cached = (_load(cpath) if cpath else None) or {}
    ctime = cached.get("fetchedAt")
    age_h = (t0 - dt.datetime.fromisoformat(ctime)).total_seconds() / 3600 if ctime else None
    rosters = dict(cached.get("teams") or {})
    covers = all(t in rosters for t in want)
    if age_h is not None and age_h < max_age_h and covers:
        rep["rosters"] = f"cached ({age_h:.1f}h old)"; fetched_at = ctime
    else:
        ok = fail = 0
        with cf.ThreadPoolExecutor(12) as ex:
            futs = {ex.submit(getj, f"{site}{lg['path']}/teams/{tid}/roster"): tid for tid in want}
            for f in cf.as_completed(futs):
                tid = futs[f]
                try: rosters[tid] = _parse_roster(f.result()); ok += 1
                except Exception: fail += 1     # keep the last cached copy for this team (if any)
        fetched_at = t0.isoformat() if ok else ctime
        rep["rosters"] = f"fetched {ok}/{len(want)}" + (f", {fail} failed (kept cached copy)" if fail else "")
        if ok and cpath:
            os.makedirs(cache_dir, exist_ok=True)
            blob = dict(league=key, fetchedAt=fetched_at, teams={t: rosters[t] for t in want if t in rosters})
            with open(cpath, "w") as fh: json.dump(blob, fh, separators=(",", ":"))
            if snap_dir:
                os.makedirs(os.path.join(snap_dir, "_rosters"), exist_ok=True)
                with open(os.path.join(snap_dir, "_rosters", f"{key}.json"), "w") as fh: json.dump(blob, fh, separators=(",", ":"))
    # compact output
    T, P, seen = [], [], set()
    for t in teams:
        tid = str(t["id"]); s = st.get(tid) or {}
        logo = ((t.get("logos") or [{}])[0] or {}).get("href") or ""
        has = 1 if tid in rosters and tid in want else 0
        T.append([tid, t.get("displayName") or "", t.get("abbreviation") or "", t.get("shortDisplayName") or "", logo,
                  t.get("color") or "", s.get("record") or "", s.get("group") or "", has])
        if has:
            ti = len(T) - 1
            for p in rosters[tid]:
                if p[0] in seen: continue      # a player listed twice (e.g. two-way) appears once
                seen.add(p[0]); P.append([p[0], p[1], ti, p[2], p[3], p[4]])
    seg = HEADSHOT_SEG.get(key, key)
    doc = dict(v=1, lg=key, name=lg["name"], kind=lg["kind"], path=lg["path"], gen=t0.isoformat(), rostersAsOf=fetched_at, scope=f"Teams: all ESPN lists; players: {scope}",
               hs=f"https://a.espncdn.com/i/headshots/{seg}/players/full/", teams=T, players=P)
    os.makedirs(out_dir, exist_ok=True)
    raw = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(out_dir, f"{key}.json"), "w") as fh: fh.write(raw)
    rep.update(teams=len(T), players=len(P), bytes=len(raw.encode()), rostersAsOf=fetched_at, scope=scope)
    log(f"[{key}] search: teams={len(T)} players={len(P)} {rep['rosters']} size={len(raw.encode())//1024}KB")
    return rep
