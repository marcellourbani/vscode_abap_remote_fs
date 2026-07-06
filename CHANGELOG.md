# Changelog

## 2.6.4

### Patch Changes

- 1d33325: add auto publish workflow
- 9547eac: improved ADT Communication log UX\

## 2.6.3

### Patch Changes

- c156559: Activate multiple includes of the same object without a dialog
- c7f12b6: fix issues #445 and #446 - fix text elements for non-English languages and honor protocol defined in connection config
- d1e5ea8: Show show blame button only in ABAP files

## 2.6.2

### Patch Changes

- 462f2cd: fix release workflow
- c026cf9: fix release workflow

## 2.6.1

### Patch Changes

- 532385b: add a workflow to release and publish new versions automatically

## 2.6.0

### Minor Changes

- 840044d: Add seach History in Search Object Panel and PopUp. Made Search object Panel more dense
- f0fa7fb: add extra auth methods

### Patch Changes

- df0c967: fix enhancements rendering and opening
- db6680a: fix subagents settings UX and spam notifications
- 1902196: Fix: BTP cloud connection wizard fails on production Steampunk systems (issue #385 )

## 2.5.0

### Minor Changes

- 94dd00e: Added an object type registry (registry.ts) and updated object creation / behavior (extensions, GUI routing, labels) to consult it instead of hardcoded switch/Maps/decorators

### Patch Changes

- eaef7e8: trim tool/field descriptions and outputs of tools to reduce AI cost
- e544b85: replace custom rap generator calls with adt ones
- a9f6db4: Refactor SAP GUI opening to a single entry point and button
- 1e1ee2c: added a status bar control for blame
- 123f333: remove unnecessary axios interceptors
- 2f9b5e2: Added new config to auto open xml objects in webgui
- 6a522c5: update dependencies

## 2.4.10

### Patch Changes

- fb69dc5: add a CI job to check for changesets in each PR - will rejects any PR without a changeset
- 0c3075b: enable activation tool for MCP
- 48d8fbe: Fix function module creation to use the provided function group parent instead of falling back to the current workspace hierarchy.
- 3f99f16: initialize MCP only after all tools are registered

All notable changes to ABAP Remote FS are documented here.

---

## 2.4.9 (2026-06-09)

- **MCP write support** — external AI tools can now edit ABAP source code and check syntax errors via the MCP server
- **Tool invocation guard** — AI language model tools are now protected against unauthorized calls, and improved security for MCP integrations as well
- **Version upgrade notification** — you'll now see a "What's New" prompt whenever the extension updates
- **Start MCP Server command** — new command to start the MCP server on demand, with smart detection of whether you even need it (asks to skip if Copilot is available)
- **Change Connection Password command** — quickly update your SAP connection password without forgetting and reconnecting
- **Smarter connection error handling** — friendly messages for authentication failures, unreachable systems, and missing config (auto-opens Connection Manager to help fix it)
- **AI tools hidden until connected** — language model tools are now hidden from Copilot when no SAP system is connected, saving tokens and reducing noise; the documentation tool remains always available
- **Improved AI tool grouping fix** — the virtual tools fix now triggers automatically after first connection with a non-blocking notification
- Removed MongoDB dependency for a lighter install footprint
- Fixed object activation failing silently in certain scenarios
- Fixed text elements command not working correctly
- Fixed unnecessary file system tree refreshes when navigating objects
- Fixed a race condition in the dependency graph webview initialization
- Removed dead code from AI tools for cleaner internals
- Documentation reorganized and published to GitHub Pages

## 2.4.8 (2026-05-13)

- Debugger reliability improvements — fixed thread handling, eliminated race conditions during attach, and improved error surfacing for more stable debugging sessions
- Fixed the AI-powered activate command — now returns specific per-object error details to Copilot
- Document outline and breadcrumbs now work for classes and interfaces (was previously excluded)
- Fixed multi-thread debugging — continuing one thread no longer incorrectly clears other stopped threads
- Fixed stuck debug sessions — extension now force-releases SAP debug attachment when step commands fail
- Fixed an issue where opening programs with local classes would cause errors

## 2.4.7 (2026-05-12)

- **S/4HANA Readiness Check view** — new dedicated view to analyze your custom code for S/4HANA compatibility issues, with "Ask Copilot to Fix" and "Open SAP Note" inline actions
- **Behavior Definition (BDEF) creation** — create RAP behavior definitions directly from VS Code
- **Service Binding toolbar** — Publish and Test buttons appear in the editor title bar when viewing service bindings
- **ATC documentation lookup** — AI can now fetch detailed SAP documentation for individual ATC findings
- Added Service Definitions, Service Bindings, and Behavior Definitions to object search
- Enhanced ABAP Test Cockpit integration with better AI tool support and configuration options
- Language support registered for `.asbdef` and `.srvdsrv` file extensions
- Better CDS navigation using dedicated source resolution endpoint
- Security dependency updates

## 2.4.6 (2026-04-30)

- **CDS Go to Definition** — navigate to data sources, fields, associations, and data elements directly from CDS views
- **CDS Find All References** — find where CDS entities are used across the project
- **CDS Hover Information** — hover over CDS entities to see type details and documentation
- CDS auto-completion now suggests all available fields when on empty lines inside select lists

## 2.4.5 (2026-04-29)

- **ABAP REPL** — new interactive Read-Eval-Print-Loop panel. Execute ABAP statements on the fly and see results immediately without creating test programs
- Improved reliability of object activation and transport operations

## 2.4.4 (2026-04-29)

- **Method signature autocomplete** — selecting a method from autocomplete now inserts a snippet with tab stops for all parameters, so you can jump between them with Tab
- **Signature Help** — typing `(` or `,` inside method calls now shows parameter names, types, and direction (importing/exporting/changing) with the active parameter highlighted
- Inline blame annotations now render directly in the editor gutter with a modern display style

## 2.4.3 (2026-04-28)

- **RAP Generator wizard** — Eclipse-style RAP business object generation from database tables, available from the editor context menu when viewing a table
- **Batch activation** — new "Load unactivated objects" command shows all inactive objects on the system and lets you select which to activate
- **Publish Service Binding command** — auto-detects the service binding from the active editor
- **Blame render modes** — new `abapfs.blame.renderMode` setting with "classic" and "gitlens" styles, plus 6 customizable theme colors for blame annotations
- Debug replay recordings now support `.abaprecord.gz` compressed format with compress/decompress commands
- SAP GUI transactions now open in the built-in browser by default (`abapfs.sapGui.useIntegratedBrowser` defaults to true)

## 2.4.2 (2026-04-15)

- **Object Search panel** — a new persistent search webview in the sidebar with object type filtering and system picker
- **Create Object wizard** — new "Create Object" command available in the explorer toolbar and context menu, with a full creation wizard
- **Document Symbol provider** — ABAP files now contribute outline symbols (classes, methods, data declarations, types, constants, field-symbols) to VS Code's Outline view, Breadcrumbs, and Go to Symbol

## 2.4.1 (2026-04-14)

- **ADT API Explorer** — new AI tool and skill for discovering and investigating SAP ADT REST API endpoints directly from VS Code
- **Auto-attach debugger** — if breakpoints are set for a connection, the debugger automatically attaches before launching SAP GUI transactions or programs
- **Object type filtering in AI tools** — `get_abap_object_info` now accepts an `objectType` parameter to narrow results; added ENHO and SUSO types to search
- Single-system notebooks now skip the system picker and show a confirmation dialog directly
- Switched to less intrusive notifications across the extension
- Stability and usability fixes for SAP Data Notebooks

## 2.4.0 (2026-04-06)

- **SAP Data Notebooks** — a brand-new notebook experience (`.sapwb` files) for running ABAP SQL queries and JavaScript processing side by side, with variable interpolation between cells and rich output rendering
- **Guided Walkthroughs** — 4 interactive step-by-step walkthroughs covering Getting Started, Views & Tools, AI Tools, and Advanced Features
- Walkthrough automatically shown on first install

## 2.3.0 (2026-04-06)

- **Automatic re-login on session expiry** — if your SAP session expires while saving, the extension now automatically re-authenticates, re-locks the file, and retries the write
- Overwrite confirmation dialog when remote object was modified during session gap
- Documents with unsaved local edits are no longer overwritten by server refreshes

## 2.2.4 (2026-04-04)

- Fixed frequent ABAP object lock conflicts that could block editing when multiple objects were open

## 2.2.3 (2026-04-03)

- **Object version history & compare** — view the change history of ABAP objects and compare versions side-by-side
- Function modules now show their type in the Object Property View
- Fixed unnecessary reloading when switching between objects

## 2.2.2 (2026-04-02)

- **Object Property View** — inspect ABAP object properties directly in VS Code
- **Virtual Tools Fix** — automatic one-time fix for VS Code's tool grouping that hides ABAP FS tools from Copilot
- Open transport requests and subtasks in SAP GUI directly from VS Code
- Added support for Authorization Object Sets (SUSO) in search
- Added SAP Customizing (SPRO) navigation skill for AI assistant
- Improved file system event batching for better performance

## 2.2.1 (2026-03-28)

- Security fix: MCP server now only listens on localhost and rejects unexpected cross-origin requests, preventing external access to your local development server

## 2.2.0 (2026-03-26)

- **ABAP Debug Replay & Recording** — record your debugging sessions and replay them later, including table variable captures. Review past debug steps without re-running the program

## 2.1.0 (2026-03-26)

- **ADT Communication Log** — view and monitor ADT HTTP communication in a dedicated panel, helping you troubleshoot connectivity and inspect server interactions
- Added support for Enhancement Hook (ENHO/XHH) object types

## 2.0.10 (2026-03-15)

- Fixed security vulnerabilities in dependencies
- Added toggle icon for Blame Gutter visibility
- Updated AI subagent templates with improved instructions

## 2.0.9 (2026-03-14)

- **Blame Gutter** — see who changed each line of ABAP code, directly in the editor (like GitLens for SAP)
- Keyboard shortcut `Ctrl+Alt+B` to toggle blame on/off
- Blame toggle button in the editor title bar
- Blame auto-hides when you start editing the file
- Output channel now supports VS Code's native log level filtering for easier troubleshooting

## 2.0.8 (2026-03-14)

- **Integrated browser for SAP GUI** — new `abapfs.sapGui.useIntegratedBrowser` setting to view SAP GUI directly inside VS Code
- **SAP System Personality Report** — AI can analyze and characterize your entire SAP system landscape
- 6 AI skills registered and auto-discoverable by Copilot: Clean ABAP, Code Writing, Performance (ECC), Performance (HANA), System Research, and System Personality Report
- AI activation tool now available regardless of which file is focused
- Fixed a lock race condition where rapid lock/unlock sequences could deadlock or leave objects in a broken state

## 2.0.7 (2026-02-25)

- Added upgrade notification to guide users to new v2 features
- Fixed subagent configuration to properly rotate between specialized AI agents
- Improved MCP server logging for troubleshooting

## 2.0.6 (2026-02-19)

- Re-enabled the AI activation tool so Copilot can activate ABAP objects after making changes

## 2.0.5 (2026-02-14)

- New keyboard shortcuts: `Ctrl+Shift+F11` for Run Unit Tests, `Ctrl+Alt+;` for ABAP Search
- AI now automatically activates inactive objects before running unit tests (prevents stale test results)
- Restored telemetry for usage insights

## 2.0.4 (2026-02-14)

- Fixed file locking behavior to prevent conflicts when editing ABAP objects

## 2.0.3 (2026-02-13)

- Packaging fix

## 2.0.2 (2026-02-13)

- **Documentation tool** — AI can now look up extension settings and help docs on your behalf
- New `abapfs.autoOpenUnsupportedInGui` setting — choose whether unsupported objects auto-open in SAP GUI or show a prompt
- Fixed "Where Used" analysis for Data Dictionary objects (falls back to table structure when source unavailable)
- Improved MCP API key setup guidance
- Removed the `abapfs.embeddedGui` settings block (replaced by simpler GUI configuration)

## 2.0.1 (2026-02-09)

- **Heartbeat** — AI continuously monitors your SAP system health and alerts you to issues. Configurable tasks (transports, dumps, jobs, IDocs, performance), custom intervals, active hours, and cooldown
- New settings: `abapfs.heartbeat.enabled`, `.every`, `.model`, `.prompt`, `.activeHours`, and more
- **SAP system timezone** — system info tool now reports timezone, UTC offset, and DST rules
- **MCP API key authentication** — `abapfs.mcpServer.apiKey` setting for Bearer token auth on MCP endpoints
- New `abapfs.localfs.preferGlobal` setting to share non-ABAP files across workspaces
- Improved security with SQL injection prevention and input sanitization

## 2.0.0 (2026-02-07)

- **Major release: AI-powered ABAP development** — complete overhaul with GitHub Copilot integration
- Added AI subagents: specialized assistants for code review, debugging, data analysis, documentation, visualization, and more
- Added MCP (Model Context Protocol) server for external AI tool integrations
- 36 AI language model tools available at launch — including debugger, data query, ATC checks, transport management, unit testing, where-used analysis, version history, trace analysis, dump analysis, Mermaid diagrams, and more
- Added interactive data query panel with spreadsheet-like results
- Added dependency graph visualization
- Added Mermaid diagram generation and viewing
- Added SAP GUI integration panel within VS Code
- Added ABAP Cleaner code formatting service
- Added text elements editor for managing translatable texts
- Added feed reader for SAP system notifications
- Added rich hover information for ABAP objects
- Added enhancement spot decorations in the editor

---

## 1.10.1

### Patch Changes

- d890582: integrate ai unit tests with vscode ui

## 1.10.0

### Minor Changes

- 9417148: add an unit test ai tool for copilot
- bc1bdf4: add support for extra storage in workspace (read only) and copilot instructions
- 1bf0e96: add an ai search tool for copilot
- 2e702c8: add an activation tool for copilot

## 1.9.0

### Minor Changes

- 0ba1178: Added progress bar to json exporte

## 1.8.0

### Minor Changes

- bd45791: add support for custom atc variant

### Patch Changes

- 55580f3: fix local objects from other users

## 1.7.20

### Patch Changes

- 3dbf859: improved reconnect after session expires
- 15bd5ee: Fix export to JSON of nested tables in debugger

## 1.7.20

### Patch Changes

- 15bd5ee: Fix export to JSON of nested tables in debugger

## 1.7.19

### Patch Changes

- 4106420: fixed bugs in language server introduced in last version
- 43ec40e: improved build : bump versions, removed superfluous files from package

## 1.7.18

### Patch Changes

- d9421f7: faster completion

## [1.7.17] 2024-10-30

### Added

- previous/next versions in diff

## [1.7.16] 2024-10-29

### Added

- toggle normalization in diff

## [1.7.15] 2024-10-27

### Added

- extract method

### Fixed

- reconnect expired sessions

## [1.7.14] 2024-10-23

### Added

- display performance traces

## [1.7.12] 2024-09-23

### Fixed

## [1.7.7] 2024-04-20

- workaround for broken function groups

### Fixed

- editing newly created FM

## [1.7.6] 2024-04-13

### Added

-export debug object as JSON

## [1.7.2] 2023-10-31

### Added

- filter changes in transport revisions

## [1.7.1] 2023-10-25

### Added

- query icon in table objects

## [1.7.0] 2023-10-25

### Added

- merge editor support

## [1.6.10] 2023-10-10

### Fixed

- replaced keytar with vscode secure storage

## [1.6.9] 2023-09-17

### Added

- activation suppot for xml files

### Changed

- extension for xslt transformations

## [1.6.5] 2023-08-09

### Added

- support local objects owned by others

## [1.6.4] 2023-02-19

### Fixed

- pragma positioning in ATC
- improved null checks

## [1.6.0] 2023-01-31

### Added

- native test API support

### Removed

### Test explorer support

## [1.5.3] 2023-01-09

### Fixed

- quickdiff

## [1.5.0] 2023-01-06

### Added

- filter exempted ATC results

## [1.4.6] 2022-05-23

### Fixed

- debudgger now properly shown as busy during steps

## [1.4.5] 2022-05-11

### Fixed

- improved language server error handling

## [1.4.4] 2022-05-04

### Fixed

- fixed bug in object path determination

## [1.4.3] 2022-05-03

### Fixed

- improved autologin

## [1.4.2] 2022-05-01

### Added

- tooltip in version lenses
- improverd session handling and locking

### Fixed

- test explorer in newer systems
- bug in debugger variables handling/evaluation
- fixed evaluation in debugger console

## [1.4.1] 2022-04-25

### Fixed

- debug breakpoint sync

## [1.4.0] 2022-04-25

### Added

- multi debugger threads
- proper support for jump to cursor
- jump to cursor bound to shift-f12, like sapgui

### Changes

- removed run to curson and go to cursor commands

## [1.3.3] 2022-04-12

### Fixed

- improved debugger session handling

## [1.3.2] 2022-03-09

### Added

- default ATC approver
- navigation in ATC documentation
- track editor changes dor ATC decorations

### Fixed

- some edge case in atc ignore

## [1.3.1] 2022-04-07

### Fixed

- decode details for ATC findings

## [1.3.0] 2022-04-07

### Added

- auto ignore ATC findings
- refresh ATC findings on activatioon

### Fixed

- manually enter ATC approver (might not exist in local system)

## [1.2.2] 2022-04-04

### Added

- object tooltip in ATC find

## [1.2.1] 2022-05-04

### Added

- ATC support in older systems

## [1.2.0] 2022-04-03

### Added

- Abap test cockpit support

## [1.1.0] 2022-02-28

### Added

- stateful session keepalive

## [1.0.0] 2022-02-17

### Changed

- replaced request with Axios based abap-adt-api

### fixed

- bug in include selection lens
- buumped a few dependencies

## [0.14.0] 2021-10-27

### Added

- rename support (thanks to Jakob Kjaer)

## [0.13.1] 2021-07-30

### Fixed

- unique terminal id per workspace
- change value of simple variables

### Added

- SY in debugger

## [0.13.0] 2021-07-30

### Fixed

- set/delete breakpoints while debugging
- debugger session handling bugs

### Added

- conditional breakpoints
- debugger jump to line
- debugger run to line

### Changed

- keymappings for sapgui integration

## [0.12.17] 2021-05-13

### Fixed

- bug in debugger session handling

## [0.12.16] 2021-05-13

### Fixed

- better debugger session handling (forbid multiple instances on same connection)
- fixed bug in debugger stack trace resolution

## [0.12.15] 2021-05-11

### Added

- refresh dumps
- navigate in dumps

## [0.12.14] 2021-05-09

### Added

- debug for other user
- terminal based debugging
- better handling of debugger sessions
- debugger keepalive
- security fixes (updated dependencies)

## [0.12.13] 2021-04-29

### Fixed

- [#156 improved debugger session handling](https://github.com/marcellourbani/vscode_abap_remote_fs/issues/156)

## [0.12.12] 2021-04-27

### Added

- Don't stop debugger when debuggee terminates
- kill debug session on error
- basic hover support

### Fixed

- preserve classnames for abaplint

## [0.12.9] 2021-04-21

### Added

- Debugging in windows
- dynamic debugger configuration (run and debug)

### Fixed

- small bugs which prevented activation of the plugin

## [0.12.0] 2021-04-20

### Added

- Debugging (only tested in Linux)

## [0.11.0] 2021-04-09

### Added

- Dumps view

## [0.10.4] 2021-04-07

### Fixed

- setup/teardown errors in unit tests are now reported

## [0.10.3] 2021-03-30

### Added

- placeholder for servers without abapgit backend, with link

### Fixed

- [#141 changes to sapgui connections while connected](https://github.com/marcellourbani/vscode_abap_remote_fs/issues/141)
- improved password deletion (cleanup cached value)
- [#124 spaces not allowed in config name](https://github.com/marcellourbani/vscode_abap_remote_fs/issues/124)

## [0.10.2] 2021-03-28

### Fixed

- [#150 report errors running unit tests](https://github.com/marcellourbani/vscode_abap_remote_fs/issues/150)
- better support for includes in unit tests
- graceful degradation in unit test reporting

## [0.10.1] 2021-03-27

### Fixed

- [#151 find references fails to complete](https://github.com/marcellourbani/vscode_abap_remote_fs/issues/151)

## [0.10.0] 2021-03-24

### Added

- webgui support

### Fixed

- [#148 create transport configuration when missing](https://github.com/marcellourbani/vscode_abap_remote_fs/issues/148)
- [#147 autologin,check if extenson is present](https://github.com/marcellourbani/vscode_abap_remote_fs/issues/147)

## [0.9.3] 2021-03-15

### Fixed

- clear cached git password on deletion
- #146 allow hyphen in condifuration wizard
- support SIA6 objects
- fixed extension for service definitions
- improved UX for query panel

## [0.9.2] 2021-02-20

### Fixed

- transport management for newer systems

## [0.9.0] 2021-01-28

### Added

- select query (thanks dh4rry)

## [0.8.13] 2020-11-10

### Fixed

- [[#131](https://github.com/marcellourbani/vscode_abap_remote_fs/issues/131)]
- [#138](https://github.com/marcellourbani/vscode_abap_remote_fs/issues/138)
- [#130 faforite expansion not working](https://github.com/marcellourbani/vscode_abap_remote_fs/issues/130)
- treat authorizations and data elements as readable objects

## [0.8.12] 2020-11-02

### Added

- create table
- create service definition
- display service definitions and bindings (as raw XML)

## [0.8.11] 2020-11-01

### Added

- connection creation command

## [0.8.10] 2020-10-23

### Added

- run console application

### Fixed

- package creation
- dependencies updates
- abapgit support for latest plugin

## [0.8.9] 2020-10-16

### Fixed

- Class hierarchy
- CI script

## [0.8.8] 2020-09-28

### Fixed

- password handling bug

## [0.8.7] 2020-09-23

### Added

- added ability to ignore transport validation

### Fixed

- small nullability/typing bugs
- fixed jest error when no connection set up
- improved build scripts

## [0.8.6] 2020-09-3

### Added

- Added HTTP services support

### Fixed

- fixed jest plugin configuration

## [0.8.5] 2020-08-25

### Added

- configurable diff formatter

## [0.8.4] 2020-07-14

### Fixed

- Missing text in unit test results
- maximum length check in object creation

## [0.8.3] 2020-05-26

### Fixed

- apply source fixes in the right include
- show errors in git scm commands

### Changed

- no automated code formatting on quickfix

## [0.8.2] 2020-05-17

### Added

- normalize diffs with AbapLint

### Changed

- refactor ABAP scm

### Fixed

- #120 objects not found in transports
- build modules before release

## [0.8.0] 2020-05-14

### Changed

- refactor all basic abap object and FS operation
- fixed most locking issues

### Added

- unit tests for some core functionality
- custom editor for message classes (readonly)

## [0.7.29] 2020-03-16

### Changed

- better UI for external transport validation

## [0.7.28] 2020-03-16

### Added

- override buttons in transport validation
- cancellation token in external API

### Fixed

- language functions for namespaced objects

## [0.7.27] 2020-03-14

### Added

- expose API for transport validation
- display and stage remotely changed files in abapGit

## [0.7.25] 2020-04-12

### Fixed

- test explorer bugs

## [0.7.24] 2020-04-12

### Added

- test explorer integraton

## [0.7.23] 2020-04-06

### Added

- help navigation (partial)

## [0.7.22] 2020-04-06

### Added

- connection folders in favourites

### Changed

- changed forward slash in nmespaces from uFF0F to u2215

### Fixed

- abapgit support for namespaced repos
- abapGit transport selection for older systems
- main program removed for CDS types
- censor password for git repo access
- no stat of locked files (should fix #88)
- switch abapgit branch (needs not yet merged support)

## [0.7.21] 2020-04-01

### Fixed

- create packages without parents

## [0.7.20] 2020-04-01

### Added

- abapGit pull from scm view
- reset git password
- reset tokens for oauth clients

## [0.7.19] 2020-03-31

### Added

- basic abapGit source control
- push changes to abapgit
- remember oauth tokens

### Fixed

- reveal abapGit repo without transport details
- error starting language client
- refactored login code and functions

## [0.7.18] 2020-03-23

### Added

- oauth2 login support (including sap cloud platform)

## [0.7.17] 2020-03-06

### Added

- field completion for CDS views
- data source completion for CDS views
- open git repository

## [0.7.16] 2020-02-03

### Added

- Reveal abapgit repo in explorer
- Reveal newly created package in explorer
- CDS syntax check

## [0.7.15] 2019-12-12

### Fixed

- bugs in descriptions with special characters

## [0.7.14] 2019-12-11

### Added

- abapGit view
- unlink git repo
- pull from git

### Fixed

- updated vulnerable dependency

## [0.7.13] 2019-12-05

### Added

- create and delete packages

### Fixed

- clean and postinstall scripts

## [0.7.12] 2019-09-19

### Fixed

- failure to expand program nodes

## [0.7.11] 2019-09-18

### Added

- optionally log API calls to mongodb
- optionally log HTTP calls to mongodb

### Fixed

- #90 overlapping syntax checks
- #91 overlapping completions
- #92 multiple API calls

## [0.7.10] 2019-07-21

### Added

- #84 password in secure store

## [0.7.9] 2019-07-13

### Fixed

- removed vulnerable dependencies

## [0.7.8] 2019-06-05

### Fixed

- Quickfix proposals for warnings
- no rename quickfix proposed (might reintroduce once rename is supported)
- Better handling of namespaced identifiers

## [0.7.7] 2019-06-04

### Fixed

- #86 create method definition dumps

## [0.7.6] 2019-05-23

### Fixed

- #82 error saving unchanged files

## [0.7.5] 2019-05-20

### Added

- hotkey for object activation (alt+shift+f3, like in SAPGUI)

### Fixed

- activation button for CDS
- syntax check for CDS
- completion for namespaced method calls

## [0.7.4] 2019-05-17

### Added

- better support for CDS syntax highlighting via CDS extension

### Changed

- extension for CDS objects

### Fixed

- build loop in webpack

## [0.7.3] 2019-05-11

### Added

- Copy transport number
- Open transport in sapgui

### Fixed

- #81 open sapgui in linux
- #80 transport revision terminates with an exception

## [0.7.2] 2019-05-06

### Added

- compressed with webpack

## [0.7.1] 2019-05-01

### Fixed

- some glitches in lock restoring/saving with expired locks
- bogus class hierarchy lenses
- won't try to load the transports for systems who don't support it

## [0.7.0] 2019-05-01

### Added

- #61 parent / child classes codelens
- #74 progress and error handling for transport object open

### Fixed

- #75 quirks in test class include

## [0.6.7] 2019-04-28

### Added

- abap documentation

### Fixed

- version links for new objects

## [0.6.6] 2019-04-28

### Added

- normalized diffs

### Changed

- logo

## [0.6.5] 2019-04-27

### Added

- open interfaces in sapgui

### Changed

- inline open original in diff view
- default to stateless connections
- debounce object locking
- queue all stateful calls

### Fixed

- lock restore based on all documents rather than visible ones

## [0.6.4] 2019-04-25

### Fixed

- fix open sapgui in windows

## [0.6.3] 2019-04-24

### Fixed

- retry lock on change
- better include resolution

## [0.6.2] 2019-04-23

### Added

- release subtasks before releasing main transport

### Changed

- rewrote locking
- refactored transport selection

### Fixed

- field symbols selection in syntax
- include resolution in error checks
- reference search in includes with namespaces #72
- improved transport selection
- fixed locking quirks #64
- fixed quirk saving newly created object

## [0.6.1] 2019-04-18

### Added

- codelens to select main program for includes

### Fixed

- revision selection in transport comparison
- use main program for includes syntax check
- use main program for reference search
- syntax errors reported in wrong include

## [0.6.0] 2019-04-09

### Added

- diff in transport view
- scm groups per transport
- revision codelens
- compare versions
- compare remote versions

### Changed

- some icons, borrowed from gitlens
- decentralised command definitions

## [0.5.27] 2019-03-30

### Added

- quickdiff

### Fixed

- better logging on connection failure

## [0.5.26] 2019-03-30

### Added

- revision history (incomplete)

## [0.5.25] 2019-03-30

### Added

- quickfix
- change user in transports view

### Fixed

- better completion of field-symbols

## [0.5.24] 2019-03-29

### Fixed

- completion list improved: mark as incomplete when completion list is long
- hidden irrelevant commands from palette

## [0.5.23] 2019-03-27

### Added

- delete transport
- reassign transport user
- release transport
- add user to transport

### Fixed

- transport selection order
- transports not expanden in view
- transport tasks

## [0.5.22] 2019-03-26

### Added

- transports view

## [0.5.21] 2019-03-24

### Added

- create class test include

### Fixed

- #56 create namespaced objects

## [0.5.20] 2019-03-20

### Fixed

- #48 lock status changed on stat
- race confition in read directory on reload/workspace changes

## [0.5.19] 2019-03-19

### Added

- keep open the source with the last unit test results if they failed
- warning for adding tasks to transports on change
- CDS support

## [0.5.18] 2019-03-16

### Added

- Abap Unit

### Changed

- delete favourites now displayed online
- only show delete favourite for those who can be deleted
- command descriptions - all starting with ABAPfs now

### Fixed

- #49 activation button not reset on activate

## [0.5.17] 2019-03-15

### Added

- progress notification for open file, activate, sapgui

## [0.5.16] 2019-03-14

### Added

- progress bar for where used list

### Fixed

- #50 completion with namespaces

## [0.5.15] 2019-03-13

### Added

- search progress, interruptable

### Fixed

- references for aliases
- references of plain methods
- build system

## [0.5.14] 2019-03-08

### Fixed

- language server in build

## [0.5.13] 2019-03-08

### Fixed

- completion order
- completion of field symbols

## [0.5.12] 2019-03-06

### Added

- Save on activate
- Show activate button on dirty documents

### Fixed

- quirks showing the activate button

## [0.5.11] 2019-03-06

### Added

- Pretty printer

## [0.5.10] 2019-03-05

### Added

- Class and interfaces outline

## [0.5.9] 2019-03-03

### Added

- favourites

## [0.5.8] 2019-02-27

### Fixed

- #33 unlocking files on transport selection
- #34 references resolution
- #35 error message on search cancel

## [0.5.6] 2019-02-25

### Fixed

- find objects in orphaned packages
- persist opened files on window refresh
- fixed bugs in find object definition
- abort search if no system selected

## [0.5.6] 2019-02-23

### Fixed

- Self signed certificates
- custom CA support

## [0.5.0] 2019-02-20

### Added

- split in subprojects to add a language server
- language server
- restore locks on extension restart
- warn of lock changes on disconnection
- syntax check
- code completion
- added dependency on ABAP language extension
- go to definition
- references (where used)

## [0.4.1] 2019-02-10

### Fixed

- refresh directory on creation

## [0.4.0] 2019-02-09

### Fixed

- multiple object activation
- transport detection on lock
- CDS extension support
- better transport selection
- cancel operation if transport not selected
- suffix instead of name for group includes

## [0.3.6] 2019-02-05

### Changed

- use abap-adt-api

### Added

- object deletions (no transport selection)
- self-signed certificates

## [0.3.5] 2019-01-26

### Fixed

- missing content-type header on create
- better display name

## [0.3.4] 2019-01-23

### Fixed

- missing content-type header on save

## [0.3.3] - 2019-01-19

### Added

- run programs, functions and classes in SAPGUI
- language and client login options

### Fixed

- object type names in 7.52
- no exception for unsupported objects in 7.52
- previous changelog entries

## [0.3.2] - 2018-12-18

### Fixed

- fixed infinite loop on 7.52 systems (#20)

## [0.3.1] - 2018-12-11

### Added

- partial abaplint support (not working for function modules)

## [0.3.0] - 2018-12-10

### Added

- Initial release to vscode marketplace
