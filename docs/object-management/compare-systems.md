# Compare Objects Across Systems

Compare the same ABAP object side-by-side between two connected SAP systems — useful for verifying transports, investigating system-specific behaviour, or checking what's in production before a deployment.

## Prerequisites

- At least 2 SAP systems connected in VS Code
- The object must exist in both systems

## How to Compare

1. Open or locate the ABAP object in the Explorer or editor.
2. Trigger the command using one of:
   - **Explorer:** right-click the file → **Compare With another SAP System**
   - **Editor:** right-click inside the file → **Compare With another SAP System**
   - **Command Palette** (`Ctrl+Shift+P`): `ABAP FS: Compare With another SAP System`
3. Select the target system from the quick pick list (shows only connected systems).
4. VS Code opens a diff view titled `OBJECT_NAME: DEV100 ↔ QA100`.

## Notes

- The diff opens as a standard VS Code side-by-side comparison — all editor shortcuts (e.g. `F7`/`Shift+F7` to jump between changes) work as normal.
- Path differences between SAP versions are handled automatically (`Source Code Library` for newer systems, `Source Library` for older ones).
- If the object does not exist in the target system, an error is shown.
