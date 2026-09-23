import { defineConfig } from "tsdown"
import { cpSync, copyFileSync, existsSync, mkdirSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// tsdown build for the ABAP FS extension client — replaces client/webpack.config.js.
// Three CJS outputs (Oxc transform + minify, one Rust pass — was ts-loader + terser):
//   dist/extension.js      (main extension, minified w/ keep_classnames)
//   dist/jsWorkerEntry.js  (notebook JS worker, spawned by path — self-contained)
//   dist/runtime/index.js  (SAP testing runtime, UNMINIFIED, @playwright/test external)
//
// Type-checking stays with `npm run typecheck` (tsc --noEmit); tsdown/Oxc only strips types.

const clientDir = resolve(fileURLToPath(import.meta.url), "..")
const at = (p: string) => resolve(clientDir, p)

// VS Code loads the bundle via require() of a .js file ("main": "./client/dist/extension"),
// so force .js — tsdown defaults CJS output to .cjs.
const cjsJs = () => ({ js: ".js" as const })

// Old Terser used `keep_classnames: true` (class names only). Preserve class names through
// mangling; function names may still be mangled.
const keepClassNames = { function: false, class: true }
// @abaplint/core keys statement handlers on `handler.constructor.name`, so class names must
// survive BOTH the compressor and the mangler — mangle.keepNames alone is insufficient.
const minifyKeepClasses = {
  compress: { keepNames: keepClassNames },
  mangle: { keepNames: keepClassNames }
}

// --- asset copying (replaces copy-webpack-plugin) -----------------------------------------
// Drop debug sidecars (*.js.txt) + readmes from vendored trees, keep LICENSE/NOTICE.
const skipSidecarsAndReadme = (s: string) => !(basename(s) === "README.md" || s.endsWith(".js.txt"))
const skipReadme = (s: string) => basename(s) !== "README.md"

function copyDir(src: string, dest: string, filter?: (s: string) => boolean) {
  if (!existsSync(src)) throw new Error(`copy-assets: required source missing: ${src}`)
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true, force: true, filter })
}
function copyFile(src: string, dest: string, optional = false) {
  if (!existsSync(src)) {
    if (optional) return
    throw new Error(`copy-assets: required source missing: ${src}`)
  }
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
}

function copyClientAssets() {
  if (existsSync(at("media"))) copyDir(at("media"), at("dist/media"))
  // documentationTool.ts reads this at runtime — fail the build if it's missing.
  copyFile(at("../DOCUMENTATION.md"), at("dist/media/DOCUMENTATION.md"))
  copyFile(at("templates/playwright.config.js"), at("dist/vendor/playwright.config.js"))
  copyFile(at("templates/sso-global-setup.js"), at("dist/vendor/sso-global-setup.js"))
  // Real node_modules layout so Playwright's runner can require.resolve its worker entry.
  const nm = at("dist/vendor/node_modules")
  for (const pkg of ["playwright", "playwright-core", "@playwright/test"]) {
    copyDir(at(`node_modules/${pkg}`), resolve(nm, pkg), skipSidecarsAndReadme)
  }
  copyDir(at("node_modules/@types/node"), resolve(nm, "@types/node"), skipSidecarsAndReadme)
  copyDir(at("node_modules/undici-types"), resolve(nm, "undici-types"), skipReadme)
}

// Reproduces copy-webpack-plugin; `addWatchFile` keeps `--watch` honest (recopies on edits),
// `writeBundle` runs after the output is on disk.
const copyClientAssetsPlugin = {
  name: "abapfs:copy-client-assets",
  buildStart(this: { addWatchFile(id: string): void }) {
    this.addWatchFile(at("media"))
    this.addWatchFile(at("../DOCUMENTATION.md"))
    this.addWatchFile(at("templates"))
  },
  writeBundle() {
    copyClientAssets()
  }
}
const copyRuntimeAssetsPlugin = {
  name: "abapfs:copy-runtime-assets",
  // index.js/index.d.ts resolve by convention for a plain require, but node16/nodenext
  // test-folder resolution needs a package.json to find `@sap-testing/runtime`.
  writeBundle() {
    copyFile(at("templates/runtime-package.json"), at("dist/runtime/package.json"))
  }
}

// @modelcontextprotocol/sdk imports sibling files with a .js suffix; allow .ts too.
const mcpJsResolve = { extensionAlias: { ".js": [".ts", ".js"] } }

// deps.alwaysBundle inlines every dependency (the VSIX ships no node_modules); only the
// host/spec-provided packages in each build's `external` stay external. clean:false because
// dist/runtime also holds tsc-emitted .d.ts and the npm script pre-cleans dist once.
const shared = {
  format: "cjs" as const,
  platform: "node" as const,
  dts: false,
  clean: false,
  outExtensions: cjsJs,
  deps: { alwaysBundle: [/.*/] },
  outputOptions: { codeSplitting: false } // single self-contained file per entry
}

export default defineConfig([
  {
    ...shared,
    entry: { extension: "src/extension.ts" },
    outDir: "dist",
    tsconfig: "tsconfig.json",
    sourcemap: true,
    minify: minifyKeepClasses,
    inputOptions: { external: ["vscode", /^@playwright\/mcp(\/|$)/], resolve: mcpJsResolve },
    plugins: [copyClientAssetsPlugin]
  },
  {
    ...shared,
    entry: { jsWorkerEntry: "src/notebooks/jsWorkerEntry.ts" },
    outDir: "dist",
    tsconfig: "tsconfig.json",
    sourcemap: true,
    minify: minifyKeepClasses,
    inputOptions: { external: ["vscode", /^@playwright\/mcp(\/|$)/], resolve: mcpJsResolve }
  },
  {
    ...shared,
    entry: { index: "src/services/testing/runtime/index.ts" },
    outDir: "dist/runtime",
    tsconfig: "tsconfig.runtime.json",
    sourcemap: false,
    minify: false,
    inputOptions: { external: ["@playwright/test", /^@playwright\/test(\/|$)/] },
    plugins: [copyRuntimeAssetsPlugin]
  }
])
