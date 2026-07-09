---
"vscode-abap-remote-fs": patch
---

Fix object creation forcing English master language. Created objects now use the connection's logon language instead of the hardcoded `"EN"` fallback in abap-adt-api's creation XML, so they can be created on non-English master systems.
