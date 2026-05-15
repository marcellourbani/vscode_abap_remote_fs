# Enhanced Hover Information

When you move your mouse cursor over ABAP code in the editor and pause, a popup appears with information about the symbol under the cursor. This is called a **hover**.

## How to trigger a hover

Move your mouse over any ABAP keyword, variable, system field, or object name and wait about 700ms (just under a second). The popup appears automatically — no click needed.

## What the hover shows

Depending on what you hover over, you may see:

| Symbol type | Information shown |
|---|---|
| System fields (`sy-subrc`, `sy-tabix`, etc.) | Plain-language explanation of the field's purpose |
| Built-in types | Type description and length |
| Variables and data objects | Type, length, and declaration context |
| Function modules | Parameter list (importing, exporting, exceptions) |
| Classes and methods | Signature and visibility |
| Other objects | Metadata from the SAP system |

## Configuration

The hover delay is configurable. If the popup appears too quickly or too slowly, search for `abapfs hover` in VS Code settings (`File → Preferences → Settings`) to adjust the delay.
