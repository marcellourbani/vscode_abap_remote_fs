# Text Elements Management

Manage translatable text elements (symbols) in ABAP programs, classes, and function groups — the VS Code equivalent of the **Text Elements** tab in SE38/SE24.

**Supported object types:** Programs · Classes · Function Groups

---

## Opening the Text Elements Manager

Three ways to open it for the active file:

| Method | Steps |
|--------|-------|
| Command Palette | `Ctrl+Shift+P` → **ABAP FS: Text Elements Manager** |
| Context menu | Right-click an ABAP file in Explorer → **Text Elements Manager** |
| Copilot | Ask: *"Show me text elements for ZTEST_PROGRAM"* |

---

## What You Can Do

### Read text elements
Works on **all SAP systems**. Displays existing text element IDs and their translations in an interactive webview.

### Create / Update text elements
Available on **newer systems** with ADT text elements API support. Lets you add new symbols or change existing text directly in VS Code — no SAP GUI needed.

> **Older systems fallback:** If the ADT API is not available, the extension automatically opens the text element editor in SAP GUI instead.

---

## Step-by-Step: Editing Text Elements

1. Open an ABAP program, class, or function group in the editor.
2. Press `Ctrl+Shift+P` and run **ABAP FS: Text Elements Manager**.
3. The webview shows all existing text elements for the object.
4. To **add** a new element, enter the ID (e.g. `001`) and text value, then confirm.
5. To **change** an existing element, edit the text inline and save.
6. Changes are applied to the active object on the server.

---

## Compared to SE38 Text Elements

| SE38 / SE24 | VS Code (ABAP FS) |
|-------------|-------------------|
| Navigate to program → Goto → Text Elements | Command Palette or right-click |
| Edit in ABAP editor screen | Interactive webview |
| Save with `Ctrl+S` | Save within the webview |
| Requires SAP GUI | Works directly in VS Code (newer systems) |

---

## System Compatibility

| Operation | Older systems | Newer systems (ADT API) |
|-----------|--------------|------------------------|
| Read | Yes | Yes |
| Create / Update | Opens SAP GUI fallback | Yes, in VS Code |
