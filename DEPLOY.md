# Deploying LineSmart to GitHub Pages

Target: **https://linesmart.app/** (custom domain; `https://baccarod24.github.io/linesmart/` redirects there). Public repo `BaccaRod24/linesmart`, so Actions minutes are free.

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
#    https://linesmart.app/  (before the custom domain: https://baccarod24.github.io/linesmart/)
```

## The Odds API key (Hard Rock Bet + FanDuel, paid 100K plan)

```bash
gh secret set ODDS_API_KEY --repo BaccaRod24/linesmart      # paste the key when prompted
# force a pull now (ignores the 30-min / 2-h interval gate; the budget guard still applies):
gh workflow run refresh-and-deploy.yml --repo BaccaRod24/linesmart --ref main -f pull_odds=true
# emergency stop: no Odds API calls at all until the variable is removed
gh variable set ODDS_PAUSE --repo BaccaRod24/linesmart --body 1      # undo: gh variable delete ODDS_PAUSE --repo BaccaRod24/linesmart
```

| Trigger | Uses key? |
|---|---|
| cron `*/30 * * * *` and the cron-job.org dispatches (:15/:45 ET) | yes, when the data-history checkout succeeded and `ODDS_PAUSE` isn't `1` |
| workflow_dispatch (`pull_odds=true` forces a pull) | yes, same conditions |
| push to main | no (reuses the last pull) |

Every keyed run first makes free calls:
- `/sports` returns the credit headers.
- `/events` finds which leagues have events in the next 7 days.

After that, it pays only for what is **due**:
- **Game lines:** a league whose last pull (`pulledAt` in `odds/hardrockbet.json`) is at least 30 min old, minus 2 min of slack. This costs 3 credits per league and covers Hard Rock and FanDuel in one request.
- **Props:** an NFL/NBA event starting within 36 h whose last props pull is at least 2 h old. This costs at most 5 (NFL) or 4 (NBA) credits.

Two runs close together therefore never pay twice.

**Credit math** (details in `docs/odds_api_budget.md`): the worst case, with all leagues in season, is about 39.4K for game lines + 15.8K for NBA props + 6.3K for NFL props = **about 61.4K/month**. The budget is 80K, and the plan has 100K.

The budget guard (`scripts/odds_budget.py`) works from the remaining credits and the days left in the cycle. The cycle resets on the 26th.
- It pauses props first, then slows game lines (60 → 360 min).
- It stops at the 300-credit floor.
- Each run is capped at 250 credits.

The build log and `meta.json` → `oddsApi` show the level and the reason.

Settings are env vars in the workflow: `ODDS_BUDGET`, `ODDS_MIN_CREDITS`, `ODDS_RUN_MAX_CREDITS` and `ODDS_BILLING_DAY`. UFC stays DraftKings-only (`ODDS_MMA` is unset).

The last pulls live in `odds/hardrockbet.json` (game lines, `quota`, `usage`) and `odds/props_oddsapi.json` on `data-history`, and every run merges them in. The site shows "as of <pull time ET>" and hides lines for games that have started.

## Line-movement history (`data-history` branch)

The build job has `contents: write` only so it can push history snapshots to the **`data-history`** branch. It never pushes to `main`. Each run does the following:
1. Fetches `data-history` into a worktree at `_history/`. On the first run the branch doesn't exist yet, so it is created as an orphan branch.
2. Builds with `LINE_HISTORY_DIR=_history/history` and writes this run's raw snapshot to `.linehist-snap/`.
3. If the build succeeded, commits and pushes `history/*.json` and `odds/*.json` as github-actions[bot]. If the push is rejected because another run got there first, it fetches the new tip and re-applies `.linehist-snap/` with `line_history.py apply`. It also re-applies a fresh Hard Rock pull with `line_history.py apply-odds`, where the newer `pulledAt` per league wins. Then it pushes again, up to 5 tries. It never force-pushes.

The same branch also holds `rosters/{league}.json`, the roster cache for the search index. It's passed in as `ROSTER_CACHE_DIR=_history/rosters`, reused for 20 h, and committed and re-applied alongside history (`.linehist-snap/_rosters/`). Expect about 0.45 MB of churn per day. If the data-history checkout fails, rosters are fetched fresh, which takes about a minute more.

Failed builds don't write history. The history steps are `continue-on-error`, so they can never block the Pages deploy. The `pages` concurrency group already serializes runs.

```bash
gh api "repos/BaccaRod24/linesmart/contents/history?ref=data-history" --jq '.[] | "\(.name) \(.size)"'
git fetch origin data-history && git log --oneline -5 origin/data-history
```
Hard Rock Bet and FanDuel history get one point per pull (about every 30 min), timestamped at the pull time.

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
- Local root-path check (mimics `https://linesmart.app/`): `python3 -m http.server 8798 -d site &`
  then `BASE=http://localhost:8798/ node scripts/subpath_test.mjs`

## Custom domain (linesmart.app)

DNS at Porkbun: apex `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`;
`www` `CNAME` `baccarod24.github.io`. Pages is set to the domain with
`gh api -X PUT repos/BaccaRod24/linesmart/pages -f cname=linesmart.app` and, once the certificate is issued,
`gh api -X PUT repos/BaccaRod24/linesmart/pages -F https_enforced=true`
(check: `gh api repos/BaccaRod24/linesmart/pages --jq '.cname, .https_certificate.state, .https_enforced'`).
`site/CNAME` is included in the artifact for clarity; with Actions deploys the API setting is what counts.
GitHub redirects `www.linesmart.app` and `baccarod24.github.io/linesmart/` to `https://linesmart.app/`.
