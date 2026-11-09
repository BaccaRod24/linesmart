/* Pro rankings fallback packed into the private bundle.
   The player snapshot is not stored in this file. The public repo would publish it,
   and GitHub Pages is not the only way a public repo is readable.
   scripts/build_rankings.mjs writes the real snapshot to _private/rankings.json
   (gitignored) for the pro-private bucket. A Pro session loads that object.
   This shell is what a pack contains when the bucket file is missing. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RankingsData = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return { v: 1, leagues: {} };
});
