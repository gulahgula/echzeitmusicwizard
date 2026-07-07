# UI/UX Audit — echtzeitmusik Browser Extension

Comprehensive audit of all user-facing surfaces. Issues categorized by severity.

---

## Severity Levels
- **P0 — Broken**: Feature doesn't work
- **P1 — Critical**: Major UX issue affecting core flow
- **P2 — Important**: Notable UX gap or inconsistency
- **P3 — Minor**: Polish item, edge case, or nice-to-have

---

## 1. Popup (480px × variable height)

### 1.1 Overview Section (top of popup)

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | P1 | Followed artists' concerts may not appear for "today" if artist name matching fails due to encoding differences | Normalize both artist name and infoText before substring comparison — strip diacritics consistently |
| 2 | P2 | Overview text has no visual separation between the summary line and the followed artists alert — both run together | Add visual divider or spacing between summary and followed section |
| 3 | P3 | "still ahead today" only shows for today filter — would be useful for next7 too | Show upcoming count for any filter |

### 1.2 Filter Bar

| # | Severity | Issue | Fix |
|---|---|---|---|
| 4 | P3 | 5 buttons in 480px is tight on smaller displays | Consider segment-control style or abbreviated labels |

### 1.3 Event Cards

| # | Severity | Issue | Fix |
|---|---|---|---|
| 5 | P2 | Description text (`event-desc`) shows raw HTML with `<br>` tags — unstyled and hard to read | Format description with proper line breaks and subtle styling |
| 6 | P2 | Artist tags and link bar are visually similar — hard to distinguish clickable areas | Use different background colors or borders to separate artist tags from action links |
| 7 | P3 | Past events at 0.3 opacity may be too faded to read | Increase to 0.4-0.45 or add a "past" label |
| 8 | P3 | No date separators between different days — when viewing "month" filter, all days blend together | Add sticky date headers between day groups |
| 9 | P2 | Auto-scroll to current event only happens for "today" filter | Enable for any filter that includes today |

### 1.4 Artist Follow UX

| # | Severity | Issue | Fix |
|---|---|---|---|
| 10 | P2 | Follow button ("+ Follow" / "✓ Following") is mixed with artist name in same tag — confusing tap target | Separate follow button into its own clickable area with clearer visual hierarchy |
| 11 | P3 | Followed artist detection relies on substring match — any name containing common words will false-positive on other events | Use word-boundary matching or exact artist name comparison |

### 1.5 Footer

| # | Severity | Issue | Fix |
|---|---|---|---|
| 12 | P3 | Single "All concerts →" link — minimal value for footer space | Consider removing or replacing with more useful action |

---

## 2. Analysis Page ("ech wizard")

### 2.1 Header

| # | Severity | Issue | Fix |
|---|---|---|---|
| 13 | P3 | Title uses CSS gradient text — may not render on older browsers | Verify `-webkit-background-clip` support |
| 14 | P3 | Version tag is hardcoded as "v1.0.1" — should read from manifest | Use `chrome.runtime.getManifest().version` |

### 2.2 Filter Bar

| # | Severity | Issue | Fix |
|---|---|---|---|
| 15 | P1 | No visual indication of which filter button is "Following" vs regular filters — all use same style | "Following" button has distinct green styling, but could be more clearly separated |
| 16 | P2 | Filter buttons are text-only — no icons for quick visual scanning | Add small icons (today: 📅, tomorrow: ➡️, following: ★) |
| 17 | P3 | 6 buttons on mobile is crowded | Responsive: wrap or scroll on narrow viewports |

### 2.3 Overview Section

| # | Severity | Issue | Fix |
|---|---|---|---|
| 18 | P2 | Overview narrative text is informative but visually flat — no visual hierarchy beyond colored numbers | Add subtle card background, larger text, or section separators |
| 19 | P3 | "Top venues" lists 3 — good balance | No change needed |
| 20 | P3 | Followed artists' concerts section is good but could show venue map links | Add map link per concert row |

### 2.4 Following Section

| # | Severity | Issue | Fix |
|---|---|---|---|
| 21 | P2 | Always visible even when scrolling through long artist lists — wastes vertical space | Make collapsible or move to dedicated tab only |
| 22 | P3 | "No upcoming concerts found" for followed artists outside current filter range | Show "Check in All view for their concerts" as hint |

### 2.5 Keywords Section

| # | Severity | Issue | Fix |
|---|---|---|---|
| 23 | P2 | Keywords show event count but not artist count — user doesn't know how many artists they'll see | Add artist count: `piano (12 events, 8 artists)` |
| 24 | P3 | No keyword search/autocomplete for keywords not in top 20 | Add search field for keywords |
| 25 | P3 | Active keyword filter visible in overview but keywords section has no indicator | Add scroll-to-top or highlight active keyword |

### 2.6 Artist List

| # | Severity | Issue | Fix |
|---|---|---|---|
| 26 | P2 | Venue preview shows only first concert — no indication if artist has multiple concerts | For multi-concert artists, show "2 more concerts" indicator |
| 27 | P3 | No visual difference between 1x and 5x artists — all look the same | Color-code count: 1x dim, 2-3x normal, 4+ highlighted |
| 28 | P3 | Long artist names may truncate without indication | Add title attribute for tooltip |
| 29 | P2 | Follow button is too small relative to card size | Increase button padding and font size |

### 2.7 Artist Detail View

| # | Severity | Issue | Fix |
|---|---|---|---|
| 30 | P2 | Back button is small and easy to miss — users may not know how to return | Make back button larger and more prominent |
| 31 | P3 | No "follow" button in detail view subtitle (only in artist list) | Add follow button in detail header |
| 32 | P3 | Event cards don't show the artist's role/instrument in that concert | Add instrument tag per event |
| 33 | P3 | No link to the original event page on echtzeitmusik.de | Add "View on echtzeitmusik.de" link |

### 2.8 Export

| # | Severity | Issue | Fix |
|---|---|---|---|
| 34 | P3 | Export downloads to default Downloads folder with verbose filename | Good as-is |
| 35 | P3 | JSON format is developer-oriented — no CSV or human-readable format | Could add CSV export option |

---

## 3. Background Notifications

| # | Severity | Issue | Fix |
|---|---|---|---|
| 36 | P1 | Notifications may all fire simultaneously if service worker was inactive for hours | Implement nearest-threshold-only logic (already done) — verify it works |
| 37 | P2 | No way to test notifications without waiting | Add "Test notification" button in Following section |
| 38 | P2 | No notification when a followed artist is added to the calendar for the first time | Could add "new event" detection by storing seen event IDs |
| 39 | P3 | Notification text is minimal — no deep link to popup or analysis page | Add click handler to open popup or analysis page |

---

## 4. Settings Page (legacy)

| # | Severity | Issue | Fix |
|---|---|---|---|
| 40 | P3 | No longer linked from popup — dead page | Remove or redirect to analysis page |

---

## 5. Cross-Component Consistency

| # | Severity | Issue | Fix |
|---|---|---|---|
| 41 | P1 | Artist extraction logic differs between popup and analysis — different noise sets, patterns, and validation | Share extraction logic or use a common module |
| 42 | P2 | Followed artist name may differ between popup and analysis (e.g., popup extracts "Lorena Izquierdo" but analysis extracts "Lorena Izquierdo:") | Normalize artist names before storing in watchedArtists |
| 43 | P2 | No shared CSS variables — each page defines its own colors | Extract CSS variables to shared file or use :root |
| 44 | P3 | Three different background colors: popup #1a1a1a, analysis #0a0a0a, settings #1a1a1a | Standardize to one dark palette |

---

## 6. Accessibility

| # | Severity | Issue | Fix |
|---|---|---|---|
| 45 | P2 | No keyboard navigation support for artist cards or keyword pills | Add tabindex and keyboard event handlers |
| 46 | P2 | No ARIA labels on interactive elements | Add aria-label attributes |
| 47 | P3 | Color contrast may not meet WCAG AA for muted text (#666 on #0a0a0a) | Check and adjust contrast ratios |
| 48 | P3 | No screen reader support for dynamic content updates | Add aria-live regions |

---

## 7. Performance

| # | Severity | Issue | Fix |
|---|---|---|---|
| 49 | P2 | Every filter change re-fetches from echtzeitmusik.de — no caching | Cache responses with TTL (e.g., 5 minutes) |
| 50 | P3 | Artist extraction runs on every page load with no memoization | Cache extraction results per event ID |
| 51 | P3 | Keyword matching iterates all artists × all events for each keyword — O(n×m×k) | Pre-build keyword→artist index |
| 52 | P3 | "Following" filter fetches "all" events — potentially large response | Could fetch "month" instead and cover most use cases |

---

## 8. Browser Compatibility

| # | Severity | Issue | Fix |
|---|---|---|---|
| 53 | P3 | Not tested in Firefox — may have API differences | Test and fix Firefox-specific issues |
| 54 | P3 | `DOMParser` not available in service worker (background.js) | Already handled with regex-based parser |
| 55 | P3 | `-webkit-background-clip` may not work in Firefox | Add `-moz-background-clip` fallback |

---

## Summary by Severity

| Severity | Count | Examples |
|---|---|---|
| P0 | 0 | — |
| P1 | 4 | #1 #15 #36 #41 |
| P2 | 14 | #5 #10 #18 #21 #23 #29 #30 #37 #38 #42 #43 #45 #46 #49 |
| P3 | 23 | Various polish items |

**Recommended priority order:**
1. Fix artist name consistency between popup and analysis (#41, #42)
2. Fix followed artist detection in popup (#1)
3. Add response caching (#49)
4. Improve artist follow UX (#10, #29)
5. Add keyboard accessibility (#45, #46)
6. Polish visual hierarchy (#18, #21, #27)
7. Add notification testing (#37)
8. Cleanup legacy settings page (#40)