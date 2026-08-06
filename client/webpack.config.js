// @ts-check

"use strict"

const path = require("path")
const fs = require("fs")
const TerserPlugin = require("terser-webpack-plugin")
const CopyPlugin = require("copy-webpack-plugin")

/**
 * Playwright cannot be bundled: its runner forks worker processes by real file path
 * (`require.resolve("../worker/workerProcessEntry.js")`), resolves sibling packages as
 * directories, and compiles the user's spec files at run time. So it is copied in as
 * loose files instead, into a real `node_modules` layout so that Playwright's own
 * `require("playwright-core")` resolves normally from where it lands.
 */
const playwrightPackages = ["playwright", "playwright-core", "@playwright/test"]
const vendorPatterns = playwrightPackages.map(pkg => ({
  from: `node_modules/${pkg}`,
  to: `vendor/node_modules/${pkg}`,
  globOptions: {
    // Debug sidecars and readmes only; licence and notice files are kept for attribution.
    ignore: ["**/*.js.txt", "**/README.md"]
  },
  noErrorOnMissing: false,
  force: true
}))

/**
 * The SAP testing runtime ships as loose CommonJS (see tsconfig.runtime.json), so unlike
 * everything webpack bundles, its `require("js-yaml")` / `require("exceljs")` are resolved
 * by Node at test-run time — from inside the installed extension, which has no node_modules.
 * These packages and their transitive dependencies therefore have to travel with it.
 */
const runtimeExternals = ["js-yaml", "exceljs"]

const NODE_MODULES = path.join(__dirname, "node_modules")

/**
 * Directory a package resolves to from `fromDir`, or null when it isn't installed.
 * @param {string} name
 * @param {string} fromDir
 * @returns {string | null}
 */
function packageDir(name, fromDir) {
  try {
    return path.dirname(require.resolve(`${name}/package.json`, { paths: [fromDir] }))
  } catch {
    // Packages with an "exports" map may refuse a direct package.json request; resolve the
    // entry point instead and walk up to the directory that owns it.
    try {
      let dir = path.dirname(require.resolve(name, { paths: [fromDir] }))
      while (!fs.existsSync(path.join(dir, "package.json"))) {
        const parent = path.dirname(dir)
        if (parent === dir) return null
        dir = parent
      }
      return dir
    } catch {
      return null
    }
  }
}

/**
 * Whether `dir` sits directly in the top-level node_modules (handles @scope/name).
 * @param {string} dir
 */
function isTopLevel(dir) {
  const parent = path.dirname(dir)
  return parent === NODE_MODULES || path.dirname(parent) === NODE_MODULES
}

/**
 * Walk `dependencies` transitively so nothing the runtime loads is left behind.
 *
 * Resolution is CONTEXTUAL — each dependency is resolved from its dependent's own directory,
 * so a package that bundles an older copy of a shared dependency contributes that copy's
 * requirements rather than the hoisted version's. Only top-level packages are returned:
 * nested ones are already inside the parent directory being copied.
 *
 * @param {string[]} roots
 * @returns {Map<string, string>}
 */
function collectRuntimeDeps(roots) {
  /** @type {Map<string, string>} */
  const flat = new Map()
  const visited = new Set()
  /**
   * @param {string} name
   * @param {string} fromDir
   */
  const visit = (name, fromDir) => {
    // Type-only packages are never require()d at run time; exceljs lists @types/node as a
    // runtime dependency regardless, and shipping it wastes megabytes.
    if (name.startsWith("@types/")) return
    const dir = packageDir(name, fromDir)
    if (!dir || visited.has(dir)) return
    visited.add(dir)
    // Nested copies already travel inside the parent being copied, so only top-level ones
    // need their own pattern. Keyed by directory, so a package and a differently-versioned
    // nested copy of it are treated as the distinct things they are.
    if (isTopLevel(dir)) flat.set(name, dir)
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
    Object.keys(pkg.dependencies || {}).forEach(dep => visit(dep, dir))
  }
  roots.forEach(name => visit(name, __dirname))
  return flat
}

// Flattened next to the runtime, mirroring how npm hoists them: a nested node_modules inside
// any copied package comes along with it, so version conflicts still resolve correctly.
const runtimeDepPatterns = [...collectRuntimeDeps(runtimeExternals)].map(([name, from]) => ({
  from,
  to: `runtime/node_modules/${name}`,
  // Explicit, because the plugin otherwise infers file-vs-directory from the extension and
  // collapses dotted package names (lodash.isfunction, fs.realpath) into single files.
  toType: "dir",
  // bin/ holds CLI entry points that are never require()d as modules — and some are not
  // valid standalone modules at all (top-level `return`), which trips the minifier.
  globOptions: { ignore: ["**/bin/**", "**/*.js.map", "**/README.md"] },
  noErrorOnMissing: false,
  force: true
}))

/**@type {import('webpack').Configuration}*/
const config = {
  target: "node", // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/

  // Enable webpack caching for faster builds
  cache: {
    type: "filesystem",
    buildDependencies: {
      config: [__filename]
    }
  },

  entry: {
    extension: "./src/extension.ts",
    jsWorkerEntry: "./src/notebooks/jsWorkerEntry.ts"
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resource-path]"
  },
  devtool: "source-map",
  externals: {
    vscode: "commonjs vscode", // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
    "@playwright/mcp": "commonjs @playwright/mcp"
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: [".ts", ".js"]
  },
  watchOptions: {
    ignored: /node_modules|out/
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: "media",
          to: "media",
          noErrorOnMissing: true,
          force: true,
          priority: 0
        },
        {
          from: "../DOCUMENTATION.md",
          to: "media/DOCUMENTATION.md",
          noErrorOnMissing: false,
          force: true
        },
        {
          from: "templates/playwright.config.js",
          to: "vendor/playwright.config.js",
          noErrorOnMissing: false,
          force: true
        },
        {
          from: "templates/sso-global-setup.js",
          to: "vendor/sso-global-setup.js",
          noErrorOnMissing: false,
          force: true
        },
        ...vendorPatterns,
        ...runtimeDepPatterns
      ]
    })
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/, /.*\.test\.(d\.)[tj]s/, /media/],
        use: [
          {
            loader: "ts-loader",
            options: {
              transpileOnly: true
            }
          }
        ]
      },
      {
        test: /\.(node)$/i,
        use: [
          {
            loader: "file-loader"
          }
        ]
      },
      // Handle ESM modules that use .js extensions in imports (like @modelcontextprotocol/sdk)
      {
        test: /\.m?js$/,
        resolve: {
          fullySpecified: false
        }
      }
    ]
  }
}

/**@type {import('webpack').Configuration}*/
const prodConfig = {
  ...config,
  name: "production",
  mode: "production",
  optimization: {
    minimizer: [
      compiler => {
        new TerserPlugin({
          parallel: true,
          // Copied third-party trees, not our own code. Minifying vendored Playwright would
          // rewrite the paths its runner resolves worker entry points from; the runtime's
          // dependencies include CLI scripts that aren't even valid standalone modules.
          exclude: /(media|vendor|runtime[\\/]node_modules)[\\/].*\.js$/,
          terserOptions: {
            keep_classnames: true
          }
        }).apply(compiler)
      }
    ]
  }
}
/**@type {import('webpack').Configuration}*/
const devConfig = {
  ...config,
  name: "development",
  mode: "development",
  infrastructureLogging: { level: "verbose" }
}
module.exports = [devConfig, prodConfig]
