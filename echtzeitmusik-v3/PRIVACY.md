# Privacy Policy

## Data Collection

The echtzeitmusik Berlin browser extension does not collect, transmit, or share any personal data.

## Data Storage

All data is stored locally on your device using the `chrome.storage.local` API and a local IndexedDB database (`echzeit-catalogue`):

| Data | Purpose |
|------|---------|
| `watchedArtists` | Artists you choose to follow |
| `unreadNotifications` | Notification queue for followed artist events |
| `dismissedNotifIds` | IDs of notifications you have dismissed |
| `notifiedThresholds` | Which lead-time reminders (1d/5h/3h/1h) have already fired |
| `knownEvents` / `firedCancellations` | State used to detect and de-duplicate cancelled shows |
| `echzeit-catalogue` (IndexedDB) | The artist catalogue you build locally from the calendar |

## Network Access

The extension makes only one kind of outbound request, to fetch public data — never to send yours:

1. The public concert calendar from `https://echtzeitmusik.de`.

All artist, instrument, and genre data is derived locally from that calendar. The extension does not read the content of, or interact with, any other web pages you visit.

## On-page banners

Immediately after you interact with the extension popup (for example following an artist), the extension may briefly display a small confirmation banner on the tab you are currently viewing. This uses Chrome's temporary `activeTab` permission and only writes the banner — it never reads the page's content.

## Notifications

With your notification setting enabled, the extension informs you about upcoming concerts of artists you follow via the browser's native notification system. All notification content is generated locally from the public calendar data — no data is sent to any server.

## Third Parties

No third-party services, analytics, tracking, or advertising are used.

## Updates

This privacy policy may be updated occasionally. Continued use of the extension constitutes acceptance of any changes.
