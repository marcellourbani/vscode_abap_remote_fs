# ADT Feed Reader

Monitor SAP system events in real-time directly within VS Code — without opening SAP GUI or checking ST22 manually.

## Setup

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **ABAP FS: Configure ADT Feeds**
3. Select the system and choose which feeds to subscribe to
4. Open the **Feed Inbox** view in the Activity Bar sidebar

## Supported Feeds

| Feed | Description |
|------|-------------|
| ABAP Runtime Errors | Dumps (equivalent to ST22) |
| ATC Findings | Code quality check results |
| System Messages | Broadcasts sent via SM02 |
| URI Creation Errors | ADT object resolution failures |

> **Note:** Available feeds depend on the SAP system version. Older systems may not support all types.

## Configuration

Each feed can be configured independently per connected system:

- **Polling interval** — how often VS Code checks for new entries (default: 120 seconds; ATC: 24 hours)
- **Notifications** — enable/disable VS Code pop-up alerts for new entries
- **Query filter** — use a built-in template or write a custom OData filter to narrow results

## Working with Entries

- Click an entry to open its details in a WebView panel
- Mark entries as **read** or **unread** to track what you've reviewed
- All feeds appear in a unified **Feed Inbox** — no need to switch between views

## Requirements

The target SAP system must support the ADT Feeds API. Check with your Basis team if feeds are unavailable.
