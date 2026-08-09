# Recording a WebGUI Flow

Sometimes Copilot hits a screen it can't work out on its own — a control with no readable label, a sequence that depends on how your system is personalised, or a step that needs business judgement. When that happens it asks you to record the flow instead of guessing.

This is an escape hatch, not part of the normal workflow. Copilot should explore on its own first, and it's told not to ask you to record ordinary screens just to save itself effort.

## How to record

`Ctrl+Shift+P` → **ABAP FS: Record SAP WebGUI Flow**

1. Pick the SAP system when prompted. The command signs the browser in for you, so you start on the transaction rather than a logon screen.
2. Give the recording a short descriptive name, like `me21n-edit-po-item`. Existing recordings are never overwritten.
3. Microsoft Edge opens with the Playwright recorder attached. Perform the flow.
4. Close the recorder when you're done. The file opens in your editor automatically.

The result is saved to `recordings/<name>.recording.ts` in your test folder.

## Recording well

- **Record the smallest useful path.** One grid edit or one dialog is usually enough. Copilot should have told you exactly which interaction it needs.
- **Start from a fresh transaction, in English.** Accessible names are language-specific.
- **Avoid exploratory clicking.** Every click becomes generated code and adds noise for Copilot to filter out.
- **Use safe test data.** Never type passwords, secrets, or production personal data — it ends up in the file.
- **Stop before the destructive action** — Save, Post, Release, Delete, Approve — unless Copilot specifically asked for it. If it did, it should have told you so explicitly, and you should be on a system where changing data is fine.

When you're done, tell Copilot the path and describe what you were doing and anything ambiguous you noticed.

## What happens to it

A recording is **reference evidence, not a test**. Copilot reads it to understand the interaction order and the real control names, then writes those verified observations into the screen map and continues the phase it was in. It never runs the recording, never copies it into your test scripts, and never trusts the raw generated selectors — recorder output is full of session-specific IDs and positions that break on the next screen refresh.

Once the resulting test passes its first run, the recording has done its job and Copilot will offer to delete it.
