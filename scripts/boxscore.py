#!/usr/bin/env python3
"""Compact box score from an ESPN game summary. Stdlib only.

scripts/build_data.py already downloads the summary for injuries and leaders.
Finished games keep a short box (team totals and player lines) on the game
file. UFC summaries have no boxscore; compact() returns None for those.
"""

# Player columns worth showing on a phone. Anything else keeps its first 8 labels.
COLS = {
    "basketball": ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-"],
    "hockey:forwards": ["G", "A", "SOG", "+/-", "TOI", "HT", "BS", "PIM"],
    "hockey:defenses": ["G", "A", "SOG", "+/-", "TOI", "HT", "BS", "PIM"],
    "hockey:skaters": ["G", "A", "SOG", "+/-", "TOI", "HT", "BS", "PIM"],
    "hockey:goalies": ["SA", "GA", "SV", "SV%", "TOI"],
    "baseball:batting": ["AB", "R", "H", "RBI", "HR", "BB", "K", "AVG"],
    "baseball:pitching": ["IP", "H", "R", "ER", "BB", "K", "HR", "PC-ST", "ERA"],
    "soccer": ["G", "A", "SH", "ST", "FC", "FA", "OF", "YC", "RC"],
}
# Football groups that belong on the box-score tab. Returns and fumbles stay off
# so the phone table stays the passing / rushing / receiving / defense lines.
FB_KEEP = ("passing", "rushing", "receiving", "defensive", "interceptions", "kicking", "punting")
CAP = {
    "passing": 4, "rushing": 8, "receiving": 10, "defensive": 15, "interceptions": 8,
    "kicking": 3, "punting": 3, "forwards": 14, "defenses": 8, "skaters": 18, "goalies": 3,
    "batting": 14, "pitching": 8,
}
KIND_CAP = {"football": 12, "basketball": 15, "hockey": 18, "baseball": 14, "soccer": 18}
TITLES = {
    "passing": "Passing", "rushing": "Rushing", "receiving": "Receiving", "defensive": "Defense",
    "interceptions": "Interceptions", "kicking": "Kicking", "punting": "Punting",
    "forwards": "Forwards", "defenses": "Defense", "skaters": "Skaters", "goalies": "Goalies",
    "batting": "Batting", "pitching": "Pitching",
}
# Team totals, by ESPN's statistic name. Order is the row order.
TEAM_NAMES = {
    "football": ["firstDowns", "thirdDownEff", "fourthDownEff", "totalYards", "netPassingYards", "rushingYards",
                 "sacksYardsLost", "interceptions", "redZoneAttempts", "totalPenaltiesYards", "turnovers", "possessionTime"],
    "basketball": ["fieldGoalsMade-fieldGoalsAttempted", "fieldGoalPct", "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
                   "freeThrowsMade-freeThrowsAttempted", "totalRebounds", "offensiveRebounds", "assists", "steals", "blocks",
                   "turnovers", "fouls", "points"],
    "hockey": ["shots", "shotsOnGoal", "powerPlayGoals-powerPlayOpportunities", "powerPlayPct", "faceoffPercent",
               "hits", "blockedShots", "takeaways", "giveaways", "penaltyMinutes"],
}
MLB_TEAM = {
    "batting": [("R", "Runs"), ("H", "Hits"), ("HR", "Home runs"), ("RBI", "RBI"), ("BB", "Walks"), ("SO", "Strikeouts"), ("LOB", "Left on base"), ("AVG", "Batting avg")],
    "pitching": [("K", "Pitcher strikeouts"), ("BB", "Walks allowed"), ("ER", "Earned runs"), ("P", "Pitches")],
    "fielding": [("E", "Errors")],
}


def _s(v):
    return "" if v is None else str(v)


def _lines(comp):
    out = []
    for x in comp.get("linescores") or []:
        if isinstance(x, dict):
            v = x.get("displayValue")
            if v is None:
                v = x.get("value")
        else:
            v = x
        out.append(_s(v))
    return out


def _col_idx(kind, name, labels):
    want = COLS.get(f"{kind}:{name}") or COLS.get(kind)
    if want:
        idx = [labels.index(l) for l in want if l in labels]
        if idx:
            return idx
    return list(range(min(8, len(labels))))


def _cap(kind, name):
    return CAP.get(name) or KIND_CAP.get(kind) or 12


def team_stats(kind, block):
    """[{label, value}] from one boxscore.teams entry. Empty when ESPN sent none."""
    raw = (block or {}).get("statistics") or []
    flat = []
    for s in raw:
        if not isinstance(s, dict):
            continue
        if isinstance(s.get("stats"), list):
            want = MLB_TEAM.get(s.get("name")) or []
            for ab, label in want:
                x = next((y for y in s["stats"] if isinstance(y, dict) and y.get("abbreviation") == ab), None)
                if x and x.get("displayValue") not in (None, ""):
                    flat.append((ab, label, str(x["displayValue"])))
        elif s.get("displayValue") not in (None, ""):
            flat.append((s.get("name") or "", s.get("label") or s.get("abbreviation") or s.get("name") or "", str(s["displayValue"])))
    keep = TEAM_NAMES.get(kind)
    if keep:
        by = {n: (lab, val) for n, lab, val in flat}
        picked = [{"label": by[n][0], "value": by[n][1]} for n in keep if n in by]
        if picked:
            return picked
    seen, out = set(), []
    for _n, lab, val in flat:
        if not lab or lab in seen:
            continue
        seen.add(lab)
        out.append({"label": lab, "value": val})
        if len(out) >= 12:
            break
    return out


def player_groups(kind, block):
    groups = []
    for s in (block or {}).get("statistics") or []:
        if not isinstance(s, dict):
            continue
        name = s.get("name") or s.get("type") or ""
        if kind == "football" and name not in FB_KEEP:
            continue
        athletes = []
        for a in s.get("athletes") or []:
            if not isinstance(a, dict) or a.get("didNotPlay"):
                continue
            ath = a.get("athlete") or {}
            stats = a.get("stats") or []
            if not stats or not (ath.get("shortName") or ath.get("displayName")):
                continue
            athletes.append(a)
        if not athletes:
            continue
        labels = [str(x) for x in (s.get("labels") or [])]
        idx = _col_idx(kind, name, labels)
        if not idx:
            continue
        lim = _cap(kind, name)
        rows = []
        for a in athletes[:lim]:
            ath = a.get("athlete") or {}
            st = a.get("stats") or []
            rows.append({
                "name": ath.get("shortName") or ath.get("displayName") or "",
                "id": str(ath["id"]) if ath.get("id") else "",
                "stats": ["" if i >= len(st) or st[i] is None else str(st[i]) for i in idx],
            })
        totals = s.get("totals") or []
        groups.append({
            "name": name,
            "title": TITLES.get(name) or s.get("text") or ("Players" if kind in ("basketball", "soccer") else name or "Players"),
            "labels": [labels[i] for i in idx],
            "rows": rows,
            "more": max(0, len(athletes) - lim),
            "totals": ["" if i >= len(totals) or totals[i] is None else str(totals[i]) for i in idx] if totals else [],
        })
    return groups


def _side(kind, comp, team_block, player_block):
    t = (comp or {}).get("team") or {}
    tid = str((comp or {}).get("id") or t.get("id") or (team_block or {}).get("team", {}).get("id") or (player_block or {}).get("team", {}).get("id") or "")
    return {
        "id": tid,
        "abbr": t.get("abbreviation") or (team_block or {}).get("team", {}).get("abbreviation") or "",
        "lines": _lines(comp or {}),
        "stats": team_stats(kind, team_block),
        "players": player_groups(kind, player_block),
    }


def compact(kind, summary):
    """Box for a finished game, or None when this summary has no box score (UFC).

    Shape matches what site/assets/box-core.js renders: away/home with lines,
    team stats and player groups. Only call this for a final; a live summary
    is partial and is left to the in-game widget.
    """
    if kind in (None, "", "mma") or not isinstance(summary, dict):
        return None
    box = summary.get("boxscore") or {}
    if not isinstance(box, dict):
        return None
    header = ((summary.get("header") or {}).get("competitions") or [None])[0] or {}
    comps = {c.get("homeAway"): c for c in (header.get("competitors") or []) if isinstance(c, dict)}
    teams = {str((t.get("team") or {}).get("id")): t for t in (box.get("teams") or []) if isinstance(t, dict)}
    players = {str((t.get("team") or {}).get("id")): t for t in (box.get("players") or []) if isinstance(t, dict)}
    if not teams and not players:
        return None

    def block_for(side):
        comp = comps.get(side) or {}
        tid = str(comp.get("id") or (comp.get("team") or {}).get("id") or "")
        return comp, teams.get(tid), players.get(tid)

    away = _side(kind, *block_for("away"))
    home = _side(kind, *block_for("home"))
    if not (away["stats"] or away["players"] or home["stats"] or home["players"]):
        return None
    periods = max(len(away["lines"]), len(home["lines"]))
    return {"periods": periods, "away": away, "home": home}
