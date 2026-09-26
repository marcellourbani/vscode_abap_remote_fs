// Empty stub used as the resolution target for the `vscode` module during
// `vitest run`. The vscode runtime API is only available inside the VS Code
// extension host; the unit tests provide their own factory via
// `vi.mock("vscode", () => ({...}))`. Vitest still needs `vscode` to resolve
// to *some* file before it can replace it with the test-supplied factory,
// hence this stub.
export {}
