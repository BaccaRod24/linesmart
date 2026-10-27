# Where each sportsbook is legal online (`site/assets/books-by-state.js`)

As of **October 26, 2026**. Used by `site/assets/geo-core.js` to decide which sportsbook offers a visitor may see.
This is not legal advice. Each sportsbook geolocates bettors itself, so a wrong entry here can show or hide a link
but can't let anyone bet where it's illegal. Re-check before changing anything, and update `asOf`.

| Book | States (online sportsbook) | Source |
|---|---|---|
| Hard Rock Bet | AZ, CO, FL, IL, IN, MI, NJ, OH, TN, VA | Operator footer on https://www.hardrock.bet/help-center/ ("Must be 21+ and physically present in AZ, CO, FL, IL, IN, MI, NJ, OH, TN or VA"; FL is offered by the Seminole Tribe of Florida). Cross-checked with https://www.hardrock.bet/sportsbook/new-jersey/ (updated Sep 23, 2026). |
| DraftKings | AZ, AR, CO, CT, DC, IL, IN, IA, KS, KY, LA, ME, MD, MA, MI, MO, NH, NJ, NY, NC, OH, OR, PA, TN, VT, VA, WV, WY, PR | DraftKings' "Online Sports Betting" list at https://dknetwork.draftkings.com/2026/06/17/draftkings-is-now-available-nationwide-in-the-usa-read-more-inside/ (updated Jul 22, 2026). Matches the DraftKings 10-Q (jurisdictions as of Mar 31, 2026): https://www.sec.gov/Archives/edgar/data/1883685/000188368526000020/R7.htm. Other states only have DraftKings Predictions, which is not a sportsbook and gets no offer. |
| FanDuel | AZ, AR, CO, CT, DC, IL, IN, IA, KS, KY, LA, MD, MA, MI, MO, NJ, NY, NC, OH, PA, TN, VT, VA, WV, WY, PR | FanDuel Sportsbook state picker https://sportsbook.fanduel.com/select-region and the map https://www.fanduel.com/legal-sports-betting-us-map. FL, ME, NH, OR and others show "FanDuel Predicts" only (not a sportsbook). |
| BetMGM | AZ, CO, DC, IL, IN, IA, KS, KY, LA, MD, MA, MI, MO, NJ, NY, NC, OH, PA, TN, VA, WV, WY, PR | BetMGM's official "Where are you playing from?" location selector at https://sports.betmgm.com/en/sports (Sports tab, checked Oct 26, 2026). It lists the states above plus MS and NV; Florida appears under horse racing only, never sports. Cross-checked with https://www.sharpfootballanalysis.com/sportsbook/guides/betmgm-legal-states/ (updated Oct 2026). Excluded: **NV** (owner's choice: sign-up there can require an in-person casino visit), **MS** (BetMGM's Mississippi app works only on casino property, and MS is `onlineLegal: false`) and **FL** (horse racing only; BetMGM must never show in FL). Link: official site only (https://sports.betmgm.com/, the location selector), no affiliate link and no bonus claims. No BetMGM odds data, so there's no BetMGM odds column. |

**Which states have legal online sports betting** (`onlineLegal`): AZ, AR, CO, CT, DE, DC, FL, IL, IN, IA, KS, KY,
LA, ME, MD, MA, MI, MO, NV, NH, NJ, NY, NC, OH, OR, PA, RI, TN, VT, VA, WV, WY and PR. Every other state is
`onlineLegal: false`, so it gets no offers. That includes on-premise-only states (MS, WA) and states where online
betting is authorized but not live (WI). Source: Action Network's 50-state table, updated Oct 26, 2026
(https://www.actionnetwork.com/online-sports-betting). Check against the AGA "State of Play" map
(https://www.americangaming.org/research/state-gaming-map/).

**Uncertain or nuanced entries** (marked `uncertain: true` or noted in `note`):
- **LA**: online betting is legal only in parishes that approved it, and parishes aren't modeled.
- **WI**: mobile betting is authorized but not live; re-check.
- **PR**: a territory with different regulation.
- **AR**: FanDuel operates as "Oaklawn Sports powered by FanDuel".
- **DE, RI, NV**: online betting is legal, but we show none of the four books we list (Hard Rock Bet, DraftKings, FanDuel, BetMGM) there. Visitors see a neutral note ("We don't show sportsbook offers in …").
- **NV**: BetMGM is the only book we list that runs a Nevada sportsbook app, but it is **excluded by the owner's choice** (Oct 26, 2026) because sign-up there can require an in-person casino visit. NV stays `uncertain`.
- **MS**: BetMGM's Mississippi app is on-premises only, so MS stays `onlineLegal: false` with no offers.
- **FL**: BetMGM offers only horse racing in Florida, not sports betting, so FL shows Hard Rock Bet only.
- **NH and OR**: DraftKings is the only online sportsbook.
