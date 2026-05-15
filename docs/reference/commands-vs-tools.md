# Key Differences: Commands vs Tools

The extension exposes two types of functionality: **commands** you invoke yourself, and **tools** that GitHub Copilot invokes on your behalf.

## Commands — You invoke them

Commands are discrete actions you trigger directly in VS Code.

**How to run a command:**

- Open the Command Palette with `Ctrl+Shift+P` and type `ABAP FS`
- Click a button in the VS Code UI (e.g., editor toolbar, explorer context menu)
- Use a keyboard shortcut

**Examples:**

| Command | What it does |
|---|---|
| `ABAP FS: Create object` | Opens a dialog to create a new ABAP object |
| `ABAP FS: Run ABAP Unit Tests` | Runs unit tests for the current object |
| `ABAP FS: Text Elements Manager` | Opens the text elements editor |

## Language Model Tools — Copilot invokes them

Tools are capabilities the extension exposes to GitHub Copilot. You don't call them directly — instead, you describe what you want in the Copilot chat panel, and Copilot selects and calls the right tool automatically.

**How to use them:**

- Open the Copilot chat panel (`Ctrl+Alt+I`)
- Ask in plain language

**Examples:**

| What you type | Tool Copilot calls |
|---|---|
| "Where is `BAPI_USER_GET_DETAIL` used?" | `find_where_used` |
| "Show me the code for `ZCL_MY_CLASS`" | `get_abap_object_lines` |
| "Run ATC checks on this file" | `run_atc_analysis` |

> **New to VS Code?** Start with commands for direct actions. Use Copilot chat when you want to explore or analyze SAP objects without knowing the exact steps.
