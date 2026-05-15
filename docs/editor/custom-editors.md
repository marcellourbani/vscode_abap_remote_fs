# Custom Editors

ABAP FS provides custom visual editors for certain SAP object types. Instead of editing raw XML, you get a purpose-built UI tailored to that object.

Custom editors open automatically when you navigate to a supported object type. You can also open them manually via **Open With** (right-click the file in the Explorer).

## Supported Editors

### Message Class Editor (`*.msagn.xml`)

A table-based editor for SAP message classes (MSAG). Lets you add, edit, and delete messages without touching XML.

See [Message Class Editor](message-class-editor.md) for full details.

### HTTP Service Editor (`*.http.xml`)

A form-based editor for configuring SAP HTTP services (SICF nodes).

## Common Actions

| Action | How |
|--------|-----|
| Save changes | `Ctrl+S` |
| Switch to raw XML | Right-click file → **Open With** → **Text Editor** |
| Revert unsaved changes | `File` → **Revert File** |
