"""AP Top 25 from ESPN's public college football rankings feed.

The data build (scripts/build_data.py) fetches
https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings
on every refresh and writes site/data/ncaaf/rankings.json. No Odds API call.
CFP is stored when ESPN publishes that poll; the Top 25 tab uses the AP poll.
"""

AP_TYPES = {"ap"}
CFP_TYPES = {"cfp", "playoff"}


def movement(current, previous):
    """up, down, new, or unchanged. previous 0 means the team was unranked."""
    try:
        prev = int(previous)
    except (TypeError, ValueError):
        prev = 0
    if prev <= 0:
        return "new"
    try:
        cur = int(current)
    except (TypeError, ValueError):
        return None
    if cur < prev:
        return "up"
    if cur > prev:
        return "down"
    return "unchanged"


def poll_key(poll):
    if not isinstance(poll, dict):
        return None
    kind = str(poll.get("type") or "").strip().lower()
    name = f"{poll.get('name') or ''} {poll.get('shortName') or ''}".lower()
    if kind in AP_TYPES or "ap top" in name:
        return "ap"
    if kind in CFP_TYPES or "college football playoff" in name or name.strip().startswith("cfp"):
        return "cfp"
    return None


def _team_name(team):
    if team.get("displayName"):
        return team["displayName"]
    return " ".join(p for p in (team.get("location"), team.get("name")) if p)


def team_row(entry):
    if not isinstance(entry, dict):
        return None
    team = entry.get("team") or {}
    if not isinstance(team, dict) or team.get("id") is None or entry.get("current") is None:
        return None
    try:
        rank = int(entry.get("current"))
    except (TypeError, ValueError):
        return None
    if rank < 1 or rank > 25:
        return None
    try:
        prev = int(entry.get("previous"))
    except (TypeError, ValueError):
        prev = 0
    return {
        "rank": rank,
        "id": str(team.get("id")),
        "name": _team_name(team),
        "abbr": team.get("abbreviation") or "",
        "record": entry.get("recordSummary") or "",
        "previous": prev or None,
        "movement": movement(rank, prev),
    }


def parse_rankings(doc):
    """Pull the AP poll and, when present, the CFP poll. Other polls are ignored."""
    out = {"ap": None, "cfp": None}
    if not isinstance(doc, dict):
        return out
    for poll in doc.get("rankings") or []:
        key = poll_key(poll)
        if not key or out[key]:
            continue
        teams = []
        for entry in poll.get("ranks") or []:
            row = team_row(entry)
            if row:
                teams.append(row)
        if not teams:
            continue
        teams.sort(key=lambda t: (t["rank"], t["name"]))
        out[key] = {
            "name": poll.get("name") or ("AP Top 25" if key == "ap" else "CFP rankings"),
            "date": poll.get("date") or "",
            "teams": teams,
        }
    return out


def file_body(parsed, generated):
    """Static JSON written to site/data/ncaaf/rankings.json. ap is null when the poll is missing."""
    parsed = parsed or {}
    body = {
        "league": "ncaaf",
        "source": "ESPN",
        "generated": generated,
        "ap": parsed.get("ap"),
    }
    if parsed.get("cfp"):
        body["cfp"] = parsed["cfp"]
    return body
