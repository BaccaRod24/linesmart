#!/usr/bin/env python3
"""Prove a Pages deploy is actually being served, and stage the built site bundle.

actions/deploy-pages reports success when GitHub accepts the deployment id. That
id is the commit SHA. A refresh that does not create a commit reuses the id, and
the origin can keep serving the previous files. This script fails unless the
public meta.json matches the bundle just built.

The match includes the build clock (generated) and the provider clocks:
hardrock.asOf and hardrock.leagues / hardrock.props are Odds API pull times,
and oddsApi.checkedAt is when the budget guard read the provider credit headers.
A green Pages status is not input to this check.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Scalars compared exactly. generated is this process's clock; the others are
# times the Odds API (or its credit headers) reported, persisted on data-history.
PROOF_SCALARS = (
    ("generated", ("generated",)),
    ("hardrock.asOf", ("hardrock", "asOf")),
    ("hardrock.pulledThisRun", ("hardrock", "pulledThisRun")),
    ("oddsApi.checkedAt", ("oddsApi", "checkedAt")),
)
# Per-league provider pull times. Equal maps mean the served odds payload is this build's.
PROOF_MAPS = (
    ("hardrock.leagues", ("hardrock", "leagues")),
    ("hardrock.props", ("hardrock", "props")),
)


def dig(obj, path):
    cur = obj
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            return None
        cur = cur[key]
    return cur


def differences(expected, live):
    """Empty when the live site is serving this build's file, provider clocks included."""
    if not isinstance(expected, dict) or not isinstance(live, dict):
        return ["meta.json is not a JSON object on one side"]
    out = []
    for label, path in PROOF_SCALARS:
        ev, lv = dig(expected, path), dig(live, path)
        if ev != lv:
            out.append(f"{label}: built {ev!r} but the live site has {lv!r}")
    for label, path in PROOF_MAPS:
        ev = dig(expected, path)
        lv = dig(live, path)
        ev = ev if isinstance(ev, dict) else {}
        lv = lv if isinstance(lv, dict) else {}
        if ev == lv:
            continue
        keys = sorted(set(ev) | set(lv))
        mismatched = [k for k in keys if ev.get(k) != lv.get(k)]
        if not mismatched:
            out.append(f"{label}: built {ev!r} but the live site has {lv!r}")
            continue
        for key in mismatched:
            out.append(f"{label}.{key}: built {ev.get(key)!r} but the live site has {lv.get(key)!r}")
    return out


def format_proof(meta):
    """One block a person can compare to the public site without trusting Actions."""
    if not isinstance(meta, dict):
        return "(no meta.json)"
    lines = []
    for label, path in PROOF_SCALARS:
        lines.append(f"  {label}: {dig(meta, path)}")
    for label, path in PROOF_MAPS:
        val = dig(meta, path)
        if not isinstance(val, dict) or not val:
            lines.append(f"  {label}: {val}")
            continue
        body = ", ".join(f"{k}={val[k]}" for k in sorted(val))
        lines.append(f"  {label}: {body}")
    return "\n".join(lines)


def fetch_meta(url, attempt, opener=urllib.request.urlopen, timeout=30):
    """GET meta.json with a unique query so a CDN entry for the bare URL is not reused."""
    sep = "&" if "?" in url else "?"
    full = f"{url}{sep}ls-verify={attempt}-{int(time.time())}"
    req = urllib.request.Request(full, headers={
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Accept": "application/json",
        "User-Agent": "linesmart-deploy-verify",
    })
    with opener(req, timeout=timeout) as res:
        body = res.read()
        headers = {k.lower(): v for k, v in res.headers.items()}
    return {"meta": json.loads(body.decode("utf-8")), "headers": headers, "url": full}


def poll_until_match(expected, fetch, timeout_s, interval_s, sleep=time.sleep, now=time.monotonic):
    """Retry until `fetch()` returns meta that matches `expected`, or the timeout elapses.

    `fetch` takes the 1-based attempt number and returns {"meta", "headers", "url"}.
    Returns (result_or_None, differences). differences is empty on success.
    """
    started = now()
    attempt = 0
    last_result = None
    last_diff = ["no response yet"]
    while True:
        attempt += 1
        try:
            last_result = fetch(attempt)
            last_diff = differences(expected, last_result.get("meta"))
        except (OSError, urllib.error.URLError, json.JSONDecodeError, UnicodeError, ValueError) as ex:
            last_result = None
            last_diff = [f"fetch failed: {ex}"]
        if not last_diff:
            return last_result, []
        elapsed = now() - started
        if elapsed >= timeout_s:
            return last_result, last_diff
        sleep(min(interval_s, timeout_s - elapsed))


def header_line(result):
    if not result:
        return "response headers: (none)"
    headers = result.get("headers") or {}
    keep = ("date", "last-modified", "age", "x-cache", "x-cache-hits", "cache-control")
    parts = [f"{k}={headers[k]}" for k in keep if headers.get(k)]
    return "response headers: " + (", ".join(parts) if parts else "(none of the cache headers)")


def write_summary(text):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(text)
        if not text.endswith("\n"):
            fh.write("\n")


def verify(meta_path, url, timeout_s, interval_s, fetch=None):
    expected = json.loads(Path(meta_path).read_text(encoding="utf-8"))
    print("Built bundle (this is what must be on the public site):")
    print(format_proof(expected))
    if fetch is None:
        def fetch(attempt, _url=url):
            return fetch_meta(_url, attempt)

    result, diff = poll_until_match(expected, fetch, timeout_s, interval_s)
    live = (result or {}).get("meta")
    print("Live site:")
    print(format_proof(live))
    print(header_line(result))
    if diff:
        print("Live site does not match this build:", file=sys.stderr)
        for line in diff:
            print(f"  {line}", file=sys.stderr)
        write_summary("\n".join([
            "### Pages publish did not reach the public site",
            "",
            "Deploy status is not the check. `data/meta.json` on the public site disagreed with this build:",
            "",
            "```",
            *diff,
            "```",
            "",
            "Built:",
            "```",
            format_proof(expected),
            "```",
            "",
            "Live:",
            "```",
            format_proof(live),
            "```",
            "",
        ]))
        return 1
    print("Live site matches this build, including Odds API provider timestamps.")
    write_summary("\n".join([
        "### Public site is serving this build",
        "",
        "Checked `data/meta.json` on the public site (cache-busted). Provider timestamps, not the Pages status:",
        "",
        "```",
        format_proof(live),
        "```",
        "",
        header_line(result),
        "",
    ]))
    return 0


def write_stamp(path, run_id, attempt, built_from, when=None):
    """A few-line file whose commit becomes the Pages deployment id. Not the odds data."""
    run_id = str(run_id)
    attempt = str(attempt)
    built_from = str(built_from)
    if not run_id.isdigit() or not attempt.isdigit():
        raise SystemExit("stamp run id and attempt must be numbers")
    if not built_from or any(c not in "0123456789abcdef" for c in built_from.lower()) or len(built_from) < 7:
        raise SystemExit("stamp built_from must be the commit SHA the bundle was built from")
    when = when or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    text = (
        "# Rewritten by .github/workflows/refresh-and-deploy.yml before each scheduled publish.\n"
        "# The commit that changes this file is the GitHub Pages deployment id (pages_build_version).\n"
        "# Odds data is not in this file and is not committed.\n"
        f"run={run_id}\n"
        f"attempt={attempt}\n"
        f"built_from={built_from}\n"
        f"written_at={when}\n"
    )
    dest = Path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8")
    return text


def stage_bundle(src, dest):
    """Replace `dest` with the site tree stored in an Actions artifact download.

    The archive root is either the site contents, `site/`, or a directory named
    after the artifact (`gh run download` does that). Anything already in `dest`
    (the committed data snapshot from checkout) is removed so stale game files
    cannot ride along.
    """
    src = Path(src)
    dest = Path(dest)
    candidates = []
    for meta in src.rglob("meta.json"):
        if meta.parent.name != "data":
            continue
        root = meta.parent.parent
        if (root / "index.html").is_file():
            candidates.append(root)
    if not candidates:
        raise SystemExit(f"site bundle {src} has no data/meta.json next to index.html")
    root = min(candidates, key=lambda p: len(p.parts))
    if dest.exists():
        shutil.rmtree(dest)
    shutil.move(str(root), str(dest))
    if not (dest / "data" / "meta.json").is_file() or not (dest / "index.html").is_file():
        raise SystemExit(f"staged site at {dest} is missing index.html or data/meta.json")
    return dest


def main(argv):
    p = argparse.ArgumentParser(description="Check the public site is serving this build, or stage a site bundle.")
    p.add_argument("--meta", help="meta.json from the bundle that was deployed")
    p.add_argument("--url", default="https://linesmart.app/data/meta.json")
    p.add_argument("--timeout", type=float, default=240)
    p.add_argument("--interval", type=float, default=10)
    p.add_argument("--stage-bundle", help="directory from `gh run download` of the site bundle")
    p.add_argument("--dest", help="directory to replace with the staged site")
    p.add_argument("--write-stamp", help="path of the Pages deployment-id stamp to write")
    p.add_argument("--run-id")
    p.add_argument("--attempt")
    p.add_argument("--built-from")
    args = p.parse_args(argv)
    modes = [bool(args.meta), bool(args.stage_bundle), bool(args.write_stamp)]
    if sum(modes) != 1:
        p.error("pass exactly one of --meta, --stage-bundle, --write-stamp")
    if args.stage_bundle:
        if not args.dest:
            p.error("--stage-bundle requires --dest")
        stage_bundle(args.stage_bundle, args.dest)
        print(f"staged site at {args.dest}")
        return 0
    if args.write_stamp:
        if not args.run_id or not args.attempt or not args.built_from:
            p.error("--write-stamp requires --run-id, --attempt, and --built-from")
        write_stamp(args.write_stamp, args.run_id, args.attempt, args.built_from)
        print(f"wrote {args.write_stamp}")
        return 0
    if args.timeout < 0 or args.interval <= 0:
        p.error("--timeout must be >= 0 and --interval must be > 0")
    return verify(args.meta, args.url, args.timeout, args.interval)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
