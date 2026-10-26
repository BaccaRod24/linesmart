/* Where Hard Rock Bet, DraftKings, FanDuel and BetMGM run legal ONLINE sportsbooks, by US state (window.BOOKS_BY_STATE;
 * require() in Node tests). A .js data file (not .json) so the deploy's content hash and service-worker version
 * change whenever it changes. Sources, method and uncertain entries: docs/books_by_state.md. Not legal advice. */
(function (root, data) {
  if (typeof module === "object" && module.exports) module.exports = data;
  else root.BOOKS_BY_STATE = data;
})(typeof self !== "undefined" ? self : this, {
 "_about": "Where Hard Rock Bet, DraftKings, FanDuel and BetMGM run legal ONLINE sportsbooks, by US state/territory. Used by assets/geo-core.js / geo.js for state-aware offers. Not legal advice; each book geolocates bettors itself. Re-verify before changing and update asOf. Sources and method: docs/books_by_state.md.",
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
   "books": []
  },
  "AK": {
   "name": "Alaska",
   "onlineLegal": false,
   "books": []
  },
  "AZ": {
   "name": "Arizona",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "AR": {
   "name": "Arkansas",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel"
   ],
   "note": "FanDuel operates in Arkansas as \"Oaklawn Sports powered by FanDuel\"."
  },
  "CA": {
   "name": "California",
   "onlineLegal": false,
   "books": []
  },
  "CO": {
   "name": "Colorado",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "CT": {
   "name": "Connecticut",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel"
   ]
  },
  "DE": {
   "name": "Delaware",
   "onlineLegal": true,
   "books": [],
   "note": "Single online operator (not Hard Rock Bet, DraftKings, FanDuel or BetMGM)."
  },
  "DC": {
   "name": "District of Columbia",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "FL": {
   "name": "Florida",
   "onlineLegal": true,
   "books": [
    "hardrockbet"
   ],
   "note": "Hard Rock Bet (Seminole Tribe of Florida) is the only legal online sportsbook in Florida."
  },
  "GA": {
   "name": "Georgia",
   "onlineLegal": false,
   "books": []
  },
  "HI": {
   "name": "Hawaii",
   "onlineLegal": false,
   "books": []
  },
  "ID": {
   "name": "Idaho",
   "onlineLegal": false,
   "books": []
  },
  "IL": {
   "name": "Illinois",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "IN": {
   "name": "Indiana",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "IA": {
   "name": "Iowa",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "KS": {
   "name": "Kansas",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "KY": {
   "name": "Kentucky",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ]
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
   "uncertain": true
  },
  "ME": {
   "name": "Maine",
   "onlineLegal": true,
   "books": [
    "draftkings"
   ],
   "note": "Two online operators; FanDuel is not one of them."
  },
  "MD": {
   "name": "Maryland",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "MA": {
   "name": "Massachusetts",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "MI": {
   "name": "Michigan",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "MN": {
   "name": "Minnesota",
   "onlineLegal": false,
   "books": []
  },
  "MS": {
   "name": "Mississippi",
   "onlineLegal": false,
   "books": [],
   "note": "Mobile betting only on casino premises; no statewide online betting. BetMGM's Mississippi app works only on casino property, so it gets no offer."
  },
  "MO": {
   "name": "Missouri",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "MT": {
   "name": "Montana",
   "onlineLegal": false,
   "books": [],
   "note": "Betting runs through the state lottery at licensed locations; no statewide online sportsbook."
  },
  "NE": {
   "name": "Nebraska",
   "onlineLegal": false,
   "books": []
  },
  "NV": {
   "name": "Nevada",
   "onlineLegal": true,
   "books": [],
   "note": "Online betting is legal, but Nevada apps have their own sign-up rules (some require registering in person at a casino). BetMGM runs a Nevada app, but we don't show it here (Rod's choice) because sign-up can require an in-person casino visit.",
   "uncertain": true
  },
  "NH": {
   "name": "New Hampshire",
   "onlineLegal": true,
   "books": [
    "draftkings"
   ],
   "note": "DraftKings is the state's only online sportsbook."
  },
  "NJ": {
   "name": "New Jersey",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "NM": {
   "name": "New Mexico",
   "onlineLegal": false,
   "books": []
  },
  "NY": {
   "name": "New York",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "NC": {
   "name": "North Carolina",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "ND": {
   "name": "North Dakota",
   "onlineLegal": false,
   "books": [],
   "note": "Tribal retail betting only; no statewide online sportsbook."
  },
  "OH": {
   "name": "Ohio",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "OK": {
   "name": "Oklahoma",
   "onlineLegal": false,
   "books": []
  },
  "OR": {
   "name": "Oregon",
   "onlineLegal": true,
   "books": [
    "draftkings"
   ],
   "note": "DraftKings is the state's only online sportsbook."
  },
  "PA": {
   "name": "Pennsylvania",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "RI": {
   "name": "Rhode Island",
   "onlineLegal": true,
   "books": [],
   "note": "Online betting through the state lottery's operator (not Hard Rock Bet, DraftKings, FanDuel or BetMGM)."
  },
  "SC": {
   "name": "South Carolina",
   "onlineLegal": false,
   "books": []
  },
  "SD": {
   "name": "South Dakota",
   "onlineLegal": false,
   "books": []
  },
  "TN": {
   "name": "Tennessee",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "TX": {
   "name": "Texas",
   "onlineLegal": false,
   "books": []
  },
  "UT": {
   "name": "Utah",
   "onlineLegal": false,
   "books": []
  },
  "VT": {
   "name": "Vermont",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel"
   ]
  },
  "VA": {
   "name": "Virginia",
   "onlineLegal": true,
   "books": [
    "hardrockbet",
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "WA": {
   "name": "Washington",
   "onlineLegal": false,
   "books": [],
   "note": "Mobile betting only on tribal casino premises; no statewide online betting."
  },
  "WV": {
   "name": "West Virginia",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ]
  },
  "WI": {
   "name": "Wisconsin",
   "onlineLegal": false,
   "books": [],
   "note": "Statewide mobile betting authorized but not live as of Oct 2026; treated as not legal online until launch. UNCERTAIN: re-check.",
   "uncertain": true
  },
  "WY": {
   "name": "Wyoming",
   "onlineLegal": true,
   "books": [
    "draftkings",
    "fanduel",
    "betmgm"
   ]
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
   "uncertain": true
  }
 }
});
