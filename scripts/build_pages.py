#!/usr/bin/env python3
"""Build LineSmart's static legal pages and the shared footer.

One source of truth for the compliance footer: it is written into site/index.html (between the
<!-- footer:start --> / <!-- footer:end --> markers) and into every legal page generated here:
  site/about.html, site/responsible-gambling.html, site/privacy.html, site/terms.html, site/affiliate-disclosure.html
and the weekly-email pages site/subscribed.html (confirm) and site/unsubscribe.html (not in the legal nav, noindex).
Run after editing:  python3 scripts/build_pages.py        (--check: exit 1 if files are out of date)

Helpline numbers/URLs were verified on Oct 26, 2026 (state lines NY/AZ/IN/IA on Oct 27, 2026;
Michigan now uses 1-800-GAMBLER per the MGCB, so it has no separate line; see site/assets/geo-core.js HELPLINES) (see the compliance commit message); re-check them
before changing.
"""
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
BASE_URL = "https://linesmart.app/"
EFFECTIVE = "October 27, 2026"   # affiliate-compliance: affiliate links + licensed-books-only sections
PRIVACY_UPDATED = "October 27, 2026"   # Pro waitlist section added
CONTACT = "contact@linesmart.app"   # public contact address shown on the legal pages

def ext(href, text):
    return f'<a href="{href}" target="_blank" rel="noopener">{text}</a>'

GAMBLER_TEL = '<a href="tel:18004262537">1-800-GAMBLER</a>'
GAMBLER_WEB = ext("https://www.1800gambler.net", "1800gambler.net")
PLAYWISE_TEL = '<a href="tel:18337529947">1-833-PLAYWISE</a>'
PLAYWISE_WEB = ext("https://playwise.org/", "playwise.org")
# helpline sentence for static pages that run no state JS (redirect stubs): same wording as GeoCore.rgCallHTML for an unknown state
RG_CALL_STATIC = f"Call or text {GAMBLER_TEL}. In Florida: {PLAYWISE_TEL}."
ADMIT_TEL = '<a href="tel:18882364848">1-888-ADMIT-IT</a>'
ADMIT_WEB = ext("https://gamblinghelp.org/", "gamblinghelp.org")

PAGES = [  # (file, nav label)
    ("about.html", "About"),
    ("responsible-gambling.html", "Responsible Gambling"),
    ("privacy.html", "Privacy Policy"),
    ("terms.html", "Terms of Use"),
    ("affiliate-disclosure.html", "Affiliate Disclosure"),
]

HUBS = [  # (href, label): crawlable league hubs built each refresh by scripts/seo_pages.py
    ("nfl/", "NFL odds"),
    ("nba/", "NBA odds"),
    ("mlb/", "MLB odds"),
    ("nhl/", "NHL odds"),
    ("ncaaf/", "College football odds"),
    ("ncaab/", "College basketball odds"),
    ("ufc/", "UFC odds"),
]

TOOLS = [  # (href, label): footer quick links into the app (relative, so subpath hosting and preview pages' <base> work)
    ("./#/value", "Value finder"),
    ("./#/account/alerts", "Line alerts"),
    ("./#/bets", "My Bets"),
    ("./#/pro", "Pro: join the waitlist"),
]

FOOTER = f"""<footer class="footer" id="siteFooter">
  <div class="wrap">
    <div class="news-foot" data-news-signup="footer"></div>
    <p class="rg"><span class="age-pill">21+</span> <strong>21+ only.</strong> Gambling problem? Call or text {GAMBLER_TEL} · {GAMBLER_WEB}</p>
    <p class="rg fl" data-rg-local>Florida: call or text {PLAYWISE_TEL} ({PLAYWISE_WEB}), or the Florida Council on Compulsive Gambling helpline {ADMIT_TEL} ({ADMIT_WEB}).</p>
    <p><strong data-brand>LineSmart</strong> is an informational site and does not accept wagers. Odds are for reference and may change; confirm with the sportsbook.</p>
    <p class="biz">LineSmart · <a href="mailto:{CONTACT}">{CONTACT}</a></p>
    <p class="aff-disc" data-aff-disclosure hidden></p>
    <nav class="legal-links" aria-label="Legal">{" ".join(f'<a href="{f}">{n}</a>' for f, n in PAGES)}</nav>
    <nav class="hub-links" aria-label="Sports">{" ".join(f'<a href="{f}">{n}</a>' for f, n in HUBS)}</nav>
    <nav class="tool-links" aria-label="Tools">{" ".join(f'<a href="{f}">{n}</a>' for f, n in TOOLS)}</nav>
    <p class="src">Data: ESPN public endpoints (schedules, stats, DraftKings opening lines and fallback lines); Hard Rock Bet, FanDuel and DraftKings lines and props via The Odds API; weather by Open-Meteo. Independent: not owned by or affiliated with any league or sportsbook. Times shown in US Eastern (ET).</p>
  </div>
</footer>"""

def page(file, title, desc, body, noindex=False, news_page=""):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#050b1c">
<title>{title} · LineSmart</title>
<meta name="description" content="{desc}">{'\n<meta name="robots" content="noindex">' if noindex else ""}
<link rel="canonical" href="{BASE_URL}{file}">
<link rel="icon" href="favicon.ico" sizes="any">
<link rel="icon" href="assets/brand/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/brand/apple-touch-icon.png" sizes="180x180">
<link rel="manifest" href="manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="LineSmart">
<meta property="og:type" content="website">
<meta property="og:site_name" content="LineSmart">
<meta property="og:title" content="{title} · LineSmart">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{BASE_URL}{file}">
<meta property="og:image" content="{BASE_URL}assets/brand/og-image.png">
<link rel="preload" href="assets/fonts/inter-latin-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/styles.css">
<script src="assets/theme.js"></script>
<script src="assets/config.js"></script>
<script src="assets/site.js" defer></script>
<script src="assets/news-core.js" defer></script>
<script src="assets/news.js" defer></script>
</head>
<body class="legal-page"{f' data-news-page="{news_page}"' if news_page else ""}>
<!-- generated by scripts/build_pages.py: edit there, then run it -->
<header class="topbar">
  <div class="wrap topbar-inner">
    <a class="brand" href="./" title="LineSmart — home"><img class="brand-logo" src="assets/brand/logo.svg" alt="LineSmart" width="277" height="64"></a>
    <a class="legal-nav-a" href="about.html">About</a>
    <a class="search-btn" href="./#/search" aria-label="Search teams and players" title="Search teams and players"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="sb-l">Search</span></a>
  </div>
</header>
<main class="wrap" id="app">
<article class="legal">
  <a class="back" href="./">← Odds &amp; lines</a>
  <h1>{title}</h1>
{body}
</article>
</main>
{FOOTER}
</body>
</html>
"""

# ---------------------------------------------------------------- page content
RG = f"""  <p class="legal-lead">Betting should be entertainment, not a way to make money or fix money problems. If it stops being fun, help is free, confidential and available 24/7.</p>

  <div class="help-grid">
    <div class="help-card">
      <h2>1-800-GAMBLER</h2>
      <p>Call or text {GAMBLER_TEL} (1-800-426-2537), 24/7, confidential.</p>
      <p class="hc-links">{GAMBLER_WEB} · {ext("https://800gambler.org/", "800gambler.org")}</p>
    </div>
    <div class="help-card fl">
      <h2>Florida</h2>
      <p>Florida's official helpline: call or text {PLAYWISE_TEL} (1-833-752-9947) · {PLAYWISE_WEB}</p>
      <p>Florida Council on Compulsive Gambling: call or text {ADMIT_TEL} (1-888-236-4848) · {ADMIT_WEB}</p>
    </div>
    <div class="help-card">
      <h2>Other state helplines</h2>
      <p>Arizona: call {'<a href="tel:18006398783">1-800-NEXT-STEP</a>'} (1-800-639-8783) or text NEXTSTEP to 53342 · {ext("https://problemgambling.az.gov/", "problemgambling.az.gov")}</p>
      <p>Indiana: call {'<a href="tel:18009948448">1-800-9-WITH-IT</a>'} (1-800-994-8448) · {ext("https://www.in.gov/igc/problemgamblinghelp/problem-gambling-hotline/", "in.gov")}</p>
      <p>Iowa: call {'<a href="tel:18002387633">1-800-BETS-OFF</a>'} (1-800-238-7633) · {ext("https://yourlifeiowa.org/learn/gambling", "yourlifeiowa.org")}</p>
      <p>New York: call {'<a href="tel:18778467369">1-877-8-HOPENY</a>'} (1-877-846-7369) or text HOPENY (467369) · {ext("https://oasas.ny.gov/hopeline", "oasas.ny.gov")}</p>
      <p>Everywhere else, including Michigan: {GAMBLER_TEL}.</p>
    </div>
    <div class="help-card">
      <h2>National Council on Problem Gambling</h2>
      <p>National Problem Gambling Helpline: call or text <a href="tel:18006973738">1-800-MY-RESET</a> (1-800-697-3738), or {ext("https://www.ncpgambling.org/chat/", "chat online")}.</p>
      <p class="hc-links">{ext("https://www.ncpgambling.org/", "ncpgambling.org")}</p>
    </div>
    <div class="help-card">
      <h2>Gamblers Anonymous</h2>
      <p>Free peer support meetings, in person and online.</p>
      <p class="hc-links">{ext("https://gamblersanonymous.org/", "gamblersanonymous.org")}</p>
    </div>
  </div>

  <h2>Tips for betting responsibly</h2>
  <ul>
    <li>Only bet money you can afford to lose. Treat it as the cost of entertainment.</li>
    <li>Set a budget and a time limit before you start, and stick to them.</li>
    <li>Don't chase losses. Trying to win money back usually leads to bigger losses.</li>
    <li>Don't bet when you're upset, stressed, or drinking.</li>
    <li>Never borrow money or use money meant for bills to gamble.</li>
    <li>Take regular breaks, and keep other hobbies and plans.</li>
    <li>Odds and stats on LineSmart are information, not predictions. No source can guarantee a win.</li>
  </ul>

  <h2>Warning signs</h2>
  <ul>
    <li>Betting more, or more often, to get the same excitement.</li>
    <li>Hiding or lying about how much you bet.</li>
    <li>Feeling restless or irritable when you try to cut back.</li>
    <li>Missing work, school or family time because of betting.</li>
  </ul>
  <p>If any of these sound familiar, reach out to one of the helplines above. They can also help family and friends.</p>

  <h2>Setting limits</h2>
  <p>Licensed sportsbooks offer tools in your account settings. They usually include:</p>
  <ul>
    <li><b>Deposit limits</b>: cap how much you can add per day, week or month.</li>
    <li><b>Wager limits</b>: cap how much you can bet.</li>
    <li><b>Session or time limits</b> and reality-check reminders.</li>
    <li><b>Time-outs (cool-off)</b>: pause your account for a set period.</li>
  </ul>
  <p>Hard Rock Bet explains its limit, time-out and self-exclusion tools on its responsible gaming site: {ext("https://rg.hardrock.bet/", "rg.hardrock.bet")}.</p>

  <h2>Self-exclusion</h2>
  <p>Self-exclusion lets you block yourself from a sportsbook or casino for a set time or permanently. You can usually request it inside the sportsbook app (for Hard Rock Bet, see {ext("https://rg.hardrock.bet/", "rg.hardrock.bet")}). The Florida Council on Compulsive Gambling ({ADMIT_TEL}) can provide self-exclusion forms for Florida's land-based gambling operators, and information on blocking software for online gambling. Rules differ by state and operator, so check with the operator or a helpline.</p>
  <p>Blocking software and bank gambling blocks can add another layer of protection. A helpline can point you to options.</p>

  <h2>Underage gambling</h2>
  <p>You must be 21 or older to bet on sports in the US where it is legal. LineSmart is meant for adults 21+. Parents can use device parental controls to block gambling sites and apps.</p>
"""

PRIVACY = f"""  <p class="legal-date">Last updated: {PRIVACY_UPDATED}</p>
  <p class="legal-lead">LineSmart is a free website with sports odds, props, matchups and betting tools. It has no ads, and you don't need to sign up to use it. Accounts are optional: you only need one if you want My Bets to sync between your devices. This policy explains what information is involved when you use it.</p>

  <h2>Summary</h2>
  <ul>
    <li>We never ask for your name. If you choose to create an optional account, we store your email address, your tracked bets and any line alerts with our provider Supabase (US) so your bets sync between devices and alerts can email you. We never sell or rent your data.</li>
    <li>We use Cloudflare Web Analytics, which is cookieless, to count page views in aggregate.</li>
    <li>Your browser asks a geolocation service for your approximate state, so we only show sportsbooks that are legal there. You can set your state by hand instead.</li>
    <li>If you sign up for the free weekly email, we store your email address with Supabase and send the email through Resend (US). Every email has a one-click unsubscribe link.</li>
    <li>Without an account, your bet tracker and preferences stay in your browser on your device.</li>
    <li>LineSmart sets no cookies today. Sportsbook sites you visit from our links have their own policies.</li>
  </ul>

  <h2 id="analytics">Analytics (Cloudflare Web Analytics)</h2>
  <p>On linesmart.app we use {ext("https://www.cloudflare.com/web-analytics/", "Cloudflare Web Analytics")} to understand overall traffic. It does not use cookies or other storage on your device, does not fingerprint you, and does not track you across other websites. Your browser loads a small script from <code>static.cloudflareinsights.com</code> and sends a page-view report to <code>cloudflareinsights.com</code>. We see only aggregate reports: page views and visits, the referring site, device type, browser and operating system, country, and page-load performance. Cloudflare processes this data under the {ext("https://www.cloudflare.com/privacypolicy/", "Cloudflare Privacy Policy")}. We don't use the data for advertising, and we don't sell it.</p>

  <h2 id="location">Approximate location (state-aware offers)</h2>
  <p>Sports betting is legal only in some states, and each sportsbook runs only in certain states. To show only sportsbooks that are legal where you are, your browser sends a request to {ext("https://ipdata.info/", "ipdata.info")}, a free IP geolocation service. ipdata.info sees your IP address and returns your approximate country and state. Under its {ext("https://ipdata.info/privacy", "privacy policy")}, it keeps IP addresses only briefly for rate limiting.</p>
  <p>We keep only the country and state code, in your browser (localStorage, <code>ls-geo</code>), for up to 24 hours. It is never sent to us, except the two-letter state code if you join the <a href="#pro-waitlist">Pro waitlist</a>. If the lookup fails, we show no sportsbook offers until you pick a state. You can choose your state with the <b>Your state</b> picker (stored as <code>ls-state</code>); that choice replaces the lookup. IP location is approximate. Sportsbooks verify your location themselves before you can bet.</p>

  <h2 id="accounts">Optional accounts (bet sync)</h2>
  <p>You can use LineSmart without an account. If you sign in on the <a href="./#/account">Account</a> tab, here is what happens:</p>
  <ul>
    <li><b>What we store</b>: your email address, the bets you track in My Bets (with the time each one was last changed) and any line alerts you set. That's all. We don't ask for your name, a password or any sportsbook login.</li>
    <li><b>Where it's stored</b>: with our provider {ext("https://supabase.com/privacy", "Supabase")}, on servers in the United States. Access rules on the database let each signed-in person read and change only their own bets.</li>
    <li><b>Sign-in emails</b>: to sign in, you enter your email and we send you a one-time sign-in code (or link) by email. Supabase sends these emails for us. There are no passwords.</li>
    <li><b>On your device</b>: your sign-in session is kept in your browser (localStorage, <code>ls-sb-auth</code>), along with the email you last used to sign in (<code>ls-acct-email</code>), sync status (<code>ls-sync-v1</code>) and a short list of deleted bets waiting to sync (<code>ls-bets-tomb-v1</code>). The sign-in software is loaded only when you open the Account tab or are signed in.</li>
    <li><b>Why</b>: only to keep your bets the same on your phone, computer and other devices. We never sell your data, use it for advertising or share it with sportsbooks.</li>
    <li><b>Line alerts</b>: if you set a line alert (the bell on a game or player prop), we store what it watches (game, line type, your number, the sportsbooks and the line when you set it) and when it was sent. Your email address is used only to send that one alert email; our email provider {ext("https://resend.com/legal/privacy-policy", "Resend")} delivers it. Each alert emails once, then turns off, and ends when the game starts. We keep a small send log (alert, time) for 3 days to enforce daily email limits. You can delete alerts any time in Account; every alert email links there.</li>
    <li><b>Signing out</b> keeps a copy of your bets on that device.</li>
    <li><b>Deleting your data</b>: the <b>Delete my account and bets</b> button on the <a href="./#/account">Account</a> tab deletes every bet and line alert stored in your account right away. To delete the account itself (your email address), email <a href="mailto:{CONTACT}?subject=Delete%20my%20LineSmart%20account">{CONTACT}</a> from the address you sign in with, and we'll delete it and confirm.</li>
  </ul>
  <p><a class="legal-btn" href="./#/account">Delete my account and bets</a></p>

  <h2 id="newsletter">Weekly email (newsletter)</h2>
  <p>The LineSmart weekly email is free and optional. It's sent on Thursday mornings with the week's best lines across Hard Rock Bet, DraftKings and FanDuel, hot player props and notable line moves, plus occasional notes about LineSmart features. It never contains promo codes or affiliate links.</p>
  <ul>
    <li><b>Signing up</b>: you enter your email address and confirm you're 21 or older. We then email you a confirmation link, and you're only added once you click it (double opt-in). Unconfirmed signups are deleted after 30 days.</li>
    <li><b>What we store</b>: your email address, whether it's pending, confirmed or unsubscribed, when those changes happened, which signup box you used, and two random codes for the confirm and unsubscribe links. To stop abuse we keep a one-way hash of the IP address of each signup attempt for up to 2 days; we never store the IP address itself.</li>
    <li><b>Who handles it</b>: the list is stored with {ext("https://supabase.com/privacy", "Supabase")} in the United States, and the emails are sent by {ext("https://resend.com/legal/privacy-policy", "Resend")} in the United States as our service providers. Resend may record whether an email was delivered or bounced. We don't add tracking pixels or tracked links, and we never sell, rent or share the list.</li>
    <li><b>On your device</b>: after you sign up, your browser remembers the address you entered and whether you've confirmed (localStorage, <code>ls-news-v1</code>), so the signup box can remind you to check your inbox.</li>
    <li><b>Unsubscribing</b>: click <b>Unsubscribe</b> at the bottom of any LineSmart email. One click removes you right away, with no login. You can also email <a href="mailto:{CONTACT}?subject=unsubscribe">{CONTACT}</a> with the subject "unsubscribe". To have your address deleted entirely rather than just unsubscribed, email us from that address and we'll delete it and confirm.</li>
  </ul>

  <h2 id="pro-waitlist">LineSmart Pro waitlist</h2>
  <p>Joining the <a href="./#/pro">LineSmart Pro</a> waitlist is free and optional. Here is what happens:</p>
  <ul>
    <li><b>What we store</b>: your email address, that you confirmed you're 21 or older, your optional survey answers (features you'd use, sports you follow, a fair monthly price), the two-letter code of your state if the site already knows it, which page you joined from, your account ID if you're signed in, and when you joined. Joining again with the same email updates your answers instead of adding a second entry.</li>
    <li><b>Why</b>: to tell you when Pro opens and to decide what to build first. We send no confirmation email and no other email from this list; you'll get one email when Pro opens. We never sell, rent or share the list.</li>
    <li><b>Where it's stored</b>: with {ext("https://supabase.com/privacy", "Supabase")} in the United States. The list can't be read from the website; only we can read it. To stop abuse we keep a one-way hash of the IP address of each attempt for up to 2 days, never the IP address itself.</li>
    <li><b>On your device</b>: your browser remembers the address you joined with (localStorage, <code>ls-pro-v1</code>) so the page can show you're on the list.</li>
    <li><b>Leaving the list</b>: email <a href="mailto:{CONTACT}?subject=Pro%20waitlist">{CONTACT}</a> from that address and we'll delete your entry and confirm.</li>
  </ul>

  <h2>Hosting (GitHub Pages)</h2>
  <p>The site is hosted on GitHub Pages. Like most web hosts, GitHub may log technical data when your browser requests a page, such as your IP address, browser type and the page requested. It uses this data for security and to run the service. We don't receive these logs. See the {ext("https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement", "GitHub Privacy Statement")}.</p>

  <h2>Data stored on your device</h2>
  <p>These items are saved in your browser so the site works. They stay on your device and are never sent to us, except your bets if you choose to sign in and sync (see <a href="#accounts">Optional accounts</a>):</p>
  <ul>
    <li><b>Bet tracker</b> (localStorage, <code>ls-bets-v1</code> and <code>ls-bets-prefs</code>): bets you log in My Bets and your tracker settings. Without an account they aren't uploaded or synced anywhere. They're never linked to any sportsbook account. Use the tracker's export to keep a backup.</li>
    <li><b>Your state</b> (localStorage, <code>ls-state</code>, and the cached lookup <code>ls-geo</code>): see above.</li>
    <li><b>Recently viewed</b> (localStorage, <code>ls-recent</code>): up to 8 teams or players you opened, shown on the search screen.</li>
    <li><b>Weekly email signup</b> (localStorage, <code>ls-news-v1</code>): see <a href="#newsletter">Weekly email</a>.</li>
    <li><b>Pro waitlist</b> (localStorage, <code>ls-pro-v1</code>): see <a href="#pro-waitlist">Pro waitlist</a>.</li>
    <li><b>21+ notice</b> (localStorage, <code>ls-age-ok</code>): the time you dismissed the age notice, so it isn't shown again.</li>
    <li><b>View preferences</b> (sessionStorage, <code>filter-&lt;league&gt;</code>): your "Upcoming" or "Incl. today's finals" choice on a league page. It is cleared when you close the tab.</li>
    <li><b>Offline cache</b> (service worker and Cache Storage): copies of the site's files, the odds and stats data files, and recently opened ESPN team and player data, so the site loads fast and works offline.</li>
  </ul>
  <p>You can delete all of this at any time by clearing this site's data in your browser settings.</p>

  <h2>Third-party requests (ESPN)</h2>
  <p>Some content loads directly from ESPN. Your browser requests team logos and player photos from ESPN's image servers (such as <code>a.espncdn.com</code>). Team and player pages, search results and bet grading load live data from <code>site.web.api.espn.com</code>. ESPN therefore receives standard request data, such as your IP address, browser type and the page you came from. ESPN's handling of that data is covered by the {ext("https://privacy.thewaltdisneycompany.com/en/", "Disney/ESPN privacy policy")}.</p>
  <p>Odds, schedule and weather files are built ahead of time on GitHub's servers from ESPN, The Odds API and Open-Meteo. Your browser does not contact The Odds API or Open-Meteo.</p>

  <h2 id="affiliate">Sportsbook and affiliate links</h2>
  <p>LineSmart shows links to licensed sportsbooks, only in states where they're legal. <b>Today these links go to each sportsbook's official website and are not affiliate links.</b> We plan to add affiliate tracking links later. When we do, an affiliate link may carry a tracking code in the web address. The sportsbook or its affiliate network may then set cookies or use similar technology on <i>their</i> site to credit LineSmart for your sign-up. LineSmart itself sets no cookies, now or for affiliate links, and we will not receive your name, account or betting details from a sportsbook. Affiliate links will be labeled, and this page and our <a href="affiliate-disclosure.html">Affiliate Disclosure</a> will be updated before they go live.</p>
  <p>Other links go to helplines and other sites. Their own privacy policies apply when you visit them.</p>

  <h2>Cookies</h2>
  <p>LineSmart does not set cookies. Cloudflare Web Analytics is cookieless. Sportsbook sites you visit from our links may set their own cookies, as described above.</p>

  <h2>Children</h2>
  <p>LineSmart is meant for adults 21 and older and is not directed at children. We don't knowingly collect information from anyone under 21.</p>

  <h2>Selling or sharing data</h2>
  <p>We never sell, rent or share personal information. We don't collect names. We store an email address, tracked bets and line alerts only if you create an optional account, and only to sync your bets and send the alerts you set, and an email address if you sign up for the weekly email, only to send it. Supabase and Resend handle these for us as our service providers. The other services named above (Cloudflare, ipdata.info, GitHub and ESPN) receive standard request data only because your browser contacts them.</p>

  <h2>Changes</h2>
  <p>If this policy changes, we'll update this page and the "last updated" date above.</p>

  <h2>Contact</h2>
  <p>Questions? Email <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
"""

TERMS = f"""  <p class="legal-date">Effective date: {EFFECTIVE}</p>
  <p class="legal-lead">By using LineSmart you agree to these terms. If you don't agree, please don't use the site.</p>

  <h2>Informational use only</h2>
  <p>LineSmart provides sports odds, lines and stats for information and entertainment. LineSmart is not a sportsbook. It does not accept wagers, hold funds, or place bets for anyone.</p>

  <h2>No guarantee of accuracy</h2>
  <p>Odds change quickly and data can be late, incomplete or wrong. Everything is provided "as is" without warranties of any kind. Always confirm odds and terms with the sportsbook before placing a bet.</p>

  <h2>Not financial or betting advice</h2>
  <p>Nothing on LineSmart is financial, investment, legal or betting advice, or a guarantee of any result. You are solely responsible for your decisions and any bets you make.</p>

  <h2>Age and local law</h2>
  <p>You must be 21 or older to use LineSmart. Sports betting is legal only in some places. You are responsible for knowing and following the laws where you are.</p>

  <h2>Third-party data and trademarks</h2>
  <p>Some data comes from third parties, including ESPN, The Odds API and Open-Meteo. That data, and all team, league and sportsbook names, logos and trademarks, belong to their owners. They are used only to identify the teams, leagues and sportsbooks.</p>

  <h2>No affiliation</h2>
  <p>LineSmart is independent and is not owned by any sportsbook. It is not affiliated with, endorsed by or sponsored by any league, team, ESPN, The Odds API or sportsbook. Links to sportsbooks currently go to their official websites and are not affiliate links. If we join a sportsbook affiliate program, those links will be labeled and listed on our <a href="affiliate-disclosure.html">Affiliate Disclosure</a> page.</p>

  <h2>Affiliate links</h2>
  <p>LineSmart may earn a commission from sportsbook links, at no extra cost to you. Commissions never change the odds we show: odds come from the data sources named on each page, and the best price is highlighted whichever sportsbook offers it. Sportsbook offers are state-specific: which sportsbooks and offers you see depends on your state, and some states have none. Full details are on our <a href="affiliate-disclosure.html">Affiliate Disclosure</a> page.</p>

  <h2>Licensed, legal sportsbooks only</h2>
  <p>LineSmart only lists state-licensed, legal US sportsbooks, and only in states where each one is legal online. We never list, link to or promote offshore or unlicensed sportsbooks.</p>

  <h2>Sportsbook links and your location</h2>
  <p>We show sportsbook links only in states where we believe that sportsbook runs a legal online sportsbook, based on an approximate location or the state you pick. This may be wrong. Sportsbooks verify your age and location themselves. Don't use LineSmart to decide whether betting is legal for you.</p>

  <h2>Links to other sites</h2>
  <p>We are not responsible for the content, offers or practices of sites we link to.</p>

  <h2>Limitation of liability</h2>
  <p>To the fullest extent allowed by law, LineSmart and its operators are not liable for any loss or damage from using, or not being able to use, the site or its data. This includes betting losses and indirect or consequential damages.</p>

  <h2>Changes</h2>
  <p>We may update these terms. The effective date above shows the latest version, and continuing to use the site means you accept it.</p>

  <h2>Governing law</h2>
  <p>These terms are governed by the laws of the State of Florida, without regard to its conflict-of-law rules.</p>

  <h2>Contact</h2>
  <p>Questions? Email <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
"""

AFFILIATE = f"""  <p class="legal-date">Effective date: {EFFECTIVE}</p>
  <p class="legal-lead"><b>Right now, LineSmart has no affiliate relationships.</b> We don't earn money from any sportsbook, and no links on the site are affiliate links. In states where a sportsbook is legal, we link to its official website; those links don't pay us and carry no tracking code. The sportsbooks we link to are Hard Rock Bet, DraftKings, FanDuel and BetMGM.</p>
  <p>LineSmart plans to make money through affiliate links to licensed sportsbooks. This page will be updated, and the links labeled, before any go live.</p>

  <h2>If that changes</h2>
  <p>We may later join affiliate programs with licensed sportsbooks. When we do:</p>
  <ul>
    <li>LineSmart may earn a commission when you sign up or deposit through one of our links, <b>at no extra cost to you</b>.</li>
    <li>Affiliate links will be labeled, with a short disclosure next to them.</li>
    <li>Commissions <b>won't change the odds shown</b>. Odds come from the data sources named on each page, and the best price is highlighted whichever sportsbook offers it.</li>
    <li>We'll list our affiliate partners on this page and update the effective date.</li>
    <li>An affiliate link may carry a tracking code, and the sportsbook or its affiliate network may set cookies on their own site to credit the referral. LineSmart sets no cookies. See our <a href="privacy.html#affiliate">Privacy Policy</a>.</li>
  </ul>

  <h2>Our standards</h2>
  <ul>
    <li>Affiliate links will only go to sportsbooks licensed where they operate, for users 21+, and only in states where that sportsbook is legal online.</li>
    <li><b>Offers are state-specific.</b> Which sportsbooks and offers you see depends on your state, and some states have none.</li>
    <li><b>No offshore sportsbooks.</b> LineSmart only lists state-licensed, legal US sportsbooks. We never list, link to or promote offshore or unlicensed sportsbooks.</li>
    <li>We won't advertise bonus amounts or promotions that the sportsbook hasn't approved and currently offers.</li>
    <li>Responsible gambling information and helplines will stay on every page. See <a href="responsible-gambling.html">Responsible Gambling</a>.</li>
  </ul>

  <h2>Contact</h2>
  <p>Questions? Email <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
"""

ABOUT = f"""  <p class="legal-lead">LineSmart is a free website with sports odds, player props, matchups and betting tools. It isn't a sportsbook: it does not take bets or hold money.</p>

  <h2>What LineSmart does</h2>
  <ul>
    <li><b>Odds and lines</b>: spreads, moneylines and totals for upcoming games across major US and international leagues, with line movement since the open.</li>
    <li><b>Odds comparison</b>: Hard Rock Bet, DraftKings and FanDuel prices side by side, with the best available price highlighted, plus player prop lines and prices from all three for NFL and NBA.</li>
    <li><b>Player props</b>: prop lines with each player's recent games against the line.</li>
    <li><b>Matchups</b>: team form, home and away splits, injuries, season stats and head-to-head comparisons.</li>
    <li><b>Game-day weather</b> for outdoor games.</li>
    <li><b>My Bets</b>: a private bet tracker that stays in your browser on your device, or syncs between your devices if you sign in with an optional account.</li>
    <li><a href="./#/value"><b>Value finder</b></a>: prices that pay more than the market's no-vig fair odds.</li>
    <li><b>Game, player and team pages</b>: one page per game with lines across books, line movement, weather, props and form, and final scores with closing lines afterward. Start at a league: <a href="nfl/">NFL</a>, <a href="nba/">NBA</a>, <a href="mlb/">MLB</a>, <a href="nhl/">NHL</a>, <a href="ncaaf/">college football</a>, <a href="ncaab/">college basketball</a> or <a href="ufc/">UFC</a>.</li>
    <li><a href="./#/account/alerts"><b>Line alerts</b></a>: one email when a line moves or hits your number (needs the optional account).</li>
  </ul>

  <h2>Who runs it</h2>
  <p>LineSmart is an independent site, reachable at <a href="mailto:{CONTACT}">{CONTACT}</a>. It is not owned by, and does not own, any sportsbook, and it isn't affiliated with any league or team.</p>

  <h2>Where the data comes from</h2>
  <ul>
    <li><b>ESPN</b> public endpoints: schedules, scores, team and player stats, injuries, and <b>DraftKings</b> odds and player props as published by ESPN.</li>
    <li><b>Hard Rock Bet</b>, <b>FanDuel</b> and <b>DraftKings</b> odds and player props via {ext("https://the-odds-api.com/", "The Odds API")}.</li>
    <li><b>Weather</b> by {ext("https://open-meteo.com/", "Open-Meteo")}.</li>
  </ul>
  <p>Data can be delayed or wrong. Always confirm odds with the sportsbook before you bet.</p>

  <h2>How LineSmart makes money</h2>
  <p>LineSmart is free to use. It plans to earn money through affiliate links to licensed sportsbooks: if you sign up through one, LineSmart may earn a commission at no cost to you. Affiliate links are labeled and never change the odds we show. Today there are no affiliate links. See our <a href="affiliate-disclosure.html">Affiliate Disclosure</a>.</p>
  <p>We link to the official sites of Hard Rock Bet, DraftKings, FanDuel and BetMGM, and each link appears only in states where that sportsbook runs a legal online sportsbook. In Florida, that means Hard Rock Bet only. Listing a sportsbook doesn't mean we show its odds: odds comparison covers Hard Rock Bet, DraftKings and FanDuel (not BetMGM). Books that aren't legal online in your state are dimmed and never linked. Offers are state-specific, so what you see depends on your state.</p>

  <h2>Legal sportsbooks only</h2>
  <p>LineSmart only lists state-licensed, legal US sportsbooks. We never list, link to or promote offshore or unlicensed sportsbooks.</p>

  <h2>Responsible gambling</h2>
  <p><b>LineSmart is for adults 21 and older.</b> Only bet where it's legal, and only what you can afford to lose. Gambling problem? Call or text {GAMBLER_TEL}. In Florida, call or text {PLAYWISE_TEL}, or the Florida Council on Compulsive Gambling at {ADMIT_TEL}. More help and tips: <a href="responsible-gambling.html">Responsible Gambling</a>.</p>

  <h2>Contact</h2>
  <p>Questions, corrections or partnership inquiries: <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
"""

SUBSCRIBED = """  <p class="legal-lead">The LineSmart weekly email: best lines across Hard Rock Bet, DraftKings and FanDuel, hot player props and notable line moves, free every Thursday morning. For adults 21 and older.</p>
  <div id="newsPage" class="news-page" aria-live="polite"><div class="news-result"><p>Loading…</p></div></div>
  <noscript><p>Please turn on JavaScript to confirm your email, or reply to the confirmation email and we'll add you by hand.</p></noscript>
"""

UNSUBSCRIBE = f"""  <div id="newsPage" class="news-page" aria-live="polite"><div class="news-result"><p>Loading…</p></div></div>
  <noscript><p>Please turn on JavaScript to unsubscribe with one click, or email <a href="mailto:{CONTACT}?subject=unsubscribe">{CONTACT}</a> with the subject "unsubscribe" and we'll remove you by hand.</p></noscript>
  <p class="legal-date">Questions about the weekly email or your data? See the <a href="privacy.html#newsletter">Privacy Policy</a> or email <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
"""

# Weekly-email pages: (file, title, description, body, data-news-page)
NEWS_PAGES = [
    ("subscribed.html", "Weekly email", "Confirm your subscription to the free LineSmart weekly email.", SUBSCRIBED, "confirm"),
    ("unsubscribe.html", "Unsubscribe", "Unsubscribe from the LineSmart weekly email with one click.", UNSUBSCRIBE, "unsub"),
]

CONTENT = {
    "about.html": ("About LineSmart", "LineSmart is a free, independent sports odds, props, matchups and betting-tools site.", ABOUT),
    "responsible-gambling.html": ("Responsible Gambling", "Tips, limits, self-exclusion and free 24/7 helplines, including 1-800-GAMBLER and Florida resources.", RG),
    "privacy.html": ("Privacy Policy", "Cookieless analytics, approximate location for state-aware offers, data kept on your device, optional accounts for bet sync, and affiliate links.", PRIVACY),
    "terms.html": ("Terms of Use", "Terms for using LineSmart, an informational sports odds site that does not accept wagers.", TERMS),
    "affiliate-disclosure.html": ("Affiliate Disclosure", "How LineSmart handles affiliate links. Currently there are none.", AFFILIATE),
}

def main():
    check = "--check" in sys.argv
    out = {}
    for f, _ in PAGES:
        title, desc, body = CONTENT[f]
        out[SITE / f] = page(f, title, desc, body)
    for f, title, desc, body, kind in NEWS_PAGES:
        out[SITE / f] = page(f, title, desc, body, noindex=True, news_page=kind)
    idx = SITE / "index.html"
    s = idx.read_text()
    block = f"<!-- footer:start (generated by scripts/build_pages.py) -->\n{FOOTER}\n<!-- footer:end -->"
    if "<!-- footer:start" in s:
        s2 = re.sub(r"<!-- footer:start.*?<!-- footer:end -->", lambda m: block, s, flags=re.S)
    else:
        s2, n = re.subn(r'<footer class="footer">.*?</footer>', lambda m: block, s, flags=re.S)
        assert n == 1, "footer not found in index.html"
    out[idx] = s2
    stale = [p.name for p, t in out.items() if not p.exists() or p.read_text() != t]
    if check:
        print("out of date:", stale) if stale else print("pages up to date")
        sys.exit(1 if stale else 0)
    for p, t in out.items():
        p.write_text(t)
    print("wrote:", ", ".join(stale) or "(no changes)")

if __name__ == "__main__":
    main()
