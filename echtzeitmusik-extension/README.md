# echtzeitmusik Berlin — Browser Extension

Explore Berlin's experimental music calendar from [echtzeitmusik.de](https://echtzeitmusik.de). Browse concerts by date, discover artists and instruments, follow your favourite musicians, and get notified before they play.

## Features

- **Concert browser** — view today's, tomorrow's, or this month's concerts in a compact popup
- **Artist discovery** — extract artist names from event descriptions with instrument/role tags
- **Artist following** — follow musicians to track their upcoming shows
- **Notifications** — get a badge count and toast alerts when followed artists are playing soon
- **Calendar view** — see followed artists' events on a monthly calendar
- **ICS export** — export individual events to your calendar

## How To Use

See [HOWTO.md](./HOWTO.md) for a full walkthrough of the popup, analysis page, notifications, and tips.

## Install (Developer Mode)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `echtzeitmusik-extension/` folder
4. Click the extension icon to browse concerts

## Privacy

This extension stores the list of artists you follow (and dismissed/seen notification IDs) in `chrome.storage.local`. No data is sent to any server. See [PRIVACY.md](./PRIVACY.md) for details.
