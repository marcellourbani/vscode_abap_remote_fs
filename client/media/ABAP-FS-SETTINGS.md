# ABAP FS Settings Reference

This document provides a comprehensive reference for all ABAP FS extension settings and is meant for AI agents. AI agents can use this to help users understand, configure, and troubleshoot the extension.

---

## Table of Contents

1. [SAP System Connection Settings](#1-sap-system-connection-settings)
2. [Fun Notifications](#2-fun-notifications)
3. [MCP Server Settings](#3-mcp-server-settings)
4. [Embedded GUI Settings](#4-embedded-gui-settings)
5. [ABAP Cleaner Integration](#5-abap-cleaner-integration)
6. [Local File Storage](#6-local-file-storage)
7. [AI Subagents](#7-ai-subagents)
8. [Heartbeat Service](#8-heartbeat-service)
9. [Feed Subscriptions](#9-feed-subscriptions)
10. [Editor Defaults](#10-editor-defaults)

---

## 1. SAP System Connection Settings

### Managing Connections

**Recommended: Use the SAP Connection Manager GUI**

Run command: `ABAP FS: Connection Manager` (or press `Ctrl+Shift+P` and search for it)

The Connection Manager provides a visual interface to:
- **Add** new SAP system connections with a guided form
- **Edit** existing connections
- **Delete** connections (single or bulk)
- **Export** connections to JSON for sharing with team members
- **Import** connections from JSON files
- **Create BTP/Cloud connections** from service keys or endpoints
- **Bulk edit usernames** across multiple connections
- **Choose storage location**: User settings (global) or Workspace settings (project-specific)

**Note:** Passwords are NEVER stored in settings files. On first connection, the user will be prompted for their password, which is then securely stored in the operating system's credential manager.

---

### `abapfs.remote`

The main setting for configuring SAP system connections. This is an object where each key is a connection ID (e.g., `dev100`, `prod`) and the value contains connection details.

| Property | Type | Default | Min/Max | Description |
|----------|------|---------|---------|-------------|
| `url` | string | `"https://myserver:44300"` | - | The HTTP(S) URL of the SAP development server. Must include protocol and port. |
| `username` | string | `"developer"` | - | SAP user name for authentication. Password is requested at runtime and stored securely. |
| `client` | string | `"001"` | 3 chars | SAP client number (3 digits). |
| `language` | string | `"en"` | 2 chars | Login language code (ISO 639-1). |
| `atcapprover` | string | `""` | - | Default ATC (ABAP Test Cockpit) approver username for exemption requests. |
| `atcVariant` | string | `""` | - | Default ATC check variant to use for code quality checks. |
| `allowSelfSigned` | boolean | `false` | - | Accept self-signed SSL certificates. **Reduces connection security.** Use only for development servers. |
| `customCA` | string | `"/secrets/myCA.pem"` | - | Path to custom Certificate Authority certificate file (PEM format) for corporate CAs. |
| `diff_formatter` | string | `"ADT formatter"` | enum: `ADT formatter`, `AbapLint`, `simple` | Code formatter to use when comparing versions. |
| `maxDebugThreads` | integer | `4` | 1-20 | Maximum concurrent debug threads per debugging session. |

#### OAuth Sub-properties (for BTP/Cloud systems)

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `oauth.clientId` | string | Yes | OAuth 2.0 client ID from BTP service key. |
| `oauth.clientSecret` | string | Yes | OAuth 2.0 client secret. |
| `oauth.loginUrl` | string | Yes | OAuth token endpoint URL. |
| `oauth.saveCredentials` | boolean | No | Whether to persist OAuth tokens. |

#### SAP GUI Sub-properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `sapGui.disabled` | boolean | `false` | Disable SAP GUI integration entirely. |
| `sapGui.guiType` | enum | `"SAPGUI"` | GUI type: `SAPGUI` (desktop), `WEBGUI_CONTROLLED` (browser without password exposure), `WEBGUI_UNSAFE` (external browser), `WEBGUI_UNSAFE_EMBEDDED` (embedded webview). |
| `sapGui.server` | string | - | Application server hostname (direct SAP GUI connection). |
| `sapGui.systemNumber` | string | - | System number (2 digits, for direct connection). |
| `sapGui.group` | string | - | Logon group name (load balancing). |
| `sapGui.messageServer` | string | - | Message server hostname (load balancing). |
| `sapGui.messageServerPort` | string | `"3600"` | Message server port. |
| `sapGui.routerString` | string | - | SAP Router string for connections through firewalls. |

**GUI Type Options:**
- `SAPGUI` - Use desktop SAP GUI (default, most secure)
- `WEBGUI_CONTROLLED` - Use WebGUI in default browser (secure, no password exposure)
- `WEBGUI_UNSAFE` - Use WebGUI in default browser (⚠️ may expose password in URL)
- `WEBGUI_UNSAFE_EMBEDDED` - Use WebGUI embedded in VS Code (⚠️ may expose password)

**Example Configuration:**
```json
{
  "abapfs.remote": {
    "dev100": {
      "url": "https://dev-server.company.com:44300",
      "username": "DEVELOPER",
      "client": "100",
      "language": "en",
      "allowSelfSigned": false
    }
  }
}
```

---

## 2. Fun Notifications

### `abapfs.copilot.professionalNotifications`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `professionalNotifications` | boolean | `false` | When `true`, disables fun emoji prefixes on notifications and shows plain professional messages. When disabled (default), notifications include playful emojis like "🎉 Activated!", "✅ Tests passed!". |

**Example:**
```json
{
  "abapfs.copilot.professionalNotifications": true
}
```

---

## 3. MCP Server Settings

The MCP (Model Context Protocol) server allows external AI tools like Cursor, Claude Desktop, Eclipse ADT etc., to use ABAP FS tools.

### `abapfs.mcpServer.autoStart`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `autoStart` | boolean | `false` | Automatically start the MCP server when the extension activates. |

### `abapfs.mcpServer.port`

| Property | Type | Default | Min/Max | Description |
|----------|------|---------|---------|-------------|
| `port` | integer | `4847` | 1024-65535 | Port number for the MCP HTTP server. Change if default port conflicts with other services. |

### `abapfs.mcpServer.apiKey`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `apiKey` | string | `""` | API key for MCP server authentication. Clients must include this as `Authorization: Bearer <key>`. Empty = no authentication (not recommended for shared machines). |

**Example:**
```json
{
  "abapfs.mcpServer.autoStart": true,
  "abapfs.mcpServer.port": 4847,
  "abapfs.mcpServer.apiKey": "your-secret-api-key"
}
```

---

## 4. Embedded GUI Settings

### `abapfs.autoOpenUnsupportedInGui`

| Property | Type | Default | Scope | Description |
|----------|------|---------|-------|-------------|
| `autoOpenUnsupportedInGui` | boolean | `true` | application | Automatically open unsupported object types (like SAPGUI-only objects) in SAP GUI. When `false`, shows a message with manual options instead. |

**Example:**
```json
{
  "abapfs.autoOpenUnsupportedInGui": true
}
```

---

## 5. ABAP Cleaner Integration

Integration with [SAP ABAP Cleaner](https://github.com/SAP/abap-cleaner) for automatic code formatting.

### `abapfs.cleaner`

| Sub-property | Type | Default | Min/Max | Description |
|--------------|------|---------|---------|-------------|
| `enabled` | boolean | `false` | - | Enable ABAP Cleaner integration. Must also set `executablePath`. |
| `executablePath` | string | `""` | - | Full path to `abap-cleanerc.exe` (command line version). **Required.** Example: `C:\tools\abap-cleaner\abap-cleanerc.exe` |
| `profilePath` | string | `""` | - | Path to custom cleanup profile (`.cfj` file). Leave empty for default rules. |
| `targetRelease` | enum | `"latest"` | `7.02`-`7.57`, `latest` | Target ABAP release version. Determines which language features the cleaner can use. Use lower version for backwards compatibility. |
| `showStatistics` | boolean | `true` | - | Show cleanup statistics (number of changes) after processing. |
| `showAppliedRules` | boolean | `false` | - | Show which specific cleanup rules were applied (verbose output). |
| `cleanOnSave` | boolean | `false` | - | Automatically clean ABAP code when saving files. |
| `lineRange.enabled` | boolean | `false` | - | Enable line range cleaning (clean only selected lines). |
| `lineRange.expandRange` | boolean | `true` | - | Automatically expand range to include complete statements. |
| `timeout` | number | `30000` | 5000-300000 | Timeout in milliseconds for cleanup operations (30000ms = 30 seconds). |

**Example:**
```json
{
  "abapfs.cleaner": {
    "enabled": true,
    "executablePath": "C:\\tools\\abap-cleaner\\abap-cleanerc.exe",
    "targetRelease": "7.57",
    "cleanOnSave": false,
    "showStatistics": true
  }
}
```

---

## 6. Local File Storage

### `abapfs.localfs.preferGlobal`

| Property | Type | Default | Scope | Description |
|----------|------|---------|-------|-------------|
| `preferGlobal` | boolean | `false` | resource | Store non-ABAP files (like AI agent configs, hidden files starting with `.`) in a global folder shared by all workspaces, instead of per-workspace storage. Useful for sharing AI agent configurations across projects. |

**Example:**
```json
{
  "abapfs.localfs.preferGlobal": true
}
```

---

## 7. AI Subagents

Subagents delegate specialized ABAP tasks to cheaper/faster AI models to reduce costs and preserve context window of main agent.

### `abapfs.subagents.enabled`

| Property | Type | Default | Scope | Description |
|----------|------|---------|-------|-------------|
| `enabled` | boolean | `false` | resource | Enable AI subagents for optimized ABAP analysis. Copilot delegates tasks to configured models to reduce costs. |

### `abapfs.subagents.models`

| Property | Type | Default | Scope | Description |
|----------|------|---------|-------|-------------|
| `models` | object | `{}` | resource | Model assignments for each subagent. Use the `manage_subagents` tool to configure (ask Copilot: "configure subagent models"). |

**Note:** Cannot enable subagents without configuring models first. Use the built-in configuration tool.

---

## 8. Heartbeat Service

Background monitoring service that periodically runs an LLM to check SAP systems and send reminders.

### `abapfs.heartbeat.enabled`

| Property | Type | Default | Scope | Description |
|----------|------|---------|-------|-------------|
| `enabled` | boolean | `false` | resource | Enable heartbeat service. **Requires `model` to be configured first.** |

### `abapfs.heartbeat.every`

| Property | Type | Default | Scope | Description |
|----------|------|---------|-------|-------------|
| `every` | string | `"30m"` | resource | Heartbeat check interval. Format: number + unit (`5m` = 5 minutes, `1h` = 1 hour, `30s` = 30 seconds). Minimum: 1m, recommended: 5-30m. |

### `abapfs.heartbeat.model`

| Property | Type | Default | Scope | Description |
|----------|------|---------|-------|-------------|
| `model` | string | `""` | resource | **Required.** Language model to use for heartbeat. Examples: `"GPT-4o mini"`, `"Claude Haiku 4"`. **Use cheap models to minimize costs!** |

### `abapfs.heartbeat.prompt`

| Property | Type | Default | Scope | Description |
|----------|------|---------|-------|-------------|
| `prompt` | string | `""` | resource | Custom heartbeat prompt. If empty, uses `heartbeat.json` watchlist in workspace to build the prompt automatically. |

### `abapfs.heartbeat.ackMaxChars`

| Property | Type | Default | Min/Max | Scope | Description |
|----------|------|---------|---------|-------|-------------|
| `ackMaxChars` | number | `300` | 0-1000 | resource | Maximum characters allowed after `HEARTBEAT_OK` response before treating it as an alert. Prevents false positives. |

### `abapfs.heartbeat.maxHistory`

| Property | Type | Default | Min/Max | Scope | Description |
|----------|------|---------|---------|-------|-------------|
| `maxHistory` | number | `100` | 10-1000 | resource | Maximum heartbeat history entries to keep. Older entries are pruned. |

### `abapfs.heartbeat.maxConsecutiveErrors`

| Property | Type | Default | Min/Max | Scope | Description |
|----------|------|---------|---------|-------|-------------|
| `maxConsecutiveErrors` | number | `20` | 1-50 | resource | Auto-pause heartbeat after this many consecutive errors. Prevents runaway costs from repeated failures. |

### `abapfs.heartbeat.activeHours`

Restrict heartbeat to active hours to save costs during off-hours.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `activeHours` | object | `null` | Restrict heartbeat to specified hours. |
| `activeHours.start` | string | - | Start time in 24h format (e.g., `"08:00"`). |
| `activeHours.end` | string | - | End time in 24h format (e.g., `"22:00"` or `"24:00"`). |
| `activeHours.timezone` | string | - | Timezone: `"local"`, `"utc"`, or IANA timezone (e.g., `"America/New_York"`). |

### `abapfs.heartbeat.notifyOnAlert`

| Property | Type | Default | Scope | Description |
|----------|------|---------|-------|-------------|
| `notifyOnAlert` | boolean | `true` | resource | Show VS Code notification when heartbeat finds something that needs attention. |

### `abapfs.heartbeat.notifyOnError`

| Property | Type | Default | Scope | Description |
|----------|------|---------|-------|-------------|
| `notifyOnError` | boolean | `true` | resource | Show VS Code notification when heartbeat encounters an error. |

**Example:**
```json
{
  "abapfs.heartbeat.enabled": true,
  "abapfs.heartbeat.model": "GPT-4o mini",
  "abapfs.heartbeat.every": "15m",
  "abapfs.heartbeat.activeHours": {
    "start": "08:00",
    "end": "18:00",
    "timezone": "local"
  },
  "abapfs.heartbeat.maxConsecutiveErrors": 10
}
```

---

## 9. Feed Subscriptions

ADT feed subscriptions for monitoring SAP system events (transports, dumps, etc.).

**Configure via command:** `ABAP FS: Configure Feeds`

### `abapfs.feedSubscriptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `feedSubscriptions` | object | `{}` | Feed subscriptions organized by system ID → feed ID. Use the Configure Feeds command for easy setup. |

#### Per-Feed Properties

| Property | Type | Default | Min/Max | Description |
|----------|------|---------|---------|-------------|
| `enabled` | boolean | `false` | - | Whether this feed is actively polled. |
| `pollingInterval` | number | `300` | 120-86400 | Polling interval in seconds (min 2 minutes, max 24 hours). |
| `notifications` | boolean | `true` | - | Show notifications for new feed entries. |
| `notificationLevel` | enum | `"all"` | `all`, `error`, `warning`, `info` | Filter notifications by severity level. |
| `query` | string | `""` | - | Custom query filter for this feed. |
| `useDefaultQuery` | boolean | `true` | - | Use the feed's default query instead of custom query. |

**Example:**
```json
{
  "abapfs.feedSubscriptions": {
    "dev100": {
      "runtime_errors": {
        "enabled": true,
        "pollingInterval": 300,
        "notifications": true,
        "notificationLevel": "error",
        "useDefaultQuery": true
      }
    }
  }
}
```

---

## 10. Editor Defaults

ABAP FS sets recommended editor defaults for ABAP files:

| Setting | Default Value | Description |
|---------|---------------|-------------|
| `editor.formatOnSave` | `true` | Automatically format ABAP code when saving (for `[abap]` files). |
| `editor.hover.delay` | `700` | Delay before showing hover information (ms). |
| `editor.hover.above` | `false` | Show hover below the cursor. |

These are automatically applied but can be overridden in user settings.

---

## Quick Setup Guide

### Step 1: Add SAP Connection (Easiest Way)

1. Press `Ctrl+Shift+P`
2. Run `ABAP FS: Connection Manager`
3. Click "Add Connection"
4. Fill in server details
5. Click "Save"

### Step 2: Connect to SAP

1. Press `Ctrl+Shift+P`
2. Run `ABAP FS: Connect to an ABAP system`
3. Select the connection
4. Enter password when prompted (stored securely in OS credential manager)

### Minimal Manual Setup

```json
{
  "abapfs.remote": {
    "myserver": {
      "url": "https://your-sap-server:44300",
      "username": "YOUR_USERNAME",
      "client": "100",
      "language": "en"
    }
  }
}
```

### Enable Heartbeat Monitoring

```json
{
  "abapfs.heartbeat.enabled": true,
  "abapfs.heartbeat.model": "GPT-4o mini (copilot)",
  "abapfs.heartbeat.every": "15m"
}
```

### Enable ABAP Cleaner

```json
{
  "abapfs.cleaner": {
    "enabled": true,
    "executablePath": "C:\\tools\\abap-cleaner\\abap-cleanerc.exe",
    "targetRelease": "latest"
  }
}
```

---

## Troubleshooting

| Issue | Setting to Check | Solution |
|-------|------------------|----------|
| Can't connect to SAP | `abapfs.remote.*.url`, `*.username` | Verify URL includes protocol/port, username is correct. Password is entered at runtime. |
| SSL certificate errors | `abapfs.remote.*.allowSelfSigned`, `*.customCA` | Set `allowSelfSigned: true` for dev, or provide `customCA` path for corporate CA. |
| Heartbeat won't start | `abapfs.heartbeat.model` | Must be set before enabling. Use a cheap model like "GPT-4o mini". |
| ABAP Cleaner not working | `abapfs.cleaner.enabled`, `*.executablePath` | Both must be set. Verify `abap-cleanerc.exe` exists at the path. |
| Subagents disabled automatically | `abapfs.subagents.models` | Configure model for each agent. User can ask Copilot to "configure subagent models". |
| MCP server connection refused | `abapfs.mcpServer.autoStart`, `*.port` | Ensure autoStart is true, verify port isn't in use by another application. |
| Password not saved in settings | (by design) | Passwords are stored in OS credential manager, not in settings files. |

---

## Useful Commands

| Command | Description |
|---------|-------------|
| `ABAP FS: Connection Manager` | Open the visual connection management UI |
| `ABAP FS: Connect to an ABAP system` | Connect to a configured SAP system |
| `ABAP FS: Disconnect` | Disconnect from all SAP systems |
| `ABAP FS: Configure Feeds` | Configure ADT feed subscriptions |
| `ABAP FS: Search` | Search for ABAP objects |
| `ABAP FS: Run in GUI` | Open current object in SAP GUI |
| `ABAP FS: Run in Embedded GUI` | Open transaction in embedded WebGUI |

---

*This document is designed for use by AI assistants to help users configure ABAP FS.*
