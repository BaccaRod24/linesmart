#!/usr/bin/env python3
"""Publish-stamp decision: newer odds can stamp, older odds and code pushes cannot.

    env -u ODDS_API_KEY python3 scripts/publish_stamp_decision_test.py

No network. Git remotes are local directories. A socket open fails the test.
"""
from __future__ import annotations

import io
import json
import os
import socket
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

os.environ.pop("ODDS_API_KEY", None)
sys.path.insert(0, str(Path(__file__).resolve().parent))

import publish_stamp_decision as D  # noqa: E402
import yaml  # noqa: E402


def no_net(*_a, **_k):
    raise AssertionError("test tried to open a network connection")


socket.create_connection = no_net
socket.socket.connect = lambda *_a, **_k: no_net()

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows" / "refresh-and-deploy.yml"
BUILD = "a" * 40
TIP = "b" * 40
PARENT = "c" * 40
HEAD = "d" * 40
OTHER = "e" * 40

OLD = {
    "leagues": {"nba": "2026-11-17T20:15:00Z", "nfl": "2026-11-17T20:15:00Z"},
    "props": {"nba": "2026-11-17T18:00:00Z", "nfl": "2026-11-17T18:00:00Z"},
}
NEW = {
    "leagues": {"nba": "2026-11-17T20:45:01Z", "nfl": "2026-11-17T20:45:01Z"},
    "props": {"nba": "2026-11-17T18:00:00Z", "nfl": "2026-11-17T18:00:00Z"},
}
NEWER = {
    "leagues": {"nba": "2026-11-17T20:50:00Z", "nfl": "2026-11-17T20:50:00Z"},
    "props": {"nba": "2026-11-17T18:00:00Z", "nfl": "2026-11-17T18:00:00Z"},
}

passed = failed = 0


def check(ok, msg):
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
        print("FAIL:", msg)


def git(repo, *args, check_ok=True):
    proc = subprocess.run(
        ["git", "--no-pager", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_PAGER": "cat", "ODDS_API_KEY": ""},
    )
    proc_env_note = proc
    if check_ok and proc.returncode != 0:
        raise AssertionError(f"git {args} failed\n{proc.stderr}\n{proc.stdout}")
    return proc_env_note


def git_out(repo, *args):
    return git(repo, *args).stdout.strip()


def make_remote(tmp, name="repo"):
    bare = tmp / f"{name}.git"
    seed = tmp / f"{name}-seed"
    seed.mkdir()
    git(seed, "init", "-q", "-b", "main")
    git(seed, "config", "user.email", "test@example.com")
    git(seed, "config", "user.name", "test")
    git(seed, "config", "commit.gpgsign", "false")
    (seed / "README").write_text("code\n", encoding="utf-8")
    stamp = seed / ".github" / "pages-deploy-stamp"
    stamp.parent.mkdir(parents=True)
    stamp.write_text("run=1\nattempt=1\nbuilt_from=bbbbbbb\nwritten_at=2026-11-17T19:00:00Z\n", encoding="utf-8")
    git(seed, "add", "-A")
    git(seed, "commit", "-qm", "initial")
    subprocess.check_call(["git", "init", "--bare", "-q", "-b", "main", str(bare)])
    git(seed, "remote", "add", "origin", str(bare))
    git(seed, "push", "-q", "origin", "main")
    return bare, git_out(seed, "rev-parse", "HEAD")


def clone(tmp, bare, name, depth=None):
    dest = tmp / name
    # A local path ignores --depth. file:// is a real shallow clone, like Actions.
    source = "file://" + str(bare.resolve()) if depth else str(bare)
    cmd = ["git", "clone", "-q"]
    if depth:
        cmd.extend(["--depth", str(depth)])
    cmd.extend([source, str(dest)])
    subprocess.check_call(cmd)
    git(dest, "config", "user.email", "test@example.com")
    git(dest, "config", "user.name", "test")
    git(dest, "config", "commit.gpgsign", "false")
    return dest


def remote_tip(bare):
    return subprocess.check_output(
        ["git", "--git-dir", str(bare), "rev-parse", "main"], text=True).strip()


def remote_ancestor(bare, ancestor, tip):
    proc = subprocess.run(
        ["git", "--git-dir", str(bare), "merge-base", "--is-ancestor", ancestor, tip])
    return proc.returncode == 0


def remote_names(bare, older, newer):
    out = subprocess.check_output(
        ["git", "--git-dir", str(bare), "diff", "--name-only", older, newer], text=True)
    return [line for line in out.splitlines() if line]


def remote_subject(bare, sha="main"):
    return subprocess.check_output(
        ["git", "--git-dir", str(bare), "log", "-1", "--format=%s", sha], text=True).strip()


def remote_file(bare, sha, path):
    return subprocess.check_output(
        ["git", "--git-dir", str(bare), "show", f"{sha}:{path}"], text=True)


def sync(repo):
    git(repo, "fetch", "-q", "origin", "main")
    git(repo, "reset", "--hard", "-q", "FETCH_HEAD")


def push_stamp(repo, run_id, clocks, message=None):
    sync(repo)
    parent = git_out(repo, "rev-parse", "HEAD")
    D.write_stamp_file(repo / D.STAMP_PATH, run_id, "1", parent, clocks)
    git(repo, "add", "--", D.STAMP_PATH)
    git(repo, "commit", "-qm", message or f"Publish pages data 2026-11-17T20:46Z (run {run_id})")
    git(repo, "push", "-q", "origin", "HEAD:refs/heads/main")
    return git_out(repo, "rev-parse", "HEAD")


def push_old_stamp(repo, run_id):
    sync(repo)
    path = repo / D.STAMP_PATH
    path.write_text(
        "# Rewritten by .github/workflows/refresh-and-deploy.yml before each scheduled publish.\n"
        "# The commit that changes this file is the GitHub Pages deployment id (pages_build_version).\n"
        "# Odds data is not in this file and is not committed.\n"
        f"run={run_id}\n"
        "attempt=1\n"
        f"built_from={'a' * 40}\n"
        "written_at=2026-11-17T20:46:47Z\n",
        encoding="utf-8",
    )
    git(repo, "add", "--", D.STAMP_PATH)
    git(repo, "commit", "-qm", f"Publish pages data 2026-11-17T20:46Z (run {run_id})")
    git(repo, "push", "-q", "origin", "HEAD:refs/heads/main")
    return git_out(repo, "rev-parse", "HEAD")


def push_code(repo, message="Add a page"):
    sync(repo)
    readme = repo / "README"
    readme.write_text(readme.read_text(encoding="utf-8") + "more code\n", encoding="utf-8")
    git(repo, "add", "--", "README")
    git(repo, "commit", "-qm", message)
    git(repo, "push", "-q", "origin", "HEAD:refs/heads/main")
    return git_out(repo, "rev-parse", "HEAD")


def run_publish(repo, build, clocks, loader=None, before=None, pusher=None, max_pushes=5):
    return D.publish(
        repo, build, "44172576362", "1", clocks,
        meta_loader=loader, before_push=before, pusher=pusher,
        sleep=lambda _s: None, max_pushes=max_pushes,
    )


def boom(_run_id):
    raise AssertionError("bundle loader should not run when the stamp records pull times")


# --- pure decision -----------------------------------------------------------

check(D.compare_clocks(NEW, OLD) == "newer", "a later provider pull is newer")
check(D.compare_clocks(OLD, NEW) == "older", "an earlier provider pull is older")
check(D.compare_clocks(NEW, NEW) == "equal", "the same pull times are equal")
check(D.decide(BUILD, BUILD, "code", NEW, OLD) == ("publish", "unchanged"),
      "main unchanged publishes before the move is classified")
check(D.decide(BUILD, TIP, "stamp", NEW, OLD) == ("publish", "newer-stamp"),
      "main moved to an older-odds stamp publishes")
check(D.decide(BUILD, TIP, "stamp", OLD, NEW) == ("skip", "not-newer"),
      "main moved to a newer-odds stamp skips")
check(D.decide(BUILD, TIP, "stamp", NEW, NEW) == ("skip", "not-newer"),
      "equal odds on a stamp skip")
check(D.decide(BUILD, TIP, "code", NEW, OLD) == ("skip", "code"),
      "a code push skips even when this bundle's odds are newer")
check(D.decide(BUILD, TIP, "unrelated", NEW, OLD) == ("skip", "unrelated"),
      "history that does not contain the build commit skips")
check(D.decide(BUILD, TIP, "stamp", NEW, None) == ("skip", "unknown-clocks"),
      "a stamp with no comparable pull times skips")

mixed_ours = {"leagues": {"nfl": "2026-11-17T20:45:00Z", "nba": "2026-11-17T20:00:00Z"}, "props": {}}
mixed_theirs = {"leagues": {"nfl": "2026-11-17T20:15:00Z", "nba": "2026-11-17T20:30:00Z"}, "props": {}}
check(D.compare_clocks(mixed_ours, mixed_theirs) == "mixed", "one newer league and one older league is mixed")
check(D.decide(BUILD, TIP, "stamp", mixed_ours, mixed_theirs)[0] == "skip",
      "a mixed bundle does not publish over a newer league")

missing = {"leagues": {"nfl": "2026-11-17T20:45:00Z"}, "props": {}}
full_old = {"leagues": {"nba": "2026-11-17T20:15:00Z", "nfl": "2026-11-17T20:15:00Z"}, "props": {}}
check(D.compare_clocks(missing, full_old) == "mixed", "dropping a league the other bundle published is not newer")
extra = {"leagues": {"nba": "2026-11-17T20:15:00Z", "nfl": "2026-11-17T20:45:00Z"}, "props": {"nba": "2026-11-17T19:00:00Z"}}
same_games = {"leagues": {"nba": "2026-11-17T20:15:00Z", "nfl": "2026-11-17T20:15:00Z"}, "props": {}}
check(D.compare_clocks(extra, same_games) == "newer", "a new props pull with equal game lines is newer")

offset = {"leagues": {"nfl": "2026-11-17T15:45:00-05:00"}, "props": {}}
zulu = {"leagues": {"nfl": "2026-11-17T20:45:00Z"}, "props": {}}
later_fraction = {"leagues": {"nfl": "2026-11-17T20:45:00.500000Z"}, "props": {}}
check(D.compare_clocks(offset, zulu) == "equal", "offset timestamps compare as instants")
check(D.compare_clocks(later_fraction, zulu) == "newer", "a fractional second is newer than the whole second")

check(D.decide_after_reject(BUILD, PARENT, HEAD, HEAD, "code", NEW, OLD) == ("landed", "landed"),
      "a rejected push whose tip is already our commit has landed")
check(D.decide_after_reject(BUILD, PARENT, HEAD, PARENT, "code", NEW, OLD) == ("retry", "retry"),
      "a rejected push that left main on our parent retries")
check(D.decide_after_reject(BUILD, PARENT, HEAD, OTHER, "stamp", NEW, OLD) == ("rebase", "newer-stamp"),
      "a rejected push whose new tip is an older stamp rebases")
check(D.decide_after_reject(BUILD, PARENT, HEAD, OTHER, "stamp", OLD, NEW)[0] == "skip",
      "a rejected push whose new tip is a newer stamp skips")
check(D.decide_after_reject(BUILD, PARENT, HEAD, OTHER, "code", NEW, OLD) == ("skip", "code"),
      "a rejected push whose new tip is a code commit skips")

meta = {
    "generated": "2099-01-01T00:00:00+00:00",
    "hardrock": {
        "asOf": "2026-11-17T20:45:01Z",
        "pulledThisRun": True,
        "leagues": {"nfl": "2026-11-17T20:45:01Z", "nba": None},
        "props": {"nba": "2026-11-17T18:00:00Z"},
    },
    "oddsApi": {"checkedAt": "2099-01-01T00:00:00Z", "level": "full"},
}
parsed = D.clocks_from_meta(meta)
check(parsed == {"leagues": {"nfl": "2026-11-17T20:45:01Z"}, "props": {"nba": "2026-11-17T18:00:00Z"}},
      "meta clocks keep provider pull times and drop empty ones")
check("generated" not in json.dumps(parsed) and "checkedAt" not in json.dumps(parsed),
      "the build clock and the credit-header clock are not pull times")
check(D.clocks_from_meta({"hardrock": {"leagues": {"nfl": "not-a-time"}, "props": {}}}) is None,
      "an unreadable pull time cannot be compared")

sample = (
    "# Rewritten by .github/workflows/refresh-and-deploy.yml before each scheduled publish.\n"
    "run=44172132439\nattempt=1\n"
    "built_from=a3c773e591ec40e0d5292578806a19c08cf9a5b7\n"
    "written_at=2026-11-17T20:46:47Z\n"
)
check(D.odds_clocks_from_stamp(sample) is None, "a stamp without odds= has unknown pull times")
check(D.parse_stamp_run(sample) == "44172132439", "the stamp run id is the other refresh")
check(D.odds_clocks_from_stamp("odds=not-json\n") is None, "a broken odds= line is unknown")
check(D.odds_clocks_from_stamp('odds={"leagues":{"nfl":"nope"},"props":{}}\n') is None,
      "an odds= line with a bad timestamp is unknown")
empty_line = 'odds={"leagues":{},"props":{}}\n'
check(D.odds_clocks_from_stamp(empty_line) == {"leagues": {}, "props": {}},
      "an explicit empty odds= line is known")
check(D.compare_clocks({"leagues": {}, "props": {}}, {"leagues": {}, "props": {}}) == "equal",
      "two bundles with no provider pulls are equal")


def test_emit_and_loader(tmp):
    meta_path = tmp / "meta.json"
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "publish_stamp_decision.py"), "emit-clocks", str(meta_path)],
        capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k != "ODDS_API_KEY"},
    )
    check(proc.returncode == 0 and proc.stdout.startswith("clocks=") and "generated" not in proc.stdout
          and "checkedAt" not in proc.stdout and "2099" not in proc.stdout,
          "emit-clocks writes provider pull times only")
    check("the-odds-api" not in proc.stdout and "ghp_" not in proc.stdout, "emit-clocks prints no secret")

    bad = tmp / "bad.json"
    bad.write_text('{"hardrock":{"leagues":{"nfl":"nope"},"props":{}}}', encoding="utf-8")
    bad_proc = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "publish_stamp_decision.py"), "emit-clocks", str(bad)],
        capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k != "ODDS_API_KEY"},
    )
    check(bad_proc.returncode == 1, "emit-clocks fails when a pull time is not a timestamp")

    called = {"n": 0}

    def runner(cmd, **_kwargs):
        called["n"] += 1
        dest = Path(cmd[cmd.index("--dir") + 1])
        nested = dest / "site-bundle" / "site" / "data"
        nested.mkdir(parents=True)
        nested.joinpath("meta.json").write_text(json.dumps({
            "generated": "2099-01-01T00:00:00Z",
            "hardrock": {"leagues": OLD["leagues"], "props": OLD["props"]},
        }), encoding="utf-8")

        class Result:
            returncode = 0
        return Result()

    loaded = D.load_meta_from_actions("44172132439", "BaccaRod24/linesmart", runner=runner)
    check(called["n"] == 1 and D.clocks_from_meta(loaded) == OLD,
          "a site-bundle download yields that run's provider pull times")

    def reject(cmd, **_kwargs):
        class Result:
            returncode = 1
            stderr = "token ghp_secretvalue should not be printed"
            stdout = "ghp_secretvalue"
        return Result()

    buf = io.StringIO()
    with redirect_stdout(buf):
        missing_meta = D.load_meta_from_actions("44172132439", "BaccaRod24/linesmart", runner=reject)
    check(missing_meta is None and "ghp_" not in buf.getvalue(),
          "a failed bundle download skips and does not print the command output")
    check(D.load_meta_from_actions("not-a-run", "BaccaRod24/linesmart", runner=boom) is None,
          "a non-numeric run id does not download a bundle")


def assert_published(bare, build, sha, clocks):
    check(remote_tip(bare) == sha, "main is the stamp this run pushed")
    check(remote_ancestor(bare, build, sha), "the build commit is still an ancestor")
    check(remote_names(bare, build, sha) == [D.STAMP_PATH], "the push changes only the Pages stamp")
    check(remote_subject(bare).startswith(D.STAMP_PREFIX), "the commit is a Pages stamp")
    text = remote_file(bare, sha, D.STAMP_PATH)
    check("run=44172576362" in text and "homeML" not in text and "apiKey" not in text,
          "the stamp records the run and not the odds payload")
    check(D.odds_clocks_from_stamp(text) == D.normalize_clocks(clocks),
          "the stamp records this bundle's provider pull times")
    author = subprocess.check_output(
        ["git", "--git-dir", str(bare), "log", "-1", "--format=%an %ae"], text=True).strip()
    check(author == "github-actions[bot] 41898283+github-actions[bot]@users.noreply.github.com",
          "the stamp author is the Actions bot")


def test_git(tmp):
    bare, build = make_remote(tmp)
    runner = clone(tmp, bare, "runner")
    other = clone(tmp, bare, "other")

    skip, sha, reason = run_publish(runner, build, NEW, loader=boom)
    check(skip is False and reason == "unchanged", "main unchanged publishes")
    assert_published(bare, build, sha, NEW)
    first = sha

    # Tip is an older stamp. This bundle is newer. Stack, and keep the older commit.
    push_stamp(other, "44172132439", OLD)
    older = remote_tip(bare)
    runner2 = clone(tmp, bare, "runner-older")
    skip, sha, reason = run_publish(runner2, build, NEW, loader=boom)
    check(skip is False and reason == "newer-stamp", "an older-odds stamp is stamped over")
    check(remote_ancestor(bare, older, sha) and remote_ancestor(bare, first, sha),
          "the older stamp stays on main")
    parent = subprocess.check_output(
        ["git", "--git-dir", str(bare), "rev-parse", "main^"], text=True).strip()
    check(parent == older, "main's parent is the older-odds stamp")
    assert_published(bare, build, sha, NEW)

    # Tip is a newer stamp. Skip. Loader must not run.
    push_stamp(other, "44180000000", NEWER)
    newer = remote_tip(bare)
    runner3 = clone(tmp, bare, "runner-newer")
    skip, sha, reason = run_publish(runner3, build, NEW, loader=boom)
    check(skip is True and reason == "not-newer" and sha == "" and remote_tip(bare) == newer,
          "a newer-odds stamp is left as the tip")

    # Equal odds skip.
    runner4 = clone(tmp, bare, "runner-equal")
    skip, _sha, reason = run_publish(runner4, build, NEWER, loader=boom)
    check(skip is True and reason == "not-newer" and remote_tip(bare) == newer,
          "equal odds do not publish another stamp")

    # Code push.
    code = push_code(other)
    runner5 = clone(tmp, bare, "runner-code")
    skip, _sha, reason = run_publish(runner5, build, NEW, loader=boom)
    check(skip is True and reason == "code" and remote_tip(bare) == code,
          "a code push is left as the tip")

    # Stamp-file-only commit whose message is not the workflow prefix still self-deploys.
    sync(other)
    manual = other / D.STAMP_PATH
    manual.write_text(manual.read_text(encoding="utf-8") + "note=manual\n", encoding="utf-8")
    git(other, "add", "--", D.STAMP_PATH)
    git(other, "commit", "-qm", "refresh stamp manually")
    git(other, "push", "-q", "origin", "HEAD:refs/heads/main")
    manual_tip = remote_tip(bare)
    runner6 = clone(tmp, bare, "runner-manual")
    skip, _sha, reason = run_publish(runner6, build, NEW, loader=boom)
    check(skip is True and reason == "code" and remote_tip(bare) == manual_tip,
          "a stamp-file edit with another message publishes itself")

    # Code commit, then a stamp. The code commit is still in the range.
    bare2, build2 = make_remote(tmp, "after-code")
    other2 = clone(tmp, bare2, "other2")
    push_code(other2, message="Ship a layout fix")
    push_stamp(other2, "44180000001", OLD)
    stamped_after_code = remote_tip(bare2)
    runner7 = clone(tmp, bare2, "runner-after-code")
    skip, _sha, reason = run_publish(runner7, build2, NEW, loader=boom)
    check(skip is True and reason == "code" and remote_tip(bare2) == stamped_after_code,
          "a code commit under a later stamp still publishes itself")


def test_old_stamp_bundle(tmp):
    bare, build = make_remote(tmp, "old")
    other = clone(tmp, bare, "other-old")
    old_tip = push_old_stamp(other, "44172132439")
    seen = []

    def loader(run_id):
        seen.append(run_id)
        return {"generated": "2099-01-01T00:00:00Z", "hardrock": {"leagues": OLD["leagues"], "props": OLD["props"]}}

    runner = clone(tmp, bare, "runner-old")
    skip, sha, reason = run_publish(runner, build, NEW, loader=loader)
    check(seen == ["44172132439"], "a stamp without odds= reads that run's bundle")
    check(skip is False and reason == "newer-stamp", "an older bundle behind an old stamp still publishes")
    check(remote_ancestor(bare, old_tip, sha), "the old-format stamp stays on main")
    assert_published(bare, build, sha, NEW)

    bare3, build3 = make_remote(tmp, "unknown")
    other3 = clone(tmp, bare3, "other-unknown")
    unknown = push_old_stamp(other3, "44172132439")
    runner_unknown = clone(tmp, bare3, "runner-unknown")
    skip, _sha, reason = run_publish(runner_unknown, build3, NEW, loader=lambda _run: None)
    check(skip is True and reason == "unknown-clocks" and remote_tip(bare3) == unknown,
          "a stamp whose bundle cannot be read is left as the tip")


def test_reject_loop(tmp):
    bare, build = make_remote(tmp, "race")
    other = clone(tmp, bare, "other-race")
    runner = clone(tmp, bare, "runner-race")

    def land_older(attempt):
        if attempt == 1:
            push_stamp(other, "44172132439", OLD)

    skip, sha, reason = run_publish(runner, build, NEW, loader=boom, before=land_older)
    check(skip is False and reason == "rebase-published",
          "a push rejected for an older stamp rebases and publishes")
    parent = subprocess.check_output(
        ["git", "--git-dir", str(bare), "rev-parse", "main^"], text=True).strip()
    check(remote_subject(bare, parent).endswith("(run 44172132439)"),
          "the rebased stamp sits on the commit that won the race")
    check(remote_ancestor(bare, build, sha), "the rejected attempt does not rewrite main")
    assert_published(bare, build, sha, NEW)

    bare_n, build_n = make_remote(tmp, "newer-race")
    other_n = clone(tmp, bare_n, "other-newer-race")
    runner_n = clone(tmp, bare_n, "runner-newer-race")

    def land_newer(attempt):
        if attempt == 1:
            push_stamp(other_n, "44180000002", NEWER)

    skip, _sha, reason = run_publish(runner_n, build_n, NEW, loader=boom, before=land_newer)
    check(skip is True and reason == "not-newer", "a push rejected for a newer stamp skips")
    check(remote_subject(bare_n).endswith("(run 44180000002)"), "the newer stamp remains the tip")

    bare_c, build_c = make_remote(tmp, "code-race")
    other_c = clone(tmp, bare_c, "other-code-race")
    runner_c = clone(tmp, bare_c, "runner-code-race")

    def land_code(attempt):
        if attempt == 1:
            push_code(other_c)

    skip, _sha, reason = run_publish(runner_c, build_c, NEW, loader=boom, before=land_code)
    check(skip is True and reason == "code" and remote_subject(bare_c) == "Add a page",
          "a push rejected for a code commit skips")

    bare_r, build_r = make_remote(tmp, "retry")
    runner_r = clone(tmp, bare_r, "runner-retry")
    calls = {"n": 0}

    def flaky(repo, remote, branch):
        calls["n"] += 1
        if calls["n"] == 1:
            return False
        return D.git_push(repo, remote, branch)

    skip, sha, reason = run_publish(runner_r, build_r, NEW, loader=boom, pusher=flaky)
    ahead = subprocess.check_output(
        ["git", "--git-dir", str(bare_r), "rev-list", "--count", f"{build_r}..main"], text=True).strip()
    check(skip is False and reason == "unchanged" and calls["n"] == 2 and ahead == "1",
          "a rejected push retries the same commit when main stayed put")
    assert_published(bare_r, build_r, sha, NEW)

    bare_f, build_f = make_remote(tmp, "fail")
    runner_f = clone(tmp, bare_f, "runner-fail")
    try:
        run_publish(runner_f, build_f, NEW, loader=boom, pusher=lambda *_a: False, max_pushes=2)
        check(False, "five failed pushes must stop")
    except SystemExit as ex:
        check("Could not push the Pages stamp" in str(ex), "a stuck push reports that main was left unchanged")
    check(remote_tip(bare_f) == build_f, "failed pushes do not move main")


def test_shallow(tmp):
    bare, build = make_remote(tmp, "shallow")
    other = clone(tmp, bare, "other-shallow")
    push_stamp(other, "44172132439", OLD)
    shallow = clone(tmp, bare, "shallow", depth=1)
    check(git(shallow, "rev-parse", "--is-shallow-repository").stdout.strip() == "true",
          "the publish checkout is shallow")
    check(git(shallow, "cat-file", "-e", f"{build}^{{commit}}", check_ok=False).returncode != 0,
          "a depth-1 checkout does not contain the build commit")
    skip, sha, reason = run_publish(shallow, build, NEW, loader=boom)
    check(skip is False and reason == "newer-stamp", "a shallow checkout still publishes over an older stamp")
    assert_published(bare, build, sha, NEW)

    bare2, build2 = make_remote(tmp, "queued")
    waiting = clone(tmp, bare2, "waiting", depth=1)
    other2 = clone(tmp, bare2, "other-while-waiting")
    push_stamp(other2, "44172132439", OLD)
    skip, sha, reason = run_publish(waiting, build2, NEW, loader=boom)
    check(skip is False and reason == "newer-stamp",
          "a shallow checkout that was queued before the stamp still publishes")
    assert_published(bare2, build2, sha, NEW)


def test_workflow():
    text = WF.read_text(encoding="utf-8")
    data = yaml.safe_load(text)
    jobs = data["jobs"]
    check(set(jobs) >= {"build", "deploy", "publish-request", "publish", "indexnow"},
          "build, deploy, publish-request, publish, and indexnow are intact")
    check(jobs["build"]["timeout-minutes"] == 20, "the build timeout stays 20 minutes")
    check(jobs["deploy"]["timeout-minutes"] == 25, "the deploy timeout stays 25 minutes")
    check(jobs["publish-request"]["timeout-minutes"] == 25, "the publish-request timeout stays 25 minutes")
    check(jobs["publish"]["timeout-minutes"] == 25, "the publish timeout stays 25 minutes")
    check(jobs["indexnow"]["timeout-minutes"] == 5, "the indexnow timeout stays 5 minutes")
    check(data["concurrency"]["group"].startswith("${{") and "pages-live" in data["concurrency"]["group"]
          and "'pages'" in data["concurrency"]["group"] and data["concurrency"]["cancel-in-progress"] is False,
          "the pages and pages-live concurrency groups stay in place")
    check("verify_live_deploy.py --meta" in text and "actions/deploy-pages@v5" in text,
          "both deploy paths still check the live site")
    check("origin/main moved off the stamp commit before dispatch" in text,
          "dispatch still requires main to be the stamp commit")
    check("publish_stamp_decision.py publish" in text and "emit-clocks" in text,
          "publish-request uses the tested decision")
    check("needs.build.outputs.odds_clocks" in text, "the decision reads the build's provider pull times")
    check("--force" not in text and "force-with-lease" not in text,
          "the workflow does not force-push")
    src = Path(D.__file__).read_text(encoding="utf-8")
    check("--force" not in src and "force-with-lease" not in src and "+HEAD" not in src,
          "the stamp script does not force-push")
    check("the-odds-api" not in src and "api.the-odds-api" not in src and "urlopen" not in src,
          "the stamp script does not call The Odds API")
    check('env.pop("ODDS_API_KEY", None)' in src, "git commands do not inherit an Odds API key")


with tempfile.TemporaryDirectory() as directory:
    test_emit_and_loader(Path(directory))
with tempfile.TemporaryDirectory() as directory:
    test_git(Path(directory))
with tempfile.TemporaryDirectory() as directory:
    test_old_stamp_bundle(Path(directory))
with tempfile.TemporaryDirectory() as directory:
    test_reject_loop(Path(directory))
with tempfile.TemporaryDirectory() as directory:
    test_shallow(Path(directory))
test_workflow()

print(f"\n{passed} passed, {failed} failed" if failed else f"\nall {passed} publish-stamp checks passed")
sys.exit(1 if failed else 0)
