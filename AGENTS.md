# Agent Configuration for ABAP FS

Agents should prioritize the rules and conventions defined in [CONTRIBUTING.md](CONTRIBUTING.md).

## Critical Instructions

- ALWAYS run `pnpm format` before committing. If you're working on a feature or plan to make multiple edits, finish all your work and then format once. 
- VERIFY you are not leaving behind temporary files or session plans.
- RESPECT the project structure and monorepo boundaries.
- USE the specific tools available for ABAP research when needed.
- NEVER put system names, IDs, usernames, passwords, URLs, keys, token or any other sensitive info in code, comments, tests or anywhere else - use dummy values or examples only.

## Style Enforcement

- **JSON/JS/TS**: Formatted with Prettier (enforced in [.instructions.md](.instructions.md)).
- **Quotes**: Double quotes for JSON, as-needed for props.
- **Semicolons**: Removed.
