# Privacy & Telemetry

**This extension does not send any data to external servers.** Nothing leaves your machine.

## What is collected

A local CSV file records basic usage statistics — which tools and commands you use, and how many lines of code Copilot changed. This file is stored on your machine only and is never uploaded anywhere.

**File location:**
```
<VS Code Global Storage>/extension-path/telemetry-<date>.csv
```

You can delete these files at any time without affecting the extension.

## Central telemetry for organizations

If your organization wants to aggregate telemetry internally, you can fork the public repository, add your own Azure Application Insights connection string, build a custom VSIX, and distribute it. You retain full control over what is collected, where it is stored, and who can access it.
