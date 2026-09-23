import { defineConfig } from "tsdown"

// tsdown build for the ABAP FS language server — replaces server/webpack.config.js.
//   dist/server.js  (CJS, minified w/ keep_classnames; only `vscode` external)
// Type-checking stays with `npm run typecheck` (tsc --noEmit); tsdown/Oxc only strips types.

// VS Code / vscode-languageclient loads the server as a .js module; force .js over tsdown's .cjs.
const cjsJs = () => ({ js: ".js" as const })

// Old Terser used `keep_classnames: true` (class names only).
const keepClassNames = { function: false, class: true }

export default defineConfig({
  entry: { server: "src/server.ts" },
  outDir: "dist",
  tsconfig: "tsconfig.json",
  format: "cjs",
  platform: "node",
  dts: false,
  clean: true, // server/dist holds only server.js — safe to clean
  sourcemap: true,
  outExtensions: cjsJs,
  // Inline every dependency (vscode-languageserver, lodash, …); the server ships bundled.
  deps: { alwaysBundle: [/.*/] },
  // @abaplint-style constructor.name keying needs class names kept in compress AND mangle.
  minify: { compress: { keepNames: keepClassNames }, mangle: { keepNames: keepClassNames } },
  inputOptions: { external: ["vscode"] },
  outputOptions: { codeSplitting: false }
})
