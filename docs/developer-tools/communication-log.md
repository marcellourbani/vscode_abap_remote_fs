# ADT Communication Log

Captures and displays every HTTP request and response between VS Code and SAP ADT in real time. Use it to diagnose slow operations, trace connection errors, or understand which ADT APIs the extension calls.

## Start Logging

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **ABAP FS: Activate Communication Log**
3. Select the SAP connection to monitor

The **Communication Log** panel opens at the bottom of the screen and immediately begins capturing traffic.

## Stop Logging

Run **ABAP FS: Deactivate Communication Log** from the Command Palette.

> **Note:** The log is held in memory only (up to 2000 entries). Entries are lost when you deactivate logging or close VS Code.

## Reading the Log

Click any entry to expand it and see:

- Query parameters
- Request and response headers
- Request and response bodies (XML and JSON are syntax-highlighted)
- Duration in milliseconds

## Filtering Entries

| Filter | How |
|--------|-----|
| By SAP system | Dropdown — select from all logged connections |
| By HTTP status | Buttons: **Success** (2xx), **Errors** (4xx/5xx), **Pending** |
| By URL | Text search field (200ms debounce) |

## Other Controls

- **Auto-scroll** — Toggle to keep the view pinned to the latest entry
- **Export** — Save all visible entries or a single entry as JSON (useful for bug reports)
- **Clear** — Remove all entries from the current view

## Common Use Cases

- **Slow operations** — Check which API calls take the longest
- **Connection errors** — See the exact HTTP status code and error body returned by SAP
- **Bug reports** — Export the log as JSON and attach it to a GitHub issue
- **Learning the API** — See exactly which ADT endpoints are called for any extension action
