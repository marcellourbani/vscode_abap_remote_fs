# SAP Testing Skills

Skills are instruction sets that Copilot loads when it needs them. SAP Testing adds twelve, and they appear in chat only after you [enable the feature](getting-started.md).

## The only one you need to know

```
/sap-testing
```

This is the entry point. It explains the whole framework to Copilot — the phases, the tools, the subagents, the rules — so Copilot works out which of the other skills to load for whatever you asked. You never have to choose.

Type `/` in the chat box to see every skill as a slash command if you want to invoke one directly, but for normal work `/sap-testing` plus a plain-English request is all it takes.

## Phase skills

One per phase of the [workflow](workflow.md). Copilot loads these automatically, and each is written to work standalone so a fresh chat can pick up from the files on disk.

| Skill | Phase | What it covers |
|---|---|---|
| `analyze-and-plan` | 1 | Downloading and reading the ABAP source, then writing down the program's flow, its routines' inputs and outputs, and every validation, message, branch, and authorization check it contains |
| `explore-ui` | 2 | Driving the live WebGUI in a browser and mapping every control by the label the automation will use, including the safety rules for anything destructive |
| `design-cases` | 3 | Turning the analysis into individual test cases with a full screen state, expected results, and the database checks that prove the case |
| `define-data` | 4 | Specifying what data each case needs as a reusable shape rather than fixed values, including upload file formats |
| `prepare-data` | 5 | Resolving those specs into real values from a specific SAP system, with your approval, and caching them per landscape |
| `build-scripts` | 6 | Converting each test case into an automated script, one to one, using only the bundled runtime |
| `run-scripts` | 7 | Running the tests, performing the post-run verification, building the evidence report, and diagnosing failures |

## Supporting skills

Loaded as needed alongside the phase skills.

| Skill | What it's for |
|---|---|
| `sap-webgui` | How SAP WebGUI actually renders — iframes, accessible names, selection screens, tab strips, editable grids, popups, and which locators are stable. This is what keeps the automation from breaking on the next screen refresh |
| `sap-webgui-recording` | When and how to ask you to [record a flow](recording.md) that Copilot can't explore on its own, and how to safely turn that recording into evidence |
| `helpers-reference` | The bundled test runtime's API — what each method does and what to do when a capability genuinely isn't there |
| `anst-guide` | Walking you through capturing an [ANST enhancement trace](anst.md) for a standard SAP transaction |
