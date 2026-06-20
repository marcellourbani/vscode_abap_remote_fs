# Virtual Tool Grouping Fix

VS Code has an experimental setting (`github.copilot.chat.virtualTools.threshold`) that collapses extension tools into virtual groups when their count exceeds a threshold. When active, Copilot often fails to discover these groups — making all 39 ABAP FS AI tools invisible and unusable.

ABAP FS detects this condition after your first SAP connection and prompts you to fix it.

## When the Prompt Appears

The check runs after you first connect to a SAP system (not at extension activation). It only fires when:

- The virtual tools threshold is greater than `0`
- AI models are available (GitHub Copilot is signed in and active)
- You haven't previously dismissed the prompt

A non-modal notification appears with three options:

| Option | Effect |
|---|---|
| **Disable & Reload** | Sets the threshold to `0` globally and in your workspace, then reloads VS Code |
| **Later** | Skips the prompt this session; asks again on next connection |
| **Don't Ask Again** | Permanently suppresses the prompt |

Choose **Disable & Reload** unless you have a specific reason to keep grouping enabled.

## Fixing It Manually

If you dismissed the prompt and AI tools are still not working:

1. Open Settings (`Ctrl+,`)
2. Search for `virtualTools.threshold`
3. Set `github.copilot.chat.virtualTools.threshold` to `0`
4. Reload VS Code (`Ctrl+Shift+P` → **Developer: Reload Window**)

## Why This Matters

ABAP FS registers 39 specialized tools covering object search, code reading, unit tests, SQL queries, transport management, and more. If Copilot cannot see these tools, all AI-powered features stop working. Setting the threshold to `0` disables grouping entirely and keeps all tools available.

> **Note:** This prompt only appears if the experimental grouping feature is active. Most users will never see it.
