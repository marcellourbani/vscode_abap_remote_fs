# Object Search

Search for ABAP objects by name — like the SE80 object search, but directly inside VS Code without opening SAP GUI.

## How to Search

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **ABAP FS: Search for object**
3. Enter a name pattern using wildcards (e.g. `ZCL_*`, `*USER*`)
4. Select one or more object types to filter results
5. Press `Enter` — results open in a quick-pick list for instant navigation

> **Tip:** Save your preferred object types as defaults so you don't have to re-select them every time.

## Wildcard Patterns

| Pattern | Matches |
|---------|---------|
| `ZCL_*` | All custom classes starting with ZCL_ |
| `*USER*` | Anything containing USER |
| `BAPI_MATERIAL_*` | All BAPIs starting with BAPI_MATERIAL_ |

## Supported Object Types

| Type | Description |
|------|-------------|
| `CLAS` | Classes |
| `INTF` | Interfaces |
| `PROG` | Programs / Reports |
| `FUNC` | Function Modules |
| `FUGR` | Function Groups |
| `TABL` | Database Tables |
| `VIEW` | Views |
| `DTEL` | Data Elements |
| `DOMA` | Domains |
| `TTYP` | Table Types |
| `DDLS` | CDS Views |
| `ENQU` | Lock Objects |
| `MSAG` | Message Classes |
| `DEVC` | Packages |
| `TRAN` | Transactions |
| `ENHC` / `ENHS` | Enhancement Implementations / Spots |
| `BADI` | BAdI Definitions |
| + 30 more | — |

> **Note:** Object types not natively supported by the extension open automatically in SAP GUI.
