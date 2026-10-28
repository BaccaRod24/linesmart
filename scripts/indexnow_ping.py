#!/usr/bin/env python3
"""Tell IndexNow (Bing, Yandex, Seznam, Naver...) which SEO pages are new or changed after a deploy.

Runs as the `indexnow` job in .github/workflows/refresh-and-deploy.yml, after a successful GitHub Pages deploy of main:

    python scripts/indexnow_ping.py --prev _indexnow/prev-sitemap.xml --new _indexnow/new-sitemap.xml

- `--prev` is the live https://linesmart.app/sitemap.xml fetched at the start of the run (before this deploy);
  `--new` is the sitemap this run deployed.
- Only the generated pages block (`<!-- pages:start ... -->` ... `<!-- pages:end -->`, written by seo_pages.py) is
  compared: a URL is sent when it is new or its <lastmod> changed. lastmod only moves when a page's content changes
  (seo_pages.py keeps a content hash per page), so unchanged pages are never re-sent. Removed URLs are not sent.
- At most one POST per run (up to 10,000 URLs) to https://api.indexnow.org/indexnow with host, key and keyLocation.
  The key file is site/<key>.txt, served at https://linesmart.app/<key>.txt.
- Nothing new, no baseline (the live fetch failed) or no key: logs why and skips. Any error is logged and the script
  still exits 0, so it can never fail a deploy.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

HOST = "linesmart.app"
ENDPOINT = "https://api.indexnow.org/indexnow"
MAX_URLS = 10_000
SITE = Path(__file__).resolve().parent.parent / "site"
START = re.compile(r"<!--\s*pages:start\b[^>]*-->")
END = re.compile(r"<!--\s*pages:end\s*-->")
URL = re.compile(r"<url>(.*?)</url>", re.S)
KEY_RE = re.compile(r"^[0-9a-f]{32}$")
STATUS = {200: "OK, URLs received", 202: "accepted, key validation pending", 400: "bad request (invalid format)",
          403: "key not valid (key file missing or not matching)", 422: "URLs don't belong to the host or key mismatch",
          429: "too many requests (rate limited)"}


def log(msg):
    print(f"[indexnow] {msg}", flush=True)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        try:
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
                f.write(f"- IndexNow: {msg}\n")
        except OSError:
            pass


def entries(xml: str | None) -> dict | None:
    """{loc: lastmod} from the generated pages block (whole file if it has no markers). None if not a sitemap."""
    if not xml or "<urlset" not in xml:
        return None
    s, e = START.search(xml), END.search(xml)
    block = xml[s.end():e.start()] if s and e and e.start() > s.end() else xml
    out = {}
    for u in URL.findall(block):
        loc = re.search(r"<loc>\s*(.*?)\s*</loc>", u, re.S)
        lm = re.search(r"<lastmod>\s*(.*?)\s*</lastmod>", u, re.S)
        if loc:
            out[loc.group(1).replace("&amp;", "&")] = lm.group(1) if lm else ""
    return out


def changed(prev: dict, new: dict, host=HOST, limit=MAX_URLS) -> list:
    """New or re-dated URLs on our host, in sitemap order, capped at `limit`."""
    out = []
    for loc, lm in new.items():
        u = urlsplit(loc)
        if u.scheme in ("http", "https") and u.hostname == host and (loc not in prev or prev[loc] != lm):
            out.append(loc)
    return out[:limit]


def find_key(site: Path = SITE) -> str | None:
    """The committed key file site/<32 hex>.txt whose content is its own name."""
    for f in sorted(site.glob("*.txt")):
        if KEY_RE.match(f.stem) and f.read_text(encoding="utf-8").strip() == f.stem:
            return f.stem
    return None


def payload(urls, key, host=HOST):
    return {"host": host, "key": key, "keyLocation": f"https://{host}/{key}.txt", "urlList": urls}


def post(body, endpoint=ENDPOINT, timeout=30):
    req = urllib.request.Request(endpoint, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": "LineSmart-IndexNow/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(500).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, (e.read(500) or b"").decode("utf-8", "replace")


def read(p):
    try:
        return Path(p).read_text(encoding="utf-8") if p and Path(p).is_file() else None
    except OSError:
        return None


def run(prev_path, new_path, site=SITE, endpoint=ENDPOINT, dry_run=False, host=HOST, limit=MAX_URLS) -> dict:
    """Returns {"sent": n, "status": code|None, "skipped": reason|None}. Never raises."""
    try:
        new = entries(read(new_path))
        if not new:
            log(f"skip: no deployed sitemap at {new_path}")
            return {"sent": 0, "status": None, "skipped": "no new sitemap"}
        prev = entries(read(prev_path))
        if prev is None:
            log(f"skip: no live sitemap from before the deploy ({prev_path}); not resubmitting everything blind")
            return {"sent": 0, "status": None, "skipped": "no baseline"}
        urls = changed(prev, new, host, limit)
        if not urls:
            log(f"skip: nothing new or changed ({len(new)} pages in the sitemap)")
            return {"sent": 0, "status": None, "skipped": "nothing new"}
        key = find_key(Path(site))
        if not key:
            log(f"skip: no IndexNow key file (<32 hex>.txt) in {site}")
            return {"sent": 0, "status": None, "skipped": "no key"}
        added = sum(u not in prev for u in urls)
        log(f"{len(urls)} URL(s) to submit ({added} new, {len(urls) - added} changed), e.g. {urls[:3]}")
        if dry_run:
            log("dry run: not sending")
            return {"sent": 0, "status": None, "skipped": "dry run"}
        status, text = post(payload(urls, key, host), endpoint)
        log(f"POST {endpoint}: HTTP {status} {STATUS.get(status, '')}{(' - ' + text.strip()[:200]) if text and text.strip() else ''}")
        if status not in (200, 202):
            print(f"::warning title=IndexNow::HTTP {status} {STATUS.get(status, '')}", flush=True)
        return {"sent": len(urls) if status in (200, 202) else 0, "status": status, "skipped": None}
    except Exception as e:  # never fail the deploy
        log(f"error (ignored): {type(e).__name__}: {e}")
        print(f"::warning title=IndexNow::{type(e).__name__}: {e}", flush=True)
        return {"sent": 0, "status": None, "skipped": f"error: {e}"}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--prev", required=True, help="live sitemap.xml fetched before the deploy")
    ap.add_argument("--new", required=True, help="sitemap.xml this run deployed")
    ap.add_argument("--site", default=str(SITE), help="directory with the <key>.txt file (default: site/)")
    ap.add_argument("--endpoint", default=ENDPOINT)
    ap.add_argument("--dry-run", action="store_true", help="log what would be sent, send nothing")
    try:
        a = ap.parse_args(argv)
        run(a.prev, a.new, a.site, a.endpoint, a.dry_run)
    except SystemExit as e:   # bad arguments: still never fail the deploy
        log(f"bad arguments (ignored): exit {e.code}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
