# Privacy Policy — Smart Card Reader Chrome Extension

**Last updated:** February 2026

## Overview

Smart Card Reader is a Chrome extension that reads contactless smart card (RFID/NFC) identifiers using a locally connected card reader and, optionally, transmits that data to an HTTP endpoint configured by the user.

## Data We Collect

### Card Data
When a contactless smart card is presented to the reader, the extension reads:
- **Card UID** — the unique identifier bytes stored on the card
- **ATR (Answer-To-Reset)** — technical metadata describing the card type

This data is read directly from the physical card via the PC/SC interface provided by Google's Smart Card Connector extension. No card data is collected unless a card is physically presented to the reader.

### User Preferences
The extension stores the following configuration locally on your device:
- Detection mode preference (event-driven or polling)
- Endpoint URL (the server address you configure)
- Venue ID (a label you provide)
- Client ID (an auto-generated UUID identifying this device)

## How We Use Your Data

### Local Display
Card data (UID, ATR, and parsed card metadata) is displayed in the extension's popup window for your reference.

### Endpoint Transmission
If you configure an endpoint URL in settings, the extension will send card data to **that URL and only that URL** when a card is detected. The extension sends:
- Card UID
- Card ATR and parsed metadata (card type, manufacturer, standard)
- Venue ID and Client ID from your settings

**You control the destination.** The extension does not send data anywhere unless you explicitly configure an endpoint URL. The extension has no built-in server or default endpoint.

### Debug Information
The extension maintains a rolling log of the last 50 events (card detections, API calls, errors) in memory. This log is only visible within the extension's popup window and is cleared when the service worker restarts or when you clear it manually. It is never transmitted externally.

## Data Sharing

We do **not** share your data with any third parties. Card data is only sent to the endpoint URL that you configure. We have no analytics, telemetry, tracking, or advertising.

## Data Storage

- **User preferences** are stored locally on your device using Chrome's `chrome.storage.local` API. This data does not sync across devices.
- **Card data and debug logs** are held in memory only. They are not persisted to disk and are lost when the service worker restarts.
- **No data is stored on any external server** by the extension itself. What happens to data after it reaches your configured endpoint is governed by that server's own privacy policy.

## Data Retention

- User preferences persist until you uninstall the extension or clear extension data.
- Card data and debug logs exist only in volatile memory for the current session.

## Data Deletion

- **Uninstall** the extension to remove all stored preferences.
- **Clear the endpoint URL** in settings to stop all external data transmission.
- **Clear the event log** using the "Clear" button in the Event Log tab.
- Chrome's built-in "Clear browsing data" with "Cookies and other site data" selected will also remove extension storage.

## Permissions

The extension requests the following Chrome permissions:

| Permission | Purpose |
|---|---|
| `storage` | Save your preferences (endpoint URL, venue ID, detection mode) locally |
| `alarms` | Keep the background service worker alive to maintain the card reader connection |

The extension does not request access to your browsing history, tabs, bookmarks, or any website content.

## Third-Party Services

The extension communicates with [Google's Smart Card Connector](https://chrome.google.com/webstore/detail/smart-card-connector/khpfeaanjngmcnplbdlpegiifgpfgdco) extension (a separate, Google-maintained extension) to access the PC/SC smart card interface. This communication stays entirely within your local Chrome browser — no data leaves your device through this channel.

## Security

- All data transmission to your configured endpoint uses the standard Fetch API. **We strongly recommend using HTTPS endpoints** to ensure card data is encrypted in transit.
- No card data is written to disk or persisted beyond the current browser session.
- The extension contains no remotely hosted code. All logic runs locally from the extension package.

## Children's Privacy

This extension is not directed at children under 13 and does not knowingly collect personal information from children.

## Changes to This Policy

If we update this privacy policy, the updated version will be published in the extension's repository and the "Last updated" date above will be revised.

## Contact

If you have questions about this privacy policy or the extension's data practices, please open an issue on the [GitHub repository](https://github.com/reneodlt/card_reader_demo/issues).
