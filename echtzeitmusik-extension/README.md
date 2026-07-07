# echtzeitmusik Berlin — Browser Extension

A Chrome/Firefox extension for the Berlin experimental music calendar at [echtzeitmusik.de](https://echtzeitmusik.de). Shows today's concerts, analyzes artists and instruments across the month, and sends push notifications for followed artists.

---

## Quick Start

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select the `echtzeitmusik-extension/` folder
4. Click the extension icon to see today's concerts

---

## Architecture

```
echtzeitmusik-extension/
├── manifest.json          # MV3 manifest
├── background.js          # Service worker — hourly checks, 1d/5h/3h/1h notifications
├── popup/
│   ├── popup.html         # 480px popup UI
│   ├── popup.css          # Dark theme styling
│   └── popup.js           # Event listing, artist extraction, follow toggle, ICS export
├── analysis/
│   ├── analysis.html      # Full-page analysis ("ech wizard")
│   ├── analysis.css       # Dark theme, card-based layout
│   └── analysis.js        # Artist extraction, keyword analysis, export
├── settings/
│   ├── settings.html       # Following management page (legacy, now in wizard)
│   ├── settings.css
│   └── settings.js
└── icons/                  # 16/48/128px placeholder icons
```

### Manifest

| Field | Value |
|---|---|
| Version | 1.0.1 |
| Manifest | V3 |
| Permissions | `storage`, `notifications`, `alarms` |
| Host permissions | `https://echtzeitmusik.de/*` |
| Background | Service worker (`background.js`) |
| Action | Popup (`popup/popup.html`) |

---

## Components

### 1. Popup (popup/)

The primary user interaction surface. Opens when clicking the extension icon.

**Features:**
- **Overview text** at the top: "Today: 10 concerts at 8 venues · 6 still ahead today. Top: Sowieso (2)..."
- **Followed artist alerts** in green below the overview
- **Filter bar**: Today / Tomorrow / 7 days / Month / All
- **Event cards** showing: time, venue, address, original description, extracted artist names with follow buttons, links (Website, Map, Calendar)
- **Time-aware today view**: past events dimmed (opacity 0.3), auto-scroll to current/upcoming event
- **Follow toggle**: "+ Follow" / "✓ Following" per artist, with green left border on events with followed artists
- **ICS calendar export**: downloads `.ics` file for each event with DTSTART/DTEND
- **⚡ wizard button**: opens analysis page at today's view (`#today` hash)

**Data flow:**
1. Fetches `https://echtzeitmusik.de/index.php?page=calendar&filter=${filter}`
2. Decodes ISO-8859-1 → normalizes curly quotes → parses HTML with DOMParser
3. Extracts events from table structure (anchor-based parsing)
4. Extracts artist names from event descriptions (pattern matching)
5. Renders events with artist tags and follow buttons

**Artist extraction (popup-level):**
- Patterns: `Name - instrument`, `Name (instrument)`, `Name : instrument`, `Name & Name`, `Name | instrument`
- Band suffix stripping: `Trio`, `Duo`, `Quartet`, etc.
- Curly quote normalization: `'` → `'`, `"` → `"`
- Noise word filtering (instruments, descriptors, German words)

### 2. Analysis Page / "ech wizard" (analysis/)

Full-page tab opened via the ⚡ wizard button. Provides deep analysis of the calendar.

**Features:**
- **Narrative overview**: "This month: 85 concerts across 42 venues, featuring 211 artists over 21 days. Top venues: ..."
- **Followed artists' upcoming concerts** shown in overview with artist, date, time, venue
- **Following section**: always visible, shows all followed artists with next concert info and unfollow button
- **Following filter button**: dedicated tab that shows only events containing followed artists
- **Keywords section**: clickable pills showing instruments/genres with event counts — only shows keywords with matching artists
- **Keyword filtering**: click a keyword to filter the artist list by line-level instrument matching (`Name - sax` matches "sax")
- **Artist cards**: card-based layout with rank, name, venue preview, concert count, follow button
- **Artist detail view**: click any artist to see all their concerts with date, time, venue, map, calendar export
- **Export Data button**: downloads JSON with all events, structured lines, detected artists, keywords

**Keyword matching:**
- `GENERIC_KWS` (trio, experimental, jazz, etc.): broad match — any artist in an event mentioning the keyword
- Instrument keywords: line-level structural match — `Name - instrument` pattern on same line
- Word-boundary regex matching to prevent false positives (`harp` ≠ `sharp`)

**Filter tabs:** Today / Tomorrow / Next 7 days / This month / All / Following

**Artist extraction (analysis-level):**
- All popup patterns plus: colon fallback (`Section: Artist`), pipe-separated lists, plus-separated lists, parens extraction, "by Name" / "with Name"
- `Featuring:` sections: accept all non-URL lines ≥2 chars
- Comprehensive `isNoiseWord` set with accent normalization (ö→o, ü→u, ä→a, etc.)
- `looksLikePersonName` validation: uppercase start, 2+ capitalized words, connector words (de/van/von/der), rejects structural separators mid-name, rejects ≥3 dots (abbreviations)
- Band suffix stripping before validation
- Final filter: removes empty strings and URLs only (not lowercase names)

### 3. Background Service Worker (background.js)

Hourly calendar checker for notification system.

**Features:**
- `chrome.alarms` with 60-minute period
- Checks on install (5s delay) and browser startup
- Fetches monthly calendar, parses HTML without DOMParser (regex-based)
- For each followed artist, finds matching events via `infoText.includes()`
- Calculates time until event, sends notifications at 1 day / 5h / 3h / 1h before
- Only fires the closest (shortest) threshold per check — no duplicate notifications
- Tracks notified thresholds in `chrome.storage.local`
- Curly quote normalization for matching

**Notification format:**
```
🎵 Lorena Izquierdo — coming up
Saturday 04.07.26 · 20.00 at Sowieso (in 5 hours)
```

### 4. Settings Page (settings/)

Legacy page for managing followed artists. Now integrated into the wizard's "Following" section.

**Still functional but not linked from popup.** The wizard's Following tab provides the same functionality.

---

## Data Sources

### Website
- URL: `https://echtzeitmusik.de/index.php?page=calendar&filter=${filter}`
- Encoding: ISO-8859-1 (decoded with `TextDecoder('iso-8859-1')`)
- Structure: HTML 4.01 table-based layout
- Event markers: `<!-- ENTRY: #XXXXX DD.MM.YYYY -->`
- CSS classes: `.calender-entry-address`, `.tagUhrzeit`, `.name-box`, `.calender-entry-info`
- Icons: Material Icons (info, web_asset, place)

### Filters
| Filter | URL param | Description |
|---|---|---|
| `today` | `filter=today` | Today's concerts only |
| `tomorrow` | `filter=tomorrow` | Tomorrow's concerts only |
| `next7` | `filter=next7` | Next 7 days |
| `month` | `filter=month` | Current month |
| `all` | `filter=all` | All available events |
| `following` | (custom) | Filters "all" events to followed artists |

### Storage Schema (`chrome.storage.local`)

| Key | Type | Description |
|---|---|---|
| `watchedArtists` | `string[]` | Array of followed artist names |
| `notifiedThresholds` | `object` | `{ "Artist\|eventId": { "1d": true, "5h": true, ... } }` |
| `lastCheck` | `string` | ISO timestamp of last background check |

---

## Technical Details

### Encoding Pipeline
1. `fetch()` → `arrayBuffer()` → `TextDecoder('iso-8859-1')` → HTML string
2. **Curly quote normalization**: `'` `'` `‚` `‛` `′` `‵` → `'` and `"` `"` `„` `‟` `″` `‶` → `"`
3. `DOMParser().parseFromString(html, 'text/html')` → DOM
4. `textContent` / `innerHTML` extraction from parsed DOM
5. `trail()` for whitespace cleanup

### Artist Extraction Patterns
| Pattern | Example | Matches |
|---|---|---|
| `Name - X` | `Simon Rose - baritone saxophone` | Simon Rose |
| `Name (X)` | `Aki Takase (piano)` | Aki Takase |
| `Name > X` | `Stephen Grew > piano` | Stephen Grew |
| `Name: X` | `Kaja Draksler: piano` | Kaja Draksler |
| `Name, X` | `Heather O'Donnell, Klavier / Piano` | Heather O'Donnell |
| `Name & Name` | `Miako Klein & Jia Lim` | Miako Klein, Jia Lim |
| `Name \| X` | `Tilman Kanitz \| Cello` | Tilman Kanitz |
| `Featuring:` section | Bare names after "Featuring:" | All listed artists |
| `by Name` / `with Name` | `by Udo Koloska` | Udo Koloska |
| Parens inner names | `Project VO (Antti & Rieko)` | Antti, Rieko |
| Colon fallback | `Sound Art: Anouk Kellner` | Anouk Kellner |
| Plus/pipe lists | `Rieko Okuda + Claudia Schmitz` | Both names |
| Band suffix strip | `Amoy Ribas Trio` → `Amoy Ribas` | Amoy Ribas |

### Noise Word Filtering
Comprehensive `isNoiseWord` set with accent normalization:
- 80+ instruments (English + German): piano, klavier, schlagzeug, blockflöte, etc.
- 60+ descriptive words: improvised, experimental, concert, performance, etc.
- 30+ logistical words: doors, admission, donation, ticket, newsletter, etc.
- 20+ German descriptive words: eintritt, kostenlos, veranstaltung, etc.
- Event title words: walden, festival, series, edition, biennial, etc.

### Keyword Set
120+ instrument/genre/role keywords:
- Core instruments: piano, guitar, bass, drums, sax, trumpet, violin, cello, etc.
- German instruments: gitarre, klavier, schlagzeug, saxophon, trompete, etc.
- Extended techniques: prepared piano, inside piano, feedbacker, ebow, objects
- Roles: solo, duo, trio, quartet, conduction, movement, spoken word
- Genres: free improvisation, new music, electroacoustic, soundscape, ambient, drone
- Data-specific: bartender, radio, antennas, ceramic flutes, waterbowls

### Generic Keywords (broad matching)
Treated differently — match if keyword appears anywhere in the event:
```
solo, duo, trio, quartet, experimental, live, electronic, ambient, drone, noise,
jazz, free jazz, free improvisation, folk, classical, contemporary,
electroacoustic, soundscape, new music, minimalism, improvisation,
composition, performance, sound art, installation, video, dance, butoh,
poetry, spoken word
```

---

## UI/UX Audit

### Popup (480px wide)

#### Overview Section
- **Status**: Narrative text with highlighted stats (amber) and venue names (blue)
- **Followed artists**: Green text showing artist + time + venue for concerts in current filter
- **Issue**: Followed artist detection uses substring match on raw infoText, which may miss names with encoding issues

#### Event Cards
- **Status**: Each card shows time (amber), venue, address, raw description, artist tags, action links
- **Past events**: Dimmed to 0.3 opacity (today view only)
- **Followed artist events**: Green left border (3px)
- **Artist tags**: Compact pills with name + follow button
- **Links**: Website, Map, Calendar (ICS export)

#### Filter Bar
- 5 buttons: today / tomorrow / 7 days / month / all
- Active filter highlighted with amber background

#### Footer
- Single link to echtzeitmusik.de calendar

### Analysis Page ("ech wizard")

#### Header
- Title with gradient text animation
- Version tag in monospace
- 6 filter buttons: Today, Tomorrow, Next 7 days, This month, All, Following

#### Overview Section
- Narrative text: "This month: 85 concerts across 42 venues, featuring 211 artists..."
- Top venues and top artists as clickable links
- Followed artists' upcoming concerts in green with date/time/venue
- Keyword filter indicator with clear button

#### Following Section
- Always visible when followed artists exist
- Shows followed artist name + next concert info + unfollow button
- Empty state: "No artists followed yet"

#### Keywords Section
- Rounded pills with event count badge
- Only shows keywords with at least one matching artist
- Active keyword highlighted in amber
- Hover effect with amber border

#### Artist List
- Card-based layout (not table)
- Rank number, artist name, venue preview (first concert), concert count, follow button
- Follow button: blue border → green border when following
- Clickable cards open artist detail view

#### Artist Detail View
- Large artist name (24px, white, bold)
- Subtitle with concert count and venue count
- Follow button in subtitle
- Event cards with amber left border, date/time/venue/address, action buttons (Map, Calendar)

#### Footer
- Export Data button + source link

### Settings Page (legacy)
- Not linked from popup
- Still functional for backward compat
- Wizard's Following tab now provides same functionality

---

## Known Limitations

1. **Encoding**: ISO-8859-1 decoding mangles some UTF-8 characters. Curly quote normalization helps but some edge cases remain.
2. **Artist extraction**: Not 100% accurate — some lowercase names may slip through, some valid names may be rejected by noise filters.
3. **Keyword matching**: Line-level matching for instruments requires structural patterns (`Name - instrument`). Free-text descriptions won't match.
4. **Notification timing**: Background service worker may be terminated between hourly checks, potentially missing threshold notifications.
5. **Rate limiting**: No rate limiting on calendar fetches. Background worker fetches once per hour.
6. **Icons**: Placeholder PNG icons (solid color squares), not branded.
7. **Caching**: No response caching — every filter change re-fetches from echtzeitmusik.de.

---

## Development

### File Sizes
| File | Lines | Description |
|---|---|---|
| `analysis/analysis.js` | ~1196 | Artist extraction, keyword analysis, rendering |
| `popup/popup.js` | ~449 | Event listing, artist extraction, follow, ICS |
| `analysis/analysis.css` | ~500 | Dark theme styling |
| `background.js` | ~159 | Notification service worker |
| `popup/popup.css` | ~258 | Popup styling |
| `settings/settings.js` | ~78 | Following management (legacy) |

### Dependencies
- **No external libraries** — vanilla JavaScript only
- **Browser APIs**: `chrome.storage.local`, `chrome.notifications`, `chrome.alarms`, `chrome.tabs`, `chrome.runtime`
- **Web APIs**: `fetch`, `TextDecoder`, `DOMParser`, `URL.createObjectURL`, `Blob`

### Testing
No test suite exists. Manual testing workflow:
1. Reload extension in `chrome://extensions`
2. Click extension icon → check popup
3. Click ⚡ wizard → check analysis page
4. Follow an artist → check Following section
5. Export data → verify JSON output

---

## Future Improvements

1. **Branded icons** — replace placeholder PNGs with proper echtzeitmusik branding
2. **Response caching** — cache calendar responses to avoid refetching on every filter change
3. **Rate limiting** — throttle requests to echtzeitmusik.de
4. **Artist name normalization** — normalize names across popup and analysis (same name = same identity)
5. **Duplicate artist detection** — merge similar names (e.g., "Lorena Izquierdo" and "Lorena Izquierdo:")
6. **Multi-event calendar export** — export all concerts as a single ICS file
7. **Keyword search** — allow users to search for custom keywords (not just predefined set)
8. **Venue filtering** — filter artists by venue
9. **Timeline view** — visualize concert timeline by date
10. **Firefox compatibility** — test and fix any Firefox-specific issues