# Organization Administration

To deploy ABAP FS internally, configure the optional features below before building and distributing your own VSIX.

---

## SAP System Whitelist (Optional)

Restrict which SAP systems and users can connect — for example, to block production connections or limit access to approved developers.

### 1. Create the whitelist file

Base it on `client/src/services/whitelist.example.json`:

```json
{
  "version": {
    "minimumExtensionVersion": "1.0.0"
  },
  "allowedDomains": ["*dev*", "*test*", "*qa*"],
  "developers": [
    {
      "manager": "Team_Lead_Name",
      "userIds": ["developer1", "dev1_alt_id"]
    },
    {
      "manager": "Another_Manager",
      "userIds": ["developer2"]
    }
  ]
}
```

**`developers` structure:** Each object represents **one person**. List all of that person's SAP user IDs (across different systems) in the same `userIds` array — they will be treated as the same individual in telemetry. Do not mix different people into one object.

### 2. Host the file

Deploy it to an internal HTTP/HTTPS URL with no authentication required. Users need read access only.

### 3. Configure the URL

Edit `client/src/services/sapSystemValidator.ts`:

```typescript
private readonly WHITELIST_URL = 'https://your-internal-server.com/whitelist.json';
```

### 4. Enable validation

Both flags default to `true` (whitelist is skipped). Set to `false` to enforce restrictions:

```typescript
private readonly ALLOW_ALL_SYSTEMS = true;  // false = validate against allowedDomains
private readonly ALLOW_ALL_USERS = true;    // false = validate against developers.userIds
```

### How it works

- The extension fetches the whitelist on startup and every 2 hours.
- `allowedDomains` patterns use wildcards (e.g., `*dev*`) matched against the SAP system hostname.
- `userIds` are checked across all developer entries. Both system and user must pass for a connection to succeed.
- If the fetch fails, a hardcoded backup whitelist is used.
- On corporate VPN, the extension retries for up to 10 minutes after startup; a status bar notification is shown during retries.

---

## Telemetry with Application Insights (Optional)

**The VS Code Marketplace version sends no telemetry anywhere.** All usage data is written to local CSV files only (`telemetry-YYYY-MM-DD.csv` in extension storage). Nothing leaves the machine.

This section applies only if you want **central analytics** for your organization.

### What is collected

Each event is an action string (e.g., `command_activate_called`, `tool_search_abap_objects_called`) plus:

| Field | Description |
|---|---|
| Anonymous user ID | SHA hash of `hostname + username + platform` — cannot be reversed |
| Session ID | Random ID per VS Code session |
| Extension version | Version number |
| VS Code version | VS Code version number |
| Platform | Windows / Linux / Mac |
| SAP system | System accessed (if applicable) |
| Manager / Team | From whitelist `developers` mapping (if configured) |

**Not collected:** credentials, source code, object names, business data, error messages, performance metrics, HTTP requests, dependencies, or console logs. All Application Insights auto-collection features are disabled by default.

### Setup steps

1. **Fork the repository** on GitHub.

2. **Create an Azure Application Insights resource** in your Azure subscription.

3. **Copy the connection string** from Azure Portal → Application Insights → Overview → Connection String.

4. **Set the connection string** in `client/src/services/appInsightsService.ts`:

   ```typescript
   const connectionString = "InstrumentationKey=YOUR-KEY;IngestionEndpoint=https://..."
   ```

5. **Build and distribute** your VSIX (see [Building and Distributing](#building-and-distributing) below).

### Enabling additional auto-collection

All auto-collection is off by default. To enable any of the following, edit the `initialize()` method in `client/src/services/appInsightsService.ts`:

| Feature | Change |
|---|---|
| Exception tracking | `.setAutoCollectExceptions(false)` → `(true)` |
| Performance metrics (CPU/memory) | `.setAutoCollectPerformance(false, false)` → `(true, true)` |
| HTTP request tracking | `.setAutoCollectRequests(false)` → `(true)` |
| Dependency tracking | `.setAutoCollectDependencies(false)` → `(true)` |

You can also add custom tracking anywhere in your code:

```typescript
appInsights.defaultClient.trackEvent({ name: 'my_event' });
appInsights.defaultClient.trackException({ exception: error });
appInsights.defaultClient.trackMetric({ name: 'my_metric', value: 42 });
```

### Telemetry + whitelist integration

When the whitelist `developers` structure is configured, telemetry automatically groups multiple SAP user IDs belonging to the same person. The `manager` field enables team-level analytics (e.g., "which team uses debugging most?") while keeping individual users anonymous.

### How events are stored and sent

- Events are logged to local CSV files first.
- If an App Insights connection string is configured, events are also sent to Azure (batched every 30 seconds).
- If the network is unavailable, events are stored locally and retried.
- Local storage flushes every 5 minutes or when the buffer reaches 25 entries.

---

## Building and Distributing

After completing configuration above:

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Build and package:**

   ```bash
   # Windows (recommended)
   build-and-install.bat

   # Or manually:
   npm run compile
   npx vsce package
   ```

3. **Distribute** the generated `.vsix` file to your users. They can install it via Extensions → `...` → **Install from VSIX...**
