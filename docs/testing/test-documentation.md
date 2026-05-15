# Test Documentation Generator

Generate a professional Word document from test screenshots — organized by scenario, with descriptions and a custom title. Useful for Playwright test reports, manual QA evidence, and sign-off documentation.

## How to Use

Open the Copilot Chat panel (`Ctrl+Alt+I`) and describe your scenarios with the full paths to your screenshots:

```
Create test documentation with these screenshots:

Scenario 1: Login Happy Path

- C:\tests\login1.png - Login page displayed
- C:\tests\login2.png - Successful login confirmed

Scenario 2: Error Handling

- C:\tests\error1.png - Invalid credentials message shown
```

Copilot calls the generator and saves a `.docx` file to your workspace.

## What the Document Contains

| Element | Details |
|---|---|
| Title | Custom report title (defaults to "Test Documentation Report") |
| Date | Test date in DD-MM-YYYY format (defaults to today) |
| Scenarios | Each scenario gets its own section with a name and description |
| Screenshots | Embedded images with per-screenshot captions |

## Tips

- Use **absolute paths** for screenshots (e.g. `C:\tests\...`), not relative paths
- You can include as many scenarios and screenshots per scenario as needed
- Specify a custom title or date in your prompt if the defaults don't fit: *"Use title 'Regression Test April' and date 30-04-2026"*
