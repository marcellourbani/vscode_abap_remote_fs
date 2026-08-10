/**
 * Owns everything the extension writes into the configured test folder.
 *
 * Two tiers, deliberately separated:
 *
 * 1. ALWAYS — `tsconfig.json` plus a `@sap-testing/runtime` junction. These give the
 *    editor's TypeScript language service real IntelliSense and type errors while the
 *    AI writes a spec (against the actual SapSession signatures, not prose in a skill),
 *    and let `playwright_test` resolve the runtime at run time.
 *
 * 2. ONLY WHEN Microsoft's Playwright extension is installed — `playwright.config.js`,
 *    `.sap-active-system`, junctions to the bundled Playwright, and a `.bin` launcher.
 *    These exist purely so the Playwright sidebar can discover and run specs. The
 *    `playwright_test` tool needs none of them: it passes its own `--config` and sets
 *    SAP_SYSTEM / SAP_URL_* directly in the spawned process environment.
 *
 * Everything here is extension-owned, gitignored (it hardcodes absolute, version-specific
 * paths), and re-applied on every activation — the extension's install path changes on
 * each version bump, so anything written by a previous version is stale by definition.
 */
import * as fs from "fs/promises"
import * as path from "path"

const MARKER_COMMENT = "Managed by ABAP FS — do not hand-edit compilerOptions.paths below."

export type RuntimePaths = {
  /** Absolute path to the extension's compiled runtime helpers (client/dist/runtime). */
  runtimeDir: string
  /** Absolute path to the bundled Playwright package (client/dist/vendor/node_modules/playwright). */
  playwrightDir: string
  /**
   * Absolute path to the extension's own node_modules/@types folder. The test folder has
   * no node_modules of its own, so without this any use of a Node global (process,
   * Buffer, ...) in a spec fails with "Cannot find name 'process'. Do you need to install
   * type definitions for node?" — advice the user cannot act on, since there is nowhere
   * to npm install into.
   */
  typesDir: string
}

function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, "/")
}

function buildTsconfig(rp: RuntimePaths, existing: any): any {
  const cfg = existing && typeof existing === "object" ? { ...existing } : {}
  cfg.$comment = MARKER_COMMENT
  cfg.compilerOptions = {
    ...(cfg.compilerOptions ?? {}),
    target: cfg.compilerOptions?.target ?? "ES2022",
    module: cfg.compilerOptions?.module ?? "commonjs",
    moduleResolution: cfg.compilerOptions?.moduleResolution ?? "node",
    esModuleInterop: true,
    skipLibCheck: true,
    strict: cfg.compilerOptions?.strict ?? false,
    baseUrl: ".",
    // Do NOT path-map @playwright/test here: Playwright's TypeScript transform honors
    // tsconfig paths, and mapping the test framework to an absolute extension path
    // creates a second module instance during collection, which fails with
    // "test() did not expect to be called here".
    paths: {
      "@sap-testing/runtime": [toForwardSlashes(rp.runtimeDir)]
    },
    typeRoots: [toForwardSlashes(rp.typesDir)],
    types: ["node"]
  }
  cfg.include = cfg.include ?? ["tests/**/*.ts"]
  return cfg
}

/**
 * Scaffolding every test folder needs, whether or not the Playwright sidebar is present:
 * a managed tsconfig and the runtime junction it points at.
 */
export async function ensureTestFolderBaseline(
  testFolder: string,
  rp: RuntimePaths
): Promise<void> {
  await ensureTsconfig(testFolder, rp)
  await ensurePackageJunction(
    path.join(testFolder, "node_modules", "@sap-testing", "runtime"),
    rp.runtimeDir
  )
  await ensureGitignored(testFolder)
}

async function ensureTsconfig(testFolder: string, rp: RuntimePaths): Promise<void> {
  const tsconfigPath = path.join(testFolder, "tsconfig.json")
  let existingRaw: string | null = null
  let existing: any = null
  try {
    existingRaw = await fs.readFile(tsconfigPath, "utf8")
    existing = JSON.parse(existingRaw)
  } catch {
    // no existing file, or unparsable — start fresh
  }
  const nextText = JSON.stringify(buildTsconfig(rp, existing), null, 2) + "\n"
  // Skip a pointless write, and the "file changed on disk" churn it causes in the editor.
  if (existingRaw !== nextText) await fs.writeFile(tsconfigPath, nextText, "utf8")
}

const GITIGNORE_BLOCK = [
  "# Machine-specific — points at this install's extension path, never portable",
  "tsconfig.json",
  "playwright.config.js",
  "node_modules/",
  ".sap-active-system",
  ""
].join("\n")

async function ensureGitignored(testFolder: string): Promise<void> {
  const gitignorePath = path.join(testFolder, ".gitignore")
  let content = ""
  try {
    content = await fs.readFile(gitignorePath, "utf8")
  } catch {
    // no .gitignore yet — will create one
  }
  if (content.split(/\r?\n/).some(l => l.trim() === "tsconfig.json")) return

  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : ""
  await fs.writeFile(gitignorePath, content + separator + GITIGNORE_BLOCK, "utf8")
}

/**
 * Point `linkPath` at `targetPath` as a junction, self-healing every time.
 *
 * Always removes whatever is already there unless it is a healthy junction to the right
 * target. A *broken* junction (target gone after a version bump) makes `fs.realpath`
 * throw, and creating over it fails with EEXIST — which used to leave the link dangling
 * so that nothing under it could resolve.
 */
async function ensurePackageJunction(linkPath: string, targetPath: string): Promise<void> {
  const wanted = path.resolve(targetPath)
  let existing: import("fs").Stats | null = null
  try {
    // lstat, NOT stat — inspect the link itself; following a broken junction throws and
    // hides the fact that the link is present-but-dangling.
    existing = await fs.lstat(linkPath)
  } catch {
    existing = null
  }

  if (existing) {
    if (existing.isSymbolicLink()) {
      const real = await fs.realpath(linkPath).catch(() => null)
      if (real && path.resolve(real) === wanted) return
    }
    await fs.rm(linkPath, { recursive: true, force: true })
  }

  await fs.mkdir(path.dirname(linkPath), { recursive: true })
  try {
    await fs.symlink(wanted, linkPath, "junction")
  } catch (error) {
    // Another concurrent call already recreated it (e.g. an overlapping sync). Accept it
    // if it now points at the right target, otherwise the failure is genuine.
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "EEXIST") throw error
    const real = await fs.realpath(linkPath).catch(() => null)
    if (!real || path.resolve(real) !== wanted) throw error
  }
}

/**
 * Everything the Playwright VS Code sidebar needs to discover and run specs from the test
 * folder. Applied only while that extension is installed, and removed again when it is
 * uninstalled, so a user who never installs it keeps a clean test folder.
 */
export async function ensurePlaywrightSidebarSupport(
  testFolder: string,
  rp: RuntimePaths
): Promise<void> {
  const nodeModules = path.join(testFolder, "node_modules")
  await ensurePackageJunction(path.join(nodeModules, "playwright"), rp.playwrightDir)
  await ensurePlaywrightTestWrapper(path.join(nodeModules, "@playwright", "test"))
  await ensureBinShims(path.join(nodeModules, ".bin"))
  await ensurePlaywrightConfig(testFolder)
}

/** Remove the sidebar-only artefacts, leaving the baseline scaffolding intact. */
export async function removePlaywrightSidebarSupport(testFolder: string): Promise<void> {
  const nodeModules = path.join(testFolder, "node_modules")
  await Promise.all([
    fs.rm(path.join(nodeModules, "playwright"), { recursive: true, force: true }),
    fs.rm(path.join(nodeModules, "@playwright"), { recursive: true, force: true }),
    fs.rm(path.join(nodeModules, ".bin"), { recursive: true, force: true }),
    fs.rm(path.join(testFolder, "playwright.config.js"), { force: true })
  ])
}

/**
 * A real local package rather than a junction, on purpose: the Playwright sidebar
 * resolves the CLI via `require.resolve(".../package.json")` and follows a junction back
 * to the extension's own copy, which launches the wrong CLI and makes the runner and the
 * spec load different Playwright instances.
 */
async function ensurePlaywrightTestWrapper(wrapperDir: string): Promise<void> {
  await fs.rm(wrapperDir, { recursive: true, force: true })
  await fs.mkdir(wrapperDir, { recursive: true })
  await fs.writeFile(
    path.join(wrapperDir, "package.json"),
    JSON.stringify(
      {
        name: "@playwright/test",
        version: "1.61.1",
        main: "index.js",
        types: "index.d.ts",
        bin: { playwright: "cli.js" }
      },
      null,
      2
    ) + "\n",
    "utf8"
  )
  await fs.writeFile(
    path.join(wrapperDir, "index.js"),
    'module.exports = require("../../playwright/test");\n',
    "ascii"
  )
  await fs.writeFile(
    path.join(wrapperDir, "cli.js"),
    '#!/usr/bin/env node\nrequire("../../playwright/cli");\n',
    "ascii"
  )
  await fs.writeFile(
    path.join(wrapperDir, "index.d.ts"),
    'export * from "../../playwright/types/test";\n',
    "ascii"
  )
}

async function ensureBinShims(binDir: string): Promise<void> {
  await fs.mkdir(binDir, { recursive: true })
  await fs.writeFile(
    path.join(binDir, "playwright.cmd"),
    '@echo off\r\nnode "%~dp0..\\playwright\\cli.js" %*\r\n',
    "ascii"
  )
  const shPath = path.join(binDir, "playwright")
  await fs.writeFile(
    shPath,
    '#!/bin/sh\nexec node "$(dirname "$0")/../playwright/cli.js" "$@"\n',
    "ascii"
  )
  if (process.platform !== "win32") await fs.chmod(shPath, 0o755)
}

function buildPlaywrightConfig(testFolder: string): string {
  // Built by concatenation so TypeScript doesn't interpret ${...} inside what is meant
  // to be raw JS emitted to the output file.
  const tfDir = JSON.stringify(toForwardSlashes(testFolder))
  return [
    "// playwright.config.js — managed by ABAP FS, do not hand-edit.",
    "// Lets the Playwright VS Code sidebar run specs through the SAP testing runtime",
    "// without requiring an npm install in the test folder.",
    "const fs = require('fs');",
    "const path = require('path');",
    "",
    "function findEdge() {",
    "  const pf = process.env.PROGRAMFILES || 'C:\\\\Program Files';",
    "  const pfx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\\\Program Files (x86)';",
    "  const candidates = [",
    "    process.env.SAP_TESTING_BROWSER_EXECUTABLE,",
    "    path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),",
    "    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),",
    "    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',",
    "    '/usr/bin/microsoft-edge',",
    "  ].filter(Boolean);",
    "  return candidates.find((p) => fs.existsSync(p));",
    "}",
    "",
    "const edgePath = findEdge();",
    "const testFolder = " + tfDir + ";",
    "",
    "// Target system comes from .sap-active-system, written by the ABAP FS status bar",
    "// picker. Format: line 1 = connectionId, line 2 = full WebGUI URL. The sidebar",
    "// cannot pass arguments, so the choice has to travel through a file.",
    "try {",
    "  const lines = fs.readFileSync(testFolder + '/.sap-active-system', 'utf8').trim().split(/\\r?\\n/);",
    "  const id = lines[0] && lines[0].trim();",
    "  const url = lines[1] && lines[1].trim();",
    "  if (id) process.env.SAP_SYSTEM = id;",
    "  if (id && url) process.env['SAP_URL_' + id] = url;",
    "} catch (e) { /* not written yet — pick a system from the status bar */ }",
    "",
    "// Do NOT require('@playwright/test') here. Loading it in the config consumes",
    "// Playwright's test singleton before spec collection, and later spec imports then",
    "// throw 'Playwright Test did not expect test() to be called here'. A plain object",
    "// export is all a Playwright config needs.",
    "module.exports = {",
    "  testDir: path.join(testFolder, 'tests'),",
    "  testMatch: '**/*.spec.ts',",
    "  timeout: 60000,",
    "  fullyParallel: false,",
    "  workers: 1,",
    "  retries: 0,",
    "  // No reporter here: the Playwright sidebar injects its own.",
    "  use: {",
    "    headless: true,",
    "    actionTimeout: 15000,",
    "    trace: 'retain-on-failure',",
    "    screenshot: 'only-on-failure',",
    "    video: 'off',",
    "    channel: edgePath ? 'msedge' : undefined,",
    "    launchOptions: edgePath ? { executablePath: edgePath } : {},",
    "  },",
    "  projects: edgePath ? [{",
    "    name: 'Microsoft Edge',",
    "    use: {",
    "      channel: 'msedge',",
    "      launchOptions: { executablePath: edgePath },",
    "    },",
    "  }] : undefined,",
    "  outputDir: path.join(testFolder, 'tests', '.playwright-output'),",
    "};"
  ].join("\n")
}

async function ensurePlaywrightConfig(testFolder: string): Promise<void> {
  const configPath = path.join(testFolder, "playwright.config.js")
  const next = buildPlaywrightConfig(testFolder)
  let existing: string | null = null
  try {
    existing = await fs.readFile(configPath, "utf8")
  } catch {
    /* doesn't exist yet */
  }
  if (existing !== next) await fs.writeFile(configPath, next, "utf8")
}

/** Write the sidebar's target-system file. Line 1 = connectionId, line 2 = WebGUI URL. */
export async function writeActiveSystem(
  testFolder: string,
  connectionId: string,
  url: string
): Promise<void> {
  await fs.writeFile(
    path.join(testFolder, ".sap-active-system"),
    `${connectionId}\n${url}\n`,
    "utf8"
  )
}

/** The connectionId recorded in `.sap-active-system`, or undefined if none is set. */
export async function readActiveSystem(testFolder: string): Promise<string | undefined> {
  try {
    const contents = await fs.readFile(path.join(testFolder, ".sap-active-system"), "utf8")
    return contents.trim().split(/\r?\n/)[0]?.trim() || undefined
  } catch {
    return undefined
  }
}
