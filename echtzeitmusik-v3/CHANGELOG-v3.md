# echtzeitmusik v3.0.0

## Reminder notifications fixed (July 2026, round 7)

The 1-day / 5-hour / 3-hour / 1-hour reminders never popped up. Three bugs in
`background.js` `checkThresholds()`:

- **Reminders were silently swallowed.** It re-alerted via
  `chrome.notifications.update()`, which rewrites an existing notification
  *without* showing anything — and `persistNotification()` had already created a
  notification under the same id, so every reminder just quietly edited that old
  one. Now it `clear()`s then `create()`s, forcing a real alert.
- **Stale wide bands fired late with wrong labels.** Only the matched band was
  marked done, so a band never crossed live (following an artist 2 h before the
  show never crosses "1 day") fired on a later tick as a bogus "starts in 1 day"
  — sometimes with the label going *backwards* between checks. Now every entered
  band is marked done, and the message reports the real remaining time
  (`formatLead`) instead of the band name, since checks run on an interval.
- **Dismissing a notification cancelled all its future reminders.** Clicking a
  notification adds its id to `dismissedNotifIds`, and `checkThresholds` bailed
  on that set — so one click killed every later reminder for that show. Dismiss
  now means "clear from the unread list" only; the time-based reminders still
  fire (turn notifications off to silence everything).

## Pre-submission review — security & correctness (July 2026, round 6)

Full audit across every feature before Chrome Web Store upload.

**Store blocker fixed:** `manifest.description` was 160 chars (max is 132) —
would have been rejected at upload. Rewritten to 132.

**Security hardening:**
- `escapeHtml()` escaped only `& < >`, never quotes — so every
  `attr="${escapeHtml(value)}"` sink (data-artist, title, href, …) could be
  broken out of by a site-derived name/URL containing `"`, injecting attributes
  into the extension origin (access to storage/IndexedDB/chrome APIs). Rewrote
  it to escape all five characters as a pure string op — hardening every call
  site at once — and to work in the service-worker scope, where the old
  `document`-based version silently returned input **unescaped**.
- One venue-link `href` in the Archive concert history was interpolated without
  escaping (its sibling "Venue Info" link was already escaped); now consistent.
- Added `rel="noopener"` to all `target="_blank"` links (static HTML + JS-built
  venue/map/detail links) — reverse-tabnabbing defense.
- Audited the programme-note renderer (`renderSanitizedHtml`): confirmed proper
  allowlist sanitation (inert parse, allowlisted tags only, no attributes copied
  except `^https?://`-validated `href`, all handlers stripped). `normalizeUrl`
  confirmed to neutralize `javascript:`/`data:` URLs.

**Permissions audit:** all five (`storage`, `alarms`, `activeTab`, `scripting`,
`notifications`) are used; `activeTab`+`scripting` pair to inject the
follow-confirmation toast into the current tab. No unused permissions. Only
host permission is `https://echtzeitmusik.de/*`; confirmed every `fetch()`
targets it.

**Dead-code removal (from the GitHub-feature deletion):** removed the orphaned
`fetchCatalogueFromGitHub`/`purgeNonArtists` handlers, the entire unreachable
GitHub-sync cluster in `catalogue-db.js` (`fetchFromGitHub`, `mergeRemoteIntoLocal`
and merge helpers, `exportChanges` — 164 lines, plus an external
`gulahgula.github.io` fetch), the leftover **"Data notes"** footer link (pointed
at the deleted `data-analysis/` page — a dead tab), the vestigial sync-banner
element, and stale "community database" empty-state copy.

**Privacy policy corrected:** removed the disclosure of the GitHub Pages endpoint
(now gone); network access is stated as echtzeitmusik.de only, matching actual
behavior.

**Verified:** all JS `node --check`; service-worker load chain (no collisions);
extraction benchmark unchanged (artists F1 87.3 / instruments 84.1 / genres 69.8);
every HTML asset reference resolves; no dangling references to any removed feature.

---

## Chrome Store submission prep (July 2026, round 5)

**Lightweight cleanup for store release:**
- Removed **Fetch from GitHub** and **Purge Non-Artists** buttons from the Archive
- Removed **Community data sync banner** (GitHub link)
- Deleted **Data Quality page** (`data-analysis` folder) — development-only report with detailed
  measurements and quality notes not needed in the shipped extension
- **Package size: 318 KB** (down from 373 KB), **26 files** (down from 30)

The extension is now streamlined for end users: all runtime features intact, no development
cruft or external-sync UI.

---

## Analysis page icon styles unified (July 2026, round 4b)

**Icons now use CSS masks on the Analysis page** (matching the popup). The old approach
used hardcoded SVG fill colors in data URIs, which couldn't respond to theme changes or
inherit hover colors. Updated `.artist-listen`, `.artist-about`, and `.artist-platform`
to use `background-color: currentColor` with `-webkit-mask` and `mask` — so icons
inherit the element's `color` property and animate on hover, just like in the popup.

---

## Follow-state corruption & data-analysis crash fix (July 2026, round 4)

**Followed artists were disappearing.** Two follow entry points wrote to
`watchedArtists` (the `chrome.storage.local` array every page reads) in
incompatible ways:
- Popup and the "top artist" card wrote the correctly-cased display name.
- The **Archive** follow toggle instead *rebuilt the entire array* from
  `catalogueArtists.filter(a => a.followed)` — and catalogue records only get
  `followed = true` when toggled from the Archive itself. Following someone
  from the popup never touched that flag, so the next Archive follow silently
  dropped them from `watchedArtists` (Bug A: data loss).
- The Archive toggle also pushed `artist.normalizedKey` — the catalogue's
  **lowercased** IndexedDB key — instead of the display name (Bug B: case
  corruption, e.g. "Antonio Borghini" → "antonio borghini"). Several places
  do exact-case lookups (`artistMap[name]`, `watchedArtists.includes(...)`),
  so a lowercased entry silently lost its "Following" state and showed *No
  upcoming concerts found* even with concerts on the calendar.

Fixed: the Archive toggle now adds/removes the one artist from
`watchedArtists` the same way popup does (display-cased, single-artist
mutation, never a full rebuild), and additionally mirrors the change into
`CatalogueDB.setFollowed()` so the Archive's own checkmark stays in sync. On
Archive load, each row's checkmark is now overlaid from `watchedArtists`
(the real source of truth) rather than trusted from the possibly-stale
catalogue flag. A one-time repair pass in both `popup.js` and `analysis.js`
recovers proper casing for any already-corrupted entries left over from the
bug, by looking each lowercase entry up in the catalogue.

**Data Quality page crash fixed.** `renderDataGaps()` in
`data-analysis/analysis.js` referenced an undefined `el` (missing the
`document.getElementById('data-gaps')` line every sibling render function
has), throwing `ReferenceError: el is not defined` and aborting the whole
render pass. Added the missing line.

---

## Left-column links & set-scoped collaborators (July 2026, round 3)

**Links moved to the left column.** Info / Website / Map / 📅 Calendar / ⤓ Card
now stack under the venue and address — the right column is purely programme
note + artists. The image-download button is renamed **⤓ Card**.

**Collaborator threshold 3 → 2, set-scoped.** A collaborator now surfaces once
a pair has shared a performance SET in 2+ different events. Collection was
already per-set (performance blocks split on "Set N" markers) and same-event
repeats dedup to one count, so the counting model matches: pairs accumulate
across events, one count per event, only same-set pairings qualify.

---


## Popup order, keyword filtering & series-title fixes (July 2026, round 2)

**Popup card order.** The right column now reads: programme note first, then the
identified artists with their links at the bottom. The *more/less* toggle is
gone — the note is always fully visible. Artists render as aligned full-width
rows (name · platform icons · follow) under a divider instead of ragged pills.

**Series titles are no longer artists.** Two structural fixes:
- *Declared non-acts*: when the event text itself says "X is a … series /
  festival / venue / platform", X is blocked for that event ("Frictive
  Frequencies is a mini series…" — the text tells us).
- The `featuring:` prose cue was case-sensitive and missed sentence-initial
  "Featuring …" — fixed per-word (a global `/i` would case-fold `\p{Lu}` and
  wreck the capitalization test). This recovered artists on events that
  previously returned nothing (e.g. "Featuring Lương Huệ Trinh…").
- "FUTURE NOW Musical Diaries" was already rejected by the current engine —
  sightings are stale IndexedDB entries; `looksLikeNonArtist` now also matches
  series-title tails (frequencies, diaries, sessions…) so **Purge Non-Artists**
  cleans them.
- Artist precision on the gold corpus: **94.2** (F1 87.3).

**Instruments & genres pills fixed.** Pills and pill-click filtering now share
one definition (`artistKeywords`): an artist's credited instruments +
`extractGenres(text, artist)`. Both sides derive from artist detail, so a pill
can never return an empty artist list (verified across the corpus: 467 pills,
0 empty). Previously pills were built from event-level text while filtering
demanded artist-level evidence — "sound installation" showed a count but
matched nobody.

---

## UX & data round (July 2026)

**Popup redesign — two-column cards.** Each event is now a grid: **when/where on
the left** (time, day, venue, address, free-entry marker) with a divider, and the
**programme on the right** (artists, note, links). Tighter spacing and a
programme note clamped to two lines (with a *more/less* toggle) so a full event
reads at a glance without scrolling.

**Free-entry marker.** Events whose text contains "Eintritt frei", "freier
Eintritt", "free entry", "free admission", "kostenloser Eintritt" etc. get a
green *Free entry* badge. `detectFreeEntry()` deliberately ignores priced lines
("Eintritt: 10€") and the genre phrase "free improvisation".

**Collaborators from the archive, not the feed.** Collaborators are now computed
from every stored event in the catalogue and only surface once a pair has shared
**3+ events** (`COLLAB_MIN_SHARED`) — a bond that emerges as the archive
accumulates, filtering out one-off shared bills and extraction noise. New
`CatalogueDB.getCollaborators()` / `filterCollaborators()`. Labelled "Frequent
collaborators".

**Archive keeps full history; past shows greyed.** The catalogue artist detail
lists upcoming shows first (as-is) then recent past shows greyed out, with a
"+N earlier shows" line — nothing is dropped as the live calendar rolls forward.

**Extraction fixes** (reported false positives):
- "flea market table", "Community Canvas" and similar programme-item lines no
  longer become artists — act-headers must be name-shaped, and inline
  "Name (…)" credits must sit at a line/segment boundary.
- Two `TextDecoder` sites in the analysis page were missing the
  windows-1252 + `fixMojibake` repair; fixed.
- Artist precision on the gold corpus rose to **93.7** (F1 87).

**Icons.** Bandcamp / SoundCloud / YouTube and the search action are redrawn as
CSS-masked glyphs so they inherit colour correctly (they previously rendered
black regardless of theme, because an SVG in `background-image` can't read
`currentColor`).

**About.** Added a "What is Echtzeitmusik?" section with the scene's own mid-1990s
self-definition, explaining why the tool treats Free Jazz / New Music / Noise as
broad reference points rather than strict genres.

---


## Structure-first extraction engine (July 2026)

The artist/instrument/genre extractor was rewritten from scratch, driven by a
gold-labeled benchmark of 118 real calendar events (multi-agent labeling +
pattern mining over the live `filter=all` dataset).

**Measured against the gold corpus:**

| Metric | Old parser | New engine |
|---|---|---|
| Artists F1 | 69.5 | **85.7** (P 90.3 / R 81.6) |
| Instruments F1 | 54.1 | **83.9** (P 94.9) |
| Genres F1 | 64.3 | **69.8** |

**Design change — positive evidence instead of blocklists.** The old pipeline
extracted every capitalized phrase from prose and then filtered it through
hand-enumerated lists of cities, universities, countries and Berlin districts
(642-entry `NON_ARTIST_NAMES` + 318-entry `COMMON_GERMAN_NOUNS`). That is
unwinnable by construction — the corpus still cataloged "Hildesheim University"
and "Europe" as artists. The new engine (`shared/extractor.js`) only accepts
names with structural evidence:

- **Credit lines** — `Name – instrument`, `Name: instr`, `Name (instr, instr)`,
  `Name [instr]`, `role: Name`; the credit slot must parse as
  instruments/roles/genres (this is what makes a city unable to occupy an
  accepting position).
- **Prose cues** — "percussionist Joss Turnbull", "musician Görkem Şen",
  "we present X and Y", paragraph-lead bios ("Name is a …").
- **Corroborated headlines/rosters** — first lines, slash rosters
  (`BLAKE / BEYER / KOOLE`), act headers above lineups, surname
  cross-referencing (COUDOUX & ROTH ↔ credit-line full names), smashed-surname
  project aliases (SALVOJOWETTBANNERBRYANT).

The geography dictionaries are **deleted**. Catalogue purge features now use a
compact pattern detector (`looksLikeNonArtist`) instead of world enumeration.
Per-artist instruments carry through credit slots (positional assignment for
"A and B (Objects, Electronics)" duo lines), and confidence scores + sources
are attached to every extracted artist.

**Encoding fix (root-cause find).** The site serves `charset=iso-8859-1` but
its bytes are Windows-1252, with some entries double-encoded UTF-8. Strict
Latin-1 decoding turns 0x96 — the en-dash used in ~200 credit lines — into an
invisible control character, silently destroying the "Name – instrument"
structure, and garbles diacritics ("Görkem ŞenÂ´s"). All fetch paths now decode
`windows-1252` and run `fixMojibake()` (a general UTF-8-as-cp1252 repair) over
the result. This alone recovered a large share of the recall gain.

Old call sites (`extractPerformanceBlocks`, `catExtractInstruments`,
`extractGenres`) keep their signatures as thin adapters over the engine, so
popup, analysis, data-analysis and the background catalogue collector all
benefit without further changes.


A consolidation release: the feature set from the 2.2 development build, plus the
regressions restored from the shipped 2.1, plus architectural and correctness
fixes. Manifest version bumped to **3.0.0**.

## Architecture

- **New dictionary library — `shared/dictionaries.js`.** Every curated word list
  (connectors, noise words, common-noun blocklist, genres, instruments, extra
  keywords, non-artist names, instrument abbreviations, venue words) moved out of
  `parser.js` into one deduplicated, sectioned, commented module. Data now lives
  apart from logic and there is a single source of truth.
  - Removed in-list duplicates (`athina`×3, `jubiläum`×2, `performance`×2, …).
  - Collapsed **three** copies of the instrument-abbreviation table (parser.js,
    catalogue-db.js, plus an inline one) down to one shared `INSTRUMENT_ABBREV`.
  - Added a shared `foldDiacritics()` helper (umlauts, Turkish ı, ø/æ/œ, ß→ss),
    replacing per-function ad-hoc accent stripping.
- `parser.js` is now logic-only and consumes the library; loaded after it in the
  popup, analysis page, data-analysis page, and the service worker.

## Store-readiness / permissions

- **Dropped three unnecessary host permissions** (`gulahgula.github.io`,
  `bandcamp.com`, `*.bandcamp.com`). GitHub Pages data is fetched via CORS with no
  host permission, and Bandcamp is only ever opened as an outbound link. This
  removes a broad "read your data on these sites" warning at install.
- No content scripts; on-page confirmation banners use `activeTab` + `scripting`
  only after a user interaction.
- Privacy policy updated: documents the catalogue IndexedDB store, the read-only
  GitHub Pages fetch, the `activeTab` banner behaviour, and native notifications.

## Regressions restored from 2.1

- Manual follows no longer triple-notify: the popup shows its own confirmation,
  the broadcast toast is suppressed for 15 s (`justFollowed`), and the background
  stays **silent** on the immediate follow — timely reminders are left to the
  lead-time thresholds.
- Transient reminder state (`notifiedThresholds`, `firedCancellations`) is cleared
  on install/update so upgrades don't carry stale state.

## Correctness fixes

- **In-flight guard** around the calendar check: `onStartup`, `onInstalled`,
  `onAlarm` and `storage.onChanged` now collapse onto one shared promise instead
  of racing concurrent fetches and catalogue writes.
- **Catalogue collection throttled** to once per 24 h (was every hourly tick),
  cutting needless IndexedDB churn in the service worker.
- **Cancellation notifications de-duplicated** via a capped `firedCancellations`
  ledger — overlapping runs can't double-announce a cancelled show.
- **Unbounded-growth caps** on `dismissedNotifIds` (FIFO 200) and
  `firedCancellations` (FIFO 100).

## Verification

- All JS files pass `node --check`.
- Service-worker load order simulated (dictionaries → parser → catalogue) with no
  redeclaration collisions.
- Parser behaviour smoke-tested after the refactor (noise/person detection,
  word-boundary artist match, abbreviation expansion, venue spacing, genre
  extraction, diacritic folding) — all green.
