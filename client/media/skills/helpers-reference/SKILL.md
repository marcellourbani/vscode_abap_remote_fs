---
name: helpers-reference
description: Reference for the bundled SAP Testing runtime (SapSession, SapArtifacts, resolveTestData, buildFixture, format helpers), importable in specs as "@sap-testing/runtime". Use when the user asks how a helper works or why a capability seems missing. Load sap-webgui for rendering, locator, theme, iframe, and control-behavior guidance.
---

# Helpers Reference

For bounded, self-contained support work, use `sap-task-helper` with explicit inputs, allowed writes, and an output contract.

## Non-negotiable execution gate

Using a helper does not bypass the SAP Testing phase requirements. The `playwright_test` tool verifies required steps, artifacts, data caches, and script checks and **will reject the run** if any are missing, stale, incomplete, or unverified. A helper or escape-hatch workaround cannot bypass this validation.

## Why

Helpers are load-bearing. Every test in this project depends on them. A hidden bug here — a silent-swallow wait, a locator that matches the wrong element, a popup guard that dismisses a real error — makes hundreds of tests lie in unison. Treat this API like any other production dependency you can't patch yourself: understand it precisely, use it correctly, and know exactly what to do when it doesn't cover something.

**Read this before assuming a capability is missing.** The runtime is deliberately generic and fairly complete; most "I need a new helper" instincts are actually "I haven't found the right existing one yet."

Use this reference for runtime API contracts. For WebGUI rendering behavior, locator stability, accessible names, iframes, themes, dialogs, ALV, and uploads, load `sap-webgui`.

## Where this actually lives (important — read this first)

Unlike test artifacts, the runtime is NOT a file in the configured test folder or workspace. Only its `@sap-testing/runtime` API and type declarations are exposed; runtime implementation files cannot be read or edited from the workspace. See "When a capability is genuinely missing" below.

What you CAN see: the type declarations surfaced via `@sap-testing/runtime` (real IntelliSense/type-checking while you write a spec), and the method reference below (this file + `build-scripts` §2). Between the two, you should never need to guess a method's existence or signature.

## Standalone context rule

For a general API question, answer directly from this reference. If the user wants you to inspect, write, or fix a real test artifact, first complete the standalone bootstrap in the relevant phase workflow:

1. Call `get_test_folder` and use its returned absolute path as `<TEST_FOLDER>`.
2. Resolve the program/TC-ID from the request and artifacts under `<TEST_FOLDER>/tests/`; never depend on a prior chat.
3. Confirm the exact `connectionId` before any system-specific diagnosis.

For findings/code errors follow `analyze-and-plan`; for screen-map errors follow `explore-ui`; for test-case errors follow `design-cases`; for data-spec errors follow `define-data`; for data/cache errors follow `prepare-data`; for spec translation errors follow `build-scripts`; and for execution failures follow `run-scripts`.

## Modules

| Module                                                                     | Purpose                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SapSession`                                                               | Main class — actions + assertions for on-screen UI                                                                                                                                                                                                    |
| `SapArtifacts`                                                             | Verify AL11 files and capture spool text — **unverified against a real system, see `build-scripts` §2 before relying on either**. Jobs/IDocs/table rows are NOT covered here — use `## Post-test verification` (see `design-cases`) for those |
| `resolveTestData`                                                          | Reads `.data.md` + per-system cache at run time                                                                                                                                                                                                       |
| `buildFixture`                                                             | Deterministic Excel/CSV generator, powers `source: "generated"`                                                                                                                                                                                       |
| `padNumericId`, `stripLeadingZeros`, `relativeDate`, `isRelativeDateToken` | Pure formatting helpers                                                                                                                                                                                                                               |
| `parseFrontmatter`                                                         | YAML-frontmatter parsing shared by `.data.md` and `TC-*.md`                                                                                                                                                                                           |

All exported from the single specifier `@sap-testing/runtime` — see `build-scripts` for the full method reference and translation table from `.md` steps to calls.

### Dynpro-specific helpers (tabs, editable grids, technical-name fallback)

Three `SapSession` methods exist specifically for the ITS DOM patterns you hit on ME21N/MIGO/VA01/MB1B-class transactions. They are NOT one-off escape hatches — they encapsulate DOM traps that would otherwise force `sap.raw()`. Load `sap-webgui` before using them; that skill documents the underlying DOM contracts.

| Method                                                  | When to reach for it                                                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sap.clickTab(name)`                                    | Any dynpro tab strip (Delivery/Invoice, Conditions, Org. Data on ME21N; Where, Detail Data on MIGO; etc.). NEVER use `clickButton` on a tab — the ITS DOM contracts are different. |
| `sap.setGridCell(columnTitle, rowIndex, value)`         | Any editable ALV/table cell whose input has no accessible name (item-overview / posting tables). Handles BOTH WebGUI renderers (dynpro table control AND `CL_GUI_ALV_GRID`) and fires the commit the ALV grid needs to read the value — so never hand-roll a `raw()` `fill()` on a grid cell (it skips the commit and the cell reverts). Row index is 1-based; row 0 is the header row.  |
| `sap.setField(name, value, { technicalName: "EKORG" })` | Last-resort disambiguation when two visible fields share the same accessible name. The technical name (e.g. `EKORG`, `LIFNR`, `WERKS`) must be verified against ADT, not guessed.  |

If you find yourself considering `sap.raw()` for a tab click, an editable grid cell, or a duplicate-label field — stop and use these helpers instead. `sap.raw()` remains the correct answer for other genuinely uncovered patterns.

### Runtime-safety helpers (popups, dumps, session loss)

Three related mechanisms keep the test loud when SAP misbehaves. All are wired into every `guarded()` action — you rarely call them yourself.

| Mechanism                                  | Purpose                                                                                                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dismissKnownPopups` (auto)                | Curated allow-list of safe-to-dismiss dialogs (License, System messages, Multiple Logon, Copyright, Data Privacy, Password). Unknown dialogs are LEFT ALONE — including "Exit Document" ("Do you want to save?") which tests handle explicitly via `sap.clickButton("Yes"\|"No", { dialog: "Exit Document" })`. |
| `detectRuntimeError` (auto)                | Detects ABAP short dumps, ITS/ICM errors, and dropped-to-logon-screen states. Throws with `kind`, title, URL, body snippet.                                                 |
| `detectSilentBounce` (auto, from `openTx`) | SAP silently drops the user back to Easy Access (SAPMSYST/40 / S000) when a tx doesn't exist or the user lacks `S_TCODE`. `openTx` throws instead of silently continuing.   |
| `SapSessionOptions.extraInterrupters`      | Per-test additional interrupters — for program-specific "Reprint?" / "Continue with X?" popups your report shows.                                                           |
| `sap.expectNoRuntimeError()`               | Explicit dump-freedom assertion. Redundant most of the time (guarded already runs it) but useful as a post-condition after a long-running batch step.                       |

Failure messages are actionable and unique — treat them as diagnostic contracts:

- `openTx("...") silently bounced to SAPMSYST/40 (SAP Easy Access)` → tx doesn't exist in client / no `S_TCODE`.
- `Popup guard: recognised interrupter "X" but could not click its "Y" button` → SAP version has a different button label; add `extraInterrupters`, don't disable the guard.
- `SAP runtime error detected (dump|its|logon): "..."` → real short dump / session loss / ITS error. Fix the SAP-side cause (ST22, SM21, SMICM) before touching the test.

Load `sap-webgui` for the full popup allow-list, dialog DOM contracts, and dump-signature list.

## The "guarded" pattern

Every `SapSession` action goes through:

```typescript
private async guarded(description, fn) {
  await dismissKnownPopups(...)   // before
  await fn()                      // the action
  await waitForServer(...)        // networkidle + WebGUI busy overlay gone
  await waitForDomStable(...)     // DOM mutations settled
  await dismissKnownPopups(...)   // after
  await detectRuntimeError(...)   // dump / ITS / logon — throws if hit
  await this.evidence.step(...)   // screenshot + record
}
```

Specs never call wait/screenshot/popup logic directly — this is exactly why a spec reads as clean SAP vocabulary (`sap.setField(...)`, `sap.clickButton(...)`) with no manual waits anywhere.

## Generic helper boundary

Method names describe SAP UI mechanics, never a business domain — `setField`, `pickFromValueHelp`, `verifyAL11FilePresent`, never `setMaterial`, `pickPlant`, `verifySalesOrder`. You cannot add methods to the runtime at all, so there is no way for business-specific logic to leak into it even by accident — it can only ever live in a `.md`/`.data.md`/`.spec.ts` file inside the test folder, which is exactly where it belongs.

## `resolveTestData` mechanics

- Signature: `resolveTestData(tcId, scope?)` — ALWAYS pass `scope` in a real spec (pass Playwright's `testInfo`, already available as the test function's second argument). Every program restarts TC numbering at TC-001, so without `scope` the lookup falls back to searching the entire `tests/` tree and can silently pick up a DIFFERENT program's `TC-001.data.md`.
- Reads `tests/<PROGRAM>/test-cases/<TC-ID>.data.md` frontmatter (`requires:` array).
- For each key, resolution order:
  1. env `TESTDATA_<TCID>_<SYSTEM>_<key>` (system-specific pin, preferred)
  2. env `TESTDATA_<TCID>_<key>` (cross-system pin, escape hatch)
  3. `source: "generated"` — built FRESH via `buildFixture()` on every call, never cached
  4. `tests/<PROGRAM>/test-results/<SYSTEM>/<TC-ID>/data.json` cache (from `prepare-data` — this is where `sql` and `seeded` values come from)
  5. `static` values inline in `.data.md`
- Any resolved value with `expect: "file"` (or `source: "generated"`, which implies it) is checked for existence and non-zero size before being returned.
- Throws with an actionable message if a required key can't be resolved — see `run-scripts`' diagnosis table for what each specific message shape means.

## `buildFixture` — deterministic file fixtures

Builds an `.xlsx` or `.csv` file from a declarative spec (columns, rows, `{{key}}` templating against already-resolved data, relative-date tokens like `today`/`+30d`/`-5d` resolved against the CURRENT time on every call). This is what `source: "generated"` in a `.data.md` compiles down to — see `define-data` for how to declare one (including matching the program's real file format). It stays pure spreadsheet/text mechanics with zero business logic; anything more elaborate than "substitute these cells" belongs in the `.data.md`'s declarative `args`, not something you can add to the builder itself.

## Format helpers

- `padNumericId(value, length = 18)` — ABAP ALPHA-conversion-style left-zero-pad for any numeric-string key (material, order, article, vendor, ...).
- `stripLeadingZeros(value)` — renders an internal-format key back to its short/external form.
- `relativeDate(token, format?, referenceDate?)` / `isRelativeDateToken(value)` — the same engine `buildFixture` uses internally, usable directly in a spec for a relative date without building a whole fixture file.

## When a capability is genuinely missing

This will happen occasionally — a SAP UI pattern the runtime doesn't have a clean method for. Two honest options, in order of preference:

1. **Use the escape hatch, in the spec, for this one case**: `sap.raw()` returns the real Playwright `Page`. Write the one-off interaction directly using role + accessible name (same selector discipline as everywhere else — no CSS classes, no positional guessing). This keeps the gap contained to one spec instead of blocking the whole test case.

   **`sap.raw()` returns the TOP-LEVEL Page — all SAP DOM lives inside the ITS iframe.** Every `sap.raw()` interaction or assertion MUST scope through the iframe first, or it queries an empty outer document and either times out or (worse) passes vacuously — e.g. an `expect(...).toBeHidden()` on an element that was never in scope. Use `sap.raw().frameLocator("iframe#ITSFRAME1").getByRole(...)`. Do NOT write `frameLocator("iframe")` alone — the page has TWO iframes (`ITSFRAME1` and `ITSTERMFRAME`) and the unqualified selector triggers a Playwright strict-mode violation. Only `#ITSFRAME1` contains the SAP content.

2. **Tell the user explicitly** that this is a bundled-runtime gap, not something fixable from the workspace — a new SAP Testing version is the only real fix. Do not quietly work around it in a way that looks like it solved the underlying problem (e.g. `page.waitForTimeout()` instead of a real wait condition) — that hides the gap instead of surfacing it.

Every use of `sap.raw()` is worth flagging to the user even when it works, since it's a signal about where the runtime's coverage actually ends.
