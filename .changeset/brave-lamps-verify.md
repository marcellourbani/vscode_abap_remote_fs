---
"vscode-abap-remote-fs": patch
---

Editor activation no longer reports success when SAP keeps the object inactive, refuses to activate when the SAP source differs from the saved editor content, and activates class methods that SAP saved without listing them as inactive, instead of leaving their old code running
