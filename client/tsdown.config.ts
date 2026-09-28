import { defineConfig } from "tsdown"
import { cpSync, copyFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

// tsdown build for the ABAP FS extension client.
// Three ESM outputs (Oxc transform and minify in one Rust pass):
//   dist/extension.js      (main extension, minified w/ keep_classnames)
//   dist/jsWorkerEntry.js  (notebook JS worker, spawned by path — self-contained)
//   dist/runtime/index.js  (SAP testing runtime, UNMINIFIED, @playwright/test external)
// Every package.json is "type":"module", so these .js files are ESM at runtime.
//
// Type-checking stays with `pnpm typecheck` (tsc --noEmit); tsdown/Oxc only strips types.

const clientDir = resolve(fileURLToPath(import.meta.url), "..")
const at = (p: string) => resolve(clientDir, p)

// VS Code loads the bundle via import of a .js file ("main": "./client/dist/extension.js");
// under "type":"module" that .js is ESM. Force the stable .js extension.
const outJs = () => ({ js: ".js" as const })

// Old Terser used `keep_classnames: true` (class names only). Preserve class names through
// mangling; function names may still be mangled.
const keepClassNames = { function: false, class: true }
// @abaplint/core keys statement handlers on `handler.constructor.name`, so class names must
// survive BOTH the compressor and the mangler — mangle.keepNames alone is insufficient.
const minifyKeepClasses = {
  compress: { keepNames: keepClassNames },
  mangle: { keepNames: keepClassNames }
}

// --- asset copying ------------------------------------------------------------------------
// Drop debug sidecars (*.js.txt) + readmes from vendored trees, keep LICENSE/NOTICE.
const skipSidecarsAndReadme = (s: string) => !(basename(s) === "README.md" || s.endsWith(".js.txt"))
const skipReadme = (s: string) => basename(s) !== "README.md"

function copyDir(src: string, dest: string, filter?: (s: string) => boolean) {
  if (!existsSync(src)) throw new Error(`copy-assets: required source missing: ${src}`)
  // pnpm links deps as Windows junctions, which cpSync's `dereference` doesn't resolve.
  const realSrc = realpathSync(src)
  mkdirSync(dest, { recursive: true })
  cpSync(realSrc, dest, { recursive: true, force: true, dereference: true, filter })
}

// pnpm's node_modules is not flat, so vendored packages must be located by module resolution.
// Transitive packages resolve from their parent package rather than from the client.
function packageDir(pkg: string, from = at("package.json")): string {
  try {
    return dirname(createRequire(from).resolve(`${pkg}/package.json`))
  } catch {
    throw new Error(`copy-assets: cannot resolve package ${pkg} from ${from}`)
  }
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
  // The Playwright vendor config + globalSetup are built from templates/*.ts by their own
  // tsdown entries (below) into dist/vendor/*.js. Keep the boundary ESM so import.meta.dirname
  // works both when the source is tested and when Playwright loads the emitted config.
  mkdirSync(at("dist/vendor"), { recursive: true })
  writeFileSync(at("dist/vendor/package.json"), JSON.stringify({ type: "module" }) + "\n")
  // Real node_modules layout so Playwright's runner can require.resolve its worker entry.
  const nm = at("dist/vendor/node_modules")
  const playwrightDir = packageDir("playwright")
  const typesNodeDir = packageDir("@types/node")
  const sources: [string, string, (s: string) => boolean][] = [
    ["playwright", playwrightDir, skipSidecarsAndReadme],
    ["playwright-core", packageDir("playwright-core", playwrightDir), skipSidecarsAndReadme],
    ["@playwright/test", packageDir("@playwright/test"), skipSidecarsAndReadme],
    ["@types/node", typesNodeDir, skipSidecarsAndReadme],
    ["undici-types", packageDir("undici-types", typesNodeDir), skipReadme]
  ]
  for (const [pkg, src, filter] of sources) copyDir(src, resolve(nm, pkg), filter)
}

// `addWatchFile` keeps `--watch` honest (recopies on edits); `writeBundle` runs after the
// output is on disk.
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

// deps.alwaysBundle inlines every dependency (the VSIX ships no node_modules); only the
// host/spec-provided packages in each build's `external` stay external. The package script
// pre-cleans dist once, so each entry must leave outputs from the other entries intact.
const shared = {
  format: "esm" as const,
  platform: "node" as const,
  dts: false,
  clean: false,
  outExtensions: outJs,
  // ESM has no __dirname/__filename/require; inject them so bundled source keeps working.
  shims: true,
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
    inputOptions: { external: ["vscode", /^@playwright\/mcp(\/|$)/] },
    plugins: [copyClientAssetsPlugin]
  },
  {
    ...shared,
    entry: { jsWorkerEntry: "src/notebooks/jsWorkerEntry.ts" },
    outDir: "dist",
    tsconfig: "tsconfig.json",
    sourcemap: true,
    minify: minifyKeepClasses,
    inputOptions: { external: ["vscode", /^@playwright\/mcp(\/|$)/] }
  },
  {
    ...shared,
    dts: true,
    entry: { index: "src/services/testing/runtime/index.ts" },
    outDir: "dist/runtime",
    tsconfig: "tsconfig.json",
    sourcemap: false,
    minify: false,
    inputOptions: { external: ["@playwright/test", /^@playwright\/test(\/|$)/] },
    plugins: [copyRuntimeAssetsPlugin]
  },
  // Playwright vendor config + globalSetup: authored in templates/*.ts, emitted as ESM .js into
  // dist/vendor for the Playwright CLI to load directly. Playwright stays external (resolved from
  // the vendored dist/vendor/node_modules).
  {
    format: "esm" as const,
    platform: "node" as const,
    dts: false,
    clean: false,
    outExtensions: outJs,
    entry: { "vendor/playwright.config": "templates/playwright.config.ts" },
    outDir: "dist",
    tsconfig: "tsconfig.json",
    sourcemap: false,
    minify: false,
    inputOptions: { external: ["@playwright/test", "playwright", /^@playwright\//] },
    outputOptions: { codeSplitting: false }
  },
  {
    format: "esm" as const,
    platform: "node" as const,
    dts: false,
    clean: false,
    outExtensions: outJs,
    entry: { "vendor/sso-global-setup": "templates/sso-global-setup.ts" },
    outDir: "dist",
    tsconfig: "tsconfig.json",
    sourcemap: false,
    minify: false,
    inputOptions: { external: ["@playwright/test", "playwright", /^@playwright\//] },
    outputOptions: { codeSplitting: false }
  }
])
