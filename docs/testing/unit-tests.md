# Run Unit Tests

Run ABAP unit tests directly from VS Code — no need to open SE80 or ADT.

## How to Run Tests

**Option 1 — VS Code Testing panel (recommended)**

1. Click the **beaker icon** in the Activity Bar (left sidebar) to open the Testing view.
2. Browse to your class or program in the test tree.
3. Click the **Run** (▶) button next to any test class or individual method.

**Option 2 — Command Palette**

1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS).
2. Type `ABAP FS: Run ABAP Unit Tests` and press `Enter`.

**Option 3 — Ask Copilot**

> "Run unit tests for ZCL_MY_CLASS"  
> "Run tests and fix any failures"  
> "Check if ZCL_PRICING tests pass"

## Results

Results appear in the **VS Code Testing panel** with:

| Info | Detail |
|---|---|
| Pass/Fail | Green ✓ / Red ✗ per test method |
| Test counts | Total, passed, failed |
| Execution time | Per method and total |
| Coverage | Test coverage percentage (when available) |

Failed tests show the error message inline — click a failure to jump to the relevant line.

## Compared to SE80 / ADT

| | SE80 / ADT | VS Code (ABAP FS) |
|---|---|---|
| Run tests | Menu → Unit Test | Beaker icon or `Ctrl+Shift+P` |
| See results | Dialog / tab | Native Testing panel |
| Copilot analysis | No | Yes — Copilot can explain failures and suggest fixes |
| Jump to failure | Manual | Click failure to navigate |

## Requirements

- The target object must contain ABAP unit test classes (`FOR TESTING`).
- You must be connected to the SAP system in VS Code.
