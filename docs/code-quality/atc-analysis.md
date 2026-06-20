# ABAP Test Cockpit (ATC) Analysis

ATC is SAP's built-in code quality framework — the same checks you run in SE80 or Eclipse ADT, but integrated directly into VS Code. It scans your ABAP objects for coding violations, security issues, performance problems, and (optionally) S/4HANA compatibility.

## Running ATC

With an ABAP file open, use any of these methods:

- **Keyboard:** `Ctrl+Shift+F2`
- **Command Palette:** `ABAP FS: Run ABAP Test Cockpit`
- **Copilot chat:** *"Run ATC on this file"*

Findings appear immediately as colored underlines in the editor, and in the **ATC Findings** panel (Activity Bar → ABAP FS → ATC Finds).

## Working with Results

Click any finding in the ATC panel to jump to the affected line. From there you can:

| Action | How |
|---|---|
| Read check documentation | Click **Show documentation** on the finding |
| Apply a quick fix | Click the lightbulb / use `Ctrl+.` on the underlined code |
| Get an AI-suggested fix | Ask Copilot: *"Fix this ATC finding"* |
| Request an exemption | Right-click a finding → **Request exemption** (single or bulk) |
| Hide exempted findings | Toggle **Filter exempted** in the panel toolbar |
| Re-run after saving | Toggle **Auto-refresh** in the panel toolbar |

## Enhancement Decorations

When viewing standard SAP code, 🎯 markers show where customer enhancements (BADIs, implicit enhancements, etc.) are active. Hover for details, or click the link to open the enhancement source directly.

## Configuring the Check Variant

The check variant controls which rules ATC applies — just like choosing a variant in transaction `ATC` or SE80. To set a default variant per connection:

1. Open **ABAP FS: Connection Manager**
2. Edit the connection
3. Set the **ATC Variant** field (e.g., `DEFAULT`, `S4HANA_READINESS`, or your custom variant)

Or add it directly to `settings.json`:

```json
"atcVariant": "S4HANA_READINESS"
```

## S/4HANA Migration Workflow

To check custom code for S/4HANA compatibility, set the variant to `S4HANA_READINESS`. ATC will then flag removed APIs, changed interfaces, and deprecated features on every run.

Recommended workflow:

1. Use the [S/4HANA Readiness Dashboard](../developer-tools/s4hana-readiness.md) to identify all affected objects
2. Open each object and run ATC (`Ctrl+Shift+F2`) for detailed findings
3. Ask Copilot to fix the flagged issues based on the ATC documentation
