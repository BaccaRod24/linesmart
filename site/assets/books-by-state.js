/* Generated from data/books-by-state.json by scripts/seo_pages.py. Do not edit.
 * Browser copy of the shared state file, so the deploy content hash changes when it changes.
 * geo-core.js reads data/books-by-state.json in Node and window.BOOKS_BY_STATE from this file. */
(function (root, data) {
  if (typeof module === "object" && module.exports) module.exports = data;
  else root.BOOKS_BY_STATE = data;
})(typeof self !== "undefined" ? self : this, {
 "_about": "Where Hard Rock Bet, DraftKings, FanDuel and BetMGM run legal ONLINE sportsbooks, by US state/territory, plus state helplines. Shared by the Python page build and site/assets/geo-core.js. The browser copy is generated at site/assets/books-by-state.js. Not legal advice; each book geolocates bettors itself. Re-verify before changing and update asOf. Sources and method: docs/books_by_state.md. A state helpline is added only after checking an official source; every other state uses gambler.",
 "asOf": "2026-10-26",
 "books": {
  "hardrockbet": "Hard Rock Bet",
  "draftkings": "DraftKings",
  "fanduel": "FanDuel",
  "betmgm": "BetMGM"
 },
 "sources": {
  "hardrockbet": [
   "https://www.hardrock.bet/help-center/ (operator footer: 'Must be 21+ and physically present in AZ, CO, FL, IL, IN, MI, NJ, OH, TN or VA', checked 2026-10-26)",
   "https://www.hardrock.bet/sportsbook/new-jersey/ (licensed-states list, updated 2026-09-23)"
  ],
  "draftkings": [
   "https://dknetwork.draftkings.com/2026/06/17/draftkings-is-now-available-nationwide-in-the-usa-read-more-inside/ (DraftKings Online Sports Betting state list, updated 2026-07-22)",
   "https://www.sec.gov/Archives/edgar/data/1883685/000188368526000020/R7.htm (DraftKings 10-Q: Sportsbook jurisdictions as of 2026-03-31)"
  ],
  "fanduel": [
   "https://sportsbook.fanduel.com/select-region (FanDuel Sportsbook state picker, checked 2026-10-26)",
   "https://www.fanduel.com/legal-sports-betting-us-map (Sportsbook vs Predicts by state)"
  ],
  "betmgm": [
   "https://sports.betmgm.com/en/sports (BetMGM's official 'Where are you playing from?' location selector, Sports tab, checked 2026-10-26: AZ, CO, DC, IL, IN, IA, KS, KY, LA, MD, MA, MI, MS, MO, NV, NJ, NY, NC, OH, PA, PR, TN, VA, WV, WY; Florida is listed under horse racing only)",
   "https://www.sharpfootballanalysis.com/sportsbook/guides/betmgm-legal-states/ (BetMGM legal states, updated Oct 2026; secondary cross-check)"
  ],
  "onlineLegal": [
   "https://www.americangaming.org/ (AGA State of Play map: authoritative reference)",
   "https://www.actionnetwork.com/online-sports-betting (50-state table, updated 2026-10-26; secondary source used for the yes/no list)"
  ]
 },
 "states": {
  "AL": {
   "name": "Alabama",
   "onlineLegal": false,
   "books": [],
   "slug": "alabama"
  },
  "AK": {
   "name": "Alaska",
   "onlineLegal": false,
   "books": [],
   "slug": "alaska"
  },
  "AZ": {
   "name": "Arizona",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "arizona"
  },
  "AR": {
   "name": "Arkansas",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel"
   ],
   "note": "FanDuel operates in Arkansas as \"Oaklawn Sports powered by FanDuel\".",
   "slug": "arkansas",
   "uncertain": true
  },
  "CA": {
   "name": "California",
   "onlineLegal": false,
   "books": [],
   "slug": "california"
  },
  "CO": {
   "name": "Colorado",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "colorado"
  },
  "CT": {
   "name": "Connecticut",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel"
   ],
   "slug": "connecticut"
  },
  "DE": {
   "name": "Delaware",
   "onlineLegal": true,
   "books": [],
   "note": "Single online operator (not Hard Rock Bet, DraftKings, FanDuel or BetMGM).",
   "slug": "delaware"
  },
  "DC": {
   "name": "District of Columbia",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "washington-dc"
  },
  "FL": {
   "name": "Florida",
   "onlineLegal": true,
   "books": [
    "hardrockbet"
   ],
   "note": "Hard Rock Bet (Seminole Tribe of Florida) is the only legal online sportsbook in Florida.",
   "slug": "florida"
  },
  "GA": {
   "name": "Georgia",
   "onlineLegal": false,
   "books": [],
   "slug": "georgia"
  },
  "HI": {
   "name": "Hawaii",
   "onlineLegal": false,
   "books": [],
   "slug": "hawaii"
  },
  "ID": {
   "name": "Idaho",
   "onlineLegal": false,
   "books": [],
   "slug": "idaho"
  },
  "IL": {
   "name": "Illinois",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "illinois"
  },
  "IN": {
   "name": "Indiana",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "indiana"
  },
  "IA": {
   "name": "Iowa",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "iowa"
  },
  "KS": {
   "name": "Kansas",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "kansas"
  },
  "KY": {
   "name": "Kentucky",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "kentucky"
  },
  "LA": {
   "name": "Louisiana",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "note": "Online betting is allowed only in parishes that approved it; DraftKings and FanDuel geofence the rest. Parish-level detail is not modeled.",
   "uncertain": true,
   "slug": "louisiana"
  },
  "ME": {
   "name": "Maine",
   "onlineLegal": true,
   "books": [
    "draftkings"
   ],
   "note": "Two online operators; FanDuel is not one of them.",
   "slug": "maine"
  },
  "MD": {
   "name": "Maryland",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "maryland"
  },
  "MA": {
   "name": "Massachusetts",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "massachusetts"
  },
  "MI": {
   "name": "Michigan",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "michigan"
  },
  "MN": {
   "name": "Minnesota",
   "onlineLegal": false,
   "books": [],
   "slug": "minnesota"
  },
  "MS": {
   "name": "Mississippi",
   "onlineLegal": false,
   "books": [],
   "note": "Mobile betting only on casino premises; no statewide online betting. BetMGM's Mississippi app works only on casino property, so it gets no offer.",
   "slug": "mississippi",
   "uncertain": true
  },
  "MO": {
   "name": "Missouri",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "missouri"
  },
  "MT": {
   "name": "Montana",
   "onlineLegal": false,
   "books": [],
   "note": "Betting runs through the state lottery at licensed locations; no statewide online sportsbook.",
   "slug": "montana"
  },
  "NE": {
   "name": "Nebraska",
   "onlineLegal": false,
   "books": [],
   "slug": "nebraska"
  },
  "NV": {
   "name": "Nevada",
   "onlineLegal": true,
   "books": [],
   "note": "Online betting is legal, but Nevada apps have their own sign-up rules (some require registering in person at a casino). BetMGM runs a Nevada app, but we don't show it here (our choice) because sign-up can require an in-person casino visit.",
   "uncertain": true,
   "slug": "nevada"
  },
  "NH": {
   "name": "New Hampshire",
   "onlineLegal": true,
   "books": [
    "draftkings"
   ],
   "note": "DraftKings is the state's only online sportsbook.",
   "slug": "new-hampshire"
  },
  "NJ": {
   "name": "New Jersey",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "new-jersey"
  },
  "NM": {
   "name": "New Mexico",
   "onlineLegal": false,
   "books": [],
   "slug": "new-mexico"
  },
  "NY": {
   "name": "New York",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "new-york"
  },
  "NC": {
   "name": "North Carolina",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "north-carolina"
  },
  "ND": {
   "name": "North Dakota",
   "onlineLegal": false,
   "books": [],
   "note": "Tribal retail betting only; no statewide online sportsbook.",
   "slug": "north-dakota"
  },
  "OH": {
   "name": "Ohio",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "ohio"
  },
  "OK": {
   "name": "Oklahoma",
   "onlineLegal": false,
   "books": [],
   "slug": "oklahoma"
  },
  "OR": {
   "name": "Oregon",
   "onlineLegal": true,
   "books": [
    "draftkings"
   ],
   "note": "DraftKings is the state's only online sportsbook.",
   "slug": "oregon"
  },
  "PA": {
   "name": "Pennsylvania",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "pennsylvania"
  },
  "RI": {
   "name": "Rhode Island",
   "onlineLegal": true,
   "books": [],
   "note": "Online betting through the state lottery's operator (not Hard Rock Bet, DraftKings, FanDuel or BetMGM).",
   "slug": "rhode-island"
  },
  "SC": {
   "name": "South Carolina",
   "onlineLegal": false,
   "books": [],
   "slug": "south-carolina"
  },
  "SD": {
   "name": "South Dakota",
   "onlineLegal": false,
   "books": [],
   "slug": "south-dakota"
  },
  "TN": {
   "name": "Tennessee",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "tennessee"
  },
  "TX": {
   "name": "Texas",
   "onlineLegal": false,
   "books": [],
   "slug": "texas"
  },
  "UT": {
   "name": "Utah",
   "onlineLegal": false,
   "books": [],
   "slug": "utah"
  },
  "VT": {
   "name": "Vermont",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel"
   ],
   "slug": "vermont"
  },
  "VA": {
   "name": "Virginia",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "virginia"
  },
  "WA": {
   "name": "Washington",
   "onlineLegal": false,
   "books": [],
   "note": "Mobile betting only on tribal casino premises; no statewide online betting.",
   "slug": "washington"
  },
  "WV": {
   "name": "West Virginia",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "west-virginia"
  },
  "WI": {
   "name": "Wisconsin",
   "onlineLegal": false,
   "books": [],
   "note": "Statewide mobile betting authorized but not live as of Oct 2026; treated as not legal online until launch. UNCERTAIN: re-check.",
   "uncertain": true,
   "slug": "wisconsin"
  },
  "WY": {
   "name": "Wyoming",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "slug": "wyoming"
  },
  "PR": {
   "name": "Puerto Rico",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ],
   "note": "US territory; DraftKings, FanDuel and BetMGM list Puerto Rico. Regulation differs from the states, so confirm locally.",
   "uncertain": true,
   "slug": "puerto-rico"
  }
 },
 "urls": {
  "hardrockbet": "https://www.hardrock.bet/",
  "draftkings": "https://sportsbook.draftkings.com/",
  "fanduel": "https://sportsbook.fanduel.com/",
  "betmgm": "https://sports.betmgm.com/"
 },
 "gambler": {
  "name": "1-800-GAMBLER",
  "tel": "18004262537",
  "url": "https://www.1800gambler.net",
  "label": "1800gambler.net"
 },
 "helplines": {
  "FL": {
   "name": "1-833-PLAYWISE",
   "tel": "18337529947",
   "url": "https://playwise.org/",
   "label": "playwise.org"
  },
  "AZ": {
   "name": "1-800-NEXT-STEP",
   "tel": "18006398783",
   "url": "https://problemgambling.az.gov/",
   "label": "problemgambling.az.gov"
  },
  "IN": {
   "name": "1-800-9-WITH-IT",
   "tel": "18009948448",
   "url": "https://www.in.gov/igc/problemgamblinghelp/problem-gambling-hotline/",
   "label": "in.gov"
  },
  "IA": {
   "name": "1-800-BETS-OFF",
   "tel": "18002387633",
   "url": "https://yourlifeiowa.org/learn/gambling",
   "label": "yourlifeiowa.org"
  },
  "NY": {
   "name": "1-877-8-HOPENY",
   "tel": "18778467369",
   "url": "https://oasas.ny.gov/hopeline",
   "label": "oasas.ny.gov",
   "sms": "467369",
   "smsName": "HOPENY (467369)"
  }
 }
});
