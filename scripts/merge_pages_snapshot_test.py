#!/usr/bin/env python3
"""Retry merge for pages on data-history. Offline: no network, no Odds API.

A rejected push used to copy this run's stale _history/pages snapshot over the
new tip. The tip here has a backfilled game the snapshot lacks, and a newer
copy of a game the snapshot would regress. After the merge both are still there.

    env -u ODDS_API_KEY python3 scripts/merge_pages_snapshot_test.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "merge_pages_snapshot.py"
WF = ROOT / ".github" / "workflows" / "refresh-and-deploy.yml"
os.environ.pop("ODDS_API_KEY", None)

passed = failed = 0


def check(ok, msg):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FAIL", msg)


def dump(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def write(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump(obj), encoding="utf-8")


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def run_merge(src: Path, dst: Path):
    env = dict(os.environ)
    env.pop("ODDS_API_KEY", None)
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--src", str(src), "--dst", str(dst)],
        check=False, capture_output=True, text=True, env=env)


# The shape of the 2026-10-29 retry: the tip moved (backfill landed) and this
# run's snapshot is the archive from before that push.
BACKFILL = "401909870"
NEWER = "401898388"
UPDATED = "200"
SNAP_NEWER = "300"
UNSTAMPED = "400"
THIS_RUN = "401900001"

tip_games = {
    NEWER: {
        "id": NEWER, "generated": "2026-10-29T11:40:00Z", "state": "post", "name": "Memphis Grizzlies at Atlanta Hawks",
        "home": {"abbr": "ATL", "record": "1-0", "score": 110},
        "away": {"abbr": "MEM", "record": "0-1", "score": 99},
    },
    UPDATED: {
        "id": UPDATED, "updated": "2026-10-29T15:00:00Z", "state": "post",
        "home": {"abbr": "BOS", "record": "6-1", "score": 118},
    },
    BACKFILL: {
        "id": BACKFILL, "name": "Chicago Bulls at Boston Celtics", "date": "2026-10-26T23:30Z",
        "state": "post", "statusDetail": "Final",
        "home": {"abbr": "BOS", "record": "2-1", "score": 120},
        "away": {"abbr": "CHI", "record": "1-2", "score": 113},
        "closing": {"books": {"draftkings": {"homeML": -150}}, "closedAt": "2026-10-26T23:20:00Z"},
    },
    SNAP_NEWER: {
        "id": SNAP_NEWER, "generated": "2026-10-29T10:00:00Z", "state": "pre",
        "home": {"abbr": "NY", "record": "1-0"},
        "closing": {"books": {"hardrockbet": {"homeML": -110}}, "closedAt": "2026-10-29T09:00:00Z"},
    },
    UNSTAMPED: {
        "id": UNSTAMPED, "state": "post",
        "home": {"abbr": "DAL", "record": "4-2", "score": 88},
    },
}
snap_games = {
    NEWER: {
        "id": NEWER, "generated": "2026-10-29T11:00:00Z", "state": "pre", "name": "Memphis Grizzlies at Atlanta Hawks",
        "home": {"abbr": "ATL", "record": "0-0", "score": 0},
        "away": {"abbr": "MEM", "record": "0-0"},
        "note": "stale snapshot",
    },
    UPDATED: {
        "id": UPDATED, "updated": "2026-10-29T14:00:00Z", "state": "in",
        "home": {"abbr": "BOS", "record": "5-1", "score": 90},
    },
    SNAP_NEWER: {
        "id": SNAP_NEWER, "generated": "2026-10-29T12:00:00Z", "state": "post",
        "home": {"abbr": "NY", "record": "2-0", "score": 99},
    },
    UNSTAMPED: {
        "id": UNSTAMPED, "state": "pre", "note": "filled by this run",
        "home": {"abbr": "DAL", "record": "3-2", "score": 70},
    },
    THIS_RUN: {
        "id": THIS_RUN, "generated": "2026-10-29T11:34:00Z", "state": "post", "name": "archived by this run",
        "home": {"abbr": "MIA", "record": "3-2", "score": 101},
    },
}
tip_state = {
    "paths": {"nba": {
        BACKFILL: ["nba/games/chicago-bulls-at-boston-celtics-2026-10-26/"],
        "1": ["nba/games/a/"],
    }},
    "lastmod": {"nba/games/a/": ["aaaa", "2026-10-29T12:00:00Z"]},
    "published": {"nba/games/a/": "2026-10-28T00:00:00Z"},
}
snap_state = {
    "paths": {"nba": {"1": ["nba/games/a/", "nba/games/a-old/"], "2": ["nba/games/b/"]}},
    "lastmod": {
        "nba/games/a/": ["bbbb", "2026-10-29T11:00:00Z"],
        "nba/games/b/": ["cccc", "2026-10-29T11:30:00Z"],
    },
    "published": {"nba/games/a/": "2026-10-27T00:00:00Z"},
}
tip_players = {"10": {"seen": "2026-10-29T12:00:00Z", "p": {"n": "Jayson Tatum"}, "rows": [["g-new"]]}}
snap_players = {
    "10": {"seen": "2026-10-29T09:00:00Z", "p": {"n": "Jayson Tatum"}, "rows": [["g-old"]]},
    "11": {"seen": "2026-10-29T11:00:00Z", "p": {"n": "Jaylen Brown"}, "rows": [["g2"]]},
}

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    src, dst = root / "snap", root / "pages"
    write(dst / "games-nba.json", tip_games)
    write(dst / "games-mlb.json", {"9": {"id": "9", "home": {"record": "10-5"}}})
    write(dst / "state.json", tip_state)
    write(dst / "players-nba.json", tip_players)
    write(src / "games-nba.json", snap_games)
    write(src / "state.json", snap_state)
    write(src / "players-nba.json", snap_players)
    write(src / "games-nhl.json", {"7": {"id": "7", "generated": "2026-10-29T11:34:00Z", "home": {"record": "1-0"}}})
    (src / "games-nfl.json").write_text("{not json", encoding="utf-8")
    write(dst / "games-nfl.json", {"8": {"id": "8", "home": {"record": "2-0"}}})

    first = run_merge(src, dst)
    check(first.returncode == 0, f"merge exits 0 ({first.returncode} {first.stderr})")
    games = load(dst / "games-nba.json")
    backfill = games.get(BACKFILL)
    check(backfill == tip_games[BACKFILL], "retry keeps the backfilled game the stale snapshot lacks")
    check(isinstance(backfill, dict) and backfill.get("closing", {}).get("closedAt") == "2026-10-26T23:20:00Z",
          "backfill closing lines stay on the tip")
    newer = games.get(NEWER) or {}
    check(newer.get("generated") == "2026-10-29T11:40:00Z" and newer.get("state") == "post",
          "newer generated stamp is not replaced by the snapshot")
    check((newer.get("home") or {}).get("record") == "1-0" and (newer.get("home") or {}).get("score") == 110,
          "game record and score are not regressed to the older snapshot")
    check(newer.get("note") == "stale snapshot", "a field only the snapshot has is still unioned in")
    updated = games.get(UPDATED) or {}
    check(updated.get("updated") == "2026-10-29T15:00:00Z" and (updated.get("home") or {}).get("record") == "6-1",
          "newer updated stamp keeps that game's record")
    brought = games.get(SNAP_NEWER) or {}
    check(brought.get("generated") == "2026-10-29T12:00:00Z" and (brought.get("home") or {}).get("record") == "2-0"
          and brought.get("state") == "post", "a newer snapshot copy supplies the new record")
    check((brought.get("closing") or {}).get("closedAt") == "2026-10-29T09:00:00Z",
          "tip-only closing stays when the snapshot's stamp is newer")
    plain = games.get(UNSTAMPED) or {}
    check((plain.get("home") or {}).get("record") == "4-2" and (plain.get("home") or {}).get("score") == 88
          and plain.get("state") == "post", "without stamps the tip's record is not replaced")
    check(plain.get("note") == "filled by this run", "without stamps a snapshot-only field is kept")
    check((games.get(THIS_RUN) or {}).get("name") == "archived by this run", "this run's new game is added")
    check(load(dst / "games-mlb.json")["9"]["home"]["record"] == "10-5", "a tip file the snapshot lacks stays")
    check(load(dst / "games-nhl.json")["7"]["id"] == "7", "a snapshot file the tip lacks is added")
    check(load(dst / "games-nfl.json")["8"]["home"]["record"] == "2-0", "a broken snapshot does not wipe the tip file")

    state = load(dst / "state.json")
    paths = state["paths"]["nba"]
    check(paths.get(BACKFILL) == ["nba/games/chicago-bulls-at-boston-celtics-2026-10-26/"],
          "state.json keeps the backfill path")
    check(paths.get("1") == ["nba/games/a/", "nba/games/a-old/"], "path lists union, tip order first")
    check(paths.get("2") == ["nba/games/b/"], "snapshot-only paths are added")
    check(state["lastmod"]["nba/games/a/"] == ["aaaa", "2026-10-29T12:00:00Z"],
          "lastmod is not regressed to the older snapshot")
    check(state["lastmod"]["nba/games/b/"][1] == "2026-10-29T11:30:00Z", "snapshot-only lastmod is added")
    check(state["published"]["nba/games/a/"] == "2026-10-28T00:00:00Z", "published on the tip is not replaced")

    players = load(dst / "players-nba.json")
    check(players["10"]["seen"] == "2026-10-29T12:00:00Z" and players["10"]["rows"] == [["g-new"]],
          "a newer player seen stamp is not replaced")
    check(players["11"]["p"]["n"] == "Jaylen Brown", "a player only in the snapshot is added")

    again = run_merge(src, dst)
    check(again.returncode == 0 and "unchanged" in again.stdout, "a second merge does not rewrite settled files")
    check(load(dst / "games-nba.json") == games, "merging again leaves the games file the same")

src_text = SCRIPT.read_text(encoding="utf-8")
check("the-odds-api" not in src_text and "ODDS_API" not in src_text and "urlopen" not in src_text,
      "the merge script does not call the Odds API")

wf = WF.read_text(encoding="utf-8")
step = wf.split("Save line history snapshot", 1)[1].split("\n      - name:", 1)[0]
check("git reset -q --hard origin/data-history" in step, "retry re-fetches the tip before merging")
check("merge_pages_snapshot.py --src ../.linehist-snap/_pages --dst pages" in step,
      "retry merges the pages snapshot onto the tip")
check("cp -f ../.linehist-snap/_pages" not in step and "cp -f" not in step.split("_pages", 1)[-1].split("\n", 1)[0],
      "retry does not copy the stale pages snapshot over the tip")
reset_at = step.find("git reset -q --hard origin/data-history")
merge_at = step.find("merge_pages_snapshot.py")
add_at = step.find("git add -A", merge_at)
check(reset_at != -1 and merge_at > reset_at and add_at > merge_at, "merge runs after the tip reset and before the new commit")
pushes = [line.strip() for line in step.splitlines() if "git push" in line]
check(pushes and all("--force" not in line and "force-with-lease" not in line and " -f" not in line for line in pushes),
      f"data-history push is not a force push ({pushes})")

print(f"{'PASS' if not failed else 'FAIL'} merge_pages_snapshot: {passed}/{passed + failed}")
sys.exit(1 if failed else 0)
