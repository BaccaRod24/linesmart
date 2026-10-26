"""Advanced stats orchestrator: writes site/data/adv/<lg>.json (team + game level, loaded on game / team pages) and
site/data/adv/<lg>-players.json (player usage, loaded only on player pages and the props list). See docs/advanced_stats.md.

No Odds API calls happen here. Network reads: nflverse release files (about daily), ESPN team schedules (every 6 h) and
ESPN closing-line backfill (capped per run, ATS_ESPN_BACKFILL=0 turns it off)."""
import datetime as dt, json, os

import adv_nba as NBA
import adv_nfl as NFL
import ats as ATS

ATS_LEAGUES = ("nfl", "nba", "ncaaf", "ncaab", "nhl", "mlb")

def _load(p):
    try:
        with open(p) as fh: return json.load(fh)
    except Exception: return None

def _write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh: json.dump(obj, fh, separators=(",", ":"))
    return os.path.getsize(path)

def _season_year(lg_key, now):
    # NFL season label = the year it starts (Jan/Feb playoff games belong to the previous season)
    return now.year if now.month >= 3 else now.year - 1

def build(lg, getj, site, out_dir, cache_dir, history_dir=None, games=None, events=None, log=print, now=None,
          nfl_fetch=None):
    """One league. Returns a short report dict."""
    key = lg["key"]; now = now or dt.datetime.now(dt.timezone.utc)
    rep = dict(league=key)
    si = _load(os.path.join(out_dir, "search", f"{key}.json")) or {}
    team_ids = [str(t[0]) for t in si.get("teams") or [] if (t[-1] if len(t) > 8 else 1)]
    idx = _load(os.path.join(out_dir, key, "index.json")) or {}
    doc = dict(v=1, lg=key, gen=now.isoformat())
    players = None
    nfl_lines = None
    if key == "nfl":
        season = _season_year(key, now)
        kw = dict(fetch=nfl_fetch) if nfl_fetch else {}
        blob, how = NFL.load_or_refresh(season, cache_dir, now=now, log=log, **kw)
        rep["nflverse"] = how
        if blob:
            teams, qbs, pl = NFL.to_espn(blob, si.get("teams") or [])
            doc["nfl"] = dict(fetched=blob["fetched"], season=blob["season"], weeks=blob["weeks"], qualQB=blob["qualQB"],
                              qbMin=NFL.QB_MIN_DROPBACKS, teams=teams, qbs={p: q for p, q in qbs.items() if q["db"] >= 20})
            players = dict(v=1, lg=key, gen=now.isoformat(), fetched=blob["fetched"], weeks=blob["weeks"], trend=NFL.TREND, players=pl)
            nfl_lines = {eid: tuple(v) for eid, v in (blob.get("lines") or {}).items()}
    if key == "nba" and games:
        teams, league = NBA.team_ratings(games)
        doc["nba"] = dict(teams=teams, league=league, games=NBA.game_context(idx.get("games"), teams, league, games))
        players = dict(v=1, lg=key, gen=now.isoformat(), trend=NBA.TREND, players=NBA.player_usage(games))
    if key in ATS_LEAGUES:
        backfill = os.environ.get("ATS_ESPN_BACKFILL", "1") != "0"
        cap = int(os.environ.get("ATS_BACKFILL_MAX", "300"))
        try:
            doc["ats"] = ATS.update(lg, getj, site, out_dir, cache_dir, history_dir=history_dir, team_ids=team_ids, events=events,
                                    nfl_lines=nfl_lines, backfill=backfill, backfill_max=cap, now=now, log=log)
        except Exception as e:
            log(f"  ats {key}: failed ({e})")
    prev = _load(os.path.join(out_dir, "adv", f"{key}.json")) or {}
    for sec in ("nfl", "nba", "ats"):                 # a section that failed or was skipped this run keeps its last good copy
        if sec not in doc and sec in prev and (sec != "nba" or key == "nba") and (sec != "nfl" or key == "nfl"): doc[sec] = prev[sec]
    if len(doc) <= 3: return rep
    rep["bytes"] = _write(os.path.join(out_dir, "adv", f"{key}.json"), doc)
    if players: rep["playerBytes"] = _write(os.path.join(out_dir, "adv", f"{key}-players.json"), players)
    return rep
