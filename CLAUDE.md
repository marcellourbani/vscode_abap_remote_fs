# ABAP FS Development Guidelines

Refer to [CONTRIBUTING.md](CONTRIBUTING.md) for full details on contributing to this project.

## Workflow
1. Use TDD where possible.
2. Maintain project structure (monorepo).
3. Run `npm run format` after any modification.
4. Ensure CI passing (Node 24).

## Constraints
- No dynamic imports.
- No external network calls (SAP systems only).
- Keep functions short and early returns preferred.
