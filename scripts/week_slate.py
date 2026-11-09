#!/usr/bin/env python3
"""League-page week: ESPN's own week for NFL and college football, last 7 ET days otherwise.

The scoreboard window in scripts/build_data.py drops yesterday's finals once they
are an hour past a typical game length, so "Incl. today's finals" goes empty at
midnight. This module builds a separate compact list. It does not guess a
Thursday-to-Monday NFL week: it reads week.number and the matching calendar
entry (startDate / endDate) off the scoreboard ESPN already scopes to that week.

No network. The caller passes fetch(url) -> dict.
"""
import datetime as dt
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
FOOTBALL = ("nfl", "ncaaf")
DAILY_DAYS = 7


def _parse(s):
    if not s:
        return None
    try:
        t = dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def et_date(iso, tz=ET):
    t = _parse(iso)
    if t is None:
        return None
    return t.astimezone(tz).date()


def in_bounds(iso, start, end):
    """True when iso falls inside ESPN's [startDate, endDate], inclusive.

    A missing timestamp is kept: ESPN put the event on this week's scoreboard.
    """
    t = _parse(iso)
    if t is None:
        return True
    a, b = _parse(start), _parse(end)
    if a and t < a:
        return False
    if b and t > b:
        return False
    return True


def calendar_entry(scoreboard):
    """The calendar row for scoreboard.week.number inside the current season type.

    Returns None when ESPN didn't send a week number or a matching entry. Callers
    then keep the events ESPN already returned instead of inventing dates.
    """
    if not isinstance(scoreboard, dict):
        return None
    num = (scoreboard.get("week") or {}).get("number")
    if num is None:
        return None
    season = scoreboard.get("season") or {}
    stype = season.get("type")
    leagues = scoreboard.get("leagues") or []
    cal = (leagues[0] or {}).get("calendar") if leagues and isinstance(leagues[0], dict) else None
    if not isinstance(cal, list):
        return None
    for blk in cal:
        if not isinstance(blk, dict):
            continue
        if stype is not None and str(blk.get("value")) != str(stype):
            continue
        for e in blk.get("entries") or []:
            if isinstance(e, dict) and str(e.get("value")) == str(num):
                return {
                    "number": int(num) if str(num).isdigit() else num,
                    "label": e.get("label") or f"Week {num}",
                    "detail": e.get("detail") or "",
                    "start": e.get("startDate"),
                    "end": e.get("endDate"),
                    "seasonType": stype,
                }
    return None


def _score(c):
    v = c.get("score")
    if isinstance(v, dict):
        v = v.get("displayValue")
        if v is None:
            v = c.get("score", {}).get("value")
    return None if v is None else str(v)


def compact_event(e):
    """One scoreboard event -> a small game, or None when a side is missing."""
    if not isinstance(e, dict) or not e.get("id"):
        return None
    comp = ((e.get("competitions") or [None])[0]) or {}
    cs = {c.get("homeAway"): c for c in (comp.get("competitors") or []) if isinstance(c, dict)}
    if "home" not in cs or "away" not in cs:
        return None
    st = ((e.get("status") or comp.get("status") or {}).get("type") or {})

    def side(c):
        t = c.get("team") or {}
        return {
            "id": str(t.get("id") or c.get("id") or ""),
            "abbr": t.get("abbreviation") or "",
            "short": t.get("shortDisplayName") or t.get("abbreviation") or "",
            "name": t.get("displayName") or t.get("name") or "",
            "logo": t.get("logo") or "",
            "score": _score(c),
            "winner": bool(c.get("winner")) if st.get("state") == "post" else None,
        }

    g = {
        "id": str(e["id"]),
        "date": e.get("date"),
        "name": e.get("name") or "",
        "shortName": e.get("shortName") or "",
        "state": st.get("state") or "",
        "statusDetail": st.get("shortDetail") or st.get("detail") or "",
        "away": side(cs["away"]),
        "home": side(cs["home"]),
    }
    if comp.get("neutralSite"):
        g["neutral"] = True
    return g


def _dedupe(events):
    out, seen = [], set()
    for e in events or []:
        g = compact_event(e)
        if not g or g["id"] in seen or not g.get("date"):
            continue
        seen.add(g["id"])
        out.append(g)
    out.sort(key=lambda g: g["date"])
    return out


def football_slate(scoreboard):
    """Current NFL or college week, using ESPN's week number and calendar bounds.

    Events outside those bounds are dropped, so the previous Sunday disappears
    once ESPN's week.number moves on (the Tuesday-after-MNF roll is ESPN's, not
    a date we invent). Sunday night stays while the scoreboard still says this week.
    """
    entry = calendar_entry(scoreboard)
    events = (scoreboard or {}).get("events") if isinstance(scoreboard, dict) else None
    if entry and entry.get("start") and entry.get("end"):
        events = [e for e in (events or []) if isinstance(e, dict) and in_bounds(e.get("date"), entry["start"], entry["end"])]
    games = _dedupe(events)
    label = (entry or {}).get("label") or "This week"
    return {
        "mode": "espn-week",
        "label": label,
        "detail": (entry or {}).get("detail") or "",
        "start": (entry or {}).get("start"),
        "end": (entry or {}).get("end"),
        "number": (entry or {}).get("number"),
        "order": "asc",
        "games": games,
    }


def daily_dates(today, days=DAILY_DAYS):
    """ET dates covering today and the previous days-1 dates, oldest first."""
    n = max(int(days), 1)
    start = today - dt.timedelta(days=n - 1)
    return [start + dt.timedelta(days=i) for i in range(n)]


def daily_slate(events, today, days=DAILY_DAYS):
    """Finals and games still to be played whose ET start is in the last `days` dates.

    Tomorrow is not included. A tip at 10:30 PM ET counts on that ET date, not the UTC date.
    """
    window = set(daily_dates(today, days))
    kept = []
    for e in events or []:
        if not isinstance(e, dict):
            continue
        d = et_date(e.get("date"))
        if d not in window:
            continue
        kept.append(e)
    games = _dedupe(kept)
    start, end = min(window), max(window)
    if start.month == end.month:
        detail = f"{start.strftime('%b')} {start.day}–{end.day}"
    else:
        detail = f"{start.strftime('%b')} {start.day}–{end.strftime('%b')} {end.day}"
    return {
        "mode": "days",
        "label": "Last 7 days",
        "detail": detail,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "number": None,
        "order": "desc",
        "games": games,
    }


def _url(site, lg, ymd=None):
    params = (lg.get("params") or "").lstrip("&")
    base = f"{site}{lg['path']}/scoreboard"
    if ymd:
        q = f"dates={ymd}" + (f"&{params}" if params else "")
        return f"{base}?{q}"
    return base + (f"?{params}" if params else "")


def _get(fetch, url):
    try:
        sb = fetch(url)
    except Exception:
        if "limit=" in url:
            raise
        sb = fetch(url + ("&" if "?" in url else "?") + "limit=100")
    if not isinstance(sb, dict):
        raise ValueError("scoreboard was not a JSON object")
    return sb


def league_week(lg, fetch, now, site):
    """Compact week for one league, or None for UFC / a failed fetch.

    NFL and NCAAF: one scoreboard request with no date. ESPN returns the current
    week. Every other league except UFC: one scoreboard per ET date for 7 days.
    `now` is a timezone-aware datetime.
    """
    key = lg.get("key")
    if key == "ufc" or lg.get("kind") == "mma":
        return None
    if now.tzinfo is None:
        now = now.replace(tzinfo=ET)
    now = now.astimezone(ET)
    if key in FOOTBALL:
        sb = _get(fetch, _url(site, lg))
        return football_slate(sb)
    dates = [d.strftime("%Y%m%d") for d in daily_dates(now.date())]
    events, ok = [], 0
    for ymd in dates:
        try:
            sb = _get(fetch, _url(site, lg, ymd))
        except Exception:
            continue
        ok += 1
        events.extend(sb.get("events") or [])
    if not ok:
        return None
    return daily_slate(events, now.date())
