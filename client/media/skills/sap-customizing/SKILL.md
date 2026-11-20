---
name: sap-customizing
description: Use for SAP Customizing and SPRO/IMG configuration tasks, including finding settings and their tables, reading or comparing entries, explaining configuration values, and creating, copying, editing or deleting supported entries. Also use for Customizing setup, updates and troubleshooting.
argument-hint: '[customizing topic or SPRO activity to investigate]'
user-invocable: true
disable-model-invocation: false
---

# SAP Customizing

## First Read This Entry Only

Do not open a companion file before the readiness check below. Reading every guide fills the context with unused instructions, increases cost, and can make the work less focused.

These are instructions for the assistant. The assistant checks readiness and reads the next file; the user carries out any installation or update.

## Compare the Two Options

Use this comparison to explain the choices to the user when setup is needed or they ask which approach to use. Be clear about the limits of both options.

| Question | Existing table-based method | New Customizing feature |
| --- | --- | --- |
| What can it do? | Find IMG settings, identify their tables, read values, and explain them | Find, describe, read, compare, and preview settings, plus supported configuration changes |
| Can it edit configuration? | **No. This method is read-only.** Any change must be carried out separately by the user in normal SAP maintenance | Yes, for supported settings, with permission, a mandatory dry run, and a check of the saved result |
| What setup is needed? | The usual SAP connection and read permissions; no extra Customizing service | The user installs the optional ABAP FS service in the chosen SAP system through the setup panel |
| How much assistant work is needed? | Usually much more: read table definitions, write queries, inspect intermediate results, and decide the next lookup | Usually much less for supported tasks: a few purpose-built tool calls return the useful results without exposing every intermediate lookup |
| What does that mean for cost and context? | More calls and more text to read usually mean higher model cost, more waiting, and a fuller context window | Usually lower model cost and less context used for the same supported task; the tools may still make several SAP requests internally |
| What is the trade-off? | More manual table lookups and queries, but useful without installation and for investigations not covered by the new tools | Fewer manual steps for common tasks, but installation, a matching version, and suitable SAP maintenance support are required |
| Does it handle every setting? | It can investigate settings readable through the general tools; it does not provide an editing path | No. Some settings, dependencies, and languages still need separate investigation or normal SAP maintenance |

**Explain to the user that setup is optional.** Without it, you can still investigate and explain configuration through the read-only method, but cannot make configuration changes through that method.

For supported work, prefer the new tools when they are ready. The old method is not an equally efficient alternative: its extra queries and intermediate results can make even a read-only task significantly more expensive. Explain this when the user is deciding whether setup is worthwhile, without promising a fixed saving.

For example, the old method may need separate lookups for the IMG activity, maintenance object, main and text tables, field definitions, and the settings themselves. A complete SPRO path can then require repeated tree lookups; the legacy guide describes roughly 10-15 queries for that part alone. This is an illustration, not a measured cost estimate. A search followed by Describe and a selected-entry read can cover common tasks in a few assistant calls, plus the required readiness check.

A reverse lookup from an exact table can be cheaper than a broad name search. The expensive case is following all the links back to a complete SPRO path, especially when several paths or missing links must be checked. The new tools do not guarantee that complete reverse path; use the read-only fallback for it only when the task actually requires it. Do not fetch a full path merely to make a straightforward field edit.

## Follow This Sequence

1. Establish the exact SAP connection and client. Reuse an explicit choice already made in this conversation. Ask if it is unclear; do not list systems when the choice is already known.
2. Call `abapfs_check_customizing_setup` for that connection. Read its result before deciding which guide to open. The check is read-only: it does not deploy anything. A connection or permission error is not proof that installation is missing.
3. If the result has `ready: true` and the user has not chosen the read-only method, read [the Customizing tools guide](./tools.md) with the file-reading tool and use the new tools. Do not also read the old method. If the user explicitly prefers read-only investigation, follow step 6 instead.
4. If the service is missing, outdated, or unavailable, explain the result and the two options to the user. If they have not already chosen an approach, ask whether they want guidance through setup or want to continue with read-only investigation. Wait for their choice before opening another guide.
5. If the user chooses setup or an update, read [the setup guide](./setup.md). Guide the user; do not perform setup yourself. Once the user reports completion, call the readiness tool again for the same connection. Read `tools.md` only after `ready: true`.
6. If the user does not want setup or chooses the read-only method, read [the table-based investigation guide](./legacy.md). Do not keep requesting installation or retry unavailable Customizing tools.

If the readiness tool itself is unavailable, say that readiness cannot be checked in this session. Offer the read-only method without claiming that the SAP service is absent. Read `legacy.md` only if that option is chosen.

## Fall Back Only When Needed

If the new tools cannot complete an investigation, explain the problem and use `legacy.md` for the actual read-only fallback. Do not read it just in case. A normal SAP validation, permission, or lock error is not permission to bypass the restriction.

If a write has already been submitted and its result is uncertain, check its run ID and current data before switching methods. The old method cannot repeat, finish, or replace a configuration write. It can only help investigate; any manual edit remains the user's separate SAP task.

## Rules for Every Path

- An investigation is not permission to change configuration. Confirm the intended entries, system, client, and requested change before writing.
- **A dry run is mandatory before every change.** Never skip it to save time or context. Inspect the complete proposed change before committing. A comparison or an earlier preview with different inputs does not replace it.
- Do not replace supported SAP maintenance with generated ABAP, SQL updates, or direct database changes when a tool is unavailable or refuses a change.
- Check the saved values after a change. A successful tool call alone is not enough.
- Keep unrelated entries and source configuration unchanged. Do not create test entries or transports without permission.
- Present business names, changed values, transport numbers, and useful SAP messages. Keep internal identifiers and large metadata dumps out of the explanation unless needed to diagnose a problem.
