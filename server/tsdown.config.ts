import { defineConfig } from "tsdown"

// tsdown build for the ABAP FS language server.
//   dist/server.js  (ESM, minified w/ keep_classnames; only `vscode` external)
// server/package.json is "type":"module", so server.js is ESM; vscode-languageclient
// launches it over IPC (ESM IPC launch is validated by the activation spike).
// Type-checking stays with `pnpm typecheck` (tsc --noEmit); tsdown/Oxc only strips types.

// Force the stable .js extension; under "type":"module" .js is ESM.
const outJs = () => ({ js: ".js" as const })

// Old Terser used `keep_classnames: true` (class names only).
const keepClassNames = { function: false, class: true }

export default defineConfig({
  entry: { server: "src/server.ts" },
  outDir: "dist",
  tsconfig: "tsconfig.json",
  format: "esm",
  platform: "node",
  dts: false,
  clean: true, // server/dist holds only server.js — safe to clean
  sourcemap: true,
  outExtensions: outJs,
  // Inline every dependency (vscode-languageserver, lodash, …); the server ships bundled.
  deps: { alwaysBundle: [/.*/] },
  // @abaplint-style constructor.name keying needs class names kept in compress AND mangle.
  minify: { compress: { keepNames: keepClassNames }, mangle: { keepNames: keepClassNames } },
  // ESM has no __dirname/__filename/require; inject them so bundled source keeps working.
  shims: true,
  inputOptions: { external: ["vscode"] },
  outputOptions: { codeSplitting: false }
})
