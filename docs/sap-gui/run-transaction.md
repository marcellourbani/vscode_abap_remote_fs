# Run SAP Transaction

Execute SAP transaction codes directly from VS Code without switching to the SAP GUI window.

## How to Use

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **ABAP Copilot: Run SAP Transaction**
3. If multiple systems are connected, select the target system
4. Type a transaction code (e.g., `MM43`, `SE38`)
5. Press `Enter` — the transaction opens in your configured GUI

## GUI Configuration

Set your preferred GUI type per connection in settings (`sapGui.guiType`).

## Limitations

- **Native SAP GUI** — Windows only
- **Embedded WebView** — no SSO; requires manual login
- Some transactions may not work correctly in embedded mode
