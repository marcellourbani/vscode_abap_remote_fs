---
"vscode-abap-remote-fs": patch
---

Migrate the build system from Webpack to tsdown (Rolldown + Oxc under the hood).

The extension, notebook JS worker, language server, and SAP testing runtime now bundle with
tsdown. Behavioral contracts are preserved: CommonJS output, externals (`vscode`,
`@playwright/test`), the vendored Playwright `node_modules` layout, and `keep_classnames`
minification. No runtime behavior change; clean builds are dramatically faster and the
packaged VSIX is slightly smaller. Removes webpack, webpack-cli, ts-loader,
terser-webpack-plugin, and copy-webpack-plugin.
