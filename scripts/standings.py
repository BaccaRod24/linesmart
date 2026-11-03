"""League standings from ESPN's public standings feed.

The data build (scripts/build_data.py) fetches
https://site.api.espn.com/apis/v2/sports/<sport>/<league>/standings?level=3
on every refresh and writes site/data/<league>/standings.json. No Odds API call.
level=3 is the conference-and-division tree. A fetch that fails leaves the previous
file in place, the same keep-last-good idea as a failed scoreboard day.

College football is the FBS group (Power conferences plus the other FBS leagues).
College basketball is the high majors plus the main other conferences. A column is
omitted when the feed has no value for it.
"""
import datetime as dt
import json
import os

STANDINGS = "https://site.api.espn.com/apis/v2/sports/"

# query string after ?  (level=3 expands conferences into divisions)
QUERIES = {
    "nfl": "level=3",
    "nba": "level=3",
    "nhl": "level=3",
    "mlb": "level=3",
    "ncaaf": "level=3&group=80",
    "ncaab": "level=3&group=50",
}
LEAGUES = tuple(QUERIES)

# High majors, then the main other conferences. Anything else in Division I is left off.
NCAAB_MAJOR = ("sec", "big10", "big12", "acc", "bige", "american", "atl10", "mvc", "mwest", "pac12", "wcc")
NCAAF_ORDER = ("sec", "big10", "big12", "acc", "american", "pac12", "mwest", "belt", "midam", "usa", "ind")

# ESPN type -> our field. Types that contain "_" are split copies (home_wins) and are skipped.
FIELDS = {
    "wins": "w", "losses": "l", "ties": "t",
    "otlosses": "otl", "overtimelosses": "otl",
    "winpercent": "pct", "gamesbehind": "gb",
    "pointsfor": "pf", "pointsagainst": "pa", "pointdifferential": "pd",
    "avgpointsfor": "ppg", "avgpointsagainst": "oppg",
    "gamesplayed": "gp", "total": "record",
    "home": "home", "homerecord": "home",
    "road": "away", "awayrecord": "away",
    "vsdiv": "div", "divisionrecord": "div", "vsdivision": "div", "intradivision": "div",
    "streak": "streak", "lasttengames": "l10",
    "points": "pts",
}
# Optional columns, in table order. The UI always adds the schedule columns on top of these.
COLUMN_ORDER = ("t", "otl", "pct", "pts", "gb", "pf", "pa", "pd", "home", "away", "div", "streak", "l10")


def standings_url(lg, season=None):
    key = lg["key"] if isinstance(lg, dict) else lg
    q = QUERIES[key]
    if season:
        q += f"&season={int(season)}"
    path = lg["path"] if isinstance(lg, dict) else ""
    return f"{STANDINGS}{path}/standings?{q}"


def _parse_time(raw):
    if not raw:
        return None
    try:
        t = dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def season_not_started(doc, now):
    """True when ESPN handed back a season that has not started yet (MLB in the winter)."""
    start = _parse_time(((doc or {}).get("season") or {}).get("startDate"))
    if start is None or now is None:
        return False
    if now.tzinfo is None:
        now = now.replace(tzinfo=dt.timezone.utc)
    return start > now


def fetch_doc(lg, fetch, now):
    """One standings document. If the default season is still in the future, ask for the previous year once."""
    doc = fetch(standings_url(lg))
    if not season_not_started(doc, now):
        return doc
    year = ((doc or {}).get("season") or {}).get("year")
    try:
        prev = int(year) - 1
    except (TypeError, ValueError):
        return doc
    return fetch(standings_url(lg, prev))


def _num(stat):
    if not stat or stat.get("value") is None:
        return None
    try:
        n = float(stat["value"])
    except (TypeError, ValueError):
        return None
    if n.is_integer():
        return int(n)
    return round(n, 2)


def _text(stat):
    if not stat:
        return None
    raw = stat.get("displayValue")
    if raw is None:
        return None
    s = str(raw).strip()
    if s in ("", "-", "—"):
        return None
    if "," in s:
        s = s.split(",", 1)[0].strip()
    return s or None


def _stats(entry):
    out = {}
    for s in entry.get("stats") or []:
        if not isinstance(s, dict):
            continue
        typ = str(s.get("type") or "")
        if "_" in typ:
            continue
        field = FIELDS.get(typ.lower())
        if field and field not in out:
            out[field] = s
    return out


def _logo(team):
    for logo in team.get("logos") or []:
        href = (logo or {}).get("href")
        if href:
            return href
    return ""


def _parts(record):
    """'6-1' or '4-2-1' -> (wins, losses, third). The third is ties in football and OTL in hockey."""
    bits = str(record or "").split("-")
    if len(bits) < 2 or not all(b.isdigit() for b in bits):
        return None
    nums = [int(b) for b in bits]
    return nums[0], nums[1], nums[2] if len(nums) > 2 else 0


def win_pct(w, l, ties=0):
    """NFL rule: a tie counts as half a win and half a loss. Other leagues pass ties=0."""
    ties = ties or 0
    played = (w or 0) + (l or 0) + ties
    if w is None or l is None or played <= 0:
        return None
    return (w + 0.5 * ties) / played


def fmt_pct(w, l, ties=0):
    val = win_pct(w, l, ties)
    if val is None:
        return None
    text = f"{val:.3f}"
    return text[1:] if text.startswith("0") else text


def games_behind(leader, team, kind):
    """Games behind the division leader.

    Hockey standings are ordered by points, and ESPN's GB is the points gap.
    Everywhere else a tie cancels out, so GB is half the combined win and loss gap.
    """
    if kind == "hockey":
        return float((leader.get("pts") or 0) - (team.get("pts") or 0))
    return ((leader["w"] - team["w"]) + (team["l"] - leader["l"])) / 2.0


def gb_value(raw):
    """ESPN writes '-' for the leader. That is zero games behind."""
    if raw in (None, "", "-", "—"):
        return 0.0
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def consistency_errors(parsed, kind):
    """Rows whose win%, games played, differential, or games back disagree with the same entry.

    `parsed` is a parse_standings() result or a standings.json body. Returns a list of reasons.
    """
    groups = (parsed or {}).get("groups") or []
    errs = []
    for group in groups:
        for div in group.get("divisions") or []:
            teams = [t for t in (div.get("teams") or []) if t.get("w") is not None and t.get("l") is not None]
            label = div.get("name") or group.get("name") or ""
            leader = None
            for team in teams:
                if gb_value(team.get("gb")) == 0:
                    leader = team
                    break
            for team in teams:
                name = team.get("abbr") or team.get("name") or team.get("id")
                ties = team.get("t") or 0
                otl = team.get("otl") or 0
                extra = otl if kind == "hockey" else ties
                gp = team["w"] + team["l"] + extra
                if team.get("gp") != gp:
                    errs.append(f"{label} {name}: GP {team.get('gp')} != {team['w']}+{team['l']}+{extra}")
                if team.get("record") != f"{team['w']}-{team['l']}":
                    errs.append(f"{label} {name}: W-L {team.get('record')} != {team['w']}-{team['l']}")
                if kind == "hockey":
                    if team.get("pts") is not None and team["pts"] != 2 * team["w"] + otl:
                        errs.append(f"{label} {name}: PTS {team.get('pts')} != 2*{team['w']}+{otl}")
                else:
                    want = fmt_pct(team["w"], team["l"], ties)
                    if team.get("pct") != want:
                        errs.append(f"{label} {name}: PCT {team.get('pct')} != {want}")
                if team.get("pf") is not None and team.get("pa") is not None and team.get("pd") is not None:
                    if team["pf"] - team["pa"] != team["pd"]:
                        errs.append(f"{label} {name}: PD {team['pd']} != {team['pf']}-{team['pa']}")
                if leader is not None and team.get("gb") is not None:
                    got = gb_value(team.get("gb"))
                    exp = games_behind(leader, team, kind)
                    if got is None or abs(got - exp) > 0.01:
                        errs.append(f"{label} {name}: GB {team.get('gb')} != {exp} behind {leader.get('abbr') or leader.get('name')}")
    return errs


def _team(entry, kind):
    team = entry.get("team") or {}
    if team.get("id") is None:
        return None
    st = _stats(entry)
    w, l = _num(st.get("w")), _num(st.get("l"))
    ties, otl = _num(st.get("t")), _num(st.get("otl"))
    record = _text(st.get("record"))
    parts = _parts(record)
    if parts:
        if w is None:
            w = parts[0]
        if l is None:
            l = parts[1]
        if kind == "hockey":
            if otl is None:
                otl = parts[2]
        elif ties is None:
            ties = parts[2]
    if None not in (w, l):
        record = f"{int(w)}-{int(l)}"
    gp = _num(st.get("gp"))
    extra = (otl or 0) if kind == "hockey" else (ties or 0)
    if None not in (w, l):
        gp = w + l + extra
    elif gp is None and parts:
        gp = parts[0] + parts[1] + parts[2]
    pf, pa = _num(st.get("pf")), _num(st.get("pa"))
    pd = (pf - pa) if pf is not None and pa is not None else _num(st.get("pd"))
    ppg = round(pf / gp, 2) if pf is not None and gp else _num(st.get("ppg"))
    oppg = round(pa / gp, 2) if pa is not None and gp else _num(st.get("oppg"))
    div = _text(st.get("div"))
    gb_stat = st.get("gb")
    gb = "—" if gb_stat and _text(gb_stat) is None else _text(gb_stat)
    pct = None if kind == "hockey" or w is None or l is None else fmt_pct(w, l, ties or 0)
    row = {
        "id": str(team.get("id")),
        "name": team.get("displayName") or team.get("name") or "",
        "short": team.get("shortDisplayName") or team.get("abbreviation") or "",
        "abbr": team.get("abbreviation") or "",
        "logo": _logo(team),
        "w": w, "l": l, "t": ties, "otl": otl,
        "record": record,
        "pct": pct,
        "pts": (2 * int(w) + int(otl or 0)) if kind == "hockey" and w is not None else None,
        "gb": gb,
        "gp": gp,
        "pf": pf, "pa": pa, "pd": pd,
        "ppg": ppg, "oppg": oppg,
        "home": _text(st.get("home")),
        "away": _text(st.get("away")),
        "div": div,
        "streak": _text(st.get("streak")),
        "l10": _text(st.get("l10")),
    }
    return row


def _entries(node, kind):
    rows = []
    for entry in ((node.get("standings") or {}).get("entries") or []):
        row = _team(entry, kind)
        if row:
            rows.append(row)
    return rows


def _divisions(node, kind):
    kids = [c for c in (node.get("children") or []) if isinstance(c, dict)]
    if kids:
        out = []
        for child in kids:
            nested = _divisions(child, kind)
            if nested and not _entries(child, kind):
                out.extend(nested)
                continue
            teams = _entries(child, kind)
            if teams:
                out.append({"name": child.get("name") or child.get("abbreviation") or "", "teams": teams})
        return out
    teams = _entries(node, kind)
    if not teams:
        return []
    return [{"name": node.get("name") or "", "teams": teams}]


def _keep_conference(lg, node):
    if lg != "ncaab":
        return True
    abbr = str(node.get("abbreviation") or node.get("name") or "").strip().lower()
    return abbr in NCAAB_MAJOR


def _order_key(lg, node, index):
    abbr = str(node.get("abbreviation") or "").strip().lower()
    if lg == "ncaaf":
        try:
            return (0, NCAAF_ORDER.index(abbr), index)
        except ValueError:
            return (1, index, index)
    if lg == "ncaab":
        try:
            return (0, NCAAB_MAJOR.index(abbr), index)
        except ValueError:
            return (1, index, index)
    return (0, index, index)


def _columns(groups, kind):
    teams = [t for g in groups for d in g["divisions"] for t in d["teams"]]
    present = set()
    for t in teams:
        for key in COLUMN_ORDER:
            if t.get(key) is not None:
                present.add(key)
    if kind == "hockey":
        present.discard("pct")
        present.discard("t")
    else:
        present.discard("pts")
        present.discard("otl")
    if kind != "football":
        present.discard("t")
    return [k for k in COLUMN_ORDER if k in present]


def parse_standings(lg, doc):
    """ESPN standings document -> {season, scope, groups, columns}. Empty groups when the feed is unusable."""
    key = lg["key"] if isinstance(lg, dict) else str(lg)
    kind = (lg.get("kind") if isinstance(lg, dict) else None) or {"nhl": "hockey", "mlb": "baseball", "nba": "basketball", "ncaab": "basketball"}.get(key, "football")
    out = {"season": "", "scope": "", "groups": [], "columns": []}
    if not isinstance(doc, dict):
        return out
    season = doc.get("season") or {}
    out["season"] = str(season.get("displayName") or season.get("year") or "")
    nodes = [c for c in (doc.get("children") or []) if isinstance(c, dict)]
    if key == "ncaab":
        kept = [n for n in nodes if _keep_conference(key, n)]
        if kept:
            nodes = kept
            out["scope"] = "Major conferences"
        else:
            out["scope"] = ""
    elif key == "ncaaf":
        out["scope"] = "FBS"
    groups = []
    ordered = sorted(enumerate(nodes), key=lambda iv: _order_key(key, iv[1], iv[0]))
    for _, node in ordered:
        divs = _divisions(node, kind)
        if not divs:
            continue
        groups.append({
            "name": node.get("name") or node.get("abbreviation") or "",
            "abbr": node.get("abbreviation") or "",
            "divisions": divs,
        })
    out["groups"] = groups
    out["columns"] = _columns(groups, kind)
    return out


def file_body(lg, parsed, generated):
    key = lg["key"] if isinstance(lg, dict) else str(lg)
    parsed = parsed or {}
    return {
        "v": 1,
        "league": key,
        "name": (lg.get("name") if isinstance(lg, dict) else None) or key.upper(),
        "kind": (lg.get("kind") if isinstance(lg, dict) else None) or "",
        "source": "ESPN",
        "generated": generated,
        "season": parsed.get("season") or "",
        "scope": parsed.get("scope") or "",
        "columns": list(parsed.get("columns") or []),
        "groups": parsed.get("groups") or [],
    }


def _load(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def write_standings(lg, fetch, out_dir, now=None, log=print):
    """Fetch, parse, and write site/data/<league>/standings.json.

    A failed fetch, or a feed with no teams, keeps the previous file when one exists.
    Returns a small report. Never raises.
    """
    key = lg["key"]
    path = os.path.join(out_dir, key, "standings.json")
    now = now or dt.datetime.now(dt.timezone.utc)
    try:
        doc = fetch_doc(lg, fetch, now)
        parsed = parse_standings(lg, doc)
        if not parsed["groups"]:
            raise ValueError("ESPN standings had no teams")
        body = file_body(lg, parsed, now.astimezone(dt.timezone.utc).isoformat())
        os.makedirs(os.path.dirname(path), exist_ok=True)
        raw = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
        with open(path, "w") as fh:
            fh.write(raw)
        n = sum(len(d["teams"]) for g in body["groups"] for d in g["divisions"])
        log(f"[{key}] standings: {n} teams, {len(body['groups'])} groups, season {body['season'] or '?'}")
        return {"league": key, "teams": n, "groups": len(body["groups"]), "season": body["season"], "bytes": len(raw.encode())}
    except Exception as ex:
        kept = _load(path) is not None
        log(f"[{key}] standings FAILED: {ex}" + ("; kept the previous file" if kept else ""))
        return {"league": key, "error": str(ex)[:200], "kept": kept}
