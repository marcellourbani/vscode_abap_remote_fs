# Getting Started with SAP Testing

Five steps. You only do steps 1–4 once.

## Step 1 — Create an empty folder

Create a folder anywhere on your machine to hold your test artifacts, for example:

```
C:\sap-tests
```

This is a normal folder you own. Everything Copilot produces — test cases, scripts, results, evidence reports — goes here, and you can put it under Git if you want to share the suite with your team.

## Step 2 — Enable the feature

`Ctrl+Shift+P` → **ABAP FS: Enable SAP UI Testing Features** → pick the folder you just created.

SAP Testing stays completely hidden until you do this. Choosing the folder is what switches on the testing skills, subagents, and tools — before that, none of them appear in Copilot chat.

ABAP FS also drops a few of its own files into the folder at this point. Leave them alone — see [About the files ABAP FS creates](#about-the-files-abap-fs-creates) below for what they are and why they matter.

## Step 3 — Add the folder to your workspace

After you pick the folder, VS Code shows a notification with an **Add to Workspace** button. Click it.

**This step matters** for two reasons:

- **Fewer interruptions.** Copilot can edit files outside the workspace, but VS Code asks you to approve every one of those edits. A single phase writes a lot of files, so you'd spend the session clicking Approve.
- **Working error detection.** The `tsconfig.json` ABAP FS puts in the test folder only takes effect when the folder is open in the workspace. That's what gives real IntelliSense and red squiggles while Copilot writes test scripts — which means Copilot catches its own mistakes as it writes instead of at run time.

You can also do it later with **File → Add Folder to Workspace**.

## Step 4 — Choose models for the subagents

`Ctrl+Shift+P` → **ABAP FS: Set Models for SAP Testing Subagents**.

A panel opens listing the nine subagents that SAP Testing delegates work to, each with a hint about the kind of model it needs. Pick a model for each and save. VS Code will ask you to reload the window.

**Do this even though the framework ships with defaults.** The defaults name specific models that may not exist in your Copilot subscription, and an agent whose model isn't available falls back to whatever your main chat is using — usually a premium model doing work that a cheap one handles fine, which gets expensive quickly across a long analysis.

The rough shape of a good configuration: small fast models for the mechanical workers (Code Grep, Source Download, Data Scout), and stronger models — ideally from a *different* family than your main chat model — for the three reviewers, since their whole job is to catch mistakes the main agent made. See [Subagents](subagents.md) for the full list.

If a model you picked later disappears from Copilot, ABAP FS tells you at startup and offers a **Configure Models** button.

## Step 5 — Start testing

Open Copilot Chat in **Agent mode** and type:

```
/sap-testing analyze report Z_MY_REPORT on DEV-100
```

`/sap-testing` is the only skill you need to remember. It's the entry point — it tells Copilot how the whole framework fits together and which of the other skills to load for whatever you asked for. Give it the ABAP object you want to test and the connection ID of the SAP system to use.

From there Copilot takes over: it downloads the source, reads it, and produces the first set of artifacts in your test folder. When it finishes a phase it tells you exactly what to say next, usually something like *"start a new chat and say: Explore the UI for Z_MY_REPORT on DEV-100"*.

You can follow that suggestion or just carry on in the same chat — both work. See [The Testing Workflow](workflow.md) for what happens in each phase and the trade-off between the two.

## About the files ABAP FS creates

Alongside your test artifacts you'll see a few files that ABAP FS manages itself — `tsconfig.json`, a `node_modules` folder, and (if you have the Playwright extension) `playwright.config.js` and `.sap-active-system`.

**Don't edit or delete them.** They're what gives Copilot real error-checking while it writes test scripts, and what lets the tests run without you installing anything. They point at the extension's own install path, so ABAP FS rewrites them on every startup and after every update — any change you make is overwritten. They're added to `.gitignore` automatically because they're specific to your machine.

If they do get deleted, nothing is lost: reload VS Code and ABAP FS recreates them.

## Optional: the Playwright sidebar

If you install Microsoft's **Playwright Test for VSCode** extension, you get the Test Explorer sidebar for browsing and running specs by hand, plus the trace viewer for debugging failures. ABAP FS adds the extra scaffolding that makes the sidebar work, and removes it again if you uninstall the extension.

It's genuinely optional — Copilot runs tests through ABAP FS's own tool either way, and that tool is given the target system as part of every run.

The sidebar has no way to pass that, so it has to be told in advance. That's what the **`SAP: <system>`** item in the status bar is for: it shows which SAP system the sidebar will run against, and clicking it (or running **ABAP FS: Select System for Playwright Sidebar**) lets you change it. Set it before running anything from the sidebar, or your tests will go to the wrong system.

The status bar item appears only while the Playwright extension is installed. If you never use the sidebar, you'll never see it and you can ignore this entirely.
