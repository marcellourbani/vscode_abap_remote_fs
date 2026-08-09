# SAP Testing Tools

These are the tools Copilot calls while working through the [workflow](workflow.md). You never invoke them yourself — they're listed here so you recognise the names when Copilot mentions one, and know what it just did.

They appear only when SAP Testing is [enabled](getting-started.md), and they sit alongside the [regular ABAP FS tools](../ai/language-model-tools.md) that Copilot uses for reading source and querying tables.

| Tool | What it does |
|---|---|
| `get_test_folder` | Returns your configured test folder. Copilot calls this before touching anything, and warns you if the folder isn't open in your workspace |
| `get_sap_webgui_url` | Builds a ready-to-open SAP WebGUI URL for a connection, already signed in, optionally landing on a specific transaction |
| `build_test_index` | Validates every test case file and rebuilds the case list — `_index.md` and the printable `_index.docx`. Refuses to run until the test plan reviewer has passed the plan |
| `build_test_index_docx` | Regenerates just the printable `_index.docx`, for when only the notes changed |
| `split_test_cases` | Splits one bulk-authored file into individual test case files, validating each before writing |
| `verify_test_data_usage` | Cross-checks a script against its data spec, so a script can't reference a value nobody defined |
| `check_test_data` | Pre-flight check: resolves every case's data for a program on a given system and reports what's missing — before you waste a test run finding out |
| `playwright_test` | Runs one test or a whole program's tests against a system. Signs the browser in, executes, and returns pass/fail plus paths to the screenshots and traces. Refuses to run until the earlier phases are genuinely complete |
| `build_evidence_report` | Builds the aggregated Word evidence report for a program and system from all the run results |
| `analyze_anst_enhancements` | Classifies an [ANST export](anst.md) and writes a work list beside it |

## Two tools that push back

`build_test_index` and `playwright_test` are deliberately gated: Copilot has to certify that the required review or readiness check actually happened before either will run. If Copilot tries to skip ahead, the tool rejects the call.

This is why you'll sometimes see Copilot go back and do something it seemed to have finished — the tool told it to. Details in the [Technical Reference](technical-reference.md#quality-gates).

## If Copilot says a tool is missing

VS Code doesn't always surface every tool to the model straight away, and `playwright_test` is the one that most often goes missing. Copilot is instructed to search for a tool by name before giving up, and to tell you rather than improvise — so if it reports a missing tool, that's a genuine report, not a mistake.

Starting a new chat usually clears it. What Copilot must never do is substitute a terminal command; there is no `npx playwright test` route here.
