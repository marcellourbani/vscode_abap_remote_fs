# SAP Connection Manager

The Connection Manager is a visual interface for adding, editing, and organizing your SAP system connections. Open it from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) by typing **ABAP FS: Connection Manager**.

## Adding a Connection

1. Open the Command Palette (`Ctrl+Shift+P`) and run **ABAP FS: Connection Manager**.
2. Click **Add Connection**.
3. Fill in the required fields (see [Configuration Fields](#configuration-fields) below).
4. Choose where to save: **User Settings** (available in all workspaces) or **Workspace Settings** (this project only).
5. Click **Save**. You will be prompted for your password on the first connect — it is stored securely in the OS credential manager, never in settings files.

## Configuration Fields

| Section | Fields |
|---|---|
| **Basic** | ADT URL, username, SAP client, language |
| **SSL** | Allow self-signed certificates, custom CA certificate |
| **SAP GUI** | Server, system number, router string, message server, GUI type (Desktop / Embedded WebGUI / Browser) |
| **OAuth** | Client ID, secret, login URL |
| **Advanced** | ATC approver, ATC check variant, max debug threads, diff formatter |

## Import / Export

- **Export** — saves all connections to a JSON file (passwords excluded) for backup or sharing with colleagues.
- **Import** — merges connections from a previously exported JSON file.
- **BTP Service Key** — create a connection from a BTP Service Key JSON file.
- **BTP Endpoint** — create a connection via an interactive Cloud Foundry login flow.

## Bulk Operations

Select multiple connections using the checkboxes to:

- **Bulk delete** — remove several connections at once.
- **Bulk username edit** — update the username across multiple connections simultaneously.

A confirmation dialog appears before any bulk action is applied.

## User vs. Workspace Settings

Connections saved to **User Settings** are global — they appear in every VS Code workspace on your machine. Connections saved to **Workspace Settings** are stored in the `.vscode/settings.json` of the current project folder, making them easy to commit or share per project.
