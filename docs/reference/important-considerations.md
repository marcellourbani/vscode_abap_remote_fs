# Important Considerations

| Feature | Limitation |
|---|---|
| **Create Objects** | Transport request dialogs still appear — object creation is not fully automated. |
| **Text Elements** | Create/Update actions require ADT API support (newer SAP systems only). |
| **Transport Management** | On older systems, some actions fall back to direct table queries. |
| **Code Search** | Searches committed code only — unsaved local changes are not visible. |
| **Mass Activation** | You must select objects from a dialog; activation is not automatic. |

## AI Agent Code Changes

When Copilot edits ABAP code in Agent mode, changes are written to SAP **immediately** — before you accept them. The virtual filesystem locks the object, writes the content, and unlocks it in one step.

- **Keep** — triggers a second save with the accepted content.
- **Undo** — reverts the changes on the server, just like undoing any file edit.

> **Review AI-generated code carefully.** It is live on the SAP server the moment it is written, not only after you click Keep.
