#!/usr/bin/env python3
"""Merge a refresh run's data-history snapshot onto the current tip.

The push retry for `data-history` used to copy this run's snapshot over the
branch tip with `cp -f`. A straight copy replaces whole files, so data that
landed on the tip afterward (a newer roster, a backfilled game, another run's
health record) is deleted. Pages hit that on 2026-10-29 (data-history
7b0512f). The same retry still copied rosters, matchups, weather, advanced
stats, and the health record.

    python3 scripts/merge_pages_snapshot.py --src .linehist-snap/_pages --dst pages
    python3 scripts/merge_pages_snapshot.py --src .linehist-snap/_rosters --dst rosters
    python3 scripts/merge_pages_snapshot.py --health --src .linehist-snap/reliability.json --dst health

Called from the retry loop in `.github/workflows/refresh-and-deploy.yml` after
the tip is fetched again. Never force-pushes and never calls an API.

Per record (a page game, a roster team, a matchup or ATS game, a forecast, a
venue, an nflverse team or line):

- A record only on the tip stays. A record only in the snapshot is added.
- Freshness is the record's own `generated` / `updated` / `seen` / `fetchedAt`
  / `fetched` / `asOf` / `at`. The newer stamp wins.
- A tie, or a missing stamp, keeps the tip's value. The snapshot fills keys
  the tip does not have.
- A file-level stamp (`fetchedAt` on a roster file, `updated` on matchups,
  ATS, and venues, `fetched` on the nflverse aggregate) is the clock for child
  records that have none of their own. A child that has its own stamp, such as
  a forecast's `fetchedAt`, uses that instead, so a later file write cannot
  put an older forecast back.
- Two different `season` values are not mixed. The higher season is kept whole.
- `sched` and `weeks` are id lists: tip order, then ids only the snapshot has.
  `scanned` keeps the newer timestamp and does not decide the games.
- Health is one JSON file per run (`health/<run id>.json`). Same `runId` is
  one entry (newer `at` wins). Other runs stay. Findings are deduped, tip
  order first, capped at 80 like `health_record`.
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

# generated / updated: game, page, matchup, and ATS records.
# seen: players-<lg>.json. fetchedAt: rosters and forecast rows.
# fetched: nflverse aggregate. asOf: a line or a page clock. at: a health run.
STAMP_FIELDS = ("generated", "updated", "seen", "fetchedAt", "fetched", "asOf", "at")
# Maps of records inside a cache file. The file's own stamp does not replace
# these wholesale; each entry is merged on its own.
MAP_KEYS = ("games", "teams", "venues", "players", "qbs", "usage", "lines", "pmap")
# Id lists the writers treat as sets. Tip order first, then snapshot-only ids.
LIST_UNION_KEYS = ("sched", "weeks")
# reliability.health_record keeps findings[-80:]. The run directory is not capped.
FINDINGS_CAP = 80
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
    """Newest freshness stamp on this record, or None."""
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


def _union_ids(tip, snap):
    """Tip order, then snapshot values that are not already there."""
    out = list(tip or [])
    seen = set()
    for item in out:
        try:
            seen.add(item)
        except TypeError:
            pass
    for item in snap or []:
        try:
            fresh = item not in seen
        except TypeError:
            fresh = item not in out
        if fresh:
            out.append(item)
            try:
                seen.add(item)
            except TypeError:
                pass
    return out


def _pick_list(winner, loser):
    """Winner's list. Aligned slots that are None take the other side's value."""
    if not isinstance(winner, list) or not isinstance(loser, list) or len(winner) != len(loser) or not winner:
        return copy.deepcopy(winner)
    out = []
    for a, b in zip(winner, loser):
        if a is None and b is not None:
            out.append(copy.deepcopy(b))
        elif isinstance(a, list) and isinstance(b, list):
            out.append(_pick_list(a, b))
        else:
            out.append(copy.deepcopy(a))
    return out


def fill_missing(newer, older):
    """Newer record wins every conflict. Keys only the older copy has are added.

    Stamp fields are not copied off the older record, so the result cannot
    carry an older generated / updated / seen / fetchedAt / fetched / asOf / at.
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


def _season_rank(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _seasons_differ(tip, snap):
    if not isinstance(tip, dict) or not isinstance(snap, dict):
        return False
    a, b = _season_rank(tip.get("season")), _season_rank(snap.get("season"))
    return a is not None and b is not None and a != b


def _season_winner(tip, snap):
    """A later season replaces the earlier one. The two are not mixed."""
    a, b = _season_rank(tip.get("season")), _season_rank(snap.get("season"))
    if b is not None and a is not None and b > a:
        return copy.deepcopy(snap)
    return copy.deepcopy(tip)


def _map_keys(tip, snap):
    found = []
    for key in MAP_KEYS:
        tv = tip.get(key) if isinstance(tip, dict) else None
        sv = snap.get(key) if isinstance(snap, dict) else None
        if isinstance(tv, dict) or isinstance(sv, dict):
            found.append(key)
    return found


def _keep_newer_field(out, tip, snap, field):
    """Keep the newer copy of one timestamp that must not decide the whole file."""
    if not isinstance(out, dict) or not isinstance(tip, dict) or not isinstance(snap, dict):
        return
    if field not in tip and field not in snap:
        return
    a = parse_stamp(tip.get(field)) if field in tip else None
    b = parse_stamp(snap.get(field)) if field in snap else None
    if a and b:
        out[field] = tip[field] if a >= b else snap[field]
    elif b and not a:
        out[field] = snap[field]


def _apply_unions(out, tip, snap):
    if not isinstance(out, dict):
        return out
    for key in LIST_UNION_KEYS:
        tv = tip.get(key) if isinstance(tip, dict) else None
        sv = snap.get(key) if isinstance(snap, dict) else None
        if isinstance(tv, list) or isinstance(sv, list):
            out[key] = _union_ids(tv if isinstance(tv, list) else [], sv if isinstance(sv, list) else [])
    _keep_newer_field(out, tip, snap, "scanned")
    return out


def merge_record(tip, snap, parent_tip_stamp, parent_snap_stamp):
    """Merge one map entry. Its own stamp wins; otherwise the file stamp; otherwise the tip."""
    if isinstance(tip, dict) and isinstance(snap, dict):
        ts, ss = record_stamp(tip), record_stamp(snap)
        if ts is not None and ss is not None and ts != ss:
            return fill_missing(tip, snap) if ts > ss else fill_missing(snap, tip)
        if (
            ts is None
            and ss is None
            and parent_tip_stamp is not None
            and parent_snap_stamp is not None
            and parent_tip_stamp != parent_snap_stamp
        ):
            if parent_tip_stamp > parent_snap_stamp:
                return fill_missing(tip, snap)
            return fill_missing(snap, tip)
        return merge_value(tip, snap)
    if isinstance(tip, list) and isinstance(snap, list):
        if (
            parent_tip_stamp is not None
            and parent_snap_stamp is not None
            and parent_tip_stamp != parent_snap_stamp
        ):
            if parent_tip_stamp > parent_snap_stamp:
                return _pick_list(tip, snap)
            return _pick_list(snap, tip)
        return merge_list(tip, snap)
    if (
        parent_snap_stamp is not None
        and parent_tip_stamp is not None
        and parent_snap_stamp > parent_tip_stamp
    ):
        return copy.deepcopy(snap)
    return copy.deepcopy(tip)


def merge_map(tip_map, snap_map, parent_tip_stamp, parent_snap_stamp):
    """Keep tip-only ids, add snapshot-only ids, merge the ids both sides have."""
    if not isinstance(tip_map, dict):
        tip_map = {}
    if not isinstance(snap_map, dict):
        snap_map = {}
    out = {}
    for key in set(tip_map) | set(snap_map):
        if key not in snap_map:
            out[key] = copy.deepcopy(tip_map[key])
        elif key not in tip_map:
            out[key] = copy.deepcopy(snap_map[key])
        else:
            out[key] = merge_record(tip_map[key], snap_map[key], parent_tip_stamp, parent_snap_stamp)
    return out


def merge_value(tip, snap):
    """Merge snapshot `snap` onto tip `tip`. Tip data is never replaced by older data."""
    if isinstance(tip, dict) and isinstance(snap, dict):
        if _seasons_differ(tip, snap):
            return _season_winner(tip, snap)
        tip_stamp, snap_stamp = record_stamp(tip), record_stamp(snap)
        maps = _map_keys(tip, snap)
        if tip_stamp is not None and snap_stamp is not None and tip_stamp != snap_stamp and maps:
            out = fill_missing(tip, snap) if tip_stamp > snap_stamp else fill_missing(snap, tip)
            for key in maps:
                tv = tip.get(key) if isinstance(tip.get(key), dict) else {}
                sv = snap.get(key) if isinstance(snap.get(key), dict) else {}
                out[key] = merge_map(tv, sv, tip_stamp, snap_stamp)
            return _apply_unions(out, tip, snap)
        if tip_stamp is not None and snap_stamp is not None and tip_stamp != snap_stamp:
            out = fill_missing(tip, snap) if tip_stamp > snap_stamp else fill_missing(snap, tip)
            return _apply_unions(out, tip, snap)
        out = {}
        for key in set(tip) | set(snap):
            if key not in snap:
                out[key] = copy.deepcopy(tip[key])
            elif key not in tip:
                out[key] = copy.deepcopy(snap[key])
            elif key in maps:
                out[key] = merge_map(
                    tip.get(key) if isinstance(tip.get(key), dict) else {},
                    snap.get(key) if isinstance(snap.get(key), dict) else {},
                    tip_stamp,
                    snap_stamp,
                )
            elif key in LIST_UNION_KEYS and isinstance(tip.get(key), list) and isinstance(snap.get(key), list):
                out[key] = _union_ids(tip[key], snap[key])
            else:
                out[key] = merge_value(tip[key], snap[key])
        return _apply_unions(out, tip, snap)
    if isinstance(tip, list) and isinstance(snap, list):
        return merge_list(tip, snap)
    return copy.deepcopy(tip)


def merge_findings(tip_items, snap_items, cap=FINDINGS_CAP):
    """Tip order, then snapshot findings not already present. Cap like health_record.

    Tip entries are not dropped to make room for snapshot entries. A tip list
    longer than the cap keeps its tail, which is what `findings[-cap:]` keeps.
    """
    out = []
    seen = set()
    for item in tip_items or []:
        key = canon(item)
        if key in seen:
            continue
        seen.add(key)
        out.append(copy.deepcopy(item))
    if cap is not None and len(out) > cap:
        out = out[-cap:]
        seen = {canon(item) for item in out}
    for item in snap_items or []:
        if cap is not None and len(out) >= cap:
            break
        key = canon(item)
        if key in seen:
            continue
        seen.add(key)
        out.append(copy.deepcopy(item))
    return out


def merge_health_record(tip, snap):
    """One run. Newer `at` / `generated` wins; findings are merged and capped."""
    if not isinstance(tip, dict) or not isinstance(snap, dict):
        return merge_value(tip, snap)
    merged = merge_value(tip, snap)
    if not isinstance(merged, dict):
        return merged
    tip_findings = tip.get("findings") if isinstance(tip.get("findings"), list) else []
    snap_findings = snap.get("findings") if isinstance(snap.get("findings"), list) else []
    if tip_findings or snap_findings:
        merged["findings"] = merge_findings(tip_findings, snap_findings)
    return merged


def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def _load(path: Path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as ex:
        print(f"[merge] skip {path.name}: {ex}", file=sys.stderr)
        return None
    return data


def _write(path: Path, obj) -> bool:
    text = canon(obj)
    if path.is_file():
        try:
            current = path.read_text(encoding="utf-8")
            if current == text:
                return False
            if canon(json.loads(current)) == text:
                return False
        except (OSError, json.JSONDecodeError):
            pass
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
    return True


def _run_id(rec, fallback):
    if isinstance(rec, dict) and rec.get("runId") not in (None, ""):
        return str(rec["runId"])
    return str(fallback)


def merge_tree(src, dst) -> int:
    """Merge every JSON file in `src` onto the same name in `dst`. Files only on `dst` stay."""
    src, dst = Path(src), Path(dst)
    label = dst.name or "snapshot"
    if not src.is_dir():
        print(f"[{label}] no snapshot at {src}")
        return 0
    dst.mkdir(parents=True, exist_ok=True)
    names = sorted(p.name for p in src.glob("*.json") if p.is_file())
    if not names:
        print(f"[{label}] snapshot {src} has no JSON files")
        return 0
    for name in names:
        snap = _load(src / name)
        if snap is None:
            continue
        dest = dst / name
        if not dest.is_file():
            _write(dest, snap)
            print(f"[{label}] {name}: added from snapshot")
            continue
        tip = _load(dest)
        if tip is None:
            print(f"[{label}] {name}: tip unreadable; left untouched", file=sys.stderr)
            continue
        merged = merge_value(tip, snap)
        changed = _write(dest, merged)
        extra = ""
        if isinstance(tip, dict) and isinstance(snap, dict) and isinstance(merged, dict):
            tip_only = len([k for k in tip if k not in snap])
            snap_only = len([k for k in snap if k not in tip])
            extra = f", kept {tip_only} tip-only, added {snap_only} from snapshot, {len(merged)} keys"
        print(f"[{label}] {name}: {'updated' if changed else 'unchanged'}{extra}")
    return 0


def merge_health_dir(src, dst) -> int:
    """Merge health records into `dst/<runId>.json`. Other runs on the tip stay.

    `src` is this run's reliability.json (one record, or a list of records).
    A tip file that is not a run object is left untouched. The writer stores
    one file per run and does not cap how many runs are kept.
    """
    src, dst = Path(src), Path(dst)
    if not src.is_file():
        print(f"[health] no snapshot at {src}")
        return 0
    snap = _load(src)
    if snap is None:
        print(f"[health] {src.name}: unreadable; tip left untouched", file=sys.stderr)
        return 0
    if isinstance(snap, list):
        incoming = [r for r in snap if isinstance(r, dict)]
    elif isinstance(snap, dict):
        incoming = [snap]
    else:
        print(f"[health] {src.name}: not a health record; tip left untouched")
        return 0
    if not incoming:
        print(f"[health] {src.name}: no records")
        return 0
    dst.mkdir(parents=True, exist_ok=True)
    objs = {}
    skipped = set()
    for path in sorted(p for p in dst.glob("*.json") if p.is_file()):
        obj = _load(path)
        if obj is None:
            skipped.add(path.name)
            print(f"[health] {path.name}: tip unreadable; left untouched", file=sys.stderr)
            continue
        if not isinstance(obj, dict):
            skipped.add(path.name)
            print(f"[health] {path.name}: not a run record; left untouched")
            continue
        objs[path.name] = obj
    by_run = {}
    for name, obj in objs.items():
        by_run.setdefault(_run_id(obj, Path(name).stem), []).append(name)
    for rec in incoming:
        rid = _run_id(rec, "local")
        names = by_run.get(rid) or []
        if not names:
            dest_name = f"{rid}.json"
            if dest_name in skipped:
                print(f"[health] {dest_name}: tip unreadable; left untouched", file=sys.stderr)
                continue
            _write(dst / dest_name, rec)
            objs[dest_name] = rec
            by_run.setdefault(rid, []).append(dest_name)
            print(f"[health] {dest_name}: added from snapshot")
            continue
        acc = None
        for name in names:
            acc = objs[name] if acc is None else merge_health_record(acc, objs[name])
        acc = merge_health_record(acc, rec)
        for name in names:
            changed = _write(dst / name, acc)
            objs[name] = acc
            print(f"[health] {name}: {'updated' if changed else 'unchanged'}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Merge a data-history snapshot onto the tip.")
    ap.add_argument("--src", required=True, help="this run's snapshot directory, or a health record file")
    ap.add_argument("--dst", required=True, help="the matching directory on the fetched data-history tip")
    ap.add_argument(
        "--health",
        action="store_true",
        help="src is a health record; merge it into dst/<runId>.json without replacing other runs",
    )
    args = ap.parse_args(argv)
    if args.health or Path(args.src).is_file():
        return merge_health_dir(args.src, args.dst)
    return merge_tree(args.src, args.dst)


if __name__ == "__main__":
    sys.exit(main())
