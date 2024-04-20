# Change Log

## [1.7.7] 2024-04-20

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
