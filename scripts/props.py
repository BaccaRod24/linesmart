"""Player prop lines + recent hit history (build time) -> site/data/props/<lg>.json

Lines: DraftKings player props as republished (free, no key) by ESPN's core API:
  sports.core.api.espn.com/v2/sports/{sport}/leagues/{lg}/events/{id}/competitions/{id}/odds/100/propBets
(provider 100 = DraftKings). ESPN gives the line (current + opening target) and a lastUpdated stamp. NFL items carry no
prices; NBA items carry two prices per line but don't say which one is the over, so prices are NOT shown anywhere.
Over/under come as two duplicate items per player+market, so they're de-duplicated. Milestone ("15+"), alt, quarter /
half, first-scorer and team props are skipped; only full-game player lines we can grade from box scores are kept.

History: every completed regular-season box score this season, reused from the matchups step (scripts/matchups.py
caches compact box lines in --matchup-cache-dir). For each player with a prop we ship his last 10 team games with the
stat values for his markets (null = not in the box score: DNP, inactive, or - NFL - no passing/rushing/receiving line),
and per prop the season tally against the CURRENT line. The site colours each of the last 5 games green (over), red
(under) or grey (push / no game) - see site/assets/props-core.js.

FORMAT (v1):
  {"v":1,"lg":"nfl","gen":iso,"source":"ESPN","book":"DraftKings","season":2026,"historyGames":N,
   "markets": {key: [label, short]},
   "games":   {gameId: {"upd": iso|null, "props": [[pid, marketKey, line, openLine|null, [over, under, push, games]], ...]}},
   "players": {pid: {"n": name, "pos": pos, "t": teamId, "ta": abbr, "log": [[date, oppAbbr, "vs"|"@", {mkt: value}|null], ...]}}}
"""
import concurrent.futures as cf, datetime as dt, json, os, re

SUPPORTED = ("nfl", "nba")
CORE = "https://sports.core.api.espn.com/v2/sports/"
PROVIDER = "100"                      # DraftKings in ESPN's casino list
WINDOW_H = {"nfl": 8 * 24, "nba": 36}  # only fetch games starting within this many hours (books post NBA props ~1 day out)
LOG_N = 10                             # games of history shipped per player (L5 strip + L10 rate)
MAX_NAME_LOOKUPS = 60                  # athlete refs fetched for players missing from the search index

def _sum(*ks): return lambda s: None if s is None else sum(s.get(k, 0) for k in ks)

# market key, label, short label, ESPN type names (lower-case, " (incl. overtime)" stripped), stat getter
NFL_MARKETS = [
    ("pass_yds", "Passing yards", "Pass yds", ["total passing yards"], _sum("py")),
    ("pass_tds", "Passing TDs", "Pass TD", ["total passing touchdowns"], _sum("ptd")),
    ("pass_cmp", "Completions", "Comp", ["total pass completions"], _sum("cmp")),
    ("pass_att", "Pass attempts", "Att", ["total passing attempts"], _sum("att")),
    ("pass_int", "Interceptions thrown", "INT", ["total passing interceptions"], _sum("int")),
    ("pass_rush_yds", "Pass + rush yards", "Pass+rush", ["total passing plus rushing yards"], _sum("py", "ry")),
    ("rush_yds", "Rushing yards", "Rush yds", ["total rushing yards"], _sum("ry")),
    ("rush_att", "Carries", "Carries", ["total carries"], _sum("car")),
    ("receptions", "Receptions", "Rec", ["total receptions"], _sum("rec")),
    ("rec_yds", "Receiving yards", "Rec yds", ["total receiving yards"], _sum("recy")),
    ("rush_rec_yds", "Rush + rec yards", "Rush+rec", ["total rushing plus receiving yards"], _sum("ry", "recy")),
    ("anytime_td", "Anytime TD", "Any TD", ["anytime touchdown scorer"], _sum("rtd", "rectd")),
]
# NBA compact box row: [pid, pos, pts, reb, ast, 3pm]
def _nba(*ix): return lambda r: None if r is None else sum(r[i] for i in ix)
NBA_MARKETS = [
    ("points", "Points", "Pts", ["total points"], _nba(2)),
    ("rebounds", "Rebounds", "Reb", ["total rebounds"], _nba(3)),
    ("assists", "Assists", "Ast", ["total assists"], _nba(4)),
    ("threes", "3-pointers made", "3PM", ["total 3-point field goals"], _nba(5)),
    ("pts_reb", "Points + rebounds", "P+R", ["total points and rebounds"], _nba(2, 3)),
    ("pts_ast", "Points + assists", "P+A", ["total points and assists"], _nba(2, 4)),
    ("reb_ast", "Rebounds + assists", "R+A", ["total assists and rebounds"], _nba(3, 4)),
    ("pra", "Pts + reb + ast", "PRA", ["total points, rebounds, and assists"], _nba(2, 3, 4)),
]
MARKETS = {"nfl": NFL_MARKETS, "nba": NBA_MARKETS}
ANYTIME_LINE = 0.5   # "anytime TD" has no target in the feed: it's a yes/no bet, graded as over 0.5 TDs

def _now(): return dt.datetime.now(dt.timezone.utc)

def _load(path):
    try:
        with open(path) as fh: return json.load(fh)
    except Exception: return None

def _ts(s):
    try: return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception: return None

def norm_type(name):
    return re.sub(r"\s*\(incl\.? overtime\)\s*$", "", str(name or ""), flags=re.I).strip().lower()

def type_map(lg_key):
    return {t: m[0] for m in MARKETS[lg_key] for t in m[3]}

_PID = re.compile(r"/athletes/(\d+)")

def parse_items(lg_key, items):
    """propBets items -> {(pid, market): dict(line, open, upd, ref)} (de-duplicated; skips milestones/team/period props)."""
    tm, out = type_map(lg_key), {}
    for it in items or []:
        ref = ((it.get("athlete") or {}).get("$ref")) or ""
        m = _PID.search(ref)
        if not m or it.get("team"): continue
        mk = tm.get(norm_type((it.get("type") or {}).get("name")))
        if not mk: continue
        cur = ((it.get("current") or {}).get("target") or {}).get("value")
        opn = ((it.get("open") or {}).get("target") or {}).get("value")
        if mk == "anytime_td": cur, opn = ANYTIME_LINE, None
        if not isinstance(cur, (int, float)): continue
        k = (m.group(1), mk)
        upd = it.get("lastUpdated")
        if k in out:
            if upd and (out[k]["upd"] or "") < upd: out[k].update(line=float(cur), open=opn, upd=upd)
            continue
        out[k] = dict(line=float(cur), open=float(opn) if isinstance(opn, (int, float)) else None, upd=upd, ref=ref)
    return out

def fetch_game_props(getj, lg, gid):
    sport, league = lg["path"].split("/")
    base = f"{CORE}{sport}/leagues/{league}/events/{gid}/competitions/{gid}/odds/{PROVIDER}/propBets?lang=en&region=us&limit=1000"
    d = getj(base); items = list(d.get("items") or [])
    for p in range(2, min(int(d.get("pageCount") or 1), 5) + 1):
        items += getj(f"{base}&page={p}").get("items") or []
    return items

# ---------------------------------------------------------------- history from compact box scores
def player_games(lg_key, games, pid, team_id):
    """[(date, gameRecord, statRowOrNone, teamIdPlayedFor)] newest first: every game of his current team, plus any game
    he appeared in for another team (trades). Row None = not in the box score."""
    out = []
    for g in games.values():
        b = g.get("b") or {}; row = tid = None
        for t, box in b.items():
            if lg_key == "nfl":
                if pid in box: row, tid = box[pid], t
            else:
                r = next((r for r in box.get("p") or [] if r[0] == pid), None)
                if r: row, tid = r, t
            if row is not None: break
        if row is None and team_id not in (g.get("h"), g.get("a")): continue
        out.append((g.get("d") or "", g, row, tid or team_id))
    out.sort(key=lambda x: x[0], reverse=True)
    return out

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception: _ET = dt.timezone(dt.timedelta(hours=-5))

def _et_day(s):
    """Game date as the US Eastern calendar day (a 7:30 PM ET tip is 23:30Z or 00:30Z next day)."""
    t = _ts(s)
    return t.astimezone(_ET).date().isoformat() if t and t.tzinfo else str(s or "")[:10]

def _num(v): return int(v) if isinstance(v, float) and v.is_integer() else v

def grade(v, line):
    if v is None: return None
    return "o" if v > line else "u" if v < line else "p"

def build_player(lg_key, games, pid, team_id, mkts, abbr):
    getters = {m[0]: m[4] for m in MARKETS[lg_key]}
    hist = player_games(lg_key, games, pid, team_id)
    log = []
    for d, g, row, tid in hist[:LOG_N]:
        opp = g["a"] if tid == g.get("h") else g["h"]
        vals = None if row is None else {mk: _num(getters[mk](row)) for mk in sorted(mkts)}
        log.append([_et_day(d), abbr.get(str(opp), ""), "vs" if tid == g.get("h") else "@", vals])
    return log, hist

def season_tally(lg_key, hist, mk, line):
    get = {m[0]: m[4] for m in MARKETS[lg_key]}[mk]
    o = u = p = n = 0
    for _, _, row, _ in hist:
        r = grade(get(row) if row is not None else None, line)
        if r is None: continue
        n += 1; o += r == "o"; u += r == "u"; p += r == "p"
    return [o, u, p, n]

def build_props(lg, getj, out_dir, search_dir, games=None, matchup_cache_dir=None, index=None, now=None, log=print):
    key = lg["key"]; t0 = _now(); now = now or t0
    if key not in SUPPORTED: return None
    rep = dict(league=key, source="ESPN core API (DraftKings, provider 100)")
    if games is None:   # matchups step skipped/failed: fall back to its on-disk cache
        c = _load(os.path.join(matchup_cache_dir, f"{key}.json")) if matchup_cache_dir else None
        games = (c or {}).get("games") or {}
    idx = index if index is not None else (_load(os.path.join(os.path.dirname(os.path.normpath(out_dir)), key, "index.json")) or {})
    si = _load(os.path.join(search_dir, f"{key}.json")) if search_dir else None
    steams = (si or {}).get("teams") or []
    abbr = {str(t[0]): t[2] for t in steams}
    roster = {str(p[0]): dict(n=p[1], t=str(steams[p[2]][0]) if isinstance(p[2], int) and 0 <= p[2] < len(steams) else "", pos=p[3] or "")
              for p in (si or {}).get("players") or []}
    for g in idx.get("games") or []:
        for s in ("home", "away"):
            t = g.get(s) or {}
            if t.get("id") and t.get("abbr"): abbr.setdefault(str(t["id"]), t["abbr"])
    horizon = now + dt.timedelta(hours=WINDOW_H[key])
    todo = [g for g in idx.get("games") or [] if g.get("state") == "pre" and (_ts(g.get("date")) or horizon) <= horizon]
    fetched, fail = {}, 0
    with cf.ThreadPoolExecutor(8) as ex:
        futs = {ex.submit(fetch_game_props, getj, lg, str(g["id"])): g for g in todo}
        for f in cf.as_completed(futs):
            g = futs[f]
            try: fetched[str(g["id"])] = (g, parse_items(key, f.result()))
            except Exception: fail += 1            # 404 = book hasn't posted props for this game yet
    # names for players missing from the search index (rookies signed mid-week, two-way players...)
    missing = sorted({pid for _, P in fetched.values() for (pid, _) in P if pid not in roster})
    looked = 0
    for pid in missing[:MAX_NAME_LOOKUPS]:
        ref = next(v["ref"] for _, P in fetched.values() for (p, _), v in P.items() if p == pid)
        try:
            a = getj(ref.replace("http://", "https://")); looked += 1
            tref = ((a.get("team") or {}).get("$ref")) or ""
            tm = re.search(r"/teams/(\d+)", tref)
            roster[pid] = dict(n=a.get("displayName") or a.get("fullName") or "", t=tm.group(1) if tm else "", pos=((a.get("position") or {}).get("abbreviation")) or "")
        except Exception: pass
    out_games, players, nprops = {}, {}, 0
    for gid, (g, P) in fetched.items():
        side = {str((g.get("home") or {}).get("id")), str((g.get("away") or {}).get("id"))}
        bypid = {}
        for (pid, mk), v in P.items(): bypid.setdefault(pid, {})[mk] = v
        rows, upd = [], None
        for pid, M in bypid.items():
            r = roster.get(pid)
            if not r or not r.get("n"): continue
            if r.get("t") not in side:      # stale roster (trade): trust the box score's most recent team if it's in this game
                h = player_games(key, games, pid, "")
                if h and h[0][3] in side: r = dict(r, t=h[0][3])
                else: continue
            log_, hist = build_player(key, games, pid, r["t"], M.keys(), abbr)
            pl = players.setdefault(pid, dict(n=r["n"], pos=r.get("pos") or "", t=r["t"], ta=abbr.get(r["t"], ""), log=[]))
            pl["log"] = _merge_logs(pl["log"], log_) if pl["log"] else log_
            for mk, v in M.items():
                rows.append([pid, mk, v["line"], v["open"], season_tally(key, hist, mk, v["line"])])
                if v["upd"] and (upd or "") < v["upd"]: upd = v["upd"]
        if rows:
            order = {m[0]: i for i, m in enumerate(MARKETS[key])}
            rows.sort(key=lambda x: (order.get(x[1], 99), -x[2]))
            out_games[gid] = dict(upd=upd, props=rows); nprops += len(rows)
    doc = dict(v=1, lg=key, gen=t0.isoformat(), source="ESPN", book="DraftKings", historyGames=len(games),
               historyScope="regular season, this season", markets={m[0]: [m[1], m[2]] for m in MARKETS[key]},
               anytimeLine=ANYTIME_LINE, games=out_games, players=players)
    os.makedirs(out_dir, exist_ok=True)
    raw = json.dumps(doc, separators=(",", ":"))
    with open(os.path.join(out_dir, f"{key}.json"), "w") as fh: fh.write(raw)
    rep.update(window=f"{WINDOW_H[key]}h", gamesInWindow=len(todo), gamesWithProps=len(out_games), noProps=fail, props=nprops,
               players=len(players), nameLookups=looked, historyGames=len(games), bytes=len(raw.encode()), seconds=round((_now() - t0).total_seconds(), 1))
    log(f"[{key}] props: {nprops} lines for {len(players)} players in {len(out_games)}/{len(todo)} games (DraftKings via ESPN), "
        f"history {len(games)} games, size={len(raw.encode()) // 1024}KB ({rep['seconds']}s)")
    return rep

def _merge_logs(a, b):
    """Same player, two games in the window (NBA back-to-back): union the per-game market values."""
    out = []
    for x, y in zip(a, b):
        vals = None if x[3] is None and y[3] is None else dict(x[3] or {}, **(y[3] or {}))
        out.append([x[0], x[1], x[2], vals])
    return out
