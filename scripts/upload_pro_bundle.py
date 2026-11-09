#!/usr/bin/env python3
"""Upload the packed Pro bundle to the private Supabase bucket.

Same request as scripts/upload_pro_rankings.py: service role, x-upsert, cache-control 0,
object pro-private/pro-app.js. The key is never printed.

The pack script stamps the current time into the first line, so two packs of the same
source are not byte-identical. This compares the bytes after that line with the object
already stored and skips the upload when they match.

No Odds API call. Exit 1 when an attempted upload fails. Exit 0 when the secret is
missing, the bundle is unchanged, or the upload succeeded.
"""
import argparse
import hashlib
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_URL = "https://ctklbryattbbsqdmteny.supabase.co"
BUCKET = "pro-private"
OBJECT = "pro-app.js"


def scrub(text, key):
    if not key or not text:
        return text or ""
    return str(text).replace(key, "[redacted]")


def under_site(path):
    site = os.path.abspath(os.path.join(ROOT, "site"))
    abs_path = os.path.abspath(path)
    return abs_path == site or abs_path.startswith(site + os.sep)


def payload(data):
    """Bytes that decide whether two packs are the same source. The build-id line carries the clock."""
    if data.startswith(b"window.__PRO_BUILD="):
        nl = data.find(b"\n")
        if nl >= 0:
            return data[nl + 1:]
    return data


def digest(data):
    return hashlib.sha256(payload(data)).hexdigest()


def _request(url, key, data=None, method="GET"):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("apikey", key)
    if data is not None:
        req.add_header("Content-Type", "application/javascript")
        req.add_header("x-upsert", "true")
        req.add_header("cache-control", "0")
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as ex:
        body = ex.read()
        return ex.code, body


def upload(path, base, key, log=print):
    """Return a process exit code. Never log the key."""
    key = (key or "").strip()
    if not key:
        log("[pro-bundle] private upload skipped: SUPABASE_SERVICE_ROLE is not set")
        return 0
    if not path or not os.path.isfile(path):
        log("[pro-bundle] private upload failed: packed bundle is missing")
        log("::error::Pro bundle upload failed: packed file is missing")
        return 1
    if under_site(path):
        log("[pro-bundle] refusing to upload a file from site/")
        log("::error::Pro bundle upload failed: file is under site/")
        return 1
    with open(path, "rb") as fh:
        body = fh.read()
    if b"window.LSProApp" not in body:
        log("[pro-bundle] private upload failed: file is not the Pro bundle")
        log("::error::Pro bundle upload failed: file is not the Pro bundle")
        return 1
    url = base.rstrip("/") + f"/storage/v1/object/{BUCKET}/{OBJECT}"
    status, existing = _request(url, key, method="GET")
    if status == 200 and digest(existing) == digest(body):
        log("[pro-bundle] unchanged: private object matches this pack, not uploaded")
        return 0
    status, detail = _request(url, key, data=body, method="POST")
    if 200 <= status < 300:
        log(f"[pro-bundle] private upload ok: HTTP {status}")
        return 0
    text = scrub(detail.decode("utf-8", "replace")[:180] if isinstance(detail, (bytes, bytearray)) else str(detail)[:180], key)
    log(f"[pro-bundle] private upload failed: HTTP {status} {text}")
    log("::error::Pro bundle upload failed")
    return 1


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=os.path.join(ROOT, "pro", "dist", "pro-app.js"))
    ap.add_argument("--url", default=os.environ.get("SUPABASE_URL") or DEFAULT_URL)
    a = ap.parse_args(argv)
    return upload(a.file, a.url, os.environ.get("SUPABASE_SERVICE_ROLE") or "")


if __name__ == "__main__":
    sys.exit(main())
