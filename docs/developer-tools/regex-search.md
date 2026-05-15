# Regex Search in Code

Search ABAP source code using plain text or regular expressions (regex). Regex is a pattern language that lets you match variable text — for example, finding any method name that starts with "get", or any word boundary match.

> **Note:** This searches **committed code only**. Unsaved local edits are not visible — use the standard VS Code search (`Ctrl+Shift+F`) for those.

---

## How to Search

Just ask Copilot in plain language:

- *"Find all usages of COMMIT WORK in ZCL_MY_CLASS"*
- *"Search for methods matching 'get_\*' in ZREPORT_ORDERS"*
- *"List all methods in CL_SALV_TABLE"*

Copilot determines whether to use literal or regex matching automatically.

---

## Literal vs. Regex Mode

| Mode | When to use | Example |
|------|-------------|---------|
| **Literal** (default) | Exact text match, fast | `COMMIT WORK` |
| **Regex** | Patterns, wildcards, boundaries | `METHOD.*get` |

### Common Regex Patterns

| Pattern | What it matches | Example |
|---------|-----------------|---------|
| `\bICT\b` | Whole word `ICT` only (not `DICT`) | Word boundary |
| `METHOD.*restrict` | `METHOD` followed by anything then `restrict` | Pattern match |
| `[A-Z]+` | One or more uppercase letters | Character class |
| `^\s*(CLASS-)?METHODS?\s+\w+` | Any method declaration | Class structure |

---

## Searching Multiple Objects

Use wildcard patterns to search across several objects at once:

- *"Find SELECT \* in all Z\* reports"* — searches up to 10 matching objects
- Copilot limits the scope automatically (1–10 objects) to keep results manageable

---

## Viewing Class Structure

To list all methods in a class with their line numbers:

- *"List all methods in ZCL_MY_CLASS"*

Copilot returns each method name and the line where it's declared — useful for navigating large classes.

---

## Extracting a Single Method

To see the complete code of one method:

- *"Show me the FACTORY method in CL_SALV_TABLE"*

Returns everything from `METHOD FACTORY.` to `ENDMETHOD.`, including interface method syntax like `IF_SALV_TABLE~FACTORY`.

---

## Context Lines

By default, Copilot shows 3 lines before and after each match. Ask for more or fewer:

- *"Find RAISE EXCEPTION in ZCL_ORDERS, show 5 lines of context"*
