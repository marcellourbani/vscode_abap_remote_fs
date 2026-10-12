---
"vscode-abap-remote-fs": patch
---

`abapfs.startMcpServer` now returns the MCP server status (`isRunning`, actual `port`, `url`), also when the server is already running
