#!/usr/bin/env python3
"""Decide whether a refresh may stamp main, then fast-forward that stamp.

Scheduled and manual refreshes are queued on the pages lock. github.sha stays
the commit from when the run was created. Another refresh can stamp main before
this run's publish-request job starts. The bundle that is already publishing
then keeps the live site, and this run's odds never ship.

This script publishes only when it is safe:

* main is still the commit this bundle was built from, or
* every commit since then is a Pages stamp (subject starts with
  "Publish pages data " and the only path is .github/pages-deploy-stamp)
  and this bundle's provider pull times are strictly newer.

Provider pull times are hardrock.leagues and hardrock.props in site/data/meta.json.
The build clock (generated) and the credit-header clock (oddsApi.checkedAt) do
not count: a late run that did not pull odds still has a newer build clock.
A newer pull on one league does not cover an older pull on another.

A commit that changes any other path publishes itself through the push deploy.
This script leaves that commit as the tip. The stamp push is a fast-forward of
main. The committed file is only .github/pages-deploy-stamp.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_live_deploy  # noqa: E402

STAMP_PATH = ".github/pages-deploy-stamp"
STAMP_PREFIX = "Publish pages data "
ODDS_COMMENT = "# odds= is hardrock.leagues and hardrock.props pull times for this bundle."
BOT_NAME = "github-actions[bot]"
BOT_EMAIL = "41898283+github-actions[bot]@users.noreply.github.com"
MAX_PUSHES = 5
DEEPEN_ROUNDS = 20
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
NUM_RE = re.compile(r"^[0-9]+$")
REF_RE = re.compile(r"^[A-Za-z0-9._/-]+$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
SECRET_RE = re.compile(r"(ghp_|gho_|ghu_|ghs_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_]+")


class ClockError(ValueError):
    """Our bundle's pull times cannot be recorded."""


def scrub(text):
    cleaned = SECRET_RE.sub("[redacted]", text or "")
    return re.sub(r"https://[^@\s/]+@", "https://[redacted]@", cleaned)


def parse_time(value):
    """UTC instant, or None. A naive timestamp is UTC."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def normalize_clocks(clocks):
    """{'leagues': {name: iso}, 'props': {name: iso}} or ClockError."""
    if not isinstance(clocks, dict):
        raise ClockError("odds clocks must be a JSON object")

    def group(name):
        raw = clocks.get(name) or {}
        if not isinstance(raw, dict):
            raise ClockError(f"odds clocks {name} must be an object")
        out = {}
        for key, value in raw.items():
            if not isinstance(key, str) or not key or any(ch in key for ch in "\r\n"):
                raise ClockError("odds clock name is not usable")
            if value is None or value == "":
                continue
            if not isinstance(value, str) or parse_time(value) is None:
                raise ClockError(f"odds clock {name}.{key} is not a timestamp")
            out[key] = value.strip()
        return out

    return {"leagues": group("leagues"), "props": group("props")}


def clocks_from_meta(meta):
    """Pull times from meta.json, or None when a recorded time cannot be read.

    Empty leagues and props are known clocks (this bundle has no provider pull
    times). None means the file cannot be compared.
    """
    if not isinstance(meta, dict):
        return None
    hardrock = meta.get("hardrock") or {}
    if not isinstance(hardrock, dict):
        return None
    try:
        return normalize_clocks({
            "leagues": hardrock.get("leagues") or {},
            "props": hardrock.get("props") or {},
        })
    except ClockError:
        return None


def flatten_clocks(clocks):
    out = {}
    if not isinstance(clocks, dict):
        return out
    for group in ("leagues", "props"):
        rows = clocks.get(group) or {}
        if not isinstance(rows, dict):
            continue
        for key, value in rows.items():
            if isinstance(key, str) and isinstance(value, str) and value.strip():
                out[f"{group}.{key}"] = value.strip()
    return out


def compare_clocks(ours, theirs):
    """newer, older, equal, mixed, or unknown.

    newer means every shared pull is at least as new and one is strictly newer.
    A pull present on only one side counts for that side. mixed means publishing
    would move at least one league or prop market backward.
    """
    if not isinstance(ours, dict) or not isinstance(theirs, dict):
        return "unknown"
    our_map = flatten_clocks(ours)
    their_map = flatten_clocks(theirs)
    newer = older = 0
    for key in sorted(set(our_map) | set(their_map)):
        ours_at = parse_time(our_map.get(key)) if key in our_map else None
        theirs_at = parse_time(their_map.get(key)) if key in their_map else None
        if key in our_map and ours_at is None:
            return "unknown"
        if key in their_map and theirs_at is None:
            return "unknown"
        if ours_at is None and theirs_at is None:
            continue
        if ours_at is None:
            older += 1
        elif theirs_at is None:
            newer += 1
        elif ours_at > theirs_at:
            newer += 1
        elif ours_at < theirs_at:
            older += 1
    if newer and older:
        return "mixed"
    if newer:
        return "newer"
    if older:
        return "older"
    return "equal"


def decide(build_sha, tip_sha, kind, our_clocks, their_clocks):
    """Return (publish|skip, reason). kind is unchanged, stamp, code, or unrelated."""
    if _sha(build_sha) == _sha(tip_sha):
        return "publish", "unchanged"
    if kind == "stamp":
        compared = compare_clocks(our_clocks, their_clocks)
        if compared == "newer":
            return "publish", "newer-stamp"
        if compared == "unknown":
            return "skip", "unknown-clocks"
        return "skip", "not-newer"
    if kind == "unrelated":
        return "skip", "unrelated"
    return "skip", "code"


def decide_after_reject(build_sha, parent_sha, head_sha, new_tip, kind, our_clocks, their_clocks):
    """Return (landed|retry|rebase|skip, reason) after a rejected stamp push."""
    if _sha(new_tip) == _sha(head_sha):
        return "landed", "landed"
    if _sha(new_tip) == _sha(parent_sha):
        return "retry", "retry"
    action, reason = decide(build_sha, new_tip, kind, our_clocks, their_clocks)
    if action == "publish":
        return "rebase", reason
    return "skip", reason


def odds_clocks_from_stamp(text):
    """Clocks from an odds= line, or None when the line is absent or unreadable."""
    if not isinstance(text, str):
        return None
    raw = None
    for line in text.splitlines():
        if line.startswith("odds="):
            raw = line[5:]
    if raw is None:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    try:
        return normalize_clocks(data)
    except ClockError:
        return None


def parse_stamp_run(text):
    if not isinstance(text, str):
        return None
    for line in text.splitlines():
        if line.startswith("run="):
            value = line.split("=", 1)[1].strip()
            return value if NUM_RE.fullmatch(value) else None
    return None


def append_odds_line(text, clocks):
    body = normalize_clocks(clocks)
    line = "odds=" + json.dumps(body, sort_keys=True, separators=(",", ":"))
    kept = [ln for ln in text.splitlines() if ln != ODDS_COMMENT and not ln.startswith("odds=")]
    kept.append(ODDS_COMMENT)
    kept.append(line)
    return "\n".join(kept) + "\n"


def write_stamp_file(path, run_id, attempt, built_from, clocks, when=None):
    """Pages stamp plus the provider pull times of the bundle it publishes."""
    stamp_when = when
    if isinstance(when, datetime):
        stamp_when = when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    verify_live_deploy.write_stamp(path, run_id, attempt, built_from, when=stamp_when)
    dest = Path(path)
    dest.write_text(append_odds_line(dest.read_text(encoding="utf-8"), clocks), encoding="utf-8")
    return dest.read_text(encoding="utf-8")


def format_clocks(clocks):
    if clocks is None:
        return "(unknown)"
    flat = flatten_clocks(clocks)
    if not flat:
        return "(none)"
    return " ".join(f"{key}={flat[key]}" for key in sorted(flat))


def _sha(value):
    return str(value or "").strip().lower()


def _check_sha(value, label):
    sha = _sha(value)
    if not SHA_RE.fullmatch(sha):
        raise SystemExit(f"{label} must be a 40-character commit sha")
    return sha


def _check_num(value, label):
    text = str(value or "").strip()
    if not NUM_RE.fullmatch(text):
        raise SystemExit(f"{label} must be numeric")
    return text


def _check_ref(value, label):
    if not isinstance(value, str) or not REF_RE.fullmatch(value) or value.startswith(("-", "/")):
        raise SystemExit(f"unsafe {label}")
    return value


def git_env():
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_PAGER"] = "cat"
    env["GIT_EDITOR"] = "true"
    env.pop("ODDS_API_KEY", None)
    return env


def run_git(repo, args, check=True, timeout=120):
    proc = subprocess.run(
        ["git", "--no-pager", "-c", "core.quotepath=false", *args],
        cwd=repo,
        env=git_env(),
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if check and proc.returncode != 0:
        detail = scrub((proc.stderr or proc.stdout or "git failed").strip())
        raise SystemExit(f"git {' '.join(args)} failed: {detail}")
    return proc


def have_commit(repo, sha):
    if not SHA_RE.fullmatch(_sha(sha)):
        return False
    proc = run_git(repo, ["cat-file", "-e", f"{_sha(sha)}^{{commit}}"], check=False)
    return proc.returncode == 0


def is_ancestor(repo, ancestor, descendant):
    if not have_commit(repo, ancestor) or not have_commit(repo, descendant):
        return False
    proc = run_git(repo, ["merge-base", "--is-ancestor", _sha(ancestor), _sha(descendant)], check=False)
    return proc.returncode == 0


def is_shallow(repo):
    proc = run_git(repo, ["rev-parse", "--is-shallow-repository"], check=False)
    return proc.returncode == 0 and proc.stdout.strip() == "true"


def fetch_sha(repo, remote, ref):
    """Fetch one ref. Returns the fetched sha, or None when the fetch failed."""
    proc = run_git(repo, ["fetch", "--no-tags", remote, ref], check=False)
    if proc.returncode != 0:
        return None
    parsed = run_git(repo, ["rev-parse", "FETCH_HEAD"], check=False)
    if parsed.returncode != 0:
        return None
    sha = parsed.stdout.strip().lower()
    return sha if SHA_RE.fullmatch(sha) else None


def ensure_history(repo, remote, branch, build_sha, tip):
    """Make build_sha available when it is an ancestor of tip. False if it is not."""
    build_sha, tip = _sha(build_sha), _sha(tip)
    if build_sha == tip:
        return have_commit(repo, build_sha)
    if is_ancestor(repo, build_sha, tip):
        return True
    if is_shallow(repo):
        for _ in range(DEEPEN_ROUNDS):
            proc = run_git(repo, ["fetch", "--no-tags", "--deepen=50", remote, branch], check=False)
            if proc.returncode != 0:
                return False
            if is_ancestor(repo, build_sha, tip):
                return True
        return False
    if not have_commit(repo, build_sha):
        fetch_sha(repo, remote, build_sha)
    return is_ancestor(repo, build_sha, tip)


def diff_names(repo, older, newer):
    proc = run_git(repo, ["diff", "--name-only", _sha(older), _sha(newer)])
    names = []
    for line in proc.stdout.splitlines():
        path = line.strip().removeprefix("./")
        if path:
            names.append(path)
    return names


def commit_subject(repo, sha):
    proc = run_git(repo, ["log", "-1", "--format=%s", _sha(sha)])
    return proc.stdout.strip()


def commit_is_stamp(repo, sha):
    """A workflow stamp: the publish message, one parent, and only the stamp file."""
    if not commit_subject(repo, sha).startswith(STAMP_PREFIX):
        return False
    proc = run_git(repo, ["rev-list", "--parents", "-n", "1", _sha(sha)])
    parts = proc.stdout.split()
    if len(parts) != 2:
        return False
    parent = parts[1].lower()
    if not have_commit(repo, parent):
        return False
    return diff_names(repo, parent, sha) == [STAMP_PATH]


def classify_move(repo, build_sha, tip):
    """Return (kind, files, note). kind is unchanged, stamp, code, or unrelated."""
    build_sha, tip = _sha(build_sha), _sha(tip)
    if build_sha == tip:
        return "unchanged", [], ""
    if not is_ancestor(repo, build_sha, tip):
        return "unrelated", [], "build commit is not an ancestor of main"
    proc = run_git(repo, ["rev-list", "--reverse", f"{build_sha}..{tip}"])
    commits = [line.strip().lower() for line in proc.stdout.splitlines() if line.strip()]
    files = diff_names(repo, build_sha, tip)
    for sha in commits:
        if not commit_is_stamp(repo, sha):
            subject = commit_subject(repo, sha)
            return "code", files, f"{sha[:12]} {subject}"
    if files not in ([], [STAMP_PATH]):
        return "code", files, "tree differs outside the Pages stamp"
    return "stamp", files, f"{len(commits)} stamp commit(s)"


def show_file(repo, sha, path):
    proc = run_git(repo, ["show", f"{_sha(sha)}:{path}"], check=False)
    if proc.returncode != 0:
        return None
    return proc.stdout


def read_their_clocks(repo, sha, meta_loader):
    text = show_file(repo, sha, STAMP_PATH)
    if text is None:
        return None
    parsed = odds_clocks_from_stamp(text)
    if parsed is not None:
        return parsed
    run_id = parse_stamp_run(text)
    if not run_id or meta_loader is None:
        return None
    print(f"stamp {str(sha)[:12]} has no odds= line; reading provider pull times from run {run_id}")
    try:
        meta = meta_loader(run_id)
    except Exception:
        print(f"::warning::could not read provider pull times for run {run_id}")
        return None
    if meta is None:
        return None
    return clocks_from_meta(meta)


def load_meta_from_actions(run_id, repository, runner=None):
    """meta.json from a refresh run's site-bundle artifact, or None."""
    if not NUM_RE.fullmatch(str(run_id or "")) or not REPO_RE.fullmatch(repository or ""):
        return None
    runner = runner or subprocess.run
    dest = tempfile.mkdtemp(prefix="linesmart-stamp-")
    env = os.environ.copy()
    env.pop("ODDS_API_KEY", None)
    try:
        try:
            proc = runner(
                ["gh", "run", "download", str(run_id), "--repo", repository,
                 "--name", "site-bundle", "--dir", dest],
                capture_output=True,
                text=True,
                timeout=120,
                env=env,
            )
        except (OSError, subprocess.TimeoutExpired):
            print(f"::warning::could not download site-bundle for run {run_id}")
            return None
        if getattr(proc, "returncode", 1) != 0:
            print(f"::warning::could not download site-bundle for run {run_id}")
            return None
        metas = [path for path in Path(dest).rglob("meta.json") if path.parent.name == "data"]
        if not metas:
            print(f"::warning::site-bundle for run {run_id} has no data/meta.json")
            return None
        meta_path = min(metas, key=lambda path: len(path.parts))
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            print(f"::warning::site-bundle for run {run_id} has no readable data/meta.json")
            return None
    finally:
        shutil.rmtree(dest, ignore_errors=True)


def actions_meta_loader(run_id):
    return load_meta_from_actions(run_id, os.environ.get("GITHUB_REPOSITORY", ""))


def git_push(repo, remote, branch):
    proc = run_git(repo, ["push", remote, f"HEAD:refs/heads/{branch}"], check=False)
    for stream in (proc.stdout, proc.stderr):
        cleaned = scrub(stream or "")
        if cleaned.strip():
            print(cleaned, end="" if cleaned.endswith("\n") else "\n")
    return proc.returncode == 0


def commit_message(run_id, when=None):
    moment = when or datetime.now(timezone.utc)
    return f"{STAMP_PREFIX}{moment.strftime('%Y-%m-%dT%H:%MZ')} (run {run_id})"


def commit_stamp(repo, base, run_id, attempt, build_sha, clocks, when=None):
    """Local commit on top of base. The index contains only the stamp file."""
    base = _check_sha(base, "tip")
    moment = when or datetime.now(timezone.utc)
    run_git(repo, ["reset", "--hard", base])
    stamp = Path(repo) / STAMP_PATH
    write_stamp_file(stamp, run_id, attempt, build_sha, clocks, when=moment)
    run_git(repo, ["add", "--", STAMP_PATH])
    staged = run_git(repo, ["diff", "--cached", "--name-only"])
    names = [line.strip() for line in staged.stdout.splitlines() if line.strip()]
    if names != [STAMP_PATH]:
        raise SystemExit("refusing to commit anything except the Pages stamp\n" + "\n".join(names))
    proc = run_git(
        repo,
        ["-c", f"user.name={BOT_NAME}", "-c", f"user.email={BOT_EMAIL}",
         "-c", "commit.gpgsign=false",
         "commit", "-m", commit_message(run_id, moment)],
        check=False,
    )
    if proc.returncode != 0:
        detail = scrub((proc.stderr or proc.stdout or "commit failed").strip())
        raise SystemExit(f"could not commit the Pages stamp: {detail}")
    head = run_git(repo, ["rev-parse", "HEAD"]).stdout.strip().lower()
    parent = run_git(repo, ["rev-parse", "HEAD^"]).stdout.strip().lower()
    if parent != base or diff_names(repo, parent, head) != [STAMP_PATH]:
        raise SystemExit("refusing to commit anything except the Pages stamp")
    if not commit_subject(repo, head).startswith(STAMP_PREFIX):
        raise SystemExit("stamp commit message is missing the Pages prefix")
    return head


def parent_sha(repo, sha):
    proc = run_git(repo, ["rev-parse", f"{_sha(sha)}^"], check=False)
    if proc.returncode != 0:
        raise SystemExit("stamp commit has no parent; not pushing")
    return proc.stdout.strip().lower()


def write_github_output(path, skip, sha):
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(f"skip={1 if skip else 0}\n")
        handle.write(f"sha={sha or ''}\n")


def _warn(message):
    print(f"::warning::{message}")


def _move_message(build_sha, tip, reason, note, files):
    if reason == "code":
        extra = f" ({note})" if note else ""
        shown = ", ".join(files[:20])
        paths = f" Paths: {shown}." if shown else ""
        return (f"main moved from {build_sha} to {tip} during the build. "
                f"That push publishes itself. Not stacking a stamp.{extra}{paths}")
    if reason == "unrelated":
        return (f"main moved from {build_sha} to {tip} during the build. "
                "The build commit is not an ancestor. Not stacking a stamp.")
    if reason == "unknown-clocks":
        return (f"main moved from {build_sha} to {tip}, a Pages stamp with no comparable "
                "provider pull times. Not stacking a stamp.")
    if reason == "not-newer":
        return (f"main moved from {build_sha} to {tip}, a Pages stamp whose odds are newer "
                "or the same. Not stacking a stamp.")
    if reason == "newer-stamp":
        return (f"main moved from {build_sha} to {tip} by Pages stamp commits with older odds. "
                "Stamping this bundle on top.")
    return f"main is {tip} ({reason})"


def assess(repo, remote, branch, build_sha, tip, meta_loader):
    if not ensure_history(repo, remote, branch, build_sha, tip):
        return "unrelated", [], "build commit is not an ancestor of main", None
    kind, files, note = classify_move(repo, build_sha, tip)
    their = read_their_clocks(repo, tip, meta_loader) if kind == "stamp" else None
    return kind, files, note, their


def publish(repo, build_sha, run_id, attempt, clocks, remote="origin", branch="main",
            github_output=None, meta_loader=None, pusher=None, before_push=None,
            sleep=time.sleep, max_pushes=MAX_PUSHES, when=None):
    """Fast-forward a stamp onto main, or skip. Returns (skip, sha, reason)."""
    repo = str(repo)
    build_sha = _check_sha(build_sha, "build sha")
    run_id = _check_num(run_id, "run id")
    attempt = _check_num(attempt, "attempt")
    remote = _check_ref(remote, "remote")
    branch = _check_ref(branch, "branch")
    try:
        clocks = normalize_clocks(clocks)
    except ClockError as ex:
        raise SystemExit(f"odds clocks from the build are missing or unreadable: {ex}") from ex
    pusher = pusher or git_push
    if max_pushes < 1:
        raise SystemExit("max pushes must be at least 1")

    tip = fetch_sha(repo, remote, branch)
    if tip is None:
        raise SystemExit("could not fetch main. The live site was left unchanged.")
    kind, files, note, their = assess(repo, remote, branch, build_sha, tip, meta_loader)
    compared = compare_clocks(clocks, their) if kind == "stamp" else ""
    action, reason = decide(build_sha, tip, kind, clocks, their)
    print(f"publish decision: build={build_sha} tip={tip} kind={kind} compare={compared or '-'} action={action} reason={reason}")
    if kind == "stamp":
        print(f"ours:  {format_clocks(clocks)}")
        print(f"theirs: {format_clocks(their)}")
    if action != "publish":
        _warn(_move_message(build_sha, tip, reason, note, files))
        write_github_output(github_output, True, "")
        return True, "", reason

    if reason == "newer-stamp":
        print(_move_message(build_sha, tip, reason, note, files))
    base = tip
    head = None
    rebased = False
    for attempt_n in range(1, max_pushes + 1):
        if head is None:
            head = commit_stamp(repo, base, run_id, attempt, build_sha, clocks, when=when)
        if before_push is not None:
            before_push(attempt_n)
        pushed = pusher(repo, remote, branch)
        new_tip = fetch_sha(repo, remote, branch)
        if new_tip is not None and new_tip == head:
            print(f"Stamp commit {head}")
            outcome = "rebase-published" if rebased else reason
            write_github_output(github_output, False, head)
            return False, head, outcome
        if new_tip is None:
            _warn(f"stamp push rejected (attempt {attempt_n}); could not fetch main")
            if attempt_n == max_pushes:
                break
            sleep(attempt_n * 2)
            continue
        _warn(f"stamp push rejected (attempt {attempt_n}); checking whether main moved")
        parent = parent_sha(repo, head)
        kind, files, note, their = assess(repo, remote, branch, build_sha, new_tip, meta_loader)
        if kind == "stamp":
            print(f"ours:  {format_clocks(clocks)}")
            print(f"theirs: {format_clocks(their)}")
        step, step_reason = decide_after_reject(
            build_sha, parent, head, new_tip, kind, clocks, their)
        if step == "landed":
            print(f"Stamp commit {head}")
            write_github_output(github_output, False, head)
            return False, head, "rebase-published" if rebased else reason
        if step == "retry":
            if attempt_n == max_pushes:
                break
            sleep(attempt_n * 2)
            continue
        if step == "skip":
            _warn(_move_message(build_sha, new_tip, step_reason, note, files))
            write_github_output(github_output, True, "")
            return True, "", step_reason
        rebased = True
        print(_move_message(build_sha, new_tip, "newer-stamp", note, files))
        base = new_tip
        head = None
        if attempt_n == max_pushes:
            break
        sleep(attempt_n * 2)
    raise SystemExit(
        "::error::Could not push the Pages stamp commit to main. The live site was left unchanged. "
        "If main is protected, allow github-actions[bot] to push this stamp (it is not the odds data)."
    )


def emit_clocks(meta_path):
    try:
        meta = json.loads(Path(meta_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as ex:
        print(f"::error::could not read odds clocks from {meta_path}: {ex}", file=sys.stderr)
        return 1
    clocks = clocks_from_meta(meta)
    if clocks is None:
        print(f"::error::provider pull times in {meta_path} are not comparable", file=sys.stderr)
        return 1
    print("clocks=" + json.dumps(clocks, sort_keys=True, separators=(",", ":")))
    return 0


def cmd_publish(argv):
    parser = argparse.ArgumentParser(description="Stamp main when this bundle's odds are newer.")
    parser.add_argument("--build-sha", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--attempt", required=True)
    parser.add_argument("--clocks", required=True, help="JSON from emit-clocks")
    parser.add_argument("--stamp", default=STAMP_PATH)
    parser.add_argument("--github-output", default="")
    parser.add_argument("--remote", default="origin")
    parser.add_argument("--branch", default="main")
    parser.add_argument("--repo", default=".")
    args = parser.parse_args(argv)
    if args.stamp != STAMP_PATH:
        raise SystemExit(f"stamp path must be {STAMP_PATH}")
    try:
        clocks = normalize_clocks(json.loads(args.clocks))
    except (json.JSONDecodeError, ClockError) as ex:
        raise SystemExit(f"odds clocks from the build are missing or unreadable: {ex}") from ex
    publish(
        args.repo,
        args.build_sha,
        args.run_id,
        args.attempt,
        clocks,
        remote=args.remote,
        branch=args.branch,
        github_output=args.github_output or None,
        meta_loader=actions_meta_loader,
    )
    return 0


def main(argv):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print("usage: publish_stamp_decision.py emit-clocks META | publish [options]", file=sys.stderr)
        return 2
    if argv[0] == "emit-clocks":
        if len(argv) != 2:
            print("usage: publish_stamp_decision.py emit-clocks META", file=sys.stderr)
            return 2
        return emit_clocks(argv[1])
    if argv[0] == "publish":
        return cmd_publish(argv[1:])
    print("usage: publish_stamp_decision.py emit-clocks META | publish [options]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
