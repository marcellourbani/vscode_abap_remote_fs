# Embedded SAP GUI (WebView)

Run SAP GUI transactions directly inside VS Code — no need to switch between windows. The SAP WebGUI renders inside a **WebView**: an embedded browser tab hosted within VS Code itself.

## Opening the Embedded SAP GUI

Three ways to open it:

| Method | Action |
|--------|--------|
| Keyboard shortcut | **Ctrl+Shift+F7** (with an ABAP file open) |
| Editor toolbar | Click the **Embedded GUI** button in the editor toolbar |
| Command Palette | `ABAP FS: Open SAP GUI in embedded WebView` |

## Requirements

- WebGUI enabled on your SAP system
- The connection configured in your ABAP FS settings

## How It Works

By default, the extension opens SAP GUI in VS Code's **Integrated Browser** (Simple Browser) rather than a raw iframe WebView. The Integrated Browser does not wrap the page in an iframe, which avoids a common blank-page issue described below.

## Blank Page / Clickjacking Issues

If you see a **blank white page**, your SAP system has clickjacking frame protection enabled (`ClickjackingFramingProtection.js`). This is a SAP server-side security feature that blocks SAP WebGUI from loading inside an iframe — the extension cannot override it.

You may also see these browser console errors:

- `ClickjackingFramingProtection.js: Ignored call to 'alert()'. The document is sandboxed`
- `Potential permissions policy violation: fullscreen is not allowed in this document`

**Solution:** The setting `abapfs.sapGui.useIntegratedBrowser` is **enabled by default** and resolves this. If you previously disabled it, re-enable it:

```json
{
  "abapfs.sapGui.useIntegratedBrowser": true
}
```

To fall back to the raw embedded WebView (for example, if the Integrated Browser causes problems in your environment):

```json
{
  "abapfs.sapGui.useIntegratedBrowser": false
}
```

This setting applies to all entry points: the toolbar button, command palette, and Run Transaction command.

> **VS Code tip:** The VS Code setting `simpleBrowser.useIntegratedBrowser` (marked experimental) controls whether Simple Browser uses VS Code's built-in browser engine. Enabling it may improve compatibility on desktop. This is a VS Code setting, not an ABAP FS setting.
