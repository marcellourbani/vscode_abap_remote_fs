// @ts-check

"use strict"

const path = require("path")
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
        ...vendorPatterns
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
          // rewrite the paths its runner resolves worker entry points from.
          exclude: /(media|vendor)[\\/].*\.js$/,
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

/**
 * The SAP testing runtime, as ONE self-contained CommonJS file next to the `.d.ts` files
 * `build_runtime` emits. The test folder junctions that directory in as `@sap-testing/runtime`.
 *
 * Bundled rather than emitted loose because the extension ships no `node_modules`: as loose
 * CommonJS its `require("js-yaml")`/`require("exceljs")` would be resolved by Node at test-run
 * time and find nothing. Bundling puts them inside the file instead.
 *
 * `@playwright/test` stays external — the runtime uses it only for types, and at run time the
 * spec's own Playwright instance must be the one in play.
 *
 * @type {import('webpack').Configuration}
 */
const runtimeConfig = {
  name: "runtime",
  target: "node",
  mode: "production",
  entry: "./src/services/testing/runtime/index.ts",
  output: {
    path: path.resolve(__dirname, "dist", "runtime"),
    filename: "index.js",
    libraryTarget: "commonjs2"
  },
  externals: { "@playwright/test": "commonjs @playwright/test" },
  resolve: { extensions: [".ts", ".js"] },
  plugins: [
    // index.js/index.d.ts would resolve by convention anyway, but only for a plain `require`
    // of the directory. TypeScript's node16/nodenext resolution expects a package.json, so a
    // test folder using a modern moduleResolution would fail to find the types without this.
    new CopyPlugin({
      patterns: [
        {
          from: "templates/runtime-package.json",
          to: "package.json",
          noErrorOnMissing: false,
          force: true
        }
      ]
    })
  ],
  optimization: {
    // Left readable on purpose: when a helper throws, this file is what appears in the
    // Playwright stack trace the user has to read.
    minimize: false
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [
          {
            loader: "ts-loader",
            // Type checking happens in build_runtime, which must type-check to emit .d.ts.
            options: { configFile: "tsconfig.runtime.json", transpileOnly: true }
          }
        ]
      }
    ]
  }
}

module.exports = [devConfig, prodConfig, runtimeConfig]
