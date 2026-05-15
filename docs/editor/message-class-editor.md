# Message Class Editor

Message classes (transaction SE91) open in a custom table editor instead of raw XML, making it easy to view and maintain messages directly in VS Code.

## Opening a Message Class

Search for your message class (e.g. `ZMY_MESSAGES`) using the ABAP FS file explorer — it opens automatically in the table editor. You can also open any `.msagn.xml` file directly.

## Working with Messages

| Action | How |
|--------|-----|
| **Add** | Click the ➕ button — the next available number is suggested automatically |
| **Edit** | Double-click the message text, or click ✏️ |
| **Delete** | Click 🗑️ next to the message |
| **Save** | **Ctrl+S** — all pending adds, edits, and deletes are sent to SAP together |

Validation runs as you type: message text is limited to **72 characters** and the number field is required.

## Notes

- Message numbers are zero-padded (`001`, `002`, …).
- Deleted messages are flagged and removed on save; skipped numbers are not reused when suggesting the next number.
- **Long text editing is not supported** — use SE91 for long texts.
- Only applies to message class objects (`MSAG/N` type).
