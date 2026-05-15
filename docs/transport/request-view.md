# Transport Request View

The Transport Request View is the VS Code equivalent of **SE09/SE10**. It lets you manage workbench and customising transports without leaving the editor.

**Open it:** Activity Bar → ABAP FS icon → **Transports** panel.

---

## What you can do

| Action | How |
|---|---|
| List your open transports | Panel opens automatically filtered to your user |
| List another user's transports | Click the filter icon and enter a username |
| Browse objects in a transport | Expand a transport node |
| Compare two transports | Right-click a transport → **Compare** |
| Copy transport number | Right-click → **Copy transport number** |
| Run ATC quality check | Right-click → **Run ATC** |
| Open in SAP GUI (SE09) | Right-click → **Open in GUI** |
| Release a transport | Right-click → **Release** |
| Delete a transport | Right-click → **Delete** |
| Change owner / add user | Right-click → **Change owner** / **Add user** |
| Link to source control | Right-click → **Add to source control** |
| Refresh the list | Click the refresh icon or press `F5` |

---

## Using Copilot to query transports

You can also ask Copilot in natural language:

- *"Show me my transports"*
- *"Get details for transport DEVK900123"*
- *"What objects are in DEVK900123?"*
- *"Compare transports DEVK900123 and DEVK900124"*

---

## Older SAP systems

If the ADT transport API is unavailable, the extension falls back to direct SQL queries against tables `E070`, `E071`, and `E071K` automatically — no configuration needed.
