#!/usr/bin/env python3
"""Offline tests for the private rankings upload. No Odds API. Loopback only.

Usage: env -u ODDS_API_KEY python3 scripts/upload_pro_rankings_test.py
"""
import json, os, subprocess, sys, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import upload_pro_rankings as U  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
passed = failed = 0
FAKE = "test-only-not-a-secret"


def check(ok, msg):
    global passed, failed
    print(("PASS" if ok else "FAIL") + " upload_pro_rankings: " + msg)
    if ok:
        passed += 1
    else:
        failed += 1


def run(path, url, key):
    env = os.environ.copy()
    env.pop("ODDS_API_KEY", None)
    env.pop("SUPABASE_SERVICE_ROLE", None)
    if key:
        env["SUPABASE_SERVICE_ROLE"] = key
    return subprocess.run(
        [sys.executable, os.path.join(ROOT, "scripts/upload_pro_rankings.py"), "--file", path, "--url", url],
        capture_output=True, text=True, env=env, cwd=ROOT,
    )


logs = []
check(U.upload("", "http://127.0.0.1", "", log=logs.append) == 0 and any("not set" in x for x in logs), "missing secret skips the upload")
check(all(FAKE not in x for x in logs), "the skip path prints no key")

site_file = os.path.join(ROOT, "site", "rankings-upload-test.json")
try:
    with open(site_file, "w") as fh:
        fh.write('{"v":1}')
    logs = []
    code = U.upload(site_file, "http://127.0.0.1", FAKE, log=logs.append)
    check(code == 1 and any("refusing" in x for x in logs), "a file under site/ is refused")
    check(all(FAKE not in x for x in logs), "a refusal prints no key")
finally:
    if os.path.exists(site_file):
        os.remove(site_file)

seen = {}


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        seen["path"] = self.path
        seen["auth"] = self.headers.get("Authorization") or ""
        seen["api"] = self.headers.get("apikey") or ""
        seen["upsert"] = self.headers.get("x-upsert") or ""
        seen["cache"] = self.headers.get("cache-control") or ""
        seen["body"] = raw
        # Echo the key the way a bad gateway might. The script must not print it.
        msg = json.dumps({"message": "nope " + FAKE}).encode()
        self.send_response(401)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(msg)))
        self.end_headers()
        self.wfile.write(msg)

    def log_message(self, fmt, *args):
        return


srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
fd, name = tempfile.mkstemp(suffix=".json")
os.write(fd, b'{"v":1,"leagues":{"nfl":{"players":[]}}}')
os.close(fd)
try:
    r = run(name, base, FAKE)
    text = r.stdout + r.stderr
    check(r.returncode == 1 and "HTTP 401" in text, "a failed upload reports the status")
    check(FAKE not in text, "the error body is scrubbed before it is printed")
    check(seen.get("path") == "/storage/v1/object/pro-private/rankings.json", "the upload targets the private object")
    check(seen.get("auth") == "Bearer " + FAKE and seen.get("api") == FAKE and seen.get("upsert") == "true", "the request carries the service credential and upsert")
    check(seen.get("cache") == "0" and json.loads(seen.get("body") or b"{}")["v"] == 1, "the body is the snapshot and cache control is 0")
finally:
    os.remove(name)
    srv.shutdown()

src = open(os.path.join(ROOT, "scripts/upload_pro_rankings.py"), encoding="utf-8").read()
check("the-odds-api" not in src and "ODDS_API" not in src, "the uploader does not call the Odds API")
wf = open(os.path.join(ROOT, ".github/workflows/refresh-and-deploy.yml"), encoding="utf-8").read()
check("upload_pro_rankings.py" in wf and "secrets.SUPABASE_SERVICE_ROLE" in wf and "\n          path: site\n" in wf, "CI uploads with the service-role secret and Pages still publishes site/ only")

print(f"PASS upload_pro_rankings: {passed} passed, {failed} failed" if not failed else f"FAIL upload_pro_rankings: {failed} failed, {passed} passed")
sys.exit(1 if failed else 0)
