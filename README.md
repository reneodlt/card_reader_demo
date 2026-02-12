# Smart Card Reader Chrome Extension

A Chrome extension that reads contactless smart card (RFID/NFC) UIDs via Google's [Smart Card Connector](https://chrome.google.com/webstore/detail/smart-card-connector/khpfeaanjngmcnplbdlpegiifgpfgdco) and posts them to a configurable HTTP endpoint.

Built for ChromeOS environments where native PC/SC access is brokered through the Smart Card Connector extension.

## Features

- **Card detection** via two modes:
  - **Event-driven** (`SCardGetStatusChange`) -- efficient, blocks until state changes
  - **Polling** (`SCardStatus`) -- fallback, checks every 1.5s
- **Card metadata** -- reads UID, ATR, and parses card type / manufacturer from ATR historical bytes (MIFARE Classic, Ultralight, Plus, FeliCa, etc.)
- **Configurable endpoint** -- POSTs card data as JSON to any URL
- **API debug panel** -- shows full request/response with headers, status, and round-trip duration
- **Resend & edit** -- replay the last API request, or modify the URL/body and send a custom request
- **Event log** -- rolling log of the last 50 internal events (card detect, remove, API calls, errors) with timestamps
- **Auto-generated client ID** -- unique UUID per device for identifying the reader source

## Requirements

- Chrome / ChromeOS 116+
- [Smart Card Connector](https://chrome.google.com/webstore/detail/smart-card-connector/khpfeaanjngmcnplbdlpegiifgpfgdco) extension installed
- A PC/SC-compatible contactless card reader (e.g. ACR122U, HID OMNIKEY)

## Installation

1. Clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select the repository directory
5. Ensure the Smart Card Connector extension is also installed and running

## Configuration

Click the extension icon, then click **Settings** to configure:

| Setting | Description |
|---|---|
| **Detection Mode** | Event-driven (recommended) or Polling |
| **Endpoint URL** | The HTTP(S) URL to POST card data to |
| **Venue ID** | An identifier for the venue/location |
| **Client ID** | Auto-generated UUID (read-only) |

## API Payload

When a card is detected, the extension sends a `POST` request:

```http
POST <endpoint_url>
Content-Type: application/json
```

```json
{
  "card_id": "AA:BB:CC:DD",
  "venue_id": "venue-001",
  "client_id": "550e8400-e29b-41d4-a716-446655440000",
  "card_atr": "3B:8F:80:01:80:4F:0C:A0:00:00:03:06:03:00:01:00:00:00:00:6A",
  "card_name": "MIFARE Classic 1K",
  "card_standard": "ISO 14443 A, Part 3",
  "card_type": "Contactless (ISO 14443)",
  "card_rid": "NXP (PC/SC standard)"
}
```

Fields like `card_atr`, `card_name`, `card_standard`, `card_type`, and `card_rid` are included when available from ATR parsing. Not all cards expose all fields.

## Debugging

The popup window has two tabs:

### API Debug tab
- **Request** -- full POST URL, headers, and JSON body
- **Response** -- HTTP status, status text, response body, and round-trip duration in ms
- **Response headers** -- expandable section showing all response headers
- **Resend** -- replay the exact same request
- **Edit & Resend** -- modify the URL and/or JSON body, then send

### Event Log tab
- Rolling log of the last 50 events with timestamps
- Color-coded by level: info (blue), warn (yellow), error (red)
- Expandable detail payloads for API calls and card data
- Clear button to reset the log

## Project Structure

```
manifest.json      Chrome extension manifest (v3)
background.js      Service worker: card monitoring, API calls, state management
pcsc-client.js     PC/SC protocol client for Smart Card Connector
popup.html         Extension popup UI
popup.js           Popup controller and rendering
options.html       Settings page
options.js         Settings controller
icons/             Extension icons (16, 48, 128px)
```

## How It Works

1. The background service worker connects to the Smart Card Connector extension via `chrome.runtime.connect()`
2. It establishes a PC/SC context (`SCardEstablishContext`) and lists readers (`SCardListReaders`)
3. Depending on detection mode, it either:
   - Blocks on `SCardGetStatusChange` until a card is inserted/removed
   - Polls `SCardStatus` every 1.5 seconds
4. When a card is detected, it reads the UID via the GET DATA pseudo-APDU (`0xFF 0xCA 0x00 0x00 0x00`) and parses the ATR
5. The card data is POSTed to the configured endpoint
6. All state changes are broadcast to the popup for real-time display

## License

MIT
