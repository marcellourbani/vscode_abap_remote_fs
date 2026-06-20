# Object Activation

Activation compiles your ABAP code and makes it executable — the equivalent of pressing the **Activate** button (or `Ctrl+F3`) in SE80/SE24.

> Unlike SE80, the extension auto-saves the file before activating, so you don't need a separate save step.

## How to Activate

| Method | Action |
|--------|--------|
| Keyboard shortcut | **Alt+Shift+F3** |
| Editor toolbar | Click the activation button (lightning icon) |
| On save | Automatic, if **Auto-activate on save** is enabled in settings |

## Mass Activation

When you edit an object that has related inactive objects (e.g. a program with includes, or a class with methods), the extension detects them automatically and shows a selection dialog:

1. A list of all inactive related objects appears, all pre-selected.
2. Deselect any objects you do **not** want to activate.
3. Confirm — all selected objects are activated together.

This mirrors the mass activation dialog in SE80 that appears when dependent objects are out of sync.
