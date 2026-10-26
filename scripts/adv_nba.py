"""NBA pace, ratings, rest and player usage from ESPN box-score totals we already cache (scripts/matchups.py). Stdlib only.

  possessions (per team, per game)  FGA - OREB + TOV + 0.44 x FTA; a game's possessions = mean of the two teams' estimates
  offensive / defensive rating      100 x points scored / allowed per possession (season sums)
  net rating                        ORtg - DRtg
  pace                              48 x possessions / game minutes (48 + 5 per overtime)
  projected game pace               home pace x away pace / league pace
  rest days                         full days off between a team's previous game and this one (ET dates); 0 = back-to-back
  usage rate (USG%)                 100 x (FGA + 0.44 FTA + TOV) x (team minutes / 5) / (minutes x (team FGA + 0.44 team FTA + team TOV))
                                    summed over the games in the window; team minutes = 240 + 25 per overtime
No stats.nba.com calls: everything comes from the box scores the site already fetches from ESPN for the defense-vs-position tables.
"""
import datetime as dt
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
TREND = dict(min=3.0, usg=2.0)       # last-5 vs season gaps that earn an arrow (minutes per game; usage points)

def possessions(fga, oreb, tov, fta):
    return fga - oreb + tov + 0.44 * fta

def game_minutes(per):
    return 48 + 5 * max(0, (per or 4) - 4)

def pace(poss, minutes):
    return 48 * poss / minutes if minutes else None

def usage(p_fga, p_fta, p_tov, p_min, t_fga, t_fta, t_tov, t_min):
    den = p_min * (t_fga + 0.44 * t_fta + t_tov)
    return 100 * (p_fga + 0.44 * p_fta + p_tov) * (t_min / 5) / den if den else None

def _et_date(iso): return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ET).date()

def team_ratings(games):
    """games: {eid: matchups compact record}. -> ({tid: {...}}, league {pace, ortg})"""
    acc, lg_poss, lg_min, lg_pts = {}, 0.0, 0.0, 0.0
    res = {}
    for eid, g in sorted(games.items(), key=lambda x: x[1].get("d") or ""):
        b = g.get("b") or {}; h, a = g["h"], g["a"]
        th, ta = (b.get(h) or {}).get("t"), (b.get(a) or {}).get("t")
        s = g.get("s") or {}
        sh, sa = s.get(h), s.get(a)
        if sh is None or sa is None: continue
        sh, sa = float(sh), float(sa)
        for tid, my, op in ((h, sh, sa), (a, sa, sh)):
            res.setdefault(tid, []).append((g.get("d"), "W" if my > op else "L"))
        if not th or not ta: continue
        ph, pa = possessions(th[1], th[3], th[4], th[2]), possessions(ta[1], ta[3], ta[4], ta[2])
        poss, mins = (ph + pa) / 2, game_minutes(g.get("per"))
        lg_poss += poss; lg_min += mins; lg_pts += sh + sa
        for tid, pf, pa_ in ((h, sh, sa), (a, sa, sh)):
            A = acc.setdefault(tid, dict(gp=0, poss=0.0, min=0.0, pf=0.0, pa=0.0))
            A["gp"] += 1; A["poss"] += poss; A["min"] += mins; A["pf"] += pf; A["pa"] += pa_
    out = {}
    for tid, A in acc.items():
        o, d = 100 * A["pf"] / A["poss"], 100 * A["pa"] / A["poss"]
        out[tid] = dict(gp=A["gp"], ortg=round(o, 1), drtg=round(d, 1), net=round(o - d, 1), pace=round(pace(A["poss"], A["min"]), 1))
    for tid, r in res.items():
        last = [x[1] for x in r[-10:]]
        out.setdefault(tid, dict(gp=0))["l10"] = [last.count("W"), last.count("L")]
        out[tid]["lastGame"] = r[-1][0]
    for k, hi in (("ortg", True), ("drtg", False), ("net", True), ("pace", True)):
        vals = sorted([v[k] for v in out.values() if v.get(k) is not None], reverse=hi)
        for v in out.values():
            if v.get(k) is not None: v.setdefault("rk", {})[k] = vals.index(v[k]) + 1
    league = dict(pace=round(pace(lg_poss, lg_min), 1) if lg_min else None,
                  ortg=round(100 * lg_pts / (2 * lg_poss), 1) if lg_poss else None, games=sum(1 for _ in games))
    return out, league

def rest_days(last_date_iso, game_iso):
    if not last_date_iso: return None
    return (_et_date(game_iso) - _et_date(last_date_iso)).days - 1

def game_context(index_games, teams, league, games, now=None):
    """Rest / back-to-back and projected pace for upcoming + live games in index.json."""
    played = {}
    for g in games.values():
        for tid in (g["h"], g["a"]): played.setdefault(tid, []).append(g.get("d"))
    for v in played.values(): v.sort()
    out = {}
    for x in index_games or []:
        if x.get("state") == "post": continue
        gid, d = str(x["id"]), x["date"]
        o = {}
        for side in ("home", "away"):
            tid = str(x[side]["id"])
            prev = [p for p in played.get(tid, []) if p and p < d and _et_date(p) < _et_date(d)]
            rd = rest_days(prev[-1], d) if prev else None
            o[side[0]] = dict(rest=rd, b2b=rd == 0 if rd is not None else None, last=prev[-1] if prev else None)
        ph, pa = (teams.get(str(x["home"]["id"])) or {}).get("pace"), (teams.get(str(x["away"]["id"])) or {}).get("pace")
        if ph and pa and league.get("pace"): o["pace"] = round(ph * pa / league["pace"], 1)
        out[gid] = o
    return out

def player_usage(games, n_last=5):
    """-> {pid: {g, tm, min: [season, last5, trend], usg: [season, last5, trend]}} (min = minutes per game)."""
    per = {}
    for eid, g in games.items():
        tmin = 240 + 25 * max(0, (g.get("per") or 4) - 4)
        for tid, T in (g.get("b") or {}).items():
            t = T.get("t")
            if not t: continue
            for r in T.get("p") or []:
                if len(r) < 10 or not r[6]: continue
                per.setdefault(r[0], []).append((g.get("d") or "", tid, r[6], r[7], r[8], r[9], t[1], t[2], t[4], tmin))
    out = {}
    for pid, rows in per.items():
        rows.sort()
        if len(rows) < 2: continue
        def agg(rs):
            m = sum(x[2] for x in rs)
            u = usage(sum(x[3] for x in rs), sum(x[4] for x in rs), sum(x[5] for x in rs), m,
                      sum(x[6] for x in rs), sum(x[7] for x in rs), sum(x[8] for x in rs), sum(x[9] for x in rs))
            return round(m / len(rs), 1), (round(u, 1) if u is not None else None)
        sm, su = agg(rows); lm, lu = agg(rows[-n_last:])
        tr = lambda s, l, k: None if len(rows) <= n_last or s is None or l is None else ("up" if l - s >= TREND[k] else "down" if s - l >= TREND[k] else "flat")
        out[pid] = dict(g=len(rows), tm=rows[-1][1], min=[sm, lm, tr(sm, lm, "min")], usg=[su, lu, tr(su, lu, "usg")])
    return out
