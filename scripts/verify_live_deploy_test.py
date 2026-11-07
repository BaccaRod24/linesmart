#!/usr/bin/env python3
"""verify_live_deploy.py: provider-timestamp match, retries, bundle staging. No network.

urllib.request.urlopen is replaced. A real socket open fails the test.
"""
from __future__ import annotations

import json
import socket
import sys
import tempfile
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_live_deploy as V  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
passed = failed = 0


def check(ok, msg):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FAIL:", msg)


def no_net(*_a, **_k):
    raise AssertionError("test tried to open a network connection")


socket.create_connection = no_net
socket.socket.connect = lambda *_a, **_k: no_net()


def meta(generated, as_of, checked, leagues, props, pulled=True):
    return {
        "generated": generated,
        "hardrock": {
            "asOf": as_of,
            "pulledThisRun": pulled,
            "leagues": dict(leagues),
            "props": dict(props),
        },
        "oddsApi": {"checkedAt": checked, "level": "full"},
    }


BUILT = meta(
    "2026-11-07T00:19:08.488259+00:00",
    "2026-11-07T00:14:42Z",
    "2026-11-07T00:18:40Z",
    {"nfl": "2026-11-07T00:14:42Z", "nba": "2026-11-07T00:14:42Z"},
    {"nba": "2026-11-07T00:14:42Z", "nfl": "2026-11-05T23:45:20Z"},
)
STALE = meta(
    "2026-11-06T22:46:18.016505+00:00",
    "2026-11-06T22:45:23Z",
    "2026-11-06T22:45:23Z",
    {"nfl": "2026-11-06T22:45:23Z", "nba": "2026-11-06T22:45:23Z"},
    {"nba": "2026-11-06T21:42:37Z", "nfl": "2026-11-05T23:45:20Z"},
)

check(V.differences(BUILT, json.loads(json.dumps(BUILT))) == [], "identical provider clocks match")
same_odds_new_build = json.loads(json.dumps(BUILT))
same_odds_new_build["generated"] = STALE["generated"]
check(any(d.startswith("generated:") for d in V.differences(BUILT, same_odds_new_build)),
      "same Odds API times with an older build clock do not match")
same_build_old_pull = json.loads(json.dumps(BUILT))
same_build_old_pull["hardrock"]["asOf"] = STALE["hardrock"]["asOf"]
check(any("hardrock.asOf" in d for d in V.differences(BUILT, same_build_old_pull)),
      "a matching build clock with an older odds pull does not match")
old_check = json.loads(json.dumps(BUILT))
old_check["oddsApi"]["checkedAt"] = STALE["oddsApi"]["checkedAt"]
check(any("oddsApi.checkedAt" in d for d in V.differences(BUILT, old_check)),
      "credit-header time is part of the proof")
league_slip = json.loads(json.dumps(BUILT))
league_slip["hardrock"]["leagues"]["nfl"] = "2026-11-06T22:45:23Z"
check(any("hardrock.leagues.nfl" in d for d in V.differences(BUILT, league_slip)),
      "one league's provider pull time is part of the proof")
prop_slip = json.loads(json.dumps(BUILT))
prop_slip["hardrock"]["props"]["nba"] = "2026-11-06T21:42:37Z"
check(any("hardrock.props.nba" in d for d in V.differences(BUILT, prop_slip)),
      "props pull time is part of the proof")
not_pulled = json.loads(json.dumps(BUILT))
not_pulled["hardrock"]["pulledThisRun"] = False
check(V.differences(not_pulled, not_pulled) == [], "a build that did not pull can still match itself")
check(any("pulledThisRun" in d for d in V.differences(BUILT, not_pulled)),
      "pulledThisRun is compared so two files are not treated as one")
check(V.differences(BUILT, STALE), "the stuck public file does not match the later build")
proof = V.format_proof(BUILT)
check("2026-11-07T00:14:42Z" in proof and "oddsApi.checkedAt" in proof and "hardrock.leagues" in proof,
      "the log block shows provider timestamps, not only generated")


class Resp:
    def __init__(self, payload, headers):
        self.headers = headers
        self._payload = payload

    def read(self):
        return json.dumps(self._payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False


calls = []


def opener(req, timeout=30):
    calls.append((req.full_url, dict(req.header_items()), timeout))
    if len(calls) == 1:
        raise urllib.error.URLError("temporary")
    return Resp(BUILT, {"Last-Modified": "Sat, 07 Nov 2026 00:22:00 GMT", "X-Cache": "MISS", "Age": "0"})


result, diff = V.poll_until_match(BUILT, lambda attempt: V.fetch_meta("https://linesmart.app/data/meta.json", attempt, opener=opener),
                                  timeout_s=30, interval_s=0, sleep=lambda _s: None)
check(diff == [] and result["meta"]["hardrock"]["asOf"] == "2026-11-07T00:14:42Z", "poll retries a failed fetch then accepts the live file")
check(len(calls) == 2 and "ls-verify=2-" in calls[1][0], "each attempt uses its own cache-busting query")
check(any(k.lower() == "cache-control" and v == "no-cache" for k, v in calls[0][1].items()), "requests send Cache-Control: no-cache")

stale_only = lambda attempt: {"meta": STALE, "headers": {"x-cache": "MISS"}, "url": "u"}
_res, stuck = V.poll_until_match(BUILT, stale_only, timeout_s=0, interval_s=1, sleep=lambda _s: (_ for _ in ()).throw(AssertionError("should not sleep")))
check(stuck and any("hardrock.asOf" in d for d in stuck) and any(d.startswith("generated:") for d in stuck),
      "timeout reports both the build clock and the provider clock")


def test_cli_rejects_stale(tmp):
    built_path = Path(tmp) / "meta.json"
    built_path.write_text(json.dumps(BUILT), encoding="utf-8")
    seen = {"n": 0}

    def fake_fetch(attempt, _url):
        seen["n"] += 1
        return {"meta": STALE, "headers": {"x-cache": "MISS", "last-modified": "Fri, 06 Nov 2026 22:48:41 GMT"}, "url": "u"}

    real = V.poll_until_match

    def wrapped(expected, fetch, timeout_s, interval_s, sleep=V.time.sleep, now=V.time.monotonic):
        return real(expected, lambda attempt: fake_fetch(attempt, None), 0, 1, sleep=lambda _s: None, now=now)

    V.poll_until_match = wrapped
    try:
        code = V.main(["--meta", str(built_path), "--timeout", "0", "--interval", "1"])
    finally:
        V.poll_until_match = real
    check(code == 1 and seen["n"] == 1, "CLI exits 1 when the live provider timestamps are the old file")


def test_stage_and_stamp(tmp):
    root = Path(tmp)
    nested = root / "dl" / "site"
    (nested / "data").mkdir(parents=True)
    (nested / "data" / "meta.json").write_text("{}", encoding="utf-8")
    (nested / "index.html").write_text("ok", encoding="utf-8")
    (nested / "data" / "nba").mkdir()
    (nested / "data" / "nba" / "index.json").write_text("[]", encoding="utf-8")
    dest = root / "site"
    dest.mkdir()
    (dest / "data").mkdir()
    (dest / "data" / "meta.json").write_text('{"generated":"committed-snapshot"}', encoding="utf-8")
    (dest / "data" / "old-only.json").write_text("stale", encoding="utf-8")
    code = V.main(["--stage-bundle", str(root / "dl"), "--dest", str(dest)])
    check(code == 0 and (dest / "index.html").read_text() == "ok", "nested artifact becomes the site root")
    check(not (dest / "data" / "old-only.json").exists(), "committed snapshot files do not survive staging")
    check(json.loads((dest / "data" / "meta.json").read_text()) == {}, "staged meta replaces the snapshot")

    flat = root / "flat"
    (flat / "data").mkdir(parents=True)
    (flat / "data" / "meta.json").write_text('{"generated":"flat"}', encoding="utf-8")
    (flat / "index.html").write_text("flat", encoding="utf-8")
    dest2 = root / "out"
    V.stage_bundle(flat, dest2)
    check((dest2 / "index.html").read_text() == "flat", "flat artifact layout is the site root")

    wrapped = root / "gh" / "site-bundle" / "site"
    (wrapped / "data").mkdir(parents=True)
    (wrapped / "data" / "meta.json").write_text('{"generated":"wrapped"}', encoding="utf-8")
    (wrapped / "index.html").write_text("wrapped", encoding="utf-8")
    dest3 = root / "wrapped-out"
    V.stage_bundle(root / "gh", dest3)
    check((dest3 / "index.html").read_text() == "wrapped" and not (dest3 / "site-bundle").exists(),
          "gh run download nesting still stages the site root")

    stamp = root / ".github" / "pages-deploy-stamp"
    code = V.main(["--write-stamp", str(stamp), "--run-id", "42317062161", "--attempt", "1",
                   "--built-from", "9a2a1f078a41c19beddfbae040098404f7a9da3f"])
    text = stamp.read_text(encoding="utf-8")
    check(code == 0 and "run=42317062161" in text and "built_from=9a2a1f078a41c19beddfbae040098404f7a9da3f" in text,
          "stamp records the run and the SHA the bundle was built from")
    check("ODDS_API" not in text and "site/data" not in text, "stamp is not the odds payload")
    try:
        V.write_stamp(root / "bad", "not-a-run", "1", "abc123def")
        check(False, "non-numeric run id must be rejected")
    except SystemExit:
        check(True, "non-numeric run id is rejected")


with tempfile.TemporaryDirectory() as d:
    test_cli_rejects_stale(d)
with tempfile.TemporaryDirectory() as d:
    test_stage_and_stamp(d)

wf = (ROOT / ".github/workflows/refresh-and-deploy.yml").read_text(encoding="utf-8")
check("cron: '*/30 * * * *'" in wf, "cron schedule is unchanged")
check("ODDS_RUN_MAX_CREDITS: '250'" in wf and "ODDS_BUDGET: '80000'" in wf and "ODDS_MIN_CREDITS: '300'" in wf,
      "Odds API budget caps are unchanged")
check("publish_run_id" in wf and "(inputs.publish_run_id || '')" in wf, "null schedule inputs count as no publish id")
check("github.event_name == 'push'" in wf and "site-bundle" in wf, "only a push deploys its own SHA; refreshes upload a bundle")
check("verify_live_deploy.py --meta" in wf, "both deploy paths check the live meta.json")
check("keeps the data it already has" in wf, "a failed data build does not publish")
check("actions/deploy-pages@v5" in wf, "deploy still uses the Pages action")
# The scheduled/dispatch path must not upload the Pages artifact under the shared SHA.
upload_at = wf.find("actions/upload-pages-artifact")
check(upload_at > 0 and "github.event_name == 'push'" in wf[:upload_at].split("jobs:")[-1],
      "the build job uploads a Pages artifact only after the push guard")

print(f"\n{passed} passed, {failed} failed" if failed else f"\nall {passed} live-deploy checks passed")
sys.exit(1 if failed else 0)
