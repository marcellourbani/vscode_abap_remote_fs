# Change Log

All notable changes to the "vscode-abap-remote-fs" extension will be documented in this file.

Format based on [Keep a Changelog](http://keepachangelog.com/)

## Unreleased

### Added

- keep open the source with the last unit test results if they failed
- warning for adding tasks to transports on change

## 0.5.18

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
