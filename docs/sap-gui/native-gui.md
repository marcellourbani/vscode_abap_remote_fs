# Native Desktop SAP GUI

Open the currently active ABAP object directly in your locally installed SAP GUI application, giving you access to the full transaction UI without leaving your VS Code workflow.

## Requirements

- SAP GUI for Windows installed on your machine
- A configured ABAP FS connection to your SAP system

## How to Open

With an ABAP file open in the editor, use any of these methods:

| Method | Action |
|---|---|
| Keyboard shortcut | `Ctrl+Shift+F5` |
| Editor toolbar | Click the **Open in SAP GUI** icon |
| Command Palette | `Ctrl+Shift+P` → `ABAP FS: Open in native SAP GUI desktop application` |

## When to Use

Prefer native SAP GUI when you need:

- Transactions that are not available in the browser-based GUI
- Better performance for complex or data-heavy screens
- Full SAP GUI functionality (e.g., ALV grids, custom controls, scripting)
