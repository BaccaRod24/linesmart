#!/usr/bin/env python3
"""Stamp the visible build label into site HTML at deploy time.

Replaces the committed placeholder (meta ls-build-label content="dev" and
"Build dev" inside [data-ls-build]) with "<short sha> · <Mon D, H:MM AM ET>".
Does not read or write browser storage, the service worker, asset URLs, or pro/.
"""
import argparse
import datetime
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
META_RE = re.compile(r'(<meta\s+name="ls-build-label"\s+content=")dev("\s*/?>)', re.I)
TEXT_RE = re.compile(r'(<[^>]*\bdata-ls-build\b[^>]*>)Build dev(</)')


def build_label(sha, when):
    short = re.sub(r"[^0-9a-fA-F]", "", str(sha or ""))[:7] or "unknown"
    if when.tzinfo is None:
        when = when.replace(tzinfo=datetime.timezone.utc)
    local = when.astimezone(ET)
    hour = local.hour % 12 or 12
    ampm = "AM" if local.hour < 12 else "PM"
    return f"{short} · {local.strftime('%b')} {local.day}, {hour}:{local.minute:02d} {ampm} ET"


def stamp_html(text, label):
    text = META_RE.sub(lambda m: m.group(1) + label + m.group(2), text)
    return TEXT_RE.sub(lambda m: m.group(1) + "Build " + label + m.group(2), text)


def stamp_tree(root, label):
    n = 0
    for p in sorted(Path(root).rglob("*.html")):
        raw = p.read_text(encoding="utf-8")
        out = stamp_html(raw, label)
        if out != raw:
            p.write_text(out, encoding="utf-8")
            n += 1
    return n


def main(argv=None):
    ap = argparse.ArgumentParser(description="Stamp the visible LineSmart build label into HTML.")
    ap.add_argument("--root", default="site")
    ap.add_argument("--sha", required=True)
    ap.add_argument("--when", default="", help="ISO time (UTC if naive). Default: now.")
    args = ap.parse_args(argv)
    when = datetime.datetime.now(datetime.timezone.utc)
    if args.when:
        when = datetime.datetime.fromisoformat(args.when.replace("Z", "+00:00"))
    label = build_label(args.sha, when)
    n = stamp_tree(args.root, label)
    print(f"build label: {label} ({n} html file(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
