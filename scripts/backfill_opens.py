#!/usr/bin/env python3
"""Correct stored opening lines from the snapshots already in a history directory.

Reads history/<league>.json (the data-history files). For each game, the opening
line is checked against that book's recorded points with line_history.reconcile_open.
A spread that sits on the opposite side of its own opening moneyline is swapped.
A basketball total that never appears within 4 points of any recorded total is
replaced with the first total those snapshots recorded.

Dry-run by default: prints before and after, writes nothing. --write updates the
JSON files in place. This script does not push, does not call The Odds API, and
does not touch a live site.

    env -u ODDS_API_KEY python3 scripts/backfill_opens.py --history-dir /path/to/history
    env -u ODDS_API_KEY python3 scripts/backfill_opens.py --history-dir /path/to/history --write
"""
import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import line_history as LH

LABELS = {"hs": "home spread", "as": "away spread", "hml": "home ML", "aml": "away ML",
          "dml": "draw ML", "tot": "total"}


def show(v, key):
    """American prices and spreads get a sign. Totals stay plain."""
    if v is None: return "—"
    n = float(v)
    if key == "tot":
        return f"{n:g}"
    return f"{n:+g}"


def correct_file(path, write):
    with open(path) as fh:
        hist = json.load(fh)
    kind = LH.league_kind(hist.get("league"))
    changes = []
    games = hist.get("games") or {}
    rows = [(gid, g) for gid, g in games.items() if isinstance(g, dict)] if isinstance(games, dict) else []
    for gid, g in sorted(rows, key=lambda kv: ((kv[1].get("date") or ""), kv[0])):
        for bk, op in list((g.get("open") or {}).items()):
            series = [p[1] for p in (g.get("books") or {}).get(bk) or [] if isinstance(p, list) and len(p) > 1]
            new = LH.reconcile_open(op, series, kind)
            if new == op: continue
            diffs = [(k, op.get(k), new.get(k)) for k in list(op) + [k for k in new if k not in op] if op.get(k) != new.get(k)]
            changes.append((gid, g, bk, diffs))
            if write:
                g["open"][bk] = new
    if write and changes:
        LH.save(path, hist)
    return changes


def main():
    ap = argparse.ArgumentParser(description="Correct stored opening lines from history snapshots (dry-run unless --write).")
    ap.add_argument("--history-dir", required=True, help="directory of history/<league>.json files")
    ap.add_argument("--write", action="store_true", help="rewrite the JSON files in place (still does not push)")
    args = ap.parse_args()
    files = sorted(glob.glob(os.path.join(args.history_dir, "*.json")))
    if not files:
        print(f"No history JSON in {args.history_dir}")
        return 1
    total = 0
    for path in files:
        changes = correct_file(path, args.write)
        if not changes: continue
        print(f"\n{os.path.basename(path)}: {len(changes)} opener(s)")
        for gid, g, bk, diffs in changes:
            print(f"  {g.get('away')}@{g.get('home')}  {gid}  {bk}  {g.get('date')}")
            for k, before, after in diffs:
                print(f"    {LABELS.get(k, k)}: {show(before, k)} -> {show(after, k)}")
            if any(k in ("hs", "as") for k, _, _ in diffs):
                op = (g.get("open") or {}).get(bk) or {}
                print(f"    home ML: {show(op.get('hml'), 'hml')} (unchanged)")
                print(f"    away ML: {show(op.get('aml'), 'aml')} (unchanged)")
        total += len(changes)
    if not total:
        print("No opening lines need a correction.")
    else:
        print(f"\n{total} opener(s) {'updated' if args.write else 'would change'}. {'Files written.' if args.write else 'Dry run: no files written.'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
