> **⚠️ NOTE FOR REVIEWER:** This README is included for PR review purposes only.
> Please remove this file before merging — do not merge it into the main branch.

# Feature: INCLUDE Statement Ctrl+Click Navigation

## Summary

This PR adds **Ctrl+Click (Go to Definition)** support for `INCLUDE` statements in ABAP programs. When you Ctrl+Click on an include name, VS Code navigates directly to the included source file.

Before this change, clicking an include name did nothing — users had to manually search for the include in the file explorer. Now it works the same way as clicking a method or variable name.

## Demo

```abap
REPORT zmy_report.

INCLUDE zmy_top.           " ← Ctrl+Click on "zmy_top" opens the include
INCLUDE zmy_forms.         " ← works here too
INCLUDE zmy_events IF FOUND.  " ← IF FOUND variant supported
```

## What Changed

**3 source files touched** — 1 new file, 2 minimal edits. Zero new dependencies.

### 1. `client/src/adt/includes/definitionProvider.ts` (NEW — 75 lines)

The entire feature in a single file. Implements VS Code's `DefinitionProvider` interface.

**How it works:**

1. A regex detects `INCLUDE <name>.` lines (with optional `IF FOUND`, indentation, mixed case)
2. Validates the cursor is on the **name** token (not the `INCLUDE` keyword)
3. Calls `client.searchObject()` to find the object in SAP via ADT API
4. Tries `PROG/I` (include program) first, falls back to `PROG/P` (program)
5. Resolves the ADT URI to a VS Code filesystem path via `root.findByAdtUri()`
6. Returns a `Location` — VS Code opens the file

**Additional details:**

- **Caching**: Results are cached for 60 seconds to prevent duplicate SAP API calls (VS Code invokes `provideDefinition` multiple times per user interaction)
- **Singleton pattern**: Uses `private static _instance` / `static get()` — same as all other providers in the codebase
- **Silent failure**: If the include doesn't exist, nothing happens (no error popup)
- **Scheme guard**: Only activates on `adt://` URIs (SAP-connected files)

### 2. `client/src/adt/includes/index.ts` (+1 line)

Added barrel export:
```typescript
export { IncludeDefinitionProvider } from "./definitionProvider"
```

### 3. `client/src/extension.ts` (+7 lines)

Added import and registration, placed right after the existing `IncludeProvider` CodeLens block:
```typescript
import { IncludeProvider, IncludeDefinitionProvider } from "./adt/includes"

// ... inside activate() ...

sub.push(
  languages.registerDefinitionProvider(
    { language: "abap", scheme: ADTSCHEME },
    IncludeDefinitionProvider.get()
  )
)
```

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Client-side provider (not server-side) | The language server's `findDefinition` calls ADT's navigation API, which doesn't resolve INCLUDE statements. A client-side `DefinitionProvider` supplements it. |
| `PROG/I` before `PROG/P` | Most includes are type `PROG/I` (include programs). Trying it first avoids an unnecessary API call for the common case. |
| 60-second cache | VS Code calls `provideDefinition` up to 5-7 times per click (hover, peek, go-to). Caching eliminates redundant SAP round-trips. |
| No new dependencies | Uses only existing imports: `vscode` (built-in), `../conections`, `../../lib`. |
| Additive only | Zero changes to existing code logic. Only added an import and a registration block. |

## What It Does NOT Change

- Existing Ctrl+Click on variables, methods, and classes (handled by the language server)
- The "Select main program" CodeLens on includes (handled by existing `IncludeProvider`)
- Any other extension behavior — tree views, syntax checking, SCM, etc.

## Regex Breakdown

```
/^\s*INCLUDE\s+([\w/]+)\s*(?:IF\s+FOUND\s*)?\.?\s*$/i
```

| Part | Matches |
|------|---------|
| `^\s*` | Leading whitespace (indented code) |
| `INCLUDE\s+` | The keyword + required space |
| `([\w/]+)` | The include name (captured) — letters, digits, underscores, slashes |
| `(?:IF\s+FOUND\s*)?` | Optional `IF FOUND` clause |
| `\.?\s*$` | Optional trailing period |
| `/i` | Case-insensitive |

## Test Results

| Test Case | Result |
|-----------|--------|
| Z-custom include (`ZAJE_079_TOP_V2`) | ✅ Navigates |
| SAP standard include (`SCHEDMAN_EVENTS`) | ✅ Navigates |
| Different Z-includes (`ZCFI_BULK_DATA_SCR`, `ZCFI_BULK_DATA_TOP`) | ✅ Navigates |
| Click on non-INCLUDE line | ✅ No action (correct) |
| Existing definition navigation (methods, variables) | ✅ Still works |
| CodeLens "Select main program" | ✅ Still works |

## Files Summary

```
Modified:  client/src/adt/includes/index.ts        (+1 line)
Modified:  client/src/extension.ts                  (+7 lines)
Added:     client/src/adt/includes/definitionProvider.ts  (75 lines)
```

**Total: 83 lines of code added, 0 lines removed, 0 dependencies added.**
