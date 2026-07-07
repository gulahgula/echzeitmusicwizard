# echtzeitmusik Berlin

A browser extension for exploring Berlin's experimental music scene through [echtzeitmusik.de](https://echtzeitmusik.de).

Browse concerts, discover artists and their instruments, follow musicians, and receive notifications when they perform.

## Features

- **Concert browser** — compact popup with Today / Tomorrow / Next 7 / Month / All views
- **Artist discovery** — automatic extraction of performers and instruments from event descriptions
- **Following** — save artists to track their upcoming shows
- **Notifications** — badge counter and toast alerts when followed artists are playing
- **Calendar view** — monthly calendar of followed artists' events
- **ICS export** — export individual events to your calendar app

## Installation

Install from the [Chrome Web Store](https://chromewebstore.google.com) (search "echtzeitmusik Berlin").

### Manual

```bash
git clone https://github.com/gulahgula/echzeitmusicwizard.git
```

Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the `echtzeitmusik-extension/` folder.

## Privacy

This extension stores your followed artists and notification state locally in `chrome.storage.local`. It fetches concert data from echtzeitmusik.de — the same data visible on the public website. No data is transmitted anywhere else. The content script runs on all URLs solely to display toast notifications on any page; no data is collected.

See [PRIVACY.md](echtzeitmusik-extension/PRIVACY.md) for the full privacy policy.
