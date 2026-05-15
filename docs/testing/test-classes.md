# Create Test Classes

Add an ABAP unit test include to an existing class — the extension creates the skeleton and opens it in the editor.

## Requirements

- The target object must be a class (`*.clas.abap`)
- The class must already exist on the SAP system

## How to Create a Test Include

**Option 1 — Context menu**

Right-click the class file in the Explorer → **Create test class include**

**Option 2 — Command Palette**

1. Press `Ctrl+Shift+P`
2. Type `ABAP FS: Create test class include`
3. Press `Enter`

**Option 3 — Ask Copilot**

Open the Copilot chat and ask:

- *"Create test class for ZCL_MY_CLASS"*
- *"Add unit tests to ZCL_PRICING"*
- *"Set up testing for this class"*

## What Gets Created

- A test include linked to the main class
- A skeleton test class with `FOR TESTING` and `RISK LEVEL HARMLESS`
- The new include opens automatically in the editor

## Next Steps

After the include is created, add your test methods and run them with the [Run Unit Tests](unit-tests.md) command.
