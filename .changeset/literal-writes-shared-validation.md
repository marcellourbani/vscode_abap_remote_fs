---
"vscode-abap-remote-fs": patch
---

Enforce shared SQL input validation for direct MCP calls as well as Copilot preparation. Insert source replacement text literally and reject ambiguous matches after line-ending normalization. Decode all remote filesystem writes as UTF-8, including plain Uint8Array views. Return initialized language-server clients on the first lookup and share concurrent initialization so each connection gets one refresh timer, with handled and non-overlapping scheduled refreshes.
