#!/usr/bin/env python3
"""Upload the Pro rankings snapshot to the private Supabase bucket.

The file must sit outside site/. GitHub Pages never publishes it. The bucket
is private: only is_pro() can read the object. This script can write it only
when SUPABASE_SERVICE_ROLE is set. When that secret is missing, it exits 0
and uploads nothing.

No Odds API call. The key is never printed.
"""
import argparse, json, os, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_URL = "https://ctklbryattbbsqdmteny.supabase.co"
BUCKET = "pro-private"
OBJECT = "rankings.json"


def scrub(text, key):
    if not key or not text:
        return text or ""
    return str(text).replace(key, "[redacted]")


def under_site(path):
    site = os.path.abspath(os.path.join(ROOT, "site"))
    abs_path = os.path.abspath(path)
    return abs_path == site or abs_path.startswith(site + os.sep)


def upload(path, base, key, log=print):
    """Return a process exit code. Never log the key."""
    key = (key or "").strip()
    if not key:
        log("[rankings] private upload skipped: SUPABASE_SERVICE_ROLE is not set")
        return 0
    if not path or not os.path.isfile(path):
        log("[rankings] private upload skipped: snapshot file missing")
        return 0
    if under_site(path):
        log("[rankings] refusing to upload a file from site/")
        return 1
    with open(path, "rb") as fh:
        body = fh.read()
    try:
        json.loads(body.decode("utf-8"))
    except Exception:
        log("[rankings] private upload skipped: snapshot is not JSON")
        return 1
    url = base.rstrip("/") + f"/storage/v1/object/{BUCKET}/{OBJECT}"
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("apikey", key)
    req.add_header("Content-Type", "application/json")
    req.add_header("x-upsert", "true")
    req.add_header("cache-control", "0")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            log(f"[rankings] private upload ok: HTTP {res.status}")
            return 0
    except urllib.error.HTTPError as ex:
        detail = scrub(ex.read().decode("utf-8", "replace")[:180], key)
        log(f"[rankings] private upload failed: HTTP {ex.code} {detail}")
        return 1
    except Exception as ex:
        log(f"[rankings] private upload failed: {scrub(str(ex)[:180], key)}")
        return 1


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=os.path.join(ROOT, "_private", "rankings.json"))
    ap.add_argument("--url", default=os.environ.get("SUPABASE_URL") or DEFAULT_URL)
    a = ap.parse_args(argv)
    return upload(a.file, a.url, os.environ.get("SUPABASE_SERVICE_ROLE") or "")


if __name__ == "__main__":
    sys.exit(main())
