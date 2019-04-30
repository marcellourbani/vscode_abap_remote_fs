# Change Log

All notable changes to the "vscode-abap-remote-fs" extension will be documented in this file.

Format based on [Keep a Changelog](http://keepachangelog.com/)

## Unreleased

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
