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
          // Minifying vendored Playwright would rewrite the paths its runner resolves
          // worker entry points from, and break it.
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
module.exports = [devConfig, prodConfig]
