### AI Subagents

**22 packaged agents:** 13 general ABAP agents plus 9 SAP testing agents. General agents are individually configurable; testing agents become available together when SAP Testing is ready.

**3 cost tiers:** Simple (cheap), Medium, Complex (premium).

**Setup:** Use **ABAP FS: Set Models for Subagents** or ask Copilot to use `manage_subagents`.
1. AI lists available models
2. Assigns models to selected agents
3. Enables selected general agents; testing agents follow the testing-folder state

> A general agent cannot be enabled until it has an available model. Testing agents require all nine models when the testing folder is ready.

Agent prompts are packaged with the extension. No `.github/agents/` files are created or managed by ABAP FS.
