# Privacy Policy

## Data Collection

The echtzeitmusik Berlin browser extension does not collect, transmit, or share any personal data.

## Data Storage

All data is stored locally on your device using the `chrome.storage.local` API:

| Data | Purpose |
|------|---------|
| `watchedArtists` | Artists you choose to follow |
| `unreadNotifications` | Notification queue for followed artist events |
| `dismissedNotifIds` | IDs of notifications you have dismissed |
| `shownToastIds` | IDs of toast notifications already displayed |

## Network Access

The extension fetches the public concert calendar from `https://echtzeitmusik.de/index.php?page=calendar`. No other network requests are made. The content script operates on all URLs (`<all_urls>`) solely to render toast notifications; no page data is read or transmitted.

## Third Parties

No third-party services, analytics, tracking, or advertising are used.

## Updates

This privacy policy may be updated occasionally. Continued use of the extension constitutes acceptance of any changes.
