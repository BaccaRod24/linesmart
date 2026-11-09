#!/usr/bin/env python3
"""Offline tests for the private Pro bundle upload. No Odds API. Loopback only.

Usage: env -u ODDS_API_KEY python3 scripts/upload_pro_bundle_test.py
"""
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import upload_pro_bundle as U  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
passed = failed = 0
FAKE = "test-only-not-a-secret"
BODY = b"window.LSProApp={};\n"


def check(ok, msg):
    global passed, failed
    print(("PASS" if ok else "FAIL") + " upload_pro_bundle: " + msg)
    if ok:
        passed += 1
    else:
        failed += 1


def pack(build, source=BODY):
    return b'window.__PRO_BUILD="' + build.encode() + b'";\n' + source


def run(path, url, key):
    env = os.environ.copy()
    env.pop("ODDS_API_KEY", None)
    env.pop("SUPABASE_SERVICE_ROLE", None)
    if key:
        env["SUPABASE_SERVICE_ROLE"] = key
    return subprocess.run(
        [sys.executable, os.path.join(ROOT, "scripts/upload_pro_bundle.py"), "--file", path, "--url", url],
        capture_output=True, text=True, env=env, cwd=ROOT,
    )


logs = []
check(U.upload("", "http://127.0.0.1", "", log=logs.append) == 0 and any("not set" in x for x in logs), "missing secret skips the upload")
check(all(FAKE not in x for x in logs), "the skip path prints no key")
check(U.digest(pack("abc-2026")) == U.digest(pack("abc-2027")), "the clock in the build id does not count as a change")
check(U.digest(pack("abc-2026", b"one")) != U.digest(pack("abc-2026", b"two")), "a different source is a different pack")

site_file = os.path.join(ROOT, "site", "pro-bundle-upload-test.js")
try:
    with open(site_file, "wb") as fh:
        fh.write(pack("abc-1"))
    logs = []
    code = U.upload(site_file, "http://127.0.0.1", FAKE, log=logs.append)
    check(code == 1 and any("refusing" in x for x in logs), "a file under site/ is refused")
    check(all(FAKE not in x for x in logs), "a refusal prints no key")
finally:
    if os.path.exists(site_file):
        os.remove(site_file)

state = {"stored": None, "posts": 0}


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        state["get"] = self.path
        if state["stored"] is None:
            msg = b'{"error":"not_found","message":"Object not found"}'
            self.send_response(404)
        else:
            msg = state["stored"]
            self.send_response(200)
        self.send_header("Content-Type", "application/javascript")
        self.send_header("Content-Length", str(len(msg)))
        self.end_headers()
        self.wfile.write(msg)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        state["posts"] = state.get("posts", 0) + 1
        state["path"] = self.path
        state["auth"] = self.headers.get("Authorization") or ""
        state["api"] = self.headers.get("apikey") or ""
        state["upsert"] = self.headers.get("x-upsert") or ""
        state["cache"] = self.headers.get("cache-control") or ""
        state["type"] = self.headers.get("Content-Type") or ""
        state["body"] = raw
        if state.get("fail"):
            msg = ('{"message":"nope ' + FAKE + '"}').encode()
            self.send_response(401)
        else:
            state["stored"] = raw
            msg = b'{"Key":"pro-app.js"}'
            self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(msg)))
        self.end_headers()
        self.wfile.write(msg)

    def log_message(self, fmt, *args):
        return


srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
fd, name = tempfile.mkstemp(suffix=".js")
os.write(fd, pack("first-2026-11-09T00:00:00Z"))
os.close(fd)
try:
    r = run(name, base, FAKE)
    text = r.stdout + r.stderr
    check(r.returncode == 0 and "private upload ok: HTTP 200" in text, "a missing object is uploaded")
    check(FAKE not in text, "a successful upload prints no key")
    check(state.get("path") == "/storage/v1/object/pro-private/pro-app.js", "the upload targets pro-app.js")
    check(state.get("auth") == "Bearer " + FAKE and state.get("api") == FAKE and state.get("upsert") == "true", "the request carries the service credential and upsert")
    check(state.get("cache") == "0" and state.get("type") == "application/javascript" and state.get("posts") == 1, "javascript body, cache control 0, one upload")

    with open(name, "wb") as fh:
        fh.write(pack("second-2026-11-09T01:00:00Z"))
    r = run(name, base, FAKE)
    text = r.stdout + r.stderr
    check(r.returncode == 0 and "unchanged" in text and state.get("posts") == 1, "the same source is not uploaded again")
    check(FAKE not in text, "the skip prints no key")

    with open(name, "wb") as fh:
        fh.write(pack("third-2026-11-09T02:00:00Z", BODY + b"changed\n"))
    r = run(name, base, FAKE)
    check(r.returncode == 0 and state.get("posts") == 2, "a changed source is uploaded")

    state["fail"] = True
    with open(name, "wb") as fh:
        fh.write(pack("fourth-2026-11-09T03:00:00Z", BODY + b"again\n"))
    r = run(name, base, FAKE)
    text = r.stdout + r.stderr
    check(r.returncode == 1 and "HTTP 401" in text and "::error::Pro bundle upload failed" in text, "a failed upload is a visible error")
    check(FAKE not in text, "the error body is scrubbed before it is printed")
finally:
    os.remove(name)
    srv.shutdown()

src = open(os.path.join(ROOT, "scripts/upload_pro_bundle.py"), encoding="utf-8").read()
check("the-odds-api" not in src and "ODDS_API" not in src, "the uploader does not call the Odds API")
wf = open(os.path.join(ROOT, ".github/workflows/refresh-and-deploy.yml"), encoding="utf-8").read()
check("upload_pro_bundle.py" in wf and "pack_pro_bundle.mjs" in wf and "secrets.SUPABASE_SERVICE_ROLE" in wf, "CI packs and uploads with the service-role secret")
check("continue-on-error: true" in wf and "github.event_name == 'push'" in wf, "a failed upload stays visible and the step runs on a merge to main")
check("\n          path: site\n" in wf, "Pages still publishes site/ only")

print(f"PASS upload_pro_bundle: {passed} passed, {failed} failed" if not failed else f"FAIL upload_pro_bundle: {failed} failed, {passed} passed")
sys.exit(1 if failed else 0)
