#!/usr/bin/env python3
"""Merge a refresh run's pages snapshot onto the current data-history tip.

The push retry for `data-history` used to copy `.linehist-snap/_pages` over
the branch tip. That directory is this run's archive, taken at checkout. A
straight copy replaces whole files, so a game that landed on the tip afterward
(a manual backfill) is deleted. On 2026-10-29 that wiped the nine Oct 26 NBA
finals in data-history 7b0512f.

    python3 scripts/merge_pages_snapshot.py --src .linehist-snap/_pages --dst pages

Called from the retry loop in `.github/workflows/refresh-and-deploy.yml` after
the tip is fetched again. Never force-pushes and never calls an API.

For each `games-*.json` / `players-*.json` / `state.json` object, entries are
merged by key:

- A key only on the tip stays. A key only in the snapshot is added.
- `generated`, `updated`, and a player's `seen` are freshness stamps. The
  newer record wins. An older stamp cannot replace a game's record, score, or
  anything else already on the newer copy.
- When the stamps tie or are missing, the tip wins a conflict and the snapshot
  fills keys the tip does not have. That is this run's new games and new
  fields, without putting the stale snapshot back on top of the tip.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

# generated / updated: game and page records. seen: players-<lg>.json snapshots.
STAMP_FIELDS = ("generated", "updated", "seen")
_STAMP_RE = re.compile(r"^(.*T\d{2}:\d{2})([+-]\d{2}:\d{2})$")


def parse_stamp(value):
    """UTC datetime for an ISO stamp, or None. `Z` and minute precision both compare."""
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    m = _STAMP_RE.match(s)
    if m:
        s = m.group(1) + ":00" + m.group(2)
    try:
        parsed = dt.datetime.fromisoformat(s)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def record_stamp(obj):
    """Newest generated / updated / seen stamp on this record, or None."""
    if not isinstance(obj, dict):
        return None
    best = None
    for key in STAMP_FIELDS:
        parsed = parse_stamp(obj.get(key))
        if parsed is not None and (best is None or parsed > best):
            best = parsed
    return best


def _stamp_pair(value):
    """state.json lastmod / finals entries are [token, iso]."""
    return (
        isinstance(value, list)
        and len(value) >= 2
        and not isinstance(value[0], (dict, list))
        and parse_stamp(value[-1]) is not None
    )


def _path_list(value):
    """Archive path lists (state.json paths / team_paths), not broadcast names."""
    return isinstance(value, list) and all(isinstance(x, str) and "/" in x for x in value)


def merge_list(tip, snap):
    """Keep the newer stamp pair. Union path lists with the tip's order first."""
    if _stamp_pair(tip) and _stamp_pair(snap):
        keep = tip if parse_stamp(tip[-1]) >= parse_stamp(snap[-1]) else snap
        return copy.deepcopy(keep)
    if _path_list(tip) and _path_list(snap):
        out = list(tip)
        for item in snap:
            if item not in out:
                out.append(item)
        return out
    return copy.deepcopy(tip)


def fill_missing(newer, older):
    """Newer record wins every conflict. Keys only the older copy has are added.

    Stamp fields are not copied off the older record, so the result cannot
    carry an older generated / updated / seen time.
    """
    if not isinstance(newer, dict):
        return copy.deepcopy(newer)
    out = copy.deepcopy(newer)
    if not isinstance(older, dict):
        return out
    for key, value in older.items():
        if key in STAMP_FIELDS:
            continue
        if key not in out:
            out[key] = copy.deepcopy(value)
        elif isinstance(out[key], dict) and isinstance(value, dict):
            out[key] = fill_missing(out[key], value)
        elif isinstance(out[key], list) and isinstance(value, list):
            out[key] = merge_list(out[key], value)
    return out


def merge_value(tip, snap):
    """Merge snapshot `snap` onto tip `tip`. Tip data is never replaced by older data."""
    if isinstance(tip, dict) and isinstance(snap, dict):
        tip_stamp, snap_stamp = record_stamp(tip), record_stamp(snap)
        if tip_stamp is not None and snap_stamp is not None and tip_stamp != snap_stamp:
            if tip_stamp > snap_stamp:
                return fill_missing(tip, snap)
            return fill_missing(snap, tip)
        out = {}
        for key in set(tip) | set(snap):
            if key not in snap:
                out[key] = copy.deepcopy(tip[key])
            elif key not in tip:
                out[key] = copy.deepcopy(snap[key])
            else:
                out[key] = merge_value(tip[key], snap[key])
        return out
    if isinstance(tip, list) and isinstance(snap, list):
        return merge_list(tip, snap)
    return copy.deepcopy(tip)


def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def _load(path: Path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as ex:
        print(f"[pages] skip {path.name}: {ex}", file=sys.stderr)
        return None
    return data


def _write(path: Path, obj) -> bool:
    text = canon(obj)
    if path.is_file():
        try:
            if path.read_text(encoding="utf-8") == text:
                return False
        except OSError:
            pass
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
    return True


def merge_tree(src, dst) -> int:
    """Merge every JSON file in `src` onto the same name in `dst`. Files only on `dst` stay."""
    src, dst = Path(src), Path(dst)
    if not src.is_dir():
        print(f"[pages] no snapshot at {src}")
        return 0
    dst.mkdir(parents=True, exist_ok=True)
    names = sorted(p.name for p in src.glob("*.json") if p.is_file())
    if not names:
        print(f"[pages] snapshot {src} has no JSON files")
        return 0
    for name in names:
        snap = _load(src / name)
        if snap is None:
            continue
        dest = dst / name
        if not dest.is_file():
            _write(dest, snap)
            print(f"[pages] {name}: added from snapshot")
            continue
        tip = _load(dest)
        if tip is None:
            print(f"[pages] {name}: tip unreadable; left untouched", file=sys.stderr)
            continue
        merged = merge_value(tip, snap)
        changed = _write(dest, merged)
        extra = ""
        if isinstance(tip, dict) and isinstance(snap, dict) and isinstance(merged, dict):
            tip_only = len([k for k in tip if k not in snap])
            snap_only = len([k for k in snap if k not in tip])
            extra = f", kept {tip_only} tip-only, added {snap_only} from snapshot, {len(merged)} keys"
        print(f"[pages] {name}: {'updated' if changed else 'unchanged'}{extra}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Merge a pages snapshot onto the data-history tip.")
    ap.add_argument("--src", required=True, help="this run's pages snapshot (.linehist-snap/_pages)")
    ap.add_argument("--dst", required=True, help="pages directory on the fetched data-history tip")
    args = ap.parse_args(argv)
    return merge_tree(args.src, args.dst)


if __name__ == "__main__":
    sys.exit(main())
