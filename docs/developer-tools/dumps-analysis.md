# ABAP Dumps Analysis

Analyze ST22 runtime dumps directly in VS Code — no SAP GUI required.

## What This Replaces

In SAP GUI, you'd use **transaction ST22** to find and read dumps. Here, the same data is available in VS Code with AI-powered root cause analysis and fix suggestions.

## Opening the Dumps Panel

**Activity Bar → ABAP FS icon → Dumps**

Or ask Copilot directly (see [Using Copilot](#using-copilot) below).

## Step-by-Step Workflow

1. **Open the Dumps panel** — the list shows each dump's ID, error type, timestamp, and size.
2. **Click a dump** to open the detailed view.
3. **Review the structured analysis** — the extension parses the raw HTML dump content and presents it in a readable format.
4. **Ask Copilot for help** — Copilot can identify the root cause and suggest a fix based on the dump data.

## Using Copilot

Type any of these in the Copilot chat:

| Prompt | What it does |
|---|---|
| `Analyze the latest dumps` | Lists recent dumps and analyzes the most recent one |
| `Show me dumps from today` | Filters to today's dumps |
| `What caused the RABAX error?` | AI root cause analysis on the current dump |
| `Analyze dump with ID xyz123` | Analyzes a specific dump by ID |

## Compared to ST22

| ST22 (SAP GUI) | VS Code Dumps panel |
|---|---|
| Manual navigation through raw HTML | Structured, parsed output |
| No AI assistance | Copilot explains cause and suggests fix |
| Separate tool from your editor | Inline with your code |
