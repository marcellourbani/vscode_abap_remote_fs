# ABAP FS

ABAP FS is a Visual Studio Code extension for ABAP development with AI assistance. It connects to an SAP system through the ABAP Development Tools (ADT) REST interface and gives both the developer and the AI assistant direct access to the live system over that connection.

For the developer, it presents the repository as a file system inside the editor, so ABAP objects can be browsed, edited, activated, tested, and debugged without leaving VS Code.

For the assistant, it provides a set of tools covering the same ground: searching the repository, reading and editing source, following where-used references, querying tables, running unit tests and ATC, and examining dumps, traces, and transports. GitHub Copilot uses these tools directly, and other assistants reach them through a local Model Context Protocol (MCP) server. Because the assistant works from the system itself rather than from general knowledge of SAP, it can reason about custom code, actual function signatures, and real data.

This project is a community alternative to [SAP's official ADT for VS Code extension](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode) and is not affiliated with or endorsed by SAP.

Full documentation is published at [marcellourbani.github.io/vscode_abap_remote_fs](https://marcellourbani.github.io/vscode_abap_remote_fs/).

## Requirements

- VS Code 1.105 or later, or a compatible editor such as VSCodium, Cursor or SAP Business Application Studio.
- An SAP system reachable over HTTP or HTTPS, with the ICF service `/sap/bc/adt` active in transaction SICF. See [Prerequisites](https://marcellourbani.github.io/vscode_abap_remote_fs/getting-started/prerequisite/).
- For writing to older systems (roughly anything earlier than NetWeaver 7.51), the [abapfs_extensions](https://github.com/marcellourbani/abapfs_extensions) plugin must be installed on the development server. Browsing and reading work without it.
- For the AI features, [GitHub Copilot](https://github.com/features/copilot) is recommended. Other assistants are supported through the [MCP server](https://marcellourbani.github.io/vscode_abap_remote_fs/mcp-server/), with some features unavailable.

## Installation

1. Install [ABAP remote filesystem](https://marketplace.visualstudio.com/items?itemName=murbani.vscode-abap-remote-fs) (`murbani.vscode-abap-remote-fs`) from the Extensions view, or from a terminal:

   ```bash
   code --install-extension murbani.vscode-abap-remote-fs
   ```

2. Run **ABAP FS: Connection Manager** from the Command Palette and add a system (see [Connection Manager](https://marcellourbani.github.io/vscode_abap_remote_fs/getting-started/connection-manager/)): URL, client, user, and language. Connections can be stored in user or workspace settings. Passwords are kept in the operating system's credential store, not in settings files.
3. Run **ABAP FS: Connect to an SAP system** and select the system.

Once connected, the system appears in the Explorer and the ABAP FS views become available in the Activity Bar. A [walkthrough](https://marcellourbani.github.io/vscode_abap_remote_fs/getting-started/walkthrough/) is shown on first install and can be reopened at any time from **Get Started: Open Walkthrough**.

Most SAP-dependent features, including the AI tools, skills, and agents, stay hidden until at least one system is connected.


## AI assistance

### GitHub Copilot

With a system connected, Copilot in VS Code can search objects, read, edit and activate objects, run unit tests and ATC, query tables, analyse dumps and traces, inspect transports, and drive the debugger. Copilot decides when to use these [tools](https://marcellourbani.github.io/vscode_abap_remote_fs/ai/language-model-tools/) based on the question; no special syntax is needed. For example:

- "Where is `BAPI_USER_GET_DETAIL` used in custom code?"
- "Run ATC on `ZCL_PRICING` and explain the findings."
- "Which tables does this report update?"

The extension also provides:

- **[Skills](https://marcellourbani.github.io/vscode_abap_remote_fs/ai/skills/)**: reference material Copilot loads when relevant, covering Clean ABAP, performance on ECC and HANA, navigating customizing, and researching unfamiliar parts of a system.
- **[Subagents](https://marcellourbani.github.io/vscode_abap_remote_fs/ai/subagents/)**: task-specific agents, such as for discovery, reading, or code review, each of which can be assigned its own model.
- **[Heartbeat](https://marcellourbani.github.io/vscode_abap_remote_fs/ai/heartbeat/)**: an optional background service that watches for conditions such as new dumps or transport releases and reports them.
- **[SAP Testing](https://marcellourbani.github.io/vscode_abap_remote_fs/sap-testing/)**: a structured, multi-phase workflow in which Copilot analyses a report, designs test cases, automates them against SAP WebGUI using Playwright, and produces a Word evidence report. The phases include independent review steps, and the output is meant to be checked by someone who knows the business process.

### Other assistants

- **MCP server**: run **ABAP FS: Start MCP Server** to expose the same tools on a local port to Cursor, Claude Code, Claude Desktop, Windsurf, IBM Bob, and other MCP clients. VS Code must remain open, since it holds the SAP connection and hosts the MCP server. An API key can be configured, and the edit tool can be disabled for read-only access. See [MCP Server](https://marcellourbani.github.io/vscode_abap_remote_fs/mcp-server/).
- **Agent Chat (experimental)**: a chat panel inside VS Code for agents that implement the [Agent Client Protocol](https://agentclientprotocol.com), such as Claude Code, Codex, and Gemini CLI. ABAP FS starts the agent locally and gives it the same SAP tools. See [Agent Chat](https://marcellourbani.github.io/vscode_abap_remote_fs/agent-chat/).

Skills, subagents, and SAP Testing depend on VS Code chat features and are available only with GitHub Copilot.

## Development features

The list below is an overview. Each item is described in the documentation.

### Editing

- Browse packages and objects in the Explorer, or [search](https://marcellourbani.github.io/vscode_abap_remote_fs/object-management/search/) across object types by name.
- Edit source with [syntax checking](https://marcellourbani.github.io/vscode_abap_remote_fs/code-quality/syntax-validation/), completion, [hover information](https://marcellourbani.github.io/vscode_abap_remote_fs/editor/hover-information/), and navigation provided by a dedicated language server.
- [Activate](https://marcellourbani.github.io/vscode_abap_remote_fs/object-management/activation/) single objects or groups of related objects together.
- [Create](https://marcellourbani.github.io/vscode_abap_remote_fs/object-management/create/) programs, classes, interfaces, function groups, tables, CDS views, and other object types.
- Dedicated editors for [message classes](https://marcellourbani.github.io/vscode_abap_remote_fs/editor/message-class-editor/) and [HTTP services](https://marcellourbani.github.io/vscode_abap_remote_fs/editor/custom-editors/), and an [object property view](https://marcellourbani.github.io/vscode_abap_remote_fs/editor/object-property-view/).
- [Text element](https://marcellourbani.github.io/vscode_abap_remote_fs/developer-tools/text-elements/) maintenance, [favorites](https://marcellourbani.github.io/vscode_abap_remote_fs/object-management/favorites/), and an [ABAP REPL](https://marcellourbani.github.io/vscode_abap_remote_fs/developer-tools/abap-repl/).

### Quality and testing

- Run [ABAP Unit tests](https://marcellourbani.github.io/vscode_abap_remote_fs/testing/unit-tests/) and view the results in the VS Code Testing panel; generate [test classes](https://marcellourbani.github.io/vscode_abap_remote_fs/testing/test-classes/).
- Run [ATC checks](https://marcellourbani.github.io/vscode_abap_remote_fs/code-quality/atc-analysis/) with any available variant and read findings in the editor.
- Format code with [ABAP Cleaner](https://marcellourbani.github.io/vscode_abap_remote_fs/code-quality/abap-cleaner/).
- [Where-used analysis](https://marcellourbani.github.io/vscode_abap_remote_fs/code-quality/where-used/) for objects, methods, and variables, plus an interactive [dependency graph](https://marcellourbani.github.io/vscode_abap_remote_fs/developer-tools/dependency-graph/).

### Debugging and runtime analysis

- An [ABAP debugger](https://marcellourbani.github.io/vscode_abap_remote_fs/debugging/abap-debugging/) with breakpoints, stepping, call stack, and variable inspection.
- [Debug session recording](https://marcellourbani.github.io/vscode_abap_remote_fs/debugging/debug-recording/), with offline replay including stepping backwards. Recordings can be shared as files.
- [Runtime dump (ST22)](https://marcellourbani.github.io/vscode_abap_remote_fs/developer-tools/dumps-analysis/) and [performance trace](https://marcellourbani.github.io/vscode_abap_remote_fs/developer-tools/performance-traces/) analysis.
- A [feed reader](https://marcellourbani.github.io/vscode_abap_remote_fs/developer-tools/feed-reader/) for system events such as dumps and ATC results.

### Transports and version control

- A [transport view](https://marcellourbani.github.io/vscode_abap_remote_fs/transport/request-view/) for browsing, comparing, and releasing requests.
- Object [revision history](https://marcellourbani.github.io/vscode_abap_remote_fs/version-control/revision-history/) and comparison between versions.
- A [blame gutter](https://marcellourbani.github.io/vscode_abap_remote_fs/version-control/blame-gutter/) showing who last changed each line, when, and under which transport.
- [abapGit](https://marcellourbani.github.io/vscode_abap_remote_fs/version-control/abapgit/) integration.
- [Side-by-side comparison](https://marcellourbani.github.io/vscode_abap_remote_fs/object-management/compare-systems/) of a single object between two systems.

### Repository comparison

A persistent workflow for comparing a scoped set of objects, potentially thousands, between two connected systems. It records which objects exist on each side, downloads and compares their source locally, exports the results, and can prepare a reviewed plan for applying selected differences. Discovery and comparison never modify either system; applying changes still goes through normal save, transport, and activation. See [Repository Comparison](https://marcellourbani.github.io/vscode_abap_remote_fs/repository-comparison/).

### Data

- Run [ABAP SQL queries](https://marcellourbani.github.io/vscode_abap_remote_fs/data-query/sql-query/) and view the results in a sortable, filterable grid, with export to Excel or CSV.
- [SAP Data Workbooks](https://marcellourbani.github.io/vscode_abap_remote_fs/data-query/data-workbooks/) (`.sapwb`): notebooks combining ABAP SQL, JavaScript, and Markdown cells for multi-step analysis.

### SAP GUI

- [Run transactions](https://marcellourbani.github.io/vscode_abap_remote_fs/sap-gui/run-transaction/) in an [embedded WebGUI](https://marcellourbani.github.io/vscode_abap_remote_fs/sap-gui/embedded-gui/), in the [desktop SAP GUI](https://marcellourbani.github.io/vscode_abap_remote_fs/sap-gui/native-gui/), or in an [external browser](https://marcellourbani.github.io/vscode_abap_remote_fs/sap-gui/web-browser-gui/).

### Diagnostics

- An [ADT communication log](https://marcellourbani.github.io/vscode_abap_remote_fs/developer-tools/communication-log/) that records the HTTP traffic between VS Code and SAP, useful when something does not behave as expected.

## Things to know before you start

- **You are working on a live system.** Activation, unit tests, and test automation all run on the connected system. Use a development or sandbox system unless you have a specific reason not to.
- **Saving writes to SAP.** Every save of an ABAP object, including a save triggered by VS Code's auto save, writes the source to SAP. The extension turns auto save off for ABAP files by default, but a user or workspace setting can turn it back on.
- **AI edits are written immediately.** When an assistant edits ABAP source, the change is saved to SAP as an inactive version straight away, before you choose Keep or Undo. Undo reverts it on the server.
- **Production safeguards.** On production systems the extension asks for confirmation before passing query results to an AI assistant and before starting a debug session.
- **AI output needs review.** The tools give an assistant accurate information about the system, but the assistant can still misunderstand intent. Review generated code and changes as you would a colleague's.
- **Older systems.** Some features rely on ADT services that are missing on older releases. Where possible the extension falls back to an alternative: transport information is read directly from the transport tables, and text elements are maintained through SAP GUI.
- **Source search reads the server.** Searches run by AI tools see the source saved on SAP, not unsaved changes in open editors.

See [Important Considerations](https://marcellourbani.github.io/vscode_abap_remote_fs/reference/important-considerations/) for more.

## Privacy

The Marketplace build sends no telemetry and makes no network calls other than to the SAP systems you configure and the AI services you choose to use. Basic usage counts are written to a local CSV file, which can be deleted at any time. See [Privacy and Telemetry](https://marcellourbani.github.io/vscode_abap_remote_fs/reference/privacy-telemetry/).

## Deploying in an organization

Organizations that distribute the extension internally can build their own package with a system whitelist restricting which SAP systems users may connect to, and optional Azure Application Insights telemetry under their own control. See the [Organization Administration Guide](docs/reference/org-admin.md).

## Building from source

The repository is a pnpm monorepo:

```text
client/            VS Code extension
server/            Language server
modules/
  abapObject/      ABAP object type definitions
  abapfs/          Virtual file system
  sharedapi/       Types shared between client and server
docs/              Documentation site sources
```

To build and test:

```bash
pnpm install
pnpm build
pnpm test
```

To package a VSIX and install it:

```bash
pnpm package
code --install-extension vscode-abap-remote-fs-<version>.vsix
```

`pnpm package` runs the full build before packaging. On Windows, `build-and-install.bat` packages and installs in one step. To run from source without packaging, press F5 in VS Code to start an Extension Development Host.

The documentation site is generated with MkDocs. With Python and [uv](https://docs.astral.sh/uv/) installed, `pnpm docs` serves it locally.

## Contributing

Bug reports, questions, and pull requests are welcome. Before starting on a feature, please check the documentation and open issues, since it may already exist or be in progress. Opening an issue to discuss an idea first is usually worthwhile. Conventions, build details, and the pull request process are described in [CONTRIBUTING.md](CONTRIBUTING.md). Security issues should be reported as described in [SECURITY.md](SECURITY.md).

## Acknowledgements

ABAP FS builds on a number of open-source projects, including:

- [Mermaid](https://github.com/mermaid-js/mermaid) (MIT): diagram rendering
- [Tabulator](https://github.com/olifolkerd/tabulator) (MIT): data tables
- [Cytoscape.js](https://github.com/cytoscape/cytoscape.js) (MIT): dependency graph
- [docx](https://github.com/dolanmiu/docx) (MIT): Word document generation
- [Application Insights for Node.js](https://github.com/Microsoft/ApplicationInsights-node.js) (MIT): optional organizational telemetry
- [GitLens](https://github.com/gitkraken/vscode-gitlens) (MIT): the `gitlens` blame render mode adapts styling patterns and defaults from GitLens
- [SAP Clean ABAP Style Guide](https://github.com/SAP/styleguides) (CC BY 3.0): source for the Clean ABAP skill

Complete license information is in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## License

MIT. See [LICENSE](LICENSE).
