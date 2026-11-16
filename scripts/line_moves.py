#!/usr/bin/env python3
"""Notable spread and total moves from published line history.

Reads the history already stored on a game (site/data/<lg>/games/<id>.json or the
archive). Never calls The Odds API. An open is used only after line_history.reconcile_open,
and an open that is still doubtful is skipped.

A move counts when the absolute change from that open to the current line is at
least 1 point on a spread or 1.5 points on a total. One row per game: the larger
move, and the spread when they are equal.
"""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

import line_history as LH

ET = ZoneInfo("America/New_York")
SPREAD_MIN = 1.0
TOTAL_MIN = 1.5
WEEK_MIN = 3
LEAGUE_ORDER = ("nfl", "nba", "ncaaf", "ncaab", "nhl", "mlb", "ufc")
SHORT = {"nfl": "NFL", "nba": "NBA", "ncaaf": "NCAAF", "ncaab": "NCAAB", "nhl": "NHL", "mlb": "MLB", "ufc": "UFC"}
FOOTBALL = ("nfl", "ncaaf")


def _parse(iso):
    if not iso:
        return None
    try:
        t = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def _num(v):
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def _series(history, book):
    out = []
    for p in (history.get("books") or {}).get(book) or []:
        if isinstance(p, list) and len(p) > 1 and isinstance(p[1], dict):
            out.append(p[1])
    return out


def _in_bounds(iso, start, end):
    t = _parse(iso)
    if t is None:
        return False
    a, b = _parse(start), _parse(end)
    if a and t < a:
        return False
    if b and t > b:
        return False
    return True


def league_rank(lg):
    try:
        return LEAGUE_ORDER.index(lg)
    except ValueError:
        return len(LEAGUE_ORDER)


def week_for(lg, game, week):
    """(path, label) for this game's weekly page. None when the game has no date."""
    when = _parse((game or {}).get("date"))
    if when is None:
        return None, None
    year = when.astimezone(ET).year
    ids = {str(x.get("id")) for x in ((week or {}).get("games") or []) if isinstance(x, dict) and x.get("id")}
    num = (week or {}).get("number")
    in_week = str((game or {}).get("id") or "") in ids if ids else False
    if not in_week and week and week.get("start"):
        in_week = _in_bounds(game.get("date"), week.get("start"), week.get("end"))
    if lg in FOOTBALL and num and in_week:
        start = _parse(week.get("start"))
        y = start.astimezone(ET).year if start else year
        label = f"{SHORT.get(lg, lg.upper())} Week {num}"
        return f"{lg}/line-moves/week-{num}-{y}/", label
    day = when.astimezone(ET).date()
    monday = day - dt.timedelta(days=day.weekday())
    sunday = monday + dt.timedelta(days=6)
    slug = f"{monday.isoformat()}-to-{sunday.strftime('%m-%d')}"
    label = f"{SHORT.get(lg, lg.upper())} {monday.strftime('%b')} {monday.day}–{sunday.strftime('%b')} {sunday.day}"
    return f"{lg}/line-moves/{slug}/", label


def row_for_game(lg, game, history, path, week_path, week_label):
    """One verified move for this game, or None.

    history is the stored line-history entry (open + books). The open is reconciled
    again here so a stale ESPN number is not listed, and a still-doubtful open is skipped.
    """
    if not history or not path or not week_path:
        return None
    book = LH._primary(history)
    if not book:
        return None
    series = _series(history, book)
    raw = (history.get("open") or {}).get(book) or {}
    if not isinstance(raw, dict):
        return None
    nums = {k: raw.get(k) for k in LH._OPEN_NUM_KEYS if raw.get(k) is not None}
    kind = LH.league_kind(lg)
    fixed = LH.reconcile_open(nums, series, kind)
    if LH.open_is_doubtful(fixed, series, kind):
        return None
    cur = series[-1] if series else {}
    src, tot_src = LH.label_open(nums, fixed)
    if raw.get("src") == LH.OPEN_SRC_FIRST:
        src = LH.OPEN_SRC_FIRST
    if raw.get("totSrc") == LH.OPEN_SRC_FIRST and src != LH.OPEN_SRC_FIRST:
        tot_src = LH.OPEN_SRC_FIRST
    home = (game or {}).get("home") or {}
    away = (game or {}).get("away") or {}
    cands = []
    for market, key, floor in (("spread", "hs", SPREAD_MIN), ("total", "tot", TOTAL_MIN)):
        o, c = _num(fixed.get(key)), _num(cur.get(key))
        if o is None or c is None:
            continue
        delta = c - o
        if abs(delta) + 1e-9 < floor:
            continue
        market_src = src
        if market == "total" and tot_src:
            market_src = tot_src
        cands.append((abs(delta), 0 if market == "spread" else 1, {
            "lg": lg,
            "gid": str((game or {}).get("id") or ""),
            "path": path,
            "date": (game or {}).get("date") or "",
            "away": away.get("abbr") or away.get("short") or "",
            "home": home.get("abbr") or home.get("short") or "",
            "awayName": away.get("name") or away.get("short") or away.get("abbr") or "",
            "homeName": home.get("name") or home.get("short") or home.get("abbr") or "",
            "market": market,
            "open": o,
            "cur": c,
            "delta": delta,
            "abs": abs(delta),
            "book": book,
            "src": market_src,
            "weekPath": week_path,
            "weekLabel": week_label,
        }))
    if not cands:
        return None
    cands.sort(key=lambda x: (-x[0], x[1]))
    return cands[0][2]


def rank_rows(rows):
    """Largest move first. Ties: earlier kickoff, then NFL, NBA, NCAAF, NCAAB, NHL."""
    return sorted(rows, key=lambda r: (-r["abs"], r.get("date") or "", league_rank(r.get("lg") or ""), r.get("gid") or ""))


def merge_weeks(stored, fresh, evaluated):
    """Keep a stored move when this run did not see that game. A game we did see uses the fresh row only.

    stored and fresh are {weekPath: [row, ...]}. evaluated is the set of game ids whose
    history was checked this run, including games that no longer clear the floor.
    """
    fresh_by_gid = {}
    for rows in fresh.values():
        for row in rows:
            fresh_by_gid[row["gid"]] = row
    out = {}
    seen = set()
    for path, rows in (stored or {}).items():
        for row in rows or []:
            gid = str(row.get("gid") or "")
            if not gid or gid in fresh_by_gid or gid in evaluated or gid in seen:
                continue
            seen.add(gid)
            out.setdefault(row.get("weekPath") or path, []).append(row)
    for row in fresh_by_gid.values():
        out.setdefault(row["weekPath"], []).append(row)
    for path, rows in list(out.items()):
        out[path] = rank_rows(rows)
        if not out[path]:
            del out[path]
    return out


def weeks_to_publish(weeks, minimum=WEEK_MIN):
    """Weekly pages only. A week under the minimum is not published."""
    return {path: rows for path, rows in (weeks or {}).items() if len(rows) >= minimum}
