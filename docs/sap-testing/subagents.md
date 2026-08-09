# SAP Testing Subagents

Copilot hands specific jobs to specialised subagents instead of doing everything itself. Each one starts with a clean context, does one job, and reports back once.

Two reasons this matters to you: **large enumerations stay complete** (a subagent counting 200 branches doesn't get lazy near the end the way a main chat running low on context does), and **cost** — mechanical work runs on cheap models while only the reviewers use expensive ones.

!!! note "Not the same as ABAP FS subagents"
    These are separate from the [general ABAP subagents](../ai/subagents.md) (`@abap-orchestrator` and friends), which are configured through chat and stored in your workspace. SAP Testing's subagents ship with the extension, are configured through a settings panel, and only exist when SAP Testing is enabled. You never call them by name — Copilot delegates to them.

## The nine subagents

### Workers

| Subagent | What it does |
|---|---|
| **Source Download** | Finds every include a program pulls in, recursively, and downloads one complete source snapshot |
| **Code Grep** | Counts and lists every message, branch, and authorization check in that snapshot — mechanically, with real line numbers |
| **Enhancement Research** | Finds customer enhancements (BAdIs, enhancement points, user exits) running inside the standard code a custom program calls, and explains each well enough to test it |
| **ANST Enhancement Analyser** | Reads an [ANST export](anst.md), classifies every entry, and researches the customer objects it found |
| **Data Scout** | Finds real values in a live SAP system that match a requirement — a valid material, an open purchase order, a plant with stock |
| **Task Helper** | A general-purpose helper for bounded, high-volume work the main agent doesn't want to spend its own context on |

### Reviewers

These are adversarial on purpose: their job is to catch what the main agent got wrong, and the work cannot proceed until they pass it.

| Subagent | What it checks |
|---|---|
| **Findings Reviewer** | Re-reads the ABAP source and challenges the phase 1 analysis — invented line numbers, missed messages or branches, wrong date formats, an understated case count |
| **Screens Reviewer** | Checks the screen map really describes the live browser UI and wasn't quietly derived from the ABAP source instead |
| **Test Plan Reviewer** | Reads the source again and challenges the test plan — missed cases, merged cases that should be separate, skipped categories, cases that change data but have no verification |

## Configuring models

`Ctrl+Shift+P` → **ABAP FS: Set Models for SAP Testing Subagents**

The panel lists all nine with a hint about the kind of model each needs, and a dropdown of the Copilot models available to you. Pick one for each, save, and reload the window when prompted.

Guidance that actually affects results:

- **Reviewers should be strong models from a different family than your main chat model.** A model reviewing its own family's work tends to agree with it. Independence is the point.
- **Workers should be small and fast.** Code Grep, Source Download, and Data Scout follow strict formats and use tools; they don't need reasoning power, and they run often.
- **Enhancement Research is the exception among workers** — it needs genuine reasoning, so give it something mid-tier rather than the cheapest option.

## Why you should configure this even though defaults exist

The bundled agent files name specific models. If those aren't in your Copilot subscription, the agent falls back to your main chat model — so a premium model ends up doing mechanical grep work, repeatedly, for the whole analysis.

Two things to know:

- **After an extension update**, ABAP FS re-applies your saved choices automatically (updates reset the bundled agent files) and asks you to reload the window.
- **If a model you chose disappears** from Copilot, you get an error notification at startup with a **Configure Models** button.
