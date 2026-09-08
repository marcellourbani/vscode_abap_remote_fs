# ABAP REPL

Run short ABAP snippets on a connected development or test system and view their output directly in VS Code.

## How It Works

Each time you run a snippet, the SAP-side REPL service:

1. Creates a temporary ABAP report with `INSERT REPORT`.
2. Compiles it with `GENERATE REPORT`.
3. Executes it with `SUBMIT` and captures the list output.
4. Deletes the temporary report immediately after execution.

The code runs on the selected SAP system under your own user and authorizations. It is not a local ABAP interpreter.

!!! warning "Development and test systems only"
    The REPL refuses to execute unless both SAP and ABAP FS identify the target as non-production. If the production status cannot be verified, execution is blocked.

## SAP-Side Setup

The REPL requires:

- Class `ZCL_ABAP_REPL`, implementing `IF_HTTP_EXTENSION`.
- Active SICF service `/sap/bc/z_abap_repl`, handled by `ZCL_ABAP_REPL`.
- `S_DEVELOP` authorization for the executing user.
- `S_ICF` access to the `z_abap_repl` service.

Run **ABAP FS: ABAP REPL Setup Guide** from the Command Palette for the class source and detailed SAP setup steps.

## Running Code

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run **ABAP FS: Execute ABAP Code**.
3. Read and accept the execution notice.
4. Select a connected SAP system.
5. Enter a snippet, such as:

```abap
WRITE: / 'Hello from ABAP'.
```

6. Run the snippet and review its output, errors, and execution time in the panel.

The panel checks that the REPL service is available before every execution. Only one snippet can run at a time, and each request has a 60-second timeout.

## Security and Auditing

- Executed code has the same authorization scope as your SAP user.
- Production clients are blocked.
- Every execution can be recorded in application log object `ZREPL`, subobject `EXEC`.
- Temporary reports are deleted after execution; no persistent code artifact is intentionally retained.
- The optional application log requires object `ZREPL` and subobject `EXEC` to be created in transaction `SLG0`.

Because this feature executes arbitrary ABAP on a live SAP system, review every snippet before running it.

## Removing the Service

Deactivate and delete SICF service `z_abap_repl`, then delete class `ZCL_ABAP_REPL`. No database or configuration tables are used by the REPL.