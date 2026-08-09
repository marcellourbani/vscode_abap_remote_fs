# SAP Testing

SAP Testing turns Copilot into an SAP test engineer. Point it at an ABAP report or transaction and it reads the code, explores the screens in a real browser, designs a test plan, works out what data each test needs, writes automated tests that drive SAP WebGUI, runs them, and hands you a Word evidence report.

You don't write Playwright code, you don't install Node or npm, and you don't open a terminal. You talk to Copilot in chat and review what it produces.

!!! info "GitHub Copilot in VS Code only"
    SAP Testing is built on VS Code chat skills and agents. It is **not** available through the [MCP Server](../mcp-server.md) — so Cursor, Claude Code, Claude Desktop, and other MCP clients cannot use it yet. The rest of ABAP FS still works with those clients.

## What you get

| | |
|---|---|
| **A reviewed test plan** | One Markdown file per test case, plus a printable `_index.docx` case list you can hand to a business owner |
| **Automated tests** | Playwright specs that drive SAP WebGUI — no login code, no hardcoded material numbers |
| **Per-landscape test data** | The same test runs on DEV, QAS, and PRD; the data is resolved separately for each |
| **Evidence** | A Word report per program and system: pass/fail summary, every step with a screenshot, and the database checks that prove SAP really did what it said |

## Why it's built this way

A test that passes for the wrong reason is worse than no test. So the framework deliberately slows Copilot down: work is split into seven phases, each producing artifacts on disk, and three of them are checked by an independent reviewer agent before the work is allowed to continue. Copilot cannot skip ahead — the tools that build the test index and run the tests refuse to run until the earlier steps have genuinely been done.

The other consequence is that **every phase can run in its own chat**. The artifacts on disk are the handoff, not the conversation, so you can analyse a program today and design cases next week without losing anything.

## What to expect

Set your expectations before you start, because this is not a push-button that turns a program into a finished test suite.

ABAP is rarely simple. Even a modest report carries years of validations, defaults, enhancements, and special cases, and a lot of that logic is only obvious to someone who knows the business. Copilot reads the code carefully and the reviewer agents catch a great deal, but they will still miss things, misread intent occasionally, and get stuck on screens that need your knowledge.

What the framework genuinely gives you is a **fast, thorough first pass with a rigorous process around it** — the enumeration work nobody enjoys, done exhaustively, with the evidence to check it. What it needs from you is review at the checkpoints, especially the test plan in phase 3, and honest answers when it asks a question.

Treat the output as a draft by a capable new team member who has read all the code but has never run the business. Reviewed properly it saves an enormous amount of time. Accepted blindly it produces tests that look convincing and prove very little.

SAP Testing is also a new feature and still maturing. If something doesn't work or the automation can't drive a control, that's worth reporting rather than working around.

## Prerequisites

Before you start you need:

- **ABAP FS installed and connected** to your SAP system — see [Installation](../getting-started/installation.md). The connection must have both a `url` and a `client`.
- **GitHub Copilot** in Agent mode, on VS Code 1.105 or newer.
- **SAP WebGUI enabled** on the target system. Everything runs through the browser-based GUI; paths that only work in SAP GUI for Windows (Excel/OLE uploads, native file dialogs) can't be automated here and Copilot will mark them as such.
- **Microsoft Edge** installed. It is detected automatically; set `abapfs.testing.edgePath` if you keep it somewhere unusual or want to use another Chromium browser.
- **A system that is safe to test on.** Tests click real buttons in a real SAP system.

You do **not** need Node.js, npm, Playwright, or a browser download — the extension bundles the test runner and uses your installed Edge.

## Where to start

1. [Getting Started](getting-started.md) — enable the feature and run your first analysis in about five minutes.
2. [The Testing Workflow](workflow.md) — the seven phases, what you review at each one.
3. [Skills](skills.md), [Subagents](subagents.md), [Tools](tools.md) — what's inside the framework.
4. [Troubleshooting](troubleshooting.md) — when something goes wrong.

For internals — folder layout, the runtime API, quality gates, the data-resolution model — see the [Technical Reference](technical-reference.md).
