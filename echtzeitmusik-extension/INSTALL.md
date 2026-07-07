# Install echtzeitmusik Berlin Extension

## Chrome Web Store (Recommended)

1. Visit the extension page on the [Chrome Web Store](https://chromewebstore.google.com) (search "echtzeitmusik Berlin")
2. Click **Add to Chrome**
3. Click **Add Extension** in the popup
4. Click the puzzle piece (![Extensions icon](https://storage.googleapis.com/support-kms-prod/0CF5E0C2D1A0C0A5C0A5C0A5C0A5C0A5C0A5) in the toolbar) and pin the extension
5. Click the icon to open

## Developer Mode (Manual)

1. **Download** or clone this repo:
   ```bash
   git clone https://github.com/gulahgula/echzeitmusicwizard.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle top-right)
4. Click **Load unpacked**
5. Select the `echtzeitmusik-extension` folder inside the repo
6. The extension appears in your toolbar — click it to start browsing

### Reload After Changes

If you edit any source files, go to `chrome://extensions` and click the reload icon (↻) on the extension card, or press `Cmd+R` / `Ctrl+R` on the card.

## Troubleshooting

| Problem | Fix |
|---|---|
| No concerts showing | Check you're online and echtzeitmusik.de is accessible |
| Extension icon missing | Pin it from the puzzle piece menu in the toolbar |
| "Invalid manifest" on load | Make sure you selected the `echtzeitmusik-extension/` subfolder, not the repo root |
| Followed artists lost | Data is stored in your browser's local storage — clearing browser data will reset it |
