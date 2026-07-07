# How To Use echtzeitmusik Berlin

> First time? See [INSTALL.md](./INSTALL.md) to install the extension.

## Popup — Browse Concerts

Click the extension icon (![icon](icons/icon16.png)) to open the popup.

- **Filter bar** at the top: Today / Tomorrow / Next 7 / Month / All
- **Overview text** summarises the current selection (concert/venue counts, top venues)
- **Event cards** show time, venue, address, description, and artist tags
- **Past events** (today view) are dimmed; the page auto-scrolls to the next upcoming event
- **Green left border** on events that feature artists you follow
- **Green bar** on events starting within 30 minutes

### Action links on each card
- **Website** — open the event's page on echtzeitmusik.de
- **Map** — open the venue in Google Maps
- **Calendar** — download an `.ics` file to import into your calendar app

### Following artists
Click **+ Follow** on any artist tag. The button turns green and the artist is saved. Events by followed artists get a green left border.

### ⚡ Ech Wizard
Opens the full analysis page in a new tab.

## Analysis Page ("Ech Wizard")

Full-page dashboard for deep calendar analysis.

### Tabs
Today / Tomorrow / Next 7 days / This month / All / Following

The **Following** tab shows only events that feature artists you follow.

### Keywords
Click any keyword pill (e.g. "piano", "sax", "drums") to filter the artist list to only those who play that instrument. The active keyword is highlighted in amber. Click **✕ reset** to clear.

### Artist Cards
Each card shows rank, name, first venue, concert count, and a follow button.

Click a card to expand it and see all upcoming concerts for that artist — with full event details (date, time, venue, map, calendar export). Past events are excluded.

### Following Section
Collapsed by default. Click the heading to expand. Lists every artist you follow with their next concert and an **Unfollow** button.

### Calendar Tab
Monthly calendar showing only followed artists' events. Navigate with ◀ / ▶ arrows. Events appear on the day ruler at the top.

## Notifications

### How they work
- When a followed artist has a new event, a **notification badge** (amber number) appears on the extension icon
- A **toast notification** pops up at the bottom-right of any page you're browsing (**Silent** mode — 5 seconds, no sound)

### Viewing notifications
- Open the popup and click the **🔔** button next to the filter bar
- Notifications list shows artist name, event date/time/venue
- Click **✕** to dismiss individual notifications
- Dismissing all notifications clears the badge

### Notification settings
- **Off** — no notifications at all
- **Silent** — badge + toast (default)

The background service worker checks for new events every hour and when you first open your browser.

## Tips

- Use **Today** filter in the morning to plan your evening
- Follow your favourite artists to never miss their shows
- The **Ech Wizard** is great for discovering new artists — browse keywords to find musicians by instrument
- Export individual events to your calendar with the **Calendar** button
- If an artist name isn't detected, try the colon format: `Artist Name: instrument`
