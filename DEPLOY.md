# Deploying LineSmart to GitHub Pages

Target: **https://baccarod24.github.io/linesmart/** (public repo `BaccaRod24/linesmart`, so Actions minutes are free).

The workflow `.github/workflows/refresh-and-deploy.yml` builds fresh data with
`python scripts/build_data.py` and deploys `site/` to Pages on every push to `main`,
on manual dispatch, and every 30 minutes on a schedule. Generated data is **not**
committed back; the snapshot already in `site/data/` is just the fallback for the
first deploy (and for any run where the build crashes).

## One-time setup (after `gh auth login` as BaccaRod24)

Run from this directory (`/workspace/sports-betting-site`):

```bash
# 0. Confirm you're logged in as the right account
gh auth status

# 1. Create the public repo from this local repo and push main
gh repo create BaccaRod24/linesmart --public --source=. --remote=origin --push

# 2. Enable GitHub Pages with "GitHub Actions" as the source (build_type=workflow)
gh api -X POST repos/BaccaRod24/linesmart/pages -f build_type=workflow
#    If Pages already exists (HTTP 409), switch it instead:
#    gh api -X PUT repos/BaccaRod24/linesmart/pages -f build_type=workflow
#    Check:  gh api repos/BaccaRod24/linesmart/pages --jq '.build_type, .html_url'

# 3. Trigger the first deploy (the push in step 1 ran before Pages was enabled, so it likely failed)
gh workflow run refresh-and-deploy.yml --repo BaccaRod24/linesmart --ref main

# 4. Watch it (build ~3-4 min, deploy <1 min)
gh run watch --repo BaccaRod24/linesmart $(gh run list --repo BaccaRod24/linesmart --workflow refresh-and-deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')

# 5. Open the site
#    https://baccarod24.github.io/linesmart/
```

## Optional: The Odds API key (FanDuel / Hard Rock Bet columns)

```bash
gh secret set ODDS_API_KEY --repo BaccaRod24/linesmart      # paste the key when prompted
gh workflow run refresh-and-deploy.yml --repo BaccaRod24/linesmart --ref main
```

Credit budget: one full refresh is ~27 credits; the free tier is 500/month (~18 refreshes).
A 30-minute schedule would be ~1,300 credits/day, so by default **scheduled runs do not use the key**;
only pushes and manual runs do. To use the key on every scheduled run too (paid plan), set:

```bash
gh variable set ODDS_ON_SCHEDULE --body true --repo BaccaRod24/linesmart
```

Note: because data isn't committed, the next keyless scheduled run (≤30 min later) rebuilds without
Odds API data, so the extra book columns go back to N/A until the next keyed run.

## Line-movement history (`data-history` branch)

The build job has `contents: write` only so it can push history snapshots to the **`data-history`** branch. It never pushes to `main`. Each run does the following:
1. Fetches `data-history` into a worktree at `_history/`. On the first run the branch doesn't exist yet, so it is created as an orphan branch.
2. Builds with `LINE_HISTORY_DIR=_history/history` and writes this run's raw snapshot to `.linehist-snap/`.
3. If the build succeeded, commits and pushes `history/*.json` as github-actions[bot]. If the push is rejected because another run got there first, it fetches the new tip, re-applies `.linehist-snap/` with `line_history.py apply`, and pushes again (up to 5 tries). It never force-pushes.

Failed builds don't write history. The history steps are `continue-on-error`, so they can never block the Pages deploy. The `pages` concurrency group already serializes runs.

```bash
gh api "repos/BaccaRod24/linesmart/contents/history?ref=data-history" --jq '.[] | "\(.name) \(.size)"'
git fetch origin data-history && git log --oneline -5 origin/data-history
```
Hard Rock Bet / FanDuel history is only recorded on runs that use the Odds API key (see above). With keyless scheduled runs, those books' charts have gaps.

## Day-to-day

- Manual refresh: `gh workflow run refresh-and-deploy.yml --repo BaccaRod24/linesmart`
- Recent runs: `gh run list --repo BaccaRod24/linesmart --limit 5`
- Pause the schedule: `gh workflow disable refresh-and-deploy.yml --repo BaccaRod24/linesmart` (re-enable with `enable`)
- To refresh the committed fallback snapshot occasionally: `python3 scripts/build_data.py && git add site/data && git commit -m "Refresh data snapshot" && git push`

## Things to know

- GitHub runs `*/30` crons on a best-effort basis; delays of 5-20+ minutes and occasional skipped runs are normal.
- GitHub automatically disables scheduled workflows in public repos after **60 days with no repo activity**.
  Push a commit or re-enable the workflow in the Actions tab if that happens.
- ESPN endpoints are unofficial. If ESPN rate-limits or blocks GitHub's runner IPs, affected leagues are
  marked with an `error` in `meta.json` (and keep the committed snapshot's data for that league); if the
  whole script crashes, the workflow deploys the committed snapshot and shows a warning.
- Local subpath check (mimics `/linesmart/` on Pages):
  `mkdir -p /tmp/ghp && ln -sfn "$PWD/site" /tmp/ghp/linesmart && python3 -m http.server 8799 -d /tmp/ghp &`
  then `BASE=http://localhost:8799/linesmart/ node scripts/subpath_test.mjs`
